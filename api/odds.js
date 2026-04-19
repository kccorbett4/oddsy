// Odds provider is env-toggleable so we can fall back to The Odds API if the
// new one misbehaves. Flip ODDS_PROVIDER=theoddsapi in Vercel to revert.
const PROVIDER = (process.env.ODDS_PROVIDER || "parlay").toLowerCase();

function buildOddsUrl(sport, { apiKey, regions, markets, oddsFormat }) {
  if (PROVIDER === "theoddsapi") {
    return `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;
  }
  return `https://parlay-api.com/v1/sports/${sport}/odds?apiKey=${apiKey}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;
}

export default async function handler(req, res) {
  const API_KEY = PROVIDER === "theoddsapi"
    ? process.env.ODDS_API_KEY
    : (process.env.PARLAY_API_KEY || process.env.ODDS_API_KEY);

  if (!API_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  const markets = req.query.markets || "h2h,spreads,totals";
  // US books only: us + us2 covers DK, FD, BetMGM, Caesars, BetRivers,
  // Fanatics, Hard Rock, ESPN Bet, PrizePicks, Underdog, Kalshi, Polymarket.
  // Override via ?regions= to reach UK/EU/AU books at 2.5× the credit cost.
  const regions = req.query.regions || "us,us2";
  const oddsFormat = "american";

  // Curated list of the most popular US-market sports. Seasonal filter
  // keeps us from querying leagues that have no events (wasted credits).
  const now = new Date();
  const month = now.getMonth();

  const sports = [];
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

  try {
    const allGames = [];
    let remaining = null;
    let used = null;

    for (const sport of sports) {
      const url = buildOddsUrl(sport, { apiKey: API_KEY, regions, markets, oddsFormat });
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

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=900");
    return res.status(200).json({
      games: freshGames,
      requestsRemaining: remaining,
      requestsUsed: used,
      sportsQueried: sports.length,
      regions,
      markets,
      provider: PROVIDER,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
