// Arbitrage endpoint. Two sources, merged:
//   1. Computed locally from The Odds API's h2h/spreads/totals feed —
//      compare best price per outcome across books, flag when implied
//      probs sum to < 100%. Runs on every call since it's our own compute.
//   2. parlay-api's pre-computed /arbitrage endpoint — richer cross-market
//      coverage (props, cross-sport), but burns 10 credits/sport and is
//      often 403-credit-exhausted. Treated as additive; failures are silent.
//
// Merged output is deduped by canonical event id + market + both sides,
// cached in Redis for 30 min, and served stale on total upstream failure.
// Pass ?debug=1 to see raw source breakdown and ?sport=baseball_mlb to
// restrict to a single league.

import { getRedis } from "./_redis.js";

const CACHE_TTL_SECONDS = 30 * 60;
const ODDS_BASE = "https://api.the-odds-api.com/v4";

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

const americanToDecimal = (a) => {
  if (!Number.isFinite(a)) return null;
  return a >= 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
};

// Two American prices form an arb when their implied probabilities sum to
// < 1. Returned profit_pct is the guaranteed return on total bankroll
// (e.g. 2.5 means +2.5% on money in play, split optimally across sides).
function checkArb(priceA, priceB) {
  const dA = americanToDecimal(priceA);
  const dB = americanToDecimal(priceB);
  if (!Number.isFinite(dA) || !Number.isFinite(dB) || dA <= 1 || dB <= 1) return null;
  const sum = 1 / dA + 1 / dB;
  if (sum >= 1) return null;
  return { profitPct: +((1 - sum) * 100).toFixed(3) };
}

function pointLabel(n) {
  if (!Number.isFinite(n)) return "";
  return n > 0 ? `+${n}` : `${n}`;
}

// ───────────────── computed arbs from The Odds API ─────────────────

async function fetchOddsForSport(sport, apiKey, regions) {
  const url = `${ODDS_BASE}/sports/${sport}/odds`
    + `?apiKey=${apiKey}&regions=${regions}&markets=h2h,spreads,totals&oddsFormat=american`;
  const r = await fetch(url);
  const remaining = r.headers.get("x-requests-remaining");
  const used = r.headers.get("x-requests-used");
  if (!r.ok) {
    return { sport, ok: false, status: r.status, body: await r.text().catch(() => ""), remaining, used };
  }
  const data = await r.json().catch(() => []);
  return { sport, ok: true, games: Array.isArray(data) ? data : [], remaining, used };
}

