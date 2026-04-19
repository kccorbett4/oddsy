import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import SiteNav from "./SiteNav.jsx";

const SPORTS = [
  { id: "americanfootball_nfl", name: "NFL", icon: "🏈" },
  { id: "basketball_nba", name: "NBA", icon: "🏀" },
  { id: "baseball_mlb", name: "MLB", icon: "⚾" },
  { id: "icehockey_nhl", name: "NHL", icon: "🏒" },
  { id: "mma_mixed_martial_arts", name: "MMA", icon: "🥊" },
  { id: "basketball_ncaab", name: "NCAAB", icon: "🏀" },
  { id: "americanfootball_ncaaf", name: "NCAAF", icon: "🏈" },
  { id: "soccer_usa_mls", name: "MLS", icon: "⚽" },
];

const MARKETS = [
  { id: "h2h", label: "Moneyline" },
  { id: "spreads", label: "Spread" },
  { id: "totals", label: "Total" },
];

const formatOdds = (p) => (p > 0 ? `+${p}` : `${p}`);

const formatTime = (iso) => {
  const d = new Date(iso);
  const now = new Date();
  const diff = d - now;
  const hours = Math.floor(diff / 3600000);
  if (hours < 0) return "LIVE";
  if (hours < 1) return `${Math.floor(diff / 60000)}m`;
  if (hours < 24) return `${hours}h`;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

export default function ShopPage() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState("all");
  const [market, setMarket] = useState("h2h");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const CACHE_KEY = "oddsy_odds_cache:v2";
    const CACHE_DURATION = 10 * 60 * 1000;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION && data.length > 0) {
          setGames(data);
          setLoading(false);
          return;
        }
      }
    } catch {}
    fetch("/api/odds")
      .then(r => r.json())
      .then(j => {
        if (j.games) {
          setGames(j.games);
          try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: j.games, timestamp: Date.now() })); } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const now = Date.now();
  const filtered = games
    .filter(g => (g.commence_time ? new Date(g.commence_time).getTime() > now - 2 * 3600000 : true))
    .filter(g => sport === "all" || g.sport_key === sport)
    .filter(g => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (g.home_team || "").toLowerCase().includes(q) || (g.away_team || "").toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

  const sportsInFeed = [...new Set(games.map(g => g.sport_key))];

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#1a1d23" }}>
      <Helmet>
        <title>Book Shop — Compare Live Odds Side by Side | MyOddsy</title>
        <meta name="description" content="Compare live odds across every major sportsbook in one table. Best price per market is highlighted so you always take the top line." />
        <link rel="canonical" href="https://www.myoddsy.com/shop" />
      </Helmet>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      <SiteNav />

      <header style={{
        background: "linear-gradient(135deg, #1a1d23 0%, #2d3748 100%)",
        color: "#fff", padding: "28px 20px 22px",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: "0 0 6px" }}>🏦 Book Shop</h1>
          <p style={{ fontSize: 14, color: "#cbd5e0", margin: 0, lineHeight: 1.5 }}>
            Every book's price for every outcome, side by side. The highlighted cell is the best line — that's where you want to bet.
          </p>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "18px 16px 110px" }}>
        {/* Filters */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search team or matchup…"
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "10px 14px", borderRadius: 10,
              border: "1px solid #e2e5ea", fontSize: 14,
              fontFamily: "'DM Sans', sans-serif", background: "#fff", outline: "none",
            }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["all", ...sportsInFeed].map(sk => {
              const meta = SPORTS.find(s => s.id === sk);
              const label = sk === "all" ? "All sports" : (meta ? `${meta.icon} ${meta.name}` : sk);
              const active = sport === sk;
              return (
                <button key={sk} onClick={() => setSport(sk)} style={{
                  padding: "6px 12px", borderRadius: 999,
                  border: active ? "1px solid #1a1d23" : "1px solid #e2e5ea",
                  background: active ? "#1a1d23" : "#fff",
                  color: active ? "#fff" : "#1a1d23",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}>{label}</button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {MARKETS.map(m => {
              const active = market === m.id;
              return (
                <button key={m.id} onClick={() => setMarket(m.id)} style={{
                  padding: "7px 16px", borderRadius: 10,
                  border: active ? "1px solid #7c3aed" : "1px solid #e2e5ea",
                  background: active ? "#7c3aed" : "#fff",
                  color: active ? "#fff" : "#1a1d23",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}>{m.label}</button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#8b919a", fontSize: 13 }}>Loading odds…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#8b919a", fontSize: 13 }}>
            No games match. Try a different sport or clear the search.
          </div>
        ) : (
          filtered.map(game => <GameCard key={game.id} game={game} market={market} />)
        )}
      </div>
    </div>
  );
}

function GameCard({ game, market }) {
  // Build: for this market, a list of distinct outcomes (name+point) and,
  // for each, a map of book → price. Also track best price + best book.
  const booksInGame = new Set();
  const outcomesMap = new Map(); // key "name|point" → { name, point, byBook: {book:price} }

  (game.bookmakers || []).forEach(bm => {
    const m = (bm.markets || []).find(x => x.key === market);
    if (!m) return;
    booksInGame.add(bm.title);
    (m.outcomes || []).forEach(o => {
      const pt = o.point === null || o.point === undefined ? "" : o.point;
      // For totals, the point is what separates Over/Under lines (Over 8.5 vs
      // Over 9.5 are different bets). For spreads, same idea. For h2h the
      // point is empty so all entries merge correctly.
      const key = `${o.name}|${pt}`;
      if (!outcomesMap.has(key)) outcomesMap.set(key, { name: o.name, point: o.point, byBook: {} });
      outcomesMap.get(key).byBook[bm.title] = o.price;
    });
  });

  const books = [...booksInGame].sort();
  const outcomes = [...outcomesMap.values()].sort((a, b) => {
    // Sort: home team first for h2h/spreads, Over before Under for totals
    if (market === "totals") {
      if (a.name === "Over" && b.name === "Under") return -1;
      if (a.name === "Under" && b.name === "Over") return 1;
      return (a.point || 0) - (b.point || 0);
    }
    if (a.name === game.home_team) return -1;
    if (b.name === game.home_team) return 1;
    return 0;
  });

  if (outcomes.length === 0 || books.length === 0) {
    return (
      <div style={cardStyle()}>
        <GameHeader game={game} />
        <div style={{ padding: "14px 16px", fontSize: 12, color: "#8b919a" }}>
          No {market === "h2h" ? "moneyline" : market === "spreads" ? "spread" : "total"} lines posted yet.
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle()}>
      <GameHeader game={game} />
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 520 }}>
          <thead>
            <tr style={{ background: "#fafbfc" }}>
              <th style={{ ...thStyle(), textAlign: "left", minWidth: 140 }}>Outcome</th>
              {books.map(b => (
                <th key={b} style={thStyle()}>{b}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {outcomes.map(out => {
              const uniquePrices = [...new Set(Object.values(out.byBook))].sort((a, b) => b - a);
              const best = uniquePrices[0];
              const secondBest = uniquePrices[1];
              const pointStr = out.point !== null && out.point !== undefined
                ? (out.point > 0 ? ` +${out.point}` : ` ${out.point}`) : "";
              return (
                <tr key={`${out.name}|${out.point ?? ""}`}>
                  <td style={{ ...tdStyle(), textAlign: "left", fontWeight: 700 }}>
                    {out.name}{pointStr}
                  </td>
                  {books.map(b => {
                    const price = out.byBook[b];
                    if (price === undefined) return <td key={b} style={{ ...tdStyle(), color: "#c7ccd4" }}>—</td>;
                    const isBest = price === best;
                    const isSecondBest = !isBest && price === secondBest;
                    return (
                      <td key={b} style={{
                        ...tdStyle(),
                        fontFamily: "'Space Mono', monospace",
                        fontWeight: isBest ? 900 : isSecondBest ? 700 : 500,
                        background: isBest ? "#d1fae5" : isSecondBest ? "#ecfdf5" : "transparent",
                        color: isBest ? "#065f46" : isSecondBest ? "#047857" : "#1a1d23",
                      }}>
                        {formatOdds(price)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GameHeader({ game }) {
  const meta = SPORTS.find(s => s.id === game.sport_key);
  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800 }}>
          {game.away_team} <span style={{ color: "#8b919a", fontWeight: 500 }}>@</span> {game.home_team}
        </div>
        <div style={{ fontSize: 11, color: "#8b919a", marginTop: 2 }}>
          {meta ? `${meta.icon} ${meta.name}` : game.sport_key} · {formatTime(game.commence_time)}
        </div>
      </div>
    </div>
  );
}

const cardStyle = () => ({
  background: "#fff", border: "1px solid #e2e5ea", borderRadius: 12,
  marginBottom: 14, overflow: "hidden",
});
const thStyle = () => ({
  padding: "8px 10px", fontSize: 10, fontWeight: 700,
  color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.06em",
  borderBottom: "1px solid #e2e5ea", textAlign: "center",
});
const tdStyle = () => ({
  padding: "10px", textAlign: "center",
  borderBottom: "1px solid #f4f5f7",
});
