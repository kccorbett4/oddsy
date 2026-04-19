// Shared EV / de-vig math. The only caller today is StrategyBuilder,
// but keeping the helpers isolated means future consumers (the HR page,
// a future arb finder) don't re-duplicate the same math again.
//
// Two-way de-vig uses the power-margin (Shin-style) method: find the
// exponent k such that p1^k + p2^k = 1, then the fair probability for
// each side is p_i^k. This corrects for favorite-longshot bias that the
// simpler multiplicative method (p_i / sum) gets wrong — multiplicative
// normalization scales both sides proportionally and systematically
// overestimates longshot fair probs at the expense of favorites.

export const impliedFromAmerican = (odds) => {
  if (!Number.isFinite(odds)) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
};

export const americanToDecimal = (odds) => {
  if (!Number.isFinite(odds)) return null;
  return odds >= 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
};

// Power-margin de-vig for a two-way market.
// p1, p2 are raw implied probs (each = 1 / decimal_odds).
// Returns { fair1, fair2, k, vig } or null if the market is malformed.
export function powerDevig(p1, p2) {
  if (!Number.isFinite(p1) || !Number.isFinite(p2)) return null;
  if (p1 <= 0 || p2 <= 0 || p1 >= 1 || p2 >= 1) return null;
  const sum = p1 + p2;
  if (sum <= 1.0) return { fair1: p1, fair2: p2, k: 1, vig: 0 }; // no vig
  if (sum > 1.5) return null; // nonsense spread — skip
  // Monotonic binary search on k. At k=0, p^k = 1 for both → sum = 2.
  // As k → ∞, both p^k → 0 → sum → 0. So sum is strictly decreasing
  // in k over (0, ∞), guaranteeing a unique solution.
  let lo = 0.01, hi = 5, k = 1;
  for (let i = 0; i < 40; i++) {
    k = (lo + hi) / 2;
    const s = Math.pow(p1, k) + Math.pow(p2, k);
    if (Math.abs(s - 1) < 1e-9) break;
    if (s > 1) lo = k; else hi = k;
  }
  return {
    fair1: Math.pow(p1, k),
    fair2: Math.pow(p2, k),
    k,
    vig: sum - 1,
  };
}

// EV as a percentage, given an American odds price and our fair prob estimate.
export const calcEV = (americanOdds, fairProb) => {
  const payout = americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
  return (fairProb * payout - (1 - fairProb)) * 100;
};
