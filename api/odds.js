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
  const regions = "us";
  const oddsFormat = "american";

  // Only fetch sports currently in season to save API credits
  // Each sport = 1 API request. Update this list seasonally.
  const now = new Date();
  const month = now.getMonth(); // 0-indexed: 0=Jan, 3=Apr, 8=Sep

  const sports = [];

  // NBA: Oct (9) - Jun (5)
  if (month >= 9 || month <= 5) sports.push("basketball_nba");
  // NHL: Oct (9) - Jun (5)
  if (month >= 9 || month <= 5) sports.push("icehockey_nhl");
  // MLB: Mar (2) - Oct (9)
  if (month >= 2 && month <= 9) sports.push("baseball_mlb");
  // NFL: Sep (8) - Feb (1)
  if (month >= 8 || month <= 1) sports.push("americanfootball_nfl");
  // NCAAF: Aug (7) - Jan (0)
  if (month >= 7 || month === 0) sports.push("americanfootball_ncaaf");
  // NCAAB: Nov (10) - Apr (3)
  if (month >= 10 || month <= 3) sports.push("basketball_ncaab");
  // MLS: Feb (1) - Nov (10)
  if (month >= 1 && month <= 10) sports.push("soccer_usa_mls");
  // MMA: year-round
  sports.push("mma_mixed_martial_arts");

  try {
    const allGames = [];
    let remaining = null;
    let used = null;

    for (const sport of sports) {
      const url = buildOddsUrl(sport, { apiKey: API_KEY, regions, markets, oddsFormat });
      const response = await fetch(url);

      remaining = response.headers.get("x-requests-remaining");
      used = response.headers.get("x-requests-used");

      if (response.ok) {
        const data = await response.json();
        allGames.push(...data);
      }
      // If a sport has no events (404), just skip it
    }

    // Filter out games that started more than 6 hours ago
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const freshGames = allGames.filter(g => g.commence_time > sixHoursAgo || !g.commence_time);

    // Cache for 15 min fresh, serve stale for 15 more min while revalidating.
    // Odds API gets hit ~once per 15 min by Vercel CDN, not per visitor.
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=900");
    return res.status(200).json({
      games: freshGames,
      requestsRemaining: remaining,
      requestsUsed: used,
      sportsQueried: sports.length,
      provider: PROVIDER,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
