// Frontend POSTs current picks from each strategy.
import { createClient } from "redis";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  let client;
  try {
    if (!process.env.REDIS_URL) {
      return res.status(200).json({ saved: 0, note: "REDIS_URL not configured" });
    }

    client = createClient({ url: process.env.REDIS_URL });
    await client.connect();

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
        leg2Outcome,
        leg2Point,
        leg2MarketType,
      } = pick;

      if (!strategy || !gameId || !outcome) continue;

      const pickId = `${strategy}:${gameId}:${outcome}:${point || ""}:${marketType}`;

      // Don't save duplicate picks for the same game/outcome
      const exists = await client.hGet(`pick:${pickId}`, "strategy");
      if (exists) continue;

      await client.hSet(`pick:${pickId}`, {
        strategy,
        gameId,
        homeTeam: homeTeam || "",
        awayTeam: awayTeam || "",
        sportKey: sportKey || "",
        commenceTime: commenceTime || "",
        marketType: marketType || "",
        outcome,
        point: point ?? "",
        odds: String(odds || ""),
        book: book || "",
        leg2Outcome: leg2Outcome || "",
        leg2Point: leg2Point ?? "",
        leg2MarketType: leg2MarketType || "",
        savedAt: new Date().toISOString(),
        date: today,
        resolved: "false",
        result: "",
      });

      // Add to pending set (scored by commence time for easy retrieval)
      await client.zAdd("pending_picks", {
        score: new Date(commenceTime).getTime(),
        value: pickId,
      });

      saved++;
    }

    return res.status(200).json({ saved, total: picks.length });
  } catch (err) {
    console.error("Save error:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (client) await client.disconnect().catch(() => {});
  }
}
