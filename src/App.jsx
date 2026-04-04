import { useState, useEffect, useCallback, useRef } from "react";

const SPORTS = [
  { id: "americanfootball_nfl", name: "NFL", icon: "🏈", season: true },
  { id: "basketball_nba", name: "NBA", icon: "🏀", season: true },
  { id: "baseball_mlb", name: "MLB", icon: "⚾", season: true },
  { id: "icehockey_nhl", name: "NHL", icon: "🏒", season: true },
  { id: "mma_mixed_martial_arts", name: "MMA", icon: "🥊", season: true },
  { id: "americanfootball_ncaaf", name: "NCAAF", icon: "🏈", season: false },
];

const BOOKS = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "PointsBet", "BetRivers"];

// Simulated live odds data (structured exactly like The-Odds API response)
const generateMockOdds = () => {
  const teams = {
    basketball_nba: [
      ["Los Angeles Lakers", "Boston Celtics"],
      ["Golden State Warriors", "Dallas Mavericks"],
      ["Milwaukee Bucks", "Philadelphia 76ers"],
      ["Denver Nuggets", "Phoenix Suns"],
      ["Miami Heat", "New York Knicks"],
      ["Minnesota Timberwolves", "Oklahoma City Thunder"],
    ],
    americanfootball_nfl: [
      ["Kansas City Chiefs", "Buffalo Bills"],
      ["San Francisco 49ers", "Dallas Cowboys"],
      ["Baltimore Ravens", "Cincinnati Bengals"],
      ["Detroit Lions", "Green Bay Packers"],
    ],
    baseball_mlb: [
      ["New York Yankees", "Boston Red Sox"],
      ["Los Angeles Dodgers", "San Francisco Giants"],
      ["Houston Astros", "Texas Rangers"],
      ["Atlanta Braves", "Philadelphia Phillies"],
      ["Chicago Cubs", "St. Louis Cardinals"],
    ],
    icehockey_nhl: [
      ["Edmonton Oilers", "Colorado Avalanche"],
      ["Florida Panthers", "New York Rangers"],
      ["Dallas Stars", "Winnipeg Jets"],
    ],
    mma_mixed_martial_arts: [
      ["Jon Jones", "Tom Aspinall"],
      ["Islam Makhachev", "Charles Oliveira"],
    ],
  };

  const allGames = [];
  Object.entries(teams).forEach(([sport, matchups]) => {
    matchups.forEach(([home, away]) => {
      const baseSpread = (Math.random() * 12 - 6).toFixed(1);
      const baseTotal = sport === "basketball_nba" ? 215 + Math.random() * 30 :
        sport === "baseball_mlb" ? 7 + Math.random() * 4 :
        sport === "icehockey_nhl" ? 5 + Math.random() * 2 :
        sport === "americanfootball_nfl" ? 40 + Math.random() * 15 : null;

      const bookmakers = BOOKS.map(book => {
        const spreadVariance = (Math.random() * 1.5 - 0.75).toFixed(1);
        const totalVariance = baseTotal ? (Math.random() * 2 - 1).toFixed(1) : null;
        const homeML = Math.round(-110 + (Math.random() * 200 - 100));
        const awayML = homeML > 0 ? Math.round(-100 - Math.random() * 150) : Math.round(100 + Math.random() * 200);

        return {
          key: book.toLowerCase().replace(/\s/g, ''),
          title: book,
          markets: [
            {
              key: "spreads",
              outcomes: [
                { name: home, price: -110 + Math.round(Math.random() * 10 - 5), point: parseFloat(baseSpread) + parseFloat(spreadVariance) },
                { name: away, price: -110 + Math.round(Math.random() * 10 - 5), point: -(parseFloat(baseSpread) + parseFloat(spreadVariance)) },
              ]
            },
            {
              key: "h2h",
              outcomes: [
                { name: home, price: homeML },
                { name: away, price: awayML },
              ]
            },
            ...(baseTotal ? [{
              key: "totals",
              outcomes: [
                { name: "Over", price: -110 + Math.round(Math.random() * 10 - 5), point: parseFloat(baseTotal) + parseFloat(totalVariance) },
                { name: "Under", price: -110 + Math.round(Math.random() * 10 - 5), point: parseFloat(baseTotal) + parseFloat(totalVariance) },
              ]
            }] : [])
          ]
        };
      });

      const commence = new Date();
      commence.setHours(commence.getHours() + Math.floor(Math.random() * 72));

      allGames.push({
        id: `${sport}_${home.replace(/\s/g, '')}_${away.replace(/\s/g, '')}`,
        sport_key: sport,
        sport_title: SPORTS.find(s => s.id === sport)?.name || sport,
        commence_time: commence.toISOString(),
        home_team: home,
        away_team: away,
        bookmakers,
      });
    });
  });

  return allGames;
};

