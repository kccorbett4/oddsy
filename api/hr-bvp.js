// Batter-vs-pitcher career history. Fetched on-demand when the user
// expands a batter card on the /homeruns page — we don't pre-fetch for
// every possible matchup on the slate because it would be ~200-300
// extra calls per refresh and BvP is noisy anyway (most matchups are
// tiny samples). Cached 24h in Redis per (batter, pitcher) pair.
import { createClient } from "redis";

const CACHE_TTL = 86400;

async function jsonFetch(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export default async function handler(req, res) {
  const batterId = req.query?.batter;
  const pitcherId = req.query?.pitcher;
  if (!batterId || !pitcherId) {
    return res.status(400).json({ error: "batter and pitcher query params required" });
  }

  const cacheKey = `hrbvp:${batterId}:${pitcherId}`;
  let redis = null;
  try {
    if (process.env.REDIS_URL) {
      try {
        redis = createClient({ url: process.env.REDIS_URL });
        await redis.connect();
        const cached = await redis.get(cacheKey);
        if (cached) {
          res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=3600");
          return res.status(200).json(JSON.parse(cached));
        }
      } catch { redis = null; }
    }

    // vsPlayer stats type — career line between two specific players.
    const url = `https://statsapi.mlb.com/api/v1/people/${batterId}/stats`
      + `?stats=vsPlayer&opposingPlayerId=${pitcherId}&group=hitting`;
    const j = await jsonFetch(url);

    const splits = j?.stats?.[0]?.splits || [];
    // vsPlayer returns one split per season faced; aggregate.
    let pa = 0, ab = 0, h = 0, hr = 0, bb = 0, k = 0, xbh = 0, tb = 0;
    for (const s of splits) {
      const st = s.stat || {};
      pa += parseInt(st.plateAppearances || "0");
      ab += parseInt(st.atBats || "0");
      h += parseInt(st.hits || "0");
      hr += parseInt(st.homeRuns || "0");
      bb += parseInt(st.baseOnBalls || "0");
      k += parseInt(st.strikeOuts || "0");
      xbh += parseInt(st.doubles || "0") + parseInt(st.triples || "0") + parseInt(st.homeRuns || "0");
      tb += parseInt(st.totalBases || "0");
    }
    const avg = ab > 0 ? h / ab : 0;
    const slg = ab > 0 ? tb / ab : 0;
    const payload = {
      batterId, pitcherId,
      pa, ab, h, hr, bb, k, xbh, tb,
      avg: +avg.toFixed(3),
      slg: +slg.toFixed(3),
      iso: +(slg - avg).toFixed(3),
      hrPerAB: ab > 0 ? +(hr / ab).toFixed(4) : 0,
      sampleNote: pa < 15
        ? "small sample — use as a tiebreaker, not a signal"
        : pa < 40 ? "moderate sample" : "meaningful sample",
      updatedAt: new Date().toISOString(),
    };

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(payload), { EX: CACHE_TTL }); } catch {}
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=3600");
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (redis) await redis.disconnect().catch(() => {});
  }
}
