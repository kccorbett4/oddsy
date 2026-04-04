export default async function handler(req, res) {
  const sportMap = {
    basketball_nba: "basketball/nba",
    americanfootball_nfl: "football/nfl",
    baseball_mlb: "baseball/mlb",
    icehockey_nhl: "hockey/nhl",
  };

  try {
    const allEvents = [];

    for (const [key, espnPath] of Object.entries(sportMap)) {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard`;
      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();
        const events = (data.events || []).map(event => {
          const competition = event.competitions?.[0];
          const homeTeam = competition?.competitors?.find(c => c.homeAway === "home");
          const awayTeam = competition?.competitors?.find(c => c.homeAway === "away");

          return {
            id: event.id,
            sport_key: key,
            name: event.name,
            shortName: event.shortName,
            status: {
              type: competition?.status?.type?.name, // STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_FINAL
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
        });
        allEvents.push(...events);
      }
    }

    // Cache for 2 minutes (scores change frequently)
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");
    return res.status(200).json({ events: allEvents });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
