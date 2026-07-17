import type { Triangle } from "../../src/types.js";

/**
 * Published validation data, transcribed from the primary source:
 *
 * - Quarg, G. & Mack, T. (2004), "Munich Chain Ladder", Blatter der DGVFM
 *   26(4), 597-630; reprinted Variance 2:2 (2008), 266-299. Chapter 3.3
 *   "Concrete example": a fire portfolio, 7 accident years. Transcribed via
 *   docs/research/phase5/munich-chain-ladder-quarg-mack-2004.md from
 *   https://www.casact.org/sites/default/files/2021-07/Munich-Chain-Ladder-Quarg-Mack.pdf
 *
 * The paper warns its results "were calculated with more precision than
 * shown", so retracing from the printed rounded values gives minor
 * discrepancies; computing from the raw triangles (as the engine does)
 * reproduces every printed projected cell within 0.5 absolute.
 *
 * Development ages are printed as development years 1..7; encoded here as
 * 12..84 months per house triangle semantics.
 */

const N = null;

/** Sec 3.3.1 paid triangle P_{i,t}. */
export const qmPaid: Triangle = {
  kind: "paid",
  origins: ["1", "2", "3", "4", "5", "6", "7"],
  ages: [12, 24, 36, 48, 60, 72, 84],
  values: [
    [576, 1804, 1970, 2024, 2074, 2102, 2131],
    [866, 1948, 2162, 2232, 2284, 2348, N],
    [1412, 3758, 4252, 4416, 4494, N, N],
    [2286, 5292, 5724, 5850, N, N, N],
    [1868, 3778, 4648, N, N, N, N],
    [1442, 4010, N, N, N, N, N],
    [2044, N, N, N, N, N, N],
  ],
};

/** Sec 3.3.1 incurred triangle I_{i,t}. */
export const qmIncurred: Triangle = {
  kind: "incurred",
  origins: ["1", "2", "3", "4", "5", "6", "7"],
  ages: [12, 24, 36, 48, 60, 72, 84],
  values: [
    [978, 2104, 2134, 2144, 2174, 2182, 2174],
    [1844, 2552, 2466, 2480, 2508, 2454, N],
    [2904, 4354, 4698, 4600, 4644, N, N],
    [3502, 5958, 6070, 6142, N, N, N],
    [2812, 4882, 4852, N, N, N, N],
    [2642, 4406, N, N, N, N, N],
    [5022, N, N, N, N, N, N],
  ],
};

/** Every printed parameter/result row from Sec 3.3.2-3.3.3. */
export const qmPublished = {
  /** fhat^P for development steps 1->2 ... 6->7 (printed to 3 decimals). */
  paidFactors: [2.437, 1.131, 1.029, 1.021, 1.021, 1.014],
  /** fhat^I. */
  incurredFactors: [1.652, 1.019, 1.0, 1.011, 0.99, 0.996],
  /** sigmahat^P, steps 1->2 ... 5->6 only (sigma_{6->7} is not estimable). */
  sigmaPaid: [13.456, 3.666, 0.482, 0.21, 0.479],
  /** sigmahat^I. */
  sigmaIncurred: [9.727, 2.544, 1.004, 0.12, 0.86],
  /** qhat_s, columns s = 1..7, printed as percentages to 0.1%. */
  qRatios: [0.533, 0.849, 0.928, 0.945, 0.949, 0.96, 0.98],
  /** rhohat^P_s, s = 1..6 (rho_7 is not estimable from one observation). */
  rhoPaid: [14.943, 4.99, 2.167, 1.619, 1.791, 0.236],
  /** rhohat^I_s. */
  rhoIncurred: [5.711, 3.819, 1.918, 1.461, 1.637, 0.222],
  /** Spot values the paper prints from its four residual triangles. */
  residualPins: {
    /** Paid-factor residual, accident year 1, step 1->2. */
    paidFactorAY1: 1.24,
    /** (I/P) residual, accident year 7, column 1. */
    paidRatioAY7: 1.753,
    /** (P/I) residual, accident year 7, column 1. */
    incurredRatioAY7: -1.558,
  },
  /** Regression slopes through the origin over the pooled residual plots. */
  lambdaPaid: 0.64,
  lambdaIncurred: 0.44,
  /**
   * The paper manually set the non-estimable sigma^P_{6->7} and
   * sigma^I_{6->7} to 0.100 for the result quadrangles ("a sounder
   * extrapolation would be used in practice").
   */
  manualLastSigma: 0.1,
  /** Worked first step for accident year 7 (Sec 3.1.2 / 3.3.2). */
  workedStepAY7: {
    mclPaidFactor: 2.768,
    mclIncurredFactor: 1.559,
    paidAge24: 5659,
    incurredAge24: 7828,
    ratioAge24: 0.723,
  },
  /**
   * Sec 3.3.3 MCL result quadrangles: the projected cells only, per accident
   * year, from the first unobserved age through age 84.
   */
  mclProjectedPaid: [
    [],
    [2383],
    [4573, 4597],
    [5967, 6081, 6119],
    [4762, 4848, 4923, 4937],
    [4388, 4493, 4574, 4643, 4656],
    [5659, 6944, 7177, 7330, 7485, 7549],
  ],
  mclProjectedIncurred: [
    [],
    [2444],
    [4618, 4629],
    [6212, 6167, 6176],
    [4885, 4944, 4931, 4950],
    [4567, 4601, 4657, 4646, 4665],
    [7828, 7688, 7644, 7727, 7650, 7650],
  ],
  /** MCL ultimates (paid / incurred) per accident year. */
  mclPaidUltimates: [2131, 2383, 4597, 6119, 4937, 4656, 7549],
  mclIncurredUltimates: [2174, 2444, 4629, 6176, 4950, 4665, 7650],
  /**
   * Figure 16 anchors: under SCL the paid projection exceeds the incurred by
   * up to 10% (accident year 6) and falls short by up to 27% (accident year
   * 7, SCL ultimate P/I about 73%), while MCL ultimate P/I is 97-100% in all
   * years.
   */
  sclFinalRatioAY7: 0.73,
  sclFinalRatioAY6: 1.1,
};
