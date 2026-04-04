export default async function handler(req, res) {
  const API_KEY = process.env.ODDS_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  const markets = req.query.markets || "h2h,spreads,totals";
  const regions = "us";
  const oddsFormat = "american";

  const sports = [
    "basketball_nba",
    "americanfootball_nfl",
    "baseball_mlb",
    "icehockey_nhl",
    "mma_mixed_martial_arts",
  ];

  try {
    const allGames = [];
    let remaining = null;
    let used = null;

    // Fetch each sport (each counts as 1 API request)
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

    // Cache for 15 minutes on Vercel's edge, serve stale for 10 more min while revalidating
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=600");
    return res.status(200).json({
      games: allGames,
      requestsRemaining: remaining,
      requestsUsed: used,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