function computeArbsForEvent(ev, sport) {
  const out = [];
  const eventId = ev.id || `${sport}-${ev.home_team}-${ev.away_team}-${ev.commence_time}`;
  const baseRow = {
    sport,
    canonical_event_id: eventId,
    home_team: ev.home_team,
    away_team: ev.away_team,
    game_date: ev.commence_time,
    source: "computed",
  };

  // ── h2h ──
  let bestHome = null, bestAway = null;
  for (const b of ev.bookmakers || []) {
    const m = (b.markets || []).find(x => x.key === "h2h");
    if (!m) continue;
    for (const o of m.outcomes || []) {
      if (!Number.isFinite(o.price)) continue;
      if (o.name === ev.home_team) {
        if (!bestHome || o.price > bestHome.price) bestHome = { book: b.title, key: b.key, price: o.price };
      } else if (o.name === ev.away_team) {
        if (!bestAway || o.price > bestAway.price) bestAway = { book: b.title, key: b.key, price: o.price };
      }
    }
  }
  if (bestHome && bestAway && bestHome.key !== bestAway.key) {
    const arb = checkArb(bestHome.price, bestAway.price);
    if (arb) {
      out.push({
        ...baseRow,
        market_key: "h2h",
        market: "Moneyline",
        profit_pct: arb.profitPct,
        side_a: { bookmaker: bestAway.book, bet: ev.away_team, odds: bestAway.price },
        side_b: { bookmaker: bestHome.book, bet: ev.home_team, odds: bestHome.price },
      });
    }
  }

  // ── totals: best Over vs best Under at each point ──
  const totalsByPt = {};
  for (const b of ev.bookmakers || []) {
    const m = (b.markets || []).find(x => x.key === "totals");
    if (!m) continue;
    for (const o of m.outcomes || []) {
      if (!Number.isFinite(o.price) || !Number.isFinite(o.point)) continue;
      const side = o.name === "Over" ? "over" : o.name === "Under" ? "under" : null;
      if (!side) continue;
      const slot = (totalsByPt[o.point] ||= { over: null, under: null });
      if (!slot[side] || o.price > slot[side].price) {
        slot[side] = { book: b.title, key: b.key, price: o.price };
      }
    }
  }
  for (const [pt, pair] of Object.entries(totalsByPt)) {
    if (!pair.over || !pair.under || pair.over.key === pair.under.key) continue;
    const arb = checkArb(pair.over.price, pair.under.price);
    if (!arb) continue;
    out.push({
      ...baseRow,
      market_key: `totals:${pt}`,
      market: `Total ${pt}`,
      profit_pct: arb.profitPct,
      side_a: { bookmaker: pair.over.book, bet: `Over ${pt}`, odds: pair.over.price },
      side_b: { bookmaker: pair.under.book, bet: `Under ${pt}`, odds: pair.under.price },
    });
  }

  // ── spreads: home@P arbs with away@-P (same absolute handicap,
  // opposite sign = complementary outcomes). Iterate every point value
  // since home-fav and home-dog spread arbs are distinct bets.
  const byPt = {};
  for (const b of ev.bookmakers || []) {
    const m = (b.markets || []).find(x => x.key === "spreads");
    if (!m) continue;
    for (const o of m.outcomes || []) {
      if (!Number.isFinite(o.price) || !Number.isFinite(o.point)) continue;
      const side = o.name === ev.home_team ? "home" : o.name === ev.away_team ? "away" : null;
      if (!side) continue;
      const slot = (byPt[o.point] ||= {});
      if (!slot[side] || o.price > slot[side].price) {
        slot[side] = { book: b.title, key: b.key, price: o.price, point: o.point };
      }
    }
  }
  for (const [ptStr, sides] of Object.entries(byPt)) {
    const pt = parseFloat(ptStr);
    if (pt === 0) continue; // pick'em — duplicates h2h
    if (!sides.home) continue;
    const opp = byPt[-pt];
    if (!opp?.away) continue;
    if (sides.home.key === opp.away.key) continue;
    const arb = checkArb(sides.home.price, opp.away.price);
    if (!arb) continue;
    out.push({
      ...baseRow,
      market_key: `spreads:home:${pt}`,
      market: `Spread ${Math.abs(pt)}`,
      profit_pct: arb.profitPct,
      side_a: { bookmaker: sides.home.book, bet: `${ev.home_team} ${pointLabel(pt)}`, odds: sides.home.price },
      side_b: { bookmaker: opp.away.book, bet: `${ev.away_team} ${pointLabel(-pt)}`, odds: opp.away.price },
    });
  }

  return out;
}

async function fetchComputedArbs(sports, apiKey, regions) {
  const results = await Promise.all(sports.map(s => fetchOddsForSport(s, apiKey, regions)));
  const arbs = [];
  let remaining = null, used = null;
  const errors = [];
  let anyOk = false;
  for (const r of results) {
    remaining = r.remaining || remaining;
    used = r.used || used;
    if (!r.ok) {
      errors.push({ sport: r.sport, status: r.status, body: r.body });
      continue;
    }
    anyOk = true;
    for (const ev of r.games) arbs.push(...computeArbsForEvent(ev, r.sport));
  }
  return { arbs, remaining, used, errors, anyOk };
}

// ───────────────── parlay-api fallback source ─────────────────

async function fetchParlayArb(sport, apiKey, regions) {
  const url = `https://parlay-api.com/v1/sports/${encodeURIComponent(sport)}/arbitrage`
    + `?apiKey=${apiKey}&regions=${regions}&oddsFormat=american`;
  const r = await fetch(url);
  const remaining = r.headers.get("x-requests-remaining");
  const used = r.headers.get("x-requests-used");
  if (!r.ok) {
    return { sport, ok: false, status: r.status, body: await r.text().catch(() => ""), remaining, used };
  }
  const data = await r.json().catch(() => null);
  return { sport, ok: true, data, remaining, used };
}

async function fetchParlayArbs(sports, apiKey, regions) {
  if (!apiKey) return { arbs: [], remaining: null, used: null, errors: [], anyOk: false, anyCall: false };
  const results = await Promise.all(sports.map(s => fetchParlayArb(s, apiKey, regions)));
  const arbs = [];
  let remaining = null, used = null;
  const errors = [];
  let anyOk = false;
  for (const r of results) {
    remaining = r.remaining || remaining;
    used = r.used || used;
    if (!r.ok) {
      errors.push({ sport: r.sport, status: r.status, body: r.body });
      continue;
    }
    anyOk = true;
    const list = Array.isArray(r.data) ? r.data
      : Array.isArray(r.data?.arbitrage) ? r.data.arbitrage
      : Array.isArray(r.data?.opportunities) ? r.data.opportunities
      : Array.isArray(r.data?.data) ? r.data.data
      : [];
    for (const item of list) arbs.push({ sport: r.sport, source: "parlay-api", ...item });
  }
  return { arbs, remaining, used, errors, anyOk, anyCall: true };
}

