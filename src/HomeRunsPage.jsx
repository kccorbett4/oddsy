import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { rankHrProjections, americanToDecimal, decimalToAmerican } from "./hrModel";
import StadiumWindSvg from "./StadiumWindSvg";
import SiteNav from "./SiteNav.jsx";

const formatOdds = (p) => (p > 0 ? `+${p}` : `${p}`);
const formatPct = (p, d = 1) => `${(p * 100).toFixed(d)}%`;

const formatTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const opts = sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { weekday: "short", hour: "numeric", minute: "2-digit" };
  return d.toLocaleTimeString("en-US", opts);
};

// Wind cardinal label relative to CF ("toward CF" / "crosswind" / "in from CF")
function windLabel(windDirDeg, windMph, cfBearing) {
  if (windDirDeg == null || windMph == null || cfBearing == null) return null;
  const blowingToward = (windDirDeg + 180) % 360;
  const diff = ((blowingToward - cfBearing + 540) % 360) - 180;
  const abs = Math.abs(diff);
  if (windMph < 3) return "calm";
  if (abs < 45) return `${windMph.toFixed(0)} mph → CF (tailwind)`;
  if (abs > 135) return `${windMph.toFixed(0)} mph ← CF (headwind)`;
  return `${windMph.toFixed(0)} mph crosswind`;
}

