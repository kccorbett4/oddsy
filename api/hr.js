// Unified HR endpoint. One serverless function dispatches to three
// sub-handlers based on ?action= so we stay under Vercel's function
// count limit without losing any functionality.
//
//   /api/hr?action=context           — full modeling context payload
//   /api/hr?action=odds              — batter_home_runs prop odds
//   /api/hr?action=bvp&batter=X&pitcher=Y — career BvP history
//
// Each sub-handler caches independently in Redis with its own TTL.
import { createClient } from "redis";
import { parkFor } from "./_hr_parks.js";
import { fetchScrapedHr, mergeScrapedIntoEvents } from "./_hr_scrape.js";

// ──────────────────────── shared helpers ────────────────────────
async function jsonFetch(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function textFetch(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}
const ymd = (d) => d.toISOString().slice(0, 10);
const americanToDecimal = (a) => {
  if (!Number.isFinite(a)) return null;
  return a >= 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
};

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  try {
    const redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    return redis;
  } catch {
    return null;
  }
}

// ──────────────────────── context handler ────────────────────────
const CTX_KEY = "hrctx:v2";
const SAVANT_BAT_KEY = "hrctx:savant:bat:v1";
const SAVANT_PIT_KEY = "hrctx:savant:pit:v1";
const CTX_TTL = 1800;
const SAVANT_TTL = 21600;

async function fetchSchedule(startDateStr, endDateStr) {
  // Fetch today + tomorrow so we catch games whose probable pitchers are
  // already announced (MLB teams announce ~24h ahead). Without this, any
  // game starting tomorrow evening never gets matched against odds.
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1`
    + `&startDate=${startDateStr}&endDate=${endDateStr || startDateStr}`
    + `&hydrate=probablePitcher,lineups,team,venue,person`;
  const j = await jsonFetch(url);
  const out = [];
  for (const d of (j?.dates || [])) {
    for (const g of (d.games || [])) {
      if (g.status?.abstractGameState === "Final") continue;
      out.push(g);
    }
  }
  return out;
}

async function fetchBatterSeasonStats(season) {
  const url = `https://statsapi.mlb.com/api/v1/stats`
    + `?stats=season&group=hitting&sportIds=1&season=${season}&limit=1500`;
  const j = await jsonFetch(url);
  const map = {};
  for (const s of (j?.stats?.[0]?.splits || [])) {
    const p = s.player;
    const st = s.stat;
    if (!p?.id || !st) continue;
    const hr = parseInt(st.homeRuns || "0");
    const ab = parseInt(st.atBats || "0");
    const pa = parseInt(st.plateAppearances || "0");
    const slg = parseFloat(st.slg || "0");
    const avg = parseFloat(st.avg || "0");
    map[p.id] = {
      name: p.fullName || `${p.firstName || ""} ${p.lastName || ""}`.trim(),
      hr, ab, pa,
      hrPerPA: pa > 0 ? hr / pa : 0,
      slg, avg,
      iso: +(slg - avg).toFixed(3),
      ops: parseFloat(st.ops || "0"),
    };
  }
  return map;
}

async function fetchPitcherSeasonStats(season) {
  const url = `https://statsapi.mlb.com/api/v1/stats`
    + `?stats=season&group=pitching&sportIds=1&season=${season}&limit=1500`;
  const j = await jsonFetch(url);
  const map = {};
  for (const s of (j?.stats?.[0]?.splits || [])) {
    const p = s.player;
    const st = s.stat;
    if (!p?.id || !st) continue;
    const hr = parseInt(st.homeRuns || "0");
    const ip = parseFloat(st.inningsPitched || "0");
    const hrPer9 = ip > 0 ? (hr / ip) * 9 : 0;
    map[p.id] = {
      name: p.fullName || `${p.firstName || ""} ${p.lastName || ""}`.trim(),
      hr, ip,
      hrPer9: +hrPer9.toFixed(3),
      era: parseFloat(st.era || "0"),
      whip: parseFloat(st.whip || "0"),
    };
  }
  return map;
}