// Calculate implied probability from American odds
const impliedProb = (odds) => {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
};

// Calculate expected value
const calcEV = (odds, estimatedProb) => {
  const payout = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  return (estimatedProb * payout - (1 - estimatedProb)) * 100;
};

// Find value bets by comparing across books
const findValueBets = (games) => {
  const valueBets = [];

  games.forEach(game => {
    const marketTypes = ["h2h", "spreads", "totals"];
    marketTypes.forEach(marketType => {
      const allOutcomes = {};

      game.bookmakers.forEach(book => {
        const market = book.markets.find(m => m.key === marketType);
        if (!market) return;

        market.outcomes.forEach(outcome => {
          const key = `${outcome.name}_${outcome.point || ''}`;
          if (!allOutcomes[key]) allOutcomes[key] = [];
          allOutcomes[key].push({ ...outcome, book: book.title });
        });
      });

      Object.entries(allOutcomes).forEach(([key, outcomes]) => {
        if (outcomes.length < 3) return;

        const probs = outcomes.map(o => impliedProb(o.price));
        const avgProb = probs.reduce((a, b) => a + b, 0) / probs.length;
        const vigFreeProb = avgProb * 0.95; // rough vig removal

        outcomes.forEach(outcome => {
          const thisProb = impliedProb(outcome.price);
          const ev = calcEV(outcome.price, vigFreeProb);
          const edgePercent = ((vigFreeProb - thisProb) / thisProb * 100);

          if (ev > 2 && edgePercent > 2) {
            valueBets.push({
              game,
              marketType,
              outcome: outcome.name,
              point: outcome.point,
              odds: outcome.price,
              book: outcome.book,
              ev: ev.toFixed(1),
              edge: edgePercent.toFixed(1),
              avgProb: (vigFreeProb * 100).toFixed(1),
              impliedProb: (thisProb * 100).toFixed(1),
              commence: game.commence_time,
            });
          }
        });
      });
    });
  });

  return valueBets.sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev)).slice(0, 25);
};

