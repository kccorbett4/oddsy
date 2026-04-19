// Cross-market value detector. Kalshi/Polymarket prices are vig-free —
// when their YES % disagrees with the sportsbook's devig implied prob for
// the same game, one side is mispriced and there's +EV to capture.
//
// We only surface prediction-market entries where the same matchup is
// posted on US sportsbooks (via The Odds API h2h market), so every row
// on the page has an apples-to-apples bet you can place somewhere.

import { getRedis } from "./_redis.js";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const POLY_BASE = "https://gamma-api.polymarket.com";
const ODDS_BASE = "https://api.the-odds-api.com/v4";

const CACHE_KEY = "predmkt:v2";
const CACHE_TTL_SECONDS = 15 * 60;

// kalshiSlug is the human-readable series title Kalshi uses in its public
// URL path (matches the "title" field returned by /series/{ticker}, slugified).
// URL format: kalshi.com/markets/{series-lower}/{kalshiSlug}/{event-ticker-lower}
const SPORT_CONFIGS = {
  baseball_mlb:         { kalshi: "KXMLBGAME",  kalshiSlug: "professional-baseball-game",  label: "MLB",  seasonMonths: [2,3,4,5,6,7,8,9] },
  basketball_nba:       { kalshi: "KXNBAGAME",  kalshiSlug: "professional-basketball-game", label: "NBA",  seasonMonths: [9,10,11,0,1,2,3,4,5] },
  icehockey_nhl:        { kalshi: "KXNHLGAME",  kalshiSlug: "nhl-game",                     label: "NHL",  seasonMonths: [9,10,11,0,1,2,3,4,5] },
  americanfootball_nfl: { kalshi: "KXNFLGAME",  kalshiSlug: "professional-football-game",   label: "NFL",  seasonMonths: [7,8,9,10,11,0,1] },
  basketball_wnba:      { kalshi: "KXWNBAGAME", kalshiSlug: "wnba-game",                    label: "WNBA", seasonMonths: [4,5,6,7,8,9] },
  soccer_usa_mls:       { kalshi: "KXMLSGAME",  kalshiSlug: "major-league-soccer-game",     label: "MLS",  seasonMonths: [1,2,3,4,5,6,7,8,9,10] },
};

function kalshiEventUrl(seriesTicker, seriesSlug, eventTicker) {
  if (!seriesTicker || !seriesSlug || !eventTicker) return "https://kalshi.com/sports";
  return `https://kalshi.com/markets/${seriesTicker.toLowerCase()}/${seriesSlug}/${eventTicker.toLowerCase()}`;
}

