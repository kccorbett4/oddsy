// Cron job: checks finished games and resolves pending picks.
// Runs daily at 6 AM UTC via Vercel Cron.
import { createClient } from "redis";
import { statsKey } from "./_auth.js";

// 1-unit flat stake. Win profit = decimal odds - 1. Loss = -1. Push = 0.
function unitsOnWin(oddsStr) {
  const odds = parseFloat(oddsStr);
  if (!Number.isFinite(odds) || odds === 0) return 0;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
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
  let client;
  try {
    if (!process.env.REDIS_URL) {
      return res.status(200).json({ resolved: 0, note: "REDIS_URL not configured" });
    }

    client = createClient({ url: process.env.REDIS_URL });
    await client.connect();

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

    // Fetch scores for today and yesterday
    const allScores = [];
    for (const [key, espnPath] of Object.entries(sportMap)) {
      try {
        for (const dateOffset of [0, -1]) {
          const d = new Date(now + dateOffset * 86400000);
          const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
          const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${dateStr}`;
          const response = await fetch(url);
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
  } finally {
    if (client) await client.disconnect().catch(() => {});
  }
}
