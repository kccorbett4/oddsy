import { useState, useEffect, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import SiteNav from "./SiteNav.jsx";

const formatPct = (p) => (p == null ? "—" : `${(p * 100).toFixed(1)}%`);
const formatOdds = (o) => (o == null ? "—" : o > 0 ? `+${o}` : `${o}`);
const formatClose = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const hours = (d - new Date()) / 3600000;
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const SPORT_ICONS = {
  MLB: "⚾", NBA: "🏀", NFL: "🏈", NHL: "🏒", WNBA: "🏀", MLS: "⚽",
};

export default function PredictionMarketsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [source, setSource] = useState("all");
  const [sport, setSport] = useState("all");
  const [onlyPositiveEv, setOnlyPositiveEv] = useState(true);

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

  const matches = data?.matches || [];

  const sportOptions = useMemo(() => {
    return [...new Set(matches.map(m => m.sport).filter(Boolean))].sort();
  }, [matches]);

  const filtered = useMemo(() => {
    return matches.filter(m => {
      if (source !== "all" && m.source !== source) return false;
      if (sport !== "all" && m.sport !== sport) return false;
      if (onlyPositiveEv && (m.bestBet?.evPercent ?? 0) <= 0) return false;
      return true;
    });
  }, [matches, source, sport, onlyPositiveEv]);

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#1a1d23" }}>
      <Helmet>
        <title>Prediction Market Value Detector — Kalshi vs Sportsbooks | MyOddsy</title>
        <meta name="description" content="Compares vig-free Kalshi and Polymarket prices to live sportsbook moneylines. Spots every game where the book is priced soft vs where real money is settling." />
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
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: "0 0 6px" }}>🔮 Prediction Market Value</h1>
          <p style={{ fontSize: 13, color: "#bae6fd", margin: 0, lineHeight: 1.55, maxWidth: 780 }}>
            For every game that's live on both Kalshi/Polymarket <b>and</b> a US sportsbook, we
            compare the vig-free prediction-market probability against the book's devigged implied
            probability. If the numbers disagree, one side is mispriced — and that's where the bet is.
          </p>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 14px 110px" }}>
        <div style={{
          background: "#fff", border: "1px solid #e2e5ea", borderRadius: 12,
          padding: "12px 14px", marginBottom: 14, display: "flex", flexWrap: "wrap",
          alignItems: "center", gap: 12,
        }}>
          <label style={filterLabel}>
            Source:
            <select value={source} onChange={e => setSource(e.target.value)} style={selectStyle}>
              <option value="all">All</option>
              <option value="kalshi">Kalshi only</option>
              <option value="polymarket">Polymarket only</option>
            </select>
          </label>

          {sportOptions.length > 1 && (
            <label style={filterLabel}>
              Sport:
              <select value={sport} onChange={e => setSport(e.target.value)} style={selectStyle}>
                <option value="all">All sports</option>
                {sportOptions.map(s => (
                  <option key={s} value={s}>{SPORT_ICONS[s] || ""} {s}</option>
                ))}
              </select>
            </label>
          )}

          <label style={{ ...filterLabel, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={onlyPositiveEv}
              onChange={e => setOnlyPositiveEv(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            Only +EV bets
          </label>

        </div>

        {loading && <div style={{ padding: 40, textAlign: "center", color: "#666" }}>Comparing markets…</div>}
        {error && <div style={{ padding: 16, background: "#fef2f2", color: "#b91c1c", borderRadius: 8, fontSize: 13 }}>Error: {error}</div>}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "#888", fontSize: 13 }}>
            {onlyPositiveEv
              ? "No +EV matchups right now. Turn off the +EV filter to see all matched games."
              : "No prediction markets matched a live sportsbook game. Come back closer to game time."}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map(m => <ValueCard key={`${m.source}:${m.marketId}`} match={m} />)}
          </div>
        )}

        {data && (
          <div style={{ marginTop: 22, fontSize: 10, color: "#94a3b8", textAlign: "center", lineHeight: 1.6 }}>
            {data.totalMatches} total matched markets · Kalshi {data.counts?.kalshi || 0} · Polymarket {data.counts?.polymarket || 0}
            <br />
            Updated {data.cachedAt ? new Date(data.cachedAt).toLocaleTimeString() : "—"}
          </div>
        )}
      </div>
    </div>
  );
}

