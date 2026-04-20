// Spread Scanner
// ─────────────────────────────────────────────────────────────────────────
// Shows every market where a single book is offering meaningfully better
// odds than the median of the rest of the book. Example: median line is
// +400, but one book posts +800 — that's a 26-point implied-prob gap.
//
// Unified view across game markets (ML / spread / total) and HR props,
// with filters at the top. This is a different lens than Sharp Picks: we
// don't score confidence, we just surface the mispricings themselves and
// let the user decide.
import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import SiteNav from "./SiteNav.jsx";

const SPORTS = [
  { id: "all", label: "All" },
  { id: "baseball_mlb", label: "MLB" },
  { id: "basketball_nba", label: "NBA" },
  { id: "americanfootball_nfl", label: "NFL" },
  { id: "icehockey_nhl", label: "NHL" },
  { id: "basketball_ncaab", label: "NCAAB" },
  { id: "americanfootball_ncaaf", label: "NCAAF" },
  { id: "mma_mixed_martial_arts", label: "MMA" },
  { id: "soccer_usa_mls", label: "MLS" },
];

const MARKET_FILTERS = [
  { id: "all", label: "All markets" },
  { id: "h2h", label: "Moneyline" },
  { id: "spreads", label: "Spread" },
  { id: "totals", label: "Total" },
  { id: "hr", label: "HR props" },
];

const GAP_OPTIONS = [
  { id: 5, label: "5%+ gap" },
  { id: 10, label: "10%+ gap" },
  { id: 15, label: "15%+ gap" },
  { id: 25, label: "25%+ gap" },
];

const americanToDecimal = (a) => (a >= 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a));
const decimalToAmerican = (d) => {
  if (d >= 2) return Math.round((d - 1) * 100);
  return Math.round(-100 / (d - 1));
};
const impliedProb = (american) => (american >= 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100));
const formatAmerican = (a) => (a > 0 ? `+${a}` : `${a}`);
const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

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

// Build the unified market list. Each entry has books[] with decimal odds;
// we compute median/best and the implied-prob gap between them.
function buildMarkets(gameData, hrData) {
  const out = [];

  // Game markets
  const now = Date.now();
  (gameData?.games || []).forEach(g => {
    if (g.commence_time && new Date(g.commence_time).getTime() < now - 60 * 60 * 1000) return;
    const gameLabel = `${g.away_team} @ ${g.home_team}`;
    const sport = g.sport_key;

    // Group outcomes across books per (marketKey, outcome.name, outcome.point)
    const bucket = {};
    (g.bookmakers || []).forEach(book => {
      // Non-bettable books (Pinnacle etc.) don't belong on a scanner meant
      // for finding the best price you can actually play at.
      if (book.bettable === false) return;
      (book.markets || []).forEach(m => {
        if (!["h2h", "spreads", "totals"].includes(m.key)) return;
        (m.outcomes || []).forEach(o => {
          const key = `${m.key}|${o.name}|${o.point ?? ""}`;
          if (!bucket[key]) bucket[key] = {
            marketKey: m.key,
            marketLabel: m.key === "h2h" ? "Moneyline" : m.key === "spreads" ? "Spread" : "Total",
            outcomeName: o.name,
            point: o.point,
            books: [],
          };
          bucket[key].books.push({ book: book.title, american: o.price, decimal: americanToDecimal(o.price) });
        });
      });
    });

    Object.values(bucket).forEach(b => {
      if (b.books.length < 3) return;
      out.push({
        kind: "game",
        sport,
        gameLabel,
        commence: g.commence_time,
        gameId: g.id,
        ...b,
        title: b.marketKey === "h2h"
          ? b.outcomeName
          : `${b.outcomeName}${b.point != null ? ` ${b.point > 0 ? "+" : ""}${b.point}` : ""}`,
      });
    });
  });

  // HR props — treat each (player, point) as its own market
  (hrData?.events || []).forEach(ev => {
    const gameLabel = `${ev.away} @ ${ev.home}`;
    (ev.players || []).forEach(p => {
      const byPoint = {};
      (p.books || []).forEach(b => {
        const key = String(p.point ?? b.point ?? 0.5);
        if (!byPoint[key]) byPoint[key] = { point: b.point ?? 0.5, books: [] };
        byPoint[key].books.push({ book: b.book, american: b.overAmerican, decimal: b.overDecimal });
      });
      Object.values(byPoint).forEach(grp => {
        if (grp.books.length < 3) return;
        const label = grp.point === 0.5 ? "HR" : `${grp.point}+ HR`;
        out.push({
          kind: "hr",
          sport: "baseball_mlb",
          gameLabel,
          commence: ev.commence,
          gameId: ev.eventId,
          marketKey: "hr",
          marketLabel: "HR Prop",
          outcomeName: p.name,
          point: grp.point,
          books: grp.books,
          title: `${p.name} — ${label}`,
        });
      });
    });
  });

  // Compute median/best and gap for every market
  return out.map(m => {
    const decimals = m.books.map(b => b.decimal);
    const medDec = median(decimals);
    const best = m.books.reduce((a, b) => (b.decimal > a.decimal ? b : a));
    // Implied-prob gap in percentage points — how much "free value" the best
    // book offers vs the market middle. Example: +400 vs +800 = ~8.9pp gap.
    const medProb = 1 / medDec;
    const bestProb = 1 / best.decimal;
    const probGapPct = (medProb - bestProb) * 100; // positive = best is longer than median
    // Payout-gap % is the more intuitive ratio for big longshots.
    const payoutGapPct = (best.decimal / medDec - 1) * 100;
    return { ...m, medDecimal: medDec, medAmerican: decimalToAmerican(medDec), bestBook: best.book, bestDecimal: best.decimal, bestAmerican: best.american, probGapPct, payoutGapPct };
  });
}

