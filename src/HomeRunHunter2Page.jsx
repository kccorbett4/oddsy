import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { rankHrProjectionsV2, selectTieredPicks } from "./hrModel2";
import StadiumWindSvg from "./StadiumWindSvg";
import SiteNav from "./SiteNav.jsx";

// Display helpers shared with v1 — kept inline so v2 has no v1 dependency
// other than the stadium SVG (a pure presentational component).
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

// Tier styling. Locks are confidence-tier "High" picks the model and the
// market mostly agree on; Value plays trade certainty for edge; Longshots
// are explicit lottery tickets capped at +1500.
const TIER_STYLES = {
  Lock:     { color: "#0d9f4f", bg: "#ecfdf5", border: "#34d399", label: "🔒 Lock 'Em In", subtitle: "High confidence, anchor-book agreement, model + market in lockstep" },
  Value:    { color: "#1a73e8", bg: "#eff6ff", border: "#60a5fa", label: "💎 Value Plays",   subtitle: "Solid edge with reasonable hit rate; bread-and-butter +EV" },
  Longshot: { color: "#7c3aed", bg: "#f5f3ff", border: "#c4b5fd", label: "🎯 Longshots",     subtitle: "Bigger payouts, lower probability — capped at +1500" },
};

export default function HomeRunHunter2Page() {
  const [ctx, setCtx] = useState(null);
  const [odds, setOdds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [book, setBook] = useState("any");
  const [expanded, setExpanded] = useState(null);
  const [bvp, setBvp] = useState({});
  const [roi, setRoi] = useState(null);
  const [v1Roi, setV1Roi] = useState(null);
  const [showAll, setShowAll] = useState(false);

  // Fetch tracked-pick stats for both the v1 hr_v1_* keys (for comparison)
  // and the v2 hr_v2_* keys (this page's track record).
  useEffect(() => {
    fetch("/api/track-stats")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.stats) return;
        const acc = (matcher) => {
          let wins = 0, losses = 0, pushes = 0, total = 0, units = 0;
          for (const [name, s] of Object.entries(data.stats)) {
            if (!matcher(name)) continue;
            wins += s.wins || 0; losses += s.losses || 0;
            pushes += s.pushes || 0; total += s.total || 0;
            units += Number(s.units || 0);
          }
          if (total === 0) return null;
          return {
            wins, losses, pushes, total,
            units: +units.toFixed(2),
            roi: total > 0 ? +((units / total) * 100).toFixed(1) : null,
          };
        };
        setRoi(acc(n => /^hr_v2(_|$)/.test(n)));
        setV1Roi(acc(n => /^hr_v1(_|$)/.test(n) || /^(hr|homerun|homeruns|home_run)(_|$)/.test(n)));
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
    }
  };

  useEffect(() => { loadData(false); }, []);

  // Run the v2 pipeline + tiered selection.
  const projections = useMemo(() => {
    if (!ctx || !odds) return [];
    return rankHrProjectionsV2(ctx, odds);
  }, [ctx, odds]);

  // Single-book filter rebuilds best-line and EV at that specific book —
  // matches v1's UX (lets users see "what does my book offer" exactly).
  const projectionsBookFiltered = useMemo(() => {
    if (book === "any") return projections;
    return projections
      .filter(r => r.byBook?.[book])
      .map(r => {
        const b = r.byBook[book];
        const impl = 1 / b.overDecimal;
        return {
          ...r,
          bestBook: b.book,
          bestAmerican: b.overAmerican,
          bestDecimal: b.overDecimal,
          booksImplied: impl,
          edgeVsBookPct: (r.modelProb - impl) * 100,
          evPct: (r.modelProb * (b.overDecimal - 1) - (1 - r.modelProb)) * 100,
        };
      });
  }, [projections, book]);

  const tiered = useMemo(() => selectTieredPicks(projectionsBookFiltered), [projectionsBookFiltered]);

  const allBooks = useMemo(() => {
    const s = new Set();
    for (const p of projections) {
      for (const b of Object.keys(p.byBook || {})) s.add(b);
    }
    return [...s].sort();
  }, [projections]);

  // Auto-track v2 picks once per day. Sends the Locks / Value / Longshots
  // tiers under three distinct strategy keys so each lane has its own ROI
  // slot in the resolver, and we can answer "which v2 tier is best?".
  useEffect(() => {
    if (!ctx || !odds || projections.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const sentKey = `hrV2Sent:${today}`;
    if (sessionStorage.getItem(sentKey) === "1") return;

    const buildPicks = (rows, strategy) => rows
      .filter(p => p?.bestAmerican && p?.game?.commence)
      .map(p => ({
        strategy,
        gameId: ctx.games.find(g =>
          (g.home === p.game.home && g.away === p.game.away))?.gameId
          || `${p.game.home}@${p.game.away}@${p.game.commence}`,
        homeTeam: p.game.home,
        awayTeam: p.game.away,
        sportKey: "baseball_mlb",
        commenceTime: p.game.commence,
        marketType: "batter_home_runs",
        outcome: p.name,
        point: 0.5,
        odds: p.bestAmerican,
        book: p.bestBook || "",
      }));

    const allPicks = [
      ...buildPicks(tiered.locks, "hr_v2_locks"),
      ...buildPicks(tiered.value, "hr_v2_value"),
      ...buildPicks(tiered.longshots, "hr_v2_longshots"),
    ];
    if (allPicks.length === 0) return;

    fetch("/api/track-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picks: allPicks }),
    }).then(() => {
      try { sessionStorage.setItem(sentKey, "1"); } catch (_) { /* noop */ }
    }).catch(() => {});
  }, [ctx, odds, projections.length, tiered.locks, tiered.value, tiered.longshots]);

  const renderCard = (p) => {
    const key = `${p.batterId}|${p.game.home}|${p.game.away}`;
    const isExpanded = expanded === key;
    const tier = TIER_STYLES[p.tierLabel] || TIER_STYLES.Value;
    return (
      <div key={key} style={{
        background: "#fff", border: `1px solid ${tier.border}`,
        borderLeft: `4px solid ${tier.color}`,
        borderRadius: 12, padding: "12px 14px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
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
              <div style={{ fontSize: 10, color: "#fff", background: tier.color, padding: "2px 6px", borderRadius: 4, fontWeight: 800 }}>
                {p.tier} confidence
              </div>
              {p.evPct >= 5 && (
                <div style={{ fontSize: 10, color: "#fff", background: "#10b981", padding: "2px 6px", borderRadius: 4, fontWeight: 800 }}>
                  +{p.evPct.toFixed(1)}% EV
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
              {p.team && p.opponent ? `${p.team} vs ${p.opponent}` : `${p.game.away} @ ${p.game.home}`}
              {p.opposingPitcher?.name && <> · opp {p.opposingPitcher.name} ({p.opposingPitcher.pitchHand || "?"})</>}
              {" · "}{formatTime(p.game.commence)}
            </div>
          </div>
          <div style={{ textAlign: "right", minWidth: 90 }}>
            <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "'Space Mono', monospace", color: tier.color }}>
              {formatOdds(p.bestAmerican)}
            </div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>{p.bestBook}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 10, padding: "8px 0", borderTop: "1px solid #f1f5f9" }}>
          <Stat label="Model HR prob" value={formatPct(p.modelProb)} color="#1a1d23" />
          <Stat label="No-vig consensus" value={p.noVigConsensus != null ? formatPct(p.noVigConsensus) : "—"} color="#6b7280" />
          <Stat
            label="Edge vs market"
            value={p.edgeVsConsensusPct != null
              ? `${p.edgeVsConsensusPct >= 0 ? "+" : ""}${p.edgeVsConsensusPct.toFixed(1)} pp`
              : "—"}
            color={p.edgeVsConsensusPct >= 1 ? "#0d9f4f" : p.edgeVsConsensusPct >= 0 ? "#6b7280" : "#dc2626"}
          />
          <Stat
            label="Suggested unit"
            value={`${(p.kelly?.quarter * 100 || 0).toFixed(2)}u`}
            color="#1a1d23"
          />
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button onClick={() => setExpanded(isExpanded ? null : key)} style={smallBtnStyle(isExpanded)}>
            {isExpanded ? "Hide details" : "Show model breakdown"}
          </button>
          {p.anchorCount > 0 && (
            <div style={{ fontSize: 10, color: "#6b7280", alignSelf: "center", marginLeft: 6 }}>
              {p.anchorCount} books within 5% of consensus
            </div>
          )}
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
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#1a1d23" }}>
      <Helmet>
        <title>Home Run Hunter 2.0 — Calibrated HR Props | MyOddsy</title>
        <meta name="description" content="Tiered HR prop picks (Locks / Value / Longshots) using Statcast contact-quality, pitcher skill regression, ballpark physics, and de-vigged market consensus to filter genuine edge from longshot variance." />
        <link rel="canonical" href="https://www.myoddsy.com/homeruns/v2" />
      </Helmet>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      <SiteNav />

      <header style={{
        background: "linear-gradient(135deg, #0c1322 0%, #1e1b4b 60%, #312e81 100%)",
        color: "#fff", padding: "26px 20px 20px",
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>💣 Home Run Hunter</h1>
            <span style={{
              fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 6,
              background: "#fbbf24", color: "#451a03", letterSpacing: "0.04em",
            }}>v2.0 · BETA</span>
          </div>
          <p style={{ fontSize: 13, color: "#cbd5e1", margin: "0 0 12px", lineHeight: 1.55, maxWidth: 820 }}>
            Six-agent rebuild of the model. Statcast contact-quality with per-metric Bayesian
            shrinkage, pitcher decomposition with HR/FB regressed to mean, humid-air carry
            physics, Poisson aggregation over plate-appearance distributions, and — critically —
            picks anchored to the de-vigged market consensus instead of the loosest book.
          </p>
          <details style={{ fontSize: 12, color: "#cbd5e1", cursor: "pointer" }}>
            <summary style={{ fontWeight: 700, color: "#fbbf24", listStyle: "revert" }}>
              Why v2 should fix what v1 got wrong
            </summary>
            <div style={{ marginTop: 8, lineHeight: 1.65, color: "#cbd5e1" }}>
              v1 compared the model's HR probability against <code>1 / bestDecimal</code> — a price
              that already includes 5-10% per-side vig. That math systematically generates fake
              edges on overpriced longshots. v2 de-vigs every book, takes the sharpness-weighted
              median across the market, and only flags a pick when the model genuinely disagrees
              with consensus AND the book offers a price you can profitably take. v2 also splits
              the chain product between starter and bullpen, applies times-through-the-order
              multipliers, and shrinks the multiplicative product when it goes extreme — so a
              "good batter × bad pitcher × HR park × wind out × platoon edge" stack-up no longer
              compounds five 10% errors into a 60% miscalibration.
            </div>
          </details>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Link to="/homeruns" style={pillLink}>← Back to v1</Link>
            <Link to="/homeruns/parlays" style={pillLink}>HR Parlays</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 14px 120px" }}>
        {(roi || v1Roi) && <RoiBanners v1Roi={v1Roi} v2Roi={roi} />}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14, alignItems: "center" }}>
          <select value={book} onChange={e => setBook(e.target.value)} style={selectStyle}>
            <option value="any">Best line (any book)</option>
            {allBooks.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <button
            onClick={() => loadData(true)}
            style={{ ...selectStyle, cursor: "pointer", background: "#0f172a", color: "#fff", border: "1px solid #0f172a" }}
          >🔄 Refresh</button>
          <button
            onClick={() => setShowAll(!showAll)}
            style={{ ...selectStyle, cursor: "pointer" }}
          >{showAll ? "Hide" : "Show"} all {projectionsBookFiltered.length} priced props</button>
          {ctx && odds && !loading && (
            <div style={{ fontSize: 11, color: "#6b7280", marginLeft: "auto" }}>
              {projections.length} props priced · {odds.eventCount} games · odds {new Date(odds.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: "#fee2e2", color: "#991b1b", padding: 12, borderRadius: 10, marginBottom: 14, fontSize: 12 }}>
            Failed to load: {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#8b919a", fontSize: 13 }}>
            Loading projections…
          </div>
        ) : (
          <>
            <TierSection tier={TIER_STYLES.Lock}     picks={tiered.locks}     emptyMsg="No Locks today — model and market need to align tighter." render={renderCard} />
            <TierSection tier={TIER_STYLES.Value}    picks={tiered.value}     emptyMsg="No Value plays cleared the +3% EV threshold." render={renderCard} />
            <TierSection tier={TIER_STYLES.Longshot} picks={tiered.longshots} emptyMsg="No Longshots cleared the +8% EV bar at ≤+1500." render={renderCard} />

            {showAll && (
              <div style={{ marginTop: 24 }}>
                <h2 style={{ fontSize: 14, fontWeight: 800, margin: "0 0 8px", color: "#1a1d23", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  All priced props ({projectionsBookFiltered.length})
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {projectionsBookFiltered.map(p => renderCard({ ...p, tierLabel: p.tier === "High" ? "Value" : "Longshot" }))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TierSection({ tier, picks, emptyMsg, render }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <div style={{
        background: tier.bg, border: `1px solid ${tier.border}`,
        borderRadius: 10, padding: "10px 14px", marginBottom: 10,
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: tier.color, marginBottom: 2 }}>
          {tier.label} <span style={{ fontWeight: 600, color: "#475569", fontSize: 12 }}>({picks.length})</span>
        </div>
        <div style={{ fontSize: 11, color: "#475569" }}>{tier.subtitle}</div>
      </div>
      {picks.length === 0 ? (
        <div style={{ textAlign: "center", padding: 18, color: "#94a3b8", fontSize: 12 }}>
          {emptyMsg}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {picks.map(render)}
        </div>
      )}
    </section>
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

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <span style={{ color: "#1a1d23", fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>{value}</span>
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
  const inputs = pick.inputs || {};
  return (
    <div style={{ marginTop: 10, padding: 10, background: "#f8fafc", borderRadius: 8, fontSize: 12, lineHeight: 1.6 }}>
      <SectionHeader>Calibration pipeline</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        <Row label="Raw model prob" value={`${(pick.rawModelProb * 100).toFixed(2)}%`} />
        <Row label="No-vig consensus" value={pick.noVigConsensus != null ? `${(pick.noVigConsensus * 100).toFixed(2)}%` : "—"} />
        <Row label="Calibrated prob (display)" value={`${(pick.modelProb * 100).toFixed(2)}%`} />
        <Row label="Confidence tier" value={pick.tier} />
        <Row label="Edge vs book (post-vig)" value={`${pick.edgeVsBookPct >= 0 ? "+" : ""}${pick.edgeVsBookPct.toFixed(2)} pp`} />
        <Row label="Edge vs no-vig consensus" value={pick.edgeVsConsensusPct != null ? `${pick.edgeVsConsensusPct >= 0 ? "+" : ""}${pick.edgeVsConsensusPct.toFixed(2)} pp` : "—"} />
        <Row label="Quarter Kelly" value={`${(pick.kelly.quarter * 100).toFixed(2)}% BR`} />
        <Row label="Composite score" value={pick.score?.toFixed(3) || "—"} />
      </div>

      <SectionHeader>Batter (Statcast quality + shrinkage)</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        <Row label="xHR / PA" value={inputs.xHRperPA?.toFixed(4) || "—"} />
        <Row label="Season HR/PA (shrunk)" value={inputs.batterChain?.seasonHrPerPA?.toFixed(4) || "—"} />
        <Row label="Barrel/PA (shrunk)" value={inputs.batterChain?.barrel != null ? `${(inputs.batterChain.barrel * 100).toFixed(2)}%` : "—"} />
        <Row label="Avg EV (shrunk)" value={inputs.batterChain?.ev != null ? `${inputs.batterChain.ev.toFixed(1)} mph` : "—"} />
        <Row label="xISO (shrunk)" value={inputs.batterChain?.xiso?.toFixed(3) || "—"} />
        <Row label="Sweet-spot multiplier" value={`×${inputs.batterChain?.sweetSpotMult?.toFixed(2) || "—"}`} />
      </div>

      <SectionHeader>Pitcher (decomposed)</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        <Row label="Starter mult (combined)" value={`×${inputs.pitcher?.starterMult?.toFixed(3) || "—"}`} />
        <Row label="Contact-quality mult" value={`×${inputs.pitcher?.contactMult?.toFixed(3) || "—"}`} />
        <Row label="HR/FB mult (regressed)" value={`×${inputs.pitcher?.hrFbMult?.toFixed(3) || "—"}`} />
        <Row label="HR/FB shrunk rate" value={inputs.pitcher?.hrFbShrunk?.toFixed(4) || "—"} />
        <Row label="Starter PA share (lineup)" value={inputs.starterShare != null ? `${(inputs.starterShare * 100).toFixed(0)}%` : "—"} />
      </div>

      <SectionHeader>Environment (physics)</SectionHeader>
      <StadiumWindSvg weather={w} park={pick.game.park} outdoor={pick.game.outdoor} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10, marginBottom: 10 }}>
        <Row label="Env factor (combined)" value={`×${inputs.env?.factor?.toFixed(3) || "—"}`} />
        <Row label="Park HR factor" value={`×${inputs.env?.parkF?.toFixed(3) || "—"}`} />
        <Row label="Air-density mult" value={`×${inputs.env?.density?.toFixed(3) || "—"}`} />
        <Row label="Wind mult (handedness-aware)" value={`×${inputs.env?.wind?.toFixed(3) || "—"}`} />
        {w?.tempF != null && <Row label="Temp" value={`${w.tempF.toFixed(0)}°F`} />}
        {w?.windMph != null && <Row label="Wind" value={`${w.windMph.toFixed(0)} mph`} />}
      </div>

      <SectionHeader>Chain shrinkage (log-space)</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        <Row label="Chain raw product" value={`×${inputs.chainRaw?.toFixed(3) || "—"}`} />
        <Row label="Chain after shrinkage" value={`×${inputs.chainShrunk?.toFixed(3) || "—"}`} />
        <Row label="Per-PA vs starter" value={inputs.perPAstarter?.toFixed(4) || "—"} />
        <Row label="Per-PA vs bullpen" value={inputs.perPAbullpen?.toFixed(4) || "—"} />
      </div>

      {pick.opposingPitcher && (
        <>
          <SectionHeader>Head-to-head vs {pick.opposingPitcher.name}</SectionHeader>
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
          ) : null}
        </>
      )}

      <SectionHeader>All books pricing this HR</SectionHeader>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {Object.values(pick.byBook || {}).sort((a, b) => b.overDecimal - a.overDecimal).map(b => {
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
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{ fontWeight: 700, fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, marginTop: 4 }}>
      {children}
    </div>
  );
}

function RoiBannerOne({ roi, label, accent }) {
  if (!roi) return null;
  const r = roi.roi;
  const color = r === null ? "#8b919a"
    : r >= 5 ? "#0d9f4f"
    : r >= 0 ? "#1a73e8"
    : "#e8a100";
  const unitsStr = (roi.units >= 0 ? "+" : "") + roi.units.toFixed(2) + "u";
  const roiStr = r === null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(1)}%`;
  return (
    <div style={{
      flex: 1, minWidth: 240,
      background: `${accent}10`, border: `1px solid ${accent}40`,
      borderRadius: 10, padding: "10px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 900, color, fontFamily: "'Space Mono', monospace" }}>
          {unitsStr}
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#1a1d23" }}>
            {label} · {roiStr} ROI
          </div>
          <div style={{ fontSize: 10, color: "#8b919a" }}>
            {roi.wins}W · {roi.losses}L{roi.pushes > 0 ? ` · ${roi.pushes}P` : ""} · {roi.total} picks
          </div>
        </div>
      </div>
    </div>
  );
}

function RoiBanners({ v1Roi, v2Roi }) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
      <RoiBannerOne roi={v1Roi} label="HRH v1 (legacy)"  accent="#94a3b8" />
      <RoiBannerOne roi={v2Roi} label="HRH v2 (this page)" accent="#7c3aed" />
      {!v1Roi && !v2Roi && (
        <div style={{ flex: 1, fontSize: 11, color: "#6b7280", padding: "10px 14px", background: "#fff", borderRadius: 10, border: "1px solid #e2e5ea" }}>
          Track record builds as picks resolve. Daily auto-tracking is on for both v1 and v2 — check back tomorrow.
        </div>
      )}
    </div>
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

const pillLink = {
  padding: "6px 12px", borderRadius: 999,
  background: "rgba(255,255,255,0.08)", color: "#cbd5e1",
  textDecoration: "none", fontSize: 12, fontWeight: 700,
  border: "1px solid rgba(255,255,255,0.18)",
};
