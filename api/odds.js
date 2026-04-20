// Odds provider is env-toggleable so we can fall back to The Odds API if the
// new one misbehaves. Flip ODDS_PROVIDER=theoddsapi in Vercel to revert.
// A per-request ?provider=theoddsapi|parlay query override also exists so we
// can A/B-compare without redeploying.
const DEFAULT_PROVIDER = (process.env.ODDS_PROVIDER || "parlay").toLowerCase();

function buildOddsUrl(provider, sport, { apiKey, regions, markets, oddsFormat }) {
  if (provider === "theoddsapi") {
    return `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;
  }
  return `https://parlay-api.com/v1/sports/${sport}/odds?apiKey=${apiKey}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;
}

export default async function handler(req, res) {
  // Per-request provider override — lets us hit both APIs from the browser
  // with the same base handler so comparisons are apples-to-apples.
  const provider = (req.query.provider || DEFAULT_PROVIDER).toLowerCase();

  const API_KEY = provider === "theoddsapi"
    ? process.env.ODDS_API_KEY
    : (process.env.PARLAY_API_KEY || process.env.ODDS_API_KEY);

  if (!API_KEY) {
    return res.status(500).json({ error: `API key for provider "${provider}" not configured` });
  }

  const markets = req.query.markets || "h2h,spreads,totals";
  // us+us2 = US retail; eu adds Pinnacle (sharp anchor for fair-value math).
  // EU books aren't bettable by US users, but their prices sharpen the median.
  const regions = req.query.regions || "us,us2,eu";
  const oddsFormat = "american";

  // Curated list of the most popular US-market sports. Seasonal filter
  // keeps us from querying leagues that have no events (wasted credits).
  // Per-request ?sports=csv override lets comparison calls target a single
  // sport (e.g. ?sports=baseball_mlb) so credit usage stays predictable.
  let sports;
  if (req.query.sports) {
    sports = String(req.query.sports).split(",").map(s => s.trim()).filter(Boolean);
  } else {
    const now = new Date();
    const month = now.getMonth();
    sports = [];
    if (month >= 9 || month <= 5) sports.push("basketball_nba");
    if (month >= 9 || month <= 5) sports.push("icehockey_nhl");
    if (month >= 2 && month <= 9) sports.push("baseball_mlb");
    if (month >= 8 || month <= 1) sports.push("americanfootball_nfl");
    if (month >= 7 || month === 0) sports.push("americanfootball_ncaaf");
    if (month >= 10 || month <= 3) sports.push("basketball_ncaab");
    if (month >= 1 && month <= 10) sports.push("soccer_usa_mls");
    // Year-round combat sports + golf + tennis (major tours)
    sports.push("mma_mixed_martial_arts");
    sports.push("boxing_boxing");
    sports.push("tennis_atp");
    sports.push("tennis_wta");
    sports.push("golf_pga_championship_winner");
  }

  try {
    const allGames = [];
    let remaining = null;
    let used = null;

    for (const sport of sports) {
      const url = buildOddsUrl(provider, sport, { apiKey: API_KEY, regions, markets, oddsFormat });
      const response = await fetch(url);

      remaining = response.headers.get("x-requests-remaining") || remaining;
      used = response.headers.get("x-requests-used") || used;

      if (response.ok) {
        const data = await response.json();
        allGames.push(...(Array.isArray(data) ? data : []));
      }
    }

    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const freshGames = allGames.filter(g => g.commence_time > sixHoursAgo || !g.commence_time);

    // Strip state-specific Hard Rock feeds — they're only bettable from that
    // state and duplicate the nationwide `hardrockbet` line. Keeping them in
    // the book list just skews cross-book consensus for no upside.
    const STATE_SPECIFIC_BOOKS = new Set([
      "hardrockbet_az", "hardrockbet_fl", "hardrockbet_oh",
    ]);
    // Books US bettors can actually place wagers at. Regulated retail + a few
    // offshore/sweepstakes books that accept US deposits. Everything outside
    // this set (Pinnacle, 1xBet, UK/EU retail) is kept for fair-value math
    // but hidden from "place this bet" links.
    const US_BETTABLE_BOOKS = new Set([
      "draftkings", "fanduel", "betmgm", "caesars", "betrivers", "fanatics",
      "hardrockbet", "espnbet", "ballybet", "betparx", "williamhill_us",
      "fliff", "rebet", "bovada", "betonlineag", "mybookieag", "betus",
      "lowvig", "betanysports", "gtbets", "everygame",
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
      sportsQueried: sports.length,
      sportsList: sports,
      regions,
      markets,
      provider,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
