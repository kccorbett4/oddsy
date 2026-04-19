// Player HR prop odds endpoint. Pulls the `batter_home_runs` market
// from The Odds API for every MLB event on today's slate.
//
// Cost: each game = 1 event-odds call. At ~15 MLB games per day and a
// 6-hour cache, we spend ~60 credits/day (4 refreshes × 15 games).
// Force a fresh pull with ?force=1 during development.
//
// Response shape:
// {
//   updatedAt,
//   events: [
//     { eventId, home, away, commence,
//       players: [{ name, books: [{ book, overAmerican, overDecimal }] }] }
//   ]
// }
import { createClient } from "redis";

const CACHE_KEY = "hrodds:v1";
const CACHE_TTL = 6 * 3600; // 6 hours

async function jsonFetch(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return { _err: `${r.status}` };
    return await r.json();
  } catch (e) {
    return { _err: e.message };
  }
}

const americanToDecimal = (a) => {
  if (!Number.isFinite(a)) return null;
  return a >= 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
};

export default async function handler(req, res) {
  const API_KEY = process.env.ODDS_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured" });

  const force = req.query?.force === "1";
  let redis = null;
  try {
    if (process.env.REDIS_URL) {
      try {
        redis = createClient({ url: process.env.REDIS_URL });
        await redis.connect();
        if (!force) {
          const cached = await redis.get(CACHE_KEY);
          if (cached) {
            res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=1800");
            return res.status(200).json(JSON.parse(cached));
          }
        }
      } catch { redis = null; }
    }

    // List of upcoming MLB events.
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${API_KEY}`;
    const eventList = await jsonFetch(eventsUrl);
    if (!Array.isArray(eventList)) {
      return res.status(502).json({ error: "Failed to fetch event list", detail: eventList });
    }

    const now = Date.now();
    // Only today-ish games (next 36 hours).
    const soon = eventList.filter(e => {
      if (!e.commence_time) return false;
      const ms = new Date(e.commence_time).getTime();
      return ms > now - 3 * 3600 * 1000 && ms < now + 36 * 3600 * 1000;
    });

    let creditsRemaining = null;
    let creditsUsed = null;

    const events = [];
    for (const ev of soon) {
      const oddsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${ev.id}/odds`
        + `?apiKey=${API_KEY}&regions=us&markets=batter_home_runs&oddsFormat=american`;
      const resp = await fetch(oddsUrl);
      creditsRemaining = resp.headers.get("x-requests-remaining") || creditsRemaining;
      creditsUsed = resp.headers.get("x-requests-used") || creditsUsed;
      if (!resp.ok) continue;
      const data = await resp.json();

      // Aggregate prices by player name. The Odds API returns a market
      // per bookmaker, each with an `outcomes` array of {name, price}
      // where `name` is the player's name. The "Yes" for HR props is
      // usually represented as a single outcome per player (books don't
      // always post both Yes and No for HR props).
      const byPlayer = {}; // name -> [{book, overAmerican}]
      for (const bm of (data.bookmakers || [])) {
        const m = (bm.markets || []).find(x => x.key === "batter_home_runs");
        if (!m) continue;
        for (const o of (m.outcomes || [])) {
          if (!o.name || !Number.isFinite(o.price)) continue;
          // Some books split into Yes/No descriptions; only keep Over/Yes prices.
          if (o.description && /^(no|under)$/i.test(o.description)) continue;
          const key = o.name.trim();
          if (!byPlayer[key]) byPlayer[key] = [];
          byPlayer[key].push({
            book: bm.title,
            overAmerican: o.price,
            overDecimal: +americanToDecimal(o.price).toFixed(3),
          });
        }
      }

      events.push({
        eventId: ev.id,
        sport_key: "baseball_mlb",
        commence: ev.commence_time,
        home: ev.home_team,
        away: ev.away_team,
        players: Object.entries(byPlayer).map(([name, books]) => ({ name, books })),
      });
    }

    const payload = {
      updatedAt: new Date().toISOString(),
      creditsRemaining,
      creditsUsed,
      eventCount: events.length,
      events,
    };

    if (redis) {
      try { await redis.set(CACHE_KEY, JSON.stringify(payload), { EX: CACHE_TTL }); } catch {}
    }

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=1800");
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (redis) await redis.disconnect().catch(() => {});
  }
}
