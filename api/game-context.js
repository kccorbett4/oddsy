// Game enrichment endpoint. Fetches Open-Meteo weather, ESPN rest days,
// team records, injuries, and FPI/BPI ratings for upcoming games across
// all supported sports. Cached in Redis for 30 min to keep API load sane.
//
// Response: { games: { "<sport_key>:<away>@<home>:<YYYY-MM-DD>": { ...ctx } }, updatedAt }
// Date suffix prevents same-day doubleheaders and multi-day series from
// colliding (MLB teams play the same opponent on consecutive days, and the
// old key format silently overwrote Game 1's context with Game 2's).
// The StrategyBuilder merges this map into the /api/odds feed using the
// same sport+team keys.
import { createClient } from "redis";
import { venueFor } from "./_venues.js";

const SPORT_MAP = {
  basketball_nba: { path: "basketball/nba", powerPath: "basketball/nba" },
  americanfootball_nfl: { path: "football/nfl", powerPath: "football/nfl" },
  baseball_mlb: { path: "baseball/mlb", powerPath: null },
  icehockey_nhl: { path: "hockey/nhl", powerPath: null },
  basketball_ncaab: { path: "basketball/mens-college-basketball", powerPath: null },
  americanfootball_ncaaf: { path: "football/college-football", powerPath: "football/college-football" },
};

const INJURY_SPORTS = new Set(["americanfootball_nfl", "basketball_nba"]);
const CACHE_KEY = "gamectx:v1";
const CACHE_TTL = 1800; // 30 min

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function jsonFetch(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function fetchScoreboard(path, dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard${dateStr ? `?dates=${dateStr}` : ""}`;
  const j = await jsonFetch(url);
  return j?.events || [];
}

async function fetchInjuries(path, teamId) {
  const j = await jsonFetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}/injuries`);
  const list = j?.injuries?.[0]?.injuries || [];
  return list
    .filter(i => ["Out", "Doubtful", "Injured Reserve"].includes(i.status))
    .map(i => ({
      name: i.athlete?.displayName || null,
      pos: i.athlete?.position?.abbreviation || null,
      status: i.status,
    }));
}

async function fetchPowerIndex(powerPath) {
  const j = await jsonFetch(`https://site.api.espn.com/apis/site/v2/sports/${powerPath}/powerindex`);
  const teams = j?.teams || [];
  const out = {};
  for (const t of teams) {
    const id = t.team?.id;
    if (!id) continue;
    const stats = t.stats || t.categories?.[0]?.stats || [];
    const fpi = stats.find(s => s.name === "fpi" || s.name === "bpi" || s.name === "overall")?.value;
    if (typeof fpi === "number") out[String(id)] = fpi;
  }
  return out;
}

async function fetchWeather(lat, lon, commenceIso) {
  const date = new Date(commenceIso);
  const dateStr = date.toISOString().slice(0, 10);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m`
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`
    + `&start_date=${dateStr}&end_date=${dateStr}&timezone=UTC`;
  const j = await jsonFetch(url);
  if (!j?.hourly?.time) return null;
  // Find the hourly slot nearest to commence time
  const targetMs = date.getTime();
  let bestIdx = 0;
  let bestDelta = Infinity;
  j.hourly.time.forEach((t, i) => {
    const delta = Math.abs(new Date(t + "Z").getTime() - targetMs);
    if (delta < bestDelta) { bestDelta = delta; bestIdx = i; }
  });
  return {
    tempF: j.hourly.temperature_2m?.[bestIdx] ?? null,
    precipIn: j.hourly.precipitation?.[bestIdx] ?? null,
    precipProb: j.hourly.precipitation_probability?.[bestIdx] ?? null,
    windMph: j.hourly.wind_speed_10m?.[bestIdx] ?? null,
  };
}

function parseRecord(summary) {
  if (!summary || typeof summary !== "string") return null;
  const m = summary.match(/^(\d+)-(\d+)(?:-(\d+))?/);
  if (!m) return null;
  const w = parseInt(m[1] || "0");
  const l = parseInt(m[2] || "0");
  const t = parseInt(m[3] || "0");
  const games = w + l + t;
  if (games === 0) return { summary, winPct: null, w, l, t };
  return { summary, winPct: (w + 0.5 * t) / games, w, l, t };
}

function recordFor(competitor, type) {
  const recs = competitor?.records || [];
  // ESPN uses varying identifiers: "overall"/"Overall"/"total"
  const byType = recs.find(r => {
    const id = (r.type || r.name || "").toLowerCase();
    return id === type.toLowerCase();
  });
  return byType?.summary || null;
}