async function jget(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fetchKalshi(seriesTicker) {
  const j = await jget(`${KALSHI_BASE}/markets?limit=200&status=open&series_ticker=${seriesTicker}`);
  return j?.markets || [];
}

async function fetchPolymarket() {
  const j = await jget(`${POLY_BASE}/markets?limit=100&closed=false&active=true&tag_id=1&order=volume&ascending=false`);
  return Array.isArray(j) ? j : [];
}

async function fetchBookGames(sportKey, apiKey) {
  const j = await jget(`${ODDS_BASE}/sports/${sportKey}/odds?apiKey=${apiKey}&regions=us,us2&markets=h2h&oddsFormat=decimal`);
  return Array.isArray(j) ? j : [];
}

const decimalToAmerican = (d) => {
  if (!Number.isFinite(d) || d <= 1) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
};

// Proportional devig for a two-way market. Per-book, then we median
// across books to get a stable consensus that isn't skewed by any one
// outlier's juice.
function summarizeGame(game) {
  const home = game.home_team, away = game.away_team;
  if (!home || !away) return null;

  let bestHome = null, bestAway = null;
  const perBookHome = [];
  const perBookAway = [];
  const perBookDraw = [];
  let hasDraw = false;

  for (const bm of (game.bookmakers || [])) {
    const mkt = (bm.markets || []).find(m => m.key === "h2h");
    if (!mkt) continue;
    let hOdds = null, aOdds = null, dOdds = null;
    for (const o of (mkt.outcomes || [])) {
      if (!Number.isFinite(o.price) || o.price <= 1) continue;
      if (o.name === home) hOdds = o.price;
      else if (o.name === away) aOdds = o.price;
      else if (/^draw$/i.test(o.name || "")) dOdds = o.price;
    }
    if (hOdds == null || aOdds == null) continue;
    if (!bestHome || hOdds > bestHome.decimal) bestHome = { decimal: hOdds, book: bm.title };
    if (!bestAway || aOdds > bestAway.decimal) bestAway = { decimal: aOdds, book: bm.title };
    const pH = 1 / hOdds, pA = 1 / aOdds, pD = dOdds ? 1 / dOdds : 0;
    if (pD > 0) hasDraw = true;
    const total = pH + pA + pD;
    if (total > 0) {
      perBookHome.push(pH / total);
      perBookAway.push(pA / total);
      if (pD > 0) perBookDraw.push(pD / total);
    }
  }
  if (!bestHome || !bestAway || perBookHome.length === 0) return null;

  const median = (arr) => {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  };

  return {
    sportKey: game.sport_key,
    home, away,
    commenceTime: game.commence_time,
    bestHome, bestAway,
    devigHomeProb: median(perBookHome),
    devigAwayProb: median(perBookAway),
    devigDrawProb: hasDraw ? median(perBookDraw) : 0,
    hasDraw,
  };
}

// ──────────────────── team name matching ────────────────────

function normName(s) {
  return (s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Kalshi uses short names that don't line up with Odds API's full names.
// Single-letter disambiguators ("Los Angeles A" for Angels vs "Los Angeles D"
// for Dodgers) and informal nicknames ("A's") need an alias table.
const KALSHI_ALIAS = {
  "a s": "athletics", "as": "athletics",
  "sf": "san francisco", "tb": "tampa bay",
};

function kalshiMatchesBookTeam(kalshiName, bookTeam) {
  const k = normName(kalshiName);
  const b = normName(bookTeam);
  if (!k || !b) return false;
  if (KALSHI_ALIAS[k] && b.includes(KALSHI_ALIAS[k])) return true;

  // "Los Angeles A" → city = "los angeles", initial = "a"; match against
  // book team "los angeles angels" by city + first-letter-of-nickname.
  const m = k.match(/^(.+)\s([a-z])$/);
  if (m) {
    const city = m[1], initial = m[2];
    if (b.startsWith(city + " ")) {
      const rest = b.slice(city.length).trim();
      return rest.length > 0 && rest[0] === initial;
    }
  }

  if (b.includes(k)) return true;
  const kTokens = k.split(" ").filter(t => t.length >= 3);
  const bTokens = b.split(" ").filter(t => t.length >= 3);
  return kTokens.some(t => bTokens.includes(t));
}

// ──────────────────── match & score ────────────────────

function buildComparison({ source, marketId, marketUrl, title, sportLabel, sportKey, game, yesIsHome, predProb, predBid, predAsk }) {
  if (predProb == null || !Number.isFinite(predProb) || predProb <= 0 || predProb >= 1) return null;

  // For 3-way markets (soccer/MLS), Kalshi YES = P(one team wins) and NO =
  // P(draw or other team wins). We map NO back to P(other team wins) by
  // pulling the book's draw prob out — imperfect, but better than treating
  // NO as if it were a 2-way "other team wins".
  const predYesSide = predProb;
  const predNoSide = game.hasDraw
    ? Math.max(0, 1 - predYesSide - game.devigDrawProb)
    : 1 - predYesSide;
  const predHome = yesIsHome ? predYesSide : predNoSide;
  const predAway = yesIsHome ? predNoSide : predYesSide;

  const homeDec = game.bestHome.decimal;
  const awayDec = game.bestAway.decimal;
  const evHome = predHome * (homeDec - 1) - (1 - predHome);
  const evAway = predAway * (awayDec - 1) - (1 - predAway);

  // Prefer the side with the larger positive EV. If both negative, the
  // value is on the prediction market side (book is overcharging on both
  // sides vs. the vig-free market), but we still flag the better sportsbook
  // bet for transparency even if EV is negative.
  const homeIsBest = evHome >= evAway;
  const bestSide = homeIsBest ? "home" : "away";
  const bestTeam = homeIsBest ? game.home : game.away;
  const bestPrice = homeIsBest ? game.bestHome : game.bestAway;
  const bestEv = homeIsBest ? evHome : evAway;
  const bestDevig = homeIsBest ? game.devigHomeProb : game.devigAwayProb;
  const bestPred = homeIsBest ? predHome : predAway;

  return {
    source,
    marketId,
    marketUrl,
    title,
    sport: sportLabel,
    sportKey,
    teams: { home: game.home, away: game.away },
    commenceTime: game.commenceTime,
    predictionMarket: {
      yesTeam: yesIsHome ? game.home : game.away,
      homeProb: +predHome.toFixed(4),
      awayProb: +predAway.toFixed(4),
      bid: predBid, ask: predAsk,
    },
    book: {
      home: {
        bestBook: game.bestHome.book,
        decimalOdds: +homeDec.toFixed(3),
        americanOdds: decimalToAmerican(homeDec),
        rawImpliedProb: +(1 / homeDec).toFixed(4),
        devigProb: +game.devigHomeProb.toFixed(4),
      },
      away: {
        bestBook: game.bestAway.book,
        decimalOdds: +awayDec.toFixed(3),
        americanOdds: decimalToAmerican(awayDec),
        rawImpliedProb: +(1 / awayDec).toFixed(4),
        devigProb: +game.devigAwayProb.toFixed(4),
      },
    },
    bestBet: {
      side: bestSide,
      team: bestTeam,
      book: bestPrice.book,
      americanOdds: decimalToAmerican(bestPrice.decimal),
      decimalOdds: +bestPrice.decimal.toFixed(3),
      predProb: +bestPred.toFixed(4),
      devigProb: +bestDevig.toFixed(4),
      edgePP: +((bestPred - bestDevig) * 100).toFixed(2),
      evPercent: +(bestEv * 100).toFixed(2),
    },
  };
}

// ──────────────────── handler ────────────────────

export default async function handler(req, res) {
  const API_KEY = process.env.ODDS_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ODDS_API_KEY not configured" });

  // Redis cache gate — prediction markets only need to recompute every 15m
  // (Kalshi/Polymarket/book lines drift that slowly for full-game markets).
  // Without this every page view burned ~6 Odds API credits.
  const redis = await getRedis().catch(() => null);
  if (redis) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
        return res.status(200).json(JSON.parse(cached));
      }
    } catch {}
  }

  const month = new Date().getMonth();
  const inSeasonKeys = Object.entries(SPORT_CONFIGS)
    .filter(([, cfg]) => cfg.seasonMonths.includes(month))
    .map(([k]) => k);

  try {
    const [kalshiBySport, polyMarkets, bookGamesBySport] = await Promise.all([
      Promise.all(inSeasonKeys.map(async (sportKey) => ({
        sportKey,
        cfg: SPORT_CONFIGS[sportKey],
        markets: await fetchKalshi(SPORT_CONFIGS[sportKey].kalshi),
      }))),
      fetchPolymarket(),
      Promise.all(inSeasonKeys.map(async (sportKey) => ({
        sportKey,
        games: await fetchBookGames(sportKey, API_KEY),
      }))),
    ]);

    const allBookGames = [];
    for (const { games } of bookGamesBySport) {
      for (const g of games) {
        const s = summarizeGame(g);
        if (s) allBookGames.push(s);
      }
    }

    const matches = [];

    // Kalshi → sportsbook. Each game is two markets in Kalshi (one per
    // possible winner), and their no_sub_title field is unreliable (often
    // duplicates yes_sub_title), so we parse both teams from the title
    // and dedupe by event_ticker to only produce one comparison per game.
    const seenKalshiEvents = new Set();
    for (const { sportKey, cfg, markets } of kalshiBySport) {
      for (const m of markets) {
        const evTicker = m.event_ticker;
        if (evTicker && seenKalshiEvents.has(evTicker)) continue;

        const titleMatch = (m.title || "").trim().match(/^(.+?)\s+vs\s+(.+?)\s+Winner\??$/i);
        const yesTeam = m.yes_sub_title;
        if (!titleMatch || !yesTeam) continue;
        const teamA = titleMatch[1].trim();
        const teamB = titleMatch[2].trim();
        const noTeam = normName(teamA) === normName(yesTeam) ? teamB
                     : normName(teamB) === normName(yesTeam) ? teamA
                     : null;
        if (!noTeam) continue;

        const kTime = m.occurrence_datetime ? new Date(m.occurrence_datetime).getTime() : null;
        if (kTime == null) continue;

        const game = allBookGames.find(g => {
          if (g.sportKey !== sportKey) return false;
          const gTime = g.commenceTime ? new Date(g.commenceTime).getTime() : null;
          if (gTime == null || Math.abs(gTime - kTime) > 6 * 3600 * 1000) return false;
          const yesH = kalshiMatchesBookTeam(yesTeam, g.home);
          const yesA = kalshiMatchesBookTeam(yesTeam, g.away);
          const noH = kalshiMatchesBookTeam(noTeam, g.home);
          const noA = kalshiMatchesBookTeam(noTeam, g.away);
          return (yesH && noA) || (yesA && noH);
        });
        if (!game) continue;

        const yesIsHome = kalshiMatchesBookTeam(yesTeam, game.home);
        const bid = parseFloat(m.yes_bid_dollars || "0") || null;
        const ask = parseFloat(m.yes_ask_dollars || "0") || null;
        const last = parseFloat(m.last_price_dollars || "0") || null;
        const predProb = bid && ask ? (bid + ask) / 2 : last;

        const comp = buildComparison({
          source: "kalshi",
          marketId: m.ticker,
          marketUrl: kalshiEventUrl(cfg.kalshi, cfg.kalshiSlug, evTicker),
          title: m.title || `${game.away} @ ${game.home}`,
          sportLabel: cfg.label,
          sportKey,
          game,
          yesIsHome,
          predProb,
          predBid: bid,
          predAsk: ask,
        });
        if (comp) matches.push(comp);
        if (evTicker) seenKalshiEvents.add(evTicker);
      }
    }

    // Polymarket → sportsbook. Much looser than Kalshi: their questions
    // are free-form strings, so we only match clearly-phrased "will X win"
    // or "X vs Y" markets and skip totals/spreads/draws.
    for (const poly of polyMarkets) {
      const q = (poly.question || "").toLowerCase();
      const slug = (poly.slug || "").toLowerCase();
      if (!q || !slug) continue;
      if (/end in a draw|\bo\/u\b|\bspread\b|over\/under|both teams to score|\bto score\b|correct score/i.test(q)) continue;
      if (!/win|beat|\bvs\b|\bv\./i.test(q) && !/-vs-|-win-/.test(slug)) continue;

      const endMs = poly.endDate ? new Date(poly.endDate).getTime() : null;
      const startMs = poly.startDate ? new Date(poly.startDate).getTime() : null;
      const pickMs = startMs || endMs;
      if (pickMs == null) continue;

      const game = allBookGames.find(g => {
        const gTime = g.commenceTime ? new Date(g.commenceTime).getTime() : null;
        if (gTime == null) return false;
        if (Math.abs(gTime - pickMs) > 12 * 3600 * 1000) return false;
        const h = normName(g.home), a = normName(g.away);
        const hSlug = h.replace(/\s/g, "-"), aSlug = a.replace(/\s/g, "-");
        const qHit = (token) => {
          if (!token) return false;
          const words = token.split(" ").filter(w => w.length >= 4);
          return words.some(w => q.includes(w));
        };
        const slugHit = slug.includes(hSlug) || slug.includes(aSlug);
        return slugHit || (qHit(h) && qHit(a));
      });
      if (!game) continue;

      // Figure out which team is the YES side. Prefer the slug or the
      // "Will X win" phrasing at the front of the question.
      const h = normName(game.home), a = normName(game.away);
      let yesIsHome = null;
      const firstWordHit = (name) => {
        const w = name.split(" ").filter(x => x.length >= 4);
        return w.some(x => q.startsWith(x) || q.startsWith("will " + x));
      };
      if (firstWordHit(h)) yesIsHome = true;
      else if (firstWordHit(a)) yesIsHome = false;
      else if (slug.includes(h.replace(/\s/g, "-") + "-win")) yesIsHome = true;
      else if (slug.includes(a.replace(/\s/g, "-") + "-win")) yesIsHome = false;
      if (yesIsHome == null) continue;

      const bid = Number(poly.bestBid) || null;
      const ask = Number(poly.bestAsk) || null;
      const last = Number(poly.lastTradePrice) || null;
      const predProb = bid && ask ? (bid + ask) / 2 : last;

      const comp = buildComparison({
        source: "polymarket",
        marketId: poly.id || poly.slug,
        marketUrl: poly.slug ? `https://polymarket.com/event/${poly.slug}` : "https://polymarket.com",
        title: poly.question,
        sportLabel: SPORT_CONFIGS[game.sportKey]?.label || "Sports",
        sportKey: game.sportKey,
        game,
        yesIsHome,
        predProb,
        predBid: bid,
        predAsk: ask,
      });
      if (comp) matches.push(comp);
    }

    // Largest positive EV first, then by absolute edge so break-evens still sort sensibly.
    matches.sort((a, b) => {
      const evA = a.bestBet.evPercent, evB = b.bestBet.evPercent;
      if (evA !== evB) return evB - evA;
      return Math.abs(b.bestBet.edgePP) - Math.abs(a.bestBet.edgePP);
    });

    const payload = {
      matches,
      totalMatches: matches.length,
      counts: {
        kalshi: matches.filter(m => m.source === "kalshi").length,
        polymarket: matches.filter(m => m.source === "polymarket").length,
      },
      cachedAt: new Date().toISOString(),
    };

    if (redis) {
      try { await redis.setEx(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(payload)); } catch {}
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
