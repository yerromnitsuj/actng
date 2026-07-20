import { mackEstimators, extrapolateSigma2 } from "./mack.js";
import type { Triangle } from "./types.js";
import { ReservingError } from "./types.js";
import { assertSameShape, isNum, lastObservedIndex } from "./util.js";

/**
 * Munich chain ladder, Quarg & Mack (2004): a paired paid/incurred projection
 * that corrects each triangle's development factors with the momentary
 * (paid/incurred) ratio, so the projected paid and incurred ultimates
 * converge instead of preserving each accident year's (P/I) gap forever
 * (the separate-chain-ladder problem, Sec 1.1.2 of the paper).
 *
 * Estimators (Sec 3.1, all reproduced against the paper's printed rows):
 * - fhat^P/fhat^I: volume-weighted development factors (shared with Mack).
 * - sigmahat: Mack variance estimators around fhat, denominator = pairs - 1.
 * - qhat_s: incurred-weighted average (P/I) per column; its reciprocal
 *   estimates the conditional mean of (I/P).
 * - rhohat^P_s / rhohat^I_s: Mack-style variance estimators for the ratio
 *   series, volume-weighted by paid resp. incurred, denominator = cells - 1.
 * - lambda^P / lambda^I: slopes of the single regression line THROUGH THE
 *   ORIGIN over the pooled residual plots (factor residual vs preceding
 *   ratio residual, all development years at once). The lambdas equal the
 *   residual correlation coefficients, so weak correlation collapses MCL
 *   gracefully toward the separate chain ladder.
 *
 * Projection (Sec 3.1.2): the paid and incurred recursions run
 * SIMULTANEOUSLY, cell by cell left to right, because each paid step needs
 * the current projected (I/P) ratio and each incurred step the projected
 * (P/I). Implemented in the multiplied-out form of Sec 3.2.1
 * (P*f + lambda*(sigma/rho)*(I - P/q)), which needs no division by the
 * projected paid/incurred value and therefore stays sensible when current
 * paid is tiny or zero.
 */

export interface MunichChainLadderOptions {
  /**
   * Explicit sigma (standard-deviation scale, same units as the printed
   * sigmahat rows) for the FINAL development column, whose sigma is never
   * estimable from a single factor. Quarg-Mack manually set both to 0.100
   * in the paper's example. When omitted, the engine falls back to Mack's
   * sigma^2 extrapolation rule (extrapolateSigma2); a warning is pushed
   * either way, since the paper notes a sounder extrapolation should be
   * used in practice.
   */
  lastColumnSigma?: { paid?: number; incurred?: number };
}

/** The four estimated-residual triangles (Sec 3.1.2), null where not estimable. */
export interface MunichChainLadderResiduals {
  /** Reshat(P_{i,t}): paid development-factor residuals, [origin][step]. */
  paidFactor: (number | null)[][];
  /** Reshat(I_{i,t}): incurred development-factor residuals. */
  incurredFactor: (number | null)[][];
  /** Reshat(Q^-1_{i,s}): (I/P) ratio residuals, [origin][ageColumn]. */
  paidRatio: (number | null)[][];
  /** Reshat(Q_{i,s}): (P/I) ratio residuals. */
  incurredRatio: (number | null)[][];
}

export interface MunichChainLadderRow {
  origin: string;
  paidLatest: number;
  incurredLatest: number;
  paidUltimate: number;
  incurredUltimate: number;
  /** Separate (plain volume-weighted) chain ladder ultimates for comparison. */
  sclPaidUltimate: number;
  sclIncurredUltimate: number;
  /** MCL ultimate paid / ultimate incurred; null when incurred is not positive. */
  finalRatio: number | null;
  /** SCL ultimate paid / ultimate incurred (the gap MCL is built to close). */
  sclFinalRatio: number | null;
}

export interface MunichChainLadderResult {
  method: "munichChainLadder";
  /** Volume-weighted fhat^P per development step. */
  paidFactors: number[];
  /** Volume-weighted fhat^I per development step. */
  incurredFactors: number[];
  /** sigmahat^P per step, after last-column fallback (see options). */
  sigmaPaid: number[];
  sigmaIncurred: number[];
  /** qhat_s per age column; null where a column has no usable (P, I) pairs. */
  qRatios: (number | null)[];
  /** rhohat^P_s per age column; null where fewer than two pairs exist. */
  rhoPaid: (number | null)[];
  rhoIncurred: (number | null)[];
  /** Through-origin regression slopes over the pooled residuals. */
  lambdaPaid: number;
  lambdaIncurred: number;
  residuals: MunichChainLadderResiduals;
  /** Full projected rectangles (observed cells passed through); null rows = skipped. */
  projectedPaid: ((number | null)[] | null)[];
  projectedIncurred: ((number | null)[] | null)[];
  rows: MunichChainLadderRow[];
  totals: {
    paidUltimate: number;
    incurredUltimate: number;
    sclPaidUltimate: number;
    sclIncurredUltimate: number;
  };
  warnings: string[];
}

