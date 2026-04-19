// Returns performance stats for all strategies
import { createClient } from "redis";

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

    client = createClient({ url: process.env.REDIS_URL });
    await client.connect();

    // Scan every stats:* hash (skipping daily stats:<name>:<YYYY-MM-DD>) so
    // custom user strategies show up without needing a hardcoded list.
    const stats = {};
    const seen = new Set();
    for await (const batch of client.scanIterator({ MATCH: "stats:*", COUNT: 500 })) {
      const keys = Array.isArray(batch) ? batch : [batch];
      for (const key of keys) {
        if (seen.has(key)) continue;
        seen.add(key);
        const name = key.slice(6); // strip "stats:"
        // Skip per-day rollup keys: stats:<strategy>:YYYY-MM-DD
        if (/^.+:\d{4}-\d{2}-\d{2}$/.test(name)) continue;

        const data = await client.hGetAll(key);
        if (!data || Object.keys(data).length === 0) continue;
        const wins = parseInt(data.wins || 0);
        const losses = parseInt(data.losses || 0);
        const pushes = parseInt(data.pushes || 0);
        const total = parseInt(data.total || 0);
        const units = parseFloat(data.units || 0);
        const decided = wins + losses;
        stats[name] = {
          wins,
          losses,
          pushes,
          total,
          units: Number(units.toFixed(2)),
          roi: total > 0 ? Number(((units / total) * 100).toFixed(2)) : null,
          winPct: decided > 0 ? ((wins / decided) * 100).toFixed(1) : null,
        };
      }
    }
    // Ensure the built-ins always have a shape so the UI's zero-state works.
    for (const id of ["sharp", "value", "stale", "rlm", "correlated", "narrative"]) {
      if (!stats[id]) stats[id] = { wins: 0, losses: 0, pushes: 0, total: 0, units: 0, roi: null, winPct: null };
    }

    const pendingCount = await client.zCard("pending_picks");

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
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
