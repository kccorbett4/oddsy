// Odds handler unions two providers so we get the deepest possible slate
// plus the widest book set. The Odds API is primary — its US retail coverage
// (BetMGM, BetRivers, Fanatics, ESPN BET, Hard Rock, etc.) is strictly
// broader than parlay-api's. parlay-api supplements with (a) games theoddsapi
// doesn't surface (roughly 2.8x deeper MLB slate at time of writing) and
// (b) US-bettable exchange/sweepstakes books theoddsapi doesn't carry
// (novig, prophetx).
//
// Override with ?provider=theoddsapi|parlay|merged to scope the response
// to a single source for A/B comparison.

const DEFAULT_PROVIDER = (process.env.ODDS_PROVIDER || "merged").toLowerCase();

// parlay-api uses slightly different sport keys for tour-wide tennis/golf
// (they track specific tournaments instead of the tour). MLS isn't covered.
const PARLAY_SPORT_MAP = {
  tennis_atp: "tennis_atp_french_open",
  tennis_wta: "tennis_wta_french_open",
  golf_pga_championship_winner: "golf_pga_championship",
};
const PARLAY_SKIP = new Set(["soccer_usa_mls"]);

// parlay-api names ESPN BET "espn_draftkings" (Penn's ESPN BET runs on DK
// infrastructure). Map to the canonical theoddsapi key so dedup works. The
// `_-_live_odds` variant is a live-odds duplicate — drop it since we run
// pre-game only.
const PARLAY_KEY_NORMALIZATION = {
  espn_draftkings: "espnbet",
  "espn_draftkings_-_live_odds": null,
};

function theOddsApiUrl(sport, { apiKey, regions, markets, oddsFormat }) {
  return `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;
}

function parlayApiUrl(sport, { apiKey, regions, markets, oddsFormat }) {
  const mapped = PARLAY_SPORT_MAP[sport] || sport;
  return `https://parlay-api.com/v1/sports/${mapped}/odds?apiKey=${apiKey}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;
}

async function fetchProvider(url) {
  try {
    const r = await fetch(url);
    const remaining = r.headers.get("x-requests-remaining");
    const used = r.headers.get("x-requests-used");
    if (!r.ok) return { games: [], remaining, used };
    const data = await r.json();
    return { games: Array.isArray(data) ? data : [], remaining, used };
  } catch {
    return { games: [], remaining: null, used: null };
  }
}

// Canonical key for matching the same game across providers. Home/away
// team name normalization + minute-rounded commence time handles the
// usual casing/whitespace drift.
function gameKey(g) {
  const clean = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const commence = String(g.commence_time || "").slice(0, 16); // YYYY-MM-DDTHH:MM
  return `${g.sport_key}|${clean(g.home_team)}|${clean(g.away_team)}|${commence}`;
}

// Merge parlay bookmakers into a theoddsapi game, adding only books
// theoddsapi didn't supply (after normalizing parlay's key names).
function mergeBookmakers(target, parlayBookmakers) {
  const existing = new Set((target.bookmakers || []).map(b => b.key));
  for (const b of parlayBookmakers || []) {
    const norm = PARLAY_KEY_NORMALIZATION[b.key];
    const key = norm === null ? null : (norm || b.key);
    if (!key) continue;
    if (existing.has(key)) continue;
    target.bookmakers.push({ ...b, key });
    existing.add(key);
  }
}

function mergeGames(oddsApiGames, parlayGames) {
  const byKey = new Map();
  for (const g of oddsApiGames) {
    byKey.set(gameKey(g), { ...g, bookmakers: [...(g.bookmakers || [])] });
  }
  for (const pg of parlayGames) {
    const k = gameKey(pg);
    const existing = byKey.get(k);
    if (existing) {
      mergeBookmakers(existing, pg.bookmakers);
    } else {
      // parlay-only game — normalize its book keys before inserting.
      const bookmakers = [];
      for (const b of pg.bookmakers || []) {
        const norm = PARLAY_KEY_NORMALIZATION[b.key];
        const key = norm === null ? null : (norm || b.key);
        if (!key) continue;
        bookmakers.push({ ...b, key });
      }
      byKey.set(k, { ...pg, bookmakers });
    }
  }
  return [...byKey.values()];
}

