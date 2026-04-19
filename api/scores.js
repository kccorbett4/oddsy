// Scores API — returns live + today/yesterday finals, and persists finals
// to Redis so they can be used by narrative regression and future analytics
// even after they roll off ESPN's default scoreboard.
//
// Redis schema (all with 90d TTL):
//   final:{espnId}          HASH — single canonical record per finished game
//   finals:{YYYY-MM-DD}     ZSET — members = espnId, score = completedAt ms
//
// Reads from Redis merge with the live fetch so callers always get recent
// finals even if ESPN's scoreboard no longer returns them.
import { getRedis } from "./_redis.js";

const SPORT_MAP = {
  basketball_nba: "basketball/nba",
  americanfootball_nfl: "football/nfl",
  baseball_mlb: "baseball/mlb",
  icehockey_nhl: "hockey/nhl",
  basketball_ncaab: "basketball/mens-college-basketball",
  americanfootball_ncaaf: "football/college-football",
};

const FINAL_TTL_SECONDS = 90 * 24 * 3600;

function normalizeEvent(event, sportKey) {
  const competition = event.competitions?.[0];
  const homeTeam = competition?.competitors?.find(c => c.homeAway === "home");
  const awayTeam = competition?.competitors?.find(c => c.homeAway === "away");

  return {
    id: event.id,
    sport_key: sportKey,
    name: event.name,
    shortName: event.shortName,
    commenceTime: event.date || competition?.date || null,
    status: {
      type: competition?.status?.type?.name,
      detail: competition?.status?.type?.detail || competition?.status?.type?.shortDetail,
      displayClock: competition?.status?.displayClock,
      period: competition?.status?.period,
      completed: competition?.status?.type?.completed,
    },
    home: {
      name: homeTeam?.team?.displayName,
      abbrev: homeTeam?.team?.abbreviation,
      score: parseInt(homeTeam?.score || "0"),
      logo: homeTeam?.team?.logo,
    },
    away: {
      name: awayTeam?.team?.displayName,
      abbrev: awayTeam?.team?.abbreviation,
      score: parseInt(awayTeam?.score || "0"),
      logo: awayTeam?.team?.logo,
    },
  };
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

async function fetchScoreboard(sportKey, espnPath, dateOffset) {
  let url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard`;
  if (dateOffset !== 0) {
    const d = new Date(Date.now() + dateOffset * 86400000);
    const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
    url += `?dates=${dateStr}`;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.events || []).map(e => normalizeEvent(e, sportKey));
  } catch {
    return [];
  }
}

async function persistFinals(client, events) {
  if (!client) return 0;
  let stored = 0;
  for (const e of events) {
    if (e.status?.type !== "STATUS_FINAL") continue;
    if (!e.id) continue;

    const key = `final:${e.id}`;
    // Idempotent: skip if already stored
    const exists = await client.hGet(key, "id");
    if (exists) continue;

    const commence = e.commenceTime ? new Date(e.commenceTime) : new Date();
    const commenceMs = commence.getTime();
    const dateKey = `finals:${ymd(commence)}`;

    await client.hSet(key, {
      id: e.id,
      sport_key: e.sport_key || "",
      name: e.name || "",
      shortName: e.shortName || "",
      commenceTime: e.commenceTime || "",
      statusType: e.status?.type || "",
      statusDetail: e.status?.detail || "",
      homeName: e.home?.name || "",
      homeAbbrev: e.home?.abbrev || "",
      homeScore: String(e.home?.score ?? 0),
      awayName: e.away?.name || "",
      awayAbbrev: e.away?.abbrev || "",
      awayScore: String(e.away?.score ?? 0),
      storedAt: new Date().toISOString(),
    });
    await client.expire(key, FINAL_TTL_SECONDS);

    await client.zAdd(dateKey, { score: commenceMs, value: String(e.id) });
    await client.expire(dateKey, FINAL_TTL_SECONDS);

    stored++;
  }
  return stored;
}

async function loadRecentFinalsFromRedis(client, days = 2) {
  if (!client) return [];
  const ids = new Set();
  const now = new Date();
  for (let i = 0; i <= days; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    const members = await client.zRange(`finals:${ymd(d)}`, 0, -1);
    (members || []).forEach(m => ids.add(m));
  }
  const events = [];
  for (const id of ids) {
    const h = await client.hGetAll(`final:${id}`);
    if (!h || !h.id) continue;
    events.push({
      id: h.id,
      sport_key: h.sport_key,
      name: h.name,
      shortName: h.shortName,
      commenceTime: h.commenceTime,
      status: {
        type: h.statusType,
        detail: h.statusDetail,
        completed: true,
      },
      home: {
        name: h.homeName,
        abbrev: h.homeAbbrev,
        score: parseInt(h.homeScore || "0"),
      },
      away: {
        name: h.awayName,
        abbrev: h.awayAbbrev,
        score: parseInt(h.awayScore || "0"),
      },
    });
  }
  return events;
}

export default async function handler(req, res) {
  try {
    let client = null;
    try { client = await getRedis(); } catch { client = null; }

    // Fetch today + yesterday for every sport so narrative regression
    // (which needs last-night blowouts) has data to work with.
    const fetchTasks = [];
    for (const [sportKey, espnPath] of Object.entries(SPORT_MAP)) {
      fetchTasks.push(fetchScoreboard(sportKey, espnPath, 0));
      fetchTasks.push(fetchScoreboard(sportKey, espnPath, -1));
    }
    const results = await Promise.all(fetchTasks);
    const liveEvents = results.flat();

    // Persist any newly-seen finals to Redis
    let stored = 0;
    if (client) {
      try { stored = await persistFinals(client, liveEvents); } catch {}
    }

    // Merge Redis-cached finals from the past 2 days in case ESPN
    // has already dropped them from the scoreboard feed
    let cachedFinals = [];
    if (client) {
      try { cachedFinals = await loadRecentFinalsFromRedis(client, 2); } catch {}
    }

    // Dedupe by id, preferring live over cached
    const byId = new Map();
    for (const e of cachedFinals) byId.set(e.id, e);
    for (const e of liveEvents) byId.set(e.id, e);
    const allEvents = Array.from(byId.values());

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");
    return res.status(200).json({ events: allEvents, stored });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
