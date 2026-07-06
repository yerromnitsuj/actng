import type { MackResult, MackRow, Triangle } from "./types.js";
import { ReservingError } from "./types.js";
import { isNum, lastObservedIndex } from "./util.js";

/**
 * Mack (1993) distribution-free chain ladder standard errors, alpha = 1
 * (volume-weighted factors), no tail.
 *
 * - f_k    = sum(C_{i,k+1}) / sum(C_{i,k}) over rows with both cells observed
 * - s^2_k  = 1/(n_k - 1) * sum C_{i,k} (F_{ik} - f_k)^2
 * - s^2 for the final column is extrapolated per Mack:
 *   min(s^4_{K-2}/s^2_{K-3}, min(s^2_{K-3}, s^2_{K-2}))
 * - se(R_i)^2 = C_iI^2 * sum_k (s^2_k / f_k^2) (1/C_ik + 1/sum_j C_jk)
 *   with projected C below the diagonal
 * - the total includes Mack's cross-covariance term between accident years
 */
export function runMack(tri: Triangle): MackResult {
  const n = tri.origins.length;
  const K = tri.ages.length;
  if (K < 2) {
    throw new ReservingError("TOO_SMALL", "Mack requires at least two development ages");
  }
  const warnings: string[] = [];

  // Column sums restricted to rows where both cells are observed.
  const f: number[] = [];
  const denomSums: number[] = []; // sum over rows used for f_k of C_{i,k}
  for (let k = 0; k < K - 1; k++) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const c0 = tri.values[i]![k] ?? null;
      const c1 = tri.values[i]![k + 1] ?? null;
      if (isNum(c0) && isNum(c1) && c0 > 0) {
        num += c1;
        den += c0;
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
  }

  // sigma^2_k estimates.
  const sigma2: number[] = new Array(K - 1).fill(0);
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
    if (count > 1) {
      sigma2[k] = sum / (count - 1);
    } else {
      sigma2[k] = NaN; // extrapolated below
    }
  }
  // Mack's extrapolation for columns with a single factor (usually the last).
  for (let k = 0; k < K - 1; k++) {
    if (!Number.isNaN(sigma2[k]!)) continue;
    const s2a = k >= 2 ? sigma2[k - 2]! : NaN;
    const s2b = k >= 1 ? sigma2[k - 1]! : NaN;
    if (isNum(s2a) && isNum(s2b) && s2a > 0) {
      sigma2[k] = Math.min((s2b * s2b) / s2a, Math.min(s2a, s2b));
    } else if (isNum(s2b)) {
      sigma2[k] = s2b;
      warnings.push(
        `sigma^2 for the ${tri.ages[k]}-${tri.ages[k + 1]} column could not use Mack's extrapolation; reused the prior column's value`,
      );
    } else {
      sigma2[k] = 0;
      warnings.push(
        `sigma^2 for the ${tri.ages[k]}-${tri.ages[k + 1]} column is not estimable; set to 0 (standard errors understated)`,
      );
    }
  }

  // Project the full rectangle.
  const projected: number[][] = tri.values.map((row) => {
    const out: number[] = new Array(K).fill(NaN);
    const last = lastObservedIndex(row);
    for (let j = 0; j <= last; j++) out[j] = row[j] ?? NaN;
    for (let j = last + 1; j < K; j++) out[j] = out[j - 1]! * f[j - 1]!;
    return out;
  });

  const rows: MackRow[] = [];
  const mseByRow: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const last = lastObservedIndex(tri.values[i]!);
    if (last < 0) continue;
    const latest = tri.values[i]![last]!;
    const ultimate = projected[i]![K - 1]!;
    // mse(R_i) accumulated over the projected development range.
    let mse = 0;
    for (let k = last; k < K - 1; k++) {
      const cik = projected[i]![k]!;
      if (!(cik > 0)) continue;
      mse += ((sigma2[k]! / f[k]! ** 2) * (1 / cik + 1 / denomSums[k]!));
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

  // Total mse: sum of row mse plus cross terms (Mack 1993 corollary).
  let totalMse = 0;
  for (let i = 0; i < n; i++) totalMse += mseByRow[i]!;
  for (let i = 0; i < n; i++) {
    const lastI = lastObservedIndex(tri.values[i]!);
    if (lastI < 0 || lastI >= K - 1) continue;
    let laterUltimates = 0;
    for (let j = i + 1; j < n; j++) {
      if (lastObservedIndex(tri.values[j]!) >= 0) laterUltimates += projected[j]![K - 1]!;
    }
    if (laterUltimates <= 0) continue;
    let inner = 0;
    for (let k = lastI; k < K - 1; k++) {
      inner += (2 * sigma2[k]!) / f[k]! ** 2 / denomSums[k]!;
    }
    totalMse += projected[i]![K - 1]! * laterUltimates * inner;
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
    developmentFactors: f,
    sigmaSquared: sigma2,
    rows,
    totals: {
      ...totals,
      standardError: totalSe,
      cv: totals.reserve !== 0 ? totalSe / totals.reserve : null,
    },
    warnings,
  };
}
