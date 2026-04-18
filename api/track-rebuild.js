// One-shot: rebuild stats:{strategy} hashes from source-of-truth pick:* records.
// Safe to run repeatedly — it recomputes totals from scratch each time.
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
      return res.status(200).json({ scanned: 0, resolved: 0, stats: {}, note: "REDIS_URL not configured" });
    }

    client = createClient({ url: process.env.REDIS_URL });
    await client.connect();

    const agg = {};
    const rawCounts = {}; // { strategy: { pending, resolved, expired, other } }
    const ensure = (s) => {
      if (!agg[s]) agg[s] = { wins: 0, losses: 0, pushes: 0, total: 0, units: 0 };
      if (!rawCounts[s]) rawCounts[s] = { pending: 0, resolved: 0, expired: 0, other: 0 };
    };

    let scanned = 0;
    let resolved = 0;

    // node-redis v5 scanIterator yields arrays of keys per batch
    for await (const batch of client.scanIterator({ MATCH: "pick:*", COUNT: 500 })) {
      const keys = Array.isArray(batch) ? batch : [batch];
      scanned += keys.length;

      for (const key of keys) {
        const pick = await client.hGetAll(key);
        if (!pick || !pick.strategy) continue;
        const strat = pick.strategy;
        ensure(strat);

        // Track raw lifecycle counts so we can see if a strategy's picks
        // are being saved but never resolving (e.g., team-match failures).
        if (pick.resolved !== "true") {
          rawCounts[strat].pending += 1;
        } else if (pick.result === "expired") {
          rawCounts[strat].expired += 1;
        } else if (["win", "loss", "push"].includes(pick.result)) {
          rawCounts[strat].resolved += 1;
          agg[strat].total += 1;
          if (pick.result === "win") {
            agg[strat].wins += 1;
            agg[strat].units += unitsOnWin(pick.odds);
          } else if (pick.result === "loss") {
            agg[strat].losses += 1;
            agg[strat].units -= 1;
          } else {
            agg[strat].pushes += 1;
          }
          resolved += 1;
        } else {
          rawCounts[strat].other += 1;
        }
      }
    }

    const strategies = Object.keys(agg);

    // Overwrite stats hashes
    for (const s of strategies) {
      const k = `stats:${s}`;
      await client.del(k);
      const a = agg[s];
      if (a.total > 0) {
        await client.hSet(k, {
          wins: String(a.wins),
          losses: String(a.losses),
          pushes: String(a.pushes),
          total: String(a.total),
          units: a.units.toFixed(4),
        });
      }
    }

    return res.status(200).json({
      scanned,
      resolved,
      stats: agg,
    });
  } catch (err) {
    console.error("Rebuild error:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (client) await client.disconnect().catch(() => {});
  }
}
