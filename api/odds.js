export default async function handler(req, res) {
  const API_KEY = process.env.ODDS_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  const sport = req.query.sport || "upcoming";
  const markets = req.query.markets || "h2h,spreads,totals";
  const regions = "us";
  const oddsFormat = "american";

  try {
    let url;
    if (sport === "upcoming") {
      url = `https://api.the-odds-api.com/v4/sports/odds/?apiKey=${API_KEY}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;
    } else {
      url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${API_KEY}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }

    const data = await response.json();

    // Pass along rate limit info from The-Odds API
    const remaining = response.headers.get("x-requests-remaining");
    const used = response.headers.get("x-requests-used");

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");
    return res.status(200).json({
      games: data,
      requestsRemaining: remaining,
      requestsUsed: used,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