function extractHittingSplit(st) {
  if (!st) return null;
  const hr = parseInt(st.homeRuns || "0");
  const pa = parseInt(st.plateAppearances || "0");
  const slg = parseFloat(st.slg || "0");
  const avg = parseFloat(st.avg || "0");
  return {
    pa, hr,
    hrPerPA: pa > 0 ? +(hr / pa).toFixed(4) : 0,
    slg, avg,
    iso: +(slg - avg).toFixed(3),
    ops: parseFloat(st.ops || "0"),
  };
}
function extractPitchingSplit(st) {
  if (!st) return null;
  const hr = parseInt(st.homeRuns || "0");
  const ip = parseFloat(st.inningsPitched || "0");
  const tbf = parseInt(st.battersFaced || "0");
  return {
    tbf, hr, ip,
    hrPer9: ip > 0 ? +((hr / ip) * 9).toFixed(3) : 0,
    hrPerPA: tbf > 0 ? +(hr / tbf).toFixed(4) : 0,
    slgAgainst: parseFloat(st.slg || "0"),
  };
}

async function fetchBatterSplits(personIds, season) {
  if (personIds.length === 0) return {};
  const chunks = [];
  for (let i = 0; i < personIds.length; i += 60) chunks.push(personIds.slice(i, i + 60));
  const out = {};
  await Promise.all(chunks.map(async (ids) => {
    const url = `https://statsapi.mlb.com/api/v1/people?personIds=${ids.join(",")}`
      + `&hydrate=stats(group=[hitting],type=[statSplits],sitCodes=[vl,vr],season=${season})`;
    const j = await jsonFetch(url);
    for (const p of (j?.people || [])) {
      const splits = p?.stats?.[0]?.splits || [];
      const vsL = splits.find(s => s.split?.code === "vl");
      const vsR = splits.find(s => s.split?.code === "vr");
      out[p.id] = {
        batSide: p.batSide?.code || null,
        vsL: vsL ? extractHittingSplit(vsL.stat) : null,
        vsR: vsR ? extractHittingSplit(vsR.stat) : null,
      };
    }
  }));
  return out;
}

async function fetchPitcherSplits(personIds, season) {
  if (personIds.length === 0) return {};
  const chunks = [];
  for (let i = 0; i < personIds.length; i += 60) chunks.push(personIds.slice(i, i + 60));
  const out = {};
  await Promise.all(chunks.map(async (ids) => {
    const url = `https://statsapi.mlb.com/api/v1/people?personIds=${ids.join(",")}`
      + `&hydrate=stats(group=[pitching],type=[statSplits],sitCodes=[vl,vr],season=${season})`;
    const j = await jsonFetch(url);
    for (const p of (j?.people || [])) {
      const splits = p?.stats?.[0]?.splits || [];
      const vsL = splits.find(s => s.split?.code === "vl");
      const vsR = splits.find(s => s.split?.code === "vr");
      out[p.id] = {
        pitchHand: p.pitchHand?.code || null,
        vsL: vsL ? extractPitchingSplit(vsL.stat) : null,
        vsR: vsR ? extractPitchingSplit(vsR.stat) : null,
      };
    }
  }));
  return out;
}

