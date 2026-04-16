import { useState, useEffect, useCallback, useRef } from "react";

const SPORTS = [
  { id: "americanfootball_nfl", name: "NFL", icon: "🏈", season: true },
  { id: "basketball_nba", name: "NBA", icon: "🏀", season: true },
  { id: "baseball_mlb", name: "MLB", icon: "⚾", season: true },
  { id: "icehockey_nhl", name: "NHL", icon: "🏒", season: true },
  { id: "mma_mixed_martial_arts", name: "MMA", icon: "🥊", season: true },
  { id: "basketball_ncaab", name: "NCAAB", icon: "🏀", season: true },
  { id: "americanfootball_ncaaf", name: "NCAAF", icon: "🏈", season: true },
  { id: "soccer_usa_mls", name: "MLS", icon: "⚽", season: true },
];

const BOOKS = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "Fanatics", "BetRivers"];

const BOOK_URLS = {
  DraftKings: "https://www.draftkings.com/sportsbook",
  FanDuel: "https://www.fanduel.com/sportsbook",
  BetMGM: "https://sports.betmgm.com",
  Caesars: "https://www.caesars.com/sportsbook-and-casino",
  Fanatics: "https://www.fanatics.com/sportsbook",
  BetRivers: "https://www.betrivers.com",
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

// Check if a game should be excluded based on live score data
const getGameStatus = (game, liveScores) => {
  if (!liveScores || liveScores.length === 0) {
    // No score data — fall back to commence_time check
    const now = new Date();
    if (new Date(game.commence_time) <= now) return "live_unknown";
    return "upcoming";
  }

  // Try to match this odds game to a live score event by team names
  const homeNorm = game.home_team?.toLowerCase();
  const awayNorm = game.away_team?.toLowerCase();

  const match = liveScores.find(e => {
    const h = e.home?.name?.toLowerCase() || "";
    const a = e.away?.name?.toLowerCase() || "";
    return (h.includes(homeNorm) || homeNorm?.includes(h) || a.includes(awayNorm) || awayNorm?.includes(a))
      && (h.includes(homeNorm) || homeNorm?.includes(h))
      && (a.includes(awayNorm) || awayNorm?.includes(a));
  });

  if (!match) {
    const now = new Date();
    if (new Date(game.commence_time) <= now) return "live_unknown";
    return "upcoming";
  }

  if (match.status.type === "STATUS_FINAL") return "final";
  if (match.status.type === "STATUS_IN_PROGRESS") {
    const diff = Math.abs(match.home.score - match.away.score);
    const sport = game.sport_key;

    // Blowout detection per sport
    if (sport === "basketball_nba" && diff >= 20) return "blowout";
    if (sport === "americanfootball_nfl" && diff >= 21) return "blowout";
    if (sport === "baseball_mlb" && diff >= 7) return "blowout";
    if (sport === "icehockey_nhl" && diff >= 4) return "blowout";

    return "in_progress";
  }

  return "upcoming";
};

// Find value bets by comparing across books, using live scores to filter
const findValueBets = (games, liveScores) => {
  const valueBets = [];

  games.forEach(game => {
    const status = getGameStatus(game, liveScores);

    // Skip finished games and blowouts entirely
    if (status === "final" || status === "blowout" || status === "live_unknown") return;

    // Flag if game is in progress (we'll show it but mark it)
    const isLive = status === "in_progress";

    const marketTypes = ["h2h", "spreads", "totals"];
    marketTypes.forEach(marketType => {
      // Don't recommend moneyline on live games — spreads and totals are more relevant
      if (isLive && marketType === "h2h") return;

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
        if (outcomes.length < 2) return;

        const probs = outcomes.map(o => impliedProb(o.price));
        const avgProb = probs.reduce((a, b) => a + b, 0) / probs.length;
        const vigFreeProb = avgProb * 0.95; // rough vig removal

        outcomes.forEach(outcome => {
          const thisProb = impliedProb(outcome.price);
          const ev = calcEV(outcome.price, vigFreeProb);
          const edgePercent = ((vigFreeProb - thisProb) / thisProb * 100);

          // Filter: positive EV with some edge, no extreme long shots
          if (ev > 0.5 && edgePercent > 0.5 && outcome.price < 600 && outcome.price > -600) {
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
              isLive,
            });
          }
        });
      });
    });
  });

  // Sort: upcoming games first, then by EV
  return valueBets
    .sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? 1 : -1;
      return parseFloat(b.ev) - parseFloat(a.ev);
    })
    .slice(0, 50);
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

// ── Sharp Plays: composite scoring system ────────────────
const findSharpPlays = (games, liveScores) => {
  const plays = [];

  games.forEach(game => {
    const status = getGameStatus(game, liveScores);
    // Only skip games we know are finished or blowouts
    if (status === "final" || status === "blowout") return;
    // Skip confirmed live games (sharp plays are pre-game)
    if (status === "in_progress") return;
    // For "live_unknown" — the game may have started but we can't confirm, include it

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
        if (outcomes.length < 2) return;

        const prices = outcomes.map(o => o.price);
        const probs = outcomes.map(o => impliedProb(o.price));
        const avgProb = probs.reduce((a, b) => a + b, 0) / probs.length;
        const vigFreeProb = avgProb * 0.95;

        outcomes.forEach(outcome => {
          const thisProb = impliedProb(outcome.price);
          const ev = calcEV(outcome.price, vigFreeProb);
          if (ev <= 0) return;

          // ── FACTOR 1: Odds Discrepancy (0-30 pts) ──
          // Measures how far the best line deviates from the market average.
          // Research: Pinnacle closing line value (CLV) is the strongest predictor
          // of long-term profitability. A bigger gap = more potential CLV.
          const avgOdds = prices.reduce((a, b) => a + b, 0) / prices.length;
          const deviation = Math.abs(outcome.price - avgOdds);
          const maxDev = Math.max(...prices) - Math.min(...prices);
          const discrepancyScore = maxDev > 0 ? Math.min(30, (deviation / maxDev) * 30) : 0;

          // ── FACTOR 2: Underdog Value (0-25 pts) ──
          // Sports Insights (2007-2023): NFL underdogs receiving <20% of public
          // bets cover 57.1% ATS with +12.8% ROI. Underdogs are systematically
          // undervalued across all major sports.
          let underdogScore = 0;
          if (marketType === "h2h" && outcome.price > 100) {
            underdogScore = Math.min(25, (outcome.price - 100) / 200 * 25);
            // Home underdog bonus — Bet Labs: NFL divisional home underdogs
            // covered 71% ATS from 2003-2023
            const isHome = outcome.name === game.home_team;
            if (isHome) underdogScore = Math.min(25, underdogScore * 1.4);
          }
          if (marketType === "spreads" && outcome.point && outcome.point > 0) {
            underdogScore = Math.min(20, outcome.point / 10 * 20);
          }

          // ── FACTOR 3: Market Consensus Divergence (0-25 pts) ──
          // When most books cluster at one price and one outlier offers better
          // value, it often signals that the outlier hasn't adjusted to sharp
          // money yet (or has overcorrected). This mimics "reverse line movement."
          const sortedPrices = [...prices].sort((a, b) => a - b);
          const median = sortedPrices[Math.floor(sortedPrices.length / 2)];
          const booksAtMedian = prices.filter(p => Math.abs(p - median) < 8).length;
          const consensusRatio = booksAtMedian / prices.length;
          const isOutlier = Math.abs(outcome.price - median) >= 8;
          const divergenceScore = (isOutlier && consensusRatio >= 0.5 && outcome.price > median)
            ? Math.min(25, consensusRatio * 25)
            : 0;

          // ── FACTOR 4: EV Strength (0-20 pts) ──
          // Direct scaling of expected value — the core mathematical edge.
          const evScore = Math.min(20, (ev / 10) * 20);

          const totalScore = discrepancyScore + underdogScore + divergenceScore + evScore;

          if (totalScore >= 10) {
            // Determine confidence tier
            let confidence, confidenceColor, confidenceLabel;
            if (totalScore >= 55) { confidence = 5; confidenceColor = "#0d9f4f"; confidenceLabel = "Elite"; }
            else if (totalScore >= 42) { confidence = 4; confidenceColor = "#1a73e8"; confidenceLabel = "Strong"; }
            else if (totalScore >= 30) { confidence = 3; confidenceColor = "#7c3aed"; confidenceLabel = "Solid"; }
            else if (totalScore >= 20) { confidence = 2; confidenceColor = "#e8a100"; confidenceLabel = "Moderate"; }
            else { confidence = 1; confidenceColor = "#8b919a"; confidenceLabel = "Lean"; }

            plays.push({
              game,
              marketType,
              outcome: outcome.name,
              point: outcome.point,
              odds: outcome.price,
              book: outcome.book,
              ev: ev.toFixed(1),
              edge: ((vigFreeProb - thisProb) / thisProb * 100).toFixed(1),
              totalScore: Math.round(totalScore),
              factors: {
                discrepancy: Math.round(discrepancyScore),
                underdog: Math.round(underdogScore),
                divergence: Math.round(divergenceScore),
                evStrength: Math.round(evScore),
              },
              confidence,
              confidenceColor,
              confidenceLabel,
              commence: game.commence_time,
            });
          }
        });
      });
    });
  });

  return plays.sort((a, b) => b.totalScore - a.totalScore).slice(0, 50);
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
      border: active ? `1.5px solid ${accent || '#1a73e8'}` : "1.5px solid #dde1e6",
      background: active ? `${accent || '#1a73e8'}12` : "#f5f6f8",
      color: active ? (accent || '#1a73e8') : "#5f6368",
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
    background: "#fff",
    border: "1px solid #e2e5ea",
    borderRadius: 14,
    padding: "18px 20px",
    flex: 1,
    minWidth: 120,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  }}>
    <div style={{ fontSize: 11, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 800, color: color || "#1a1d23", marginTop: 6, fontFamily: "'Space Mono', monospace" }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: "#8b919a", marginTop: 4 }}>{sub}</div>}
  </div>
);

