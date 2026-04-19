// Home run probability model. Consumes the hr-context + hr-odds payloads
// and returns one ranked projection per (batter × game). Everything
// lives client-side because the raw inputs are tiny once loaded.
//
// Per-PA model:
//   perPA = leagueBase
//         × batterFactor          (season + barrel rate)
//         × pitcherFactor         (season + barrels allowed)
//         × parkFactor            (3-yr Statcast HR factor)
//         × weatherFactor         (temp × wind × humidity × rain)
//         × platoonFactor         (L/R splits when available)
//
// Game HR probability:
//   1 - (1 - perPA)^PAs     where PAs comes from the lineup slot, or
//                           a league average (4.2) when lineup hasn't
//                           been confirmed yet.

// League-wide HR rate per PA (updated when calibration drifts).
const LEAGUE_HR_PER_PA = 0.032;
// League-average barrel rate per PA (%). Savant publishes ~6-7%.
const LEAGUE_BARREL_PER_PA = 6.8;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ——— Weather ———————————————————————————————————————————————————————
// Tailwind component toward center field. Returns mph, positive = toward
// CF (helps HRs), negative = headwind. Wind direction convention for
// meteorology: 0° = wind FROM the north (i.e. blowing southward). We
// compare direction-to vs. the CF bearing from home plate.
function tailwindToCF(windDirDeg, windMph, cfBearingDeg) {
  if (windDirDeg == null || windMph == null || cfBearingDeg == null) return 0;
  // Wind direction is where it's coming FROM, so flip 180° to get where
  // it's blowing toward. Then project onto CF axis.
  const blowingToward = (windDirDeg + 180) % 360;
  const diff = ((blowingToward - cfBearingDeg + 540) % 360) - 180; // -180..180
  const rad = (diff * Math.PI) / 180;
  return windMph * Math.cos(rad);
}

function weatherFactor(weather, park) {
  if (!park || !park.outdoor || !weather) return 1;
  let f = 1;

  // Temperature: balls travel ~0.6% farther per °F above 70, less
  // farther below. Expressed as HR probability multiplier.
  if (weather.tempF != null) {
    f *= clamp(1 + 0.006 * (weather.tempF - 70), 0.85, 1.15);
  }

  // Wind toward CF: every mph of tailwind ~0.4% HR boost.
  if (weather.windMph != null && weather.windDirDeg != null) {
    const tw = tailwindToCF(weather.windDirDeg, weather.windMph, park.cfBearing);
    f *= clamp(1 + 0.004 * tw, 0.82, 1.20);
  }

  // Humidity: high RH means less-dense air (water molecules are lighter
  // than N2/O2) — slight HR tailwind. Real but subtle.
  if (weather.humidityPct != null) {
    f *= clamp(1 + 0.001 * (weather.humidityPct - 50), 0.96, 1.04);
  }

  // Surface pressure: lower = thinner air = more HRs. Park factor
  // already captures altitude, so we only credit unusual weather-driven
  // deviation from ~1013 hPa.
  if (weather.pressureHpa != null) {
    f *= clamp(1 + 0.0005 * (1013 - weather.pressureHpa), 0.97, 1.03);
  }

  // Rain: damp balls, damp bats — small haircut when precip is real.
  const rain = (weather.precipIn || 0) > 0.05 && (weather.precipProb || 0) >= 50;
  if (rain) f *= 0.96;

  return f;
}

// ——— Batter / Pitcher multipliers ———————————————————————————————————
function batterFactor(batter, savant) {
  // Skill baseline from season HR/PA (anchors against league rate).
  let season = batter?.hrPerPA ? batter.hrPerPA / LEAGUE_HR_PER_PA : 1;
  // Regress small samples toward league average.
  const pa = batter?.pa || 0;
  if (pa < 100) season = (season * pa + 1 * (100 - pa)) / 100;

  // Savant barrels/PA is a sticky underlying signal (more predictive
  // than raw HR/PA at mid-season). Blend when available.
  let barrelFactor = 1;
  if (savant?.barrelPerPA != null) {
    barrelFactor = 1 + 0.6 * (savant.barrelPerPA - LEAGUE_BARREL_PER_PA) / LEAGUE_BARREL_PER_PA;
    barrelFactor = clamp(barrelFactor, 0.55, 1.75);
  }

  // Weighted blend: HR/PA and barrel rate each carry half the skill
  // signal. Clamp to prevent extreme outliers from collapsing the model.
  return clamp(0.5 * season + 0.5 * barrelFactor, 0.30, 2.20);
}

