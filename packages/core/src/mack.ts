import type { MackResult, MackRow, Triangle } from "./types.js";
import { ReservingError } from "./types.js";
import { isNum, lastObservedIndex } from "./util.js";

export interface MackOptions {
  /**
   * Per-column selected LDFs (null = unselected, treated as 1.000 exactly
   * like the chain ladder does). When omitted the projection uses the
   * volume-weighted factors, which is Mack (1993) as published.
   */
  selected?: (number | null)[];
  /** Multiplicative tail factor beyond the last observed age (1 = none). */
  tailFactor?: number;
}

/**
 * Mack (1993) distribution-free chain ladder standard errors, alpha = 1,
 * extended per Mack (1999) to selected development factors and a tail:
 *
 * - f_k    = sum(C_{i,k+1}) / sum(C_{i,k}) over rows with both cells observed
 * - s^2_k  = 1/(n_k - 1) * sum C_{i,k} (F_{ik} - f_k)^2, always estimated
 *   around the volume-weighted f_k (the data-driven estimator) even when
 *   the projection uses selected factors
 * - s^2 for the final column is extrapolated per Mack:
 *   min(s^4_{K-2}/s^2_{K-3}, min(s^2_{K-3}, s^2_{K-2}))
 * - se(R_i)^2 = C_ult^2 * sum_k (s^2_k / f*_k^2) (1/C_ik + 1/sum_j C_jk)
 *   with f* the projection factors and projected C below the diagonal
 * - a tail step (tailFactor > 1) extends the sum by one column, with s^2
 *   extrapolated once more by the same rule and the final column's volume
 *   as its denominator - an approximation, flagged in warnings
 * - the total includes Mack's cross-covariance term between accident years
 */
/**
 * Mack's base estimators: volume-weighted development factors f_k, their
 * column volumes (sum of C_{i,k} over the rows used), the per-column pair
 * counts, and the DATA-ESTIMATED sigma^2_k (null where fewer than two
 * factors exist — extrapolation is runMack's business, not the estimator's).
 * Shared by runMack and the residual diagnostics so the two can never drift.
 */
export function mackEstimators(tri: Triangle): {
  f: number[];
  denomSums: number[];
  counts: number[];
  sigma2: (number | null)[];
} {
  const n = tri.origins.length;
  const K = tri.ages.length;
  if (K < 2) {
    throw new ReservingError("TOO_SMALL", "Mack requires at least two development ages");
  }
  const f: number[] = [];
  const denomSums: number[] = [];
  const counts: number[] = [];
  for (let k = 0; k < K - 1; k++) {
    let num = 0;
    let den = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const c0 = tri.values[i]![k] ?? null;
      const c1 = tri.values[i]![k + 1] ?? null;
      if (isNum(c0) && isNum(c1) && c0 > 0) {
        num += c1;
        den += c0;
        count++;
      }
    }
    if (den <= 0) {
      throw new ReservingError(
        "NO_FACTOR",
        `Development column ${tri.ages[k]}-${tri.ages[k + 1]} has no usable factors for Mack`,
      );
    }
    f.push(num / den);
    denomSums.push(den);
    counts.push(count);
  }
  const sigma2: (number | null)[] = new Array(K - 1).fill(null);
  for (let k = 0; k < K - 1; k++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const c0 = tri.values[i]![k] ?? null;
      const c1 = tri.values[i]![k + 1] ?? null;
      if (isNum(c0) && isNum(c1) && c0 > 0) {
        const F = c1 / c0;
        sum += c0 * (F - f[k]!) ** 2;
        count++;
      }
    }
    sigma2[k] = count > 1 ? sum / (count - 1) : null;
  }
  return { f, denomSums, counts, sigma2 };
}

/**
 * Mack's sigma^2 extrapolation for columns the data cannot estimate (fewer
 * than two observed factors - usually only the final column):
 * sigma^2_k = min(sigma^4_{k-1} / sigma^2_{k-2}, sigma^2_{k-2}, sigma^2_{k-1}),
 * Mack (1993), also eq. (4.1) of Merz-Wuthrich (2008). Shared by runMack and
 * runMerzWuthrich so the two can never disagree on the final column.
 *
 * Takes the raw per-column estimates (null = not estimable) and returns the
 * completed array; when the min-rule inputs are unavailable it falls back to
 * the prior column's value, then 0, pushing a warning either way.
 */
