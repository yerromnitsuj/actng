import type { MerzWuthrichResult, MerzWuthrichRow, Triangle } from "./types.js";
import { ReservingError } from "./types.js";
import { extrapolateSigma2, mackEstimators, runMack } from "./mack.js";
import { isNum } from "./util.js";

/**
 * Merz-Wuthrich (2008) one-year claims development result (CDR) msep.
 *
 * Source: Merz, M. & Wuthrich, M.V. (2008), "Modelling the Claims Development
 * Result for Solvency Purposes", CAS E-Forum Fall 2008, 542-568. Implements
 * Result 3.5's closed forms: eq. (3.17) per accident year and eq. (3.18) for
 * the aggregate - the msep of the observable one-year CDR around 0, i.e. the
 * Solvency II / SST one-year reserve-risk quantity. Everything is computable
 * at time I from the observed triangle D_I alone: S_j^{I+1} = S_j^I +
 * C_{I-j,j} adds only the current diagonal element, which is in D_I.
 *
 * Estimators are shared with runMack - volume-weighted fhat_j and Mack's
 * sigma^2_j with the min-rule extrapolation for the final column, which is
 * exactly the paper's eq. (4.1) - and Mack's full-runoff msep is computed via
 * runMack so every row carries the one-year vs ultimate-view comparison.
 *
 * Constraints (Sec. 2 of the paper): the closed forms assume a regular
 * run-off triangle with I = J - as many origin periods as development ages,
 * every cell on or left of the latest diagonal observed and positive, and
 * nothing observed beyond it. Violations throw ReservingError("SHAPE").
 *
 * Caveat: (3.17)/(3.18) are the paper's linear approximations (Appendix A)
 * of the exact product-form formulas. They are the published, industry-
 * standard form (the paper's Table 4 is produced by them), accurate when
 * sigma^2_j / (fhat_j^2 C_{i,j}) << 1, which holds for typical triangles.
 */
export function runMerzWuthrich(tri: Triangle): MerzWuthrichResult {
  const n = tri.origins.length;
  const K = tri.ages.length;
  if (n !== K) {
    throw new ReservingError(
      "SHAPE",
      `Merz-Wuthrich requires a square triangle (I = J): got ${n} origin periods by ${K} development ages`,
    );
  }
  // Regularity: every cell on or left of the time-I diagonal must be observed
  // and positive (the formulas divide by diagonal cells and the variance
  // assumption needs C > 0); nothing may be observed beyond the diagonal.
  for (let i = 0; i < n; i++) {
    const row = tri.values[i] ?? [];
    const diag = K - 1 - i;
    for (let j = 0; j <= diag; j++) {
      const v = row[j] ?? null;
      if (!isNum(v) || v <= 0) {
        throw new ReservingError(
          "SHAPE",
          `Merz-Wuthrich requires every cell on or left of the latest diagonal to be observed and positive: origin ${tri.origins[i]} at age ${tri.ages[j]} months is ${isNum(v) ? "non-positive" : "missing"}`,
        );
      }
    }
    for (let j = diag + 1; j < K; j++) {
      if (isNum(row[j] ?? null)) {
        throw new ReservingError(
          "SHAPE",
          `Merz-Wuthrich assumes a time-I snapshot: origin ${tri.origins[i]} has an observation beyond the latest diagonal at age ${tri.ages[j]} months`,
        );
      }
    }
  }

  const warnings: string[] = [];
  const estimators = mackEstimators(tri);
  const f = estimators.f;
  // S_j^I (2.9): column-j volume EXCLUDING the diagonal element C_{I-j,j}.
  const sI = estimators.denomSums;
  const sigma2 = extrapolateSigma2(estimators.sigma2, tri.ages, warnings);
  const I = K - 1; // = J; row i's latest observed cell is column I - i.

  // sjr(j) = sigmahat_j^2 / fhat_j^2, the paper's recurring ratio.
  const sjr = sigma2.map((s2, j) => s2 / f[j]! ** 2);
  // S_j^{I+1} = S_j^I + C_{I-j,j} (2.10): INCLUDES the diagonal element.
  const sIPlus1 = sI.map((s, j) => s + tri.values[I - j]![j]!);

  // Chain ladder ultimates Chat_{i,J}^I (2.11).
  const ultimates: number[] = tri.values.map((row, i) => {
    let u = row[I - i]!;
    for (let j = I - i; j < I; j++) u *= f[j]!;
    return u;
  });

  // Mack's ultimate-view msep on the identical estimators, for comparison.
  const mack = runMack(tri);

  const rows: MerzWuthrichRow[] = [];
  const msepByRow: number[] = new Array(n).fill(0);
  // Estimation-error piece shared by (3.17) and (3.18)'s cross terms:
  // sjr(I-i)/S_{I-i}^I + sum_{j=I-i+1}^{J-1} (C_{I-j,j}/S_j^{I+1}) sjr(j)/S_j^I
  // (FIRST power of C_{I-j,j}/S_j^{I+1} - the Delta and Phi tails merge).
  const estimationTerm: number[] = new Array(n).fill(0);
  let totalReserve = 0;
  for (let i = 0; i < n; i++) {
    const d = I - i;
    if (i > 0) {
      let laterDiagonals = 0;
      for (let j = d + 1; j <= I - 1; j++) {
        laterDiagonals += (tri.values[I - j]![j]! / sIPlus1[j]!) * (sjr[j]! / sI[j]!);
      }
      estimationTerm[i] = sjr[d]! / sI[d]! + laterDiagonals;
      // (3.17): process term sjr(I-i)/C_{i,I-i} plus the estimation term.
      msepByRow[i] = ultimates[i]! ** 2 * (sjr[d]! / tri.values[i]![d]! + estimationTerm[i]!);
    }
    // i = 0 is fully developed: its CDR is identically 0 (the paper prints
    // this row with reserve 0 and blank volatility cells).
    const cdrMsepRoot = Math.sqrt(msepByRow[i]!);
    const mackMsepRoot = mack.rows[i]!.standardError;
    const reserve = ultimates[i]! - tri.values[i]![d]!;
    totalReserve += reserve;
    rows.push({
      origin: tri.origins[i]!,
      reserve,
      cdrMsepRoot,
      mackMsepRoot,
      oneYearRatio: mackMsepRoot > 0 ? cdrMsepRoot / mackMsepRoot : null,
    });
  }

  // (3.18): aggregate = sum of the single-year mseps plus cross terms
  // 2 * Chat_i * Chat_k over 0 < i < k <= I, each scaled by the estimation
  // term of the EARLIER accident year i.
  let totalMsep = msepByRow.reduce((a, b) => a + b, 0);
  for (let i = 1; i < n; i++) {
    let laterUltimates = 0;
    for (let k = i + 1; k < n; k++) laterUltimates += ultimates[k]!;
    totalMsep += 2 * ultimates[i]! * laterUltimates * estimationTerm[i]!;
  }

  const totalCdrMsepRoot = Math.sqrt(totalMsep);
  const totalMackMsepRoot = mack.totals.standardError;
  return {
    method: "merzWuthrich",
    developmentFactors: f,
    sigmaSquared: sigma2,
    rows,
    totals: {
      reserve: totalReserve,
      cdrMsepRoot: totalCdrMsepRoot,
      mackMsepRoot: totalMackMsepRoot,
      oneYearRatio: totalMackMsepRoot > 0 ? totalCdrMsepRoot / totalMackMsepRoot : null,
    },
    warnings,
  };
}
