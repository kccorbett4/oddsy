import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { rankHrProjections, buildRecommendedParlays } from "./hrModel";
import SiteNav from "./SiteNav.jsx";

const formatOdds = (p) => (p > 0 ? `+${p}` : `${p}`);
const formatPct = (p, d = 1) => `${(p * 100).toFixed(d)}%`;

const formatTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

export default function HrParlaysPage() {
  const navigate = useNavigate();
  const [ctx, setCtx] = useState(null);
  const [odds, setOdds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [maxOdds, setMaxOdds] = useState(1000);
  const [legsSizes, setLegsSizes] = useState([2, 3, 4]);

  const loadData = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const [c, o] = await Promise.all([
        fetch(`/api/hr?action=context${force ? "&force=1" : ""}`).then(r => r.json()),
        fetch(`/api/hr?action=odds${force ? "&force=1" : ""}`).then(r => r.json()),
      ]);
      if (c?.error) throw new Error(`context: ${c.error}`);
      if (o?.error) throw new Error(`odds: ${o.error}`);
      setCtx(c);
      setOdds(o);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadData(false); }, []);

  const projections = useMemo(() => {
    if (!ctx || !odds) return [];
    return rankHrProjections(ctx, odds);
  }, [ctx, odds]);

  const recommended = useMemo(
    () => buildRecommendedParlays(projections, { maxAmerican: maxOdds, legsSizes }),
    [projections, maxOdds, legsSizes]
  );

  const toggleSize = (n) => {
    setLegsSizes(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n].sort());
  };

  const sendToBuilder = (legs) => {
    try {
      sessionStorage.setItem("hrParlayPreload", JSON.stringify(legs));
    } catch {}
    navigate("/homeruns");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#1a1d23" }}>
      <Helmet>
        <title>HR Parlay Recommendations — Auto-Built +EV Combos | MyOddsy</title>
        <meta name="description" content="Auto-generated home run parlay recommendations — safer 2-leggers, value combos, and swing bets. All legs priced ≤ +1000 by default, with positive modeled EV." />
        <link rel="canonical" href="https://www.myoddsy.com/homeruns/parlays" />
      </Helmet>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      <SiteNav />

      <header style={{
        background: "linear-gradient(135deg, #1e1b4b 0%, #4c1d95 100%)",
        color: "#fff", padding: "26px 20px 20px",
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#c4b5fd" }}>
            <Link to="/homeruns" style={{ color: "#c4b5fd", textDecoration: "none" }}>Home Run Hunter</Link>
            <span style={{ color: "#6b5ca8" }}>/</span>
            <span style={{ color: "#fff", fontWeight: 700 }}>Parlays</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: "10px 0 6px" }}>🎰 HR Parlay Recommendations</h1>
          <p style={{ fontSize: 13, color: "#e9d5ff", margin: "0 0 8px", lineHeight: 1.55, maxWidth: 780 }}>
            Auto-generated home run parlays built from today's top +EV legs. Every combo is
            constrained to non-correlated legs (no two from the same game), priced at or below
            your odds cap, and carrying positive modeled EV after multiplying through.
            Use these as starting points, not gospel — tap "Send to HR Hunter" to open any
            combo in the manual builder and swap legs to taste.
          </p>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 14px 110px" }}>
        {/* Controls */}
        <div style={{
          background: "#fff", border: "1px solid #e2e5ea", borderRadius: 12,
          padding: "12px 14px", marginBottom: 14,
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14,
        }}>
          <label style={{ fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            Max leg odds:
            <select value={maxOdds} onChange={e => setMaxOdds(parseInt(e.target.value))} style={selectStyle}>
              <option value={500}>+500</option>
              <option value={750}>+750</option>
              <option value={1000}>+1000</option>
              <option value={1500}>+1500</option>
              <option value={9999}>no cap</option>
            </select>
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Legs:</span>
            {[2, 3, 4].map(n => (
              <button
                key={n}
                onClick={() => toggleSize(n)}
                style={{
                  padding: "6px 10px", borderRadius: 6,
                  border: `1px solid ${legsSizes.includes(n) ? "#4c1d95" : "#cbd5e1"}`,
                  background: legsSizes.includes(n) ? "#4c1d95" : "#fff",
                  color: legsSizes.includes(n) ? "#fff" : "#4a5568",
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {n}-leg
              </button>
            ))}
          </div>

          <button
            onClick={() => { setRefreshing(true); loadData(true); }}
            disabled={refreshing}
            style={{
              marginLeft: "auto", padding: "7px 12px", borderRadius: 8,
              border: "1px solid #4c1d95", background: "#fff", color: "#4c1d95",
              fontSize: 12, fontWeight: 700, cursor: refreshing ? "wait" : "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>

        {error && (
          <div style={{ background: "#fee2e2", color: "#991b1b", padding: 12, borderRadius: 10, marginBottom: 14, fontSize: 12 }}>
            Failed to load: {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#8b919a", fontSize: 13 }}>
            Building parlays…
          </div>
        ) : recommended.length === 0 ? (
          <div style={{
            background: "#fff", border: "1px solid #e2e5ea", borderRadius: 12,
            padding: 30, textAlign: "center", color: "#64748b", fontSize: 13,
          }}>
            No +EV parlays fit the current filters. Try raising the odds cap or widening the leg count.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            {recommended.map((r, i) => (
              <div key={i} style={{
                background: "#fff", border: "1px solid #e2e5ea", borderRadius: 14,
                padding: "14px 16px", boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1a1d23" }}>{r.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "'Space Mono', monospace", color: "#0d9f4f" }}>
                    {formatOdds(r.american)}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#8b919a" }}>{r.subtitle}</div>
                  <div style={{
                    fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 12,
                    background: "#ede9fe", color: "#5b21b6", textTransform: "uppercase", letterSpacing: "0.06em",
                  }}>
                    @ {r.book}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                  {r.legs.map(l => (
                    <div key={`${l.batterId}|${l.game.home}|${l.game.away}`} style={{
                      display: "flex", justifyContent: "space-between", gap: 10,
                      padding: "6px 8px", background: "#f8fafc", borderRadius: 6,
                    }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1d23", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {l.name}
                          {l.lineupOrder && (
                            <span style={{ fontSize: 9, color: "#6b7280", background: "#e2e8f0", padding: "1px 5px", borderRadius: 3, fontWeight: 700, marginLeft: 6 }}>
                              #{l.lineupOrder}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
                          {l.team} vs {l.opponent}{l.game.commence ? ` · ${formatTime(l.game.commence)}` : ""}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 12, fontWeight: 800, fontFamily: "'Space Mono', monospace", color: "#0d9f4f" }}>
                          {formatOdds(l.bestAmerican)}
                        </div>
                        <div style={{ fontSize: 9, color: "#64748b" }}>at {r.book}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
                  padding: "8px 0", borderTop: "1px solid #f1f5f9", marginBottom: 10,
                }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Model hit</div>
                    <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Space Mono', monospace" }}>
                      {formatPct(r.prob, 1)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 9, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Model EV</div>
                    <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Space Mono', monospace", color: r.ev >= 0 ? "#0d9f4f" : "#dc2626" }}>
                      {r.ev >= 0 ? "+" : ""}{r.ev.toFixed(1)}%
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => sendToBuilder(r.legs)}
                  style={{
                    padding: "9px 14px", borderRadius: 8,
                    border: "1px solid #4c1d95", background: "#4c1d95", color: "#fff",
                    fontSize: 12, fontWeight: 800, cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Send to HR Hunter →
                </button>
              </div>
            ))}
          </div>
        )}

        {!loading && recommended.length > 0 && (
          <div style={{ marginTop: 18, padding: 12, background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 10, fontSize: 12, color: "#3730a3", lineHeight: 1.55 }}>
            <strong>How these get built:</strong> we take the top +EV singles priced at ≤ {maxOdds === 9999 ? "any odds" : `+${maxOdds}`},
            enumerate all non-correlated combinations (no two legs from the same game), keep only
            combos where a <em>single sportsbook</em> actually prices every leg (so the parlay is
            placeable — no cross-book stitching), filter to combos that multiply to positive
            modeled EV at that book, and surface the best of each size — highest hit rate for the
            "safer" slot, best edge for "value" and "swing."
            The model itself blends season Statcast, pitcher matchup, park factors, and live
            weather — see the <Link to="/homeruns" style={{ color: "#3730a3", fontWeight: 700 }}>HR Hunter page</Link> for per-leg diagnostics.
          </div>
        )}
      </div>
    </div>
  );
}

const selectStyle = {
  padding: "6px 10px", borderRadius: 6, border: "1px solid #e2e5ea",
  background: "#fff", fontSize: 12, fontFamily: "'DM Sans', sans-serif",
  fontWeight: 600, color: "#1a1d23", cursor: "pointer",
};