export default function HomeRunsPage() {
  const [ctx, setCtx] = useState(null);
  const [odds, setOdds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [book, setBook] = useState("any");
  const [minEdge, setMinEdge] = useState(0); // % EV floor
  const [sortMode, setSortMode] = useState("ev"); // ev | prob | payout
  const [expanded, setExpanded] = useState(null); // batterId|name key
  const [bvp, setBvp] = useState({}); // key -> result
  const [parlayLegs, setParlayLegs] = useState([]);
  const [wager, setWager] = useState(10);
  const [refreshing, setRefreshing] = useState(false);
  const [roi, setRoi] = useState(null);

  // HR-specific ROI banner. Only counts picks saved under HR strategy keys —
  // pulling site-wide stats here is misleading since spread/moneyline picks
  // have nothing to do with home-run performance.
  useEffect(() => {
    fetch("/api/track-stats")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.stats) return;
        const isHrKey = (name) => /^(hr|homerun|homeruns|home_run)(_|$)/i.test(name);
        let wins = 0, losses = 0, pushes = 0, total = 0, units = 0;
        for (const [name, s] of Object.entries(data.stats)) {
          if (!isHrKey(name)) continue;
          wins += s.wins || 0;
          losses += s.losses || 0;
          pushes += s.pushes || 0;
          total += s.total || 0;
          units += Number(s.units || 0);
        }
        if (total === 0) return;
        setRoi({
          wins, losses, pushes, total,
          units: +units.toFixed(2),
          roi: total > 0 ? +((units / total) * 100).toFixed(1) : null,
        });
      })
      .catch(() => {});
  }, []);

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

  // Daily auto-track of v1's top HR picks. Sends the top 5 by EV under
  // strategy hr_v1_top so the resolver can settle them and we can finally
  // measure v1 against v2 head-to-head. Throttled to one save per day per
  // session via sessionStorage so a refresh doesn't double-save.
  useEffect(() => {
    if (!ctx || !odds || projections.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const sentKey = `hrV1Sent:${today}`;
    if (sessionStorage.getItem(sentKey) === "1") return;
    const top = [...projections]
      .filter(p => p?.bestAmerican && p?.evPct > 0)
      .sort((a, b) => b.evPct - a.evPct)
      .slice(0, 5);
    if (top.length === 0) return;
    const picks = top.map(p => {
      const game = ctx.games.find(g => g.home === p.game.home && g.away === p.game.away);
      return {
        strategy: "hr_v1_top",
        gameId: game?.gameId || `${p.game.home}@${p.game.away}@${p.game.commence}`,
        homeTeam: p.game.home,
        awayTeam: p.game.away,
        sportKey: "baseball_mlb",
        commenceTime: p.game.commence,
        marketType: "batter_home_runs",
        outcome: p.name,
        point: 0.5,
        odds: p.bestAmerican,
        book: p.bestBook || "",
      };
    });
    fetch("/api/track-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picks }),
    }).then(() => {
      try { sessionStorage.setItem(sentKey, "1"); } catch {}
    }).catch(() => {});
  }, [ctx, odds, projections]);

  const allBooks = useMemo(() => {
    const s = new Set();
    for (const p of projections) {
      for (const b of Object.keys(p.byBook || {})) s.add(b);
    }
    return [...s].sort();
  }, [projections]);

  // Hydrate parlay legs from the /homeruns/parlays page handoff. Runs
  // once per mount; the preload is cleared so a later visit starts fresh.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("hrParlayPreload");
      if (raw) {
        const legs = JSON.parse(raw);
        if (Array.isArray(legs) && legs.length > 0) setParlayLegs(legs);
        sessionStorage.removeItem("hrParlayPreload");
      }
    } catch {}
  }, []);

  const filtered = useMemo(() => {
    let rows = projections;
    if (book !== "any") {
      rows = rows.filter(r => r.byBook[book]).map(r => {
        const b = r.byBook[book];
        const impl = 1 / b.overDecimal;
        return {
          ...r,
          bestBook: b.book,
          bestAmerican: b.overAmerican,
          bestDecimal: b.overDecimal,
          booksImplied: impl,
          edgePct: (r.modelProb - impl) * 100,
          evPct: (r.modelProb * (b.overDecimal - 1) - (1 - r.modelProb)) * 100,
        };
      });
    }
    rows = rows.filter(r => r.evPct >= minEdge);
    if (sortMode === "prob") rows.sort((a, b) => b.modelProb - a.modelProb);
    else if (sortMode === "payout") rows.sort((a, b) => b.bestAmerican - a.bestAmerican);
    else rows.sort((a, b) => b.evPct - a.evPct);
    return rows;
  }, [projections, book, minEdge, sortMode]);

  const legKey = (l) => `${l.batterId}|${l.game.home}|${l.game.away}`;
  const inParlay = (p) => parlayLegs.some(l => legKey(l) === legKey(p));
  const toggleLeg = (p) => {
    setParlayLegs(prev => {
      if (prev.some(l => legKey(l) === legKey(p))) return prev.filter(l => legKey(l) !== legKey(p));
      return [...prev, p];
    });
  };

  const parlay = useMemo(() => {
    if (parlayLegs.length < 2) return null;
    // Combined probability assumes independence — we warn if any legs
    // share a game (correlated).
    const combinedProb = parlayLegs.reduce((acc, l) => acc * l.modelProb, 1);
    // Combined decimal per-book: only books that offer all legs can
    // price the parlay. For "any" mode, use each leg's best book but
    // multiply — that's the theoretical max if you can stitch across.
    let singleDecimal = parlayLegs.reduce((acc, l) => acc * l.bestDecimal, 1);
    const fairDecimal = 1 / combinedProb;
    const ev = (combinedProb * (singleDecimal - 1) - (1 - combinedProb)) * 100;
    const gameIds = parlayLegs.map(l => `${l.game.home}@${l.game.away}`);
    const sameGame = new Set(gameIds).size !== gameIds.length;

    // Per-book parlay price (only books that offer every leg).
    const bookMap = {};
    for (const l of parlayLegs) {
      for (const [bName, b] of Object.entries(l.byBook || {})) {
        if (!bookMap[bName]) bookMap[bName] = { book: bName, decimal: 1, count: 0 };
        bookMap[bName].decimal *= b.overDecimal;
        bookMap[bName].count += 1;
      }
    }
    const bookCompare = Object.values(bookMap)
      .filter(b => b.count === parlayLegs.length)
      .map(b => ({ ...b, american: decimalToAmerican(b.decimal) }))
      .sort((a, b) => b.decimal - a.decimal);

    const expectedPayout = wager * (singleDecimal - 1);
    return {
      combinedProb,
      singleDecimal,
      singleAmerican: decimalToAmerican(singleDecimal),
      fairDecimal,
      fairAmerican: decimalToAmerican(fairDecimal),
      ev,
      sameGame,
      bookCompare,
      expectedPayout,
    };
  }, [parlayLegs, wager]);

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#1a1d23" }}>
      <Helmet>
        <title>Home Run Hunter — Modeled HR Props | MyOddsy</title>
        <meta name="description" content="Top home run prop bets ranked by edge. Combines season Statcast, pitcher matchups, park factors, and live weather to find where books are mispriced." />
        <link rel="canonical" href="https://www.myoddsy.com/homeruns" />
      </Helmet>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      <SiteNav />

      <header style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        color: "#fff", padding: "26px 20px 20px",
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
            <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>💣 Home Run Hunter</h1>
            <Link to="/homeruns/v2" style={{
              padding: "5px 10px", borderRadius: 999,
              background: "#fbbf24", color: "#451a03",
              textDecoration: "none", fontSize: 11, fontWeight: 800,
              letterSpacing: "0.04em",
            }}>Try v2.0 (BETA) →</Link>
          </div>
          <p style={{ fontSize: 13, color: "#cbd5e1", margin: "0 0 12px", lineHeight: 1.55, maxWidth: 780 }}>
            Every MLB HR prop on the board, ranked by our edge against the best book price.
            Projections blend season Statcast, pitcher matchup quality, ballpark effects, and live
            weather — built from live wind direction, temperature, humidity, pressure, and precip
            at the actual ballpark at first pitch.
          </p>
          <details style={{ fontSize: 12, color: "#cbd5e1", cursor: "pointer" }}>
            <summary style={{ fontWeight: 700, color: "#fbbf24", listStyle: "revert" }}>
              How the model works (general)
            </summary>
            <div style={{ marginTop: 8, lineHeight: 1.65, color: "#cbd5e1" }}>
              We start with a batter's underlying power signal — the combination of their season
              HR rate and the Statcast contact-quality metrics (barrel rate, expected slugging)
              that are far more predictive than short-term HR totals. We then adjust for the specific
              pitcher they face (how many barrels the pitcher surrenders, HR/9 history, and
              handedness splits when the sample supports it), the ballpark's 3-year HR factor,
              and the live weather conditions at the park — wind projected onto the center-field
              axis, temperature effect on batted-ball carry, humidity, pressure, and rain.
              Finally we scale to expected plate appearances based on the confirmed lineup slot.
              The model's per-PA probability gets compounded over expected PAs into a game-level
              HR probability, which we compare against the best book's implied probability to
              find edges. Projections refresh every 30 min; odds every ~6 hours.
            </div>
          </details>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 14px 120px" }}>
        {roi && <RoiBanner roi={roi} />}
        {/* Controls */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14, alignItems: "center" }}>
          <select value={book} onChange={e => setBook(e.target.value)} style={selectStyle}>
            <option value="any">Best line (any book)</option>
            {allBooks.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={sortMode} onChange={e => setSortMode(e.target.value)} style={selectStyle}>
            <option value="ev">Sort: Best EV</option>
            <option value="prob">Sort: Highest HR probability</option>
            <option value="payout">Sort: Biggest payout</option>
          </select>
          <label style={{ fontSize: 12, color: "#4a5568", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            Min EV:
            <select value={minEdge} onChange={e => setMinEdge(parseFloat(e.target.value))} style={{ ...selectStyle, padding: "6px 8px" }}>
              <option value={-999}>any</option>
              <option value={0}>0%</option>
              <option value={3}>+3%</option>
              <option value={5}>+5%</option>
              <option value={10}>+10%</option>
            </select>
          </label>
          <Link
            to="/homeruns/parlays"
            style={{
              marginLeft: "auto", padding: "7px 12px", borderRadius: 8,
              border: "1px solid #4c1d95", background: "#4c1d95", color: "#fff",
              fontSize: 12, fontWeight: 700, textDecoration: "none",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            🎰 Recommended parlays →
          </Link>
        </div>

        {/* Summary */}
        {ctx && odds && !loading && (
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 10 }}>
            {filtered.length} picks shown · {projections.length} total props priced ·
            {" "}{odds.eventCount} games · odds updated {new Date(odds.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </div>
        )}

        {error && (
          <div style={{ background: "#fee2e2", color: "#991b1b", padding: 12, borderRadius: 10, marginBottom: 14, fontSize: 12 }}>
            Failed to load: {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#8b919a", fontSize: 13 }}>
            Loading projections…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#8b919a", fontSize: 13 }}>
            No props match your filter. Try lowering the min EV or switching books.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((p, idx) => {
              const key = `${p.batterId}|${p.game.home}|${p.game.away}`;
              const isExpanded = expanded === key;
              return (
                <div key={key} style={{
                  background: "#fff", border: "1px solid #e2e5ea", borderRadius: 12,
                  padding: "12px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 15, fontWeight: 800 }}>{p.name}</div>
                        {p.lineupOrder && (
                          <div style={{ fontSize: 10, color: "#6b7280", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
                            #{p.lineupOrder}
                          </div>
                        )}
                        {p.evPct >= 5 && (
                          <div style={{ fontSize: 10, color: "#fff", background: "#10b981", padding: "2px 6px", borderRadius: 4, fontWeight: 800 }}>
                            +{p.evPct.toFixed(1)}% EV
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                        {p.team && p.opponent
                          ? `${p.team} vs ${p.opponent}`
                          : `${p.game.away} @ ${p.game.home}`}
                        {p.opposingPitcher?.name && <> · opp {p.opposingPitcher.name} ({p.opposingPitcher.pitchHand || "?"})</>}
                        {" · "}{formatTime(p.game.commence)}
                      </div>
                    </div>

                    <div style={{ textAlign: "right", minWidth: 90 }}>
                      <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "'Space Mono', monospace", color: "#0d9f4f" }}>
                        {formatOdds(p.bestAmerican)}
                      </div>
                      <div style={{ fontSize: 10, color: "#6b7280" }}>{p.bestBook}</div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10, padding: "8px 0", borderTop: "1px solid #f1f5f9" }}>
                    <Stat label="Model HR prob" value={formatPct(p.modelProb)} color="#1a1d23" />
                    <Stat label="Book implied" value={formatPct(p.booksImplied)} color="#6b7280" />
                    <Stat
                      label="Edge"
                      value={`${p.edgePct >= 0 ? "+" : ""}${p.edgePct.toFixed(1)} pts`}
                      color={p.evPct >= 3 ? "#0d9f4f" : p.evPct >= 0 ? "#6b7280" : "#dc2626"}
                    />
                  </div>

                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <button
                      onClick={() => setExpanded(isExpanded ? null : key)}
                      style={smallBtnStyle(isExpanded)}
                    >
                      {isExpanded ? "Hide details" : "Show details"}
                    </button>
                    <button
                      onClick={() => toggleLeg(p)}
                      style={{
                        ...smallBtnStyle(inParlay(p)),
                        background: inParlay(p) ? "#dc2626" : "#1a73e8",
                        color: "#fff",
                        borderColor: inParlay(p) ? "#dc2626" : "#1a73e8",
                        marginLeft: "auto",
                      }}
                    >
                      {inParlay(p) ? "− Remove from parlay" : "+ Add to parlay"}
                    </button>
                  </div>

                  {isExpanded && (
                    <DetailPanel
                      pick={p}
                      bvp={bvp}
                      onBvp={async () => {
                        const k = `${p.batterId}|${p.opposingPitcher?.playerId || "none"}`;
                        if (bvp[k] || !p.opposingPitcher?.playerId) return;
                        setBvp(prev => ({ ...prev, [k]: { loading: true } }));
                        try {
                          const r = await fetch(`/api/hr?action=bvp&batter=${p.batterId}&pitcher=${p.opposingPitcher.playerId}`).then(r => r.json());
                          setBvp(prev => ({ ...prev, [k]: r }));
                        } catch (e) {
                          setBvp(prev => ({ ...prev, [k]: { error: e.message } }));
                        }
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky parlay builder */}
      {parlayLegs.length > 0 && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: "#1a1d23", borderTop: "2px solid #0d9f4f",
          color: "#fff", padding: "12px 14px 14px",
          boxShadow: "0 -8px 24px rgba(0,0,0,0.2)", zIndex: 50,
          maxHeight: "60vh", overflowY: "auto",
        }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>
                🎰 HR Parlay · {parlayLegs.length} leg{parlayLegs.length === 1 ? "" : "s"}
              </div>
              <button onClick={() => setParlayLegs([])} style={{
                background: "transparent", border: "1px solid #475569",
                color: "#cbd5e1", padding: "4px 10px", borderRadius: 6, fontSize: 11,
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              }}>Clear</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
              {parlayLegs.map(l => (
                <div key={legKey(l)} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: "#2d3748", borderRadius: 6, padding: "6px 10px", fontSize: 12,
                }}>
                  <div>
                    <span style={{ fontWeight: 700 }}>{l.name}</span>
                    <span style={{ color: "#94a3b8", marginLeft: 6 }}>{formatPct(l.modelProb)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "'Space Mono', monospace", color: "#a7f3d0" }}>{formatOdds(l.bestAmerican)}</span>
                    <button onClick={() => toggleLeg(l)} style={{
                      background: "transparent", border: "none", color: "#94a3b8",
                      fontSize: 16, cursor: "pointer", lineHeight: 1,
                    }}>×</button>
                  </div>
                </div>
              ))}
            </div>

            {parlayLegs.length < 2 ? (
              <div style={{ fontSize: 12, color: "#cbd5e1", background: "#334155", padding: 8, borderRadius: 6 }}>
                Add at least one more leg to price the parlay.
              </div>
            ) : parlay && (
              <>
                {parlay.sameGame && (
                  <div style={{ background: "#7c2d12", border: "1px solid #c2410c", borderRadius: 6, padding: "6px 10px", fontSize: 11, color: "#fed7aa", marginBottom: 8 }}>
                    ⚠ Same-game legs — HR events are weakly correlated; treat the price with caution.
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Combined price</div>
                    <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "'Space Mono', monospace", color: "#0d9f4f" }}>
                      {formatOdds(parlay.singleAmerican)}
                    </div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>pays {(parlay.singleDecimal - 1).toFixed(2)}x stake</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Model hit %</div>
                    <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "'Space Mono', monospace", color: "#fff" }}>
                      {formatPct(parlay.combinedProb, 2)}
                    </div>
                    <div style={{ fontSize: 10, color: parlay.ev >= 0 ? "#6ee7b7" : "#fca5a5" }}>
                      {parlay.ev >= 0 ? "+" : ""}{parlay.ev.toFixed(1)}% EV
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "#cbd5e1", marginBottom: 8 }}>
                  <span>Wager:</span>
                  <input type="number" value={wager} onChange={e => setWager(parseFloat(e.target.value) || 0)}
                    style={{ width: 70, padding: "4px 8px", borderRadius: 4, border: "1px solid #475569", background: "#0f172a", color: "#fff", fontFamily: "'DM Sans', sans-serif" }}
                  />
                  <span style={{ color: "#a7f3d0" }}>→ pays ${parlay.expectedPayout.toFixed(2)} on win</span>
                </div>
                {parlay.bookCompare.length > 0 && (
                  <div style={{ background: "#0f172a", borderRadius: 6, padding: "8px 10px", fontSize: 11 }}>
                    <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 4 }}>
                      Books that offer every leg
                    </div>
                    {parlay.bookCompare.map((r, i) => (
                      <div key={r.book} style={{
                        display: "flex", justifyContent: "space-between", padding: "2px 0",
                        color: i === 0 ? "#6ee7b7" : "#e2e8f0", fontWeight: i === 0 ? 800 : 500,
                      }}>
                        <span>{i === 0 ? "🏆 " : ""}{r.book}</span>
                        <span style={{ fontFamily: "'Space Mono', monospace" }}>{formatOdds(r.american)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color, fontFamily: "'Space Mono', monospace" }}>{value}</div>
    </div>
  );
}

function DetailPanel({ pick, bvp, onBvp }) {
  const bvpKey = `${pick.batterId}|${pick.opposingPitcher?.playerId || "none"}`;
  const bvpData = bvp[bvpKey];
  useEffect(() => {
    if (!bvpData && pick.opposingPitcher?.playerId) onBvp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const w = pick.weather;
  const park = pick.game;
  return (
    <div style={{ marginTop: 10, padding: 10, background: "#f8fafc", borderRadius: 8, fontSize: 12, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 700, fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
        Inputs the model used
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        <Row label="Batter factor" value={`×${pick.inputs.batterFactor}`} />
        <Row label="Pitcher factor" value={`×${pick.inputs.pitcherFactor}`} />
        <Row label="Park factor" value={`×${pick.inputs.parkFactor}`} />
        <Row label="Weather factor" value={`×${pick.inputs.weatherFactor}`} />
        <Row label="Platoon factor" value={`×${pick.inputs.platoonFactor}`} />
        <Row label="Expected PAs" value={pick.inputs.expectedPA.toFixed(2)} />
      </div>

      {pick.savantB && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
            Batter Statcast (season)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <Row label="Barrel / PA" value={pick.savantB.barrelPerPA != null ? `${pick.savantB.barrelPerPA.toFixed(1)}%` : "—"} />
            <Row label="Hard hit %" value={pick.savantB.hardHitPct != null ? `${pick.savantB.hardHitPct.toFixed(1)}%` : "—"} />
            <Row label="xISO" value={pick.savantB.xiso != null ? pick.savantB.xiso.toFixed(3) : "—"} />
            <Row label="Avg exit velo" value={pick.savantB.avgEV != null ? `${pick.savantB.avgEV.toFixed(1)} mph` : "—"} />
          </div>
        </div>
      )}

      {pick.opposingPitcher && pick.savantP && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
            Pitcher allowed (Statcast, season)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <Row label="Barrels allowed/PA" value={pick.savantP.barrelPerPA != null ? `${pick.savantP.barrelPerPA.toFixed(1)}%` : "—"} />
            <Row label="Hard hit %" value={pick.savantP.hardHitPct != null ? `${pick.savantP.hardHitPct.toFixed(1)}%` : "—"} />
            <Row label="xSLG" value={pick.savantP.xslg != null ? pick.savantP.xslg.toFixed(3) : "—"} />
            <Row label="Avg exit velo" value={pick.savantP.avgEV != null ? `${pick.savantP.avgEV.toFixed(1)} mph` : "—"} />
          </div>
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
          Ballpark + wind
        </div>
        <StadiumWindSvg weather={w} park={pick.game.park} outdoor={pick.game.outdoor} />
        {w && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
            <Row label="Temp" value={w.tempF != null ? `${w.tempF.toFixed(0)}°F` : "—"} />
            <Row label="Humidity" value={w.humidityPct != null ? `${w.humidityPct.toFixed(0)}%` : "—"} />
            <Row label="Pressure" value={w.pressureHpa != null ? `${w.pressureHpa.toFixed(0)} hPa` : "—"} />
            <Row label="Precip" value={w.precipIn != null ? `${w.precipIn.toFixed(2)}"` : "—"} />
            <Row label="Precip chance" value={w.precipProb != null ? `${w.precipProb}%` : "—"} />
            <Row label="Park HR factor" value={pick.game.park?.hrFactor ? `×${pick.game.park.hrFactor}` : "—"} />
          </div>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
          Head-to-head history vs {pick.opposingPitcher?.name || "pitcher"}
        </div>
        {bvpData?.loading ? (
          <div style={{ color: "#94a3b8" }}>Loading career matchup…</div>
        ) : bvpData?.error ? (
          <div style={{ color: "#b45309" }}>Couldn't load BvP: {bvpData.error}</div>
        ) : bvpData && bvpData.pa !== undefined ? (
          bvpData.pa === 0 ? (
            <div style={{ color: "#94a3b8" }}>Never faced each other.</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
                <Row label="PA" value={bvpData.pa} />
                <Row label="HR" value={bvpData.hr} />
                <Row label="AVG" value={bvpData.avg.toFixed(3).replace(/^0/, "")} />
                <Row label="SLG" value={bvpData.slg.toFixed(3).replace(/^0/, "")} />
              </div>
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 4, fontStyle: "italic" }}>
                {bvpData.sampleNote}
              </div>
            </>
          )
        ) : (
          <div style={{ color: "#94a3b8" }}>—</div>
        )}
      </div>

      {/* Per-book prices for this player */}
      <div>
        <div style={{ fontWeight: 700, fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
          All books pricing this HR
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {Object.values(pick.byBook).sort((a, b) => b.overDecimal - a.overDecimal).map(b => {
            // Highlight every book tied at the highest decimal — e.g. if DK,
            // FanDuel, and Hard Rock all post +1300, all three are "best book"
            // and should read as green.
            const isBest = Math.abs(b.overDecimal - pick.bestDecimal) < 0.001;
            return (
              <div key={b.book} style={{
                fontSize: 11, padding: "4px 8px", borderRadius: 6,
                background: isBest ? "#d1fae5" : "#e2e8f0",
                color: isBest ? "#065f46" : "#1a1d23",
                fontWeight: isBest ? 800 : 600,
              }}>
                {b.book} <span style={{ fontFamily: "'Space Mono', monospace" }}>{formatOdds(b.overAmerican)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <span style={{ color: "#1a1d23", fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>{value}</span>
    </div>
  );
}

function RoiBanner({ roi }) {
  const r = roi.roi;
  const color = r === null ? "#8b919a"
    : r >= 5 ? "#0d9f4f"
    : r >= 0 ? "#1a73e8"
    : "#e8a100";
  const unitsStr = (roi.units >= 0 ? "+" : "") + roi.units.toFixed(2) + "u";
  const roiStr = r === null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(1)}%`;
  return (
    <Link to="/record" style={{
      display: "block", textDecoration: "none", color: "inherit",
      background: `${color}08`, border: `1px solid ${color}30`,
      borderRadius: 10, padding: "10px 14px", marginBottom: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 20, fontWeight: 900, color, fontFamily: "'Space Mono', monospace" }}>
          {unitsStr}
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#1a1d23" }}>
            HR Hunter track record · {roiStr} ROI
          </div>
          <div style={{ fontSize: 10, color: "#8b919a" }}>
            {roi.wins}W - {roi.losses}L{roi.pushes > 0 ? ` - ${roi.pushes}P` : ""} · {roi.total} home run picks tracked
          </div>
        </div>
        <div style={{ fontSize: 11, color, fontWeight: 700 }}>View record →</div>
      </div>
    </Link>
  );
}

const selectStyle = {
  padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e5ea",
  background: "#fff", fontSize: 12, fontFamily: "'DM Sans', sans-serif",
  fontWeight: 600, color: "#1a1d23", cursor: "pointer",
};

const smallBtnStyle = (active) => ({
  padding: "6px 12px", borderRadius: 6,
  border: `1px solid ${active ? "#1a1d23" : "#cbd5e1"}`,
  background: active ? "#1a1d23" : "#fff",
  color: active ? "#fff" : "#475569",
  fontSize: 11, fontWeight: 700, cursor: "pointer",
  fontFamily: "'DM Sans', sans-serif",
});