// Generate 3-leg parlays from undervalued bets across different sports
const generateParlays = (valueBets) => {
  if (valueBets.length < 3) return [];

  const bySport = {};
  valueBets.forEach(bet => {
    const key = bet.game.sport_key;
    if (!bySport[key]) bySport[key] = [];
    bySport[key].push(bet);
  });

  const sportKeys = Object.keys(bySport);
  const parlays = [];

  // Strategy 1: Cross-Sport Value — best from 3 different sports
  if (sportKeys.length >= 3) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const shuffled = [...sportKeys].sort(() => Math.random() - 0.5);
      const legs = shuffled.slice(0, 3).map(sk => {
        const pool = bySport[sk];
        return pool[Math.floor(Math.random() * Math.min(pool.length, 3))];
      });
      if (legs.every(Boolean) && new Set(legs.map(l => l.game.id)).size === 3) {
        parlays.push({ legs, strategy: "Cross-Sport Value", icon: "🌐", desc: "Top +EV picks across 3 different sports for maximum diversification" });
      }
    }
  }

  // Strategy 2: Chalk Crusher — 3 underdog value plays
  const underdogs = valueBets.filter(b => b.odds > 100).sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev));
  if (underdogs.length >= 3) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const pool = [...underdogs].sort(() => Math.random() - 0.5);
      const legs = []; const usedGames = new Set();
      for (const bet of pool) { if (!usedGames.has(bet.game.id) && legs.length < 3) { legs.push(bet); usedGames.add(bet.game.id); } }
      if (legs.length === 3) parlays.push({ legs, strategy: "Chalk Crusher", icon: "💥", desc: "3 undervalued underdogs with positive expected value — high risk, high reward" });
    }
  }

  // Strategy 3: Sharp Consensus — highest EV bets
  const topEV = [...valueBets].sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev));
  const sharpLegs = []; const usedG1 = new Set();
  for (const bet of topEV) { if (!usedG1.has(bet.game.id) && sharpLegs.length < 3) { sharpLegs.push(bet); usedG1.add(bet.game.id); } }
  if (sharpLegs.length === 3) parlays.push({ legs: sharpLegs, strategy: "Sharp Consensus", icon: "🎯", desc: "The 3 highest expected value bets on the board — what the sharps are eyeing" });

  // Strategy 4: Safe + Sprinkle — 2 favorites + 1 big underdog
  const favorites = valueBets.filter(b => b.odds < 0 && b.odds > -200).sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev));
  const bigDogs = valueBets.filter(b => b.odds > 150).sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev));
  if (favorites.length >= 2 && bigDogs.length >= 1) {
    const usedG2 = new Set(); const legs = [];
    for (const f of favorites) { if (!usedG2.has(f.game.id) && legs.length < 2) { legs.push(f); usedG2.add(f.game.id); } }
    for (const d of bigDogs) { if (!usedG2.has(d.game.id) && legs.length < 3) { legs.push(d); usedG2.add(d.game.id); } }
    if (legs.length === 3) parlays.push({ legs, strategy: "Safe + Sprinkle", icon: "🛡️", desc: "2 solid value favorites anchoring 1 high-upside underdog — balanced risk" });
  }

  // Calculate combined odds for each parlay
  return parlays.map(parlay => {
    let combinedDecimal = 1;
    let combinedProb = 1;
    parlay.legs.forEach(leg => {
      const dec = leg.odds > 0 ? (leg.odds / 100) + 1 : (100 / Math.abs(leg.odds)) + 1;
      combinedDecimal *= dec;
      combinedProb *= parseFloat(leg.avgProb) / 100;
    });
    const combinedAmerican = combinedDecimal >= 2 ? Math.round((combinedDecimal - 1) * 100) : Math.round(-100 / (combinedDecimal - 1));
    const parlayEV = ((combinedProb * (combinedDecimal - 1) - (1 - combinedProb)) * 100).toFixed(1);

    return {
      ...parlay,
      combinedOdds: combinedAmerican,
      combinedDecimal: combinedDecimal.toFixed(2),
      impliedProb: (combinedProb * 100).toFixed(1),
      payout100: Math.round((combinedDecimal - 1) * 100),
      avgLegEV: (parlay.legs.reduce((a, l) => a + parseFloat(l.ev), 0) / 3).toFixed(1),
      parlayEV,
    };
  });
};

const formatOdds = (odds) => (odds > 0 ? `+${odds}` : `${odds}`);

const formatTime = (iso) => {
  const d = new Date(iso);
  const now = new Date();
  const diff = d - now;
  const hours = Math.floor(diff / 3600000);
  if (hours < 0) return "LIVE";
  if (hours < 1) return `${Math.floor(diff / 60000)}m`;
  if (hours < 24) return `${hours}h`;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// ─── Components ─────────────────────────────────────────

const Pill = ({ active, onClick, children, accent }) => (
  <button
    onClick={onClick}
    style={{
      padding: "8px 16px",
      borderRadius: 20,
      border: active ? `1.5px solid ${accent || '#00f0ff'}` : "1.5px solid rgba(255,255,255,0.12)",
      background: active ? `${accent || '#00f0ff'}15` : "rgba(255,255,255,0.05)",
      color: active ? (accent || '#00f0ff') : "rgba(255,255,255,0.6)",
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer",
      transition: "all 0.2s",
      fontFamily: "'DM Sans', sans-serif",
      letterSpacing: "0.02em",
    }}
  >
    {children}
  </button>
);

const StatCard = ({ label, value, sub, color }) => (
  <div style={{
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: "18px 20px",
    flex: 1,
    minWidth: 130,
  }}>
    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{label}</div>
    <div style={{ fontSize: 28, fontWeight: 800, color: color || "#fff", marginTop: 6, fontFamily: "'Space Mono', monospace" }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{sub}</div>}
  </div>
);

const ValueBetCard = ({ bet, index }) => {
  const evColor = parseFloat(bet.ev) > 5 ? "#00ff88" : parseFloat(bet.ev) > 3 ? "#00f0ff" : "#f0c800";
  const marketLabel = bet.marketType === "h2h" ? "Moneyline" : bet.marketType === "spreads" ? "Spread" : "Total";

  return (
    <div style={{
      background: "linear-gradient(135deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.015) 100%)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderLeft: `3px solid ${evColor}`,
      borderRadius: 12,
      padding: "16px 18px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 14,
      transition: "all 0.2s",
      cursor: "pointer",
      animation: `fadeSlideIn 0.4s ease ${index * 0.05}s both`,
    }}
    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
    onMouseLeave={e => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.01) 100%)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, background: "rgba(255,255,255,0.08)", padding: "3px 8px", borderRadius: 4, color: "rgba(255,255,255,0.6)", fontWeight: 700, letterSpacing: "0.05em" }}>
            {bet.game.sport_title}
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{formatTime(bet.commence)}</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
          {bet.outcome} {bet.point ? `(${bet.point > 0 ? '+' : ''}${bet.point})` : ''} — {marketLabel}
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
          {bet.game.away_team} @ {bet.game.home_team}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: evColor, fontFamily: "'Space Mono', monospace" }}>
          +{bet.ev}%
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 2 }}>Expected Value</div>
        <div style={{
          fontSize: 15,
          fontWeight: 700,
          color: "#fff",
          background: "rgba(255,255,255,0.08)",
          padding: "4px 10px",
          borderRadius: 6,
          fontFamily: "'Space Mono', monospace",
        }}>
          {formatOdds(bet.odds)}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
          {bet.book}
        </div>
      </div>
    </div>
  );
};