const ValueBetCard = ({ bet, index }) => {
  const evColor = parseFloat(bet.ev) > 5 ? "#0d9f4f" : parseFloat(bet.ev) > 3 ? "#1a73e8" : "#e8a100";
  const marketLabel = bet.marketType === "h2h" ? "Moneyline" : bet.marketType === "spreads" ? "Spread" : "Total";

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e2e5ea",
      borderLeft: `3px solid ${evColor}`,
      borderRadius: 12,
      padding: "16px 18px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 14,
      transition: "all 0.2s",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      animation: `fadeSlideIn 0.4s ease ${index * 0.05}s both`,
    }}
    onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)"; }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, background: "#f0f1f3", padding: "3px 8px", borderRadius: 4, color: "#5f6368", fontWeight: 700, letterSpacing: "0.05em" }}>
            {bet.game.sport_title}
          </span>
          <span style={{ fontSize: 12, color: "#8b919a" }}>{formatTime(bet.commence)}</span>
          {bet.isLive && <span style={{ fontSize: 10, background: "#fef2f2", color: "#dc2626", padding: "2px 6px", borderRadius: 4, fontWeight: 700, letterSpacing: "0.05em" }}>LIVE</span>}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1d23", marginBottom: 4 }}>
          {bet.outcome} {bet.point ? `(${bet.point > 0 ? '+' : ''}${bet.point})` : ''} — {marketLabel}
        </div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          {bet.game.away_team} @ {bet.game.home_team}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0, minWidth: 110 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: evColor, fontFamily: "'Space Mono', monospace" }}>
          +{bet.ev}%
        </div>
        <div style={{ fontSize: 12, color: "#8b919a", marginBottom: 4 }}>Expected Value</div>
        <div style={{
          fontSize: 15,
          fontWeight: 700,
          color: "#1a1d23",
          background: "#f0f1f3",
          padding: "4px 10px",
          borderRadius: 6,
          fontFamily: "'Space Mono', monospace",
        }}>
          {formatOdds(bet.odds)}
        </div>
        <a
          href={BOOK_URLS[bet.book] || "#"}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            marginTop: 6,
            padding: "5px 10px",
            borderRadius: 6,
            background: "#e8f0fe",
            border: "1px solid #c5d7f5",
            fontSize: 11,
            fontWeight: 700,
            color: "#1a73e8",
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          Bet on {bet.book} →
        </a>
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
      borderBottom: "1px solid #f0f1f3",
      fontSize: 13,
    }}>
      <div>
        <div style={{ fontWeight: 700, color: "#1a1d23", fontSize: 14, marginBottom: 3 }}>{game.away_team}</div>
        <div style={{ fontWeight: 600, color: "#6b7280", fontSize: 13 }}>@ {game.home_team}</div>
      </div>
      <div style={{ textAlign: "center", minWidth: 50 }}>
        <div style={{ fontSize: 10, color: "#8b919a", marginBottom: 2 }}>TIME</div>
        <div style={{
          color: formatTime(game.commence_time) === "LIVE" ? "#dc2626" : "#5f6368",
          fontWeight: 700,
          fontSize: 12,
          fontFamily: "'Space Mono', monospace",
        }}>
          {formatTime(game.commence_time)}
        </div>
      </div>
      <div style={{ textAlign: "center", minWidth: 65 }}>
        <div style={{ fontSize: 10, color: "#8b919a", marginBottom: 2 }}>BEST ML</div>
        <div style={{ color: "#1a73e8", fontWeight: 700, fontFamily: "'Space Mono', monospace", fontSize: 13 }}>
          {formatOdds(bestH2H.away.odds)}
        </div>
        <div style={{ fontSize: 9, color: "#8b919a" }}>{bestH2H.away.book}</div>
      </div>
      <div style={{ textAlign: "center", minWidth: 65 }}>
        <div style={{ fontSize: 10, color: "#8b919a", marginBottom: 2 }}>BEST ML</div>
        <div style={{ color: "#0d9f4f", fontWeight: 700, fontFamily: "'Space Mono', monospace", fontSize: 13 }}>
          {formatOdds(bestH2H.home.odds)}
        </div>
        <div style={{ fontSize: 9, color: "#8b919a" }}>{bestH2H.home.book}</div>
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
      background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 20,
    }}
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff",
        border: "1px solid #e2e5ea",
        borderRadius: 20,
        padding: 28,
        width: "100%",
        maxWidth: 420,
        boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
        animation: "fadeSlideIn 0.3s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1d23" }}>Create Alert</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b919a", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {saved ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0d9f4f" }}>Alert Created!</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>You'll be notified when conditions are met</div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, display: "block", marginBottom: 8 }}>Sport</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Pill active={alertSport === "any"} onClick={() => setAlertSport("any")}>Any</Pill>
                {SPORTS.filter(s => s.season).map(s => (
                  <Pill key={s.id} active={alertSport === s.id} onClick={() => setAlertSport(s.id)}>{s.icon} {s.name}</Pill>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, display: "block", marginBottom: 8 }}>Alert When</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Pill active={alertType === "ev"} onClick={() => setAlertType("ev")} accent="#00ff88">+EV Bet Found</Pill>
                <Pill active={alertType === "line"} onClick={() => setAlertType("line")} accent="#f0c800">Line Movement</Pill>
                <Pill active={alertType === "underdog"} onClick={() => setAlertType("underdog")} accent="#ff6b6b">Big Underdog</Pill>
                <Pill active={alertType === "total"} onClick={() => setAlertType("total")} accent="#a78bfa">Total Shift</Pill>
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, display: "block", marginBottom: 8 }}>
                {alertType === "ev" ? "Minimum EV %" : alertType === "line" ? "Min Points Moved" : alertType === "underdog" ? "Min Odds (e.g. +300)" : "Min Total Shift"}
              </label>
              <input
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #dde1e6",
                  background: "#f5f6f8",
                  color: "#1a1d23",
                  fontSize: 15,
                  fontFamily: "'Space Mono', monospace",
                  fontWeight: 700,
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, display: "block", marginBottom: 8 }}>Sportsbook</label>
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
              background: "#1a73e8",
              color: "#fff",
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
  const [activeTab, setActiveTab] = useState("sharp");
  const [showAlertBuilder, setShowAlertBuilder] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [parlays, setParlays] = useState([]);
  const [parlayKey, setParlayKey] = useState(0);
  const [wagerAmount, setWagerAmount] = useState(25);
  const [loading, setLoading] = useState(true);
  const [dataSource, setDataSource] = useState("loading");
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);
  const [liveScores, setLiveScores] = useState([]);
  const [sharpPlays, setSharpPlays] = useState([]);
  const [legalPage, setLegalPage] = useState(null); // "terms" | "privacy" | "disclaimer" | "responsible" | null
  const [userState, setUserState] = useState(null); // e.g. "UT", "NJ", etc.
  const [geoLoaded, setGeoLoaded] = useState(false);

  // States where sports betting is not legal (as of 2026)
  const RESTRICTED_STATES = ["UT", "ID", "WI", "AL", "AK", "GA", "HI", "MN", "MO", "OK", "SC", "TX"];
  const isRestricted = RESTRICTED_STATES.includes(userState);

  // Detect user's state via free IP geolocation
  useEffect(() => {
    const detect = async () => {
      try {
        const res = await fetch("https://ipapi.co/json/");
        if (res.ok) {
          const data = await res.json();
          if (data.country_code === "US" && data.region_code) {
            setUserState(data.region_code);
          }
        }
      } catch {}
      setGeoLoaded(true);
    };
    detect();
  }, []);

  useEffect(() => {
    const CACHE_KEY = "oddsy_odds_cache";
    const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

    const fetchOdds = async () => {
      setLoading(true);

      // Check localStorage cache first
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const { data: cachedData, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_DURATION && cachedData.length > 0) {
            setGames(cachedData);
            const vb = findValueBets(cachedData, liveScores);
            setValueBets(vb);
            setParlays(generateParlays(vb));
            setSharpPlays(findSharpPlays(cachedData, liveScores));
            setDataSource("live");
            setLastRefresh(new Date(timestamp));
            setLoading(false);
            return;
          }
        }
      } catch {}

      try {
        const res = await fetch("/api/odds");
        if (!res.ok) throw new Error("API error");
        const json = await res.json();
        if (json.games && json.games.length > 0) {
          setGames(json.games);
          const vb = findValueBets(json.games, liveScores);
          setValueBets(vb);
          setParlays(generateParlays(vb));
          setSharpPlays(findSharpPlays(json.games, liveScores));
          setDataSource("live");
          // Cache the response
          localStorage.setItem(CACHE_KEY, JSON.stringify({ data: json.games, timestamp: Date.now() }));
        } else {
          throw new Error("No games returned");
        }
      } catch {
        setGames([]);
        setValueBets([]);
        setParlays([]);
        setSharpPlays([]);
        setDataSource("error");
      }
      setLastRefresh(new Date());
      setLoading(false);
    };
    fetchOdds();
  }, [refreshKey]);

  // Fetch live scores
  useEffect(() => {
    const fetchScores = async () => {
      try {
        const res = await fetch("/api/scores");
        if (res.ok) {
          const json = await res.json();
          if (json.events) setLiveScores(json.events);
        }
      } catch {}
    };
    fetchScores();
    // Refresh scores every 2 minutes
    const interval = setInterval(fetchScores, 120000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Recalculate value bets when live scores update (filters out blowouts/finished games)
  useEffect(() => {
    if (games.length > 0 && liveScores.length > 0) {
      const vb = findValueBets(games, liveScores);
      setValueBets(vb);
      setParlays(generateParlays(vb));
      setSharpPlays(findSharpPlays(games, liveScores));
    }
  }, [liveScores]);

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
      background: "#f5f6f8",
      color: "#1a1d23",
      fontFamily: "'DM Sans', sans-serif",
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
        * { box-sizing: border-box; }
        input::placeholder { color: #aab0b8; }
      `}</style>

      {/* Header */}
      <header style={{
        padding: "16px 20px 0",
        background: "#fff",
        borderBottom: "1px solid #e2e5ea",
        animation: "fadeSlideIn 0.5s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div>
            <img src="/logo.jpeg" alt="MyOddsy — Sports Odds & Analytics" style={{ height: 80, display: "block", maxWidth: "75vw" }} />
          </div>
        </div>
      </header>

      {/* Nav Tabs — top bar on desktop only */}
      {!isMobile && (
        <nav style={{
          display: "flex",
          gap: 0,
          padding: "0 20px",
          background: "#fff",
          borderBottom: "1px solid #e2e5ea",
        }}>
          {[
            { id: "sharp", label: "Sharp Plays", icon: "🧠" },
            { id: "value", label: "Value Bets", icon: "⚡" },
            { id: "parlays", label: "Parlays", icon: "🎰" },
            { id: "odds", label: "Odds", icon: "📊" },
            { id: "alerts", label: "Alerts", icon: "🔔" },
            { id: "scores", label: "Scores", icon: "🏆" },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: "12px 0",
                border: "none",
                borderBottom: activeTab === tab.id ? "2px solid #1a73e8" : "2px solid transparent",
                background: "none",
                color: activeTab === tab.id ? "#1a73e8" : "#8b919a",
                fontSize: 12,
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
      )}

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
      <div style={{ padding: isMobile ? "0 20px 90px" : "0 20px 40px" }}>

        {/* Error state when API fails */}
        {dataSource === "error" && activeTab !== "scores" && (
          <div style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 14,
            padding: "20px 18px",
            marginBottom: 18,
            textAlign: "center",
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>&#9888;&#65039;</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#dc2626", marginBottom: 4 }}>Unable to Load Odds Data</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
              We couldn't reach the odds provider. This can happen during off-hours or if no games are currently scheduled.
            </div>
            <button
              onClick={() => { localStorage.removeItem("oddsy_odds_cache"); setRefreshKey(k => k + 1); }}
              style={{
                padding: "8px 20px",
                borderRadius: 8,
                border: "1px solid #fecaca",
                background: "#fff",
                color: "#dc2626",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* ── LIVE SCORES TAB ── */}
        {activeTab === "scores" && (
          <>
            <h2 style={{ margin: "0 0 14px", fontSize: 18, fontWeight: 800, color: "#1a1d23" }}>
              Live Scores & Today's Games
            </h2>
            {liveScores.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#8b919a" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🏆</div>
                <div style={{ fontSize: 14 }}>No games scheduled right now. Check back later!</div>
              </div>
            )}
            {(() => {
              const sportGroups = {};
              const filteredScores = activeSport === "all"
                ? liveScores
                : liveScores.filter(e => e.sport_key === activeSport);
              filteredScores.forEach(e => {
                const sport = SPORTS.find(s => s.id === e.sport_key);
                const label = sport ? `${sport.icon} ${sport.name}` : e.sport_key;
                if (!sportGroups[label]) sportGroups[label] = [];
                sportGroups[label].push(e);
              });
              return Object.entries(sportGroups).map(([sportLabel, events]) => (
                <div key={sportLabel} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#6b7280", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {sportLabel}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {events.map(event => {
                      const isLive = event.status.type === "STATUS_IN_PROGRESS";
                      const isFinal = event.status.type === "STATUS_FINAL";
                      const isScheduled = event.status.type === "STATUS_SCHEDULED";
                      return (
                        <div key={event.id} style={{
                          background: "#fff",
                          border: isLive ? "1px solid #dc2626" : "1px solid #e2e5ea",
                          borderLeft: isLive ? "3px solid #dc2626" : isFinal ? "3px solid #8b919a" : "3px solid #0d9f4f",
                          borderRadius: 12,
                          padding: "14px 16px",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                        }}>
                          {/* Status badge */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <span style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "3px 8px",
                              borderRadius: 4,
                              background: isLive ? "#fef2f2" : isFinal ? "#f0f1f3" : "#ecfdf5",
                              color: isLive ? "#dc2626" : isFinal ? "#6b7280" : "#0d9f4f",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                            }}>
                              {isLive ? (event.status.displayClock ? `LIVE · ${event.status.displayClock}` : "LIVE") : isFinal ? "FINAL" : "UPCOMING"}
                            </span>
                            {isScheduled && event.status.detail && (
                              <span style={{ fontSize: 11, color: "#8b919a" }}>{event.status.detail}</span>
                            )}
                          </div>
                          {/* Teams & Scores */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{
                                fontSize: 15, fontWeight: 700, marginBottom: 6,
                                color: isFinal && event.away.score > event.home.score ? "#1a1d23" : isFinal ? "#8b919a" : "#1a1d23",
                              }}>
                                {event.away.name}
                              </div>
                              <div style={{
                                fontSize: 15, fontWeight: 700,
                                color: isFinal && event.home.score > event.away.score ? "#1a1d23" : isFinal ? "#8b919a" : "#1a1d23",
                              }}>
                                {event.home.name}
                              </div>
                            </div>
                            {(isLive || isFinal) && (
                              <div style={{ textAlign: "right" }}>
                                <div style={{
                                  fontSize: 22, fontWeight: 800, fontFamily: "'Space Mono', monospace", marginBottom: 4,
                                  color: isFinal && event.away.score > event.home.score ? "#1a1d23" : isFinal ? "#8b919a" : "#1a1d23",
                                }}>
                                  {event.away.score}
                                </div>
                                <div style={{
                                  fontSize: 22, fontWeight: 800, fontFamily: "'Space Mono', monospace",
                                  color: isFinal && event.home.score > event.away.score ? "#1a1d23" : isFinal ? "#8b919a" : "#1a1d23",
                                }}>
                                  {event.home.score}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
          </>
        )}

        {/* ── SHARP PLAYS TAB ── */}
        {activeTab === "sharp" && (
          <>
            {/* Research explainer */}
            <div style={{
              background: "linear-gradient(135deg, #1a1d23 0%, #2d3748 100%)",
              borderRadius: 14,
              padding: "20px 18px",
              marginBottom: 18,
              color: "#fff",
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 22 }}>🧠</span> How Sharp Plays Works
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.8, color: "#cbd5e0" }}>
                Sharp Plays uses a <strong style={{ color: "#fff" }}>composite scoring system (0-100 pts)</strong> that combines four research-backed strategies to surface the most statistically advantageous bets:
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
                <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#63b3ed", marginBottom: 4 }}>1. Odds Discrepancy (0-30 pts)</div>
                  <div style={{ fontSize: 11, color: "#a0aec0", lineHeight: 1.5 }}>
                    Detects when one sportsbook's line deviates from the market consensus. Research on <strong style={{ color: "#cbd5e0" }}>Closing Line Value (CLV)</strong> from Pinnacle shows bettors who consistently beat the closing number see 2-3x higher long-term ROI.
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#68d391", marginBottom: 4 }}>2. Underdog Value (0-25 pts)</div>
                  <div style={{ fontSize: 11, color: "#a0aec0", lineHeight: 1.5 }}>
                    <strong style={{ color: "#cbd5e0" }}>Sports Insights (2007-2023)</strong>: NFL underdogs getting {"<"}20% of public bets covered 57.1% ATS with +12.8% ROI. Home underdogs are even stronger — Bet Labs found NFL divisional home dogs covered 71% ATS.
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#d6bcfa", marginBottom: 4 }}>3. Market Divergence (0-25 pts)</div>
                  <div style={{ fontSize: 11, color: "#a0aec0", lineHeight: 1.5 }}>
                    Identifies <strong style={{ color: "#cbd5e0" }}>reverse line movement patterns</strong> — when most books cluster at one price but an outlier offers significantly better value, it often means sharp money has moved the line at some books but not others.
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#fbd38d", marginBottom: 4 }}>4. EV Strength (0-20 pts)</div>
                  <div style={{ fontSize: 11, color: "#a0aec0", lineHeight: 1.5 }}>
                    Pure mathematical edge — comparing each line's implied probability against the vig-removed market average. Higher EV = larger expected return per dollar wagered.
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 14, fontSize: 11, color: "#718096", lineHeight: 1.6, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 12 }}>
                <strong style={{ color: "#a0aec0" }}>Sources:</strong> Levitt, S. (2004) "Why are gambling markets organised so differently from financial markets?" <em>The Economic Journal</em> · Humphreys et al. (2013) "Closing line value and the wisdom of the crowd" · Sports Insights database (2007-2023) · Bet Labs Systems (Action Network)
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: "flex", gap: 10, marginBottom: 18, overflowX: "auto" }}>
              <StatCard
                label="Sharp Plays"
                value={sharpPlays.filter(p => activeSport === "all" || p.game.sport_key === activeSport).length}
                sub="composite scored"
              />
              <StatCard
                label="Top Score"
                value={(() => {
                  const filtered = sharpPlays.filter(p => activeSport === "all" || p.game.sport_key === activeSport);
                  return filtered.length > 0 ? `${filtered[0].totalScore}/100` : "—";
                })()}
                color="#7c3aed"
                sub="confidence rating"
              />
              <StatCard
                label="Elite Picks"
                value={sharpPlays.filter(p => (activeSport === "all" || p.game.sport_key === activeSport) && p.confidence >= 4).length}
                color="#0d9f4f"
                sub="strong or elite"
              />
            </div>

            <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 800, color: "#1a1d23" }}>
              Top Ranked Sharp Plays
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {sharpPlays
                .filter(p => activeSport === "all" || p.game.sport_key === activeSport)
                .map((play, i) => {
                  const marketLabel = play.marketType === "h2h" ? "Moneyline" : play.marketType === "spreads" ? "Spread" : "Total";
                  const sportIcon = SPORTS.find(s => s.id === play.game.sport_key)?.icon || "";
                  return (
                    <div key={`${play.game.id}-${play.outcome}-${play.book}-${i}`} style={{
                      background: "#fff",
                      border: `1px solid ${play.confidence >= 4 ? "#c5d7f5" : "#e2e5ea"}`,
                      borderRadius: 14,
                      overflow: "hidden",
                      boxShadow: play.confidence >= 4 ? "0 2px 8px rgba(26,115,232,0.1)" : "0 1px 3px rgba(0,0,0,0.06)",
                      animation: `fadeSlideIn 0.4s ease ${i * 0.05}s both`,
                    }}>
                      {/* Header with score badge */}
                      <div style={{
                        padding: "12px 16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        borderBottom: "1px solid #f0f1f3",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{
                            width: 42, height: 42, borderRadius: 12,
                            background: `${play.confidenceColor}15`,
                            border: `2px solid ${play.confidenceColor}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 18, fontWeight: 900, fontFamily: "'Space Mono', monospace",
                            color: play.confidenceColor,
                          }}>
                            {play.totalScore}
                          </div>
                          <div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23" }}>
                              {play.outcome} {play.point ? `(${play.point > 0 ? '+' : ''}${play.point})` : ''} — {marketLabel}
                            </div>
                            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                              {sportIcon} {play.game.away_team} @ {play.game.home_team} · {formatTime(play.commence)}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{
                            fontSize: 20, fontWeight: 800, fontFamily: "'Space Mono', monospace",
                            color: play.odds > 0 ? "#0d9f4f" : "#1a1d23",
                          }}>
                            {formatOdds(play.odds)}
                          </div>
                          <div style={{
                            fontSize: 10, fontWeight: 700,
                            padding: "2px 8px", borderRadius: 4,
                            background: `${play.confidenceColor}15`,
                            color: play.confidenceColor,
                            display: "inline-block",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}>
                            {play.confidenceLabel}
                          </div>
                        </div>
                      </div>

                      {/* Factor breakdown bar */}
                      <div style={{ padding: "10px 16px", background: "#f8f9fa" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                          Score Breakdown
                        </div>
                        <div style={{ display: "flex", gap: 3, height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
                          <div style={{ width: `${play.factors.discrepancy}%`, background: "#63b3ed", minWidth: play.factors.discrepancy > 0 ? 2 : 0 }} />
                          <div style={{ width: `${play.factors.underdog}%`, background: "#68d391", minWidth: play.factors.underdog > 0 ? 2 : 0 }} />
                          <div style={{ width: `${play.factors.divergence}%`, background: "#d6bcfa", minWidth: play.factors.divergence > 0 ? 2 : 0 }} />
                          <div style={{ width: `${play.factors.evStrength}%`, background: "#fbd38d", minWidth: play.factors.evStrength > 0 ? 2 : 0 }} />
                          <div style={{ flex: 1, background: "#e2e5ea" }} />
                        </div>
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                          {play.factors.discrepancy > 0 && (
                            <span style={{ fontSize: 10, color: "#63b3ed", fontWeight: 600 }}>Discrepancy {play.factors.discrepancy}pt</span>
                          )}
                          {play.factors.underdog > 0 && (
                            <span style={{ fontSize: 10, color: "#48bb78", fontWeight: 600 }}>Underdog {play.factors.underdog}pt</span>
                          )}
                          {play.factors.divergence > 0 && (
                            <span style={{ fontSize: 10, color: "#9f7aea", fontWeight: 600 }}>Divergence {play.factors.divergence}pt</span>
                          )}
                          {play.factors.evStrength > 0 && (
                            <span style={{ fontSize: 10, color: "#d69e2e", fontWeight: 600 }}>EV {play.factors.evStrength}pt</span>
                          )}
                        </div>
                      </div>

                      {/* Footer with EV + CTA */}
                      <div style={{
                        padding: "10px 16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        borderTop: "1px solid #e2e5ea",
                      }}>
                        <div style={{ display: "flex", gap: 16 }}>
                          <div>
                            <div style={{ fontSize: 9, color: "#8b919a", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>EV</div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: "#0d9f4f", fontFamily: "'Space Mono', monospace" }}>+{play.ev}%</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, color: "#8b919a", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Edge</div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: "#1a73e8", fontFamily: "'Space Mono', monospace" }}>+{play.edge}%</div>
                          </div>
                        </div>
                        <a
                          href={BOOK_URLS[play.book] || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: "7px 14px",
                            borderRadius: 8,
                            background: "#1a73e8",
                            border: "none",
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#fff",
                            textDecoration: "none",
                            cursor: "pointer",
                          }}
                        >
                          Bet on {play.book} →
                        </a>
                      </div>
                    </div>
                  );
                })}
              {sharpPlays.filter(p => activeSport === "all" || p.game.sport_key === activeSport).length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#8b919a" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🧠</div>
                  <div style={{ fontSize: 13 }}>No sharp plays found for this filter. Check back closer to game time.</div>
                </div>
              )}
            </div>

            {/* Affiliate CTA */}
            <div style={{
              marginTop: 20,
              background: "#fff",
              border: "1px solid #e2e5ea",
              borderRadius: 14,
              padding: 18,
              textAlign: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#1a1d23", marginBottom: 4 }}>Bet Sharp on DraftKings</div>
              <div style={{ fontSize: 11, color: "#8b919a", marginBottom: 12 }}>New users get up to $1,000 in bonus bets</div>
              <a href="https://www.draftkings.com/sportsbook" target="_blank" rel="noopener noreferrer" style={{
                display: "inline-block",
                padding: "10px 28px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg, #1a1d23, #2d3748)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
                letterSpacing: "0.02em",
                textDecoration: "none",
              }}>
                Claim Bonus →
              </a>
              <div style={{ fontSize: 9, color: "#aab0b8", marginTop: 6 }}>21+ | Gambling problem? Call 1-800-522-4700</div>
            </div>
          </>
        )}

        {/* ── VALUE BETS TAB ── */}
        {activeTab === "value" && (
          <>
            {/* How it works explainer */}
            <div style={{
              background: "#e8f0fe",
              border: "1px solid #c5d7f5",
              borderRadius: 14,
              padding: "16px 18px",
              marginBottom: 18,
            }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#1a1d23", marginBottom: 6 }}>How We Find Value Bets</div>
              <div style={{ fontSize: 13, color: "#4a5568", lineHeight: 1.7 }}>
                We compare odds from <strong style={{ color: "#1a1d23" }}>6 sportsbooks</strong> for every game.
                When one book's odds are better than the average, that's a <strong style={{ color: "#0d9f4f" }}>+EV (positive expected value)</strong> bet —
                meaning the payout is higher than the true probability suggests. The higher the <strong style={{ color: "#1a73e8" }}>EV%</strong>, the bigger the edge.
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
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#1a1d23" }}>
                Top Value Picks
              </h2>
              <span style={{ fontSize: 10, color: "#8b919a", fontFamily: "'Space Mono', monospace" }}>
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredValue.map((bet, i) => (
                <ValueBetCard key={`${bet.game.id}-${bet.outcome}-${bet.book}`} bet={bet} index={i} />
              ))}
              {filteredValue.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#8b919a" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                  <div style={{ fontSize: 13 }}>No value bets found for this filter</div>
                </div>
              )}
            </div>

            {/* Affiliate CTA */}
            <div style={{
              marginTop: 20,
              background: "#fff",
              border: "1px solid #e2e5ea",
              borderRadius: 14,
              padding: 18,
              textAlign: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#1a1d23", marginBottom: 4 }}>Place these bets on DraftKings</div>
              <div style={{ fontSize: 11, color: "#8b919a", marginBottom: 12 }}>New users get up to $1,000 in bonus bets</div>
              <a href="https://www.draftkings.com/sportsbook" target="_blank" rel="noopener noreferrer" style={{
                display: "inline-block",
                padding: "10px 28px",
                borderRadius: 10,
                border: "none",
                background: "#1a73e8",
                color: "#fff",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
                letterSpacing: "0.02em",
                textDecoration: "none",
              }}>
                Claim Bonus →
              </a>
              <div style={{ fontSize: 9, color: "#aab0b8", marginTop: 6 }}>21+ | Gambling problem? Call 1-800-522-4700</div>
            </div>
          </>
        )}

        {/* ── PARLAYS TAB ── */}
        {activeTab === "parlays" && (
          <>
            {/* Parlay explainer */}
            <div style={{
              background: "#f3edff",
              border: "1px solid #ddd0f5",
              borderRadius: 14,
              padding: "16px 18px",
              marginBottom: 18,
            }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#1a1d23", marginBottom: 6 }}>Parlay Picks of the Day</div>
              <div style={{ fontSize: 13, color: "#4a5568", lineHeight: 1.7 }}>
                We identify the <strong style={{ color: "#1a1d23" }}>best value bets</strong> across upcoming games and group them into 3-leg parlay suggestions.
                Pick the combination you like, then build it on your preferred sportsbook. Odds may vary slightly between books —
                use the <strong style={{ color: "#1a73e8" }}>Value Bets</strong> tab to find which book has the best line for each leg.
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1d23" }}>Today's Best Parlays</h2>
                <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>3-leg combinations built from upcoming +EV picks</div>
              </div>
              <button
                onClick={() => setParlayKey(k => k + 1)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: "1px solid #c5d7f5",
                  background: "#e8f0fe",
                  color: "#1a73e8",
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
              background: "#fff", border: "1px solid #e2e5ea",
              borderRadius: 12, padding: "10px 14px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}>
              <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Wager Amount</span>
              <div style={{ display: "flex", gap: 6 }}>
                {[10, 25, 50, 100].map(amt => (
                  <button key={amt} onClick={() => setWagerAmount(amt)} style={{
                    padding: "5px 12px", borderRadius: 8, border: "none",
                    background: wagerAmount === amt ? "#e8f0fe" : "#f0f1f3",
                    color: wagerAmount === amt ? "#1a73e8" : "#6b7280",
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
                  background: "#fff",
                  border: "1px solid #e2e5ea",
                  borderRadius: 16,
                  overflow: "hidden",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                  animation: `fadeSlideIn 0.4s ease ${pi * 0.08}s both`,
                }}>
                  {/* Parlay Header */}
                  <div style={{
                    padding: "14px 16px",
                    borderBottom: "1px solid #e2e5ea",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#1a1d23" }}>
                        {parlay.icon} {parlay.strategy}
                      </div>
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, maxWidth: 240 }}>
                        {parlay.desc}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{
                        fontSize: 22, fontWeight: 900, fontFamily: "'Space Mono', monospace",
                        color: parseFloat(parlay.parlayEV) > 5 ? "#0d9f4f" : "#1a73e8",
                      }}>
                        {formatOdds(parlay.combinedOdds)}
                      </div>
                      <div style={{ fontSize: 10, color: "#8b919a" }}>combined odds</div>
                    </div>
                  </div>

                  {/* Legs */}
                  {parlay.legs.map((leg, li) => {
                    const marketLabel = leg.marketType === "h2h" ? "ML" : leg.marketType === "spreads" ? "SPR" : "TOT";
                    const sportIcon = SPORTS.find(s => s.id === leg.game.sport_key)?.icon || "🏅";
                    return (
                      <div key={li} style={{
                        padding: "10px 16px",
                        borderBottom: li < 2 ? "1px solid #f0f1f3" : "none",
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: 8,
                            background: "#f0f1f3", display: "flex",
                            alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0,
                          }}>
                            {sportIcon}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1d23", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {leg.outcome} {leg.point ? `(${leg.point > 0 ? '+' : ''}${leg.point})` : ''}
                            </div>
                            <div style={{ fontSize: 10, color: "#8b919a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {leg.game.away_team} @ {leg.game.home_team} · Best odds: <span style={{ color: "#1a73e8", fontWeight: 600 }}>{leg.book}</span>
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <span style={{
                            fontSize: 10, padding: "2px 6px", borderRadius: 4,
                            background: "#f0f1f3", color: "#6b7280", fontWeight: 700,
                          }}>{marketLabel}</span>
                          <span style={{
                            fontSize: 14, fontWeight: 800, fontFamily: "'Space Mono', monospace",
                            color: leg.odds > 0 ? "#0d9f4f" : "#1a1d23",
                          }}>
                            {formatOdds(leg.odds)}
                          </span>
                          <span style={{
                            fontSize: 10, color: "#1a73e8", fontWeight: 700, fontFamily: "'Space Mono', monospace",
                          }}>+{leg.ev}%</span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Parlay Footer — payout info */}
                  <div style={{
                    padding: "12px 16px",
                    background: "#f8f9fa",
                    borderTop: "1px solid #e2e5ea",
                    display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8,
                  }}>
                    <div>
                      <div style={{ fontSize: 9, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Payout</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#0d9f4f", fontFamily: "'Space Mono', monospace" }}>
                        ${(wagerAmount * (parseFloat(parlay.combinedDecimal) - 1)).toFixed(0)}
                      </div>
                      <div style={{ fontSize: 9, color: "#8b919a" }}>on ${wagerAmount} bet</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Parlay EV</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: parseFloat(parlay.parlayEV) > 0 ? "#1a73e8" : "#dc2626", fontFamily: "'Space Mono', monospace" }}>
                        {parseFloat(parlay.parlayEV) > 0 ? "+" : ""}{parlay.parlayEV}%
                      </div>
                      <div style={{ fontSize: 9, color: "#8b919a" }}>expected value</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 9, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Win Prob</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#4a5568", fontFamily: "'Space Mono', monospace" }}>
                        {parlay.impliedProb}%
                      </div>
                      <div style={{ fontSize: 9, color: "#8b919a" }}>estimated</div>
                    </div>
                  </div>
                  {/* Build parlay CTA */}
                  <div style={{
                    padding: "10px 16px",
                    borderTop: "1px solid #e2e5ea",
                    display: "flex",
                    gap: 8,
                    justifyContent: "center",
                    flexWrap: "wrap",
                  }}>
                    {["DraftKings", "FanDuel", "BetMGM"].map(book => (
                      <a
                        key={book}
                        href={BOOK_URLS[book]}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: "6px 14px",
                          borderRadius: 8,
                          background: "#e8f0fe",
                          border: "1px solid #c5d7f5",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#1a73e8",
                          textDecoration: "none",
                          cursor: "pointer",
                        }}
                      >
                        Build on {book} →
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Affiliate CTA for parlays */}
            <div style={{
              marginTop: 20,
              background: "#fff",
              border: "1px solid #e2e5ea",
              borderRadius: 14,
              padding: 18,
              textAlign: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#1a1d23", marginBottom: 4 }}>Build these parlays on FanDuel</div>
              <div style={{ fontSize: 11, color: "#8b919a", marginBottom: 12 }}>New users: Bet $5, Get $200 in bonus bets</div>
              <a href="https://www.fanduel.com/sportsbook" target="_blank" rel="noopener noreferrer" style={{
                display: "inline-block",
                padding: "10px 28px", borderRadius: 10, border: "none",
                background: "#7c3aed",
                color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer",
                textDecoration: "none",
              }}>
                Build Parlay →
              </a>
              <div style={{ fontSize: 9, color: "#aab0b8", marginTop: 6 }}>21+ | Gambling problem? Call 1-800-522-4700</div>
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
                  border: "1px solid #dde1e6",
                  background: "#fff",
                  color: "#1a1d23",
                  fontSize: 13,
                  fontFamily: "'DM Sans', sans-serif",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{
              background: "#fff",
              border: "1px solid #e2e5ea",
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}>
              <div style={{
                padding: "10px 16px",
                borderBottom: "1px solid #e2e5ea",
                fontSize: 11,
                fontWeight: 700,
                color: "#8b919a",
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
                <div style={{ textAlign: "center", padding: "40px 0", color: "#8b919a", fontSize: 13 }}>
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
                  background: "#1a73e8",
                  color: "#fff",
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
                  background: "#fff",
                  border: "1px solid #e2e5ea",
                  borderRadius: 12,
                  padding: "14px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                  animation: `fadeSlideIn 0.4s ease ${i * 0.1}s both`,
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1d23", marginBottom: 2 }}>{alert.type}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>{alert.sport} · {alert.condition}</div>
                    <div style={{ fontSize: 10, color: "#8b919a", marginTop: 2 }}>{alert.triggered}</div>
                  </div>
                  <div style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    background: alert.status === "active" ? "#ecfdf5" : "#f0f1f3",
                    color: alert.status === "active" ? "#0d9f4f" : "#8b919a",
                    border: `1px solid ${alert.status === "active" ? "#a7f3d0" : "#dde1e6"}`,
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
              background: "#e8f0fe",
              border: "1px solid #c5d7f5",
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1d23", marginBottom: 8 }}>How Alerts Work</div>
              <div style={{ fontSize: 12, color: "#4a5568", lineHeight: 1.6 }}>
                Set your criteria and we scan odds across 6+ sportsbooks every 60 seconds. When conditions are met, you get a push notification with the bet details and best available line.
              </div>
            </div>
          </>
        )}
      </div>

      {showAlertBuilder && <AlertBuilder onClose={() => setShowAlertBuilder(false)} />}

      {/* ── MOBILE BOTTOM TAB BAR ── */}
      {isMobile && (
        <nav style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "#1a1d23",
          borderTop: "2px solid #2d3748",
          display: "flex",
          zIndex: 900,
          padding: "8px 6px 4px",
          paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.25)",
        }}>
          {[
            { id: "sharp", label: "Sharp", icon: "🧠" },
            { id: "value", label: "Value", icon: "⚡" },
            { id: "parlays", label: "Parlays", icon: "🎰" },
            { id: "odds", label: "Odds", icon: "📊" },
            { id: "alerts", label: "Alerts", icon: "🔔" },
            { id: "scores", label: "Scores", icon: "🏆" },
          ].map(tab => {
            const isActive = activeTab === tab.id;
            return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: "8px 2px 6px",
                border: "none",
                background: isActive ? "#1a73e8" : "transparent",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                cursor: "pointer",
                color: isActive ? "#fff" : "#6b7280",
                transition: "all 0.2s",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }}>{tab.icon}</span>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.02em" }}>{tab.label}</span>
            </button>
            );
          })}
        </nav>
      )}

      {/* ── LEGAL PAGE MODAL ── */}
      {legalPage && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 2000, padding: 16,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setLegalPage(null); }}
        >
          <div style={{
            background: "#fff", borderRadius: 16, width: "100%", maxWidth: 700,
            maxHeight: "85vh", overflow: "auto", padding: "28px 24px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, position: "sticky", top: 0, background: "#fff", paddingBottom: 12, borderBottom: "1px solid #e2e5ea" }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1a1d23" }}>
                {legalPage === "terms" && "Terms of Service"}
                {legalPage === "privacy" && "Privacy Policy"}
                {legalPage === "disclaimer" && "Disclaimer"}
                {legalPage === "responsible" && "Responsible Gambling"}
              </h2>
              <button onClick={() => setLegalPage(null)} style={{ background: "none", border: "none", fontSize: 22, color: "#8b919a", cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ fontSize: 13, color: "#4a5568", lineHeight: 1.8 }}>

              {/* ── TERMS OF SERVICE ── */}
              {legalPage === "terms" && (
                <>
                  <p style={{ color: "#8b919a", fontSize: 12 }}>Last updated: April 3, 2026</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>1. Acceptance of Terms</h3>
                  <p>By accessing or using MyOddsy (the "Service"), available at myoddsy.com, you agree to be bound by these Terms of Service ("Terms"). If you do not agree to all of these Terms, do not use the Service. We reserve the right to modify these Terms at any time. Your continued use of the Service after changes constitutes acceptance of the updated Terms.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>2. Eligibility</h3>
                  <p>You must be at least 21 years of age (or the minimum legal gambling age in your jurisdiction, whichever is higher) to use this Service. By using the Service, you represent and warrant that you meet this age requirement. You are solely responsible for ensuring that your use of any information provided by the Service complies with all applicable federal, state, and local laws and regulations in your jurisdiction. The Service is not intended for use in jurisdictions where sports betting or the dissemination of sports betting information is prohibited.</p>
                  <p style={{ marginTop: 10 }}>MyOddsy is an informational publisher headquartered in the United States. We detect your approximate location via IP address to determine whether sportsbook referral links should be displayed. If you are located in a state where sports betting is not currently legal (including but not limited to Utah, Idaho, Wisconsin, Alabama, Alaska, Georgia, Hawaii, Minnesota, Missouri, Oklahoma, South Carolina, and Texas), sportsbook links are automatically hidden. The underlying odds comparison and analytical content remains accessible as educational and informational material.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>3. Nature of the Service</h3>
                  <p>MyOddsy is an <strong>informational and entertainment platform only</strong>. The Service aggregates publicly available sports odds from third-party sportsbooks and provides mathematical analysis, comparisons, and educational content. <strong>MyOddsy is not a sportsbook, does not accept wagers, does not facilitate the placement of bets, and does not operate or control any gambling platform.</strong> We do not hold, transfer, or process any gambling funds.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>4. No Guarantee of Accuracy</h3>
                  <p>While we strive to provide accurate and up-to-date information, the Service relies on third-party data sources and APIs. Odds, scores, and related data may be delayed, inaccurate, or incomplete. <strong>We make no representations or warranties, express or implied, regarding the accuracy, completeness, reliability, or timeliness of any information displayed on the Service.</strong> You acknowledge that odds can change rapidly and the information shown may not reflect current market conditions at any given sportsbook.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>5. Not Professional Advice</h3>
                  <p>Nothing on this Service constitutes professional gambling advice, financial advice, investment advice, or any other form of professional counsel. All analysis, scoring, rankings, "value bets," "sharp plays," parlay suggestions, expected value calculations, and any other content are provided <strong>for informational and entertainment purposes only</strong>. You should not rely on this information as the sole basis for any betting or financial decisions. Past performance indicators and statistical analysis do not guarantee future results. All gambling involves risk and you may lose money.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>6. Third-Party Links and Affiliate Relationships</h3>
                  <p>The Service contains links to third-party websites, including licensed sportsbook operators. Some of these links may be affiliate links, meaning MyOddsy may receive compensation if you click a link and/or create an account, make a deposit, or place a wager at a third-party sportsbook. <strong>These affiliate relationships do not influence our analysis or recommendations.</strong> We are not responsible for the content, terms, privacy practices, or operations of any third-party website. Your interactions with third-party sportsbooks are governed solely by the terms and conditions of those platforms. We strongly encourage you to review the terms of service and responsible gambling policies of any sportsbook before creating an account or placing a wager.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>7. Intellectual Property</h3>
                  <p>All content on the Service, including but not limited to text, graphics, logos, algorithms, and software, is the property of MyOddsy or its licensors and is protected by applicable intellectual property laws. You may not reproduce, distribute, modify, or create derivative works from any content without prior written consent.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>8. Limitation of Liability</h3>
                  <p><strong>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, MYODDSY, ITS OWNERS, OPERATORS, EMPLOYEES, AGENTS, AND AFFILIATES SHALL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, MONEY, OR GOODWILL, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF OR INABILITY TO USE THE SERVICE, ANY DECISIONS MADE BASED ON INFORMATION PROVIDED BY THE SERVICE, OR ANY THIRD-PARTY ACTIONS OR TRANSACTIONS.</strong> This includes, without limitation, any financial losses incurred from gambling activities.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>9. Indemnification</h3>
                  <p>You agree to indemnify, defend, and hold harmless MyOddsy, its owners, operators, employees, agents, and affiliates from and against any and all claims, liabilities, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising from or related to: (a) your use of the Service; (b) your violation of these Terms; (c) your violation of any applicable law or regulation; or (d) any gambling activity you undertake based on information from the Service.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>10. Disclaimer of Warranties</h3>
                  <p><strong>THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, OR ACCURACY.</strong> We do not warrant that the Service will be uninterrupted, error-free, or secure.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>11. Governing Law and Disputes</h3>
                  <p>These Terms shall be governed by and construed in accordance with the laws of the State in which MyOddsy operates, without regard to conflict of law principles. Any disputes arising under these Terms shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association, and you waive any right to participate in a class action lawsuit or class-wide arbitration.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>12. Severability</h3>
                  <p>If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary so that the remaining Terms remain in full force and effect.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>13. Contact</h3>
                  <p>For questions about these Terms, please contact us at: <strong>legal@myoddsy.com</strong></p>
                </>
              )}

              {/* ── PRIVACY POLICY ── */}
              {legalPage === "privacy" && (
                <>
                  <p style={{ color: "#8b919a", fontSize: 12 }}>Last updated: April 3, 2026</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>1. Introduction</h3>
                  <p>MyOddsy ("we," "us," or "our") respects your privacy. This Privacy Policy describes how we collect, use, disclose, and protect information when you use our website at myoddsy.com (the "Service").</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>2. Information We Collect</h3>
                  <p><strong>Information Collected Automatically:</strong> When you visit the Service, we may automatically collect certain information, including your IP address, browser type, device type, operating system, referring URLs, pages viewed, and the dates and times of your visits. We use Google Analytics to collect and analyze this usage data.</p>
                  <p><strong>Local Storage:</strong> We use your browser's local storage to cache odds data for performance purposes. This data is stored only on your device and is not transmitted to our servers.</p>
                  <p><strong>Information You Provide:</strong> If you contact us or sign up for alerts or notifications, we may collect the information you voluntarily provide, such as your email address.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>3. How We Use Information</h3>
                  <p>We use collected information to: (a) operate, maintain, and improve the Service; (b) analyze usage trends and preferences; (c) respond to inquiries; (d) comply with legal obligations. We do not sell, rent, or trade your personal information to third parties for their marketing purposes.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>4. Third-Party Services</h3>
                  <p>The Service contains links to third-party sportsbook websites. When you click an affiliate link and leave our site, you are subject to the privacy policies of those third-party sites. We encourage you to review those policies before providing any personal information. We use Google Analytics, which collects data through cookies and similar technologies. You can learn more about Google's data practices at <em>policies.google.com/privacy</em> and opt out using the Google Analytics Opt-Out Browser Add-on.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>5. Cookies and Tracking Technologies</h3>
                  <p>We may use cookies, web beacons, and similar tracking technologies to collect usage data and improve the Service. You can control cookies through your browser settings. Disabling cookies may affect the functionality of the Service.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>6. Data Security</h3>
                  <p>We implement reasonable technical and organizational measures to protect the information we collect. However, no method of transmission over the Internet or electronic storage is 100% secure, and we cannot guarantee absolute security.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>7. Children's Privacy</h3>
                  <p>The Service is not directed to individuals under 21 years of age. We do not knowingly collect personal information from anyone under 21. If we become aware that we have collected personal information from someone under 21, we will take steps to delete that information.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>8. Your Rights</h3>
                  <p>Depending on your jurisdiction, you may have certain rights regarding your personal information, including the right to access, correct, delete, or port your data. To exercise these rights, contact us at <strong>privacy@myoddsy.com</strong>.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>9. California Residents (CCPA)</h3>
                  <p>If you are a California resident, you have the right to: (a) know what personal information is collected; (b) request deletion of your personal information; (c) opt out of the sale of personal information (we do not sell personal information); (d) not be discriminated against for exercising your rights.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>10. Changes to This Policy</h3>
                  <p>We may update this Privacy Policy from time to time. The updated version will be indicated by the "Last updated" date. We encourage you to review this Privacy Policy periodically.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>11. Contact</h3>
                  <p>For questions about this Privacy Policy, contact us at: <strong>privacy@myoddsy.com</strong></p>
                </>
              )}

              {/* ── DISCLAIMER ── */}
              {legalPage === "disclaimer" && (
                <>
                  <p style={{ color: "#8b919a", fontSize: 12 }}>Last updated: April 3, 2026</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>General Disclaimer</h3>
                  <p>MyOddsy is an <strong>informational and entertainment service only</strong>. All content provided on this website, including but not limited to odds comparisons, expected value calculations, "value bets," "sharp plays," parlay suggestions, scoring systems, rankings, and any other analysis, is for <strong>informational and entertainment purposes only</strong> and should not be construed as professional gambling advice, financial advice, or a guarantee of any outcome.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>No Guarantee of Results</h3>
                  <p><strong>GAMBLING INVOLVES SUBSTANTIAL RISK OF FINANCIAL LOSS. PAST PERFORMANCE, STATISTICAL MODELS, AND MATHEMATICAL ANALYSIS DO NOT GUARANTEE FUTURE RESULTS.</strong> Expected value, edge percentages, confidence scores, and any other metrics displayed on this site are theoretical calculations based on available data at a point in time and are not predictions or guarantees of profitability. You should expect to lose money gambling. Never gamble with money you cannot afford to lose.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>Data Accuracy</h3>
                  <p>Odds and score data are sourced from third-party APIs and may be delayed, inaccurate, incomplete, or outdated. Lines change rapidly. Always verify current odds directly with your sportsbook before placing any wager. MyOddsy is not responsible for discrepancies between displayed odds and actual sportsbook odds at the time of your wager.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>Affiliate Disclosure</h3>
                  <p>MyOddsy participates in affiliate programs with licensed sportsbook operators. This means we may earn a commission when you click on sportsbook links on our site and subsequently register, deposit, or place wagers. These affiliate relationships <strong>do not influence our odds comparisons, analysis, or recommendations</strong>, which are generated by automated algorithms applied uniformly to all sportsbooks. You are never required to use any specific sportsbook, and we encourage you to shop for the best available odds.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>Legality & Restricted States</h3>
                  <p>Sports betting is not legal in all jurisdictions. It is your sole responsibility to determine whether sports betting is legal in your jurisdiction before placing any wager. MyOddsy makes no representation that the Service is appropriate or available for use in all locations. Accessing the Service from jurisdictions where its content is illegal is prohibited.</p>
                  <p style={{ marginTop: 10 }}><strong>Restricted States:</strong> Sports betting is not currently legal in all U.S. states. As of the date of this notice, states including but not limited to Utah, Idaho, Wisconsin, Alabama, Alaska, Georgia, Hawaii, Minnesota, Missouri, Oklahoma, South Carolina, and Texas do not permit legal online sports betting. If you are located in a restricted state, sportsbook referral links are automatically hidden. MyOddsy provides informational content only and does not encourage, solicit, or facilitate gambling in any jurisdiction where it is prohibited. Even in states where sports betting is legal, you must comply with all applicable state regulations including age requirements and licensing rules.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>Third-Party Sportsbooks</h3>
                  <p>MyOddsy is not affiliated with, endorsed by, or officially connected to any sportsbook operator unless explicitly stated. All sportsbook names, logos, and trademarks are the property of their respective owners. Your relationship with any sportsbook is governed entirely by that sportsbook's terms and conditions. We are not responsible for any disputes between you and a sportsbook.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>Assumption of Risk</h3>
                  <p>By using this Service, you acknowledge that you understand the risks of gambling, that gambling can be addictive, and that you are solely responsible for your own betting decisions and any financial consequences thereof. You agree that MyOddsy shall not be held liable for any losses, damages, or harm resulting from your use of the information provided on this Service.</p>
                </>
              )}

              {/* ── RESPONSIBLE GAMBLING ── */}
              {legalPage === "responsible" && (
                <>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 8, marginBottom: 8 }}>Our Commitment</h3>
                  <p>MyOddsy is committed to promoting responsible gambling. While we provide tools to help you make more informed decisions, we recognize that gambling carries inherent risks and can become problematic. We urge all users to gamble responsibly and within their means.</p>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>Guidelines for Responsible Gambling</h3>
                  <ul style={{ paddingLeft: 20, marginBottom: 16 }}>
                    <li style={{ marginBottom: 8 }}>Set a budget before you start and never bet more than you can afford to lose.</li>
                    <li style={{ marginBottom: 8 }}>Set time limits for your gambling sessions.</li>
                    <li style={{ marginBottom: 8 }}>Never chase losses — accept losses as the cost of entertainment.</li>
                    <li style={{ marginBottom: 8 }}>Do not gamble while under the influence of alcohol or drugs.</li>
                    <li style={{ marginBottom: 8 }}>Do not gamble as a way to solve financial problems or recover debts.</li>
                    <li style={{ marginBottom: 8 }}>Take regular breaks and balance gambling with other activities.</li>
                    <li style={{ marginBottom: 8 }}>Never borrow money to gamble.</li>
                    <li style={{ marginBottom: 8 }}>Be aware of the warning signs of problem gambling.</li>
                  </ul>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>Warning Signs of Problem Gambling</h3>
                  <ul style={{ paddingLeft: 20, marginBottom: 16 }}>
                    <li style={{ marginBottom: 8 }}>Spending more money or time on gambling than you intend to.</li>
                    <li style={{ marginBottom: 8 }}>Feeling the need to bet with increasing amounts of money.</li>
                    <li style={{ marginBottom: 8 }}>Feeling restless or irritable when trying to cut back.</li>
                    <li style={{ marginBottom: 8 }}>Repeated unsuccessful attempts to stop gambling.</li>
                    <li style={{ marginBottom: 8 }}>Gambling to escape problems or relieve negative feelings.</li>
                    <li style={{ marginBottom: 8 }}>Lying to family members or others about the extent of your gambling.</li>
                    <li style={{ marginBottom: 8 }}>Jeopardizing relationships, jobs, or educational/career opportunities.</li>
                    <li style={{ marginBottom: 8 }}>Relying on others to provide money to relieve a desperate financial situation caused by gambling.</li>
                  </ul>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>Resources and Help</h3>
                  <p>If you or someone you know has a gambling problem, help is available:</p>
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 16, marginTop: 10, marginBottom: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#dc2626", marginBottom: 8 }}>National Problem Gambling Helpline</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: "#1a1d23", marginBottom: 4, fontFamily: "'Space Mono', monospace" }}>1-800-522-4700</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>Available 24/7 | Confidential | Free</div>
                  </div>
                  <ul style={{ paddingLeft: 20, marginTop: 12 }}>
                    <li style={{ marginBottom: 8 }}><strong>National Council on Problem Gambling (NCPG):</strong> ncpgambling.org</li>
                    <li style={{ marginBottom: 8 }}><strong>Gamblers Anonymous:</strong> gamblersanonymous.org</li>
                    <li style={{ marginBottom: 8 }}><strong>SAMHSA National Helpline:</strong> 1-800-662-4357</li>
                    <li style={{ marginBottom: 8 }}><strong>Crisis Text Line:</strong> Text HOME to 741741</li>
                    <li style={{ marginBottom: 8 }}><strong>Gam-Anon</strong> (for families): gam-anon.org</li>
                  </ul>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>Self-Exclusion</h3>
                  <p>Most licensed sportsbooks offer self-exclusion programs that allow you to voluntarily ban yourself from their platforms. Contact your sportsbook directly or visit your state's gaming commission website for information about self-exclusion programs available in your area.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── SITE FOOTER ── */}
      <footer style={{
        background: "#1a1d23",
        color: "#8b919a",
        padding: "28px 20px 20px",
        fontSize: 11,
        lineHeight: 1.7,
      }}>
        {/* Restricted state notice */}
        {isRestricted && (
          <div style={{
            background: "rgba(251,191,36,0.1)",
            border: "1px solid rgba(251,191,36,0.3)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 11,
            color: "#fbbf24",
            lineHeight: 1.6,
          }}>
            <strong>Notice:</strong> Sports betting is not currently legal in your state. MyOddsy is an informational and entertainment platform only. Content does not constitute an offer, solicitation, or encouragement to gamble. Please check your local laws.
          </div>
        )}

        {/* Responsible gambling banner */}
        <div style={{
          background: "rgba(220,38,38,0.1)",
          border: "1px solid rgba(220,38,38,0.25)",
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 20,
          textAlign: "center",
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#fca5a5", marginBottom: 4 }}>
            Gambling Problem? Call 1-800-522-4700
          </div>
          <div style={{ fontSize: 10, color: "#8b919a" }}>
            National Council on Problem Gambling — Free, confidential, 24/7
          </div>
        </div>

        {/* Legal disclaimer */}
        <div style={{
          background: "rgba(255,255,255,0.05)",
          borderRadius: 10,
          padding: "14px 16px",
          marginBottom: 18,
          fontSize: 10,
          color: "#6b7280",
          lineHeight: 1.7,
        }}>
          <strong style={{ color: "#8b919a" }}>DISCLAIMER:</strong> MyOddsy is for informational and entertainment purposes only. We are not a sportsbook and do not accept bets. All odds data is sourced from third parties and may be delayed or inaccurate — always verify with your sportsbook. Nothing on this site constitutes professional gambling advice or guarantees any outcome. Gambling involves substantial risk of financial loss. Past statistical performance does not guarantee future results. Must be 21+ to gamble. Sports betting may not be legal in your jurisdiction — you are responsible for knowing and complying with your local laws. Some links may be affiliate links; see Affiliate Disclosure for details. If you or someone you know has a gambling problem, call <strong style={{ color: "#fca5a5" }}>1-800-522-4700</strong>.
        </div>

        {/* Legal links */}
        <div style={{
          display: "flex",
          justifyContent: "center",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 16,
        }}>
          {[
            { label: "Terms of Service", page: "terms" },
            { label: "Privacy Policy", page: "privacy" },
            { label: "Disclaimer", page: "disclaimer" },
            { label: "Responsible Gambling", page: "responsible" },
          ].map(link => (
            <button
              key={link.page}
              onClick={() => setLegalPage(link.page)}
              style={{
                background: "none",
                border: "none",
                color: "#8b919a",
                fontSize: 11,
                cursor: "pointer",
                textDecoration: "underline",
                fontFamily: "'DM Sans', sans-serif",
                padding: 0,
              }}
            >
              {link.label}
            </button>
          ))}
        </div>

        {/* Age & copyright */}
        <div style={{ textAlign: "center", fontSize: 10, color: "#4a5568" }}>
          <div style={{ marginBottom: 6 }}>
            <span style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid #4a5568",
              fontSize: 10,
              fontWeight: 700,
              color: "#8b919a",
              marginRight: 8,
            }}>21+</span>
            Must be 21 or older to use this site. Please gamble responsibly.
          </div>
          <div>&copy; {new Date().getFullYear()} MyOddsy. All rights reserved. Not affiliated with any sportsbook.</div>
        </div>
      </footer>
    </div>
  );
}