function pitcherFactor(pitcher, savantP) {
  let season = 1;
  if (pitcher?.hrPer9) {
    // League HR/9 ~ 1.15. Higher = more HR-prone.
    season = pitcher.hrPer9 / 1.15;
  }
  const ip = pitcher?.ip || 0;
  if (ip < 40) season = (season * ip + 1 * (40 - ip)) / 40;

  let barrelAllowed = 1;
  if (savantP?.barrelPerPA != null) {
    barrelAllowed = 1 + 0.5 * (savantP.barrelPerPA - LEAGUE_BARREL_PER_PA) / LEAGUE_BARREL_PER_PA;
    barrelAllowed = clamp(barrelAllowed, 0.6, 1.6);
  }

  return clamp(0.6 * season + 0.4 * barrelAllowed, 0.45, 1.85);
}

// ——— Platoon ————————————————————————————————————————————————————————
function platoonFactor(batterSplit, pitcherSplit, batterSeasonHrPerPA) {
  // We only apply platoon if the batter's split vs. the opposing pitcher
  // hand is materially different from their overall. Switch hitters
  // always bat opposite the pitcher, so they get the favorable side.
  if (!pitcherSplit?.pitchHand) return 1;
  const pH = pitcherSplit.pitchHand; // "L" or "R"
  let bH = batterSplit?.batSide || null;
  if (bH === "S") bH = pH === "L" ? "R" : "L"; // switch = opposite

  const splitKey = pH === "L" ? "vsL" : "vsR";
  const row = batterSplit?.[splitKey];
  if (!row || !row.hrPerPA || !batterSeasonHrPerPA) return 1;
  // If the split has small PA, regress toward 1.
  const pa = row.pa || 0;
  let ratio = row.hrPerPA / batterSeasonHrPerPA;
  if (pa < 80) ratio = (ratio * pa + 1 * (80 - pa)) / 80;

  return clamp(ratio, 0.70, 1.45);
}

// ——— PA expectation ————————————————————————————————————————————————
const PA_BY_LINEUP = {
  1: 4.65, 2: 4.55, 3: 4.45, 4: 4.35, 5: 4.25,
  6: 4.15, 7: 4.05, 8: 3.95, 9: 3.80,
};
const DEFAULT_PA = 4.20;

// ——— Odds math ————————————————————————————————————————————————————————
export const americanToDecimal = (a) => {
  if (!Number.isFinite(a)) return null;
  return a >= 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
};
export const decimalToAmerican = (d) => {
  if (!Number.isFinite(d) || d <= 1) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
};
const impliedProb = (dec) => (dec > 1 ? 1 / dec : null);

// ——— Main ranker ——————————————————————————————————————————————————————
// Fuzzy name match between Odds API player strings and MLB Stats API
// fullName entries. Strips accents/periods/suffixes and compares tokens.
function normalizeName(s) {
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'`]/g, "")
    .replace(/\s(jr|sr|ii|iii|iv)\.?$/i, "")
    .replace(/[^a-z\s]/g, "")
    .trim()
    .split(/\s+/);
}
function namesMatch(a, b) {
  const A = normalizeName(a); const B = normalizeName(b);
  if (!A.length || !B.length) return false;
  // Require last token equal and first-initial equal.
  if (A[A.length - 1] !== B[B.length - 1]) return false;
  if (A[0][0] !== B[0][0]) return false;
  return true;
}

function findBatterByName(batters, name) {
  const entries = Object.entries(batters);
  for (const [id, b] of entries) {
    if (b.name && namesMatch(b.name, name)) return { id, batter: b };
  }
  return null;
}

function findSavant(savant, mlbamId) {
  if (!mlbamId) return null;
  return savant?.[mlbamId] || savant?.[String(mlbamId)] || null;
}