/** Cell usable for ratio work: both triangles observed, both strictly positive. */
function usablePair(p: number | null, inc: number | null): boolean {
  return isNum(p) && isNum(inc) && p > 0 && inc > 0;
}

export function runMunichChainLadder(
  paid: Triangle,
  incurred: Triangle,
  options: MunichChainLadderOptions = {},
): MunichChainLadderResult {
  const n = paid.origins.length;
  const K = paid.ages.length;

  assertSameShape(
    paid,
    incurred,
    "Munich chain ladder needs paid and incurred triangles with identical origins and ages",
  );
  for (const tri of [paid, incurred]) {
    if (tri.values.length !== n || tri.values.some((row) => row.length !== K)) {
      throw new ReservingError(
        "SHAPE",
        "Triangle values must be a full origins x ages rectangle (null below the diagonal)",
      );
    }
  }
  if (K < 2) {
    throw new ReservingError(
      "TOO_SMALL",
      "Munich chain ladder requires at least two development ages",
    );
  }

  const warnings: string[] = [];

  // Chain-ladder estimators, shared with Mack so the two can never drift.
  const paidEst = mackEstimators(paid);
  const incurredEst = mackEstimators(incurred);

  // sigma completion: the final column (single factor) is never estimable.
  // An explicit lastColumnSigma wins (the paper's manual 0.100); otherwise
  // Mack's extrapolation rule fills every non-estimable column.
  const completeSigma2 = (
    raw: (number | null)[],
    label: "paid" | "incurred",
    override: number | undefined,
  ): number[] => {
    const withOverride = [...raw];
    if (withOverride[K - 2] === null) {
      const tag = label === "paid" ? "P" : "I";
      if (isNum(override) && override >= 0) {
        withOverride[K - 2] = override * override;
        warnings.push(
          `sigma^${tag} for the final development column is not estimable; using the caller-supplied ${override} (Quarg-Mack set 0.100 in their example)`,
        );
      } else {
        warnings.push(
          `sigma^${tag} for the final development column is not estimable; filled by Mack's extrapolation rule (the paper suggests a sounder extrapolation in practice)`,
        );
      }
    }
    return extrapolateSigma2(withOverride, paid.ages, warnings);
  };
  const sigma2Paid = completeSigma2(paidEst.sigma2, "paid", options.lastColumnSigma?.paid);
  const sigma2Incurred = completeSigma2(
    incurredEst.sigma2,
    "incurred",
    options.lastColumnSigma?.incurred,
  );

  // qhat_s (incurred-weighted average P/I per column) and the rho variance
  // estimators for the ratio series (Sec 3.1.2; denominator = pairs - 1,
  // exactly the Mack convention, verified against the printed rho rows).
  const qRatios: (number | null)[] = new Array(K).fill(null);
  const rhoPaid: (number | null)[] = new Array(K).fill(null);
  const rhoIncurred: (number | null)[] = new Array(K).fill(null);
  for (let s = 0; s < K; s++) {
    let sumP = 0;
    let sumI = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const p = paid.values[i]![s] ?? null;
      const inc = incurred.values[i]![s] ?? null;
      if (usablePair(p, inc)) {
        sumP += p!;
        sumI += inc!;
        count++;
      }
    }
    if (count === 0 || sumP <= 0 || sumI <= 0) continue;
    const q = sumP / sumI;
    qRatios[s] = q;
    if (count < 2) continue;
    let devP = 0;
    let devI = 0;
    for (let i = 0; i < n; i++) {
      const p = paid.values[i]![s] ?? null;
      const inc = incurred.values[i]![s] ?? null;
      if (!usablePair(p, inc)) continue;
      devP += p! * (inc! / p! - 1 / q) ** 2;
      devI += inc! * (p! / inc! - q) ** 2;
    }
    rhoPaid[s] = Math.sqrt(devP / (count - 1));
    rhoIncurred[s] = Math.sqrt(devI / (count - 1));
  }

  // The four residual triangles. Factor residuals need the DATA-ESTIMATED
  // sigma (not the extrapolated one); ratio residuals need rho > 0.
  const residuals: MunichChainLadderResiduals = {
    paidFactor: Array.from({ length: n }, () => new Array<number | null>(K - 1).fill(null)),
    incurredFactor: Array.from({ length: n }, () => new Array<number | null>(K - 1).fill(null)),
    paidRatio: Array.from({ length: n }, () => new Array<number | null>(K).fill(null)),
    incurredRatio: Array.from({ length: n }, () => new Array<number | null>(K).fill(null)),
  };
  for (let s = 0; s < K; s++) {
    const q = qRatios[s];
    const rP = rhoPaid[s];
    const rI = rhoIncurred[s];
    if (!isNum(q) || !isNum(rP) || !isNum(rI) || rP <= 0 || rI <= 0) continue;
    for (let i = 0; i < n; i++) {
      const p = paid.values[i]![s] ?? null;
      const inc = incurred.values[i]![s] ?? null;
      if (!usablePair(p, inc)) continue;
      residuals.paidRatio[i]![s] = ((inc! / p! - 1 / q) / rP) * Math.sqrt(p!);
      residuals.incurredRatio[i]![s] = ((p! / inc! - q) / rI) * Math.sqrt(inc!);
    }
  }
  for (let s = 0; s < K - 1; s++) {
    const s2P = paidEst.sigma2[s];
    const s2I = incurredEst.sigma2[s];
    for (let i = 0; i < n; i++) {
      const p0 = paid.values[i]![s] ?? null;
      const p1 = paid.values[i]![s + 1] ?? null;
      if (isNum(s2P) && s2P > 0 && isNum(p0) && isNum(p1) && p0 > 0) {
        residuals.paidFactor[i]![s] = ((p1 / p0 - paidEst.f[s]!) / Math.sqrt(s2P)) * Math.sqrt(p0);
      }
      const i0 = incurred.values[i]![s] ?? null;
      const i1 = incurred.values[i]![s + 1] ?? null;
      if (isNum(s2I) && s2I > 0 && isNum(i0) && isNum(i1) && i0 > 0) {
        residuals.incurredFactor[i]![s] =
          ((i1 / i0 - incurredEst.f[s]!) / Math.sqrt(s2I)) * Math.sqrt(i0);
      }
    }
  }

  // Size gate: the pooled regressions need factor residuals, which exist
  // only where a development column has two or more observed factors (a 3x3
  // triangle at minimum). Zero-variance ratio series (rho = 0) are NOT a
  // size problem - they collapse lambda to 0 below, the paper's built-in
  // safety mechanism.
  const anySigma = (raw: (number | null)[]): boolean => raw.some((v) => v !== null);
  if (!anySigma(paidEst.sigma2) && !anySigma(incurredEst.sigma2)) {
    throw new ReservingError(
      "TOO_SMALL",
      "Munich chain ladder needs at least one development column with two observed factors (a 3x3 triangle at minimum) to pool residuals",
    );
  }

  // lambda^P / lambda^I: through-origin regression slopes over the pooled
  // residual pairs (factor residual on the preceding ratio residual).
  let numP = 0;
  let denP = 0;
  let numI = 0;
  let denI = 0;
  for (let s = 0; s < K - 1; s++) {
    for (let i = 0; i < n; i++) {
      const fResP = residuals.paidFactor[i]![s];
      const rResP = residuals.paidRatio[i]![s];
      if (isNum(fResP) && isNum(rResP)) {
        numP += rResP * fResP;
        denP += rResP * rResP;
      }
      const fResI = residuals.incurredFactor[i]![s];
      const rResI = residuals.incurredRatio[i]![s];
      if (isNum(fResI) && isNum(rResI)) {
        numI += rResI * fResI;
        denI += rResI * rResI;
      }
    }
  }
  const lambdaFor = (num: number, den: number, label: string): number => {
    if (den > 0) return num / den;
    warnings.push(
      `No usable ${label} residual variation; lambda^${label === "paid" ? "P" : "I"} set to 0 (the projection collapses to the separate chain ladder)`,
    );
    return 0;
  };
  const lambdaPaid = lambdaFor(numP, denP, "paid");
  const lambdaIncurred = lambdaFor(numI, denI, "incurred");

  // Simultaneous cell-by-cell projection, and the SCL comparison projection.
  const projectedPaid: ((number | null)[] | null)[] = new Array(n).fill(null);
  const projectedIncurred: ((number | null)[] | null)[] = new Array(n).fill(null);
  const rows: MunichChainLadderRow[] = [];
  const totals = { paidUltimate: 0, incurredUltimate: 0, sclPaidUltimate: 0, sclIncurredUltimate: 0 };
  const droppedCorrectionColumns = new Set<number>();

  for (let i = 0; i < n; i++) {
    const lastP = lastObservedIndex(paid.values[i]!);
    const lastI = lastObservedIndex(incurred.values[i]!);
    if (lastP < 0 || lastI < 0) {
      warnings.push(
        `Origin ${paid.origins[i]} has no observed ${lastP < 0 ? "paid" : "incurred"} values; excluded from results`,
      );
      continue;
    }
    if (lastP !== lastI) {
      warnings.push(
        `Origin ${paid.origins[i]}: paid and incurred diagonals end at different ages (${paid.ages[lastP]} vs ${paid.ages[lastI]}); the joint projection starts at the earlier age and observed cells are kept as given`,
      );
    }
    const start = Math.min(lastP, lastI);

    const mclP: (number | null)[] = paid.values[i]!.map((v) => (isNum(v) ? v : null));
    const mclI: (number | null)[] = incurred.values[i]!.map((v) => (isNum(v) ? v : null));
    for (let s = start; s < K - 1; s++) {
      const p = mclP[s]!;
      const inc = mclI[s]!;
      // Multiplied-out recursion (Sec 3.2.1): no division by p or inc, so
      // zero paid stays projectable, driven by the incurred side.
      let nextP = p * paidEst.f[s]!;
      let nextI = inc * incurredEst.f[s]!;
      const q = qRatios[s];
      const rP = rhoPaid[s];
      const rI = rhoIncurred[s];
      if (isNum(q) && q > 0 && isNum(rP) && rP > 0 && isNum(rI) && rI > 0) {
        nextP += lambdaPaid * (Math.sqrt(sigma2Paid[s]!) / rP) * (inc - p / q);
        nextI += lambdaIncurred * (Math.sqrt(sigma2Incurred[s]!) / rI) * (p - inc * q);
      } else if (!droppedCorrectionColumns.has(s)) {
        droppedCorrectionColumns.add(s);
        warnings.push(
          `No usable (P/I) ratio parameters at age ${paid.ages[s]}; the MCL correction is dropped for that step (falls back to the chain-ladder factor)`,
        );
      }
      // Never overwrite an observation (only possible on ragged diagonals).
      const observedP = mclP[s + 1] ?? null;
      const observedI = mclI[s + 1] ?? null;
      mclP[s + 1] = isNum(observedP) ? observedP : nextP;
      mclI[s + 1] = isNum(observedI) ? observedI : nextI;
    }
    projectedPaid[i] = mclP;
    projectedIncurred[i] = mclI;

    // Separate chain ladder from each triangle's own diagonal.
    let sclP = paid.values[i]![lastP]!;
    for (let s = lastP; s < K - 1; s++) sclP *= paidEst.f[s]!;
    let sclI = incurred.values[i]![lastI]!;
    for (let s = lastI; s < K - 1; s++) sclI *= incurredEst.f[s]!;

    const paidUltimate = mclP[K - 1]!;
    const incurredUltimate = mclI[K - 1]!;
    rows.push({
      origin: paid.origins[i]!,
      paidLatest: paid.values[i]![lastP]!,
      incurredLatest: incurred.values[i]![lastI]!,
      paidUltimate,
      incurredUltimate,
      sclPaidUltimate: sclP,
      sclIncurredUltimate: sclI,
      finalRatio: incurredUltimate > 0 ? paidUltimate / incurredUltimate : null,
      sclFinalRatio: sclI > 0 ? sclP / sclI : null,
    });
    totals.paidUltimate += paidUltimate;
    totals.incurredUltimate += incurredUltimate;
    totals.sclPaidUltimate += sclP;
    totals.sclIncurredUltimate += sclI;
  }

  return {
    method: "munichChainLadder",
    paidFactors: paidEst.f,
    incurredFactors: incurredEst.f,
    sigmaPaid: sigma2Paid.map((v) => Math.sqrt(v)),
    sigmaIncurred: sigma2Incurred.map((v) => Math.sqrt(v)),
    qRatios,
    rhoPaid,
    rhoIncurred,
    lambdaPaid,
    lambdaIncurred,
    residuals,
    projectedPaid,
    projectedIncurred,
    rows,
    totals,
    warnings,
  };
}