export function extrapolateSigma2(
  sigma2Raw: (number | null)[],
  ages: number[],
  warnings: string[],
): number[] {
  const sigma2: number[] = sigma2Raw.map((s) => (s === null ? NaN : s));
  for (let k = 0; k < sigma2.length; k++) {
    if (!Number.isNaN(sigma2[k]!)) continue;
    const s2a = k >= 2 ? sigma2[k - 2]! : NaN;
    const s2b = k >= 1 ? sigma2[k - 1]! : NaN;
    if (isNum(s2a) && isNum(s2b) && s2a > 0) {
      sigma2[k] = Math.min((s2b * s2b) / s2a, Math.min(s2a, s2b));
    } else if (isNum(s2b)) {
      sigma2[k] = s2b;
      warnings.push(
        `sigma^2 for the ${ages[k]}-${ages[k + 1]} column could not use Mack's extrapolation; reused the prior column's value`,
      );
    } else {
      sigma2[k] = 0;
      warnings.push(
        `sigma^2 for the ${ages[k]}-${ages[k + 1]} column is not estimable; set to 0 (standard errors understated)`,
      );
    }
  }
  return sigma2;
}

export function runMack(tri: Triangle, options: MackOptions = {}): MackResult {
  const n = tri.origins.length;
  const K = tri.ages.length;
  const warnings: string[] = [];

  const estimators = mackEstimators(tri);
  const f = estimators.f;
  const denomSums = estimators.denomSums;

  // Projection factors: the caller's selections when provided (nulls and
  // non-positive values become 1.000, mirroring the chain ladder), else the
  // volume-weighted estimates - which reproduces Mack (1993) exactly.
  let fEff: number[] = f;
  if (options.selected !== undefined) {
    if (options.selected.length !== K - 1) {
      throw new ReservingError(
        "SELECTION_SHAPE",
        `Expected ${K - 1} LDF selections (one per development interval), got ${options.selected.length}`,
      );
    }
    fEff = options.selected.map((s, k) => {
      if (s === null || s === undefined) return 1;
      if (!isNum(s) || s <= 0) {
        warnings.push(
          `Selected LDF for ${tri.ages[k]}-${tri.ages[k + 1]} months is not positive; treated as 1.000`,
        );
        return 1;
      }
      return s;
    });
    const differs = fEff.some((v, k) => Math.abs(v - f[k]!) > 1e-9);
    if (differs) {
      warnings.push(
        "Standard errors pair the selected development factors with sigma^2 estimated around the volume-weighted factors (Mack 1999)",
      );
    }
  }
  const tail = options.tailFactor ?? 1;
  if (!isNum(tail) || tail <= 0) {
    throw new ReservingError("BAD_TAIL", "Tail factor must be a positive number");
  }

  // sigma^2_k estimates: data-estimated where possible; Mack's extrapolation
  // fills columns with a single factor (usually the last).
  const sigma2 = extrapolateSigma2(estimators.sigma2, tri.ages, warnings);

  // Tail step variance: extrapolate sigma^2 one more column by Mack's rule
  // and reuse the final column's volume as its denominator (approximation).
  let sigma2Tail = 0;
  let denomTail = 0;
  if (tail !== 1) {
    const s2a = K >= 3 ? sigma2[K - 3]! : NaN;
    const s2b = sigma2[K - 2]!;
    if (isNum(s2a) && isNum(s2b) && s2a > 0) {
      sigma2Tail = Math.min((s2b * s2b) / s2a, Math.min(s2a, s2b));
    } else if (isNum(s2b)) {
      sigma2Tail = s2b;
    }
    denomTail = denomSums[K - 2]!;
    warnings.push(
      "The tail step's standard-error contribution extrapolates sigma^2 beyond the observed columns and reuses the final column's volume; treat it as approximate (Mack 1999)",
    );
  }

  // Project the full rectangle with the projection factors.
  const projected: number[][] = tri.values.map((row) => {
    const out: number[] = new Array(K).fill(NaN);
    const last = lastObservedIndex(row);
    for (let j = 0; j <= last; j++) out[j] = row[j] ?? NaN;
    for (let j = last + 1; j < K; j++) out[j] = out[j - 1]! * fEff[j - 1]!;
    return out;
  });

  const rows: MackRow[] = [];
  const mseByRow: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const last = lastObservedIndex(tri.values[i]!);
    if (last < 0) continue;
    const latest = tri.values[i]![last]!;
    const ultimate = projected[i]![K - 1]! * tail;
    // mse(R_i) accumulated over the projected development range plus tail.
    let mse = 0;
    for (let k = last; k < K - 1; k++) {
      const cik = projected[i]![k]!;
      if (!(cik > 0)) continue;
      mse += ((sigma2[k]! / fEff[k]! ** 2) * (1 / cik + 1 / denomSums[k]!));
    }
    if (tail !== 1 && projected[i]![K - 1]! > 0) {
      mse += (sigma2Tail / tail ** 2) * (1 / projected[i]![K - 1]! + 1 / denomTail);
    }
    mse *= ultimate ** 2;
    mseByRow[i] = mse;
    const reserve = ultimate - latest;
    rows.push({
      origin: tri.origins[i]!,
      latest,
      ultimate,
      reserve,
      standardError: Math.sqrt(mse),
      cv: reserve !== 0 ? Math.sqrt(mse) / reserve : null,
    });
  }

  // Total mse: sum of row mse plus the cross-covariance between every PAIR of
  // accident years (Mack 1993 corollary). The tail step participates like one
  // more development column.
  //
  // Two accident years share estimation error only over the columns they have
  // BOTH yet to traverse, so each pair's sum starts at the maturity of the more
  // developed of the two. That floor is per-pair: aggregating the later rows'
  // ultimates before choosing it would assume maturity falls with row index —
  // true of a tidy run-off triangle, false of a ragged or unsorted one, and the
  // resulting total moved by up to 65% purely with row order.
  let totalMse = 0;
  for (let i = 0; i < n; i++) totalMse += mseByRow[i]!;

  const maturity = tri.values.map((row) => lastObservedIndex(row));
  const ultimateOf = (i: number): number => projected[i]![K - 1]! * tail;

  for (let i = 0; i < n; i++) {
    if (maturity[i]! < 0) continue;
    for (let j = i + 1; j < n; j++) {
      if (maturity[j]! < 0) continue;

      const floor = Math.max(maturity[i]!, maturity[j]!);
      // Both years already run off: no shared development remains.
      if (tail === 1 && floor >= K - 1) continue;

      // Mack's 1/C terms are undefined for a non-positive ultimate; the row
      // estimate skips such columns for the same reason (see above).
      const ui = ultimateOf(i);
      const uj = ultimateOf(j);
      if (!(ui > 0) || !(uj > 0)) continue;

      let shared = 0;
      for (let k = floor; k < K - 1; k++) {
        shared += (2 * sigma2[k]!) / fEff[k]! ** 2 / denomSums[k]!;
      }
      if (tail !== 1) {
        shared += (2 * sigma2Tail) / tail ** 2 / denomTail;
      }

      totalMse += ui * uj * shared;
    }
  }

  const totals = rows.reduce(
    (acc, r) => ({
      latest: acc.latest + r.latest,
      ultimate: acc.ultimate + r.ultimate,
      reserve: acc.reserve + r.reserve,
    }),
    { latest: 0, ultimate: 0, reserve: 0 },
  );
  const totalSe = Math.sqrt(totalMse);

  return {
    method: "mack",
    developmentFactors: fEff,
    sigmaSquared: sigma2,
    tailFactor: tail,
    sigmaSquaredTail: tail !== 1 ? sigma2Tail : undefined,
    rows,
    totals: {
      ...totals,
      standardError: totalSe,
      cv: totals.reserve !== 0 ? totalSe / totals.reserve : null,
    },
    warnings,
  };
}
