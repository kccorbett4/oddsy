// Aggregates Kalshi + Polymarket sports markets into a single normalized
// feed. Both APIs are public / unauthenticated, so we proxy server-side
// mainly for CORS, caching, and shape normalization.
//
// Normalized market shape:
//   {
//     source: "kalshi" | "polymarket",
//     id, title, subtitle, sport, league, commenceTime, closeTime,
//     yesPrice, yesBid, yesAsk, volume, openInterest, url
//   }
//
// Prices are floats in [0,1] representing implied probability of YES.

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const POLY_BASE = "https://gamma-api.polymarket.com";

// Game-winner series we care about. Kalshi's catalog is enormous — we
// stick to the major US leagues for relevance. Season-aware: only fetch
// a series if it's currently in season (saves API round-trips).
const KALSHI_SERIES = [
  { ticker: "KXMLBGAME", sport: "MLB", seasonMonths: [2, 3, 4, 5, 6, 7, 8, 9] },
  { ticker: "KXNBAGAME", sport: "NBA", seasonMonths: [9, 10, 11, 0, 1, 2, 3, 4, 5] },
  { ticker: "KXNHLGAME", sport: "NHL", seasonMonths: [9, 10, 11, 0, 1, 2, 3, 4, 5] },
  { ticker: "KXNFLGAME", sport: "NFL", seasonMonths: [7, 8, 9, 10, 11, 0, 1] },
  { ticker: "KXWNBAGAME", sport: "WNBA", seasonMonths: [4, 5, 6, 7, 8, 9] },
  { ticker: "KXMLSGAME", sport: "MLS", seasonMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
];

async function fetchKalshiEventsWithMarkets(seriesTicker) {
  const url = `${KALSHI_BASE}/markets?limit=200&status=open&series_ticker=${seriesTicker}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const json = await r.json();
  return json.markets || [];
}

function normalizeKalshiMarket(m, sportLabel) {
  const bid = parseFloat(m.yes_bid_dollars || "0");
  const ask = parseFloat(m.yes_ask_dollars || "0");
  const last = parseFloat(m.last_price_dollars || "0");
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : (last || bid || ask || null);
  return {
    source: "kalshi",
    id: m.ticker,
    title: m.title || "",
    subtitle: m.yes_sub_title || "",
    sport: sportLabel,
    league: sportLabel,
    commenceTime: m.occurrence_datetime || null,
    closeTime: m.close_time || null,
    yesPrice: mid,
    yesBid: bid || null,
    yesAsk: ask || null,
    lastPrice: last || null,
    volume: m.volume || null,
    openInterest: parseFloat(m.open_interest_fp || "0") || null,
    liquidity: parseFloat(m.liquidity_dollars || "0") || null,
    url: `https://kalshi.com/markets/${m.ticker}`,
  };
}

async function fetchPolymarketSports() {
  // tag_id=1 = "Sports" on Polymarket's Gamma API. We pull the highest-
  // volume open markets, filter to ones closing in the next 7d, and sort.
  const url = `${POLY_BASE}/markets?limit=100&closed=false&active=true&tag_id=1&order=volume&ascending=false`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const arr = await r.json();
  return Array.isArray(arr) ? arr : [];
}

