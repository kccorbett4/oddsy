// Frontend POSTs current picks from each strategy.
// If the request carries a Supabase Bearer token, picks for `custom_*`
// strategies get tagged with the user's id so the resolver can score them
// into per-user Redis keys.
import { createClient } from "redis";
import { getUserIdFromRequest } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  let client;
  try {
    if (!process.env.REDIS_URL) {
      return res.status(200).json({ saved: 0, note: "REDIS_URL not configured" });
    }

    const userId = await getUserIdFromRequest(req);

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
        strategy,
        gameId,
        homeTeam,
        awayTeam,
        sportKey,
        commenceTime,
        marketType,
        outcome,
        point,
        odds,
        book,
        leg2Outcome,
        leg2Point,
        leg2MarketType,
      } = pick;

      if (!strategy || !gameId || !outcome) continue;

      const isCustom = typeof strategy === "string" && strategy.startsWith("custom_");
      // Skip unauthenticated attempts to save custom-strategy picks — those
      // must be tied to a user so the stats don't pool globally.
      if (isCustom && !userId) continue;

      // Per-user pick id prefix so two users who happen to pick the same side
      // of the same game don't collide (only for custom strategies).
      const pickPrefix = isCustom ? `u:${userId}:` : "";
      const pickId = `${pickPrefix}${strategy}:${gameId}:${outcome}:${point || ""}:${marketType}`;

      const exists = await client.hGet(`pick:${pickId}`, "strategy");
      if (exists) continue;

      await client.hSet(`pick:${pickId}`, {
        strategy,
        userId: isCustom ? userId : "",
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