function splitCsvRow(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function parseSavantCsv(csv, kind) {
  if (!csv || typeof csv !== "string") return {};
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return {};
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  const idx = (...names) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iId = idx("player_id");
  if (iId < 0) return {};
  const iBrlPa = idx("barrels_per_pa_percent", "brl_pa");
  const iBrlBip = idx("barrel_batted_rate");
  const iXiso = idx("xiso", "b_xiso", "p_xiso");
  const iXslg = idx("xslg", "b_xslg", "p_xslg");
  const iHh = idx("hard_hit_percent", "b_hard_hit_percent", "p_hard_hit_percent");
  const iEv = idx("exit_velocity_avg", "b_exit_velocity_avg", "p_exit_velocity_avg");
  const iLa = idx("launch_angle_avg", "b_launch_angle_avg", "p_launch_angle_avg");
  const out = {};
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvRow(lines[r]);
    const id = (cols[iId] || "").replace(/"/g, "").trim();
    if (!id) continue;
    const num = (i) => {
      if (i < 0) return null;
      const v = parseFloat((cols[i] || "").replace(/"/g, ""));
      return Number.isFinite(v) ? v : null;
    };
    out[id] = {
      kind,
      barrelPerPA: num(iBrlPa),
      barrelPerBIP: num(iBrlBip),
      xiso: num(iXiso),
      xslg: num(iXslg),
      hardHitPct: num(iHh),
      avgEV: num(iEv),
      avgLA: num(iLa),
    };
  }
  return out;
}
async function fetchSavantBatters(season) {
  const url = `https://baseballsavant.mlb.com/leaderboard/custom?year=${season}&type=batter&filter=&min=50`
    + `&selections=b_total_pa,barrels_per_pa_percent,barrel_batted_rate,xiso,xslg,hard_hit_percent,exit_velocity_avg,launch_angle_avg&csv=true`;
  return parseSavantCsv(await textFetch(url), "batter");
}
async function fetchSavantPitchers(season) {
  const url = `https://baseballsavant.mlb.com/leaderboard/custom?year=${season}&type=pitcher&filter=&min=50`
    + `&selections=p_total_pa,barrels_per_pa_percent,barrel_batted_rate,xiso,xslg,hard_hit_percent,exit_velocity_avg,launch_angle_avg&csv=true`;
  return parseSavantCsv(await textFetch(url), "pitcher");
}

async function fetchWeather(lat, lon, commenceIso) {
  const date = new Date(commenceIso);
  const dateStr = date.toISOString().slice(0, 10);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&hourly=temperature_2m,precipitation,precipitation_probability,`
    + `wind_speed_10m,wind_direction_10m,relative_humidity_2m,surface_pressure`
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`
    + `&start_date=${dateStr}&end_date=${dateStr}&timezone=UTC`;
  const j = await jsonFetch(url);
  if (!j?.hourly?.time) return null;
  const targetMs = date.getTime();
  let bestIdx = 0, bestDelta = Infinity;
  j.hourly.time.forEach((t, i) => {
    const delta = Math.abs(new Date(t + "Z").getTime() - targetMs);
    if (delta < bestDelta) { bestDelta = delta; bestIdx = i; }
  });
  return {
    tempF: j.hourly.temperature_2m?.[bestIdx] ?? null,
    precipIn: j.hourly.precipitation?.[bestIdx] ?? null,
    precipProb: j.hourly.precipitation_probability?.[bestIdx] ?? null,
    windMph: j.hourly.wind_speed_10m?.[bestIdx] ?? null,
    windDirDeg: j.hourly.wind_direction_10m?.[bestIdx] ?? null,
    humidityPct: j.hourly.relative_humidity_2m?.[bestIdx] ?? null,
    pressureHpa: j.hourly.surface_pressure?.[bestIdx] ?? null,
  };
}

async function handleContext(req, res) {
  const force = req.query?.force === "1";
  const redis = await getRedis();
  try {
    if (redis && !force) {
      const cached = await redis.get(CTX_KEY).catch(() => null);
      if (cached) {
        res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=900");
        return res.status(200).json(JSON.parse(cached));
      }
    }

    const now = new Date();
    const todayStr = ymd(now);
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const tomorrowStr = ymd(tomorrow);
    const season = now.getUTCFullYear();

    let savantBatters = {}, savantPitchers = {};
    if (redis) {
      try {
        const [b, p] = await Promise.all([
          redis.get(SAVANT_BAT_KEY),
          redis.get(SAVANT_PIT_KEY),
        ]);
        if (b) savantBatters = JSON.parse(b);
        if (p) savantPitchers = JSON.parse(p);
      } catch {}
    }
    const savantTasks = [];
    if (Object.keys(savantBatters).length === 0) {
      savantTasks.push(fetchSavantBatters(season).then(m => { savantBatters = m; }));
    }
    if (Object.keys(savantPitchers).length === 0) {
      savantTasks.push(fetchSavantPitchers(season).then(m => { savantPitchers = m; }));
    }

    const [schedule, batters, pitchers] = await Promise.all([
      fetchSchedule(todayStr, tomorrowStr),
      fetchBatterSeasonStats(season),
      fetchPitcherSeasonStats(season),
      ...savantTasks,
    ]);

    if (redis) {
      try {
        if (Object.keys(savantBatters).length > 0)
          await redis.set(SAVANT_BAT_KEY, JSON.stringify(savantBatters), { EX: SAVANT_TTL });
        if (Object.keys(savantPitchers).length > 0)
          await redis.set(SAVANT_PIT_KEY, JSON.stringify(savantPitchers), { EX: SAVANT_TTL });
      } catch {}
    }

    const games = [];
    const weatherTasks = [];
    const batterIdsToday = new Set();
    const pitcherIdsToday = new Set();

    for (const g of schedule) {
      const home = g.teams?.home?.team?.name;
      const away = g.teams?.away?.team?.name;
      if (!home || !away) continue;

      const probHome = g.teams?.home?.probablePitcher;
      const probAway = g.teams?.away?.probablePitcher;

      const rawLineups = g.lineups || {};
      const mapLineup = (list) => (list || []).map((p, i) => {
        if (p.id) batterIdsToday.add(p.id);
        return {
          playerId: p.id,
          name: p.fullName,
          batSide: p.batSide?.code || null,
          order: i + 1,
        };
      });

      const park = parkFor(home);
      if (probHome?.id) pitcherIdsToday.add(probHome.id);
      if (probAway?.id) pitcherIdsToday.add(probAway.id);

      const gameObj = {
        gameId: g.gamePk,
        sport_key: "baseball_mlb",
        commence: g.gameDate,
        status: g.status?.detailedState || null,
        home, away,
        venue: g.venue?.name || null,
        park: park ? { hrFactor: park.hrFactor, cfBearing: park.cfBearing, outdoor: park.outdoor } : null,
        outdoor: park ? park.outdoor : true,
        weather: null,
        probablePitchers: {
          home: probHome ? { playerId: probHome.id, name: probHome.fullName, pitchHand: probHome.pitchHand?.code || null } : null,
          away: probAway ? { playerId: probAway.id, name: probAway.fullName, pitchHand: probAway.pitchHand?.code || null } : null,
        },
        lineups: {
          home: mapLineup(rawLineups.homePlayers),
          away: mapLineup(rawLineups.awayPlayers),
        },
        lineupsConfirmed: !!(rawLineups.homePlayers?.length && rawLineups.awayPlayers?.length),
      };

      if (park && park.outdoor) {
        weatherTasks.push(fetchWeather(park.lat, park.lon, g.gameDate).then(w => ({ gameId: g.gamePk, w })));
      }
      games.push(gameObj);
    }

    const [weatherResults, batterSplits, pitcherSplits] = await Promise.all([
      Promise.all(weatherTasks),
      fetchBatterSplits([...batterIdsToday], season),
      fetchPitcherSplits([...pitcherIdsToday], season),
    ]);

    for (const { gameId, w } of weatherResults) {
      if (!w) continue;
      const g = games.find(gg => gg.gameId === gameId);
      if (g) g.weather = w;
    }

    const payload = {
      date: todayStr, tomorrowDate: tomorrowStr, season, games,
      batters, pitchers,
      savantBatters, savantPitchers,
      batterSplits, pitcherSplits,
      updatedAt: new Date().toISOString(),
      batterCount: Object.keys(batters).length,
      pitcherCount: Object.keys(pitchers).length,
      savantBatterCount: Object.keys(savantBatters).length,
      savantPitcherCount: Object.keys(savantPitchers).length,
    };

    if (redis) {
      try { await redis.set(CTX_KEY, JSON.stringify(payload), { EX: CTX_TTL }); } catch {}
    }

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=900");
    return res.status(200).json(payload);
  } finally {
    if (redis) await redis.disconnect().catch(() => {});
  }
}

// ──────────────────────── odds handler ────────────────────────
const ODDS_KEY = "hrodds:v1";
const ODDS_TTL = 6 * 3600;
const SCRAPE_KEY = "hrscrape:v1";
const SCRAPE_TTL = 6 * 3600;

async function handleOdds(req, res) {
  const API_KEY = process.env.ODDS_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured" });

  const force = req.query?.force === "1";
  const redis = await getRedis();
  try {
    if (redis && !force) {
      const cached = await redis.get(ODDS_KEY).catch(() => null);
      if (cached) {
        res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=1800");
        return res.status(200).json(JSON.parse(cached));
      }
    }

    const eventsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${API_KEY}`;
    const eventList = await jsonFetch(eventsUrl);
    if (!Array.isArray(eventList)) {
      return res.status(502).json({ error: "Failed to fetch event list" });
    }

    const now = Date.now();
    const soon = eventList.filter(e => {
      if (!e.commence_time) return false;
      const ms = new Date(e.commence_time).getTime();
      // Widen to 48h so tomorrow night's slate shows up — probable
      // pitchers are announced ~24h ahead.
      return ms > now - 3 * 3600 * 1000 && ms < now + 48 * 3600 * 1000;
    });

    let creditsRemaining = null;
    let creditsUsed = null;
    const events = [];

    for (const ev of soon) {
      // regions=us,us2 picks up Fanatics, HardRock, Bally, ESPN Bet, etc.
      // that aren't in the "us" group. Cost is same — we're billed per
      // market, not per region.
      const oddsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${ev.id}/odds`
        + `?apiKey=${API_KEY}&regions=us,us2&markets=batter_home_runs&oddsFormat=american`;
      const resp = await fetch(oddsUrl);
      creditsRemaining = resp.headers.get("x-requests-remaining") || creditsRemaining;
      creditsUsed = resp.headers.get("x-requests-used") || creditsUsed;
      if (!resp.ok) continue;
      const data = await resp.json();

      // Odds API shape for player props:
      //   o.name        = "Over" | "Under" | "Yes" | "No"  (the side)
      //   o.description = the player's name
      //   o.point       = threshold (0.5 = 1+ HR, 1.5 = 2+ HR, ...)
      // The 0.5 line is the "anytime HR" market — the only one we use for
      // the model. We keep the Over/Yes side, filter to the lowest point
      // per (player, book), and drop multi-HR tiers.
      const bookDiag = {
        returned: (data.bookmakers || []).map(b => b.title),
        postingHR: [],
      };
      const byPlayer = {};
      for (const bm of (data.bookmakers || [])) {
        const m = (bm.markets || []).find(x => x.key === "batter_home_runs");
        if (!m) continue;
        bookDiag.postingHR.push(bm.title);
        for (const o of (m.outcomes || [])) {
          if (!Number.isFinite(o.price)) continue;
          if (o.name && /^(no|under)$/i.test(o.name)) continue;
          const playerName = (o.description || "").trim();
          if (!playerName) continue;
          const point = Number.isFinite(o.point) ? o.point : 0.5;
          if (point > 0.5) continue; // skip 1.5+ / 2.5+ tiers
          if (!byPlayer[playerName]) byPlayer[playerName] = {};
          const prev = byPlayer[playerName][bm.title];
          // If multiple 0.5-equivalent lines exist for the same book,
          // prefer the one with the lowest (most conservative) odds,
          // which is the actual anytime-HR market.
          const cand = {
            book: bm.title,
            point,
            overAmerican: o.price,
            overDecimal: +americanToDecimal(o.price).toFixed(3),
          };
          if (!prev || cand.overDecimal < prev.overDecimal) {
            byPlayer[playerName][bm.title] = cand;
          }
        }
      }

      events.push({
        eventId: ev.id,
        sport_key: "baseball_mlb",
        commence: ev.commence_time,
        home: ev.home_team,
        away: ev.away_team,
        players: Object.entries(byPlayer).map(([name, byBook]) => ({
          name,
          books: Object.values(byBook),
        })),
        bookDiag,
      });
    }

    // Supplement Odds API with DK/FanDuel scrape. Cached separately so a
    // flaky sportsbook endpoint doesn't invalidate the main odds cache.
    let scraped = null;
    if (redis && !force) {
      try {
        const c = await redis.get(SCRAPE_KEY);
        if (c) scraped = JSON.parse(c);
      } catch {}
    }
    if (!scraped) {
      try { scraped = await fetchScrapedHr(); }
      catch (e) { scraped = { draftkings: { ok: false, error: e.message, events: [] }, fanduel: { ok: false, error: e.message, events: [] } }; }
      if (redis) {
        try { await redis.set(SCRAPE_KEY, JSON.stringify(scraped), { EX: SCRAPE_TTL }); } catch {}
      }
    }

    let dkAttached = 0, fdAttached = 0;
    if (scraped?.draftkings?.ok) {
      dkAttached = mergeScrapedIntoEvents(events, scraped.draftkings, "DraftKings");
    }
    if (scraped?.fanduel?.ok) {
      fdAttached = mergeScrapedIntoEvents(events, scraped.fanduel, "FanDuel");
    }

    const payload = {
      updatedAt: new Date().toISOString(),
      creditsRemaining, creditsUsed,
      eventCount: events.length,
      events,
      scrapers: {
        draftkings: scraped?.draftkings?.ok
          ? { ok: true, eventCount: scraped.draftkings.eventCount, attached: dkAttached }
          : { ok: false, error: scraped?.draftkings?.error || "unknown", attached: 0 },
        fanduel: scraped?.fanduel?.ok
          ? { ok: true, eventCount: scraped.fanduel.eventCount, attached: fdAttached }
          : { ok: false, error: scraped?.fanduel?.error || "unknown", attached: 0 },
      },
    };

    if (redis) {
      try { await redis.set(ODDS_KEY, JSON.stringify(payload), { EX: ODDS_TTL }); } catch {}
    }

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=1800");
    return res.status(200).json(payload);
  } finally {
    if (redis) await redis.disconnect().catch(() => {});
  }
}

// ──────────────────────── bvp handler ────────────────────────
const BVP_TTL = 86400;

async function handleBvp(req, res) {
  const batterId = req.query?.batter;
  const pitcherId = req.query?.pitcher;
  if (!batterId || !pitcherId) {
    return res.status(400).json({ error: "batter and pitcher query params required" });
  }
  const cacheKey = `hrbvp:${batterId}:${pitcherId}`;
  const redis = await getRedis();
  try {
    if (redis) {
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) {
        res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=3600");
        return res.status(200).json(JSON.parse(cached));
      }
    }

    const url = `https://statsapi.mlb.com/api/v1/people/${batterId}/stats`
      + `?stats=vsPlayer&opposingPlayerId=${pitcherId}&group=hitting`;
    const j = await jsonFetch(url);

    const splits = j?.stats?.[0]?.splits || [];
    let pa = 0, ab = 0, h = 0, hr = 0, bb = 0, k = 0, xbh = 0, tb = 0;
    for (const s of splits) {
      const st = s.stat || {};
      pa += parseInt(st.plateAppearances || "0");
      ab += parseInt(st.atBats || "0");
      h += parseInt(st.hits || "0");
      hr += parseInt(st.homeRuns || "0");
      bb += parseInt(st.baseOnBalls || "0");
      k += parseInt(st.strikeOuts || "0");
      xbh += parseInt(st.doubles || "0") + parseInt(st.triples || "0") + parseInt(st.homeRuns || "0");
      tb += parseInt(st.totalBases || "0");
    }
    const avg = ab > 0 ? h / ab : 0;
    const slg = ab > 0 ? tb / ab : 0;
    const payload = {
      batterId, pitcherId,
      pa, ab, h, hr, bb, k, xbh, tb,
      avg: +avg.toFixed(3),
      slg: +slg.toFixed(3),
      iso: +(slg - avg).toFixed(3),
      hrPerAB: ab > 0 ? +(hr / ab).toFixed(4) : 0,
      sampleNote: pa < 15
        ? "small sample — use as a tiebreaker, not a signal"
        : pa < 40 ? "moderate sample" : "meaningful sample",
      updatedAt: new Date().toISOString(),
    };

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(payload), { EX: BVP_TTL }); } catch {}
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=3600");
    return res.status(200).json(payload);
  } finally {
    if (redis) await redis.disconnect().catch(() => {});
  }
}

