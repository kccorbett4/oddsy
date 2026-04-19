import { useState, useEffect, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import SiteNav from "./SiteNav.jsx";

// Converts a prediction-market probability (0-1) to American odds. Prediction
// markets are vig-free, so this is genuine "fair" odds — useful for comparing
// against sportsbook lines. +150 and -200 bracket the meaningful range.
function probToAmerican(p) {
  if (!p || p <= 0 || p >= 1) return null;
  if (p >= 0.5) return Math.round(-100 * p / (1 - p));
  return Math.round(100 * (1 - p) / p);
}
const formatPct = (p) => (p == null ? "—" : `${(p * 100).toFixed(1)}%`);
const formatOdds = (o) => (o == null ? "—" : o > 0 ? `+${o}` : `${o}`);
const formatUSD = (n) => {
  if (n == null) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
};
const formatClose = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const hours = (d - now) / 3600000;
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const SPORT_ICONS = {
  MLB: "⚾", NBA: "🏀", NFL: "🏈", NHL: "🏒", WNBA: "🏀",
  MLS: "⚽", Soccer: "⚽", Tennis: "🎾", Golf: "⛳",
  Fighting: "🥊", Other: "🎯",
};

export default function PredictionMarketsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [source, setSource] = useState("all");
  const [sport, setSport] = useState("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/prediction-markets").then(r => r.json());
      if (r?.error) throw new Error(r.error);
      setData(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const markets = data?.markets || [];

  const sportOptions = useMemo(() => {
    const s = new Set(markets.map(m => m.sport).filter(Boolean));
    return [...s].sort();
  }, [markets]);

  const filtered = useMemo(() => {
    return markets.filter(m => {
      if (source !== "all" && m.source !== source) return false;
      if (sport !== "all" && m.sport !== sport) return false;
      return true;
    });
  }, [markets, source, sport]);

  // Group by event title so a matchup's yes/no pair sits together.
  const grouped = useMemo(() => {
    const byEvent = new Map();
    for (const m of filtered) {
      const key = `${m.source}:${m.title}:${m.closeTime || ""}`;
      if (!byEvent.has(key)) byEvent.set(key, []);
      byEvent.get(key).push(m);
    }
    return [...byEvent.values()];
  }, [filtered]);

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#1a1d23" }}>
      <Helmet>
        <title>Prediction Markets — Kalshi & Polymarket | MyOddsy</title>
        <meta name="description" content="Live odds from Kalshi and Polymarket prediction markets. Vig-free probabilities you can compare against sportsbook lines to spot mispriced bets." />
        <link rel="canonical" href="https://www.myoddsy.com/prediction-markets" />
      </Helmet>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      <SiteNav />

      <header style={{
        background: "linear-gradient(135deg, #0c4a6e 0%, #155e75 100%)",
        color: "#fff", padding: "26px 20px 22px",
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: "0 0 6px" }}>🔮 Prediction Markets</h1>
          <p style={{ fontSize: 13, color: "#bae6fd", margin: 0, lineHeight: 1.55, maxWidth: 780 }}>
            Live sports markets from Kalshi and Polymarket. Prices are vig-free — a 60¢ YES
            equals a 60% true probability. Cross-reference against sportsbook lines to find
            bets where the book is priced weaker than where real money is settling.
          </p>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 14px 110px" }}>
        {/* Filters */}
        <div style={{
          background: "#fff", border: "1px solid #e2e5ea", borderRadius: 12,
          padding: "12px 14px", marginBottom: 14, display: "flex", flexWrap: "wrap",
          alignItems: "center", gap: 12,
        }}>
          <label style={{ fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            Source:
            <select value={source} onChange={e => setSource(e.target.value)} style={selectStyle}>
              <option value="all">All</option>
              <option value="kalshi">Kalshi only</option>
              <option value="polymarket">Polymarket only</option>
            </select>
          </label>

          {sportOptions.length > 1 && (
            <label style={{ fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              Sport:
              <select value={sport} onChange={e => setSport(e.target.value)} style={selectStyle}>
                <option value="all">All sports</option>
                {sportOptions.map(s => (
                  <option key={s} value={s}>{SPORT_ICONS[s] || ""} {s}</option>
                ))}
              </select>
            </label>
          )}

          <button onClick={load} style={{
            marginLeft: "auto", padding: "6px 14px",
            background: "#0284c7", color: "#fff", border: 0, borderRadius: 8,
            fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>↻ Refresh</button>
        </div>

        {loading && <div style={{ padding: 40, textAlign: "center", color: "#666" }}>Loading markets…</div>}
        {error && <div style={{ padding: 16, background: "#fef2f2", color: "#b91c1c", borderRadius: 8, fontSize: 13 }}>Error: {error}</div>}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "#888", fontSize: 13 }}>
            No live markets match these filters right now.
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {grouped.map((group, gi) => {
              const first = group[0];
              const sportIcon = SPORT_ICONS[first.sport] || "🎯";
              return (
                <div key={gi} style={{
                  background: "#fff", border: "1px solid #e2e5ea", borderRadius: 12,
                  padding: "12px 14px", boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between",
                    alignItems: "flex-start", gap: 8, marginBottom: 8, flexWrap: "wrap",
                  }}>
                    <div>
                      <div style={{
                        fontSize: 10, color: "#64748b", textTransform: "uppercase",
                        letterSpacing: 0.6, fontWeight: 700, marginBottom: 2,
                      }}>
                        {sportIcon} {first.sport} · <SourceBadge source={first.source} /> · closes {formatClose(first.closeTime)}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
                        {first.title}
                      </div>
                    </div>
                    <a href={first.url} target="_blank" rel="noopener noreferrer" style={{
                      fontSize: 11, color: "#0284c7", textDecoration: "none", fontWeight: 700, whiteSpace: "nowrap",
                    }}>
                      Open on {first.source === "kalshi" ? "Kalshi" : "Polymarket"} →
                    </a>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: group.length >= 2 ? "1fr 1fr" : "1fr", gap: 8 }}>
                    {group.map(m => (
                      <SideCard key={m.id} market={m} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {data && (
          <div style={{ marginTop: 22, fontSize: 10, color: "#94a3b8", textAlign: "center", lineHeight: 1.6 }}>
            {data.totalMarkets} markets · Kalshi: {data.sources?.kalshi?.count || 0} · Polymarket: {data.sources?.polymarket?.count || 0}
            <br />
            Updated {data.cachedAt ? new Date(data.cachedAt).toLocaleTimeString() : "—"}
          </div>
        )}
      </div>
    </div>
  );
}

function SideCard({ market }) {
  const prob = market.yesPrice;
  const american = probToAmerican(prob);
  const spread = market.yesBid && market.yesAsk ? (market.yesAsk - market.yesBid) : null;
  return (
    <div style={{
      padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 10,
      background: "#f8fafc",
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
        {market.subtitle || "YES"}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Space Mono', monospace", color: "#0c4a6e" }}>
          {formatPct(prob)}
        </span>
        <span style={{ fontSize: 13, color: "#64748b", fontFamily: "'Space Mono', monospace" }}>
          {formatOdds(american)}
        </span>
      </div>
      <div style={{ fontSize: 10, color: "#94a3b8", display: "flex", justifyContent: "space-between" }}>
        <span>
          {market.yesBid != null && market.yesAsk != null
            ? `${(market.yesBid * 100).toFixed(0)}¢ / ${(market.yesAsk * 100).toFixed(0)}¢`
            : market.lastPrice ? `last ${(market.lastPrice * 100).toFixed(0)}¢` : ""}
        </span>
        <span>
          {market.volume ? `vol ${formatUSD(market.volume)}` : market.liquidity ? `liq ${formatUSD(market.liquidity)}` : ""}
        </span>
      </div>
    </div>
  );
}

function SourceBadge({ source }) {
  const color = source === "kalshi" ? "#16a34a" : "#7c3aed";
  const label = source === "kalshi" ? "Kalshi" : "Polymarket";
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px", borderRadius: 4,
      background: `${color}22`, color, fontWeight: 800, fontSize: 9,
      letterSpacing: 0.4,
    }}>{label}</span>
  );
}

const selectStyle = {
  padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1",
  fontSize: 12, fontFamily: "inherit", background: "#fff",
};