export default async function handler(req, res) {
  let redis;
  const force = req.query?.force === "1";
  try {
    if (process.env.REDIS_URL) {
      try {
        redis = createClient({ url: process.env.REDIS_URL });
        await redis.connect();
        if (!force) {
          const cached = await redis.get(CACHE_KEY);
          if (cached) {
            res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=900");
            return res.status(200).json(JSON.parse(cached));
          }
        }
      } catch {
        redis = null;
      }
    }

    const now = new Date();

    // Scoreboards: past 10 days (rest days) + next 8 days (upcoming games)
    const pastDates = Array.from({ length: 10 }, (_, i) => ymd(new Date(now.getTime() - (i + 1) * 86400000)));
    const futureDates = Array.from({ length: 14 }, (_, i) => ymd(new Date(now.getTime() + i * 86400000)));

    const histTasks = [];
    const futTasks = [];
    for (const [sportKey, { path }] of Object.entries(SPORT_MAP)) {
      for (const d of pastDates) histTasks.push(fetchScoreboard(path, d).then(events => ({ sportKey, path, events })));
      for (const d of futureDates) futTasks.push(fetchScoreboard(path, d).then(events => ({ sportKey, path, events })));
    }

    // Power indices run in parallel with scoreboards
    const powerTasks = Object.entries(SPORT_MAP)
      .filter(([, v]) => v.powerPath)
      .map(([sportKey, v]) => fetchPowerIndex(v.powerPath).then(map => ({ sportKey, map })));

    const [histResults, futResults, powerResults] = await Promise.all([
      Promise.all(histTasks),
      Promise.all(futTasks),
      Promise.all(powerTasks),
    ]);

    const powerIndex = {};
    for (const { sportKey, map } of powerResults) {
      for (const [teamId, val] of Object.entries(map)) {
        powerIndex[`${sportKey}:${teamId}`] = val;
      }
    }

    // Build last-game-date map from historical finals
    const lastGame = {}; // key: `${sportKey}:${teamName}` -> ms
    for (const { sportKey, events } of histResults) {
      for (const e of events) {
        const status = e.status?.type?.name || e.competitions?.[0]?.status?.type?.name;
        if (status !== "STATUS_FINAL") continue;
        const commence = new Date(e.date).getTime();
        const comp = e.competitions?.[0];
        for (const c of (comp?.competitors || [])) {
          const name = c.team?.displayName;
          if (!name) continue;
          const key = `${sportKey}:${name}`;
          if (!lastGame[key] || commence > lastGame[key]) lastGame[key] = commence;
        }
      }
    }

    // Build context for each upcoming game, collect injury + weather tasks
    const ctx = {};
    const seenGameIds = new Set();
    const injuryTargets = new Map(); // key `${sportKey}:${teamId}` -> {sportKey, path, teamId}
    const weatherTasks = [];

    for (const { sportKey, path, events } of futResults) {
      for (const e of events) {
        if (seenGameIds.has(e.id)) continue;
        seenGameIds.add(e.id);

        const comp = e.competitions?.[0];
        const home = comp?.competitors?.find(c => c.homeAway === "home");
        const away = comp?.competitors?.find(c => c.homeAway === "away");
        if (!home?.team?.displayName || !away?.team?.displayName) continue;
        const homeName = home.team.displayName;
        const awayName = away.team.displayName;
        const commenceMs = new Date(e.date).getTime();

        const dateStr = e.date ? new Date(e.date).toISOString().slice(0, 10) : "";
        const gameKey = `${sportKey}:${awayName}@${homeName}:${dateStr}`;
        const homeLastMs = lastGame[`${sportKey}:${homeName}`];
        const awayLastMs = lastGame[`${sportKey}:${awayName}`];

        const homeRecord = parseRecord(recordFor(home, "total") || recordFor(home, "overall") || home.records?.[0]?.summary);
        const awayRecord = parseRecord(recordFor(away, "total") || recordFor(away, "overall") || away.records?.[0]?.summary);

        const homeFPI = powerIndex[`${sportKey}:${home.team?.id}`] ?? null;
        const awayFPI = powerIndex[`${sportKey}:${away.team?.id}`] ?? null;

        ctx[gameKey] = {
          espnId: e.id,
          commence: e.date,
          home: homeName,
          away: awayName,
          homeRecord,
          awayRecord,
          homeRestDays: homeLastMs ? Math.max(0, Math.floor((commenceMs - homeLastMs) / 86400000)) : null,
          awayRestDays: awayLastMs ? Math.max(0, Math.floor((commenceMs - awayLastMs) / 86400000)) : null,
          homeFPI,
          awayFPI,
          homeInjuries: null,
          awayInjuries: null,
          weather: null,
          outdoor: null,
        };

        // Queue injuries for NFL + NBA teams that have upcoming games
        if (INJURY_SPORTS.has(sportKey)) {
          if (home.team?.id) injuryTargets.set(`${sportKey}:home:${gameKey}`, { side: "home", gameKey, path, teamId: home.team.id });
          if (away.team?.id) injuryTargets.set(`${sportKey}:away:${gameKey}`, { side: "away", gameKey, path, teamId: away.team.id });
        }

        // Weather for outdoor NFL/MLB only (venues we've catalogued)
        const venue = venueFor(sportKey, homeName);
        if (venue) {
          ctx[gameKey].outdoor = venue.outdoor;
          if (venue.outdoor) {
            weatherTasks.push(fetchWeather(venue.lat, venue.lon, e.date).then(w => ({ gameKey, w })));
          }
        }
      }
    }

    // Resolve injuries and weather in parallel
    const injuryTasks = Array.from(injuryTargets.values()).map(({ side, gameKey, path, teamId }) =>
      fetchInjuries(path, teamId).then(list => ({ side, gameKey, list }))
    );
    const [injuryResults, weatherResults] = await Promise.all([
      Promise.all(injuryTasks),
      Promise.all(weatherTasks),
    ]);

    for (const { side, gameKey, list } of injuryResults) {
      if (!ctx[gameKey]) continue;
      ctx[gameKey][side === "home" ? "homeInjuries" : "awayInjuries"] = list;
    }
    for (const { gameKey, w } of weatherResults) {
      if (ctx[gameKey] && w) ctx[gameKey].weather = w;
    }

    const payload = {
      games: ctx,
      gameCount: Object.keys(ctx).length,
      updatedAt: new Date().toISOString(),
    };

    if (redis) {
      try { await redis.set(CACHE_KEY, JSON.stringify(payload), { EX: CACHE_TTL }); } catch {}
    }

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=900");
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (redis) await redis.disconnect().catch(() => {});
  }
}