// ──────────────────────── coverage diagnostic ────────────────────────
// One-shot probe: "which books does my Odds API plan actually return for
// MLB, across H2H (main market — every book posts this) vs player props?"
// Useful for figuring out whether DK/FanDuel/BetMGM are missing because
// of a plan-tier limit on props, or because the plan doesn't include
// those books at all.
async function handleCoverage(req, res) {
  const API_KEY = process.env.ODDS_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "API key not configured" });

  const regions = "us,us2";
  const h2hUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds`
    + `?apiKey=${API_KEY}&regions=${regions}&markets=h2h&oddsFormat=american`;
  const r = await fetch(h2hUrl);
  const remaining = r.headers.get("x-requests-remaining");
  const used = r.headers.get("x-requests-used");
  if (!r.ok) {
    return res.status(502).json({ error: `Odds API returned ${r.status}`, body: await r.text() });
  }
  const data = await r.json();
  const perEvent = data.map(e => ({
    home: e.home_team, away: e.away_team,
    bookmakers: (e.bookmakers || []).map(b => b.title),
  }));
  const allBooks = {};
  for (const ev of perEvent) {
    for (const b of ev.bookmakers) allBooks[b] = (allBooks[b] || 0) + 1;
  }
  return res.status(200).json({
    regions, market: "h2h", eventCount: data.length,
    creditsRemaining: remaining, creditsUsed: used,
    booksByCoverage: Object.fromEntries(
      Object.entries(allBooks).sort((a, b) => b[1] - a[1])
    ),
    totalBooks: Object.keys(allBooks).length,
    note: "If DraftKings/FanDuel/BetMGM appear here but are missing from the HR props feed (/api/hr?action=odds), it's a plan-tier limit on player-prop markets. If they're missing here too, your plan doesn't include those books at all.",
  });
}

// ──────────────────────── dispatcher ────────────────────────
export default async function handler(req, res) {
  const action = req.query?.action || "context";
  try {
    if (action === "context") return await handleContext(req, res);
    if (action === "odds") return await handleOdds(req, res);
    if (action === "bvp") return await handleBvp(req, res);
    if (action === "coverage") return await handleCoverage(req, res);
    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