function ValueCard({ match }) {
  const { predictionMarket, book, bestBet, teams, commenceTime, sport } = match;
  const sportIcon = SPORT_ICONS[sport] || "🎯";
  const ev = bestBet.evPercent;
  const isPositive = ev > 0;
  const venueIsPredMarket = bestBet.venue === "kalshi" || bestBet.venue === "polymarket";
  const [expanded, setExpanded] = useState(false);

  const heroBg = isPositive
    ? (venueIsPredMarket
        ? "linear-gradient(135deg, #7e22ce 0%, #9333ea 100%)"
        : "linear-gradient(135deg, #15803d 0%, #16a34a 100%)")
    : "linear-gradient(135deg, #475569 0%, #64748b 100%)";

  // Build the main action phrase. Book bets read "Bet Team to win"; prediction-
  // market buys read "Buy YES/NO on Team at Kalshi".
  const actionVerb = venueIsPredMarket ? "Buy" : "Bet";
  const actionObject = venueIsPredMarket
    ? `${bestBet.shareType || "YES"} on ${bestBet.team}`
    : `${bestBet.team} to win`;
  const venueLabel = venueIsPredMarket
    ? `on ${bestBet.book}`
    : `at ${bestBet.book}`;

  const priceDisplay = venueIsPredMarket && bestBet.decimalOdds
    ? `$${(1 / bestBet.decimalOdds).toFixed(2)}`
    : formatOdds(bestBet.americanOdds);

  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e5ea", borderRadius: 14,
      boxShadow: "0 2px 6px rgba(0,0,0,0.04)", overflow: "hidden",
    }}>
      {/* HERO: what to bet and where */}
      <div style={{ background: heroBg, color: "#fff", padding: "16px 18px" }}>
        <div style={{
          fontSize: 22, fontWeight: 900, lineHeight: 1.15, marginBottom: 8,
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {actionVerb} <span style={{ textDecoration: "underline", textDecorationThickness: 2, textUnderlineOffset: 3 }}>{actionObject}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <div style={{
            padding: "8px 12px", background: "rgba(255,255,255,0.18)",
            borderRadius: 8, fontSize: 13, fontWeight: 800,
          }}>
            {venueLabel.split(" ")[0]} <span style={{ fontSize: 16 }}>{bestBet.book}</span>
          </div>
          <div style={{
            padding: "8px 12px", background: "rgba(0,0,0,0.22)",
            borderRadius: 8, fontSize: 16, fontWeight: 900,
            fontFamily: "'Space Mono', monospace",
          }}>
            {priceDisplay}
          </div>
          {isPositive && (
            <div style={{
              padding: "8px 12px", background: "#fff",
              color: venueIsPredMarket ? "#7e22ce" : "#15803d",
              borderRadius: 8, fontSize: 13, fontWeight: 900,
              fontFamily: "'Space Mono', monospace",
            }}>
              +{ev.toFixed(1)}% EV
            </div>
          )}
        </div>
      </div>

      {/* Game context strip */}
      <div style={{
        padding: "10px 18px", background: "#f8fafc",
        borderBottom: "1px solid #e2e8f0", fontSize: 12,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ color: "#334155", fontWeight: 700 }}>
          {sportIcon} {sport} · {teams.away} @ {teams.home}
        </div>
        <div style={{ color: "#64748b", fontSize: 11 }}>
          starts in {formatClose(commenceTime)} · <SourceBadge source={match.source} />
        </div>
      </div>

      {/* Plain-English explanation. Two flavors: book soft vs prediction market soft. */}
      {isPositive && (
        <div style={{ padding: "12px 18px", fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
          {venueIsPredMarket ? (
            <>
              Sportsbook consensus prices {bestBet.team} at{" "}
              <b style={{ color: "#7e22ce" }}>{formatPct(bestBet.predProb)}</b>, but {bestBet.book} shares
              cost only <b style={{ color: "#b91c1c" }}>{formatPct(bestBet.devigProb)}</b>.
              That's a <b>{bestBet.edgePP.toFixed(1)}pp</b> mispricing on the prediction market.
            </>
          ) : (
            <>
              <b>{match.source === "kalshi" ? "Kalshi" : "Polymarket"}</b> prices {bestBet.team} to win at{" "}
              <b style={{ color: "#15803d" }}>{formatPct(bestBet.predProb)}</b>, but <b>{bestBet.book}</b> is
              paying out as if it's only <b style={{ color: "#b91c1c" }}>{formatPct(bestBet.devigProb)}</b>.
              That's a <b>{bestBet.edgePP.toFixed(1)}pp</b> mispricing — the book line is soft.
            </>
          )}
        </div>
      )}

      <div style={{ padding: "0 18px 14px" }}>
        <button
          onClick={() => setExpanded(x => !x)}
          style={{
            border: 0, background: "transparent", color: "#0284c7",
            fontSize: 11, fontWeight: 800, padding: "6px 0", cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {expanded ? "Hide details ▴" : "Show both sides & all books ▾"}
        </button>

        {expanded && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
              <SideColumn
                label={teams.home}
                isBest={bestBet.side === "home"}
                pred={predictionMarket.homeProb}
                book={book.home}
              />
              <SideColumn
                label={teams.away}
                isBest={bestBet.side === "away"}
                pred={predictionMarket.awayProb}
                book={book.away}
              />
            </div>

            {Array.isArray(book.allBooks) && book.allBooks.length > 0 && (
              <AllBooksTable books={book.allBooks} teams={teams} bestBet={bestBet} />
            )}

            <div style={{
              marginTop: 10, fontSize: 10, color: "#94a3b8",
              display: "flex", justifyContent: "flex-end",
            }}>
              <a href={match.marketUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#0284c7", fontWeight: 700, textDecoration: "none" }}>
                View market on {match.source === "kalshi" ? "Kalshi" : "Polymarket"} →
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AllBooksTable({ books, teams, bestBet }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        fontSize: 10, fontWeight: 800, color: "#64748b",
        textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6,
      }}>
        Every book ({books.length})
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#64748b" }}>
              <th style={thStyle}>Book</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{teams.home}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{teams.away}</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b, i) => {
              const isBestHome = bestBet.venue === "book" && bestBet.side === "home" && b.book === bestBet.book;
              const isBestAway = bestBet.venue === "book" && bestBet.side === "away" && b.book === bestBet.book;
              return (
                <tr key={b.book + i} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={tdStyle}>{b.book}</td>
                  <td style={{
                    ...tdStyle, textAlign: "right",
                    fontFamily: "'Space Mono', monospace",
                    background: isBestHome ? "#dcfce7" : "transparent",
                    fontWeight: isBestHome ? 900 : 500,
                  }}>{formatOdds(b.homeAmerican)}</td>
                  <td style={{
                    ...tdStyle, textAlign: "right",
                    fontFamily: "'Space Mono', monospace",
                    background: isBestAway ? "#dcfce7" : "transparent",
                    fontWeight: isBestAway ? 900 : 500,
                  }}>{formatOdds(b.awayAmerican)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle = { textAlign: "left", padding: "6px 8px", fontWeight: 700, fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase" };
const tdStyle = { padding: "5px 8px", color: "#1e293b" };

function SideColumn({ label, isBest, pred, book }) {
  const diff = pred - book.devigProb;
  const diffColor = diff > 0.01 ? "#15803d" : diff < -0.01 ? "#b91c1c" : "#64748b";
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 10,
      background: isBest ? "#f0fdf4" : "#f8fafc",
      border: `1px solid ${isBest ? "#bbf7d0" : "#e2e8f0"}`,
    }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#1e293b", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        {isBest && <span style={{ color: "#15803d" }}>★</span>}
        {label}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11 }}>
        <div style={{ color: "#64748b" }}>Prediction</div>
        <div style={{ textAlign: "right", fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>{formatPct(pred)}</div>

        <div style={{ color: "#64748b" }}>Book devig</div>
        <div style={{ textAlign: "right", fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>{formatPct(book.devigProb)}</div>

        <div style={{ color: "#64748b" }}>Best price</div>
        <div style={{ textAlign: "right", fontFamily: "'Space Mono', monospace", fontWeight: 800, color: "#0c4a6e" }}>
          {formatOdds(book.americanOdds)}
        </div>

        <div style={{ color: "#64748b" }}>Via</div>
        <div style={{ textAlign: "right", fontSize: 10, color: "#475569" }}>{book.bestBook}</div>

        <div style={{ color: "#64748b" }}>Diff</div>
        <div style={{ textAlign: "right", fontFamily: "'Space Mono', monospace", fontWeight: 800, color: diffColor }}>
          {diff >= 0 ? "+" : ""}{(diff * 100).toFixed(1)}pp
        </div>
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
      background: `${color}22`, color, fontWeight: 800, fontSize: 9, letterSpacing: 0.4,
    }}>{label}</span>
  );
}

const selectStyle = {
  padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1",
  fontSize: 12, fontFamily: "inherit", background: "#fff",
};
const filterLabel = { fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 };
