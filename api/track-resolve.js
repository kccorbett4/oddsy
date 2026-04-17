// Cron job: checks finished games and resolves pending picks.
// Runs every 2 hours via Vercel Cron.
export default async function handler(req, res) {
  try {
    let kv;
    try {
      const mod = await import("@vercel/kv");
      kv = mod.kv;
    } catch {
      return res.status(200).json({ resolved: 0, note: "KV not available" });
    }
    // Get all pending picks where the game should have started by now
    const now = Date.now();
    const pendingIds = await kv.zrange("pending_picks", 0, now, { byScore: true });

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

    // Fetch scores for all sports
    const allScores = [];
    for (const [key, espnPath] of Object.entries(sportMap)) {
      try {
        // Fetch today and yesterday to catch games that finished overnight
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
      const pick = await kv.hgetall(`pick:${pickId}`);
      if (!pick || pick.resolved === "true") {
        await kv.zrem("pending_picks", pickId);
        continue;
      }

      // Try to match the game to a final score
      const matchedScore = allScores.find(s => {
        const homeMatch = s.home.name?.toLowerCase().includes(pick.homeTeam?.toLowerCase()) ||
                         pick.homeTeam?.toLowerCase().includes(s.home.name?.toLowerCase());
        const awayMatch = s.away.name?.toLowerCase().includes(pick.awayTeam?.toLowerCase()) ||
                         pick.awayTeam?.toLowerCase().includes(s.away.name?.toLowerCase());
        return homeMatch && awayMatch;
      });

      if (!matchedScore) {
        // Game hasn't finished yet — skip but keep pending
        // Remove if the game is more than 48 hours old (probably missed it)
        const gameTime = new Date(pick.commenceTime).getTime();
        if (now - gameTime > 48 * 3600000) {
          await kv.zrem("pending_picks", pickId);
          await kv.hset(`pick:${pickId}`, { resolved: "true", result: "expired" });
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
        // Moneyline: did the picked team win?
        const pickedHome = pick.outcome.toLowerCase().includes(pick.homeTeam?.toLowerCase()) ||
                          pick.homeTeam?.toLowerCase().includes(pick.outcome?.toLowerCase());
        if (pickedHome) {
          result = homeScore > awayScore ? "win" : homeScore === awayScore ? "push" : "loss";
        } else {
          result = awayScore > homeScore ? "win" : homeScore === awayScore ? "push" : "loss";
        }
      } else if (pick.marketType === "spreads" && point !== null) {
        // Spread: picked team's score + spread vs opponent
        const pickedHome = pick.outcome.toLowerCase().includes(pick.homeTeam?.toLowerCase()) ||
                          pick.homeTeam?.toLowerCase().includes(pick.outcome?.toLowerCase());
        let adjustedScore;
        if (pickedHome) {
          adjustedScore = homeScore + point;
          result = adjustedScore > awayScore ? "win" : adjustedScore === awayScore ? "push" : "loss";
        } else {
          adjustedScore = awayScore + point;
          result = adjustedScore > homeScore ? "win" : adjustedScore === homeScore ? "push" : "loss";
        }
      } else if (pick.marketType === "totals" && point !== null) {
        // Totals: over/under
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
        // Update the pick record
        await kv.hset(`pick:${pickId}`, {
          resolved: "true",
          result,
          finalHome: homeScore,
          finalAway: awayScore,
          resolvedAt: new Date().toISOString(),
        });

        // Update strategy stats
        const statsKey = `stats:${pick.strategy}`;
        await kv.hincrby(statsKey, "total", 1);
        await kv.hincrby(statsKey, result === "win" ? "wins" : result === "loss" ? "losses" : "pushes", 1);

        // Also update daily stats
        const dailyKey = `stats:${pick.strategy}:${pick.date}`;
        await kv.hincrby(dailyKey, "total", 1);
        await kv.hincrby(dailyKey, result === "win" ? "wins" : result === "loss" ? "losses" : "pushes", 1);
        // Expire daily stats after 90 days
        await kv.expire(dailyKey, 90 * 86400);

        // Remove from pending
        await kv.zrem("pending_picks", pickId);

        resolved++;
        if (result === "win") wins++;
        else if (result === "loss") losses++;
        else pushes++;
      }
    }

    // Expire individual pick records after 90 days to keep storage lean
    // (stats:* aggregates are kept permanently)

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
