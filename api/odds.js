export default async function handler(req, res) {
  const API_KEY = process.env.ODDS_API_KEY;

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
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${API_KEY}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;
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

    // Aggressive caching: 1 hour fresh, serve stale for 1 more hour while revalidating
    // This means the Odds API only gets hit when Vercel's edge cache expires (~once/hour),
    // NOT on every user page load.
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=3600");
    return res.status(200).json({
      games: freshGames,
      requestsRemaining: remaining,
      requestsUsed: used,
      sportsQueried: sports.length,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
