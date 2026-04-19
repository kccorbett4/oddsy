// Returns performance stats.
// - Built-in strategies (sharp/value/stale/rlm/correlated/narrative) always
//   come from global `stats:<name>` keys.
// - Custom strategies come from `user:<uid>:stats:custom_<id>` keys for the
//   signed-in user (no auth → no custom stats).
import { getRedis } from "./_redis.js";
import { getUserIdFromRequest } from "./_auth.js";

const AUTO_RESOLVE_THROTTLE_KEY = "auto_resolve:last_run";
const AUTO_RESOLVE_MIN_GAP_SECONDS = 10 * 60; // 10 min

// Hobby plan caps the resolver cron at once/day, so picks from games that
// ended since the last run pile up and users see stale stats. Whenever
// someone loads their Record page we fire the resolver in the background
// (throttled to at most one run per 10 min) so stats stay fresh without
// blocking the page response.
async function maybeTriggerAutoResolve(client, origin) {
  try {
    const last = await client.get(AUTO_RESOLVE_THROTTLE_KEY);
    const now = Date.now();
    if (last && now - parseInt(last) < AUTO_RESOLVE_MIN_GAP_SECONDS * 1000) return;
    await client.set(AUTO_RESOLVE_THROTTLE_KEY, String(now), { EX: AUTO_RESOLVE_MIN_GAP_SECONDS * 2 });
    // Fire-and-forget — no await. If origin is missing (edge cases) skip.
    if (!origin) return;
    fetch(`${origin}/api/track-resolve`).catch(() => {});
  } catch {}
}

function parseStats(data) {
  const wins = parseInt(data.wins || 0);
  const losses = parseInt(data.losses || 0);
  const pushes = parseInt(data.pushes || 0);
  const total = parseInt(data.total || 0);
  const units = parseFloat(data.units || 0);
  const decided = wins + losses;
  return {
    wins, losses, pushes, total,
    units: Number(units.toFixed(2)),
    roi: total > 0 ? Number(((units / total) * 100).toFixed(2)) : null,
    winPct: decided > 0 ? ((wins / decided) * 100).toFixed(1) : null,
  };
}

export default async function handler(req, res) {
  try {
    const client = await getRedis();
    if (!client) {
      return res.status(200).json({
        stats: {},
        pendingPicks: 0,
        note: "REDIS_URL not configured",
      });
    }

    // Kick off a background resolver pass (throttled) so stats catch up
    // between the once-daily cron runs the Hobby plan permits.
    const host = req.headers?.["x-forwarded-host"] || req.headers?.host;
    const proto = req.headers?.["x-forwarded-proto"] || "https";
    const origin = host ? `${proto}://${host}` : null;
    maybeTriggerAutoResolve(client, origin);

    const userId = await getUserIdFromRequest(req);

    const stats = {};
    const seen = new Set();

    // Built-in, global stats (skip per-user and per-day keys)
    for await (const batch of client.scanIterator({ MATCH: "stats:*", COUNT: 500 })) {
      const keys = Array.isArray(batch) ? batch : [batch];
      for (const key of keys) {
        if (seen.has(key)) continue;
        seen.add(key);
        const name = key.slice(6);
        if (/^.+:\d{4}-\d{2}-\d{2}$/.test(name)) continue; // per-day rollup
        const data = await client.hGetAll(key);
        if (!data || Object.keys(data).length === 0) continue;
        stats[name] = parseStats(data);
      }
    }

    // Per-user custom strategy stats (only when authenticated)
    if (userId) {
      const prefix = `user:${userId}:stats:`;
      for await (const batch of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 500 })) {
        const keys = Array.isArray(batch) ? batch : [batch];
        for (const key of keys) {
          if (seen.has(key)) continue;
          seen.add(key);
          const name = key.slice(prefix.length);
          if (/^.+:\d{4}-\d{2}-\d{2}$/.test(name)) continue; // per-day rollup
          const data = await client.hGetAll(key);
          if (!data || Object.keys(data).length === 0) continue;
          stats[name] = parseStats(data);
        }
      }
    }

    // Ensure the built-ins always have a shape so the UI's zero-state works.
    for (const id of ["sharp", "value", "stale", "rlm", "correlated", "narrative", "safe_parlay"]) {
      if (!stats[id]) stats[id] = { wins: 0, losses: 0, pushes: 0, total: 0, units: 0, roi: null, winPct: null };
    }

    const pendingCount = await client.zCard("pending_picks");

    res.setHeader("Cache-Control", "private, s-maxage=60, stale-while-revalidate=60");
    return res.status(200).json({ stats, pendingPicks: pendingCount });
  } catch (err) {
    return res.status(200).json({
      stats: {},
      pendingPicks: 0,
      error: err.message,
    });
  }
}
