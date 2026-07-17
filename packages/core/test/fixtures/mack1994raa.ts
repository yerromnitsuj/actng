import type { Triangle } from "../../src/types.js";

/**
 * Published validation data, transcribed from the primary source:
 *
 * Mack, T. (1994), "Measuring the Variability of Chain Ladder Reserve
 * Estimates", Casualty Actuarial Society Forum Spring 1994, pp. 101-182.
 * Running example triangle (p. 126): RAA "Historical Loss Development
 * Study", 1991 Edition, p. 96 — Automatic Facultative business, General
 * Liability (excluding Asbestos & Environmental), cumulative incurred case
 * losses in $1000, accident years 1981 (i=1) through 1990 (i=10).
 *
 * The PDF's OCR text layer mangles digits; values were transcribed from the
 * rendered page images and cross-validated: every individual development
 * factor recomputed from this triangle matches the printed F table (pp.
 * 160/166) to its printed rounding, and every Appendix G/H statistic
 * recomputes exactly.
 *
 * Appendix G (test for correlations between subsequent development
 * factors): rank sums sum(s-r)^2 = 68, 74, 20, 24, 6, 6, 0 for k = 2..8;
 * T_k = 4/21, -9/28, 3/7, -1/5, 2/5, -1/2, 1 with weights I-k-1 = 7..1;
 * T = .070, Var(T) = 1/28, 50% bounds +/- .67/sqrt(28) = +/- .127;
 * "the hypothesis of having uncorrelated development factors is not
 * rejected".
 *
 * Appendix H (calendar-year test): Z = 14, E(Z) = 12.875,
 * Var(Z) = 3.9785, 95% interval (8.886, 16.864); "not rejected".
 */

const N = null;

export const raa: Triangle = {
  kind: "incurred",
  origins: ["1981", "1982", "1983", "1984", "1985", "1986", "1987", "1988", "1989", "1990"],
  ages: [12, 24, 36, 48, 60, 72, 84, 96, 108, 120],
  values: [
    [5012, 8269, 10907, 11805, 13539, 16181, 18009, 18608, 18662, 18834],
    [106, 4285, 5396, 10666, 13782, 15599, 15496, 16169, 16704, N],
    [3410, 8992, 13873, 16141, 18735, 22214, 22863, 23466, N, N],
    [5655, 11555, 15766, 21266, 23425, 26083, 27067, N, N, N],
    [1092, 9565, 15836, 22169, 25955, 26180, N, N, N, N],
    [1513, 6445, 11702, 12935, 15852, N, N, N, N, N],
    [557, 4020, 10946, 12314, N, N, N, N, N, N],
    [1351, 6947, 13112, N, N, N, N, N, N, N],
    [3133, 5395, N, N, N, N, N, N, N, N],
    [2063, N, N, N, N, N, N, N, N, N],
  ],
};

/** Appendix G published values (correlation test on the RAA triangle). */
export const raaCorrelationPublished = {
  k: [2, 3, 4, 5, 6, 7, 8],
  sumDSquared: [68, 74, 20, 24, 6, 6, 0],
  Tk: [4 / 21, -9 / 28, 3 / 7, -1 / 5, 2 / 5, -1 / 2, 1],
  weights: [7, 6, 5, 4, 3, 2, 1],
  T: 0.07,
  varT: 1 / 28,
  bound: 0.67 / Math.sqrt(28),
  correlated: false,
};

/** Appendix H published values (calendar-year test on the RAA triangle). */
export const raaCalendarYearPublished = {
  Z: 14,
  EZ: 12.875,
  VarZ: 3.9785,
  interval95: [8.886, 16.864] as const,
  rejected: false,
};

/** p. 126: volume-weighted (chain ladder) age-to-age factors, as printed. */
export const raaVolumeWeightedFactors = [
  2.999, 1.624, 1.271, 1.172, 1.113, 1.042, 1.033, 1.017, 1.009,
];
