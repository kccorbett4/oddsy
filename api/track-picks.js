// Returns all resolved picks (settled as win/loss/push). Front-end uses
// this to filter by strategy + time period and to show per-pick history
// in the Track Record drill-down.
import { createClient } from "redis";

function unitsOnWin(oddsStr) {
  const odds = parseFloat(oddsStr);
  if (!Number.isFinite(odds) || odds === 0) return 0;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

export default async function handler(req, res) {
  let client;
  try {
    if (!process.env.REDIS_URL) {
      return res.status(200).json({ picks: [], note: "REDIS_URL not configured" });
    }

    client = createClient({ url: process.env.REDIS_URL });
    await client.connect();

    const picks = [];
    let scanned = 0;

    for await (const batch of client.scanIterator({ MATCH: "pick:*", COUNT: 500 })) {
      const keys = Array.isArray(batch) ? batch : [batch];
      scanned += keys.length;

      for (const key of keys) {
        const p = await client.hGetAll(key);
        if (!p || p.resolved !== "true") continue;
        if (!["win", "loss", "push"].includes(p.result)) continue;

        // Prefer stored unitProfit; fall back to computing from odds
        // so picks resolved before unitProfit tracking was added still
        // show correct units in the UI.
        let unitProfit;
        if (p.unitProfit !== undefined && p.unitProfit !== "") {
          unitProfit = parseFloat(p.unitProfit);
        } else if (p.result === "win") {
          unitProfit = unitsOnWin(p.odds);
        } else if (p.result === "loss") {
          unitProfit = -1;
        } else {
          unitProfit = 0;
        }

        picks.push({
          id: key.slice(5), // strip "pick:" prefix
          strategy: p.strategy,
          gameId: p.gameId,
          homeTeam: p.homeTeam,
          awayTeam: p.awayTeam,
          sportKey: p.sportKey,
          commenceTime: p.commenceTime,
          marketType: p.marketType,
          outcome: p.outcome,
          point: p.point === "" ? null : parseFloat(p.point),
          odds: p.odds,
          book: p.book,
          result: p.result,
          unitProfit,
          finalHome: p.finalHome ? parseInt(p.finalHome) : null,
          finalAway: p.finalAway ? parseInt(p.finalAway) : null,
          resolvedAt: p.resolvedAt,
          date: p.date,
        });
      }
    }

    // Newest first by commenceTime (or resolvedAt fallback)
    picks.sort((a, b) => {
      const ta = new Date(a.commenceTime || a.resolvedAt || 0).getTime();
      const tb = new Date(b.commenceTime || b.resolvedAt || 0).getTime();
      return tb - ta;
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    return res.status(200).json({ picks, scanned });
  } catch (err) {
    return res.status(200).json({ picks: [], error: err.message });
  } finally {
    if (client) await client.disconnect().catch(() => {});
  }
}
