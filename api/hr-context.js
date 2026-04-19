// HR context endpoint — pulls every input the model needs to project
// today's MLB home-run probabilities.
//
// Sources:
//   - MLB Stats API  (statsapi.mlb.com) — schedule, probable pitchers
//     w/ pitchHand, confirmed lineups with batSide (populated ~90 min
//     before first pitch), season hitter and pitcher stats, batter and
//     pitcher L/R platoon splits via personIds hydrate, and per-matchup
//     BvP history (handled by the sibling hr-bvp endpoint on-demand).
//   - Baseball Savant — Statcast custom leaderboards for hitters (barrel
//     rate, xISO, xSLG, hard-hit%, EV, LA) AND pitchers (opponent barrel
//     rate allowed, opp hard-hit%, etc.). Cached separately with longer
//     TTLs because they barely change intra-day.
//   - Open-Meteo — hourly forecast for each open-air park: temperature,
//     wind speed + direction, relative humidity, precipitation, surface
//     pressure.
//
// Cached 30 min in Redis. Savant leaderboards cached 6h separately.
import { createClient } from "redis";
import { parkFor } from "./_hr_parks.js";

const CACHE_KEY = "hrctx:v2";
const SAVANT_BAT_KEY = "hrctx:savant:bat:v1";
const SAVANT_PIT_KEY = "hrctx:savant:pit:v1";
const CACHE_TTL = 1800;
const SAVANT_TTL = 21600;

const ymd = (d) => d.toISOString().slice(0, 10);

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

async function fetchSchedule(dateStr) {
  // Hydrate everything we can in one call: probable pitchers with hand,
  // lineups with batSide, team, venue.
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}`
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

// Bulk-fetch L/R platoon splits for a list of personIds via hydrate.
// MLB Stats API accepts personIds=1,2,3,... up to ~100 per call. We
// chunk to keep URLs short, and we request hitting+pitching splits in
// separate calls so the hydrate params match.
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
        batSide: p.batSide?.code || null,  // L, R, or S (switch)
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
        pitchHand: p.pitchHand?.code || null,  // L or R
        vsL: vsL ? extractPitchingSplit(vsL.stat) : null,
        vsR: vsR ? extractPitchingSplit(vsR.stat) : null,
      };
    }
  }));
  return out;
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

async function fetchSavantBatters(season) {
  const url = `https://baseballsavant.mlb.com/leaderboard/custom?year=${season}&type=batter&filter=&min=50`
    + `&selections=b_total_pa,barrels_per_pa_percent,barrel_batted_rate,xiso,xslg,hard_hit_percent,exit_velocity_avg,launch_angle_avg&csv=true`;
  const csv = await textFetch(url);
  return parseSavantCsv(csv, "batter");
}

async function fetchSavantPitchers(season) {
  // Pitcher custom leaderboard — opponent contact quality metrics.
  const url = `https://baseballsavant.mlb.com/leaderboard/custom?year=${season}&type=pitcher&filter=&min=50`
    + `&selections=p_total_pa,barrels_per_pa_percent,barrel_batted_rate,xiso,xslg,hard_hit_percent,exit_velocity_avg,launch_angle_avg&csv=true`;
  const csv = await textFetch(url);
  return parseSavantCsv(csv, "pitcher");
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

export default async function handler(req, res) {
  const force = req.query?.force === "1";
  let redis = null;
  try {
    if (process.env.REDIS_URL) {
      try {
        redis = createClient({ url: process.env.REDIS_URL });
        await redis.connect();
        if (!force) {
          const cached = await redis.get(CACHE_KEY);
          if (cached) {
            res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=900");
            return res.status(200).json(JSON.parse(cached));
          }
        }
      } catch { redis = null; }
    }

    const now = new Date();
    const todayStr = ymd(now);
    const season = now.getUTCFullYear();

    // Savant — use cache if present, else refresh.
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
      fetchSchedule(todayStr),
      fetchBatterSeasonStats(season),
      fetchPitcherSeasonStats(season),
      ...savantTasks,
    ]);

    // Persist Savant if we just fetched it.
    if (redis) {
      try {
        if (Object.keys(savantBatters).length > 0)
          await redis.set(SAVANT_BAT_KEY, JSON.stringify(savantBatters), { EX: SAVANT_TTL });
        if (Object.keys(savantPitchers).length > 0)
          await redis.set(SAVANT_PIT_KEY, JSON.stringify(savantPitchers), { EX: SAVANT_TTL });
      } catch {}
    }

    // Build game objects + collect player IDs for splits batch.
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
        park: park ? {
          hrFactor: park.hrFactor,
          cfBearing: park.cfBearing,
          outdoor: park.outdoor,
        } : null,
        outdoor: park ? park.outdoor : true,
        weather: null,
        probablePitchers: {
          home: probHome ? {
            playerId: probHome.id,
            name: probHome.fullName,
            pitchHand: probHome.pitchHand?.code || null,
          } : null,
          away: probAway ? {
            playerId: probAway.id,
            name: probAway.fullName,
            pitchHand: probAway.pitchHand?.code || null,
          } : null,
        },
        lineups: {
          home: mapLineup(rawLineups.homePlayers),
          away: mapLineup(rawLineups.awayPlayers),
        },
        lineupsConfirmed: !!(rawLineups.homePlayers?.length && rawLineups.awayPlayers?.length),
      };

      if (park && park.outdoor) {
        weatherTasks.push(
          fetchWeather(park.lat, park.lon, g.gameDate).then(w => ({ gameId: g.gamePk, w }))
        );
      }
      games.push(gameObj);
    }

    // Platoon splits for everyone on today's card (in parallel w/ weather).
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
      date: todayStr,
      season,
      games,
      batters,
      pitchers,
      savantBatters,
      savantPitchers,
      batterSplits,   // { [id]: { batSide, vsL, vsR } }
      pitcherSplits,  // { [id]: { pitchHand, vsL, vsR } }
      updatedAt: new Date().toISOString(),
      batterCount: Object.keys(batters).length,
      pitcherCount: Object.keys(pitchers).length,
      savantBatterCount: Object.keys(savantBatters).length,
      savantPitcherCount: Object.keys(savantPitchers).length,
    };

    if (redis) {
      try { await redis.set(CACHE_KEY, JSON.stringify(payload), { EX: CACHE_TTL }); } catch {}
    }

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=900");
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (redis) await redis.disconnect().catch(() => {});
  }
}
