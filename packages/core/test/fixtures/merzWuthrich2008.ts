import type { Triangle } from "../../src/types.js";

/**
 * Published validation data, transcribed from the primary source:
 *
 * - Merz, M. & Wuthrich, M.V. (2008), "Modelling the Claims Development
 *   Result for Solvency Purposes", CAS E-Forum Fall 2008, 542-568.
 *   Table 2 (run-off triangle, cumulative payments in $1,000; the observed
 *   next-diagonal cells boxed in the paper are NOT part of D_I and are
 *   omitted here) and Table 4 ("Volatilities of the estimates in $1,000").
 *
 * Everything below stays in $1,000 so computed values compare directly with
 * the printed ones.
 */

const N = null;

/** Table 2: the time-I triangle D_I, I = J = 8 (9 accident years 0..8). */
export const mwTriangle: Triangle = {
  kind: "paid",
  origins: ["0", "1", "2", "3", "4", "5", "6", "7", "8"],
  ages: [12, 24, 36, 48, 60, 72, 84, 96, 108],
  values: [
    [2202584, 3210449, 3468122, 3545070, 3621627, 3644636, 3669012, 3674511, 3678633],
    [2350650, 3553023, 3783846, 3840067, 3865187, 3878744, 3898281, 3902425, N],
    [2321885, 3424190, 3700876, 3798198, 3854755, 3878993, 3898825, N, N],
    [2171487, 3165274, 3395841, 3466453, 3515703, 3548422, N, N, N],
    [2140328, 3157079, 3399262, 3500520, 3585812, N, N, N, N],
    [2290664, 3338197, 3550332, 3641036, N, N, N, N, N],
    [2148216, 3219775, 3428335, N, N, N, N, N, N],
    [2143728, 3158581, N, N, N, N, N, N, N],
    [2144738, N, N, N, N, N, N, N, N],
  ],
};

/** Published values: the fhat row under Table 2 and the Table 4 columns. */
export const mwPublished = {
  /** fhat_j^I as printed under Table 2 (j = 0..7). */
  factors: [1.4759, 1.0719, 1.0232, 1.0161, 1.0063, 1.0056, 1.0013, 1.0011],
  /** Table 4 reserves Rhat_i^{D_I}, accident years 1..8 (year 0 is 0). */
  reserves: [4378, 9348, 28392, 51444, 111811, 187084, 411864, 1433505],
  totalReserve: 2237826,
  /**
   * Table 4 solvency column: msep_{CDRhat(I+1)|D_I}(0)^{1/2} per accident
   * year (eq. 3.17) and the aggregate with cross terms (eq. 3.18).
   */
  cdrMsepRoots: [567, 1488, 3923, 9723, 28443, 20954, 28119, 53320],
  totalCdrMsepRoot: 81080,
  /** Table 4 Mack column: full-runoff msep^{1/2} (Mack 1993). */
  mackMsepRoots: [567, 1566, 4157, 10536, 30319, 35967, 45090, 69552],
  totalMackMsepRoot: 108401,
  /** Table 4 Var^{1/2} column: standard deviation of the TRUE CDR (eq. 3.8). */
  trueCdrSds: [395, 1185, 3395, 8673, 25877, 18875, 25822, 49978],
  totalTrueCdrSd: 65412,
};
