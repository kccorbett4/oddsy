// Home Run Hunter 2.0 — synthesized from 6 parallel math agents.
//
// Replaces the v1 chain (LEAGUE × batterFactor × pitcherFactor × envFactor)
// with a calibrated, market-anchored pipeline:
//
//   1. xHR/PA from contact-quality (Statcast: barrel%, EV, xISO, LA proxy)
//      with PER-METRIC Bayesian priors (barrel% stabilizes ~80 PA;
//      raw HR/PA needs ~500).
//
//   2. Pitcher factor decomposed into (a) sticky contact-allowed quality
//      and (b) heavily-regressed HR/FB residual; blended with bullpen
//      based on lineup-slot starter share.
//
//   3. Environmental factor from humid-air density physics + wind
//      decomposed by handedness (pull / CF / opposite), with widened
//      [0.65, 1.45] clamp since we removed the v1 double-counting.
//
//   4. Opportunity model uses Poisson aggregation over a PA-count PMF
//      (per lineup slot, home/away), with TTO multipliers per turn
//      through the order, splitting starter vs bullpen exposure.
//
//   5. Calibration in log-odds space against the no-vig consensus
//      probability across books, with confidence tiers shrinking the
//      blend weight and the result toward league mean for thin data.
//
//   6. EV computed against the de-vigged consensus (not 1/bestDecimal).
//      Picks bucketed into Locks / Value / Longshots with Kelly sizing.
//
// All thresholds and coefficients come from the agent specs. Where the
// scrape doesn't yet expose a field (FB%, parkHrFactorL/R, parkClim,
// L30 windows), we use the league prior and fall back gracefully.

// ──────────────────────────────────────────────────────────────────
// League constants (recalibrate annually).
const LG = {
  HR_PER_PA: 0.034,      // 2024 league HR rate per PA
  HR_PER_TBF: 0.030,     // pitcher HR/batters-faced
  BARREL_PER_PA: 0.075,  // Savant league mean
  BARREL_PER_BIP: 0.085,
  HARD_HIT_PCT: 39.5,    // %
  AVG_EV: 89.0,          // mph
  AVG_LA: 12.5,          // degrees
  XISO: 0.165,
  XSLG: 0.405,
  FB_PCT: 0.36,          // fly-ball share of BIP
  HR_PER_FB: 0.105,      // HR per fly ball — the regression target
  K_PCT: 0.225,
  BB_PCT: 0.085,
  SWEET_SPOT_LA_LO: 8,
  SWEET_SPOT_LA_HI: 32,
};

// Per-metric Bayesian prior strengths (Carleton stabilization points).
const PRIOR = {
  HR_PER_PA: 500,        // raw HR/PA — noisy
  BARREL_PER_PA: 80,     // sticky, stabilizes fast
  HARD_HIT: 100,
  AVG_EV: 50,
  XISO: 120,
  PITCHER_HR_PER_TBF: 500,
  PITCHER_BARREL: 250,
  HR_PER_FB: 600,        // very heavy — HR/FB is mostly luck
  BATTER_PLATOON: 120,
};

// Final clamps tuned to physical reality.
const ENV_FACTOR_MIN = 0.65;
const ENV_FACTOR_MAX = 1.45;
const PER_PA_MIN = 0.005;
const PER_PA_MAX = 0.105;       // ~3x league = Bonds-2001 ceiling
const GAME_PROB_MAX = 0.40;     // sanity: nobody is ever above ~30% real

// Vig prior used when only one side of the prop is offered.
const VIG_PRIOR = 0.06;

// Sharpness weights for de-vig aggregation across books.
const SHARP = {
  Pinnacle: 2.0,
  Circa: 1.8,
  BetOnline: 1.4,
  "BetOnline.ag": 1.4,
  BookMaker: 1.4,
  Bet365: 1.2,
  // US regulated
  DraftKings: 1.0,
  FanDuel: 1.0,
  BetMGM: 1.0,
  Caesars: 1.0,
  "ESPN BET": 1.0,
  Fanatics: 1.0,
  "Hard Rock Bet": 1.0,
  "Hard Rock": 1.0,
  Bovada: 0.9,
  BetRivers: 0.9,
  PointsBet: 0.8,
  MyBookie: 0.7,
  Fliff: 0.7,
  betPARX: 0.7,
  ReBet: 0.7,
  "theScore Bet": 0.9,
  "Bally Bet": 0.7,
};
const sharpnessFor = (book) => SHARP[book] ?? 1.0;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const safeNum = (x, fallback = null) => (Number.isFinite(x) ? x : fallback);
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const logit = (p) => Math.log(p / (1 - p));

