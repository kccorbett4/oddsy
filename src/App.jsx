import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { evaluateStrategy } from "./StrategyBuilder.jsx";
import UserMenu from "./lib/UserMenu.jsx";
import AuthModal from "./lib/AuthModal.jsx";
import { useAuth } from "./lib/AuthContext.jsx";
import { fetchStrategies as fetchUserStrategies } from "./lib/strategies.js";
import { supabase } from "./lib/supabase.js";
import SiteNav, { TAB_PATHS, tabFromPath } from "./SiteNav.jsx";

async function getAuthHeader() {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}


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


// Reject any single-pick odds more extreme than ±1500. Real pregame edges
// live in ±500; anything wider is almost always live-game noise or a book
// pricing a near-decided outcome. NOT applied to parlays — parlay legs get
// combined so a rare extreme leg doesn't produce runaway payouts the way
// a single-pick edge would.
const EXTREME_ODDS = 1500;

const parlayFilterBtn = {
  padding: "4px 10px", borderRadius: 6, border: "1px solid #d5d8de",
  background: "#fff", fontSize: 11, color: "#4a5568", cursor: "pointer",
  fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
};
const isExtremeOdds = (price) => Math.abs(price) > EXTREME_ODDS;

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

// Median of a numeric array (even-length: average of middle two)
const median = (arr) => {
  if (!arr || !arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Vig-removed fair probabilities for a 2-way market, per book.
// Returns { perOutcomeFair: {key: [fairProbs...]}, perOutcomeOffers: {key: [{price, book, point, name}...]} }
// where each book's two outcomes are normalized so fair1 + fair2 = 1.
const collectMarketFairProbs = (game, marketType) => {
  const perOutcomeFair = {};
  const perOutcomeOffers = {};

  game.bookmakers.forEach(book => {
    const market = book.markets.find(m => m.key === marketType);
    if (!market || !market.outcomes || market.outcomes.length !== 2) return;
    const [o1, o2] = market.outcomes;
    const p1 = impliedProb(o1.price);
    const p2 = impliedProb(o2.price);
    const sum = p1 + p2;
    // Sanity: implied probs should sum to > 1 (vig) and < ~1.25 (extreme vig).
    if (!(sum > 1.0 && sum < 1.25)) return;

    [[o1, p1 / sum], [o2, p2 / sum]].forEach(([o, fair]) => {
      const key = `${o.name}_${o.point || ''}`;
      if (!perOutcomeFair[key]) perOutcomeFair[key] = [];
      if (!perOutcomeOffers[key]) perOutcomeOffers[key] = [];
      perOutcomeFair[key].push(fair);
      perOutcomeOffers[key].push({ ...o, book: book.title, bookKey: book.key, bettable: book.bettable !== false });
    });
  });

  return { perOutcomeFair, perOutcomeOffers };
};

// Check if a game should be excluded based on live score data
const getGameStatus = (game, liveScores) => {
  if (!liveScores || liveScores.length === 0) {
    // No score data — fall back to commence_time check
    const now = new Date();
    if (new Date(game.commence_time) <= now) return "live_unknown";
    return "upcoming";
  }

  // Try to match this odds game to a live score event by team names.
  // Teams often play multi-game series on consecutive days (especially MLB),
  // so we also require the score event's commence time to be within ±12h
  // of the odds game's — otherwise today's scheduled Royals/Yankees game
  // would match yesterday's final and be incorrectly flagged as over.
  const homeNorm = game.home_team?.toLowerCase();
  const awayNorm = game.away_team?.toLowerCase();
  const oddsMs = new Date(game.commence_time).getTime();

  const match = liveScores.find(e => {
    if (e.sport_key && game.sport_key && e.sport_key !== game.sport_key) return false;
    const h = e.home?.name?.toLowerCase() || "";
    const a = e.away?.name?.toLowerCase() || "";
    const teamsMatch =
      (h.includes(homeNorm) || homeNorm?.includes(h)) &&
      (a.includes(awayNorm) || awayNorm?.includes(a));
    if (!teamsMatch) return false;
    const eMs = e.commenceTime ? new Date(e.commenceTime).getTime() : null;
    if (eMs === null) return true;
    return Math.abs(eMs - oddsMs) <= 12 * 3600 * 1000;
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

// ── Parlay leg analysis ──────────────────────────────────
// Given a game + market + outcome, return the leg's best price, book,
// and vig-free fair probability (median across books that price it).
// Returns null if the outcome can't be found or priced.
const analyzeLeg = (game, marketType, outcomeName, point, preferredBook = null) => {
  if (!game) return null;
  const { perOutcomeFair, perOutcomeOffers } = collectMarketFairProbs(game, marketType);
  const pointStr = point === null || point === undefined ? "" : `${point}`;
  // Try exact match first (name + point), then name-only for h2h
  const tryKeys = [
    `${outcomeName}_${pointStr}`,
    `${outcomeName}_`,
  ];
  let fair = null;
  let offers = null;
  for (const k of tryKeys) {
    if (perOutcomeFair[k] && perOutcomeFair[k].length > 0) {
      fair = perOutcomeFair[k];
      offers = perOutcomeOffers[k];
      break;
    }
  }
  if (!fair) return null;
  const fairProb = median(fair);
  // If the user is pinning to a specific book, use THAT book's price so the
  // analyzer matches what they'd see at Bovada/DK/etc. Otherwise take best
  // available across books.
  let chosen = null;
  if (preferredBook) {
    chosen = offers.find(o => o.book === preferredBook) || null;
    if (!chosen) return null; // book doesn't offer this outcome
  } else {
    chosen = offers.reduce((b, o) => (o.price > b.price ? o : b), offers[0]);
  }
  return {
    fairProb,
    bestOdds: chosen.price,
    bestBook: chosen.book,
    bookCount: offers.length,
    point: chosen.point ?? point ?? null,
  };
};

// Analyze a full parlay: combined odds, true probability (assumes
// independence), EV, implied prob from odds, and a qualitative verdict.
// Warns when legs share a game (correlation invalidates the independence
// assumption and the real EV skews lower).
const analyzeParlay = (legs) => {
  if (!legs || legs.length < 2) return null;
  let combinedDecimal = 1;
  let fairProbProduct = 1;
  legs.forEach(l => {
    const d = l.odds > 0 ? l.odds / 100 + 1 : 100 / Math.abs(l.odds) + 1;
    combinedDecimal *= d;
    fairProbProduct *= l.fairProb;
  });
  const combinedAmerican = combinedDecimal >= 2
    ? Math.round((combinedDecimal - 1) * 100)
    : Math.round(-100 / (combinedDecimal - 1));
  const impliedProb = 1 / combinedDecimal; // what the parlay price implies
  const ev = (fairProbProduct * (combinedDecimal - 1) - (1 - fairProbProduct)) * 100;
  const sameGameSet = new Set(legs.map(l => l.gameId));
  const hasSameGame = sameGameSet.size < legs.length;
  // Parlays are structurally -EV: each leg carries ~2–3% residual juice even
  // at best-line consensus, and it compounds multiplicatively. A "par" parlay
  // of N legs lands around -2.5% × N. We grade against that baseline, not 0,
  // so typical parlays don't all scream "avoid".
  const parEV = -2.5 * legs.length;
  const edge = ev - parEV; // how much better/worse than an average parlay this size
  let verdict, verdictColor, verdictDetail;
  if (ev >= 0) {
    verdict = "Strong +EV"; verdictColor = "#0d9f4f";
    verdictDetail = `The vig-free market says this pays more than it should. Rare — most parlays sit around ${parEV.toFixed(0)}% EV; this one is actually profitable.`;
  } else if (edge >= 4) {
    verdict = "Above average"; verdictColor = "#1a73e8";
    verdictDetail = `Par for a ${legs.length}-leg parlay is about ${parEV.toFixed(0)}% EV. Yours is ${edge.toFixed(1)} points better — still negative, but sharper than a typical ticket this size.`;
  } else if (edge >= -3) {
    verdict = "Typical parlay"; verdictColor = "#e8a100";
    verdictDetail = `A ${legs.length}-leg parlay at best lines naturally sits near ${parEV.toFixed(0)}% EV from compounding juice. This is market-rate — you're paying normal parlay tax, not getting fleeced.`;
  } else {
    verdict = "Poor value"; verdictColor = "#dc2626";
    verdictDetail = `Even for a ${legs.length}-leg parlay (baseline ${parEV.toFixed(0)}% EV), this is ${Math.abs(edge).toFixed(1)} points worse. One or more legs is badly priced — swap or skip.`;
  }
  return {
    legCount: legs.length,
    combinedDecimal,
    combinedAmerican,
    impliedProb,
    fairProb: fairProbProduct,
    ev,
    parEV,
    edge,
    hasSameGame,
    verdict,
    verdictColor,
    verdictDetail,
  };
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

      const { perOutcomeFair, perOutcomeOffers } = collectMarketFairProbs(game, marketType);

      Object.entries(perOutcomeOffers).forEach(([key, offers]) => {
        if (offers.length < 2) return;
        const fairProbs = perOutcomeFair[key];
        if (!fairProbs || fairProbs.length < 2) return;

        // Median fair prob across books = our best estimate of true probability
        // (vig removed per-book via two-way normalization).
        const vigFreeProb = median(fairProbs);

        offers.forEach(outcome => {
          // Don't recommend bets at books US users can't access — fair-value
          // math above still uses the full set (Pinnacle etc.) as the anchor.
          if (!outcome.bettable) return;
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
    .slice(0, 150);
};

// Generate 3-leg parlays from undervalued bets. Every leg in a parlay must
// come from the SAME book — books won't settle a parlay whose legs are
// priced at a different book, so mixing books produces parlays the user
// literally can't place. We group valueBets by book first, then run each
// strategy within that book's pool.
const generateParlays = (valueBets) => {
  if (valueBets.length < 3) return [];

  const byBook = {};
  for (const bet of valueBets) {
    if (!bet.book) continue;
    (byBook[bet.book] = byBook[bet.book] || []).push(bet);
  }

  const parlaysForBook = (book, pool) => {
    if (pool.length < 3) return [];
    const bySport = {};
    pool.forEach(bet => {
      const key = bet.game.sport_key;
      (bySport[key] = bySport[key] || []).push(bet);
    });
    const sportKeys = Object.keys(bySport);
    const out = [];

    // Strategy 1: Cross-Sport Value — best from 3 different sports (same book)
    if (sportKeys.length >= 3) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const shuffled = [...sportKeys].sort(() => Math.random() - 0.5);
        const legs = shuffled.slice(0, 3).map(sk => {
          const p = bySport[sk];
          return p[Math.floor(Math.random() * Math.min(p.length, 3))];
        });
        if (legs.every(Boolean) && new Set(legs.map(l => l.game.id)).size === 3) {
          out.push({ legs, strategy: "Cross-Sport Value", icon: "🌐", desc: `Top +EV picks across 3 different sports, all at ${book}` });
        }
      }
    }

    // Strategy 2: Chalk Crusher — 3 underdog value plays (same book)
    const underdogs = pool.filter(b => b.odds > 100).sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev));
    if (underdogs.length >= 3) {
      const legs = []; const used = new Set();
      for (const bet of underdogs) { if (!used.has(bet.game.id) && legs.length < 3) { legs.push(bet); used.add(bet.game.id); } }
      if (legs.length === 3) out.push({ legs, strategy: "Chalk Crusher", icon: "💥", desc: `3 undervalued underdogs with positive EV at ${book}` });
    }

    // Strategy 3: Sharp Consensus — highest EV (same book)
    const topEV = [...pool].sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev));
    const sharpLegs = []; const usedG1 = new Set();
    for (const bet of topEV) { if (!usedG1.has(bet.game.id) && sharpLegs.length < 3) { sharpLegs.push(bet); usedG1.add(bet.game.id); } }
    if (sharpLegs.length === 3) out.push({ legs: sharpLegs, strategy: "Sharp Consensus", icon: "🎯", desc: `The 3 highest EV bets at ${book}` });

    // Strategy 4: Safe + Sprinkle — 2 favorites + 1 big underdog (same book)
    const favorites = pool.filter(b => b.odds < 0 && b.odds > -200).sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev));
    const bigDogs = pool.filter(b => b.odds > 150).sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev));
    if (favorites.length >= 2 && bigDogs.length >= 1) {
      const used = new Set(); const legs = [];
      for (const f of favorites) { if (!used.has(f.game.id) && legs.length < 2) { legs.push(f); used.add(f.game.id); } }
      for (const d of bigDogs) { if (!used.has(d.game.id) && legs.length < 3) { legs.push(d); used.add(d.game.id); } }
      if (legs.length === 3) out.push({ legs, strategy: "Safe + Sprinkle", icon: "🛡️", desc: `2 value favorites + 1 high-upside underdog at ${book}` });
    }

    return out.map(p => ({ ...p, book }));
  };

  const parlays = [];
  for (const [book, pool] of Object.entries(byBook)) {
    parlays.push(...parlaysForBook(book, pool));
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
    // Exclude finished, blowout, and any live games (both confirmed in_progress
    // and unconfirmed live_unknown). Live lines are too noisy — they produce
    // phantom "edges" from books pulling lines at different times.
    if (status === "final" || status === "blowout" || status === "in_progress" || status === "live_unknown") return;

    const marketTypes = ["h2h", "spreads", "totals"];
    marketTypes.forEach(marketType => {
      const { perOutcomeFair, perOutcomeOffers } = collectMarketFairProbs(game, marketType);

      Object.entries(perOutcomeOffers).forEach(([key, outcomes]) => {
        if (outcomes.length < 2) return;
        const fairProbs = perOutcomeFair[key];
        if (!fairProbs || fairProbs.length < 2) return;

        const prices = outcomes.map(o => o.price);
        const vigFreeProb = median(fairProbs);

        outcomes.forEach(outcome => {
          if (!outcome.bettable) return;
          if (isExtremeOdds(outcome.price)) return;
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

          // ── FACTOR 2: Underdog Value (0-15 pts) ──
          // Underdogs are systematically undervalued, but we don't want the
          // score to be dominated by longshots — cap this tighter than EV so
          // a +110 play with 8% EV outranks a +400 play with 2% EV.
          let underdogScore = 0;
          if (marketType === "h2h" && outcome.price > 100) {
            // Full 15 pts requires +400 or more; linear below that.
            underdogScore = Math.min(15, (outcome.price - 100) / 300 * 15);
            // Home-underdog nudge kept but lighter — 1.2× not 1.4×.
            const isHome = outcome.name === game.home_team;
            if (isHome) underdogScore = Math.min(15, underdogScore * 1.2);
          }
          if (marketType === "spreads" && outcome.point && outcome.point > 0) {
            underdogScore = Math.min(12, outcome.point / 10 * 12);
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

          // ── FACTOR 4: EV Strength (0-30 pts) ──
          // Bumped from 20 → 30 so the real mathematical edge carries more
          // weight than raw underdog odds. Full 30 pts at 10% EV.
          const evScore = Math.min(30, (ev / 10) * 30);

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

  return plays.sort((a, b) => b.totalScore - a.totalScore).slice(0, 150);
};

// ── Stale Line Detector ─────────────────────────────────
// Finds books where the line hasn't moved with the rest of the market
const findStaleLines = (games, liveScores) => {
  const stale = [];
  games.forEach(game => {
    const status = getGameStatus(game, liveScores);
    // Exclude live games entirely — stale-line detection requires comparable
    // pregame lines. Live books pull or freeze lines at different times,
    // producing phantom "stale" signals.
    if (status === "final" || status === "blowout" || status === "in_progress" || status === "live_unknown") return;

    ["h2h", "spreads", "totals"].forEach(marketType => {
      const allOutcomes = {};
      game.bookmakers.forEach(book => {
        const market = book.markets.find(m => m.key === marketType);
        if (!market) return;
        market.outcomes.forEach(outcome => {
          const key = `${outcome.name}_${outcome.point || ''}`;
          if (!allOutcomes[key]) allOutcomes[key] = [];
          allOutcomes[key].push({ ...outcome, book: book.title, bettable: book.bettable !== false });
        });
      });

      Object.entries(allOutcomes).forEach(([, outcomes]) => {
        if (outcomes.length < 4) return; // need enough books for consensus
        const prices = outcomes.map(o => o.price);
        const sorted = [...prices].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        outcomes.forEach(outcome => {
          if (!outcome.bettable) return;
          if (isExtremeOdds(outcome.price)) return;
          const diff = Math.abs(outcome.price - median);
          const booksAtMedian = prices.filter(p => Math.abs(p - median) < 10).length;
          const consensusRatio = booksAtMedian / prices.length;

          // Stale = this book is far from median while most others agree
          if (diff >= 12 && consensusRatio >= 0.6) {
            const staleScore = (diff / 100) * consensusRatio * 10;
            const isBetterOdds = outcome.price > median; // better for bettor
            stale.push({
              game, marketType,
              outcome: outcome.name,
              point: outcome.point,
              staleBook: outcome.book,
              staleOdds: outcome.price,
              marketMedian: median,
              diff: Math.round(diff),
              consensusPct: Math.round(consensusRatio * 100),
              booksAgreed: booksAtMedian,
              totalBooks: prices.length,
              staleScore: parseFloat(staleScore.toFixed(2)),
              isBetterOdds,
              commence: game.commence_time,
              allBookOdds: outcomes.map(o => ({ book: o.book, odds: o.price })),
            });
          }
        });
      });
    });
  });
  return stale
    .filter(s => s.isBetterOdds) // only show stale lines that benefit the bettor
    .sort((a, b) => b.staleScore - a.staleScore)
    .slice(0, 100);
};

// ── Reverse Line Movement Detector ──────────────────────
// Finds games where sharp money likely moved some books but not all
const findRLMPlays = (games, liveScores) => {
  const plays = [];
  games.forEach(game => {
    const status = getGameStatus(game, liveScores);
    // Exclude all live + finished games. RLM requires pregame line movement
    // across a reasonable window; live markets toggle too rapidly for this
    // heuristic to be meaningful.
    if (status === "final" || status === "blowout" || status === "in_progress" || status === "live_unknown") return;

    ["spreads", "h2h"].forEach(marketType => {
      const allOutcomes = {};
      game.bookmakers.forEach(book => {
        const market = book.markets.find(m => m.key === marketType);
        if (!market) return;
        market.outcomes.forEach(outcome => {
          const key = `${outcome.name}_${outcome.point || ''}`;
          if (!allOutcomes[key]) allOutcomes[key] = [];
          allOutcomes[key].push({ ...outcome, book: book.title, bettable: book.bettable !== false });
        });
      });

      Object.entries(allOutcomes).forEach(([, outcomes]) => {
        if (outcomes.length < 4) return;
        const prices = outcomes.map(o => o.price);
        const sorted = [...prices].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const range = sorted[sorted.length - 1] - sorted[0];

        if (range < 15) return; // need meaningful spread across books

        // Find the side where sharp money may have moved (lower odds = more action)
        const sharpSide = outcomes.filter(o => o.price < median - 5);
        // Only recommend at US-bettable books; sharp side can include any book
        // since it's just signaling where the smart money went.
        const publicSide = outcomes.filter(o => o.price >= median && o.bettable);

        if (sharpSide.length >= 1 && publicSide.length >= 2) {
          // Sharp books have lower odds (took action and adjusted)
          // Public books still have higher odds (haven't adjusted)
          const bestPublicOdds = publicSide.reduce((best, o) => o.price > best.price ? o : best, publicSide[0]);
          if (isExtremeOdds(bestPublicOdds.price)) return;
          const avgSharp = sharpSide.reduce((a, o) => a + o.price, 0) / sharpSide.length;
          const rlmScore = ((bestPublicOdds.price - avgSharp) / 100) * (publicSide.length / outcomes.length) * 10;

          if (rlmScore > 0.3) {
            plays.push({
              game, marketType,
              outcome: bestPublicOdds.name,
              point: bestPublicOdds.point,
              bestBook: bestPublicOdds.book,
              bestOdds: bestPublicOdds.price,
              sharpBooks: sharpSide.map(o => ({ book: o.book, odds: o.price })),
              publicBooks: publicSide.map(o => ({ book: o.book, odds: o.price })),
              rlmScore: parseFloat(rlmScore.toFixed(2)),
              lineRange: range,
              commence: game.commence_time,
            });
          }
        }
      });
    });
  });
  return plays.sort((a, b) => b.rlmScore - a.rlmScore).slice(0, 80);
};

// ── Correlated Parlays ──────────────────────────────────
// Finds same-game parlay legs that are logically correlated
const findCorrelatedParlays = (games, liveScores) => {
  const correlated = [];
  games.forEach(game => {
    const status = getGameStatus(game, liveScores);
    // live_unknown = commence time passed but no live feed — almost always a
    // game that finished without scores reaching us. Treat as over.
    if (status === "final" || status === "blowout" || status === "in_progress" || status === "live_unknown") return;

    const getMarketOutcomes = (marketType) => {
      const outcomes = {};
      game.bookmakers.forEach(book => {
        const market = book.markets.find(m => m.key === marketType);
        if (!market) return;
        // Only pull prices from bettable books — correlated parlays are only
        // useful if the user can actually place them.
        if (book.bettable === false) return;
        market.outcomes.forEach(o => {
          const key = `${o.name}_${o.point || ''}`;
          if (!outcomes[key]) outcomes[key] = [];
          outcomes[key].push({ ...o, book: book.title });
        });
      });
      // Return best odds for each outcome
      const best = {};
      Object.entries(outcomes).forEach(([key, os]) => {
        const sorted = os.sort((a, b) => b.price - a.price);
        best[key] = sorted[0]; // highest payout
      });
      return best;
    };

    const h2h = getMarketOutcomes("h2h");
    const totals = getMarketOutcomes("totals");
    const spreads = getMarketOutcomes("spreads");

    // Find the favorite and underdog
    const h2hEntries = Object.entries(h2h);
    if (h2hEntries.length < 2) return;
    const [team1Entry, team2Entry] = h2hEntries;
    const favorite = team1Entry[1].price < team2Entry[1].price ? team1Entry : team2Entry;
    const underdog = team1Entry[1].price >= team2Entry[1].price ? team1Entry : team2Entry;

    const overEntry = Object.entries(totals).find(([k]) => k.startsWith("Over"));
    const underEntry = Object.entries(totals).find(([k]) => k.startsWith("Under"));

    if (!overEntry || !underEntry) return;

    // Correlation 1: Favorite ML + Over
    // If the favorite wins, they likely scored a lot → over more likely
    const combineDecimal = (o1, o2) => {
      const d1 = o1.price > 0 ? (o1.price / 100) + 1 : (100 / Math.abs(o1.price)) + 1;
      const d2 = o2.price > 0 ? (o2.price / 100) + 1 : (100 / Math.abs(o2.price)) + 1;
      return d1 * d2;
    };

    const addCombo = (leg1Label, leg1, leg2Label, leg2, reason, strength) => {
      const combined = combineDecimal(leg1, leg2);
      const combinedAmerican = combined >= 2 ? Math.round((combined - 1) * 100) : Math.round(-100 / (combined - 1));
      correlated.push({
        game,
        leg1: { label: leg1Label, ...leg1 },
        leg2: { label: leg2Label, ...leg2 },
        reason,
        strength,
        combinedOdds: combinedAmerican,
        combinedDecimal: combined.toFixed(2),
        commence: game.commence_time,
      });
    };

    // Favorite ML + Over (strong correlation)
    addCombo(
      `${favorite[1].name} ML`, favorite[1],
      `Over ${overEntry[1].point}`, overEntry[1],
      "If the favorite wins comfortably, total points tend to go over",
      "strong"
    );

    // Underdog ML + Under (moderate correlation)
    addCombo(
      `${underdog[1].name} ML`, underdog[1],
      `Under ${underEntry[1].point}`, underEntry[1],
      "Underdog wins are often low-scoring, grind-it-out games",
      "moderate"
    );

    // Underdog spread + Under (moderate)
    const dogSpread = Object.entries(spreads).find(([k]) => k.startsWith(underdog[1].name));
    if (dogSpread) {
      addCombo(
        `${underdog[1].name} ${dogSpread[1].point > 0 ? '+' : ''}${dogSpread[1].point}`, dogSpread[1],
        `Under ${underEntry[1].point}`, underEntry[1],
        "Underdog covers are more likely in lower-scoring games",
        "moderate"
      );
    }

    // Favorite spread + Over (moderate)
    const favSpread = Object.entries(spreads).find(([k]) => k.startsWith(favorite[1].name));
    if (favSpread) {
      addCombo(
        `${favorite[1].name} ${favSpread[1].point > 0 ? '+' : ''}${favSpread[1].point}`, favSpread[1],
        `Over ${overEntry[1].point}`, overEntry[1],
        "Favorite covers are more common in high-scoring games",
        "moderate"
      );
    }
  });

  return correlated.sort((a, b) => {
    const s = { strong: 3, moderate: 2, weak: 1 };
    return (s[b.strength] || 0) - (s[a.strength] || 0);
  }).slice(0, 100);
};

// ── Narrative Regression ────────────────────────────────
// Finds teams coming off blowout results that may be over/undervalued
const findNarrativePlays = (games, liveScores) => {
  const plays = [];
  if (!liveScores || liveScores.length === 0) return plays;

  // Blowout thresholds by sport_key — absolute point/run/goal margin
  const BLOWOUT_THRESHOLD = {
    basketball_nba: 20,
    basketball_ncaab: 25,
    americanfootball_nfl: 21,
    americanfootball_ncaaf: 24,
    baseball_mlb: 7,
    icehockey_nhl: 4,
  };

  // Find teams with blowout results (finished games)
  const blowoutTeams = new Set();
  const blowoutDetails = {};
  liveScores.forEach(event => {
    if (event.status.type !== "STATUS_FINAL") return;
    const threshold = BLOWOUT_THRESHOLD[event.sport_key];
    if (!threshold) return; // unknown sport — skip
    const diff = Math.abs(event.home.score - event.away.score);
    if (diff < threshold) return;

    const loser = event.home.score < event.away.score ? event.home.name : event.away.name;
    const winner = event.home.score > event.away.score ? event.home.name : event.away.name;
    if (!loser) return;

    blowoutTeams.add(loser.toLowerCase());
    blowoutDetails[loser.toLowerCase()] = {
      opponent: winner,
      score: `${event.away.score}-${event.home.score}`,
      margin: diff,
      team: loser,
      sport_key: event.sport_key,
    };
  });

  if (blowoutTeams.size === 0) return plays;

  // Find upcoming games featuring blowout losers
  games.forEach(game => {
    const status = getGameStatus(game, liveScores);
    if (status === "final" || status === "blowout" || status === "in_progress" || status === "live_unknown") return;

    const homeNorm = game.home_team.toLowerCase();
    const awayNorm = game.away_team.toLowerCase();

    // Token-based team matching — "Chicago Bulls" must not match "Chicago
    // Fire" just because both contain "chicago". Require the mascot token
    // (last word of the shorter name) to appear as a whole word.
    const nameMatches = (candidate, known) => {
      if (!candidate || !known) return false;
      if (candidate === known) return true;
      const tokens = (name) => name.split(/\s+/).filter(Boolean);
      const cTok = tokens(candidate);
      const kTok = tokens(known);
      const short = cTok.length < kTok.length ? cTok : kTok;
      const long = cTok.length < kTok.length ? kTok : cTok;
      // Mascot (last token) must match; that's the most distinctive part.
      if (short[short.length - 1] !== long[long.length - 1]) return false;
      // All tokens in the shorter name must appear in the longer.
      return short.every(t => long.includes(t));
    };
    let blowoutTeam = null;
    let blowoutInfo = null;
    for (const [teamName, info] of Object.entries(blowoutDetails)) {
      if (nameMatches(homeNorm, teamName)) {
        blowoutTeam = game.home_team;
        blowoutInfo = info;
        break;
      }
      if (nameMatches(awayNorm, teamName)) {
        blowoutTeam = game.away_team;
        blowoutInfo = info;
        break;
      }
    }

    if (!blowoutTeam || !blowoutInfo) return;

    // Get the spread for the blowout team — only recommend at bettable books.
    const spreadsData = {};
    game.bookmakers.forEach(book => {
      if (book.bettable === false) return;
      const market = book.markets.find(m => m.key === "spreads");
      if (!market) return;
      market.outcomes.forEach(o => {
        if (o.name === blowoutTeam) {
          if (!spreadsData[o.name]) spreadsData[o.name] = [];
          spreadsData[o.name].push({ ...o, book: book.title });
        }
      });
    });

    const teamSpreads = spreadsData[blowoutTeam];
    if (!teamSpreads || teamSpreads.length === 0) return;

    // Find best spread for the blowout loser (public likely overreacting).
    // Prefer higher point, but when two books are within 0.5 pt break the tie
    // by implied payout (higher-paying American odds win).
    const bestSpread = teamSpreads.slice().sort((a, b) => {
      if (Math.abs(b.point - a.point) > 0.5) return b.point - a.point;
      const payA = a.price > 0 ? a.price / 100 : 100 / Math.abs(a.price);
      const payB = b.price > 0 ? b.price / 100 : 100 / Math.abs(b.price);
      return payB - payA;
    })[0];

    if (bestSpread.point > 0) {
      if (isExtremeOdds(bestSpread.price)) return;
      // They're an underdog — this is the narrative regression play
      plays.push({
        game,
        blowoutTeam,
        blowoutInfo,
        bestBook: bestSpread.book,
        bestSpread: bestSpread.point,
        bestOdds: bestSpread.price,
        allSpreads: teamSpreads.map(s => ({ book: s.book, spread: s.point, odds: s.price })),
        commence: game.commence_time,
      });
    }
  });

  return plays.sort((a, b) => b.bestSpread - a.bestSpread);
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

// Sportsbook name rendered as a link to the book's site (when we know it).
// stopPropagation so nested clicks don't trigger the parent card's click.
const BookLink = ({ book, style, prefix = "", suffix = "" }) => {
  const url = BOOK_URLS[book];
  const label = `${prefix}${book || ""}${suffix}`;
  if (!book) return null;
  if (!url) return <span style={style}>{label}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{
        color: "inherit",
        textDecoration: "underline",
        textDecorationStyle: "dotted",
        textUnderlineOffset: 2,
        cursor: "pointer",
        ...style,
      }}
    >
      {label}
    </a>
  );
};

// Small "i" icon that reveals every book's price for an outcome on hover/tap.
// Pass the raw game object + the market coordinates (outcome name, point) so
// we can pull offers across every bookmaker.
const AllBooksTooltip = ({ game, marketType, outcome, point, bestBook }) => {
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState("right"); // "right" default; flip to "left" if overflowing viewport
  const wrapRef = useRef(null);
  const popRef = useRef(null);

  // Dismiss on tap/click outside. Mouseleave isn't enough on touch devices
  // — once the popover opens on tap there's no "leave" event to close it.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("touchstart", onDocDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("touchstart", onDocDown);
    };
  }, [open]);

  // When the popover opens, check whether right-alignment pushes it off the
  // left edge of the viewport (common for the leftmost column on mobile) and
  // flip to left-alignment if so.
  useEffect(() => {
    if (!open) { setAlign("right"); return; }
    const el = popRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.left < 4) setAlign("left");
  }, [open]);

  if (!game || !marketType || !outcome) return null;
  const { perOutcomeOffers } = collectMarketFairProbs(game, marketType);
  const pointStr = point === null || point === undefined ? "" : `${point}`;
  const offers = perOutcomeOffers[`${outcome}_${pointStr}`] || perOutcomeOffers[`${outcome}_`] || [];
  if (offers.length === 0) return null;
  const sorted = [...offers].sort((a, b) => b.price - a.price);
  const toggle = (e) => { e.stopPropagation(); e.preventDefault(); setOpen(v => !v); };
  return (
    <span
      ref={wrapRef}
      style={{ position: "relative", display: "inline-block", marginLeft: 4, verticalAlign: "middle" }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label="Show all books"
        aria-expanded={open}
        style={{
          // 28x28 transparent hit target with a 13px visual dot — mobile
          // needs ≥24px tappable area per Apple/Google guidelines.
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 28, height: 28, padding: 0, margin: -8,
          background: "transparent", border: "none",
          cursor: "pointer", verticalAlign: "middle",
        }}
      >
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 14, height: 14, borderRadius: "50%",
          border: "1px solid #cbd5e0", background: open ? "#1a73e8" : "#fff",
          fontSize: 9, fontWeight: 800, color: open ? "#fff" : "#6b7280",
          fontStyle: "italic", lineHeight: 1, pointerEvents: "none",
        }}>i</span>
      </button>
      {open && (
        <div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            ...(align === "left" ? { left: 0 } : { right: 0 }),
            top: "calc(100% + 4px)",
            zIndex: 1000,
            background: "#fff", border: "1px solid #e2e5ea",
            borderRadius: 8, padding: "8px 10px",
            boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
            minWidth: 150, maxWidth: "80vw", whiteSpace: "nowrap",
            textAlign: "left",
          }}
        >
          <div style={{
            fontSize: 9, fontWeight: 800, color: "#6b7280",
            textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6,
          }}>
            All Books ({sorted.length})
          </div>
          {sorted.map((o, i) => {
            const isBest = o.book === bestBook || (!bestBook && i === 0);
            return (
              <div key={o.book} style={{
                display: "flex", justifyContent: "space-between", gap: 14,
                padding: "2px 0", fontSize: 11,
                color: isBest ? "#0d9f4f" : "#4a5568",
                fontWeight: isBest ? 700 : 500,
              }}>
                <span>{o.book}{isBest ? " ★" : ""}</span>
                <span style={{ fontFamily: "'Space Mono', monospace" }}>
                  {o.price > 0 ? `+${o.price}` : o.price}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
};

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

const SAMPLE_THRESHOLD = 1;

// Click-to-reveal modal that explains units and translates the current
// total into concrete dollar amounts at common bet sizes. Rendered as a
// centered overlay so it never clips off the edge of the screen.
const UnitsInfo = ({ units, dark = false }) => {
  const [open, setOpen] = useState(false);
  const u = typeof units === "number" ? units : parseFloat(units || 0);
  const fmt = (n) => {
    const s = n.toFixed(2);
    const [whole, dec] = s.split(".");
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + dec;
  };
  const sign = u >= 0 ? "+" : "-";
  const abs = Math.abs(u);
  const direction = u >= 0 ? "up" : "down";
  const profitColor = u >= 0 ? "#0d9f4f" : "#dc2626";
  const iconColor = dark ? "#a0aec0" : "#8b919a";

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        aria-label="What does 'u' mean?"
        style={{
          width: 20, height: 20, borderRadius: "50%",
          border: `1px solid ${iconColor}`, background: "transparent",
          color: iconColor, fontSize: 12, fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", marginLeft: 8, padding: 0, lineHeight: 1,
          fontFamily: "'DM Sans', sans-serif", flexShrink: 0,
        }}
      >i</button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(4px)", zIndex: 2000,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", color: "#1a1d23",
              borderRadius: 14, padding: "20px 22px",
              width: "100%", maxWidth: 380, maxHeight: "90vh", overflowY: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
              fontFamily: "'DM Sans', sans-serif", textAlign: "left",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>What is a "unit"?</div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  background: "none", border: "none", fontSize: 22, color: "#8b919a",
                  cursor: "pointer", padding: 0, lineHeight: 1, fontFamily: "inherit",
                }}
              >×</button>
            </div>

            <div style={{ fontSize: 13, color: "#4a5568", lineHeight: 1.6, marginBottom: 14 }}>
              A <strong>unit</strong> is the amount of money you bet <strong>on each pick</strong>. You decide what that is — and you keep it the same every time.
            </div>

            <div style={{ background: "#f5f6f8", borderRadius: 10, padding: "12px 14px", marginBottom: 14, fontSize: 13, color: "#1a1d23", lineHeight: 1.6 }}>
              If you bet <strong>$10</strong> every pick → your unit is $10.<br />
              If you bet <strong>$50</strong> every pick → your unit is $50.<br />
              If you bet <strong>$100</strong> every pick → your unit is $100.
            </div>

            <div style={{ fontSize: 12, fontWeight: 800, color: "#1a1d23", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              How it adds up over many bets
            </div>
            <div style={{ fontSize: 13, color: "#4a5568", lineHeight: 1.6, marginBottom: 14 }}>
              Every pick earns or loses units based on the odds. A win at −110 is about <strong>+0.91u</strong>. A loss is always <strong>−1u</strong>. A win at +200 is <strong>+2u</strong>. Over a whole season the wins and losses add up.
              <br /><br />
              This strategy's total is <strong style={{ color: profitColor }}>{sign}{abs.toFixed(2)}u</strong>. That's the sum of every recommended pick — wins and losses combined.
            </div>

            <div style={{ fontSize: 12, fontWeight: 800, color: "#1a1d23", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Your total profit if you'd followed every pick
            </div>
            <div style={{ fontSize: 13, color: "#1a1d23", lineHeight: 1.9, marginBottom: 14 }}>
              <div>Betting $10 each &nbsp;→&nbsp; <strong style={{ color: profitColor }}>{sign}${fmt(abs * 10)}</strong></div>
              <div>Betting $50 each &nbsp;→&nbsp; <strong style={{ color: profitColor }}>{sign}${fmt(abs * 50)}</strong></div>
              <div>Betting $100 each &nbsp;→&nbsp; <strong style={{ color: profitColor }}>{sign}${fmt(abs * 100)}</strong></div>
              <div>Betting $1,000 each &nbsp;→&nbsp; <strong style={{ color: profitColor }}>{sign}${fmt(abs * 1000)}</strong></div>
            </div>

            <div style={{ fontSize: 11, color: "#8b919a", lineHeight: 1.55, paddingTop: 10, borderTop: "1px solid #f0f1f3" }}>
              Why units instead of dollars? Because a win on a +200 underdog doubles your bet, but a win on a −150 favorite only returns about two-thirds of it. Units handle that math so the track record works no matter what size you play.
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const PerformanceBanner = ({ stats, label }) => {
  if (!stats || stats.total === 0) return null;
  const decided = (stats.wins || 0) + (stats.losses || 0);

  if (decided < SAMPLE_THRESHOLD) {
    return (
      <div style={{
        background: "#f8f9fa",
        border: "1px solid #e2e5ea",
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            fontSize: 14, fontWeight: 800, color: "#6b7280",
            fontFamily: "'DM Sans', sans-serif",
          }}>📊</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#1a1d23" }}>{label} — Building Sample</div>
            <div style={{ fontSize: 10, color: "#8b919a" }}>
              {stats.wins}W - {stats.losses}L{stats.pushes > 0 ? ` - ${stats.pushes}P` : ""} · Building sample
            </div>
          </div>
        </div>
      </div>
    );
  }

  const units = typeof stats.units === "number" ? stats.units : parseFloat(stats.units || 0);
  const roi = stats.roi;
  const roiNum = roi === null || roi === undefined ? null : parseFloat(roi);
  const color = roiNum === null ? "#8b919a"
    : roiNum >= 5 ? "#0d9f4f" : roiNum >= 0 ? "#1a73e8" : "#e8a100";
  const unitsStr = (units >= 0 ? "+" : "") + units.toFixed(2) + "u";
  const roiStr = roiNum === null ? "—" : `${roiNum >= 0 ? "+" : ""}${roiNum.toFixed(1)}%`;
  return (
    <div style={{
      background: `${color}08`,
      border: `1px solid ${color}30`,
      borderRadius: 10,
      padding: "10px 14px",
      marginBottom: 14,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{
            fontSize: 20, fontWeight: 900, color,
            fontFamily: "'Space Mono', monospace",
          }}>{unitsStr}</div>
          <UnitsInfo units={units} />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#1a1d23" }}>{label} · {roiStr} ROI</div>
          <div style={{ fontSize: 10, color: "#8b919a" }}>
            {stats.wins}W - {stats.losses}L{stats.pushes > 0 ? ` - ${stats.pushes}P` : ""} ({stats.winPct || "—"}% win) · {stats.total} tracked
          </div>
        </div>
      </div>
    </div>
  );
};

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
  const bestH2H = { home: { odds: -Infinity, book: "", name: "" }, away: { odds: -Infinity, book: "", name: "" } };
  game.bookmakers.forEach(b => {
    const h2h = b.markets.find(m => m.key === "h2h");
    if (!h2h) return;
    if (h2h.outcomes[0]?.price > bestH2H.home.odds) { bestH2H.home = { odds: h2h.outcomes[0].price, book: b.title, name: h2h.outcomes[0].name }; }
    if (h2h.outcomes[1]?.price > bestH2H.away.odds) { bestH2H.away = { odds: h2h.outcomes[1].price, book: b.title, name: h2h.outcomes[1].name }; }
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
        <div style={{ fontSize: 9, color: "#8b919a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <BookLink book={bestH2H.away.book} />
          <AllBooksTooltip game={game} marketType="h2h" outcome={bestH2H.away.name} point={null} bestBook={bestH2H.away.book} />
        </div>
      </div>
      <div style={{ textAlign: "center", minWidth: 65 }}>
        <div style={{ fontSize: 10, color: "#8b919a", marginBottom: 2 }}>BEST ML</div>
        <div style={{ color: "#0d9f4f", fontWeight: 700, fontFamily: "'Space Mono', monospace", fontSize: 13 }}>
          {formatOdds(bestH2H.home.odds)}
        </div>
        <div style={{ fontSize: 9, color: "#8b919a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <BookLink book={bestH2H.home.book} />
          <AllBooksTooltip game={game} marketType="h2h" outcome={bestH2H.home.name} point={null} bestBook={bestH2H.home.book} />
        </div>
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
  const [gameContextMap, setGameContextMap] = useState(null);
  const [valueBets, setValueBets] = useState([]);
  const [activeSport, setActiveSport] = useState("all");
  const location = useLocation();
  const navigate = useNavigate();
  const routeParams = useParams();
  const activeTab = tabFromPath(location.pathname);
  const setActiveTab = (tab) => navigate(TAB_PATHS[tab] || "/");
  const { user, setShowAuthModal } = useAuth();
  const openStrategyBuilder = () => {
    if (user) navigate("/strategy-builder");
    else setShowAuthModal(true);
  };

  // URL-driven sub-views so the browser back button works between filters.
  const PICK_FILTERS = new Set(["all", "sharp", "value", "stale", "rlm", "narrative"]);
  const GAMES_SUBS = new Set(["odds", "scores"]);
  const pickFilter = activeTab === "picks"
    ? (PICK_FILTERS.has(routeParams.filter) ? routeParams.filter : "all")
    : "all";
  const setPickFilter = (f) => navigate(f === "all" ? "/picks" : `/picks/${f}`);
  const gamesSub = activeTab === "games"
    ? (GAMES_SUBS.has(routeParams.sub) ? routeParams.sub : "odds")
    : "odds";
  const setGamesSub = (s) => navigate(s === "odds" ? "/games" : `/games/${s}`);

  const [parlaySub, setParlaySub] = useState("safe"); // safe | correlated | analyze
  const [analyzerLegs, setAnalyzerLegs] = useState([]);
  const [analyzerSearch, setAnalyzerSearch] = useState("");
  const [analyzerSport, setAnalyzerSport] = useState("all");
  const [analyzerBook, setAnalyzerBook] = useState("any");
  const [pickInfoOpen, setPickInfoOpen] = useState(null); // which strategy's "how it works" is showing
  const [bookCompareOpen, setBookCompareOpen] = useState(false); // parlay per-book breakdown popover
  const [showAlertBuilder, setShowAlertBuilder] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [parlays, setParlays] = useState([]);
  const [parlayKey, setParlayKey] = useState(0);
  const [wagerAmount, setWagerAmount] = useState(25);
  // null = all books included. User flips to explicit Set once they toggle.
  const [parlayEnabledBooks, setParlayEnabledBooks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dataSource, setDataSource] = useState("loading");
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);
  const [liveScores, setLiveScores] = useState([]);
  const [sharpPlays, setSharpPlays] = useState([]);
  const [staleLines, setStaleLines] = useState([]);
  const [rlmPlays, setRlmPlays] = useState([]);
  const [correlatedParlays, setCorrelatedParlays] = useState([]);
  const [narrativePlays, setNarrativePlays] = useState([]);
  const [legalPage, setLegalPage] = useState(null); // "terms" | "privacy" | "disclaimer" | "responsible" | null
  const [strategyStats, setStrategyStats] = useState({});
  const [resolvedPicks, setResolvedPicks] = useState([]);
  const [customStrategiesList, setCustomStrategiesList] = useState([]);

  // Load the signed-in user's custom strategies so we can display their names
  // in the Track Record tab.
  useEffect(() => {
    if (!user) { setCustomStrategiesList([]); return; }
    let cancelled = false;
    fetchUserStrategies().then(list => {
      if (!cancelled) setCustomStrategiesList(list);
    });
    return () => { cancelled = true; };
  }, [user]);
  // Record period lives in the URL (?period=7|30|all) so the browser back
  // button walks period changes and each period is a shareable link.
  const recordPeriod = (() => {
    const p = new URLSearchParams(location.search).get("period");
    return p === "7" || p === "30" ? p : "all";
  })();
  const setRecordPeriod = (p) => {
    const search = p === "all" ? "" : `?period=${p}`;
    navigate(`${location.pathname}${search}`);
  };
  // Drill-down strategy comes from the URL (/record/:strategy) so browser
  // back works and links are shareable. Setter navigates.
  const selectedStrategy = routeParams.strategy || null;
  const setSelectedStrategy = (id) => navigate(id ? `/record/${id}` : "/record");
  const picksSentRef = useRef(false);
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
    const CACHE_KEY = "oddsy_odds_cache:v3";
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
            setStaleLines(findStaleLines(cachedData, liveScores));
            setRlmPlays(findRLMPlays(cachedData, liveScores));
            setCorrelatedParlays(findCorrelatedParlays(cachedData, liveScores));
            setNarrativePlays(findNarrativePlays(cachedData, liveScores));
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
          setStaleLines(findStaleLines(json.games, liveScores));
          setRlmPlays(findRLMPlays(json.games, liveScores));
          setCorrelatedParlays(findCorrelatedParlays(json.games, liveScores));
          setNarrativePlays(findNarrativePlays(json.games, liveScores));
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
        setStaleLines([]);
        setRlmPlays([]);
        setCorrelatedParlays([]);
        setNarrativePlays([]);
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
      setStaleLines(findStaleLines(games, liveScores));
      setRlmPlays(findRLMPlays(games, liveScores));
      setCorrelatedParlays(findCorrelatedParlays(games, liveScores));
      setNarrativePlays(findNarrativePlays(games, liveScores));
    }
  }, [liveScores]);

  useEffect(() => {
    if (valueBets.length > 0) setParlays(generateParlays(valueBets));
  }, [parlayKey]);

  // Fetch strategy performance stats. Refetches when auth changes so the
  // signed-in user's custom stats replace the anonymous view.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const headers = user ? await getAuthHeader() : {};
      fetch("/api/track-stats", { headers })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (!cancelled && data?.stats) setStrategyStats(data.stats); })
        .catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Fetch individual resolved picks — powers the Record tab drill-down
  // and period filtering. Refetches when auth changes so the user sees
  // their own custom-strategy picks.
  const picksLoadedRef = useRef(null);
  useEffect(() => {
    if (activeTab !== "record") return;
    const authKey = user?.id || "anon";
    if (picksLoadedRef.current === authKey) return;
    picksLoadedRef.current = authKey;
    (async () => {
      const headers = user ? await getAuthHeader() : {};
      fetch("/api/track-picks", { headers })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.picks) setResolvedPicks(data.picks); })
        .catch(() => {});
    })();
  }, [activeTab, user]);

  // POST picks to tracking API when data is ready (once per session)
  useEffect(() => {
    if (picksSentRef.current) return;
    if (sharpPlays.length === 0 && valueBets.length === 0 && staleLines.length === 0) return;
    picksSentRef.current = true;

    const picks = [];
    const mapPick = (strategy, item) => ({
      strategy,
      gameId: item.game.id,
      homeTeam: item.game.home_team,
      awayTeam: item.game.away_team,
      sportKey: item.game.sport_key,
      commenceTime: item.game.commence_time || item.commence,
      marketType: item.marketType,
      outcome: item.outcome,
      point: item.point ?? null,
      odds: item.odds,
      book: item.book || "",
    });

    // Top 10 sharp plays
    sharpPlays.slice(0, 10).forEach(p => picks.push(mapPick("sharp", p)));
    // Top 10 value bets
    valueBets.slice(0, 10).forEach(p => picks.push(mapPick("value", p)));
    // All stale lines
    staleLines.forEach(s => picks.push({
      strategy: "stale",
      gameId: s.game.id,
      homeTeam: s.game.home_team,
      awayTeam: s.game.away_team,
      sportKey: s.game.sport_key,
      commenceTime: s.game.commence_time || s.commence,
      marketType: s.marketType,
      outcome: s.outcome,
      point: s.point ?? null,
      odds: s.staleOdds,
      book: s.staleBook,
    }));
    // All RLM plays
    rlmPlays.forEach(p => picks.push({
      strategy: "rlm",
      gameId: p.game.id,
      homeTeam: p.game.home_team,
      awayTeam: p.game.away_team,
      sportKey: p.game.sport_key,
      commenceTime: p.game.commence_time || p.commence,
      marketType: p.marketType,
      outcome: p.outcome,
      point: p.point ?? null,
      odds: p.bestOdds,
      book: p.bestBook,
    }));
    // Correlated parlays (track leg1 only for simplicity)
    correlatedParlays.slice(0, 15).forEach(c => picks.push({
      strategy: "correlated",
      gameId: c.game.id,
      homeTeam: c.game.home_team,
      awayTeam: c.game.away_team,
      sportKey: c.game.sport_key,
      commenceTime: c.game.commence_time || c.commence,
      marketType: "h2h",
      outcome: c.leg1.name,
      point: null,
      odds: c.leg1.price,
      book: c.leg1.book,
    }));
    // Narrative plays
    narrativePlays.forEach(p => picks.push({
      strategy: "narrative",
      gameId: p.game.id,
      homeTeam: p.game.home_team,
      awayTeam: p.game.away_team,
      sportKey: p.game.sport_key,
      commenceTime: p.game.commence_time || p.commence,
      marketType: "spreads",
      outcome: p.blowoutTeam,
      point: p.bestSpread,
      odds: p.bestOdds,
      book: p.bestBook,
    }));
    // Safe parlays — track each leg as its own pick under "safe_parlay" so
    // the resolver can score it with existing single-game logic. Leg-level
    // hit rate is what users see in the Record tab.
    parlays.forEach(parlay => {
      parlay.legs.forEach(leg => {
        picks.push({
          strategy: "safe_parlay",
          gameId: leg.game.id,
          homeTeam: leg.game.home_team,
          awayTeam: leg.game.away_team,
          sportKey: leg.game.sport_key,
          commenceTime: leg.game.commence_time || leg.commence,
          marketType: leg.marketType,
          outcome: leg.outcome,
          point: leg.point ?? null,
          odds: leg.odds,
          book: leg.book || "",
        });
      });
    });

    if (picks.length > 0) {
      fetch("/api/track-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picks }),
      }).catch(() => {});
    }
  }, [sharpPlays, valueBets, staleLines, rlmPlays, correlatedParlays, narrativePlays, parlays]);

  // Custom user-defined strategies — only run for the signed-in user. Each
  // strategy is evaluated against the live odds and matching picks are saved
  // under `custom_<id>` with the user's auth token so the server can scope
  // Redis stats keys by user.
  useEffect(() => {
    if (!user || games.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const customStrategies = await fetchUserStrategies();
        if (cancelled || !customStrategies.length) return;
        const picks = [];
        customStrategies.forEach(strat => {
          const matches = evaluateStrategy(strat, games, gameContextMap);
          matches.forEach(m => picks.push({
            strategy: `custom_${strat.id}`,
            gameId: m.game.id,
            homeTeam: m.game.home_team,
            awayTeam: m.game.away_team,
            sportKey: m.game.sport_key,
            commenceTime: m.game.commence_time || m.commence,
            marketType: m.marketType,
            outcome: m.outcome,
            point: m.point ?? null,
            odds: m.odds,
            book: m.book || "",
          }));
        });
        if (cancelled || !picks.length) return;
        const authHeader = await getAuthHeader();
        await fetch("/api/track-save", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ picks }),
        });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user, games, gameContextMap, sharpPlays, valueBets, staleLines, rlmPlays, correlatedParlays, narrativePlays]);

  // Fetch /api/game-context once per session (15-min client cache).
  // Used by custom-strategy evaluator so weather/rest/injury filters apply.
  useEffect(() => {
    const CTX_KEY = "oddsy_context_cache";
    const CTX_TTL = 15 * 60 * 1000;
    try {
      const cached = localStorage.getItem(CTX_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CTX_TTL && data && typeof data === "object") {
          setGameContextMap(data);
          return;
        }
      }
    } catch {}
    fetch("/api/game-context")
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        if (json?.games) {
          setGameContextMap(json.games);
          try { localStorage.setItem(CTX_KEY, JSON.stringify({ data: json.games, timestamp: Date.now() })); } catch {}
        }
      })
      .catch(() => {});
  }, []);

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
          <button
            onClick={() => setActiveTab("home")}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            <img src="/logo.jpeg" alt="MyOddsy — Sports Odds & Analytics" style={{ height: 80, display: "block", maxWidth: "75vw" }} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setShowAlertBuilder(true)}
              aria-label="Create alert"
              style={{
                background: "#f0f1f3", border: "1px solid #e2e5ea", borderRadius: 10,
                padding: "8px 10px", cursor: "pointer", fontSize: 18, lineHeight: 1,
              }}
            >🔔</button>
            <UserMenu />
          </div>
        </div>
      </header>
      <AuthModal />

      <SiteNav />


      {/* Sport Filter — only on tabs that filter by sport */}
      {["picks", "parlays", "games"].includes(activeTab) && <div style={{
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
      </div>}

      {/* Content */}
      <div style={{ padding: isMobile ? "0 20px 90px" : "0 20px 40px" }}>

        {/* Error state when API fails */}
        {dataSource === "error" && !(activeTab === "games" && gamesSub === "scores") && activeTab !== "home" && activeTab !== "record" && (
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
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              Fresh data loads automatically every few minutes.
            </div>
          </div>
        )}

        {/* ── HOME TAB ── */}
        {activeTab === "home" && (() => {
          // Build "today's top 3" by merging strategies and sorting by edge
          const sharpTop = sharpPlays.slice(0, 3).map(p => ({
            kind: "sharp", label: "Sharp", color: "#1a73e8",
            title: `${p.outcome}${p.point ? ` (${p.point > 0 ? "+" : ""}${p.point})` : ""}`,
            game: `${p.game.away_team} @ ${p.game.home_team}`,
            odds: p.odds, book: p.book, edge: parseFloat(p.ev || 0),
            rawGame: p.game, marketType: p.marketType, outcome: p.outcome, point: p.point,
          }));
          const valueTop = valueBets.slice(0, 3).map(p => ({
            kind: "value", label: "Value", color: "#0d9f4f",
            title: `${p.outcome}${p.point ? ` (${p.point > 0 ? "+" : ""}${p.point})` : ""}`,
            game: `${p.game.away_team} @ ${p.game.home_team}`,
            odds: p.odds, book: p.book, edge: parseFloat(p.ev || 0),
            rawGame: p.game, marketType: p.marketType, outcome: p.outcome, point: p.point,
          }));
          const staleTop = staleLines.slice(0, 2).map(p => ({
            kind: "stale", label: "Stale Line", color: "#dc2626",
            title: `${p.outcome}${p.point ? ` (${p.point > 0 ? "+" : ""}${p.point})` : ""}`,
            game: `${p.game.away_team} @ ${p.game.home_team}`,
            odds: p.staleOdds, book: p.staleBook, edge: parseFloat(p.diff || 0),
            rawGame: p.game, marketType: p.marketType, outcome: p.outcome, point: p.point,
          }));
          const merged = [...sharpTop, ...valueTop, ...staleTop].sort((a, b) => b.edge - a.edge).slice(0, 3);
          const totalPlays = sharpPlays.length + valueBets.length + staleLines.length + rlmPlays.length + narrativePlays.length;
          const totalParlays = parlays.length + correlatedParlays.length;
          const decidedCount = Object.values(strategyStats).reduce((sum, s) => sum + ((s?.wins || 0) + (s?.losses || 0)), 0);
          const totalSettled = Object.values(strategyStats).reduce((sum, s) => sum + (s?.total || 0), 0);
          const totalUnits = Object.values(strategyStats).reduce((sum, s) => sum + (typeof s?.units === "number" ? s.units : parseFloat(s?.units || 0)), 0);
          const overallRoi = totalSettled > 0 ? ((totalUnits / totalSettled) * 100) : null;

          return (
            <>
              {/* Hero */}
              <div style={{
                background: "linear-gradient(135deg, #1a1d23 0%, #2d3748 100%)",
                borderRadius: 18, padding: "24px 20px", marginBottom: 16, color: "#fff",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#68d391", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
                  Oddsy · Smarter Sports Betting
                </div>
                <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900, lineHeight: 1.2, marginBottom: 8 }}>
                  Find bets with a real statistical edge.
                </div>
                <div style={{ fontSize: 13, color: "#cbd5e0", lineHeight: 1.6, marginBottom: 16 }}>
                  We compare odds across 6 sportsbooks in real-time and surface only the picks with a positive expected value. Every pick we recommend gets tracked — you see our actual win rates, not just promises.
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={() => setActiveTab("picks")} style={{
                    padding: "10px 20px", borderRadius: 10, border: "none",
                    background: "#1a73e8", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    See Today's Picks →
                  </button>
                  <button onClick={() => setActiveTab("record")} style={{
                    padding: "10px 20px", borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "transparent", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    Track Record
                  </button>
                  <button onClick={openStrategyBuilder} style={{
                    padding: "10px 18px 10px 14px", borderRadius: 10,
                    border: "1px solid #68d391",
                    background: "rgba(104, 211, 145, 0.12)", color: "#68d391",
                    fontSize: 13, fontWeight: 800, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 8,
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    <span style={{
                      fontSize: 9, fontWeight: 900, letterSpacing: "0.08em",
                      background: "#68d391", color: "#0f4d2a",
                      padding: "2px 6px", borderRadius: 4,
                    }}>NEW</span>
                    Build Your Own Strategy →
                  </button>
                  <Link to="/homeruns" style={{
                    padding: "10px 18px 10px 14px", borderRadius: 10,
                    border: "1px solid #fbbf24",
                    background: "rgba(251, 191, 36, 0.12)", color: "#fbbf24",
                    fontSize: 13, fontWeight: 800, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 8, textDecoration: "none",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    <span style={{
                      fontSize: 9, fontWeight: 900, letterSpacing: "0.08em",
                      background: "#fbbf24", color: "#78350f",
                      padding: "2px 6px", borderRadius: 4,
                    }}>NEW</span>
                    💣 HR Hunter →
                  </Link>
                  <Link to="/shop" style={{
                    padding: "10px 18px", borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "transparent", color: "#fff", fontSize: 13, fontWeight: 700,
                    cursor: "pointer", textDecoration: "none",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    🏦 Book Shop
                  </Link>
                  <Link to="/arbitrage" style={{
                    padding: "10px 18px 10px 14px", borderRadius: 10,
                    border: "1px solid #34d399",
                    background: "rgba(52, 211, 153, 0.12)", color: "#34d399",
                    fontSize: 13, fontWeight: 800, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 8, textDecoration: "none",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    🔄 Arbitrage
                  </Link>
                  <Link to="/prediction-markets" style={{
                    padding: "10px 18px 10px 14px", borderRadius: 10,
                    border: "1px solid #7dd3fc",
                    background: "rgba(125, 211, 252, 0.14)", color: "#7dd3fc",
                    fontSize: 13, fontWeight: 800, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 8, textDecoration: "none",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    <span style={{
                      fontSize: 9, fontWeight: 900, letterSpacing: "0.08em",
                      background: "#7dd3fc", color: "#0c4a6e",
                      padding: "2px 6px", borderRadius: 4,
                    }}>NEW</span>
                    🔮 Prediction Markets →
                  </Link>
                </div>
              </div>

              {/* Live stats strip — each card is a shortcut to its tab */}
              <div style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr",
                gap: 10, marginBottom: 16,
              }}>
                {(() => {
                  const statCardStyle = {
                    background: "#fff", border: "1px solid #e2e5ea", borderRadius: 12,
                    padding: "12px 14px", textAlign: "left", fontFamily: "inherit",
                    cursor: "pointer", transition: "border-color 120ms, box-shadow 120ms",
                  };
                  const onHoverIn = (e) => {
                    e.currentTarget.style.borderColor = "#cbd5e0";
                    e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)";
                  };
                  const onHoverOut = (e) => {
                    e.currentTarget.style.borderColor = "#e2e5ea";
                    e.currentTarget.style.boxShadow = "none";
                  };
                  return (
                    <>
                      <button onClick={() => setActiveTab("picks")} onMouseEnter={onHoverIn} onMouseLeave={onHoverOut} style={statCardStyle} aria-label="Open Picks">
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.1em" }}>Live Picks</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#1a73e8", fontFamily: "'Space Mono', monospace" }}>{totalPlays}</div>
                        <div style={{ fontSize: 10, color: "#8b919a" }}>across 5 strategies</div>
                      </button>
                      <button onClick={() => setActiveTab("parlays")} onMouseEnter={onHoverIn} onMouseLeave={onHoverOut} style={statCardStyle} aria-label="Open Parlays">
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.1em" }}>Parlays</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#7c3aed", fontFamily: "'Space Mono', monospace" }}>{totalParlays}</div>
                        <div style={{ fontSize: 10, color: "#8b919a" }}>built for today</div>
                      </button>
                      <button onClick={() => setActiveTab("games")} onMouseEnter={onHoverIn} onMouseLeave={onHoverOut} style={statCardStyle} aria-label="Open Games">
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.1em" }}>Games On Board</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#1a1d23", fontFamily: "'Space Mono', monospace" }}>{games.length}</div>
                        <div style={{ fontSize: 10, color: "#8b919a" }}>priced across books</div>
                      </button>
                      <button onClick={() => setActiveTab("record")} onMouseEnter={onHoverIn} onMouseLeave={onHoverOut} style={statCardStyle} aria-label="Open Track Record">
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.1em" }}>Tracked ROI</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: overallRoi === null ? "#8b919a" : overallRoi >= 0 ? "#0d9f4f" : "#e8a100", fontFamily: "'Space Mono', monospace" }}>
                          {overallRoi === null ? "—" : `${overallRoi >= 0 ? "+" : ""}${overallRoi.toFixed(1)}%`}
                        </div>
                        <div style={{ fontSize: 10, color: "#8b919a" }}>{totalUnits >= 0 ? "+" : ""}{totalUnits.toFixed(1)}u · {decidedCount} settled</div>
                      </button>
                    </>
                  );
                })()}
              </div>

              {/* Strategy Builder — dedicated spotlight card */}
              <button onClick={openStrategyBuilder} style={{
                width: "100%", textAlign: "left", cursor: "pointer",
                background: "linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)",
                border: "none", borderRadius: 16, padding: isMobile ? "20px 18px" : "22px 24px",
                marginBottom: 22, color: "#fff", fontFamily: "inherit",
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16,
                boxShadow: "0 4px 20px rgba(124, 58, 237, 0.25)",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    fontSize: 10, fontWeight: 900, color: "#fbd38d",
                    letterSpacing: "0.12em", textTransform: "uppercase",
                    marginBottom: 8,
                  }}>
                    <span>⚙️</span>
                    <span>Exclusive to Oddsy</span>
                  </div>
                  <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, lineHeight: 1.2, marginBottom: 6 }}>
                    Build your own betting strategy.
                  </div>
                  <div style={{ fontSize: 13, color: "#e9d8fd", lineHeight: 1.5, marginBottom: 12 }}>
                    20+ filters — sports, markets, EV threshold, odds range, spread & total ranges, days of week, time of day, book disagreement, vig, weather (wind/temp/precip), rest days, team win %, FPI edge, injuries — plus daily email alerts. We track every strategy's performance live. {isMobile ? "" : "No other tool lets you do this."}
                  </div>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "#fff", color: "#4c1d95",
                    padding: "8px 14px", borderRadius: 8,
                    fontSize: 13, fontWeight: 800,
                  }}>
                    Start Building →
                  </div>
                </div>
                {!isMobile && (
                  <div style={{
                    flexShrink: 0, fontSize: 64, opacity: 0.3, lineHeight: 1,
                  }}>⚙️</div>
                )}
              </button>

              {/* Today's top picks */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#1a1d23" }}>Today's Top Picks</h2>
                  <button onClick={() => setActiveTab("picks")} style={{
                    background: "none", border: "none", color: "#1a73e8", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                  }}>See all →</button>
                </div>
                {merged.length === 0 ? (
                  <div style={{ background: "#fff", border: "1px solid #e2e5ea", borderRadius: 12, padding: "24px 16px", textAlign: "center", color: "#8b919a", fontSize: 13 }}>
                    Loading today's picks…
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {merged.map((m, i) => (
                      <button key={i} onClick={() => setActiveTab("picks")} style={{
                        background: "#fff", border: "1px solid #e2e5ea", borderLeft: `3px solid ${m.color}`,
                        borderRadius: 12, padding: "12px 14px", cursor: "pointer", textAlign: "left",
                        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                      }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <span style={{
                              fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em",
                              color: m.color, background: `${m.color}12`, padding: "2px 6px", borderRadius: 4,
                            }}>{m.label}</span>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1d23", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m.title}
                          </div>
                          <div style={{ fontSize: 11, color: "#8b919a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m.game}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: m.odds > 0 ? "#0d9f4f" : "#1a1d23", fontFamily: "'Space Mono', monospace" }}>
                            {formatOdds(m.odds)}
                          </div>
                          <div style={{ fontSize: 10, color: "#8b919a", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                            <BookLink book={m.book} />
                            <AllBooksTooltip game={m.rawGame} marketType={m.marketType} outcome={m.outcome} point={m.point} bestBook={m.book} />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Explore cards */}
              <h2 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 800, color: "#1a1d23" }}>How Oddsy Works</h2>
              <div style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                gap: 10, marginBottom: 22,
              }}>
                {[
                  { id: "picks", icon: "💰", title: "Picks", color: "#1a73e8",
                    desc: "Every bet with a statistical edge, ranked and tagged. Filter by strategy — Sharp money, raw Value, Stale lines, Reverse Line Movement, or Narrative fades." },
                  { id: "parlays", icon: "🎰", title: "Parlays", color: "#7c3aed",
                    desc: "Auto-built 3-leg parlays from our +EV pool, plus Same-Game correlated combos with real math behind them." },
                  { id: "games", icon: "📊", title: "Games", color: "#0d9f4f",
                    desc: "Live odds across 6 sportsbooks side-by-side, plus live scores so you know which games are still live." },
                  { id: "record", icon: "📈", title: "Track Record", color: "#d97706",
                    desc: "Every pick we've recommended gets settled against real results. See our actual win rates by strategy — no hiding." },
                ].map(card => (
                  <button key={card.id} onClick={() => setActiveTab(card.id)} style={{
                    background: "#fff", border: "1px solid #e2e5ea", borderRadius: 14,
                    padding: "16px 18px", textAlign: "left", cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                    borderTop: `3px solid ${card.color}`,
                  }}>
                    <div style={{ fontSize: 22, marginBottom: 6 }}>{card.icon}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#1a1d23", marginBottom: 4 }}>{card.title}</div>
                    <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>{card.desc}</div>
                  </button>
                ))}
              </div>

              {/* Strategy guides */}
              <h2 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 800, color: "#1a1d23" }}>Learn the Strategies</h2>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8, marginBottom: 20 }}>
                {[
                  { to: "/ev-betting", title: "EV Betting", desc: "The math behind every pick", icon: "📐" },
                  { to: "/sharp-betting", title: "Sharp Betting", desc: "How pros move lines", icon: "🧠" },
                  { to: "/stale-line-detector", title: "Stale Lines", desc: "When books lag the market", icon: "⏱️" },
                  { to: "/reverse-line-movement", title: "Reverse Line Movement", desc: "Follow the smart money", icon: "🔄" },
                ].map(g => (
                  <Link key={g.to} to={g.to} style={{
                    background: "#fff", border: "1px solid #e2e5ea", borderRadius: 12,
                    padding: "12px 14px", display: "flex", alignItems: "center", gap: 12,
                    textDecoration: "none",
                  }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{g.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1d23" }}>{g.title}</div>
                      <div style={{ fontSize: 11, color: "#6b7280" }}>{g.desc}</div>
                    </div>
                    <span style={{ marginLeft: "auto", color: "#c4c9d0", flexShrink: 0 }}>›</span>
                  </Link>
                ))}
              </div>

              {/* Affiliate CTA */}
              <div style={{
                background: "#fff", border: "1px solid #e2e5ea", borderRadius: 14,
                padding: 18, textAlign: "center", marginBottom: 8,
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#1a1d23", marginBottom: 4 }}>Ready to place a bet?</div>
                <div style={{ fontSize: 11, color: "#8b919a", marginBottom: 12 }}>New users on DraftKings get up to $1,000 in bonus bets</div>
                <a href="https://www.draftkings.com/sportsbook" target="_blank" rel="noopener noreferrer" style={{
                  display: "inline-block", padding: "10px 28px", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg, #1a1d23, #2d3748)", color: "#fff",
                  fontSize: 13, fontWeight: 800, textDecoration: "none",
                }}>Claim Bonus →</a>
                <div style={{ fontSize: 9, color: "#aab0b8", marginTop: 6 }}>21+ | Gambling problem? Call 1-800-522-4700</div>
              </div>
            </>
          );
        })()}

        {/* ── PICKS TAB (unified) ── */}
        {activeTab === "picks" && (() => {
          const normalized = [];
          sharpPlays.forEach(p => normalized.push({
            kind: "sharp", label: "Sharp", color: "#1a73e8",
            reason: `${p.totalScore}/100 · ${p.confidenceLabel}`,
            title: `${p.outcome}${p.point ? ` (${p.point > 0 ? "+" : ""}${p.point})` : ""}`,
            marketLabel: p.marketType === "h2h" ? "Moneyline" : p.marketType === "spreads" ? "Spread" : "Total",
            game: p.game, commence: p.commence,
            odds: p.odds, book: p.book,
            marketType: p.marketType, outcome: p.outcome, point: p.point,
            sortKey: p.totalScore || parseFloat(p.ev || 0),
            edgeLabel: `+${p.ev}% EV`,
          }));
          valueBets.forEach(p => normalized.push({
            kind: "value", label: "Value", color: "#0d9f4f",
            reason: "Market-beating price vs consensus",
            title: `${p.outcome}${p.point ? ` (${p.point > 0 ? "+" : ""}${p.point})` : ""}`,
            marketLabel: p.marketType === "h2h" ? "Moneyline" : p.marketType === "spreads" ? "Spread" : "Total",
            game: p.game, commence: p.game.commence_time,
            odds: p.odds, book: p.book,
            marketType: p.marketType, outcome: p.outcome, point: p.point,
            sortKey: parseFloat(p.ev || 0),
            edgeLabel: `+${p.ev}% EV`,
          }));
          staleLines.forEach(p => normalized.push({
            kind: "stale", label: "Stale Line", color: "#dc2626",
            reason: `${p.booksAgreed}/${p.totalBooks} books agree on consensus · ${p.diff} pts off`,
            title: `${p.outcome}${p.point ? ` (${p.point > 0 ? "+" : ""}${p.point})` : ""}`,
            marketLabel: p.marketType === "h2h" ? "Moneyline" : p.marketType === "spreads" ? "Spread" : "Total",
            game: p.game, commence: p.commence,
            odds: p.staleOdds, book: p.staleBook,
            marketType: p.marketType, outcome: p.outcome, point: p.point,
            sortKey: parseFloat(p.diff || 0) * 10,
            edgeLabel: `${p.diff} pts off market`,
          }));
          rlmPlays.forEach(p => normalized.push({
            kind: "rlm", label: "Reverse Line", color: "#7c3aed",
            reason: `Sharp books moved; ${p.bestBook} still offers public price`,
            title: `${p.outcome}${p.point ? ` (${p.point > 0 ? "+" : ""}${p.point})` : ""}`,
            marketLabel: p.marketType === "h2h" ? "Moneyline" : "Spread",
            game: p.game, commence: p.commence,
            odds: p.bestOdds, book: p.bestBook,
            marketType: p.marketType, outcome: p.outcome, point: p.point,
            sortKey: parseFloat(p.lineRange || 0) * 5,
            edgeLabel: `${p.lineRange} pts spread`,
          }));
          narrativePlays.forEach(p => normalized.push({
            kind: "narrative", label: "Narrative Fade", color: "#d97706",
            reason: `Blowout overreaction: lost to ${p.blowoutInfo.opponent} by ${p.blowoutInfo.margin}`,
            title: `${p.blowoutTeam} +${p.bestSpread}`,
            marketLabel: "Spread",
            game: p.game, commence: p.commence,
            odds: p.bestOdds, book: p.bestBook,
            marketType: "spreads", outcome: p.blowoutTeam, point: p.bestSpread,
            sortKey: Math.abs(p.blowoutInfo.margin || 0),
            edgeLabel: `+${p.bestSpread} spread`,
          }));

          // Dedupe across detectors. The same game+outcome often trips Sharp
          // *and* Stale *and* RLM — keep only the highest-scoring pick per
          // (gameId, marketType, outcome, point). Sort first so reduce sees
          // the winner first.
          const deduped = [];
          const seenKeys = new Set();
          normalized
            .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0))
            .forEach(p => {
              const gid = p.game?.id || `${p.game?.sport_key}:${p.game?.away_team}@${p.game?.home_team}`;
              const key = `${gid}|${p.marketLabel}|${p.title}`;
              if (seenKeys.has(key)) return;
              seenKeys.add(key);
              deduped.push(p);
            });

          // Sport-scoped, post-dedupe base. Chip counts and the filtered
          // list must both derive from this so clicking a chip never yields
          // "0 picks" when the count says otherwise — the dedupe step can
          // drop a Sharp entry if the same bet also trips RLM/Stale with a
          // higher sortKey, so raw sharpPlays.length overcounts.
          const sportScoped = deduped.filter(p =>
            activeSport === "all" || p.game?.sport_key === activeSport
          );
          const filtered = sportScoped.filter(p =>
            pickFilter === "all" || pickFilter === p.kind
          );
          const countBy = (kind) => sportScoped.filter(p => p.kind === kind).length;

          const chips = [
            { id: "all", label: "All Picks", count: sportScoped.length, color: "#1a1d23" },
            { id: "sharp", label: "🧠 Sharp", count: countBy("sharp"), color: "#1a73e8" },
            { id: "value", label: "⚡ Value", count: countBy("value"), color: "#0d9f4f" },
            { id: "stale", label: "⏱️ Stale", count: countBy("stale"), color: "#dc2626" },
            { id: "rlm", label: "🔄 RLM", count: countBy("rlm"), color: "#7c3aed" },
            { id: "narrative", label: "📉 Narrative", count: countBy("narrative"), color: "#d97706" },
          ];

          const chipInfo = {
            all: {
              title: "All Picks",
              body: "Every edge we found across all strategies, deduplicated so the same bet from two strategies only shows once. Ranked by edge size.",
            },
            sharp: {
              title: "🧠 Sharp Plays",
              body: "Bets where our fair-value model disagrees with the book by enough that, after removing the vig, the book's implied probability is meaningfully lower than the true hit rate. We compute fair odds by taking the median implied probability across every sportsbook (with two-way vig removed), then flag bets where a single book's price pays at least 4% more than that consensus fair line.",
            },
            value: {
              title: "⚡ Value Bets",
              body: "Bets with positive expected value ≥3% based on our consensus fair line. EV = (fair probability × payout) − (1 − fair probability). We take the best price available across all books and compare it to the consensus fair probability after removing vig.",
            },
            stale: {
              title: "⏱️ Stale Lines",
              body: "Lines at one book that haven't moved to match where the rest of the market has settled. We flag a book's price when it differs from the consensus by 4+ cents of implied probability, meaning that specific book is slow to update and you're getting a price the market has already moved past.",
            },
            rlm: {
              title: "🔄 Reverse Line Movement",
              body: "Lines moving opposite of where the public money is going. When 70%+ of bets are on one side but the line moves toward the other side, it means sharp money (larger, smarter bets) is on the unpopular side — books move lines for dollars, not ticket count.",
            },
            narrative: {
              title: "📉 Narrative Regression",
              body: "Teams on extreme hot or cold streaks that the market has over-corrected on. We track recent-game results and flag when the line has moved more than the underlying team quality (FPI/BPI) justifies — the market is pricing the narrative, not the team.",
            },
          };

          const bannerStats = pickFilter === "all" ? null : strategyStats[pickFilter];
          const bannerLabel = {
            sharp: "Sharp Plays", value: "Value Bets", stale: "Stale Lines",
            rlm: "RLM Plays", narrative: "Narrative Plays",
          }[pickFilter];

          return (
            <>
              <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 900, color: "#1a1d23" }}>
                    Today's Picks
                  </h2>
                  <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                    Every bet with a statistical edge, ranked by strength. Tap a chip to filter by strategy.
                  </div>
                </div>
                <button onClick={openStrategyBuilder} style={{
                  flexShrink: 0, padding: "8px 12px", borderRadius: 8,
                  border: "1px solid #1a73e8", background: "#fff", color: "#1a73e8",
                  fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                  fontFamily: "'DM Sans', sans-serif",
                }}>
                  + Build Strategy
                </button>
              </div>

              {/* Strategy chips */}
              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 10, marginBottom: 10 }}>
                {chips.map(c => {
                  const isActive = pickFilter === c.id;
                  const infoActive = pickInfoOpen === c.id;
                  return (
                    <div key={c.id} style={{
                      display: "inline-flex", alignItems: "stretch", flexShrink: 0,
                      borderRadius: 20, overflow: "hidden",
                      border: `1px solid ${isActive ? c.color : "#e2e5ea"}`,
                      background: isActive ? c.color : "#fff",
                    }}>
                      <button onClick={() => setPickFilter(c.id)} style={{
                        padding: "8px 10px 8px 14px", border: "none", background: "transparent",
                        color: isActive ? "#fff" : "#4a5568",
                        fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                        fontFamily: "'DM Sans', sans-serif",
                      }}>
                        {c.label} <span style={{ opacity: 0.7, fontWeight: 600 }}>({c.count})</span>
                      </button>
                      <button
                        onClick={() => setPickInfoOpen(infoActive ? null : c.id)}
                        title={`How ${c.label} works`}
                        aria-label={`How ${c.label} works`}
                        style={{
                          padding: "0 10px 0 4px", border: "none", background: "transparent",
                          color: isActive ? "rgba(255,255,255,0.85)" : "#8b919a",
                          fontSize: 11, fontWeight: 900, cursor: "pointer",
                          fontFamily: "'DM Sans', sans-serif",
                          textDecoration: infoActive ? "underline" : "none",
                        }}
                      >ⓘ</button>
                    </div>
                  );
                })}

                {/* Sibling tools — same "find a +EV bet" workflow, but they
                    live on their own pages because the UI is different enough
                    to not belong in the main picks list. Rendered as outlined
                    chips with an arrow so it's clear they navigate away. */}
                <div style={{ width: 1, background: "#e2e5ea", margin: "4px 4px", flexShrink: 0 }} />
                {[
                  { path: "/arbitrage", label: "🔄 Arbitrage", color: "#059669" },
                  { path: "/spread-scanner", label: "📊 Gaps", color: "#7c3aed" },
                  { path: "/strategy-builder", label: "🛠️ Custom", color: "#1a73e8" },
                ].map(link => (
                  <Link key={link.path} to={link.path} style={{
                    display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
                    padding: "8px 12px", borderRadius: 20,
                    border: `1px dashed ${link.color}`, background: "#fff",
                    color: link.color, fontSize: 12, fontWeight: 700,
                    textDecoration: "none", whiteSpace: "nowrap",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    {link.label} <span style={{ fontSize: 11, opacity: 0.7 }}>→</span>
                  </Link>
                ))}
              </div>

              {pickInfoOpen && chipInfo[pickInfoOpen] && (
                <div style={{
                  background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10,
                  padding: "12px 14px", marginBottom: 12, position: "relative",
                }}>
                  <button onClick={() => setPickInfoOpen(null)} style={{
                    position: "absolute", top: 8, right: 10, border: "none", background: "transparent",
                    fontSize: 16, color: "#94a3b8", cursor: "pointer", lineHeight: 1,
                  }} title="Close">×</button>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1a1d23", marginBottom: 4 }}>
                    {chipInfo[pickInfoOpen].title}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6, paddingRight: 16 }}>
                    {chipInfo[pickInfoOpen].body}
                  </div>
                </div>
              )}

              {bannerStats && <PerformanceBanner stats={bannerStats} label={bannerLabel} />}

              {/* Feed */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filtered.length === 0 && (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "#8b919a" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                    <div style={{ fontSize: 13 }}>No picks match your filter. Try "All Picks" or a different sport.</div>
                  </div>
                )}
                {filtered.map((p, i) => {
                  const sportIcon = SPORTS.find(s => s.id === p.game?.sport_key)?.icon || "";
                  return (
                    <div key={`${p.kind}-${i}`} style={{
                      background: "#fff", border: "1px solid #e2e5ea", borderLeft: `3px solid ${p.color}`,
                      borderRadius: 12, padding: "12px 14px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                      animation: `fadeSlideIn 0.35s ease ${Math.min(i, 10) * 0.03}s both`,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
                            <span style={{
                              fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em",
                              color: p.color, background: `${p.color}14`, padding: "2px 7px", borderRadius: 4,
                            }}>{p.label}</span>
                            <span style={{ fontSize: 10, color: "#8b919a", fontWeight: 600 }}>{p.marketLabel}</span>
                          </div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: "#1a1d23", lineHeight: 1.3 }}>
                            {p.title}
                          </div>
                          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>
                            {sportIcon} {p.game?.away_team} @ {p.game?.home_team}
                            {p.commence ? ` · ${formatTime(p.commence)}` : ""}
                          </div>
                          <div style={{ fontSize: 11, color: "#4a5568", marginTop: 6, lineHeight: 1.4 }}>
                            {p.reason}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{
                            fontSize: 18, fontWeight: 800,
                            color: p.odds > 0 ? "#0d9f4f" : "#1a1d23",
                            fontFamily: "'Space Mono', monospace",
                          }}>
                            {formatOdds(p.odds)}
                          </div>
                          <div style={{ fontSize: 10, color: "#8b919a", marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                            <BookLink book={p.book} />
                            <AllBooksTooltip game={p.game} marketType={p.marketType} outcome={p.outcome} point={p.point} bestBook={p.book} />
                          </div>
                          <div style={{
                            fontSize: 10, fontWeight: 700, color: p.color,
                            background: `${p.color}12`, padding: "2px 6px", borderRadius: 4, display: "inline-block",
                          }}>{p.edgeLabel}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                        <a href={BOOK_URLS[p.book] || "#"} target="_blank" rel="noopener noreferrer" style={{
                          padding: "6px 14px", borderRadius: 8, background: p.color, color: "#fff",
                          fontSize: 11, fontWeight: 800, textDecoration: "none",
                        }}>Bet on {p.book} →</a>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Affiliate CTA */}
              <div style={{
                marginTop: 20, background: "#fff", border: "1px solid #e2e5ea",
                borderRadius: 14, padding: 18, textAlign: "center",
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#1a1d23", marginBottom: 4 }}>Place these on DraftKings</div>
                <div style={{ fontSize: 11, color: "#8b919a", marginBottom: 12 }}>New users get up to $1,000 in bonus bets</div>
                <a href="https://www.draftkings.com/sportsbook" target="_blank" rel="noopener noreferrer" style={{
                  display: "inline-block", padding: "10px 28px", borderRadius: 10,
                  background: "#1a73e8", color: "#fff", fontSize: 13, fontWeight: 800, textDecoration: "none",
                }}>Claim Bonus →</a>
                <div style={{ fontSize: 9, color: "#aab0b8", marginTop: 6 }}>21+ | Gambling problem? Call 1-800-522-4700</div>
              </div>
            </>
          );
        })()}

        {/* ── GAMES TAB (odds + live scores) ── */}
        {activeTab === "games" && (
          <div style={{
            display: "flex", gap: 4, background: "#f0f1f3", borderRadius: 10,
            padding: 4, marginBottom: 14, maxWidth: 340,
          }}>
            {[
              { id: "odds", label: "📊 Odds" },
              { id: "scores", label: "🏆 Live Scores" },
            ].map(s => (
              <button key={s.id} onClick={() => setGamesSub(s.id)} style={{
                flex: 1, padding: "8px 12px", borderRadius: 8, border: "none",
                background: gamesSub === s.id ? "#fff" : "transparent",
                color: gamesSub === s.id ? "#1a73e8" : "#6b7280",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
                boxShadow: gamesSub === s.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}>{s.label}</button>
            ))}
          </div>
        )}

        {/* ── LIVE SCORES ── */}
        {activeTab === "games" && gamesSub === "scores" && (
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



        {/* ── PARLAYS TAB (sub-toggle for Safe / Same-Game / Analyze + HR link) ── */}
        {activeTab === "parlays" && (
          <div style={{
            display: "flex", gap: 4, background: "#f0f1f3", borderRadius: 10,
            padding: 4, marginBottom: 14, maxWidth: 520, flexWrap: "wrap",
          }}>
            {[
              { id: "safe", label: "🎰 Safe" },
              { id: "correlated", label: "🔗 Same-Game" },
              { id: "analyze", label: "🔬 Analyze" },
            ].map(s => (
              <button key={s.id} onClick={() => setParlaySub(s.id)} style={{
                flex: 1, minWidth: 90, padding: "8px 12px", borderRadius: 8, border: "none",
                background: parlaySub === s.id ? "#fff" : "transparent",
                color: parlaySub === s.id ? "#7c3aed" : "#6b7280",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
                boxShadow: parlaySub === s.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}>{s.label}</button>
            ))}
            {/* HR parlays live on their own page because they need player/prop
                data the game-market parlay builder doesn't load. Styled the
                same as the other toggles so it reads as part of the group. */}
            <Link to="/parlays/hr" style={{
              flex: 1, minWidth: 90, padding: "8px 12px", borderRadius: 8, border: "none",
              background: "transparent", color: "#6b7280",
              fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "center",
              fontFamily: "'DM Sans', sans-serif", textDecoration: "none",
            }}>💣 HR</Link>
          </div>
        )}

        {/* ── SAFE PARLAYS ── */}
        {activeTab === "parlays" && parlaySub === "safe" && (
          <>
            <PerformanceBanner stats={strategyStats.safe_parlay} label="Safe Parlays (leg hit rate)" />
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

            {/* Book filter */}
            {(() => {
              const allBooks = [...new Set(parlays.map(p => p.book).filter(Boolean))].sort();
              if (allBooks.length === 0) return null;
              const enabled = parlayEnabledBooks;
              const isActive = (book) => enabled ? enabled.has(book) : true;
              const toggle = (book) => setParlayEnabledBooks(prev => {
                const base = prev ? new Set(prev) : new Set(allBooks);
                if (base.has(book)) base.delete(book); else base.add(book);
                return base;
              });
              return (
                <div style={{
                  background: "#fff", border: "1px solid #e2e5ea", borderRadius: 12,
                  padding: "10px 14px", marginBottom: 14,
                }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    marginBottom: 8, flexWrap: "wrap", gap: 6,
                  }}>
                    <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>
                      Sportsbooks
                      <span style={{ fontWeight: 500, color: "#9ca3af", marginLeft: 6 }}>
                        ({enabled ? enabled.size : allBooks.length} of {allBooks.length})
                      </span>
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setParlayEnabledBooks(null)} style={parlayFilterBtn}>All</button>
                      <button onClick={() => setParlayEnabledBooks(new Set())} style={parlayFilterBtn}>Clear</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {allBooks.map(book => {
                      const active = isActive(book);
                      return (
                        <button key={book} onClick={() => toggle(book)} style={{
                          padding: "5px 11px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                          border: active ? "1px solid #7c3aed" : "1px solid #d5d8de",
                          background: active ? "#f3edff" : "#fff",
                          color: active ? "#5b21b6" : "#6b7280",
                          fontWeight: active ? 700 : 500, fontFamily: "'DM Sans', sans-serif",
                        }}>{book}</button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {parlays
                .filter(p => !parlayEnabledBooks || parlayEnabledBooks.has(p.book))
                .map((parlay, pi) => (
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
                            <div style={{ fontSize: 10, color: "#8b919a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 2 }}>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                                {leg.game.away_team} @ {leg.game.home_team} · Best odds: <BookLink book={leg.book} style={{ color: "#1a73e8", fontWeight: 600 }} />
                              </span>
                              <AllBooksTooltip game={leg.game} marketType={leg.marketType} outcome={leg.outcome} point={leg.point} bestBook={leg.book} />
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

            {/* Related guides */}
            <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link to="/parlay-calculator" style={{ fontSize: 11, color: "#1a73e8", fontWeight: 600, textDecoration: "none" }}>Parlay Strategy Guide →</Link>
              <Link to="/correlated-parlays" style={{ fontSize: 11, color: "#1a73e8", fontWeight: 600, textDecoration: "none" }}>Correlated Parlays →</Link>
              <Link to="/narrative-regression" style={{ fontSize: 11, color: "#1a73e8", fontWeight: 600, textDecoration: "none" }}>Narrative Regression →</Link>
            </div>
          </>
        )}

        {/* ── LIVE ODDS ── */}
        {activeTab === "games" && gamesSub === "odds" && (
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



        {/* ── CORRELATED PARLAYS (under Parlays tab) ── */}
        {activeTab === "parlays" && parlaySub === "correlated" && (
          <>
            <PerformanceBanner stats={strategyStats.correlated} label="Correlated Parlays" />
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#1a1d23", marginBottom: 4 }}>Correlated Parlays</div>
              <div style={{ fontSize: 12, color: "#8b919a", lineHeight: 1.6 }}>Same-game parlay legs that are logically correlated — when one hits, the other is more likely to hit too. Sportsbooks underprice these correlations.</div>
            </div>

            {correlatedParlays.filter(c => activeSport === "all" || c.game.sport_key === activeSport).length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#8b919a" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔗</div>
                <div style={{ fontSize: 13 }}>No correlated parlays found. Check back when more games are available.</div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {correlatedParlays.filter(c => activeSport === "all" || c.game.sport_key === activeSport).map((combo, i) => {
                const sportIcon = SPORTS.find(s => s.id === combo.game.sport_key)?.icon || "";
                return (
                  <div key={`corr-${i}`} style={{
                    background: "#fff", border: "1px solid #c6f6d5", borderLeft: "3px solid #0d9f4f",
                    borderRadius: 12, overflow: "hidden",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                    animation: `fadeSlideIn 0.4s ease ${i * 0.05}s both`,
                  }}>
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f1f3", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>
                          {sportIcon} {combo.game.away_team} @ {combo.game.home_team} · {formatTime(combo.commence)}
                        </div>
                      </div>
                      <div style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                        background: combo.strength === "strong" ? "#ecfdf5" : "#fffff0",
                        color: combo.strength === "strong" ? "#0d9f4f" : "#d69e2e",
                        textTransform: "uppercase",
                      }}>{combo.strength}</div>
                    </div>
                    <div style={{ padding: "12px 16px" }}>
                      {/* Two legs */}
                      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                        <div style={{ flex: 1, background: "#f8faf8", borderRadius: 8, padding: "10px 12px" }}>
                          <div style={{ fontSize: 10, color: "#8b919a", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Leg 1</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1d23" }}>{combo.leg1.label}</div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: combo.leg1.price > 0 ? "#0d9f4f" : "#1a1d23", fontFamily: "'Space Mono', monospace", marginTop: 4 }}>
                            {formatOdds(combo.leg1.price)} <span style={{ fontSize: 10, fontWeight: 500, color: "#8b919a" }}>(<BookLink book={combo.leg1.book} />)</span>
                          </div>
                        </div>
                        <div style={{ flex: 1, background: "#f8faf8", borderRadius: 8, padding: "10px 12px" }}>
                          <div style={{ fontSize: 10, color: "#8b919a", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Leg 2</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1d23" }}>{combo.leg2.label}</div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: combo.leg2.price > 0 ? "#0d9f4f" : "#1a1d23", fontFamily: "'Space Mono', monospace", marginTop: 4 }}>
                            {formatOdds(combo.leg2.price)} <span style={{ fontSize: 10, fontWeight: 500, color: "#8b919a" }}>(<BookLink book={combo.leg2.book} />)</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "#4a5568", lineHeight: 1.5, fontStyle: "italic" }}>{combo.reason}</div>
                    </div>
                    <div style={{ padding: "10px 16px", borderTop: "1px solid #e2e5ea", background: "#f8f9fa", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#8b919a", fontWeight: 700, textTransform: "uppercase" }}>Combined Odds</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#0d9f4f", fontFamily: "'Space Mono', monospace" }}>
                          {formatOdds(combo.combinedOdds)}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {["DraftKings", "FanDuel"].map(book => (
                          <a key={book} href={BOOK_URLS[book]} target="_blank" rel="noopener noreferrer" style={{
                            padding: "6px 12px", borderRadius: 8, background: "#0d9f4f", color: "#fff",
                            fontSize: 11, fontWeight: 700, textDecoration: "none",
                          }}>Build on {book} →</a>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 16 }}>
              <Link to="/correlated-parlays" style={{ fontSize: 11, color: "#1a73e8", fontWeight: 600, textDecoration: "none" }}>Learn how correlated parlays work →</Link>
            </div>
          </>
        )}

        {/* ── PARLAY ANALYZER ── */}
        {activeTab === "parlays" && parlaySub === "analyze" && (() => {
          const upcoming = games.filter(g => {
            const status = getGameStatus(g, liveScores);
            return status !== "final" && status !== "blowout" && status !== "in_progress" && status !== "live_unknown";
          });
          const sportOptions = [...new Set(upcoming.map(g => g.sport_key))];
          const bookOptions = [...new Set(
            upcoming.flatMap(g => (g.bookmakers || []).map(b => b.title))
          )].sort();
          const analysis = analyzeParlay(analyzerLegs);
          // Compute the combined odds at every book that offers all legs,
          // so we can recommend a better book if one exists.
          const bookCompare = (() => {
            if (analyzerLegs.length < 2) return null;
            const legBookPrices = analyzerLegs.map(leg => {
              const game = games.find(g => g.id === leg.gameId);
              if (!game) return null;
              const { perOutcomeOffers } = collectMarketFairProbs(game, leg.marketType);
              const pointStr = leg.point === null || leg.point === undefined ? "" : `${leg.point}`;
              const offers = perOutcomeOffers[`${leg.outcome}_${pointStr}`] || perOutcomeOffers[`${leg.outcome}_`] || [];
              const byBook = {};
              offers.forEach(o => { byBook[o.book] = o.price; });
              return byBook;
            });
            if (legBookPrices.some(m => !m)) return null;
            const commonBooks = legBookPrices.reduce((acc, m) => {
              const set = new Set(Object.keys(m));
              return acc === null ? set : new Set([...acc].filter(b => set.has(b)));
            }, null);
            if (!commonBooks || commonBooks.size === 0) return null;
            const rows = [];
            commonBooks.forEach(book => {
              let dec = 1;
              for (const m of legBookPrices) {
                const p = m[book];
                dec *= p > 0 ? p / 100 + 1 : 100 / Math.abs(p) + 1;
              }
              const amer = dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
              rows.push({ book, decimal: dec, american: amer });
            });
            rows.sort((a, b) => b.decimal - a.decimal);
            return rows;
          })();
          const addLeg = (game, marketType, outcomeName, point) => {
            const preferred = analyzerBook === "any" ? null : analyzerBook;
            const info = analyzeLeg(game, marketType, outcomeName, point, preferred);
            if (!info) return;
            const legId = `${game.id}|${marketType}|${outcomeName}|${info.point ?? ""}`;
            if (analyzerLegs.some(l => l.id === legId)) return;
            setAnalyzerLegs([...analyzerLegs, {
              id: legId,
              gameId: game.id,
              game,
              homeTeam: game.home_team,
              awayTeam: game.away_team,
              sportKey: game.sport_key,
              commence: game.commence_time,
              marketType,
              outcome: outcomeName,
              point: info.point,
              odds: info.bestOdds,
              book: info.bestBook,
              fairProb: info.fairProb,
              bookCount: info.bookCount,
            }]);
          };
          const removeLeg = (id) => setAnalyzerLegs(analyzerLegs.filter(l => l.id !== id));
          return (
            <>
              <div style={{ background: "#ecfeff", border: "1px solid #a5f3fc", borderRadius: 14, padding: "16px 18px", marginBottom: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#155e75", marginBottom: 6 }}>🔬 Parlay Analyzer</div>
                <div style={{ fontSize: 13, color: "#0e7490", lineHeight: 1.7 }}>
                  Build a parlay leg by leg. We compare it against the vig-free market consensus and tell you whether the book is paying fair, better than fair, or ripping you off. Works best with 2–6 legs.
                </div>
              </div>

              {/* Leg picker */}
              <div style={{ background: "#fff", border: "1px solid #e2e5ea", borderRadius: 14, padding: 16, marginBottom: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#1a1d23", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>Add a leg</div>
                <div style={{ position: "relative", marginBottom: 10 }}>
                  <input
                    type="text"
                    value={analyzerSearch}
                    onChange={e => setAnalyzerSearch(e.target.value)}
                    placeholder="Search team or matchup…"
                    style={{
                      width: "100%", boxSizing: "border-box",
                      padding: "9px 32px 9px 12px", borderRadius: 8,
                      border: "1px solid #e2e5ea", fontSize: 13,
                      fontFamily: "'DM Sans', sans-serif", color: "#1a1d23",
                      background: "#fafbfc", outline: "none",
                    }}
                  />
                  {analyzerSearch && (
                    <button onClick={() => setAnalyzerSearch("")} style={{
                      position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                      border: "none", background: "transparent", cursor: "pointer",
                      fontSize: 14, color: "#8b919a", padding: "2px 6px",
                    }}>✕</button>
                  )}
                </div>
                {sportOptions.length > 1 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    {["all", ...sportOptions].map(sk => {
                      const meta = SPORTS.find(s => s.id === sk);
                      const label = sk === "all" ? "All" : (meta ? `${meta.icon} ${meta.name}` : sk);
                      const active = analyzerSport === sk;
                      return (
                        <button key={sk} onClick={() => setAnalyzerSport(sk)} style={{
                          padding: "5px 10px", borderRadius: 999,
                          border: active ? "1px solid #1a1d23" : "1px solid #e2e5ea",
                          background: active ? "#1a1d23" : "#fff",
                          color: active ? "#fff" : "#1a1d23",
                          fontSize: 11, fontWeight: 700, cursor: "pointer",
                          fontFamily: "'DM Sans', sans-serif",
                        }}>{label}</button>
                      );
                    })}
                  </div>
                )}
                {bookOptions.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 6 }}>
                      Pricing book {analyzerBook === "any" && <span style={{ color: "#8b919a", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>(best across books — pick one to match your actual sportsbook)</span>}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {["any", ...bookOptions].map(bk => {
                        const active = analyzerBook === bk;
                        return (
                          <button key={bk} onClick={() => setAnalyzerBook(bk)} style={{
                            padding: "5px 10px", borderRadius: 999,
                            border: active ? "1px solid #7c3aed" : "1px solid #e2e5ea",
                            background: active ? "#7c3aed" : "#fff",
                            color: active ? "#fff" : "#1a1d23",
                            fontSize: 11, fontWeight: 700, cursor: "pointer",
                            fontFamily: "'DM Sans', sans-serif",
                          }}>{bk === "any" ? "Best line" : bk}</button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {upcoming.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#8b919a" }}>No upcoming games available.</div>
                ) : (() => {
                  const q = analyzerSearch.trim().toLowerCase();
                  const filtered = upcoming
                    .filter(g => analyzerSport === "all" || g.sport_key === analyzerSport)
                    .filter(g => !q || g.home_team?.toLowerCase().includes(q) || g.away_team?.toLowerCase().includes(q));
                  if (filtered.length === 0) {
                    return <div style={{ fontSize: 12, color: "#8b919a" }}>No games match “{analyzerSearch}”.</div>;
                  }
                  return (
                  <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                    {filtered.map(game => {
                        const gameHasLeg = analyzerLegs.some(l => l.gameId === game.id);
                        return (
                          <div key={game.id} style={{
                            border: "1px solid #e2e5ea", borderRadius: 10, padding: "10px 12px",
                            background: gameHasLeg ? "#fefce8" : "#fafbfc",
                          }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1d23", marginBottom: 6 }}>
                              {game.away_team} @ {game.home_team}
                              <span style={{ fontSize: 10, color: "#8b919a", marginLeft: 8, fontWeight: 500 }}>
                                {formatTime(game.commence_time)}
                                {gameHasLeg && <span style={{ color: "#d97706", marginLeft: 6 }}>⚠ same-game</span>}
                              </span>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {(() => {
                                const buttons = [];
                                ["h2h", "spreads", "totals"].forEach(mt => {
                                  const { perOutcomeOffers } = collectMarketFairProbs(game, mt);
                                  Object.entries(perOutcomeOffers).forEach(([, offers]) => {
                                    if (!offers || offers.length === 0) return;
                                    // When a book is pinned, use that book's price. Otherwise best.
                                    const chosen = analyzerBook !== "any"
                                      ? offers.find(o => o.book === analyzerBook)
                                      : offers.reduce((b, o) => (o.price > b.price ? o : b), offers[0]);
                                    if (!chosen) return; // this book doesn't offer this outcome
                                    const pointStr = chosen.point !== null && chosen.point !== undefined
                                      ? (chosen.point > 0 ? ` +${chosen.point}` : ` ${chosen.point}`) : "";
                                    const label = mt === "h2h" ? "ML" : mt === "spreads" ? "SPR" : "TOT";
                                    buttons.push(
                                      <button key={`${mt}-${chosen.name}-${chosen.point ?? ""}`}
                                        onClick={() => addLeg(game, mt, chosen.name, chosen.point)}
                                        style={{
                                          padding: "4px 8px", borderRadius: 6, border: "1px solid #e2e5ea",
                                          background: "#fff", fontSize: 11, cursor: "pointer",
                                          fontFamily: "'DM Sans', sans-serif", color: "#1a1d23",
                                        }}>
                                        <span style={{ color: "#7c3aed", fontWeight: 700 }}>{label}</span>{" "}
                                        {chosen.name}{pointStr}{" "}
                                        <span style={{ fontFamily: "'Space Mono', monospace", color: "#0d9f4f", fontWeight: 700 }}>
                                          {formatOdds(chosen.price)}
                                        </span>
                                      </button>
                                    );
                                  });
                                });
                                if (buttons.length === 0 && analyzerBook !== "any") {
                                  return <span style={{ fontSize: 10, color: "#8b919a" }}>{analyzerBook} doesn't post odds for this game</span>;
                                }
                                return buttons;
                              })()}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                  );
                })()}
              </div>

              {/* Current legs — sticky to bottom of viewport */}
              <div style={{
                position: "sticky", bottom: 12, zIndex: 20,
                background: "#fff", border: "1px solid #e2e5ea", borderRadius: 14,
                padding: 16, marginBottom: 18,
                boxShadow: "0 -8px 24px rgba(26,29,35,0.12), 0 2px 6px rgba(26,29,35,0.06)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#1a1d23", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Your parlay ({analyzerLegs.length} leg{analyzerLegs.length === 1 ? "" : "s"})
                    {analysis && (
                      <span style={{
                        marginLeft: 10, padding: "2px 8px", borderRadius: 6,
                        background: analysis.verdictColor, color: "#fff",
                        fontSize: 10, fontWeight: 800, letterSpacing: "0.05em",
                      }}>
                        {formatOdds(analysis.combinedAmerican)} · {analysis.ev >= 0 ? "+" : ""}{analysis.ev.toFixed(1)}% EV
                      </span>
                    )}
                  </div>
                  {analyzerLegs.length > 0 && (
                    <button onClick={() => setAnalyzerLegs([])} style={{
                      background: "none", border: "none", color: "#dc2626",
                      fontSize: 11, fontWeight: 700, cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif",
                    }}>Clear all</button>
                  )}
                </div>
                {analyzerLegs.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#8b919a", padding: "12px 0" }}>
                    Pick outcomes above to start building your parlay.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                    {analyzerLegs.map(leg => {
                      const mt = leg.marketType === "h2h" ? "Moneyline" : leg.marketType === "spreads" ? "Spread" : "Total";
                      const pointStr = leg.point !== null && leg.point !== undefined
                        ? (leg.point > 0 ? ` +${leg.point}` : ` ${leg.point}`) : "";
                      return (
                        <div key={leg.id} style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 10px", border: "1px solid #e2e5ea", borderRadius: 8,
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1d23" }}>
                              {leg.outcome}{pointStr}{" "}
                              <span style={{ fontSize: 10, color: "#7c3aed", fontWeight: 700 }}>{mt}</span>
                            </div>
                            <div style={{ fontSize: 10, color: "#8b919a", marginTop: 2, display: "flex", alignItems: "center", gap: 2 }}>
                              <span>{leg.awayTeam} @ {leg.homeTeam} · <BookLink book={leg.book} style={{ fontSize: 10 }} /> · fair {(leg.fairProb * 100).toFixed(1)}%</span>
                              <AllBooksTooltip game={leg.game} marketType={leg.marketType} outcome={leg.outcome} point={leg.point} bestBook={leg.book} />
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Space Mono', monospace", color: leg.odds > 0 ? "#0d9f4f" : "#1a1d23" }}>
                              {formatOdds(leg.odds)}
                            </div>
                          </div>
                          <button onClick={() => removeLeg(leg.id)} style={{
                            background: "none", border: "none", color: "#8b919a",
                            fontSize: 16, cursor: "pointer", padding: "0 4px",
                          }} title="Remove leg">×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Analysis */}
              {analysis && (
                <div style={{
                  background: "linear-gradient(135deg, #1a1d23 0%, #2d3748 100%)",
                  borderRadius: 16, padding: 20, color: "#fff", marginBottom: 18,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{
                      background: analysis.verdictColor, color: "#fff",
                      padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 800,
                      textTransform: "uppercase", letterSpacing: "0.08em",
                    }}>{analysis.verdict}</div>
                    <div style={{ fontSize: 13, color: "#cbd5e0", fontWeight: 600 }}>
                      {analysis.ev >= 0 ? "+" : ""}{analysis.ev.toFixed(1)}% EV
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#cbd5e0", lineHeight: 1.6, marginBottom: 14 }}>
                    {analysis.verdictDetail}
                  </div>
                  {analysis.hasSameGame && (
                    <div style={{
                      background: "#7c2d12", border: "1px solid #c2410c",
                      borderRadius: 8, padding: "8px 12px", fontSize: 11,
                      color: "#fed7aa", marginBottom: 14, lineHeight: 1.5,
                    }}>
                      ⚠ Same-game legs detected. The EV estimate assumes independence; correlated legs inflate the true fair price — real EV is likely lower. Use the Same-Game tab for correlated plays.
                    </div>
                  )}
                  {bookCompare && bookCompare.length > 0 && (() => {
                    const best = bookCompare[0];
                    const currentBook = analyzerBook !== "any" ? analyzerBook : null;
                    const current = currentBook ? bookCompare.find(r => r.book === currentBook) : null;
                    const improvement = current ? (best.decimal / current.decimal - 1) * 100 : null;
                    // Only recommend when another book is meaningfully better
                    // (≥1.5% payout bump) than the user's pinned book.
                    const showRec = current && best.book !== currentBook && improvement >= 1.5;

                    const InfoButton = ({ bg, border, color }) => (
                      <button
                        onClick={() => setBookCompareOpen(v => !v)}
                        style={{
                          marginLeft: 8, width: 18, height: 18, borderRadius: 999,
                          background: bg, color, border: `1px solid ${border}`,
                          fontSize: 11, fontWeight: 800, cursor: "pointer", lineHeight: 1,
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          verticalAlign: "middle",
                        }}
                        title="Show each book's price on this parlay"
                      >i</button>
                    );

                    const CompareList = ({ bg }) => (
                      <div style={{
                        marginTop: 10, background: bg, borderRadius: 6, padding: "8px 10px",
                      }}>
                        <div style={{ fontSize: 10, color: "#cbd5e0", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 6 }}>
                          Per-book payout
                        </div>
                        {bookCompare.map((r, i) => (
                          <div key={r.book} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "3px 0", fontSize: 11,
                            color: i === 0 ? "#6ee7b7" : "#e2e8f0",
                            fontWeight: i === 0 ? 800 : 500,
                          }}>
                            <span>{i === 0 ? "🏆 " : ""}{r.book}</span>
                            <span style={{ fontFamily: "'Space Mono', monospace" }}>
                              {formatOdds(r.american)} <span style={{ color: "#94a3b8", fontWeight: 500 }}>({(r.decimal - 1).toFixed(2)}x)</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    );

                    if (showRec) {
                      return (
                        <div style={{
                          background: "#064e3b", border: "1px solid #10b981",
                          borderRadius: 8, padding: "10px 14px", marginBottom: 14, lineHeight: 1.5,
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "#6ee7b7", marginBottom: 4 }}>
                            💰 Shop this parlay: <span style={{ color: "#fff" }}>{best.book}</span> pays <span style={{ fontFamily: "'Space Mono', monospace" }}>{formatOdds(best.american)}</span>
                            <InfoButton bg="#065f46" border="#10b981" color="#6ee7b7" />
                          </div>
                          <div style={{ fontSize: 11, color: "#a7f3d0" }}>
                            {currentBook} pays {formatOdds(current.american)} on the same legs. Switching books boosts payout by {improvement.toFixed(1)}% (pays {(best.decimal - 1).toFixed(2)}x vs {(current.decimal - 1).toFixed(2)}x on a $1 stake).
                          </div>
                          {bookCompareOpen && <CompareList bg="#022c22" />}
                        </div>
                      );
                    }
                    // On "Best line" mode, still surface the top book so the
                    // user knows where to actually place the parlay.
                    if (!currentBook && bookCompare.length > 0) {
                      return (
                        <div style={{
                          background: "#1e3a8a", border: "1px solid #60a5fa",
                          borderRadius: 8, padding: "10px 14px", marginBottom: 14, lineHeight: 1.5,
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "#bfdbfe", marginBottom: 4 }}>
                            🏦 Best book for this parlay: <span style={{ color: "#fff" }}>{best.book}</span> at <span style={{ fontFamily: "'Space Mono', monospace" }}>{formatOdds(best.american)}</span>
                            <InfoButton bg="#1e40af" border="#60a5fa" color="#bfdbfe" />
                          </div>
                          <div style={{ fontSize: 11, color: "#dbeafe" }}>
                            Compared across {bookCompare.length} book{bookCompare.length === 1 ? "" : "s"} that offer all {analyzerLegs.length} legs. Pin a book above to see that book's exact price.
                          </div>
                          {bookCompareOpen && <CompareList bg="#172554" />}
                        </div>
                      );
                    }
                    return null;
                  })()}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Combined odds</div>
                      <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "'Space Mono', monospace", color: "#0d9f4f" }}>
                        {formatOdds(analysis.combinedAmerican)}
                      </div>
                      <div style={{ fontSize: 10, color: "#8b919a" }}>pays {(analysis.combinedDecimal - 1).toFixed(2)}x your stake</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Hit probability</div>
                      <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "'Space Mono', monospace", color: "#fff" }}>
                        {(analysis.fairProb * 100).toFixed(1)}%
                      </div>
                      <div style={{ fontSize: 10, color: "#8b919a" }}>book implies {(analysis.impliedProb * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              )}

              {analyzerLegs.length === 1 && (
                <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 12, padding: "12px 16px", color: "#92400e", fontSize: 12, lineHeight: 1.6 }}>
                  Add at least one more leg to see the parlay analysis.
                </div>
              )}
            </>
          );
        })()}

        {/* ── TRACK RECORD TAB ── */}
        {activeTab === "record" && (() => {
          const builtInRows = [
            { id: "sharp", label: "Sharp Plays", color: "#1a73e8", icon: "🧠",
              desc: "Composite-scored plays — discrepancy, underdog, divergence, EV." },
            { id: "value", label: "Value Bets", color: "#0d9f4f", icon: "⚡",
              desc: "Single-book prices that beat the vig-removed market median." },
            { id: "stale", label: "Stale Lines", color: "#dc2626", icon: "⏱️",
              desc: "Books slow to move — bet before the correction." },
            { id: "rlm", label: "Reverse Line Movement", color: "#7c3aed", icon: "🔄",
              desc: "Sharp books moved, public books didn't — bet the public price." },
            { id: "correlated", label: "Correlated Parlays", color: "#16a34a", icon: "🔗",
              desc: "Same-game legs that are statistically linked — books underprice the correlation." },
            { id: "safe_parlay", label: "Safe Parlays", color: "#0891b2", icon: "🛡️",
              desc: "Legs from our auto-built 3-leg +EV parlays — leg-level hit rate." },
            { id: "narrative", label: "Narrative Regression", color: "#d97706", icon: "📉",
              desc: "Fade the overreaction after a blowout loss." },
          ];

          // Build dynamic rows for the signed-in user's custom strategies, plus
          // any `custom_*` strategy that still has picks in Redis even if the
          // local definition was deleted.
          const customById = new Map(customStrategiesList.map(s => [s.id, s]));
          const customIdsFromPicks = new Set(
            (resolvedPicks || [])
              .map(p => p.strategy)
              .filter(s => typeof s === "string" && s.startsWith("custom_"))
              .map(s => s.slice(7))
          );
          const allCustomIds = new Set([...customById.keys(), ...customIdsFromPicks]);
          const customRows = [...allCustomIds].map(cid => {
            const s = customById.get(cid);
            return {
              id: `custom_${cid}`,
              label: s?.name || "Deleted Strategy",
              color: "#7c3aed",
              icon: "⚙️",
              desc: s
                ? `${s.sports?.length || 0} sport${s.sports?.length === 1 ? "" : "s"} · Min ${s.minEv}% EV · ${s.minBooks}+ books`
                : "Strategy was deleted — historical picks remain.",
              custom: true,
              missing: !s,
            };
          });

          const rows = [...builtInRows, ...customRows];

          // Filter picks by selected period
          const now = Date.now();
          const periodMs = recordPeriod === "7" ? 7 * 86400000
            : recordPeriod === "30" ? 30 * 86400000
            : null;
          const periodLabel = recordPeriod === "7" ? "Last 7 Days"
            : recordPeriod === "30" ? "Last 30 Days"
            : "All Time";
          const filteredPicks = (resolvedPicks || []).filter(p => {
            if (periodMs === null) return true;
            const t = new Date(p.commenceTime || p.resolvedAt || 0).getTime();
            return now - t <= periodMs;
          });

          // Compute per-strategy aggregates from filtered picks
          const computeStats = (picks) => {
            let wins = 0, losses = 0, pushes = 0, units = 0;
            for (const p of picks) {
              if (p.result === "win") { wins++; units += (typeof p.unitProfit === "number" ? p.unitProfit : 0); }
              else if (p.result === "loss") { losses++; units -= 1; }
              else if (p.result === "push") { pushes++; }
            }
            const total = wins + losses + pushes;
            const decided = wins + losses;
            const roi = total > 0 ? (units / total) * 100 : null;
            const winPct = decided > 0 ? ((wins / decided) * 100) : null;
            return { wins, losses, pushes, total, decided, units, roi, winPct };
          };

          const overall = computeStats(filteredPicks);
          const overallColor = overall.roi === null ? "#8b919a"
            : overall.roi >= 5 ? "#0d9f4f" : overall.roi >= 0 ? "#1a73e8" : "#e8a100";

          // Earliest pick date — used for "since [date]" display on All Time
          const oldestTs = filteredPicks.length > 0
            ? filteredPicks.reduce((min, p) => {
                const t = new Date(p.commenceTime || p.resolvedAt || 0).getTime();
                return t && t < min ? t : min;
              }, Infinity)
            : null;
          const sinceLabel = (recordPeriod === "all" && oldestTs && oldestTs !== Infinity)
            ? new Date(oldestTs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : null;

          // ─── DRILL-DOWN DETAIL VIEW ───
          if (selectedStrategy) {
            const meta = rows.find(r => r.id === selectedStrategy);
            const stratPicks = filteredPicks.filter(p => p.strategy === selectedStrategy);
            const stratStats = computeStats(stratPicks);
            const stratColor = stratStats.roi === null ? "#8b919a"
              : stratStats.roi >= 5 ? "#0d9f4f" : stratStats.roi >= 0 ? "#1a73e8" : "#e8a100";

            // Cumulative equity curve (last-N picks visualization as simple bars)
            let running = 0;
            const curve = stratPicks.slice().reverse().map(p => {
              const profit = p.result === "win" ? (p.unitProfit || 0)
                : p.result === "loss" ? -1 : 0;
              running += profit;
              return { pick: p, cum: running, profit };
            });
            const curveMin = curve.length > 0 ? Math.min(0, ...curve.map(c => c.cum)) : 0;
            const curveMax = curve.length > 0 ? Math.max(0, ...curve.map(c => c.cum)) : 0;
            const curveRange = Math.max(1, curveMax - curveMin);

            return (
              <>
                <button onClick={() => setSelectedStrategy(null)} style={{
                  background: "none", border: "none", color: "#1a73e8", fontSize: 13, fontWeight: 700,
                  cursor: "pointer", padding: "4px 0", marginBottom: 10, fontFamily: "'DM Sans', sans-serif",
                }}>← Back to Track Record</button>

                <div style={{ marginBottom: 10 }}>
                  <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 900, color: "#1a1d23" }}>
                    {meta?.icon} {meta?.label}
                  </h2>
                  <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                    {meta?.desc}
                  </div>
                </div>

                {/* Period toggle */}
                <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                  {[
                    { id: "7", label: "7D" },
                    { id: "30", label: "30D" },
                    { id: "all", label: "All Time" },
                  ].map(p => (
                    <button key={p.id} onClick={() => setRecordPeriod(p.id)} style={{
                      padding: "6px 14px", borderRadius: 8,
                      border: recordPeriod === p.id ? "1.5px solid #1a73e8" : "1px solid #e2e5ea",
                      background: recordPeriod === p.id ? "#1a73e814" : "#fff",
                      color: recordPeriod === p.id ? "#1a73e8" : "#5f6368",
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif",
                    }}>{p.label}</button>
                  ))}
                </div>

                {/* Strategy hero */}
                <div style={{
                  background: "linear-gradient(135deg, #1a1d23 0%, #2d3748 100%)",
                  borderRadius: 16, padding: "20px 22px", marginBottom: 18, color: "#fff",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#a0aec0", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>
                    {periodLabel}{sinceLabel ? ` · since ${sinceLabel}` : ""}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <div style={{ fontSize: 44, fontWeight: 900, color: stratColor, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>
                        {stratStats.units >= 0 ? "+" : ""}{stratStats.units.toFixed(2)}u
                      </div>
                      <UnitsInfo units={stratStats.units} dark />
                    </div>
                    <div style={{ fontSize: 13, color: "#cbd5e0" }}>
                      {stratStats.roi === null ? "—" : `${stratStats.roi >= 0 ? "+" : ""}${stratStats.roi.toFixed(1)}% ROI`}
                      <div style={{ fontSize: 11, color: "#8b919a", marginTop: 2 }}>
                        {stratStats.wins}W · {stratStats.losses}L{stratStats.pushes > 0 ? ` · ${stratStats.pushes}P` : ""} ({stratStats.winPct === null ? "—" : `${stratStats.winPct.toFixed(1)}% win`}) · {stratStats.total} settled
                      </div>
                    </div>
                  </div>
                </div>

                {/* Equity curve */}
                {curve.length > 1 && (
                  <div style={{
                    background: "#fff", border: "1px solid #e2e5ea", borderRadius: 12,
                    padding: "14px 16px", marginBottom: 14,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#8b919a", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>
                      Running Units
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60 }}>
                      {curve.map((c, i) => {
                        const h = ((c.cum - curveMin) / curveRange) * 100;
                        const color = c.profit > 0 ? "#0d9f4f" : c.profit < 0 ? "#e8a100" : "#8b919a";
                        return (
                          <div key={i} style={{
                            flex: 1, minWidth: 2, height: `${Math.max(2, h)}%`,
                            background: color, borderRadius: 1, transition: "height 0.3s",
                          }} title={`${c.pick.outcome} · ${c.cum.toFixed(2)}u`} />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Pick list */}
                <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800, color: "#1a1d23" }}>
                  Picks ({stratPicks.length})
                </h3>
                {stratPicks.length === 0 ? (
                  <div style={{
                    background: "#f8f9fa", border: "1px dashed #cbd5e0", borderRadius: 12,
                    padding: "20px 16px", textAlign: "center", color: "#8b919a", fontSize: 12,
                  }}>
                    No settled picks in this period yet.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {stratPicks.map(p => {
                      const profit = p.result === "win" ? (p.unitProfit || 0)
                        : p.result === "loss" ? -1 : 0;
                      const resultColor = p.result === "win" ? "#0d9f4f"
                        : p.result === "loss" ? "#dc2626" : "#8b919a";
                      const resultLabel = p.result.toUpperCase();
                      const marketLabel = p.marketType === "h2h" ? "ML"
                        : p.marketType === "spreads" ? "Spread" : "Total";
                      const pointStr = p.point !== null && p.point !== undefined
                        ? (p.point > 0 ? `+${p.point}` : `${p.point}`)
                        : "";
                      const dateStr = p.commenceTime
                        ? new Date(p.commenceTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                        : "";
                      return (
                        <div key={p.id} style={{
                          background: "#fff", border: "1px solid #e2e5ea", borderLeft: `3px solid ${resultColor}`,
                          borderRadius: 10, padding: "10px 12px",
                          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                        }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
                              <span style={{
                                fontSize: 9, fontWeight: 800, color: resultColor,
                                background: `${resultColor}12`, padding: "2px 6px", borderRadius: 4,
                                letterSpacing: "0.04em",
                              }}>{resultLabel}</span>
                              <span style={{ fontSize: 10, color: "#8b919a", fontWeight: 600 }}>{dateStr}</span>
                              <span style={{ fontSize: 10, color: "#8b919a" }}>{marketLabel}</span>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1d23", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {p.outcome} {pointStr}
                            </div>
                            <div style={{ fontSize: 10, color: "#8b919a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {p.awayTeam} @ {p.homeTeam}
                              {p.finalHome !== null && p.finalAway !== null ? ` · ${p.finalAway}-${p.finalHome}` : ""}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{
                              fontSize: 13, fontWeight: 800, fontFamily: "'Space Mono', monospace",
                              color: profit >= 0 ? "#0d9f4f" : "#dc2626",
                            }}>
                              {profit >= 0 ? "+" : ""}{profit.toFixed(2)}u
                            </div>
                            <div style={{ fontSize: 10, color: "#8b919a", fontFamily: "'Space Mono', monospace" }}>
                              {p.odds} · <BookLink book={p.book} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            );
          }

          // ─── OVERVIEW VIEW ───
          return (
            <>
              <div style={{ marginBottom: 14 }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 900, color: "#1a1d23" }}>
                  Track Record
                </h2>
                <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                  Every pick we recommend gets saved and settled against real game results. No cherry-picking. No hiding losses. Tap a strategy for the full pick history.
                </div>
              </div>

              {/* Period toggle */}
              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                {[
                  { id: "7", label: "7D" },
                  { id: "30", label: "30D" },
                  { id: "all", label: "All Time" },
                ].map(p => (
                  <button key={p.id} onClick={() => setRecordPeriod(p.id)} style={{
                    padding: "6px 14px", borderRadius: 8,
                    border: recordPeriod === p.id ? "1.5px solid #1a73e8" : "1px solid #e2e5ea",
                    background: recordPeriod === p.id ? "#1a73e814" : "#fff",
                    color: recordPeriod === p.id ? "#1a73e8" : "#5f6368",
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>{p.label}</button>
                ))}
              </div>

              {/* Overall hero */}
              <div style={{
                background: "linear-gradient(135deg, #1a1d23 0%, #2d3748 100%)",
                borderRadius: 16, padding: "20px 22px", marginBottom: 18, color: "#fff",
              }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#a0aec0", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>
                  Overall · {periodLabel}{sinceLabel ? ` · since ${sinceLabel}` : ""}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ fontSize: 44, fontWeight: 900, color: overallColor, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>
                      {overall.units >= 0 ? "+" : ""}{overall.units.toFixed(2)}u
                    </div>
                    <UnitsInfo units={overall.units} dark />
                  </div>
                  <div style={{ fontSize: 13, color: "#cbd5e0" }}>
                    {overall.roi === null ? "—" : `${overall.roi >= 0 ? "+" : ""}${overall.roi.toFixed(1)}% ROI`}
                    <div style={{ fontSize: 11, color: "#8b919a", marginTop: 2 }}>
                      {overall.wins}W · {overall.losses}L{overall.pushes > 0 ? ` · ${overall.pushes}P` : ""} ({overall.winPct === null ? "—" : `${overall.winPct.toFixed(1)}% win`}) · {overall.total} settled
                    </div>
                  </div>
                </div>
                {overall.decided < SAMPLE_THRESHOLD && (
                  <div style={{
                    marginTop: 12, padding: "8px 12px", borderRadius: 8,
                    background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)",
                    fontSize: 11, color: "#fbd38d", lineHeight: 1.5,
                  }}>
                    Early numbers are shown from the first settled pick, but they are highly volatile until hundreds of picks accumulate. Treat anything under 100 settled picks as directional only.
                  </div>
                )}
              </div>

              {/* Per-strategy breakdown */}
              <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800, color: "#1a1d23" }}>By Strategy</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                {rows.map(r => {
                  const stratPicks = filteredPicks.filter(p => p.strategy === r.id);
                  const s = computeStats(stratPicks);
                  const hasEnough = s.decided >= SAMPLE_THRESHOLD;
                  const showRoi = hasEnough ? s.roi : null;
                  const roiColor = showRoi === null ? "#8b919a"
                    : showRoi >= 5 ? "#0d9f4f" : showRoi >= 0 ? "#1a73e8" : "#e8a100";

                  return (
                    <button
                      key={r.id}
                      onClick={() => setSelectedStrategy(r.id)}
                      style={{
                        background: "#fff", border: "1px solid #e2e5ea", borderLeft: `3px solid ${r.color}`,
                        borderRadius: 12, padding: "14px 16px",
                        textAlign: "left", cursor: "pointer", width: "100%",
                        fontFamily: "inherit",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: "#1a1d23" }}>
                            {r.icon} {r.label}
                          </div>
                          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, lineHeight: 1.5 }}>
                            {r.desc}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                          <div>
                            <div style={{
                              fontSize: 22, fontWeight: 900, fontFamily: "'Space Mono', monospace",
                              color: roiColor, lineHeight: 1,
                            }}>
                              {hasEnough ? `${s.units >= 0 ? "+" : ""}${s.units.toFixed(2)}u` : "—"}
                            </div>
                            <div style={{ fontSize: 10, color: "#8b919a", marginTop: 3 }}>
                              {showRoi === null ? "" : `${showRoi >= 0 ? "+" : ""}${showRoi.toFixed(1)}% ROI · `}{s.wins}W-{s.losses}L{s.pushes > 0 ? `-${s.pushes}P` : ""}
                              {hasEnough && s.winPct !== null ? ` (${s.winPct.toFixed(1)}% win)` : ""}
                            </div>
                          </div>
                          <div style={{ fontSize: 16, color: "#cbd5e0", fontWeight: 700 }}>›</div>
                        </div>
                      </div>
                      {!hasEnough && (
                        <div style={{
                          marginTop: 10, fontSize: 10, color: "#8b919a",
                          background: "#f8f9fa", padding: "6px 10px", borderRadius: 6,
                        }}>
                          {s.total === 0
                            ? `No settled picks yet${recordPeriod !== "all" ? ` in ${periodLabel.toLowerCase()}` : ""}.`
                            : `Building sample — ${SAMPLE_THRESHOLD - s.decided} more settled picks until ROI is confident.`}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* How it works */}
              <div style={{
                background: "#f8f9fa", border: "1px solid #e2e5ea", borderRadius: 14,
                padding: "16px 18px", marginBottom: 8,
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#1a1d23", marginBottom: 8 }}>How We Track</div>
                <div style={{ fontSize: 12, color: "#4a5568", lineHeight: 1.7 }}>
                  Every pick we surface gets saved to our database the moment it's recommended. A daily job pulls final scores from ESPN, matches them to pending picks, and settles each as a Win, Loss, or Push. We don't retroactively edit, delete, or hide losing picks — the numbers above include everything.
                </div>
                <div style={{ fontSize: 12, color: "#4a5568", lineHeight: 1.7, marginTop: 10 }}>
                  <strong>Units &amp; ROI methodology:</strong> Every pick is tracked as a flat 1-unit bet. A win at +200 pays +2.00 units; a win at -150 pays +0.67 units; a loss is -1.00. ROI = total units won ÷ total picks × 100. This is the industry-standard way to measure betting performance because it weights underdog wins heavier than favorite wins — a 55% win rate on +150 dogs crushes a 65% rate on -250 favorites. Win % alone can mislead; units and ROI can't. See the{' '}
                  <button onClick={() => setLegalPage("disclaimer")} style={{ background: "none", border: "none", color: "#1a73e8", cursor: "pointer", fontWeight: 700, padding: 0, fontSize: 12, fontFamily: "inherit" }}>full disclaimer</button>{' '}for details.
                </div>
              </div>
            </>
          );
        })()}

      </div>

      {showAlertBuilder && <AlertBuilder onClose={() => setShowAlertBuilder(false)} />}


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

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a1d23", marginTop: 20, marginBottom: 8 }}>Track Record Methodology</h3>
                  <p>The "Track Record" section displays historical performance statistics for picks generated by our algorithms. Performance is measured using <strong>units won</strong> and <strong>return on investment (ROI)</strong>, which are the standard methodologies used across professional sports betting analytics.</p>
                  <p style={{ marginTop: 10 }}><strong>How picks are recorded:</strong> Every pick surfaced by the Service (Sharp Plays, Value Bets, Stale Lines, Reverse Line Movement, Correlated Parlays, Narrative Regression) is saved to our database at the moment it is recommended, using the odds available at the time of recommendation. We do not retroactively add, remove, or edit picks. Losing picks are included in all displayed statistics.</p>
                  <p style={{ marginTop: 10 }}><strong>How picks are settled:</strong> A daily automated job retrieves final game results from publicly available third-party score providers (e.g., ESPN) and settles pending picks as a Win, Loss, or Push. Picks for games that cannot be matched to a final score within 48 hours of the scheduled start time are marked as "expired" and excluded from performance calculations. Matching relies on team name comparison and may fail in rare cases; unmatched picks are not counted as wins or losses.</p>
                  <p style={{ marginTop: 10 }}><strong>Unit calculation:</strong> All picks are tracked as flat <strong>1-unit</strong> wagers regardless of any implied confidence, score, or edge percentage displayed on the site. A unit is an abstract accounting convention and does not represent any specific dollar amount. Profit and loss per pick is calculated using standard American-odds payout math:</p>
                  <ul style={{ paddingLeft: 20, marginTop: 8, marginBottom: 8 }}>
                    <li style={{ marginBottom: 6 }}><strong>Win at positive odds (+N):</strong> profit = N ÷ 100 units (e.g., +200 = +2.00u, +150 = +1.50u).</li>
                    <li style={{ marginBottom: 6 }}><strong>Win at negative odds (-N):</strong> profit = 100 ÷ N units (e.g., -150 = +0.67u, -200 = +0.50u).</li>
                    <li style={{ marginBottom: 6 }}><strong>Loss:</strong> -1.00 unit.</li>
                    <li style={{ marginBottom: 6 }}><strong>Push (tie):</strong> 0.00 units (stake returned).</li>
                    <li style={{ marginBottom: 6 }}><strong>Expired / unmatched:</strong> 0.00 units (excluded from ROI denominator).</li>
                  </ul>
                  <p style={{ marginTop: 10 }}><strong>ROI calculation:</strong> ROI = (total units won ÷ total settled picks) × 100, expressed as a percentage. A positive ROI indicates profit per unit wagered. A negative ROI indicates loss per unit wagered. ROI is the industry-standard metric because, unlike raw win percentage, it correctly weights wins on underdogs heavier than wins on favorites and accurately reflects the economic outcome of a betting strategy.</p>
                  <p style={{ marginTop: 10 }}><strong>Win percentage:</strong> Win % is shown as a secondary metric and is calculated as wins ÷ (wins + losses). Pushes are excluded from this denominator. Win percentage alone does <em>not</em> indicate profitability; a bettor can have a high win percentage and still lose money if most wins come at short odds. Always evaluate performance using units and ROI.</p>
                  <p style={{ marginTop: 10 }}><strong>Sample size disclosure:</strong> Units and ROI are displayed from the first settled pick onward so users can see full transparency into recent picks. These early figures are <strong>highly volatile and statistically meaningless</strong> — a single underdog hit or loss at long odds can swing a small-sample ROI by dozens of percentage points. Short-term variance can cause the displayed ROI to diverge significantly from the true long-run expectancy of a strategy, and sports betting results require <strong>hundreds or thousands of bets</strong> to reliably distinguish skill from luck. Treat any strategy with fewer than ~100 settled picks as directional only, never as statistically significant evidence of edge.</p>
                  <p style={{ marginTop: 10 }}><strong>No guarantee:</strong> Historical Track Record performance is shown for transparency and informational purposes only. <strong>Past performance does not guarantee future results.</strong> The Track Record reflects outcomes of picks generated by our algorithms using odds available at recommendation time; actual outcomes if you place the same wagers may differ due to line changes, book availability, limits, juice, bet sizing, and other factors. Nothing in the Track Record constitutes a prediction, guarantee, or recommendation to place any specific wager.</p>

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

        {/* Strategy Guide links */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#a0aec0", textAlign: "center", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>Strategy Guides</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            {[
              { to: "/ev-betting", label: "EV Betting" },
              { to: "/sharp-betting", label: "Sharp Betting" },
              { to: "/odds-comparison", label: "Odds Comparison" },
              { to: "/parlay-calculator", label: "Parlay Strategy" },
              { to: "/reverse-line-movement", label: "Reverse Line Movement" },
              { to: "/correlated-parlays", label: "Correlated Parlays" },
              { to: "/stale-line-detector", label: "Stale Line Detector" },
              { to: "/narrative-regression", label: "Narrative Regression" },
              { to: "/betting-alerts", label: "Betting Alerts" },
              { to: "/live-scores", label: "Live Scores" },
            ].map(link => (
              <Link key={link.to} to={link.to} style={{ color: "#8b919a", fontSize: 11, textDecoration: "underline" }}>{link.label}</Link>
            ))}
          </div>
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