const OddsRow = ({ game }) => {
  const bestH2H = { home: { odds: -Infinity, book: "" }, away: { odds: -Infinity, book: "" } };
  game.bookmakers.forEach(b => {
    const h2h = b.markets.find(m => m.key === "h2h");
    if (!h2h) return;
    if (h2h.outcomes[0]?.price > bestH2H.home.odds) { bestH2H.home = { odds: h2h.outcomes[0].price, book: b.title }; }
    if (h2h.outcomes[1]?.price > bestH2H.away.odds) { bestH2H.away = { odds: h2h.outcomes[1].price, book: b.title }; }
  });

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr auto auto auto",
      gap: 12,
      alignItems: "center",
      padding: "12px 16px",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      fontSize: 13,
    }}>
      <div>
        <div style={{ fontWeight: 700, color: "#fff", fontSize: 14, marginBottom: 3 }}>{game.away_team}</div>
        <div style={{ fontWeight: 600, color: "rgba(255,255,255,0.5)", fontSize: 13 }}>@ {game.home_team}</div>
      </div>
      <div style={{ textAlign: "center", minWidth: 50 }}>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginBottom: 2 }}>TIME</div>
        <div style={{
          color: formatTime(game.commence_time) === "LIVE" ? "#ff4444" : "rgba(255,255,255,0.5)",
          fontWeight: 700,
          fontSize: 12,
          fontFamily: "'Space Mono', monospace",
        }}>
          {formatTime(game.commence_time)}
        </div>
      </div>
      <div style={{ textAlign: "center", minWidth: 65 }}>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginBottom: 2 }}>BEST ML</div>
        <div style={{ color: "#00f0ff", fontWeight: 700, fontFamily: "'Space Mono', monospace", fontSize: 13 }}>
          {formatOdds(bestH2H.away.odds)}
        </div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{bestH2H.away.book}</div>
      </div>
      <div style={{ textAlign: "center", minWidth: 65 }}>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginBottom: 2 }}>BEST ML</div>
        <div style={{ color: "#00ff88", fontWeight: 700, fontFamily: "'Space Mono', monospace", fontSize: 13 }}>
          {formatOdds(bestH2H.home.odds)}
        </div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{bestH2H.home.book}</div>
      </div>
    </div>
  );
};

// ─── Alert Builder ──────────────────────────────────────

