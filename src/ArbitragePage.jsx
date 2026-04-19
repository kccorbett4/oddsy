import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import SiteNav from "./SiteNav.jsx";

const formatOdds = (o) => (o > 0 ? `+${o}` : `${o}`);
const americanToDecimal = (a) => (a >= 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a));

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "Today";
  const tomorrow = new Date(now.getTime() + 86400000);
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

// Given a bankroll and two American odds, return the dollar split on each
// side that locks in equal profit regardless of outcome. Standard arb math:
// stake_a / stake_b = (decimal_b) / (decimal_a), where decimal is payout.
function splitBankroll(bankroll, oddsA, oddsB) {
  const da = americanToDecimal(oddsA);
  const db = americanToDecimal(oddsB);
  const invA = 1 / da;
  const invB = 1 / db;
  const sum = invA + invB;
  const stakeA = bankroll * (invA / sum);
  const stakeB = bankroll * (invB / sum);
  const payoutA = stakeA * da;
  const payoutB = stakeB * db;
  const worstPayout = Math.min(payoutA, payoutB);
  return {
    stakeA: +stakeA.toFixed(2),
    stakeB: +stakeB.toFixed(2),
    profit: +(worstPayout - bankroll).toFixed(2),
  };
}

export default function ArbitragePage() {
  const [opps, setOpps] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sport, setSport] = useState("");
  const [bankroll, setBankroll] = useState(100);

  const loadData = async (sportFilter = "") => {
    setLoading(true);
    setError(null);
    try {
      const q = sportFilter ? `?sport=${encodeURIComponent(sportFilter)}` : "";
      const r = await fetch(`/api/arbitrage${q}`).then(r => r.json());
      if (r?.error) throw new Error(r.error);
      setOpps(Array.isArray(r.opportunities) ? r.opportunities : []);
      setMeta({
        sportsQueried: r.sportsQueried,
        creditsRemaining: r.creditsRemaining,
        cachedAt: r.cachedAt,
        stale: r.stale,
        upstreamError: r.upstreamError,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(sport); }, [sport]);

  const sportOptions = useMemo(() => {
    const s = new Set(opps.map(o => o.sport).filter(Boolean));
    return [...s].sort();
  }, [opps]);

  const sorted = useMemo(
    () => [...opps].sort((a, b) => (b.profit_pct || 0) - (a.profit_pct || 0)),
    [opps]
  );

  const sportLabel = (k) => ({
    baseball_mlb: "MLB",
    basketball_nba: "NBA",
    basketball_ncaab: "NCAAB",
    americanfootball_nfl: "NFL",
    americanfootball_ncaaf: "NCAAF",
    icehockey_nhl: "NHL",
    soccer_usa_mls: "MLS",
    mma_mixed_martial_arts: "MMA",
    boxing_boxing: "Boxing",
    tennis_atp: "ATP",
    tennis_wta: "WTA",
  }[k] || k);

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8", fontFamily: "system-ui, -apple-system, sans-serif", paddingBottom: 100 }}>
      <Helmet>
        <title>Arbitrage Opportunities — MyOddsy</title>
        <meta name="description" content="Guaranteed-profit arbitrage opportunities across US sportsbooks. Live stakes split to lock in risk-free returns." />
      </Helmet>

      <SiteNav />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>

      <h1 style={{ fontSize: 28, margin: "0 0 6px 0" }}>Arbitrage Opportunities</h1>
      <p style={{ margin: "0 0 20px 0", color: "#555", fontSize: 14, lineHeight: 1.5 }}>
        Each row is a bet that returns guaranteed profit when you stake both sides at the recommended
        split. Lines move fast — opportunities are live for seconds to minutes.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 20, padding: 12, background: "#f7f8fa", borderRadius: 8 }}>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          Sport:
          <select
            value={sport}
            onChange={e => setSport(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d5d8de", fontSize: 13 }}
          >
            <option value="">All sports in season</option>
            <option value="baseball_mlb">MLB</option>
            <option value="basketball_nba">NBA</option>
            <option value="basketball_ncaab">NCAAB</option>
            <option value="americanfootball_nfl">NFL</option>
            <option value="americanfootball_ncaaf">NCAAF</option>
            <option value="icehockey_nhl">NHL</option>
            <option value="soccer_usa_mls">MLS</option>
            <option value="mma_mixed_martial_arts">MMA</option>
            <option value="boxing_boxing">Boxing</option>
            <option value="tennis_atp">Tennis (ATP)</option>
            <option value="tennis_wta">Tennis (WTA)</option>
          </select>
        </label>

        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          Bankroll:
          <span style={{ color: "#888" }}>$</span>
          <input
            type="number"
            min="10"
            step="10"
            value={bankroll}
            onChange={e => setBankroll(Math.max(1, Number(e.target.value) || 0))}
            style={{ width: 80, padding: "6px 8px", borderRadius: 6, border: "1px solid #d5d8de", fontSize: 13 }}
          />
        </label>

      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: "#666" }}>Loading opportunities…</div>}
      {error && <div style={{ padding: 16, background: "#ffe9e9", color: "#a00", borderRadius: 8 }}>Error: {error}</div>}

      {!loading && meta?.upstreamError && (
        <div style={{
          padding: "12px 14px", background: "#fef3c7", border: "1px solid #fcd34d",
          color: "#92400e", borderRadius: 8, fontSize: 13, marginBottom: 12,
        }}>
          <b>⚠ {meta.stale ? "Showing cached data" : "Odds provider unavailable"}</b> — {meta.upstreamError}
        </div>
      )}

      {!loading && !error && sorted.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "#888" }}>
          No arbitrage opportunities right now. Lines move constantly — check back in a minute.
          {sportOptions.length > 0 && sport === "" && <div style={{ fontSize: 12, marginTop: 8 }}>Sports queried: {(meta?.sportsQueried || []).map(sportLabel).join(", ")}</div>}
        </div>
      )}

      {!loading && sorted.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sorted.map((o, i) => {
            const split = splitBankroll(bankroll, o.side_a?.odds, o.side_b?.odds);
            return (
              <div key={`${o.canonical_event_id}-${o.market_key}-${i}`} style={{
                border: "1px solid #e2e4e8", borderRadius: 10, padding: 16, background: "#fff",
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                      {sportLabel(o.sport)} · {formatDate(o.game_date)}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>
                      {o.away_team} @ {o.home_team}
                    </div>
                    <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>
                      {o.market}{o.player && o.player !== `${o.away_team} @ ${o.home_team}` ? ` — ${o.player}` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "#1f8f4e" }}>
                      +{(o.profit_pct || 0).toFixed(2)}%
                    </div>
                    <div style={{ fontSize: 11, color: "#888" }}>profit on ${bankroll.toFixed(0)}: ${split.profit.toFixed(2)}</div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <SideCard side={o.side_a} stake={split.stakeA} />
                  <SideCard side={o.side_b} stake={split.stakeB} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {meta && (
        <div style={{ marginTop: 24, fontSize: 11, color: "#999", textAlign: "center" }}>
          Updated {meta.cachedAt ? new Date(meta.cachedAt).toLocaleTimeString() : "—"} · {meta.creditsRemaining ? `${meta.creditsRemaining} credits remaining` : ""}
        </div>
      )}
      </div>
    </div>
  );
}

function SideCard({ side, stake }) {
  if (!side) return <div />;
  return (
    <div style={{ padding: 10, border: "1px solid #ecedef", borderRadius: 8, background: "#fafbfc" }}>
      <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {side.bookmaker}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 2 }}>
        <div style={{ fontSize: 15, fontWeight: 600, textTransform: "capitalize" }}>{side.bet}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#1a73e8" }}>{formatOdds(side.odds)}</div>
      </div>
      <div style={{ marginTop: 6, fontSize: 13, color: "#444" }}>
        Stake <strong>${stake.toFixed(2)}</strong>
      </div>
    </div>
  );
}
