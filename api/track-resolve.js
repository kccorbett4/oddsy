// Cron job: checks finished games and resolves pending picks.
// Runs daily at 6 AM UTC via Vercel Cron.
import { getRedis } from "./_redis.js";
import { statsKey } from "./_auth.js";

// 1-unit flat stake. Win profit = decimal odds - 1. Loss = -1. Push = 0.
function unitsOnWin(oddsStr) {
  const odds = parseFloat(oddsStr);
  if (!Number.isFinite(odds) || odds === 0) return 0;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

// Player-prop name match. Strips accents, periods, suffixes.
function normalizePlayerName(s) {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'`]/g, "")
    .replace(/\s(jr|sr|ii|iii|iv)\.?$/i, "")
    .replace(/[^a-z\s]/g, "")
    .trim()
    .split(/\s+/);
}
function playerNamesMatch(a, b) {
  const A = normalizePlayerName(a); const B = normalizePlayerName(b);
  if (!A.length || !B.length) return false;
  if (A[A.length - 1] !== B[B.length - 1]) return false;
  if (A[0][0] !== B[0][0]) return false;
  return true;
}

// Fetch a MLB Stats API boxscore once per gameId, with in-memory cache for
// the duration of this resolve run. Returns the count of HRs the named
// player hit in that game, or null if the box hasn't posted / can't match.
const __boxCache = new Map();
async function batterHrCountFromMlbBox(gamePk, playerName) {
  if (!gamePk) return null;
  let box;
  if (__boxCache.has(gamePk)) {
    box = __boxCache.get(gamePk);
  } else {
    try {
      const r = await fetch(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`,
        { signal: AbortSignal.timeout(5000) });
      if (!r.ok) { __boxCache.set(gamePk, null); return null; }
      box = await r.json();
      __boxCache.set(gamePk, box);
    } catch { __boxCache.set(gamePk, null); return null; }
  }
  if (!box || !box.teams) return null;
  for (const side of ["home", "away"]) {
    const players = box.teams?.[side]?.players || {};
    for (const p of Object.values(players)) {
      const full = p?.person?.fullName;
      if (!full) continue;
      if (!playerNamesMatch(full, playerName)) continue;
      const hr = parseInt(p?.stats?.batting?.homeRuns ?? "0", 10);
      return Number.isFinite(hr) ? hr : 0;
    }
  }
  return null; // player not found in box (didn't appear)
}

// Decide if MLB game is final. We use the schedule endpoint which includes
// a `status.abstractGameState` field. Boxscore alone doesn't tell us if
// the game is over — a game in progress will return partial stats and a
// "won" flag would be premature.
async function isMlbGameFinal(gamePk) {
  if (!gamePk) return false;
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/schedule?gamePk=${gamePk}`,
      { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return false;
    const j = await r.json();
    for (const d of (j?.dates || [])) {
      for (const g of (d.games || [])) {
        if (String(g.gamePk) !== String(gamePk)) continue;
        return g.status?.abstractGameState === "Final";
      }
    }
  } catch {}
  return false;
}

// Normalize team names for matching across sources (ESPN vs The Odds API).
const normalizeTeam = (s) =>
  (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

// Known abbreviation → canonical mappings. Extend as source divergences surface.
const TEAM_ALIASES = {
  "la lakers": "los angeles lakers",
  "la clippers": "los angeles clippers",
  "ny yankees": "new york yankees",
  "ny mets": "new york mets",
  "ny giants": "new york giants",
  "ny jets": "new york jets",
  "sf giants": "san francisco giants",
  "sf 49ers": "san francisco 49ers",
};

const canonicalTeam = (s) => {
  const n = normalizeTeam(s);
  return TEAM_ALIASES[n] || n;
};

// Match two team names safely. Requires either an exact canonical match, or
// every token of the shorter name to appear as a whole token in the longer
// (and shorter must have ≥2 tokens). This avoids the classic "Michigan"
// substring-matching "Michigan State" bug.
const teamsMatch = (a, b) => {
  const ca = canonicalTeam(a);
  const cb = canonicalTeam(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  const ta = ca.split(" ").filter(Boolean);
  const tb = cb.split(" ").filter(Boolean);
  if (!ta.length || !tb.length) return false;
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (shorter.length < 2) return false;
  return shorter.every((t) => longer.includes(t));
};

// Pick side: returns true if `outcome` refers to the home team.
const outcomeIsHome = (outcomeName, homeTeam, awayTeam) => {
  if (teamsMatch(outcomeName, homeTeam)) return true;
  if (teamsMatch(outcomeName, awayTeam)) return false;
  // Fall back to a looser canonical check so we don't silently mislabel picks.
  const co = canonicalTeam(outcomeName);
  const ch = canonicalTeam(homeTeam);
  const ca = canonicalTeam(awayTeam);
  if (co === ch) return true;
  if (co === ca) return false;
  // Last resort: prefer whichever canonical team name the outcome starts with.
  if (co && ch && co.startsWith(ch)) return true;
  if (co && ca && co.startsWith(ca)) return false;
  return null; // unresolved
};

export default async function handler(req, res) {
  try {
    const client = await getRedis();
    if (!client) {
      return res.status(200).json({ resolved: 0, note: "REDIS_URL not configured" });
    }

    const now = Date.now();
    // Get all pending picks where the game should have started by now
    const pendingIds = await client.zRangeByScore("pending_picks", 0, now);

    if (!pendingIds || pendingIds.length === 0) {
      return res.status(200).json({ resolved: 0, message: "No pending picks to resolve" });
    }

    // Fetch final scores from ESPN
    const sportMap = {
      basketball_nba: "basketball/nba",
      americanfootball_nfl: "football/nfl",
      baseball_mlb: "baseball/mlb",
      icehockey_nhl: "hockey/nhl",
      basketball_ncaab: "basketball/mens-college-basketball",
      americanfootball_ncaaf: "football/college-football",
      soccer_usa_mls: "soccer/usa.1",
    };

    // Fetch scores going back 7 days. Hobby's daily-only cron means any
    // skipped run used to let picks age past the old 48h expiry before the
    // resolver ever saw them. With a 7-day window we catch up even after
    // a missed run, and still expire stragglers (same 48h rule below).
    const allScores = [];
    for (const [key, espnPath] of Object.entries(sportMap)) {
      try {
        for (const dateOffset of [0, -1, -2, -3, -4, -5, -6]) {
          const d = new Date(now + dateOffset * 86400000);
          const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
          const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${dateStr}`;
          const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (response.ok) {
            const data = await response.json();
            (data.events || []).forEach(event => {
              const comp = event.competitions?.[0];
              const home = comp?.competitors?.find(c => c.homeAway === "home");
              const away = comp?.competitors?.find(c => c.homeAway === "away");
              if (comp?.status?.type?.completed) {
                allScores.push({
                  sport_key: key,
                  home: { name: home?.team?.displayName, score: parseInt(home?.score || "0") },
                  away: { name: away?.team?.displayName, score: parseInt(away?.score || "0") },
                  total: parseInt(home?.score || "0") + parseInt(away?.score || "0"),
                });
              }
            });
          }
        }
      } catch {} // skip failed sport fetches
    }

    let resolved = 0;
    let wins = 0;
    let losses = 0;
    let pushes = 0;

    for (const pickId of pendingIds) {
      const pick = await client.hGetAll(`pick:${pickId}`);
      if (!pick || Object.keys(pick).length === 0 || pick.resolved === "true") {
        await client.zRem("pending_picks", pickId);
        continue;
      }

      // ────────────────────── Player props (HR) ──────────────────────
      // Player-prop markets don't resolve from team box-final scores —
      // we look up the named batter's HR count in the MLB Stats API
      // boxscore. Anytime-HR is the only line we currently track:
      // win = ≥1 HR, loss = 0 HR, no push.
      if (pick.marketType === "batter_home_runs"
          || pick.marketType === "player_home_runs") {
        const final = await isMlbGameFinal(pick.gameId);
        if (!final) {
          const gameTime = new Date(pick.commenceTime).getTime();
          if (now - gameTime > 48 * 3600000) {
            await client.zRem("pending_picks", pickId);
            await client.hSet(`pick:${pickId}`, { resolved: "true", result: "expired" });
          }
          continue;
        }
        const hrCount = await batterHrCountFromMlbBox(pick.gameId, pick.outcome);
        if (hrCount === null) {
          // Player didn't appear in the box (DNP, scratched). Treat as
          // loss for over 0.5 — the prop pays only if the bat hits one.
          const gameTime = new Date(pick.commenceTime).getTime();
          if (now - gameTime < 48 * 3600000) continue;
          await client.zRem("pending_picks", pickId);
          await client.hSet(`pick:${pickId}`, { resolved: "true", result: "expired" });
          continue;
        }
        const result = hrCount >= 1 ? "win" : "loss";
        const unitProfit = result === "win" ? unitsOnWin(pick.odds) : -1;

        await client.hSet(`pick:${pickId}`, {
          resolved: "true",
          result,
          finalHr: String(hrCount),
          resolvedAt: new Date().toISOString(),
          unitProfit: unitProfit.toFixed(4),
        });

        const userId = pick.userId || null;
        const sKey = statsKey(pick.strategy, userId);
        await client.hIncrBy(sKey, "total", 1);
        await client.hIncrBy(sKey, result === "win" ? "wins" : "losses", 1);
        await client.hIncrByFloat(sKey, "units", unitProfit);

        const dailyKey = `${sKey}:${pick.date}`;
        await client.hIncrBy(dailyKey, "total", 1);
        await client.hIncrBy(dailyKey, result === "win" ? "wins" : "losses", 1);
        await client.hIncrByFloat(dailyKey, "units", unitProfit);
        await client.expire(dailyKey, 90 * 86400);

        await client.zRem("pending_picks", pickId);
        resolved++;
        if (result === "win") wins++; else losses++;
        continue;
      }

      // Try to match the game to a final score. Require sport_key to match
      // too — some team names collide across sports (Panthers exist in both
      // NFL and NHL; Cardinals in both NFL and MLB), and without the sport
      // check a pick could resolve against the wrong league's final.
      const matchedScore = allScores.find(
        (s) =>
          (!pick.sportKey || !s.sport_key || s.sport_key === pick.sportKey) &&
          teamsMatch(s.home.name, pick.homeTeam) &&
          teamsMatch(s.away.name, pick.awayTeam)
      );

      if (!matchedScore) {
        // Remove if the game is more than 48 hours old
        const gameTime = new Date(pick.commenceTime).getTime();
        if (now - gameTime > 48 * 3600000) {
          await client.zRem("pending_picks", pickId);
          await client.hSet(`pick:${pickId}`, { resolved: "true", result: "expired" });
        }
        continue;
      }

      // Resolve the pick
      let result = "";
      const homeScore = matchedScore.home.score;
      const awayScore = matchedScore.away.score;
      const totalScore = matchedScore.total;
      const point = pick.point !== "" ? parseFloat(pick.point) : null;

      if (pick.marketType === "h2h") {
        const pickedHome = outcomeIsHome(pick.outcome, pick.homeTeam, pick.awayTeam);
        if (pickedHome === null) continue; // can't safely attribute — skip
        if (pickedHome) {
          result = homeScore > awayScore ? "win" : homeScore === awayScore ? "push" : "loss";
        } else {
          result = awayScore > homeScore ? "win" : homeScore === awayScore ? "push" : "loss";
        }
      } else if (pick.marketType === "spreads" && point !== null) {
        const pickedHome = outcomeIsHome(pick.outcome, pick.homeTeam, pick.awayTeam);
        if (pickedHome === null) continue;
        let adjustedScore;
        if (pickedHome) {
          adjustedScore = homeScore + point;
          result = adjustedScore > awayScore ? "win" : adjustedScore === awayScore ? "push" : "loss";
        } else {
          adjustedScore = awayScore + point;
          result = adjustedScore > homeScore ? "win" : adjustedScore === homeScore ? "push" : "loss";
        }
      } else if (pick.marketType === "totals" && point !== null) {
        const isOver = pick.outcome.toLowerCase().includes("over");
        if (totalScore > point) {
          result = isOver ? "win" : "loss";
        } else if (totalScore < point) {
          result = isOver ? "loss" : "win";
        } else {
          result = "push";
        }
      }

      if (result) {
        const unitProfit = result === "win" ? unitsOnWin(pick.odds)
          : result === "loss" ? -1 : 0;

        await client.hSet(`pick:${pickId}`, {
          resolved: "true",
          result,
          finalHome: String(homeScore),
          finalAway: String(awayScore),
          resolvedAt: new Date().toISOString(),
          unitProfit: unitProfit.toFixed(4),
        });

        // Update strategy stats (scoped per-user for custom_*, global for built-ins)
        const userId = pick.userId || null;
        const sKey = statsKey(pick.strategy, userId);
        await client.hIncrBy(sKey, "total", 1);
        await client.hIncrBy(sKey, result === "win" ? "wins" : result === "loss" ? "losses" : "pushes", 1);
        await client.hIncrByFloat(sKey, "units", unitProfit);

        // Update daily stats (same scoping rule)
        const dailyKey = `${sKey}:${pick.date}`;
        await client.hIncrBy(dailyKey, "total", 1);
        await client.hIncrBy(dailyKey, result === "win" ? "wins" : result === "loss" ? "losses" : "pushes", 1);
        await client.hIncrByFloat(dailyKey, "units", unitProfit);
        await client.expire(dailyKey, 90 * 86400);

        await client.zRem("pending_picks", pickId);

        resolved++;
        if (result === "win") wins++;
        else if (result === "loss") losses++;
        else pushes++;
      }
    }

    return res.status(200).json({
      resolved,
      wins,
      losses,
      pushes,
      pendingChecked: pendingIds.length,
      scoresAvailable: allScores.length,
    });
  } catch (err) {
    console.error("Resolve error:", err);
    return res.status(500).json({ error: err.message });
  }
}