// Beta-binomial shrinkage toward league rate.
function shrinkRate(observedCount, n, leagueRate, prior) {
  if (!Number.isFinite(observedCount) || !Number.isFinite(n) || n < 0) return leagueRate;
  return (observedCount + leagueRate * prior) / (n + prior);
}
// Generic shrinkage of a continuous metric (e.g., barrel%, hard-hit%).
function shrinkMetric(observedRate, n, leagueRate, prior) {
  if (!Number.isFinite(observedRate) || !Number.isFinite(n)) return leagueRate;
  return (observedRate * n + leagueRate * prior) / (n + prior);
}

// ──────────────────────────────────────────────────────────────────
// Wind / direction helpers.
// MLB convention: 0° = North, increasing clockwise.
// Wind direction is reported as where it's COMING FROM, so flip 180°
// to get the direction it's blowing TOWARD.

function projectWind(windDirDeg, windMph, bearingDeg) {
  if (windDirDeg == null || windMph == null || bearingDeg == null) return 0;
  const blowingToward = (windDirDeg + 180) % 360;
  const diff = ((blowingToward - bearingDeg + 540) % 360) - 180;
  return windMph * Math.cos((diff * Math.PI) / 180);
}

// Without explicit LF/RF bearings in the parks data, approximate them as
// CF ± 45°. This is correct to within a few degrees for almost every park.
function bearings(park) {
  const cf = safeNum(park?.cfBearing, 0);
  return {
    cf,
    lf: (cf - 45 + 360) % 360,
    rf: (cf + 45) % 360,
  };
}

// ──────────────────────────────────────────────────────────────────
// Air density (humid air, ideal-gas + Tetens saturation pressure).
// Returns kg/m³.
function humidAirDensity(tempF, humidityPct, pressureHpa) {
  const Tc = (tempF - 32) * (5 / 9);
  const Tk = Tc + 273.15;
  const Psat = 6.1078 * Math.pow(10, (7.5 * Tc) / (237.3 + Tc)); // hPa
  const Pv = (humidityPct / 100) * Psat;                         // hPa
  const Pd = pressureHpa - Pv;                                   // hPa
  // Convert hPa → Pa, divide by R*T.
  const Rd = 287.058; const Rv = 461.495;
  return (Pd * 100) / (Rd * Tk) + (Pv * 100) / (Rv * Tk);
}

// League-mean reference air density (≈75°F, 50% RH, sea level pressure).
const RHO_REF = humidAirDensity(75, 50, 1013);

