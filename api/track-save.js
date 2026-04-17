// Frontend POSTs current picks from each strategy.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    let kv;
    try {
      const mod = await import("@vercel/kv");
      kv = mod.kv;
    } catch {
      return res.status(200).json({ saved: 0, note: "KV not available" });
    }

    const { picks } = req.body;
    if (!picks || !Array.isArray(picks) || picks.length === 0) {
      return res.status(400).json({ error: "No picks provided" });
    }

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    let saved = 0;

    for (const pick of picks) {
      const {
        strategy,     // "sharp" | "value" | "stale" | "rlm" | "correlated" | "narrative"
        gameId,
        homeTeam,
        awayTeam,
        sportKey,
        commenceTime,
        marketType,   // "h2h" | "spreads" | "totals"
        outcome,      // team name or "Over"/"Under"
        point,        // spread/total number (null for h2h)
        odds,
        book,
        // For correlated parlays, include leg2
        leg2Outcome,
        leg2Point,
        leg2MarketType,
      } = pick;

      if (!strategy || !gameId || !outcome) continue;

      const pickId = `${strategy}:${gameId}:${outcome}:${point || ""}:${marketType}`;

      // Don't save duplicate picks for the same game/outcome
      const exists = await kv.hget(`pick:${pickId}`, "strategy");
      if (exists) continue;

      await kv.hset(`pick:${pickId}`, {
        strategy,
        gameId,
        homeTeam,
        awayTeam,
        sportKey,
        commenceTime,
        marketType,
        outcome,
        point: point ?? "",
        odds,
        book: book || "",
        leg2Outcome: leg2Outcome || "",
        leg2Point: leg2Point ?? "",
        leg2MarketType: leg2MarketType || "",
        savedAt: new Date().toISOString(),
        date: today,
        resolved: "false",
        result: "", // "win" | "loss" | "push" | ""
      });

      // Add to pending set (scored by commence time for easy retrieval)
      await kv.zadd("pending_picks", {
        score: new Date(commenceTime).getTime(),
        member: pickId,
      });

      saved++;
    }

    return res.status(200).json({ saved, total: picks.length });
  } catch (err) {
    console.error("Save error:", err);
    return res.status(500).json({ error: err.message });
  }
}
