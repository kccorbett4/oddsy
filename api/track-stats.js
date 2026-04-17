import { kv } from "@vercel/kv";

// Returns performance stats for all strategies
export default async function handler(req, res) {
  try {
    const strategies = ["sharp", "value", "stale", "rlm", "correlated", "narrative"];
    const stats = {};

    for (const strategy of strategies) {
      const data = await kv.hgetall(`stats:${strategy}`);
      if (data) {
        const wins = parseInt(data.wins || 0);
        const losses = parseInt(data.losses || 0);
        const pushes = parseInt(data.pushes || 0);
        const total = parseInt(data.total || 0);
        const decided = wins + losses;
        stats[strategy] = {
          wins,
          losses,
          pushes,
          total,
          winPct: decided > 0 ? ((wins / decided) * 100).toFixed(1) : null,
          roi: null, // could be computed if we tracked odds
        };
      } else {
        stats[strategy] = { wins: 0, losses: 0, pushes: 0, total: 0, winPct: null };
      }
    }

    // Also get pending count
    const pendingCount = await kv.zcard("pending_picks");

    // Cache for 5 minutes
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    return res.status(200).json({ stats, pendingPicks: pendingCount });
  } catch (err) {
    // If KV isn't configured yet, return empty stats gracefully
    if (err.message?.includes("UPSTASH") || err.message?.includes("KV")) {
      return res.status(200).json({
        stats: {},
        pendingPicks: 0,
        note: "KV store not configured yet. Add Vercel KV to enable tracking.",
      });
    }
    console.error("Stats error:", err);
    return res.status(500).json({ error: err.message });
  }
}