// ──────────────────────────────────────────────────────────────────
// Stage A — Batter intrinsic xHR/PA from Statcast contact quality.
//
// Returns the batter's per-PA HR rate vs a league-average pitcher
// in a neutral park. Pitcher / park / weather are applied later.
function xHRperPA(batter, savantB, splits) {
  // Season-level metrics (with PA-aware shrinkage per metric).
  const pa = safeNum(batter?.pa, 0);
  const hr = safeNum(batter?.hr, 0);

  // 1) Raw HR/PA shrunk hard.
  const seasonHrPerPA = shrinkRate(hr, pa, LG.HR_PER_PA, PRIOR.HR_PER_PA);

  // 2) Statcast quality metrics (each shrunk individually).
  const barrelObs = safeNum(savantB?.barrelPerPA, null);
  const hardHitObs = safeNum(savantB?.hardHitPct, null);
  const evObs = safeNum(savantB?.avgEV, null);
  const laObs = safeNum(savantB?.avgLA, null);
  const xisoObs = safeNum(savantB?.xiso, null);

  // Savant's barrelPerPA arrives as a percentage (e.g., 7.5 not 0.075).
  // Normalize to fraction.
  const barrelObsFrac = barrelObs != null ? barrelObs / 100 : null;
  const hardHitObsFrac = hardHitObs != null ? hardHitObs / 100 : null;

  const barrel = shrinkMetric(barrelObsFrac, pa, LG.BARREL_PER_PA, PRIOR.BARREL_PER_PA);
  const hardHit = shrinkMetric(hardHitObsFrac, pa, LG.HARD_HIT_PCT / 100, PRIOR.HARD_HIT);
  const ev = shrinkMetric(evObs, pa, LG.AVG_EV, PRIOR.AVG_EV);
  const xiso = shrinkMetric(xisoObs, pa, LG.XISO, PRIOR.XISO);

  // Sweet-spot proxy: how close avg LA is to the 25-30° HR launch sweet
  // spot. We don't have full LA distribution, so we use a Gaussian-style
  // bell around 27.5° with σ=12. Penalizes ground-ball avg LA (low values).
  let sweetSpotMult;
  if (laObs == null) {
    sweetSpotMult = 1.0;
  } else {
    const optimalLA = 27.5;
    const sigma = 12;
    const dist = (laObs - optimalLA) / sigma;
    // exp(-d²/2) peaks at 1.0 when laObs=27.5; ~0.6 at 18° avg LA;
    // ~0.2 at 0° (worm-burner). Re-scale so league avg (12.5°) → 1.0.
    const raw = Math.exp(-(dist * dist) / 2);
    const leagueRaw = Math.exp(-Math.pow((LG.AVG_LA - optimalLA) / sigma, 2) / 2);
    sweetSpotMult = clamp(raw / leagueRaw, 0.65, 1.50);
  }

  // 3) Stage-A composite per-BBE xHR rate (linear in standardized signals).
  // Coefficients from Agent 1: barrel dominant, EV second, xISO residual.
  const xHRperBBE = clamp(
      0.040
    + 1.85 * (barrel - LG.BARREL_PER_PA)
    + 0.0040 * (ev - LG.AVG_EV)
    + 0.18 * (xiso - LG.XISO)
    + 0.30 * (hardHit - LG.HARD_HIT_PCT / 100),
    0.005, 0.30
  );

  // Stage B — convert per-BBE to per-PA. We don't have K%/BB% in the
  // current Savant scrape, so use league-average (1 - K%)(1 - BB%) ≈ 0.71.
  // The 1.12 calibration constant aligns league output to ~0.034 HR/PA.
  const contactFraction = (1 - LG.K_PCT) * (1 - LG.BB_PCT);
  let perPA = xHRperBBE * contactFraction * 1.12 * sweetSpotMult;

  // Blend in season HR/PA at low weight as an anchor to actual outcomes.
  // Quality-of-contact is the truth signal; HR/PA is the noisy verifier.
  perPA = 0.85 * perPA + 0.15 * seasonHrPerPA;

  // Platoon multiplier from BvP-hand splits, shrunk by BATTER_PLATOON prior.
  let platoonMult = 1.0;
  if (splits?.vsL || splits?.vsR) {
    // Determined later when we know the pitcher hand; return base + handle
    // platoon at composition time.
  }

  return {
    perPA: clamp(perPA, PER_PA_MIN, PER_PA_MAX),
    raw: { barrel, hardHit, ev, xiso, sweetSpotMult, seasonHrPerPA, xHRperBBE },
    platoonMult, // 1.0 placeholder — final platoon applied in compose()
  };
}

// Apply platoon adjustment given the opposing pitcher hand.
function applyPlatoon(splits, batterHand, pitcherHand, baseRate) {
  if (!splits || !pitcherHand) return 1.0;
  let bH = batterHand || splits.batSide || null;
  if (bH === "S") bH = pitcherHand === "L" ? "R" : "L"; // switch = opposite
  if (!bH) return 1.0;

  const splitKey = pitcherHand === "L" ? "vsL" : "vsR";
  const row = splits?.[splitKey];
  if (!row || !row.hrPerPA || !baseRate) return 1.0;

  const splitPa = safeNum(row.pa, 0);
  // Bayesian-shrink the split's HR/PA toward overall season rate.
  const shrunk = shrinkRate(row.hrPerPA * splitPa, splitPa, baseRate, PRIOR.BATTER_PLATOON);
  const ratio = shrunk / baseRate;
  return clamp(ratio, 0.75, 1.35);
}