export default async function handler(req, res) {
  const provider = (req.query.provider || DEFAULT_PROVIDER).toLowerCase();

  const ODDS_KEY = process.env.ODDS_API_KEY;
  const PARLAY_KEY = process.env.PARLAY_API_KEY;

  if (provider === "theoddsapi" && !ODDS_KEY) {
    return res.status(500).json({ error: "ODDS_API_KEY not configured" });
  }
  if (provider === "parlay" && !PARLAY_KEY) {
    return res.status(500).json({ error: "PARLAY_API_KEY not configured" });
  }
  if (provider === "merged" && !ODDS_KEY && !PARLAY_KEY) {
    return res.status(500).json({ error: "Neither ODDS_API_KEY nor PARLAY_API_KEY configured" });
  }

  const markets = req.query.markets || "h2h,spreads,totals";
  const regions = req.query.regions || "us,us2,eu";
  const oddsFormat = "american";

  // Seasonal sport list. Soccer-wise we pick a few leagues that are in their
  // active months so users always have something beyond the US majors. MLS
  // is domestic; the UEFA tournaments and top European leagues carry through
  // the NHL/NBA offseason lull, keeping the slate deep year-round.
  let sports;
  if (req.query.sports) {
    sports = String(req.query.sports).split(",").map(s => s.trim()).filter(Boolean);
  } else {
    const month = new Date().getMonth();
    sports = [];
    if (month >= 9 || month <= 5) sports.push("basketball_nba");
    if (month >= 9 || month <= 5) sports.push("icehockey_nhl");
    if (month >= 2 && month <= 9) sports.push("baseball_mlb");
    if (month >= 8 || month <= 1) sports.push("americanfootball_nfl");
    if (month >= 7 || month === 0) sports.push("americanfootball_ncaaf");
    if (month >= 10 || month <= 3) sports.push("basketball_ncaab");
    if (month >= 1 && month <= 10) sports.push("soccer_usa_mls");
    // Soccer: US-popular only. Premier League + UEFA tournaments run Aug–May;
    // those are the ones Americans actually watch. Skipping La Liga / Serie A
    // / Bundesliga / Ligue 1 / Liga MX / South American leagues — they burn
    // credits without adding slate value for this audience.
    if (month >= 7 || month <= 4) {
      sports.push("soccer_epl");
      sports.push("soccer_uefa_champs_league");
      sports.push("soccer_uefa_europa_league");
    }
    // Year-round combat sports + golf + tennis (major tours).
    sports.push("mma_mixed_martial_arts");
    sports.push("boxing_boxing");
    sports.push("tennis_atp");
    sports.push("tennis_wta");
    sports.push("golf_pga_championship_winner");
    // WNBA runs May–Oct.
    if (month >= 4 && month <= 9) sports.push("basketball_wnba");
  }

  try {
    // Fetch every sport in parallel from both providers. theoddsapi stays
    // primary; parlay is strictly additive. If either key is missing or a
    // call fails, we degrade to whichever source still worked.
    const wantTheOdds = (provider === "theoddsapi" || provider === "merged") && ODDS_KEY;
    const wantParlay = (provider === "parlay" || provider === "merged") && PARLAY_KEY;

    const fetches = [];
    for (const sport of sports) {
      if (wantTheOdds) {
        fetches.push(
          fetchProvider(theOddsApiUrl(sport, { apiKey: ODDS_KEY, regions, markets, oddsFormat }))
            .then(r => ({ source: "theoddsapi", sport, ...r }))
        );
      }
      if (wantParlay && !PARLAY_SKIP.has(sport)) {
        fetches.push(
          fetchProvider(parlayApiUrl(sport, { apiKey: PARLAY_KEY, regions, markets, oddsFormat }))
            .then(r => ({ source: "parlay", sport, ...r }))
        );
      }
    }

    const results = await Promise.all(fetches);

    const oddsApiGames = [];
    const parlayGames = [];
    let remaining = null, used = null;
    let parlayRemaining = null, parlayUsed = null;
    for (const r of results) {
      if (r.source === "theoddsapi") {
        oddsApiGames.push(...r.games);
        remaining = r.remaining || remaining;
        used = r.used || used;
      } else {
        parlayGames.push(...r.games);
        parlayRemaining = r.remaining || parlayRemaining;
        parlayUsed = r.used || parlayUsed;
      }
    }

    const merged = mergeGames(oddsApiGames, parlayGames);

    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const freshGames = merged.filter(g => g.commence_time > sixHoursAgo || !g.commence_time);

    // Strip state-specific Hard Rock feeds — they duplicate the nationwide
    // `hardrockbet` line and skew consensus.
    const STATE_SPECIFIC_BOOKS = new Set([
      "hardrockbet_az", "hardrockbet_fl", "hardrockbet_oh",
    ]);
    // Books US bettors can actually deposit at. Regulated retail + offshore
    // + US-legal exchanges/sweepstakes (novig, prophetx come in via parlay).
    // Books outside this set (Pinnacle, 1xBet, UK/EU retail) stay in the
    // feed for fair-value math but get filtered from "place this bet" UI.
    const US_BETTABLE_BOOKS = new Set([
      "draftkings", "fanduel", "betmgm", "caesars", "betrivers", "fanatics",
      "hardrockbet", "espnbet", "ballybet", "betparx", "williamhill_us",
      "fliff", "rebet", "bovada", "betonlineag", "mybookieag", "betus",
      "lowvig", "betanysports", "gtbets", "everygame",
      "novig", "prophetx",
    ]);
    for (const g of freshGames) {
      if (Array.isArray(g.bookmakers)) {
        g.bookmakers = g.bookmakers
          .filter(b => !STATE_SPECIFIC_BOOKS.has(b.key))
          .map(b => ({ ...b, bettable: US_BETTABLE_BOOKS.has(b.key) }));
      }
    }

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=900");
    return res.status(200).json({
      games: freshGames,
      requestsRemaining: remaining,
      requestsUsed: used,
      parlayRequestsRemaining: parlayRemaining,
      parlayRequestsUsed: parlayUsed,
      sportsQueried: sports.length,
      sportsList: sports,
      regions,
      markets,
      provider,
      providersUsed: [wantTheOdds && "theoddsapi", wantParlay && "parlay"].filter(Boolean),
      oddsApiGameCount: oddsApiGames.length,
      parlayGameCount: parlayGames.length,
      mergedGameCount: freshGames.length,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
