// Returns performance stats for all strategies
export default async function handler(req, res) {
  try {
    let kv;
    try {
      const mod = await import("@vercel/kv");
      kv = mod.kv;
    } catch {
      return res.status(200).json({
        stats: {},
        pendingPicks: 0,
        note: "KV module not available",
      });
    }

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
        };
      } else {
        stats[strategy] = { wins: 0, losses: 0, pushes: 0, total: 0, winPct: null };
      }
    }

    const pendingCount = await kv.zcard("pending_picks");

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    return res.status(200).json({ stats, pendingPicks: pendingCount });
  } catch (err) {
    return res.status(200).json({
      stats: {},
      pendingPicks: 0,
      error: err.message,
    });
  }
}