// ──────────────────────────────────────────────────────────────────
// Pitcher factor — decompose into contact-quality (sticky) + HR/FB residual
// (heavily regressed). Returns a multiplier on the batter's baseline xHR/PA.
function pitcherFactor(pitcher, savantP, _opposingBatterHand) {
  const ip = safeNum(pitcher?.ip, 0);
  const tbf = safeNum(pitcher?.tbf, ip * 4.3);
  const hrAllowed = safeNum(pitcher?.hr, 0);

  // Contact-quality z-scores (sticky skill).
  const barrelObs = safeNum(savantP?.barrelPerPA, null);
  const hardHitObs = safeNum(savantP?.hardHitPct, null);
  const evObs = safeNum(savantP?.avgEV, null);

  const barrel = barrelObs != null
    ? shrinkMetric(barrelObs / 100, tbf, LG.BARREL_PER_PA, PRIOR.PITCHER_BARREL)
    : LG.BARREL_PER_PA;
  const hardHit = hardHitObs != null
    ? shrinkMetric(hardHitObs / 100, tbf, LG.HARD_HIT_PCT / 100, PRIOR.HARD_HIT)
    : LG.HARD_HIT_PCT / 100;
  const ev = evObs != null
    ? shrinkMetric(evObs, tbf, LG.AVG_EV, PRIOR.AVG_EV)
    : LG.AVG_EV;

  const zBarrel = (barrel - LG.BARREL_PER_PA) / 0.018;
  const zHard = (hardHit - LG.HARD_HIT_PCT / 100) / 0.045;
  const zEV = (ev - LG.AVG_EV) / 1.4;
  const zContact = 0.55 * zBarrel + 0.30 * zHard + 0.15 * zEV;
  const contactMult = clamp(1 + 0.22 * zContact, 0.65, 1.45);

  // HR/FB residual — heavily regressed (HR/9 is luck-driven).
  // Without scraped FB%, use league prior 36%.
  const fbCount = tbf * LG.FB_PCT;
  const hrFbShrunk = shrinkRate(hrAllowed, fbCount, LG.HR_PER_FB, PRIOR.HR_PER_FB);
  const hrFbMult = clamp(
    1 + 0.35 * (hrFbShrunk - LG.HR_PER_FB) / LG.HR_PER_FB,
    0.85, 1.20
  );

  // Geometric blend (Agent 2 spec).
  // We don't have ballMult (FB%/GB%), so defer — exponents 0.7/0.3 instead
  // of 0.55/0.30/0.15.
  let starterMult = Math.pow(contactMult, 0.7) * Math.pow(hrFbMult, 0.3);
  starterMult = clamp(starterMult, 0.55, 1.65);

  return {
    starterMult,
    contactMult,
    hrFbMult,
    barrel,
    hardHit,
    ev,
    hrFbShrunk,
  };
}

// Per-lineup-slot starter share (from Agent 2/4 — empirical from 5.2 IP avg).
const STARTER_SHARE_BY_SLOT = {
  1: 0.66, 2: 0.65, 3: 0.64, 4: 0.63, 5: 0.61,
  6: 0.59, 7: 0.57, 8: 0.56, 9: 0.54,
};
// League-average bullpen multiplier when team data unavailable.
const DEFAULT_BULLPEN_MULT = 1.00;
// Bullpen rate is ~92% of starter rate league-wide (better stuff per PA).
const BULLPEN_RATE_RATIO = 0.92;
// Times-through-order multipliers (Agent 4).
const TTO_MULT = [0.94, 1.00, 1.08, 1.12]; // first 4 turns
const BULLPEN_FIRST_TIME_MULT = 0.94;

function starterShareFor(lineupSlot) {
  return STARTER_SHARE_BY_SLOT[lineupSlot] ?? 0.61;
}

// ──────────────────────────────────────────────────────────────────
// Environmental factor — humid-air density physics + handedness-aware
// wind decomposition. We don't yet have parkClim or parkHrFactorL/R, so
// we treat the existing single-handed park HR factor as neutral baseline
// and apply only the deviation-from-typical density and wind effects.
function envFactor(park, weather, batterHand, pitcherHand) {
  if (!park) return { factor: 1.0, density: 1.0, wind: 1.0, rain: 1.0, parkF: 1.0 };

  const parkF = safeNum(park.hrFactor, 1.0);
  // Closed roof / dome → climate-controlled; only park factor matters.
  if (!park.outdoor || !weather) {
    return {
      factor: clamp(parkF, ENV_FACTOR_MIN, ENV_FACTOR_MAX),
      density: 1.0, wind: 1.0, rain: 1.0, parkF,
    };
  }

  // Effective handedness for switch hitters.
  let effHand = batterHand;
  if (effHand === "S") effHand = pitcherHand === "L" ? "R" : "L";

  // Air-density deviation from league reference.
  const tempF = safeNum(weather.tempF, 75);
  const rh = safeNum(weather.humidityPct, 50);
  const p = safeNum(weather.pressureHpa, 1013);
  const rho = humidAirDensity(tempF, rh, p);
  const rhoDev = rho / RHO_REF - 1;
  const extraCarryFt = -60 * rhoDev;
  let densityFactor = 1 + 0.018 * extraCarryFt;
  densityFactor = clamp(densityFactor, 0.85, 1.20);

  // Wind decomposition by hit-direction weights.
  const { lf, cf, rf } = bearings(park);
  const windMph = safeNum(weather.windMph, 0);
  const windDir = safeNum(weather.windDirDeg, null);
  const projL = projectWind(windDir, windMph, lf);
  const projC = projectWind(windDir, windMph, cf);
  const projR = projectWind(windDir, windMph, rf);

  // Pull/CF/Oppo weights — RHB pulls to LF, LHB pulls to RF. Default RHB.
  const w_pull = 0.60, w_cf = 0.25, w_oppo = 0.15;
  let weighted;
  if (effHand === "L") {
    weighted = w_oppo * projL + w_cf * projC + w_pull * projR;
  } else {
    weighted = w_pull * projL + w_cf * projC + w_oppo * projR;
  }
  // De-weight wind effect since the park HR factor partially encodes the
  // park's typical wind climate already; 0.7 scales the daily-wind credit.
  const windFactor = clamp(Math.exp(0.012 * 0.7 * weighted), 0.78, 1.25);

  // Rain haircut.
  const rainFactor = (safeNum(weather.precipIn, 0) > 0.05
                     && safeNum(weather.precipProb, 0) >= 50) ? 0.96 : 1.0;

  const raw = parkF * densityFactor * windFactor * rainFactor;
  return {
    factor: clamp(raw, ENV_FACTOR_MIN, ENV_FACTOR_MAX),
    density: densityFactor,
    wind: windFactor,
    rain: rainFactor,
    parkF,
    rho,
    rhoDev,
    extraCarryFt,
  };
}