const AlertBuilder = ({ onClose }) => {
  const [alertSport, setAlertSport] = useState("any");
  const [alertType, setAlertType] = useState("ev");
  const [threshold, setThreshold] = useState("3");
  const [book, setBook] = useState("any");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 1500);
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 20,
    }}
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "linear-gradient(180deg, #1a1a2e 0%, #12121f 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 20,
        padding: 28,
        width: "100%",
        maxWidth: 420,
        animation: "fadeSlideIn 0.3s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#fff" }}>Create Alert</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {saved ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#00ff88" }}>Alert Created!</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>You'll be notified when conditions are met</div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, display: "block", marginBottom: 8 }}>Sport</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Pill active={alertSport === "any"} onClick={() => setAlertSport("any")}>Any</Pill>
                {SPORTS.filter(s => s.season).map(s => (
                  <Pill key={s.id} active={alertSport === s.id} onClick={() => setAlertSport(s.id)}>{s.icon} {s.name}</Pill>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, display: "block", marginBottom: 8 }}>Alert When</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Pill active={alertType === "ev"} onClick={() => setAlertType("ev")} accent="#00ff88">+EV Bet Found</Pill>
                <Pill active={alertType === "line"} onClick={() => setAlertType("line")} accent="#f0c800">Line Movement</Pill>
                <Pill active={alertType === "underdog"} onClick={() => setAlertType("underdog")} accent="#ff6b6b">Big Underdog</Pill>
                <Pill active={alertType === "total"} onClick={() => setAlertType("total")} accent="#a78bfa">Total Shift</Pill>
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, display: "block", marginBottom: 8 }}>
                {alertType === "ev" ? "Minimum EV %" : alertType === "line" ? "Min Points Moved" : alertType === "underdog" ? "Min Odds (e.g. +300)" : "Min Total Shift"}
              </label>
              <input
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  color: "#fff",
                  fontSize: 15,
                  fontFamily: "'Space Mono', monospace",
                  fontWeight: 700,
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, display: "block", marginBottom: 8 }}>Sportsbook</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Pill active={book === "any"} onClick={() => setBook("any")}>Any</Pill>
                {BOOKS.slice(0, 4).map(b => (
                  <Pill key={b} active={book === b} onClick={() => setBook(b)}>{b}</Pill>
                ))}
              </div>
            </div>

            <button onClick={handleSave} style={{
              width: "100%",
              padding: "13px",
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(135deg, #00f0ff, #00cc88)",
              color: "#000",
              fontSize: 14,
              fontWeight: 800,
              cursor: "pointer",
              letterSpacing: "0.03em",
              fontFamily: "'DM Sans', sans-serif",
            }}>
              🔔 Activate Alert
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Main App ───────────────────────────────────────────

export default function App() {
  const [games, setGames] = useState([]);
  const [valueBets, setValueBets] = useState([]);
  const [activeSport, setActiveSport] = useState("all");
  const [activeTab, setActiveTab] = useState("value");
  const [showAlertBuilder, setShowAlertBuilder] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [parlays, setParlays] = useState([]);
  const [parlayKey, setParlayKey] = useState(0);
  const [wagerAmount, setWagerAmount] = useState(25);

  useEffect(() => {
    const data = generateMockOdds();
    setGames(data);
    const vb = findValueBets(data);
    setValueBets(vb);
    setParlays(generateParlays(vb));
    setLastRefresh(new Date());
  }, [refreshKey]);

  useEffect(() => {
    if (valueBets.length > 0) setParlays(generateParlays(valueBets));
  }, [parlayKey]);

  const filteredGames = games.filter(g => {
    const sportMatch = activeSport === "all" || g.sport_key === activeSport;
    const searchMatch = !searchQuery || g.home_team.toLowerCase().includes(searchQuery.toLowerCase()) || g.away_team.toLowerCase().includes(searchQuery.toLowerCase());
    return sportMatch && searchMatch;
  });

  const filteredValue = valueBets.filter(v => {
    const sportMatch = activeSport === "all" || v.game.sport_key === activeSport;
    return sportMatch;
  });

  const avgEV = filteredValue.length > 0 ? (filteredValue.reduce((a, b) => a + parseFloat(b.ev), 0) / filteredValue.length).toFixed(1) : "0";
  const topEdge = filteredValue.length > 0 ? filteredValue[0]?.ev : "0";

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #0a0a14 0%, #0d0d1a 50%, #0a0a14 100%)",
      color: "#fff",
      fontFamily: "'DM Sans', sans-serif",
      overflow: "hidden",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        * { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        input::placeholder { color: rgba(255,255,255,0.2); }
      `}</style>

      {/* Ambient glow */}
      <div style={{
        position: "fixed", top: -200, right: -200, width: 500, height: 500,
        background: "radial-gradient(circle, rgba(0,240,255,0.03) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "fixed", bottom: -200, left: -200, width: 500, height: 500,
        background: "radial-gradient(circle, rgba(0,255,136,0.02) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Header */}
      <header style={{
        padding: "16px 20px 0",
        animation: "fadeSlideIn 0.5s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div>
            <h1 style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 900,
              letterSpacing: "-0.03em",
              background: "linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.7) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>
              MyOddsy
            </h1>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontFamily: "'Space Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Smart Betting Intelligence
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
                padding: "8px 12px",
                color: "rgba(255,255,255,0.5)",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              ↻
            </button>
            <div style={{
              width: 8, height: 8, borderRadius: 4,
              background: "#00ff88",
              animation: "pulse 2s infinite",
              boxShadow: "0 0 8px rgba(0,255,136,0.5)",
            }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "'Space Mono', monospace" }}>LIVE</span>
          </div>
        </div>
      </header>

      {/* Nav Tabs */}
      <nav style={{
        display: "flex",
        gap: 0,
        padding: "12px 20px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}>
        {[
          { id: "value", label: "Value Bets", icon: "⚡" },
          { id: "parlays", label: "Parlays", icon: "🎰" },
          { id: "odds", label: "Odds", icon: "📊" },
          { id: "alerts", label: "Alerts", icon: "🔔" },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              padding: "10px 0",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid #00f0ff" : "2px solid transparent",
              background: "none",
              color: activeTab === tab.id ? "#fff" : "rgba(255,255,255,0.3)",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
              transition: "all 0.2s",
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      {/* Sport Filter */}
      <div style={{
        display: "flex",
        gap: 6,
        padding: "14px 20px",
        overflowX: "auto",
      }}>
        <Pill active={activeSport === "all"} onClick={() => setActiveSport("all")}>All</Pill>
        {SPORTS.filter(s => s.season).map(s => (
          <Pill key={s.id} active={activeSport === s.id} onClick={() => setActiveSport(s.id)}>
            {s.icon} {s.name}
          </Pill>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "0 20px 100px", animation: "fadeSlideIn 0.5s ease 0.1s both" }}>

        {/* ── VALUE BETS TAB ── */}
        {activeTab === "value" && (
          <>
            {/* How it works explainer */}
            <div style={{
              background: "linear-gradient(135deg, rgba(0,240,255,0.05) 0%, rgba(0,255,136,0.03) 100%)",
              border: "1px solid rgba(0,240,255,0.1)",
              borderRadius: 14,
              padding: "16px 18px",
              marginBottom: 18,
            }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginBottom: 6 }}>How We Find Value Bets</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
                We compare odds from <strong style={{ color: "rgba(255,255,255,0.7)" }}>6 sportsbooks</strong> for every game.
                When one book's odds are better than the average, that's a <strong style={{ color: "#00ff88" }}>+EV (positive expected value)</strong> bet —
                meaning the payout is higher than the true probability suggests. The higher the <strong style={{ color: "#00f0ff" }}>EV%</strong>, the bigger the edge.
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 18, overflowX: "auto" }}>
              <StatCard label="Bets Found" value={filteredValue.length} sub="with a positive edge" />
              <StatCard label="Best Edge" value={`+${topEdge}%`} color="#00ff88" sub="expected value" />
              <StatCard label="Avg Edge" value={`+${avgEV}%`} color="#00f0ff" sub="across all bets" />
            </div>

            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
            }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.9)" }}>
                Top Value Picks
              </h2>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: "'Space Mono', monospace" }}>
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredValue.map((bet, i) => (
                <ValueBetCard key={`${bet.game.id}-${bet.outcome}-${bet.book}`} bet={bet} index={i} />
              ))}
              {filteredValue.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.25)" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                  <div style={{ fontSize: 13 }}>No value bets found for this filter</div>
                </div>
              )}
            </div>

            {/* Affiliate CTA */}
            <div style={{
              marginTop: 20,
              background: "linear-gradient(135deg, rgba(0,240,255,0.08) 0%, rgba(0,204,136,0.05) 100%)",
              border: "1px solid rgba(0,240,255,0.15)",
              borderRadius: 14,
              padding: 18,
              textAlign: "center",
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", marginBottom: 4 }}>Place these bets on DraftKings</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>New users get up to $1,000 in bonus bets</div>
              <button style={{
                padding: "10px 28px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg, #00f0ff, #00cc88)",
                color: "#000",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
                letterSpacing: "0.02em",
              }}>
                Claim Bonus →
              </button>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", marginTop: 6 }}>21+ | Gambling problem? Call 1-800-522-4700</div>
            </div>
          </>
        )}

        {/* ── PARLAYS TAB ── */}
        {activeTab === "parlays" && (
          <>
            {/* Parlay explainer */}
            <div style={{
              background: "linear-gradient(135deg, rgba(168,85,247,0.06) 0%, rgba(0,240,255,0.03) 100%)",
              border: "1px solid rgba(168,85,247,0.1)",
              borderRadius: 14,
              padding: "16px 18px",
              marginBottom: 18,
            }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginBottom: 6 }}>How Our Parlays Work</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
                We combine <strong style={{ color: "rgba(255,255,255,0.7)" }}>3 positive-value bets</strong> into parlays using different strategies.
                Each leg has a proven edge from our odds comparison. Choose your wager amount below to see potential payouts.
                Hit <strong style={{ color: "#00f0ff" }}>Regenerate</strong> for fresh combinations.
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#fff" }}>3-Leg Value Parlays</h2>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>Built from the best +EV bets across all sports</div>
              </div>
              <button
                onClick={() => setParlayKey(k => k + 1)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,240,255,0.2)",
                  background: "rgba(0,240,255,0.06)",
                  color: "#00f0ff",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                ↻ Regenerate
              </button>
            </div>

            {/* Wager input */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10, marginBottom: 18,
              background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 12, padding: "10px 14px",
            }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>Wager Amount</span>
              <div style={{ display: "flex", gap: 6 }}>
                {[10, 25, 50, 100].map(amt => (
                  <button key={amt} onClick={() => setWagerAmount(amt)} style={{
                    padding: "5px 12px", borderRadius: 8, border: "none",
                    background: wagerAmount === amt ? "rgba(0,240,255,0.15)" : "rgba(255,255,255,0.04)",
                    color: wagerAmount === amt ? "#00f0ff" : "rgba(255,255,255,0.4)",
                    fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Space Mono', monospace",
                  }}>
                    ${amt}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {parlays.map((parlay, pi) => (
                <div key={`${parlay.strategy}-${pi}-${parlayKey}`} style={{
                  background: "linear-gradient(135deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.008) 100%)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 16,
                  overflow: "hidden",
                  animation: `fadeSlideIn 0.4s ease ${pi * 0.08}s both`,
                }}>
                  {/* Parlay Header */}
                  <div style={{
                    padding: "14px 16px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>
                        {parlay.icon} {parlay.strategy}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2, maxWidth: 240 }}>
                        {parlay.desc}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{
                        fontSize: 22, fontWeight: 900, fontFamily: "'Space Mono', monospace",
                        color: parseFloat(parlay.parlayEV) > 5 ? "#00ff88" : "#00f0ff",
                      }}>
                        {formatOdds(parlay.combinedOdds)}
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>combined odds</div>
                    </div>
                  </div>

                  {/* Legs */}
                  {parlay.legs.map((leg, li) => {
                    const marketLabel = leg.marketType === "h2h" ? "ML" : leg.marketType === "spreads" ? "SPR" : "TOT";
                    const sportIcon = SPORTS.find(s => s.id === leg.game.sport_key)?.icon || "🏅";
                    return (
                      <div key={li} style={{
                        padding: "10px 16px",
                        borderBottom: li < 2 ? "1px solid rgba(255,255,255,0.03)" : "none",
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: 8,
                            background: "rgba(255,255,255,0.04)", display: "flex",
                            alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0,
                          }}>
                            {sportIcon}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {leg.outcome} {leg.point ? `(${leg.point > 0 ? '+' : ''}${leg.point})` : ''}
                            </div>
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {leg.game.away_team} @ {leg.game.home_team}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <span style={{
                            fontSize: 10, padding: "2px 6px", borderRadius: 4,
                            background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontWeight: 700,
                          }}>{marketLabel}</span>
                          <span style={{
                            fontSize: 14, fontWeight: 800, fontFamily: "'Space Mono', monospace",
                            color: leg.odds > 0 ? "#00ff88" : "#fff",
                          }}>
                            {formatOdds(leg.odds)}
                          </span>
                          <span style={{
                            fontSize: 10, color: "#00f0ff", fontWeight: 700, fontFamily: "'Space Mono', monospace",
                          }}>+{leg.ev}%</span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Parlay Footer — payout info */}
                  <div style={{
                    padding: "12px 16px",
                    background: "rgba(0,240,255,0.03)",
                    borderTop: "1px solid rgba(0,240,255,0.08)",
                    display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8,
                  }}>
                    <div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Payout</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#00ff88", fontFamily: "'Space Mono', monospace" }}>
                        ${(wagerAmount * (parseFloat(parlay.combinedDecimal) - 1)).toFixed(0)}
                      </div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>on ${wagerAmount} bet</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Parlay EV</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: parseFloat(parlay.parlayEV) > 0 ? "#00f0ff" : "#ff4444", fontFamily: "'Space Mono', monospace" }}>
                        {parseFloat(parlay.parlayEV) > 0 ? "+" : ""}{parlay.parlayEV}%
                      </div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>expected value</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Win Prob</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "rgba(255,255,255,0.7)", fontFamily: "'Space Mono', monospace" }}>
                        {parlay.impliedProb}%
                      </div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>estimated</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Affiliate CTA for parlays */}
            <div style={{
              marginTop: 20,
              background: "linear-gradient(135deg, rgba(168,85,247,0.1) 0%, rgba(0,240,255,0.05) 100%)",
              border: "1px solid rgba(168,85,247,0.15)",
              borderRadius: 14,
              padding: 18,
              textAlign: "center",
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", marginBottom: 4 }}>Build these parlays on FanDuel</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>New users: Bet $5, Get $200 in bonus bets</div>
              <button style={{
                padding: "10px 28px", borderRadius: 10, border: "none",
                background: "linear-gradient(135deg, #a855f7, #6366f1)",
                color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer",
              }}>
                Build Parlay →
              </button>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", marginTop: 6 }}>21+ | Gambling problem? Call 1-800-522-4700</div>
            </div>

          </>
        )}

        {/* ── LIVE ODDS TAB ── */}
        {activeTab === "odds" && (
          <>
            <div style={{ marginBottom: 14 }}>
              <input
                placeholder="Search teams..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.03)",
                  color: "#fff",
                  fontSize: 13,
                  fontFamily: "'DM Sans', sans-serif",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 14,
              overflow: "hidden",
            }}>
              <div style={{
                padding: "10px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                fontSize: 11,
                fontWeight: 700,
                color: "rgba(255,255,255,0.3)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto",
                gap: 12,
              }}>
                <span>Matchup</span>
                <span style={{ textAlign: "center", minWidth: 50 }}>Time</span>
                <span style={{ textAlign: "center", minWidth: 65 }}>Away</span>
                <span style={{ textAlign: "center", minWidth: 65 }}>Home</span>
              </div>
              {filteredGames.map(g => <OddsRow key={g.id} game={g} />)}
              {filteredGames.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
                  No games found
                </div>
              )}
            </div>
          </>
        )}

        {/* ── ALERTS TAB ── */}
        {activeTab === "alerts" && (
          <>
            <div style={{
              textAlign: "center",
              padding: "20px 0",
            }}>
              <button
                onClick={() => setShowAlertBuilder(true)}
                style={{
                  padding: "13px 28px",
                  borderRadius: 12,
                  border: "none",
                  background: "linear-gradient(135deg, #00f0ff, #00cc88)",
                  color: "#000",
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                  fontFamily: "'DM Sans', sans-serif",
                  marginBottom: 20,
                }}
              >
                + Create New Alert
              </button>
            </div>

            {/* Sample alerts */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { type: "+EV Bet", sport: "NBA", condition: "EV > 3%", status: "active", triggered: "2 hits today" },
                { type: "Line Move", sport: "NFL", condition: "> 2 pts", status: "active", triggered: "Last: 3h ago" },
                { type: "Underdog", sport: "Any", condition: "ML > +300", status: "paused", triggered: "5 hits this week" },
              ].map((alert, i) => (
                <div key={i} style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  animation: `fadeSlideIn 0.4s ease ${i * 0.1}s both`,
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 2 }}>{alert.type}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{alert.sport} · {alert.condition}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>{alert.triggered}</div>
                  </div>
                  <div style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    background: alert.status === "active" ? "rgba(0,255,136,0.1)" : "rgba(255,255,255,0.04)",
                    color: alert.status === "active" ? "#00ff88" : "rgba(255,255,255,0.3)",
                    border: `1px solid ${alert.status === "active" ? "rgba(0,255,136,0.2)" : "rgba(255,255,255,0.06)"}`,
                  }}>
                    {alert.status}
                  </div>
                </div>
              ))}
            </div>

            {/* How alerts work */}
            <div style={{
              marginTop: 20,
              padding: 16,
              borderRadius: 12,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.04)",
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>How Alerts Work</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
                Set your criteria and we scan odds across 6+ sportsbooks every 60 seconds. When conditions are met, you get a push notification with the bet details and best available line.
              </div>
            </div>
          </>
        )}
      </div>

      {showAlertBuilder && <AlertBuilder onClose={() => setShowAlertBuilder(false)} />}
    </div>
  );
}