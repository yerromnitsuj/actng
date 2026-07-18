/**
 * Published validation data from England (2002), "Addendum to 'Analytic and
 * bootstrap estimates of prediction errors in claims reserving'", Insurance:
 * Mathematics and Economics 31:461-466, which restates and extends England &
 * Verrall (1999), IME 25:281-293.
 *
 * The triangle is Taylor & Ashe — see fixtures/mack1993.ts, which this file
 * deliberately does not duplicate. What lives here are England's PUBLISHED
 * RESULTS for the ODP bootstrap on that data, transcribed from the source
 * (full transcription with context and caveats:
 * docs/research/phase3/odp-bootstrap-england-verrall-shapland.md).
 *
 * WHY THESE ARE BANDS AND NOT EXACT PINS. Mack's standard error is a closed
 * form, so the suite reproduces 2,447,095 to the digit. A bootstrap is not:
 * England's own two columns disagree with each other (18,690 vs 18,688 for the
 * same quantity at 1,000 simulations), because each is one finite sample from
 * a predictive distribution. Reproducing a published bootstrap figure exactly
 * would mean reproducing another author's random number stream, which is not a
 * property of the method. The honest test is agreement within the sampling
 * error the publication itself exhibits — which is what the tolerances below
 * encode, and why they are stated per quantity rather than as one global
 * fudge factor.
 */

/** England (2002) Table 2: prediction error as a percentage of reserve. */
export const englandTable2PredictionErrorPct = {
  /** Per accident year, the bootstrap/simulation column. */
  byOrigin: {
    "2": 117,
    "3": 47,
    "4": 37,
    "5": 31,
    "6": 27,
    "7": 23,
    "8": 21,
    "9": 25,
    "10": 44,
  } as Record<string, number>,
  total: 16,
  /**
   * Percentage points. England prints these to the nearest whole percent, so
   * half a point is already lost to rounding; 5pp on a per-origin figure that
   * ranges to 117% is roughly a tenth of its own value, and 1pp on the total.
   */
  toleranceByOrigin: 5,
  toleranceTotal: 1,
} as const;

/**
 * England (2002) Table 3: sample statistics of the predictive aggregate
 * distribution of total reserves, from 1,000 simulations. Thousands.
 */
export const englandTable3Distribution = {
  observations: 1_000,
  mean: 18_688,
  standardDeviation: 2_956,
  coefficientOfVariation: 0.158,
  skewness: 0.35,
  percentiles: {
    p50: 18_532,
    p75: 20_640,
    p90: 22_620,
    p95: 23_827,
    p99: 25_967,
  } as Record<string, number>,
  /**
   * Relative. One 1,000-simulation run against another: the Monte Carlo
   * standard error of a sample standard deviation is 1/sqrt(2n) ~ 2.2%, and
   * two independent runs differ by sqrt(2) times that, so anything under ~12%
   * (roughly 4 sigma) is ordinary sampling noise rather than disagreement.
   */
  tolerance: 0.12,
} as const;

/** England (2002) Table 1: the chain ladder reserve the bootstrap mean checks against. */
export const englandTable1ChainLadderTotal = 18_681;