// ──────────────────────────────────────────────────────────────────
// Opportunity model — PA-count PMF per slot/side, Poisson aggregation
// over per-PA rate that depends on starter vs bullpen and TTO.

// Home-team PMF (PA = 3, 4, 5, 6) for each lineup slot (Agent 4).
const PMF_HOME = {
  1: [0.05, 0.40, 0.45, 0.10],
  2: [0.07, 0.42, 0.43, 0.08],
  3: [0.10, 0.45, 0.38, 0.07],
  4: [0.13, 0.48, 0.33, 0.06],
  5: [0.18, 0.50, 0.27, 0.05],
  6: [0.22, 0.52, 0.22, 0.04],
  7: [0.28, 0.53, 0.16, 0.03],
  8: [0.33, 0.54, 0.11, 0.02],
  9: [0.38, 0.53, 0.08, 0.01],
};
// Away PMF — slots 1-4 get extra mass on higher PA counts (always bat top 9).
const AWAY_PMF_BUMP = { 1: 0.04, 2: 0.04, 3: 0.04, 4: 0.02, 5: 0.02, 6: 0.02, 7: 0.01, 8: 0.01, 9: 0.01 };

function pmfFor(slot, side) {
  const base = PMF_HOME[slot] || PMF_HOME[5];
  if (side !== "away") return base;
  // Shift `bump` mass from P(4) → P(5) to model the extra at-bat.
  const bump = AWAY_PMF_BUMP[slot] || 0.01;
  return [base[0], base[1] - bump, base[2] + bump, base[3]];
}

// Per-PA rate with TTO multiplier given which PA index this is, the
// starter's expected total batters faced, and the slot the batter occupies.
function rateForPaIndex(paIndex, slot, paStarter, perPA_starter, perPA_bullpen) {
  // PA paIndex (1-indexed). Batter's i-th PA is at lineup position
  // `(slot - 1 + (paIndex - 1) * 9) + 1`. Compare to starter's BF.
  const totalBatterUpToHisPA = (slot - 1) + (paIndex - 1) * 9 + 1;
  if (totalBatterUpToHisPA <= paStarter) {
    // Versus starter — TTO = paIndex (capped at 4).
    const turn = Math.min(paIndex, 4);
    return perPA_starter * TTO_MULT[turn - 1];
  }
  // Versus bullpen — first time through.
  return perPA_bullpen * BULLPEN_FIRST_TIME_MULT;
}

// Aggregate game-level HR probability via Poisson over the PA PMF.
function gameLevelHrProb(perPA_starter, perPA_bullpen, slot, side, ipStarterExp, ctxMult = 1.0) {
  const pmf = pmfFor(slot, side);
  // Starter total batters faced ≈ IP × 4.3.
  const paStarter = (Number.isFinite(ipStarterExp) ? ipStarterExp : 5.2) * 4.3;

  // Compute λ(n) for n = 3, 4, 5, 6.
  let agg = 0;
  for (let i = 0; i < 4; i++) {
    const n = 3 + i;
    let lambda = 0;
    for (let pa = 1; pa <= n; pa++) {
      lambda += rateForPaIndex(pa, slot, paStarter, perPA_starter, perPA_bullpen);
    }
    lambda *= ctxMult;
    const probHrInGameOfLengthN = 1 - Math.exp(-lambda);
    agg += pmf[i] * probHrInGameOfLengthN;
  }
  return clamp(agg, 0, GAME_PROB_MAX);
}

// ──────────────────────────────────────────────────────────────────
// Calibration — log-space chain shrinkage, no-vig consensus blend.
// Apply when raw chain product is "extreme" to dampen miscalibrated tails.
function shrinkChainProduct(productRaw) {
  const d = Math.log(productRaw);
  const ad = Math.abs(d);
  let lambda;
  if (ad <= 0.20) lambda = 1.0;
  else if (ad <= 0.50) lambda = 1.0 - 0.50 * (ad - 0.20) / 0.30;
  else lambda = 0.50;
  return Math.exp(d * lambda);
}

