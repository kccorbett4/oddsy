// Returns performance stats.
// - Built-in strategies (sharp/value/stale/rlm/correlated/narrative) always
//   come from global `stats:<name>` keys.
// - Custom strategies come from `user:<uid>:stats:custom_<id>` keys for the
//   signed-in user (no auth → no custom stats).
import { createClient } from "redis";
import { getUserIdFromRequest } from "./_auth.js";

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
  let client;
  try {
    if (!process.env.REDIS_URL) {
      return res.status(200).json({
        stats: {},
        pendingPicks: 0,
        note: "REDIS_URL not configured",
      });
    }

    const userId = await getUserIdFromRequest(req);

    client = createClient({ url: process.env.REDIS_URL });
    await client.connect();

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
    for (const id of ["sharp", "value", "stale", "rlm", "correlated", "narrative"]) {
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
  } finally {
    if (client) await client.disconnect().catch(() => {});
  }
}