function normalizePolyMarket(m) {
  const bid = Number(m.bestBid) || null;
  const ask = Number(m.bestAsk) || null;
  const last = Number(m.lastTradePrice) || null;
  const mid = bid != null && ask != null && bid > 0 && ask > 0 ? (bid + ask) / 2 : last;
  // Polymarket doesn't hand back a clean league tag on gamma; we sniff it
  // from the slug or question text so the UI can group properly.
  const text = `${m.slug || ""} ${m.question || ""}`.toLowerCase();
  let sport = "Other";
  if (text.startsWith("mlb-") || /\bmlb\b/.test(text)) sport = "MLB";
  else if (text.startsWith("nba-") || /\bnba\b/.test(text)) sport = "NBA";
  else if (text.startsWith("nfl-") || /\bnfl\b/.test(text)) sport = "NFL";
  else if (text.startsWith("nhl-") || /\bnhl\b/.test(text)) sport = "NHL";
  else if (text.startsWith("wnba-") || /\bwnba\b/.test(text)) sport = "WNBA";
  else if (/\bufc\b|\bmma\b|\bfight\b|\bboxing\b/.test(text)) sport = "Fighting";
  else if (/\btennis|\batp\b|\bwta\b/.test(text)) sport = "Tennis";
  else if (/\bpga\b|\bgolf\b/.test(text)) sport = "Golf";
  else if (text.startsWith("codmw-") || /\besports?\b|\bcs2\b|\bdota\b|\bleague of legends\b/.test(text)) sport = "Esports";
  // Soccer catch-all: Polymarket's sports tag is soccer-heavy and its
  // slugs/questions use predictable patterns ("end in a draw", "O/U X",
  // "Spread: Team", "Will <club name> win"). Match anything that looks
  // like a soccer matchup before falling through to "Other".
  else if (
    /end in a draw/.test(text)
    || /\bspread:\s/.test(text)
    || /\bo\/u\s+\d/.test(text)
    || /\bboth teams to score\b/.test(text)
    || / win on \d{4}-\d{2}-\d{2}/.test(text)
    || /\b(fc|cf|ac|sc|afc|cfc|sv)\b/.test(text)
    || /\bsoccer|football|\bepl\b|\bmls\b|\bla liga\b|\bserie a\b|\bchampions league\b/.test(text)
  ) sport = "Soccer";

  const slug = m.slug || "";
  return {
    source: "polymarket",
    id: m.id || slug,
    title: m.question || "",
    subtitle: "",
    sport,
    league: sport,
    commenceTime: m.startDate || null,
    closeTime: m.endDate || null,
    yesPrice: mid,
    yesBid: bid,
    yesAsk: ask,
    lastPrice: last,
    volume: Number(m.volume) || null,
    openInterest: null,
    liquidity: Number(m.liquidity) || null,
    url: slug ? `https://polymarket.com/event/${slug}` : "https://polymarket.com",
  };
}

export default async function handler(req, res) {
  const source = (req.query?.source || "all").toString().toLowerCase();
  const now = new Date();
  const month = now.getMonth();

  try {
    const out = { markets: [], sources: {} };

    if (source === "all" || source === "kalshi") {
      const inSeason = KALSHI_SERIES.filter(s => s.seasonMonths.includes(month));
      const results = await Promise.all(
        inSeason.map(async s => ({ s, markets: await fetchKalshiEventsWithMarkets(s.ticker) }))
      );
      let kalshiCount = 0;
      // Only include Kalshi markets closing within the next 72h — beyond
      // that the book's still figuring out liquidity and it's mostly noise.
      const cutoff = now.getTime() + 72 * 3600 * 1000;
      for (const { s, markets } of results) {
        for (const m of markets) {
          const norm = normalizeKalshiMarket(m, s.sport);
          if (norm.yesBid == null && norm.yesAsk == null && !norm.lastPrice) continue;
          if (norm.closeTime && new Date(norm.closeTime).getTime() > cutoff) continue;
          out.markets.push(norm);
          kalshiCount++;
        }
      }
      out.sources.kalshi = { count: kalshiCount, series: inSeason.map(s => s.ticker) };
    }

    if (source === "all" || source === "polymarket") {
      const polyMarkets = await fetchPolymarketSports();
      let polyCount = 0;
      for (const m of polyMarkets) {
        const norm = normalizePolyMarket(m);
        if (norm.yesPrice == null) continue;
        // Filter out stale markets whose end date already passed.
        if (norm.closeTime && new Date(norm.closeTime).getTime() < now.getTime() - 3600 * 1000) continue;
        out.markets.push(norm);
        polyCount++;
      }
      out.sources.polymarket = { count: polyCount };
    }

    // Sort: upcoming first, then volume desc, then liquidity.
    out.markets.sort((a, b) => {
      const ta = a.closeTime ? new Date(a.closeTime).getTime() : Infinity;
      const tb = b.closeTime ? new Date(b.closeTime).getTime() : Infinity;
      if (ta !== tb) return ta - tb;
      return (b.volume || 0) - (a.volume || 0);
    });

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json({
      ...out,
      totalMarkets: out.markets.length,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
