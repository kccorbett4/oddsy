// Closing-lines endpoint — thin wrapper around parlay-api's
// /v1/sports/{sport}/closing-lines. Closing lines are the final odds
// before a game locks; comparing our pick price to the closing line
// gives us CLV (closing line value), the sharpest leading indicator
// of long-run profitability.
//
// This endpoint is parlay-api only — The Odds API doesn't publish a
// closing-line feed. If ODDS_PROVIDER=theoddsapi we return 501.

const PROVIDER = (process.env.ODDS_PROVIDER || "parlay").toLowerCase();

export default async function handler(req, res) {
  if (PROVIDER !== "parlay") {
    return res.status(501).json({
      error: "closing-lines is only available on provider=parlay",
      provider: PROVIDER,
    });
  }
  const API_KEY = process.env.PARLAY_API_KEY || process.env.ODDS_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured" });

  const sport = (req.query?.sport || "baseball_mlb").toString();
  const regions = (req.query?.regions || "us,us2").toString();
  const markets = (req.query?.markets || "h2h,spreads,totals").toString();

  const url = `https://parlay-api.com/v1/sports/${encodeURIComponent(sport)}/closing-lines`
    + `?apiKey=${API_KEY}&regions=${regions}&markets=${markets}&oddsFormat=american`;

  try {
    const r = await fetch(url);
    const remaining = r.headers.get("x-requests-remaining");
    const used = r.headers.get("x-requests-used");
    if (!r.ok) {
      return res.status(r.status).json({
        error: `closing-lines returned ${r.status}`,
        body: await r.text(),
        creditsRemaining: remaining, creditsUsed: used,
      });
    }
    const data = await r.json();
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=3600");
    return res.status(200).json({
      sport, regions, markets,
      provider: "parlay",
      creditsRemaining: remaining, creditsUsed: used,
      data,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