// Given context + odds payloads, return sorted HR projections.
// Each item: { name, team, opponent, game, modelProb, bestBook, bestOdds,
//              edgePct, evPct, inputs: {batterFactor, pitcherFactor, ...} }
export function rankHrProjections(ctx, odds) {
  if (!ctx || !odds?.events) return [];
  const games = ctx.games || [];
  const batters = ctx.batters || {};
  const pitchers = ctx.pitchers || {};
  const savantBatters = ctx.savantBatters || {};
  const savantPitchers = ctx.savantPitchers || {};
  const batterSplits = ctx.batterSplits || {};
  const pitcherSplits = ctx.pitcherSplits || {};

  // Match odds events to context games by home/away team name.
  const out = [];
  for (const ev of odds.events) {
    const game = games.find(g =>
      (g.home === ev.home && g.away === ev.away) ||
      (g.away === ev.home && g.home === ev.away)
    );
    if (!game) continue;

    const park = game.park;
    const weather = game.weather;
    const wFactor = weatherFactor(weather, park);
    const parkF = park?.hrFactor ?? 1;

    const homePitcher = game.probablePitchers?.home;
    const awayPitcher = game.probablePitchers?.away;

    for (const player of (ev.players || [])) {
      const bInfo = findBatterByName(batters, player.name);
      if (!bInfo) continue; // player not in season stats yet
      const batter = bInfo.batter;
      const batterId = bInfo.id;

      // Determine which lineup this player is on (by scanning both lineups).
      let teamSide = null;
      let lineupOrder = null;
      for (const [side, list] of [["home", game.lineups.home], ["away", game.lineups.away]]) {
        const slot = list.find(l => namesMatch(l.name, player.name));
        if (slot) { teamSide = side; lineupOrder = slot.order; break; }
      }
      // Fallback — if lineup isn't posted, infer team via stats if we can.
      const opposingPitcher = teamSide === "home" ? awayPitcher : teamSide === "away" ? homePitcher : null;

      const savantB = findSavant(savantBatters, batterId);
      const savantP = opposingPitcher ? findSavant(savantPitchers, opposingPitcher.playerId) : null;

      const bFactor = batterFactor(batter, savantB);
      const pFactor = opposingPitcher
        ? pitcherFactor(pitchers[opposingPitcher.playerId], savantP)
        : 1;

      const bSplit = batterSplits[batterId];
      const pSplit = opposingPitcher ? pitcherSplits[opposingPitcher.playerId] : null;
      const platoonF = platoonFactor(bSplit, pSplit, batter.hrPerPA);

      const perPA = LEAGUE_HR_PER_PA * bFactor * pFactor * parkF * wFactor * platoonF;
      const expectedPA = lineupOrder ? (PA_BY_LINEUP[lineupOrder] ?? DEFAULT_PA) : DEFAULT_PA;
      const modelProb = 1 - Math.pow(1 - perPA, expectedPA);

      // Best book price.
      let bestBook = null, bestDec = null, bestAm = null;
      const byBook = {};
      for (const b of player.books) {
        byBook[b.book] = b;
        if (bestDec == null || b.overDecimal > bestDec) {
          bestDec = b.overDecimal;
          bestBook = b.book;
          bestAm = b.overAmerican;
        }
      }
      if (bestDec == null) continue;
      const booksImplied = impliedProb(bestDec);
      const edgePct = (modelProb - booksImplied) * 100;
      const evPct = (modelProb * (bestDec - 1) - (1 - modelProb)) * 100;

      out.push({
        name: player.name,
        batterId,
        team: teamSide === "home" ? game.home : teamSide === "away" ? game.away : null,
        opponent: teamSide === "home" ? game.away : teamSide === "away" ? game.home : null,
        side: teamSide,
        game: {
          home: game.home, away: game.away, commence: game.commence,
          venue: game.venue, outdoor: game.outdoor,
          park: game.park || null,
        },
        opposingPitcher: opposingPitcher || null,
        lineupOrder,
        lineupConfirmed: game.lineupsConfirmed,
        modelProb,
        booksImplied,
        edgePct,
        evPct,
        bestBook, bestAmerican: bestAm, bestDecimal: bestDec,
        byBook,
        inputs: {
          leagueBase: LEAGUE_HR_PER_PA,
          batterFactor: +bFactor.toFixed(3),
          pitcherFactor: +pFactor.toFixed(3),
          parkFactor: parkF,
          weatherFactor: +wFactor.toFixed(3),
          platoonFactor: +platoonF.toFixed(3),
          perPA: +perPA.toFixed(4),
          expectedPA,
        },
        weather: weather || null,
        savantB: savantB || null,
        savantP: savantP || null,
      });
    }
  }

  // Sort by EV (books-relative edge), then by raw model probability.
  out.sort((a, b) => (b.evPct - a.evPct) || (b.modelProb - a.modelProb));
  return out;
}