// Confidence tier from input-availability flags.
function confidenceTier(flags) {
  if (flags.lineupConfirmed
      && flags.batterPa >= 150
      && flags.pitcherTbf >= 80
      && flags.weatherAvailable
      && flags.savantPopulated) return "High";
  if (flags.lineupConfirmed
      && flags.batterPa >= 60
      && flags.pitcherTbf >= 40) return "Medium";
  return "Low";
}

// No-vig consensus probability across books, sharpness-weighted median.
function noVigConsensus(byBook) {
  const samples = [];
  for (const [bookName, b] of Object.entries(byBook || {})) {
    const overDec = safeNum(b.overDecimal, null);
    if (!overDec || overDec <= 1) continue;
    const overImp = 1 / overDec;
    const underDec = safeNum(b.underDecimal, null);
    let pNoVig;
    if (underDec && underDec > 1) {
      const underImp = 1 / underDec;
      pNoVig = overImp / (overImp + underImp);
    } else {
      // Fair-vig fallback.
      pNoVig = overImp * (1 - VIG_PRIOR);
    }
    samples.push({ p: pNoVig, w: sharpnessFor(bookName) });
  }
  if (samples.length === 0) return null;
  // Weighted median.
  samples.sort((a, b) => a.p - b.p);
  const totalW = samples.reduce((a, s) => a + s.w, 0);
  let cum = 0;
  for (const s of samples) {
    cum += s.w;
    if (cum >= totalW / 2) return s.p;
  }
  return samples[samples.length - 1].p;
}

// Calibrate raw model probability against no-vig consensus in logit space,
// then shrink toward league mean for low-confidence picks.
function calibrate(rawModelProb, noVigCons, tier) {
  const alpha = { High: 0.65, Medium: 0.50, Low: 0.30 }[tier];
  let blended;
  if (noVigCons == null) {
    blended = rawModelProb;
  } else {
    const lm = logit(clamp(rawModelProb, 1e-4, 1 - 1e-4));
    const lc = logit(clamp(noVigCons, 1e-4, 1 - 1e-4));
    blended = sigmoid(alpha * lm + (1 - alpha) * lc);
  }
  const shrink = { High: 0.00, Medium: 0.10, Low: 0.25 }[tier];
  const pLg = LG.HR_PER_PA * 4.2; // ~14% league avg per game
  const final = (1 - shrink) * blended + shrink * pLg;
  return clamp(final, 0.001, 0.40);
}

// ──────────────────────────────────────────────────────────────────
// Odds helpers + Kelly.
export const americanToDecimal = (a) => {
  if (!Number.isFinite(a)) return null;
  return a >= 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
};
export const decimalToAmerican = (d) => {
  if (!Number.isFinite(d) || d <= 1) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
};
const impliedProb = (dec) => (dec > 1 ? 1 / dec : null);

function kelly(p, dec) {
  const b = dec - 1;
  if (b <= 0) return { full: 0, quarter: 0, capped: 0 };
  const q = 1 - p;
  const full = (b * p - q) / b;
  return {
    full: Math.max(0, full),
    quarter: Math.max(0, full / 4),
    capped: Math.min(Math.max(0, full / 4), 0.05),
  };
}

// ──────────────────────────────────────────────────────────────────
// Name match helpers — same logic as v1 but kept here so v2 is standalone.
function normalizeName(s) {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
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
  if (A[A.length - 1] !== B[B.length - 1]) return false;
  if (A[0][0] !== B[0][0]) return false;
  return true;
}
function findBatterByName(batters, name) {
  for (const [id, b] of Object.entries(batters)) {
    if (b.name && namesMatch(b.name, name)) return { id, batter: b };
  }
  return null;
}
function findSavant(savant, mlbamId) {
  if (!mlbamId) return null;
  return savant?.[mlbamId] || savant?.[String(mlbamId)] || null;
}