// ───────────────── merge & dedup ─────────────────

function sigOf(o) {
  const a = [o.side_a?.bookmaker, o.side_a?.bet, o.side_a?.odds].join("|");
  const b = [o.side_b?.bookmaker, o.side_b?.bet, o.side_b?.odds].join("|");
  const sides = [a, b].sort().join("::");
  return `${o.canonical_event_id}|${o.market_key}|${sides}`;
}

function mergeArbs(computed, external) {
  const seen = new Set();
  const out = [];
  for (const list of [computed, external]) {
    for (const o of list) {
      const s = sigOf(o);
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(o);
    }
  }
  return out;
}

// ───────────────── handler ─────────────────

export default async function handler(req, res) {
  const ODDS_KEY = process.env.ODDS_API_KEY;
  const PARLAY_KEY = process.env.PARLAY_API_KEY;

  if (!ODDS_KEY && !PARLAY_KEY) {
    return res.status(500).json({ error: "Neither ODDS_API_KEY nor PARLAY_API_KEY configured" });
  }

  const regions = (req.query?.regions || "us,us2").toString();
  const reqSport = (req.query?.sport || "").toString().trim();
  const debug = req.query?.debug === "1";
  const sports = reqSport ? [reqSport] : seasonalSports();
  const cacheKey = `arb:v2:${sports.join(",")}:${regions}`;

  try {
    const [computedRes, parlayRes] = await Promise.all([
      ODDS_KEY ? fetchComputedArbs(sports, ODDS_KEY, regions)
               : Promise.resolve({ arbs: [], remaining: null, used: null, errors: [], anyOk: false }),
      PARLAY_KEY ? fetchParlayArbs(sports, PARLAY_KEY, regions)
                 : Promise.resolve({ arbs: [], remaining: null, used: null, errors: [], anyOk: false, anyCall: false }),
    ]);

    if (debug) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        sports, regions,
        computed: {
          count: computedRes.arbs.length,
          remaining: computedRes.remaining,
          used: computedRes.used,
          errors: computedRes.errors,
          sample: computedRes.arbs.slice(0, 3),
        },
        parlay: {
          count: parlayRes.arbs.length,
          remaining: parlayRes.remaining,
          used: parlayRes.used,
          errors: parlayRes.errors,
          anyCall: parlayRes.anyCall,
        },
      });
    }

    const opportunities = mergeArbs(computedRes.arbs, parlayRes.arbs)
      .sort((a, b) => (b.profit_pct || 0) - (a.profit_pct || 0));

    const redis = await getRedis().catch(() => null);

    // Both sources failed — fall back to last cached payload so the page
    // isn't empty. Message distinguishes credit-exhaustion from network
    // failure so users know whether to wait or nudge us.
    if (!computedRes.anyOk && !parlayRes.anyOk) {
      const creditExhausted = [...computedRes.errors, ...parlayRes.errors]
        .some(e => e.status === 403 && /credit|quota|usage/i.test(e.body || ""));
      let stale = null;
      if (redis) {
        try {
          const raw = await redis.get(cacheKey);
          if (raw) stale = JSON.parse(raw);
        } catch {}
      }
      const hasCache = !!stale;
      let msg;
      if (creditExhausted && hasCache) {
        msg = "Arbitrage sources are temporarily rate-limited. Showing last cached opportunities.";
      } else if (creditExhausted) {
        msg = "Arbitrage sources are temporarily rate-limited. Check back in a few minutes.";
      } else if (hasCache) {
        msg = "Arbitrage sources are temporarily unreachable. Showing last cached opportunities.";
      } else {
        msg = "Arbitrage sources are temporarily unreachable.";
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        opportunities: stale?.opportunities || [],
        sportsQueried: sports,
        regions,
        creditsRemaining: computedRes.remaining,
        creditsUsed: computedRes.used,
        stale: hasCache,
        upstreamError: msg,
        cachedAt: stale?.cachedAt || null,
      });
    }

    const payload = {
      opportunities,
      sportsQueried: sports,
      regions,
      creditsRemaining: computedRes.remaining,
      creditsUsed: computedRes.used,
      sources: {
        computed: { ok: computedRes.anyOk, count: computedRes.arbs.length },
        parlayApi: { ok: parlayRes.anyOk, count: parlayRes.arbs.length, attempted: parlayRes.anyCall },
      },
      cachedAt: new Date().toISOString(),
    };

    if (redis) {
      try { await redis.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(payload)); } catch {}
    }

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=600");
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
