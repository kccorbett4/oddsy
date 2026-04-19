// Arbitrage endpoint — thin wrapper around parlay-api's
// /v1/sports/{sport}/arbitrage, which returns pre-computed
// guaranteed-profit opportunities across books.
//
// 10 credits/call, so we cap the default sport list and let the
// frontend request one sport at a time once the user picks.
// Pass ?debug=1 to return the raw upstream response for shape probing.

const ALL_SPORTS = [
  "baseball_mlb",
  "basketball_nba",
  "basketball_ncaab",
  "americanfootball_nfl",
  "americanfootball_ncaaf",
  "icehockey_nhl",
  "soccer_usa_mls",
  "mma_mixed_martial_arts",
  "boxing_boxing",
  "tennis_atp",
  "tennis_wta",
];

function seasonalSports() {
  const month = new Date().getMonth();
  const on = new Set();
  if (month >= 9 || month <= 5) { on.add("basketball_nba"); on.add("icehockey_nhl"); }
  if (month >= 2 && month <= 9) on.add("baseball_mlb");
  if (month >= 8 || month <= 1) on.add("americanfootball_nfl");
  if (month >= 7 || month === 0) on.add("americanfootball_ncaaf");
  if (month >= 10 || month <= 3) on.add("basketball_ncaab");
  if (month >= 1 && month <= 10) on.add("soccer_usa_mls");
  on.add("mma_mixed_martial_arts");
  on.add("boxing_boxing");
  on.add("tennis_atp");
  on.add("tennis_wta");
  return ALL_SPORTS.filter(s => on.has(s));
}

async function fetchSportArb(sport, apiKey, regions) {
  const url = `https://parlay-api.com/v1/sports/${encodeURIComponent(sport)}/arbitrage`
    + `?apiKey=${apiKey}&regions=${regions}&oddsFormat=american`;
  const r = await fetch(url);
  const remaining = r.headers.get("x-requests-remaining");
  const used = r.headers.get("x-requests-used");
  if (!r.ok) {
    return { sport, ok: false, status: r.status, body: await r.text(), remaining, used };
  }
  const data = await r.json();
  return { sport, ok: true, data, remaining, used };
}

export default async function handler(req, res) {
  const API_KEY = process.env.PARLAY_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "PARLAY_API_KEY not configured" });

  const regions = (req.query?.regions || "us,us2").toString();
  const reqSport = (req.query?.sport || "").toString().trim();
  const debug = req.query?.debug === "1";

  const sports = reqSport ? [reqSport] : seasonalSports();

  try {
    const results = await Promise.all(sports.map(s => fetchSportArb(s, API_KEY, regions)));

    if (debug) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ sports, regions, results });
    }

    const opportunities = [];
    let creditsRemaining = null;
    let creditsUsed = null;
    for (const r of results) {
      creditsRemaining = r.remaining || creditsRemaining;
      creditsUsed = r.used || creditsUsed;
      if (!r.ok) continue;
      const list = Array.isArray(r.data) ? r.data
        : Array.isArray(r.data?.arbitrage) ? r.data.arbitrage
        : Array.isArray(r.data?.opportunities) ? r.data.opportunities
        : Array.isArray(r.data?.data) ? r.data.data
        : [];
      for (const item of list) opportunities.push({ sport: r.sport, ...item });
    }

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=120");
    return res.status(200).json({
      opportunities,
      sportsQueried: sports,
      regions,
      creditsRemaining,
      creditsUsed,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