// ──────────────────────────────────────────────────────────────────
// Main pipeline: take ctx + odds payloads and return ranked v2 projections.
export function rankHrProjectionsV2(ctx, odds) {
  if (!ctx || !odds?.events) return [];
  const games = ctx.games || [];
  const batters = ctx.batters || {};
  const pitchers = ctx.pitchers || {};
  const savantBatters = ctx.savantBatters || {};
  const savantPitchers = ctx.savantPitchers || {};
  const batterSplits = ctx.batterSplits || {};

  const out = [];
  for (const ev of odds.events) {
    const game = games.find(g =>
      (g.home === ev.home && g.away === ev.away) ||
      (g.away === ev.home && g.home === ev.away)
    );
    if (!game) continue;

    const homePitcher = game.probablePitchers?.home;
    const awayPitcher = game.probablePitchers?.away;
    const weatherAvail = !!game.weather && game.outdoor !== false;

    for (const player of (ev.players || [])) {
      // Resolve player to lineup slot (same logic as v1).
      const lineupHits = [];
      for (const [side, list] of [["home", game.lineups.home], ["away", game.lineups.away]]) {
        for (const slot of (list || [])) {
          if (namesMatch(slot.name, player.name)) lineupHits.push({ side, slot });
        }
      }
      let batter = null, batterId = null, teamSide = null, lineupOrder = null, batterHand = null;
      if (lineupHits.length === 1) {
        const { side, slot } = lineupHits[0];
        teamSide = side;
        lineupOrder = slot.order;
        batterId = slot.playerId;
        batter = batters[batterId] || batters[String(batterId)] || { name: slot.name, hr: 0, pa: 0 };
        batterHand = slot.batSide || batterSplits[batterId]?.batSide || null;
      } else if (lineupHits.length > 1) {
        continue; // ambiguous
      } else if (game.lineupsConfirmed) {
        continue; // not starting
      } else {
        const bInfo = findBatterByName(batters, player.name);
        if (!bInfo) continue;
        batter = bInfo.batter;
        batterId = bInfo.id;
        lineupOrder = 5;
        batterHand = batterSplits[batterId]?.batSide || null;
      }

      const opposingPitcher = teamSide === "home" ? awayPitcher : teamSide === "away" ? homePitcher : null;
      const pitcherHand = opposingPitcher?.pitchHand || null;

      const savantB = findSavant(savantBatters, batterId);
      const savantP = opposingPitcher ? findSavant(savantPitchers, opposingPitcher.playerId) : null;

      // Stage A — batter intrinsic xHR/PA.
      const xb = xHRperPA(batter, savantB, batterSplits[batterId]);

      // Platoon adjustment (now that we know pitcher hand).
      const platoonMult = applyPlatoon(
        batterSplits[batterId], batterHand, pitcherHand, xb.raw.seasonHrPerPA
      );

      // Stage B — pitcher factor.
      const pInfo = opposingPitcher
        ? pitcherFactor(pitchers[opposingPitcher.playerId], savantP, batterHand)
        : { starterMult: 1.0, contactMult: 1.0, hrFbMult: 1.0 };

      // Stage C — environment.
      const env = envFactor(game.park, game.weather, batterHand, pitcherHand);

      // Compose chain product BEFORE shrinkage.
      const chainRaw = pInfo.starterMult * env.factor * platoonMult;
      const chain = shrinkChainProduct(chainRaw);

      const perPAstarter = clamp(xb.perPA * chain, PER_PA_MIN, PER_PA_MAX);
      const perPAbullpen = clamp(perPAstarter * BULLPEN_RATE_RATIO, PER_PA_MIN, PER_PA_MAX);

      // Stage D — opportunity / Poisson aggregation.
      const ipStarterExp = 5.2; // league avg without per-pitcher data
      const rawModelProb = gameLevelHrProb(perPAstarter, perPAbullpen, lineupOrder, teamSide, ipStarterExp);

      // Stage E — pricing: collect books, compute consensus.
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
      const noVigCons = noVigConsensus(byBook);
      const booksImplied = impliedProb(bestDec);

      // Stage F — confidence + calibration.
      const tier = confidenceTier({
        lineupConfirmed: !!game.lineupsConfirmed,
        batterPa: safeNum(batter?.pa, 0),
        pitcherTbf: safeNum(pitchers[opposingPitcher?.playerId]?.tbf,
                            (pitchers[opposingPitcher?.playerId]?.ip || 0) * 4.3),
        weatherAvailable: weatherAvail,
        savantPopulated: !!savantB,
      });

      const modelProb = calibrate(rawModelProb, noVigCons, tier);

      // Stage G — EV vs offered + edge vs consensus.
      const evPct = (modelProb * (bestDec - 1) - (1 - modelProb)) * 100;
      const edgeVsBookPct = (modelProb - booksImplied) * 100;
      const edgeVsConsensusPct = noVigCons != null ? (modelProb - noVigCons) * 100 : null;

      // Composite score: EV × sqrt(prob) × tier weight.
      const tierMult = { High: 1.0, Medium: 0.85, Low: 0.60 }[tier];
      const score = evPct * Math.sqrt(Math.max(modelProb, 0)) * tierMult;

      const k = kelly(modelProb, bestDec);

      out.push({
        name: player.name,
        batterId,
        team: teamSide === "home" ? game.home : teamSide === "away" ? game.away : null,
        opponent: teamSide === "home" ? game.away : teamSide === "away" ? game.home : null,
        side: teamSide,
        batterHand,
        game: {
          home: game.home, away: game.away, commence: game.commence,
          venue: game.venue, outdoor: game.outdoor, park: game.park || null,
        },
        opposingPitcher: opposingPitcher || null,
        lineupOrder,
        lineupConfirmed: game.lineupsConfirmed,
        rawModelProb,
        modelProb,
        noVigConsensus: noVigCons,
        booksImplied,
        edgeVsBookPct,
        edgeVsConsensusPct,
        evPct,
        score,
        tier,
        kelly: k,
        bestBook, bestAmerican: bestAm, bestDecimal: bestDec,
        byBook,
        weather: game.weather || null,
        savantB: savantB || null,
        savantP: savantP || null,
        inputs: {
          xHRperPA: +xb.perPA.toFixed(4),
          batterChain: {
            barrel: +xb.raw.barrel.toFixed(4),
            ev: +xb.raw.ev.toFixed(2),
            xiso: +xb.raw.xiso.toFixed(3),
            sweetSpotMult: +xb.raw.sweetSpotMult.toFixed(3),
            seasonHrPerPA: +xb.raw.seasonHrPerPA.toFixed(4),
          },
          pitcher: {
            starterMult: +pInfo.starterMult.toFixed(3),
            contactMult: +pInfo.contactMult.toFixed(3),
            hrFbMult: +pInfo.hrFbMult.toFixed(3),
            barrel: +pInfo.barrel.toFixed(4),
            hrFbShrunk: +pInfo.hrFbShrunk.toFixed(4),
          },
          env: {
            factor: +env.factor.toFixed(3),
            density: +env.density.toFixed(3),
            wind: +env.wind.toFixed(3),
            rain: +env.rain.toFixed(3),
            parkF: +env.parkF.toFixed(3),
          },
          platoonMult: +platoonMult.toFixed(3),
          chainRaw: +chainRaw.toFixed(3),
          chainShrunk: +chain.toFixed(3),
          perPAstarter: +perPAstarter.toFixed(4),
          perPAbullpen: +perPAbullpen.toFixed(4),
          starterShare: starterShareFor(lineupOrder),
        },
      });
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Tiered selection — Locks / Value / Longshots (Agent 6).
//
// Inclusion thresholds (every pick must pass these):
//   - modelProb ≥ 0.04
//   - evPct ≥ +2
//   - edgeVsConsensus ≤ +5pp (don't trust runaway model vs market)
//   - bestAmerican ≤ +2000 unless evPct ≥ +10 AND modelProb ≥ 0.05

const PASS_BASE = (p) => {
  if (!(p.modelProb >= 0.04)) return false;
  if (!(p.evPct >= 2)) return false;
  if (p.edgeVsConsensusPct != null && p.edgeVsConsensusPct > 5) return false;
  if (p.bestAmerican > 2000 && !(p.evPct >= 10 && p.modelProb >= 0.05)) return false;
  return true;
};

export function selectTieredPicks(projections) {
  const passed = projections.filter(PASS_BASE);

  const locks = [];
  const value = [];
  const longshots = [];

  for (const p of passed) {
    // Anchor agreement — # of books within 5% relative of consensus.
    const consensus = p.noVigConsensus;
    let anchorCount = 0;
    if (consensus) {
      for (const b of Object.values(p.byBook || {})) {
        const dec = b.overDecimal;
        if (!dec || dec <= 1) continue;
        const pNoVig = (1 / dec) * (1 - VIG_PRIOR);
        if (Math.abs(pNoVig - consensus) / consensus < 0.05) anchorCount++;
      }
    }

    if (p.tier === "High"
        && p.modelProb >= 0.08
        && p.evPct >= 5
        && p.kelly.quarter >= 0.005
        && anchorCount >= 3) {
      locks.push({ ...p, anchorCount, tierLabel: "Lock" });
    } else if ((p.tier === "High" || p.tier === "Medium")
        && p.modelProb >= 0.05
        && p.evPct >= 3) {
      value.push({ ...p, anchorCount, tierLabel: "Value" });
    } else if (p.modelProb >= 0.03
        && p.evPct >= 8
        && p.bestAmerican <= 1500) {
      longshots.push({ ...p, anchorCount, tierLabel: "Longshot" });
    }
  }

  // Sort each by composite score.
  locks.sort((a, b) => b.score - a.score);
  value.sort((a, b) => b.score - a.score);
  longshots.sort((a, b) => b.score - a.score);

  // Cap counts per tier for UI sanity.
  return {
    locks: locks.slice(0, 5),
    value: value.slice(0, 10),
    longshots: longshots.slice(0, 5),
    all: passed,
  };
}