export default function SpreadScannerPage() {
  const [gameData, setGameData] = useState(null);
  const [hrData, setHrData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState("all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [minGap, setMinGap] = useState(10);

  useEffect(() => {
    Promise.all([
      fetch("/api/odds").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/hr?action=odds").then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([g, h]) => {
      setGameData(g);
      setHrData(h);
      setLoading(false);
    });
  }, []);

  const markets = useMemo(() => {
    if (!gameData && !hrData) return [];
    return buildMarkets(gameData, hrData);
  }, [gameData, hrData]);

  const filtered = useMemo(() => {
    return markets
      .filter(m => sport === "all" || m.sport === sport)
      .filter(m => {
        if (marketFilter === "all") return true;
        if (marketFilter === "hr") return m.kind === "hr";
        return m.marketKey === marketFilter;
      })
      .filter(m => m.payoutGapPct >= minGap)
      .sort((a, b) => b.payoutGapPct - a.payoutGapPct)
      .slice(0, 300);
  }, [markets, sport, marketFilter, minGap]);

  const sportsInFeed = useMemo(() => {
    const ids = new Set(markets.map(m => m.sport));
    return SPORTS.filter(s => s.id === "all" || ids.has(s.id));
  }, [markets]);

  return (
    <div style={S.page}>
      <Helmet>
        <title>Odds Gap Scanner — Find Books Pricing Way Off Market | MyOddsy</title>
        <meta name="description" content="Scan every sportsbook for lines that are way off the market consensus. Median +400 but one book at +800? We flag it. Game markets + HR props, filterable." />
        <link rel="canonical" href="https://www.myoddsy.com/spread-scanner" />
      </Helmet>

      <SiteNav />

      <header style={S.header}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px 14px" }}>
          <Link to="/" style={{ fontSize: 11, color: "#8b919a", textDecoration: "none" }}>← home</Link>
          <h1 style={S.h1}>📊 Odds Gap Scanner</h1>
          <p style={S.sub}>
            Markets where one book is pricing materially off the rest. Sorted by payout gap — biggest discrepancies first.
          </p>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 14px 120px" }}>
        {/* Filters */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14, alignItems: "center" }}>
          <select value={sport} onChange={e => setSport(e.target.value)} style={selectStyle}>
            {sportsInFeed.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={marketFilter} onChange={e => setMarketFilter(e.target.value)} style={selectStyle}>
            {MARKET_FILTERS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <select value={minGap} onChange={e => setMinGap(Number(e.target.value))} style={selectStyle}>
            {GAP_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
          <div style={{ fontSize: 11, color: "#8b919a", marginLeft: "auto" }}>
            {filtered.length} of {markets.length} markets
          </div>
        </div>

        {loading && <div style={S.empty}>Loading markets…</div>}
        {!loading && filtered.length === 0 && (
          <div style={S.empty}>
            No markets match these filters. Try lowering the min gap or switching sports.
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map((m, i) => <MarketCard key={`${m.gameId}-${m.marketKey}-${m.outcomeName}-${m.point ?? ""}-${i}`} m={m} />)}
        </div>

        <div style={{ fontSize: 10, color: "#aab0b8", textAlign: "center", marginTop: 24 }}>
          Gap = how much longer the best odds pay vs the median across books.
          Requires 3+ books quoting the market. 21+ | Gambling problem? Call 1-800-522-4700
        </div>
      </div>
    </div>
  );
}

function MarketCard({ m }) {
  const sorted = [...m.books].sort((a, b) => b.decimal - a.decimal);
  const color = m.payoutGapPct >= 25 ? "#0d9f4f"
    : m.payoutGapPct >= 15 ? "#1a73e8"
    : "#7c3aed";

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e5ea", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1d23" }}>{m.title}</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            {m.marketLabel} · {m.gameLabel} · {formatTime(m.commence)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 900, color, fontFamily: "'Space Mono', monospace" }}>
            +{m.payoutGapPct.toFixed(1)}%
          </div>
          <div style={{ fontSize: 10, color: "#8b919a" }}>payout gap</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", fontSize: 12 }}>
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: "6px 10px" }}>
          <div style={{ fontSize: 9, color: "#059669", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>Best</div>
          <div style={{ fontWeight: 700, color: "#065f46" }}>{m.bestBook} <span style={{ fontFamily: "'Space Mono', monospace" }}>{formatAmerican(m.bestAmerican)}</span></div>
        </div>
        <div style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px" }}>
          <div style={{ fontSize: 9, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>Market median</div>
          <div style={{ fontWeight: 700, color: "#334155" }}><span style={{ fontFamily: "'Space Mono', monospace" }}>{formatAmerican(m.medAmerican)}</span> · {m.books.length} books</div>
        </div>
        <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 10px" }}>
          <div style={{ fontSize: 9, color: "#92400e", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>Implied prob gap</div>
          <div style={{ fontWeight: 700, color: "#78350f", fontFamily: "'Space Mono', monospace" }}>{m.probGapPct.toFixed(1)}pp</div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
        {sorted.map(b => {
          const isBest = Math.abs(b.decimal - m.bestDecimal) < 0.001;
          return (
            <div key={b.book} style={{
              fontSize: 10, padding: "3px 7px", borderRadius: 6,
              background: isBest ? "#dcfce7" : "#f8fafc",
              border: `1px solid ${isBest ? "#86efac" : "#e2e8f0"}`,
              color: isBest ? "#14532d" : "#475569",
              fontWeight: isBest ? 700 : 500,
            }}>
              {b.book} <span style={{ fontFamily: "'Space Mono', monospace", marginLeft: 2 }}>{formatAmerican(b.american)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const selectStyle = {
  padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e5ea",
  background: "#fff", fontSize: 12, fontFamily: "'DM Sans', sans-serif",
};

const S = {
  page: { minHeight: "100vh", background: "#f8f9fb", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#1a1d23" },
  header: { background: "#fff", borderBottom: "1px solid #e2e5ea" },
  h1: { fontSize: 24, fontWeight: 800, margin: "8px 0 4px" },
  sub: { fontSize: 13, color: "#6b7280", margin: 0, maxWidth: 680 },
  empty: { background: "#fff", border: "1px dashed #e2e5ea", borderRadius: 10, padding: 30, textAlign: "center", color: "#8b919a", fontSize: 13 },
};
