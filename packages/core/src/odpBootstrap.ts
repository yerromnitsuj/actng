import type { Triangle } from "./types.js";
import { ReservingError } from "./types.js";
import { isNum, lastObservedIndex } from "./util.js";
import { cumulativeToIncremental } from "./triangleAlgebra.js";
import {
  createRng,
  summarizeSample,
  type StochasticResult,
} from "./stochastic.js";

/**
 * Over-dispersed Poisson (ODP) bootstrap of the chain ladder.
 *
 * Ground truth (England & Verrall 1999/2002; Shapland, CAS Monograph No. 4):
 * - The cross-classified ODP GLM's fitted values reproduce the all-year
 *   volume-weighted chain ladder EXACTLY. In practice the fitted past
 *   incrementals come from the backwards recursion: anchor each row's
 *   latest observed cumulative, divide back through the volume-weighted
 *   factors, and difference.
 * - Unscaled Pearson residuals r = (q - m) / sqrt(m) on incrementals; the
 *   scale parameter is phi = sum(r^2) / (n - p) with n = observed
 *   incrementals and p = 2I - 1 parameters for an I-origin triangle.
 * - Resampling: draw residuals with replacement onto the fitted past
 *   (q* = m + r sqrt(m)), cumulate, refit volume-weighted factors, project
 *   each future incremental, and add process variance by sampling
 *   Gamma(mean m_f, variance phi m_f). Residuals are inflated by
 *   sqrt(n / (n - p)) first (the standard small-sample bias adjustment) —
 *   controllable via options.
 * - Structural zero residuals (cells the fit reproduces exactly by
 *   construction, e.g. the corners) are excluded from the resampling pool.
 *
 * The GLM-mean == chain-ladder identity is the method's own validation
 * hook: `odpFit(tri).reserveByOrigin` must tie to the volume-weighted
 * chain ladder to floating-point precision, and the test suite pins it.
 */

export interface OdpFit {
  /** Volume-weighted all-year factors, one per development interval. */
  factors: number[];
  /** Fitted past incrementals m_ij (null where unobserved). */
  fittedIncrementals: (number | null)[][];
  /** Unscaled Pearson residuals (null where unobserved or structurally zero). */
  residuals: (number | null)[][];
  /** Future incremental means per cell (null where already observed). */
  futureMeans: (number | null)[][];
  /** Expected unpaid per origin (== volume-weighted chain ladder reserve). */
  reserveByOrigin: { origin: string; reserve: number }[];
  phi: number;
  n: number;
  p: number;
  /** Residuals actually in the resampling pool (structural zeros excluded). */
  poolSize: number;
  warnings: string[];
}

/** Volume-weighted all-year factors (the ODP GLM's implied development). */
function volumeWeightedFactors(tri: Triangle): number[] {
  const K = tri.ages.length;
  const out: number[] = [];
  for (let j = 0; j < K - 1; j++) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < tri.origins.length; i++) {
      const c0 = tri.values[i]![j] ?? null;
      const c1 = tri.values[i]![j + 1] ?? null;
      if (isNum(c0) && isNum(c1) && c0 > 0) {
        num += c1;
        den += c0;
      }
    }
    if (den <= 0) {
      throw new ReservingError(
        "NO_FACTOR",
        `Development column ${tri.ages[j]}-${tri.ages[j + 1]} has no usable factors for the ODP fit`,
      );
    }
    out.push(num / den);
  }
  return out;
}

/** Fits the ODP cross-classified model via the chain-ladder equivalence. */
export function odpFit(tri: Triangle): OdpFit {
  const warnings: string[] = [];
  const I = tri.origins.length;
  const K = tri.ages.length;
  if (I < 3 || K < 3) {
    throw new ReservingError("TOO_SMALL", "The ODP bootstrap needs at least a 3x3 triangle");
  }
  const factors = volumeWeightedFactors(tri);
  const incr = cumulativeToIncremental(tri);

  // Backwards recursion for fitted past cumulatives, anchored at each row's
  // latest observed diagonal.
  const fittedCum: (number | null)[][] = tri.origins.map(() => new Array(K).fill(null));
  const latestIdx: number[] = [];
  for (let i = 0; i < I; i++) {
    const d = lastObservedIndex(tri.values[i]!);
    latestIdx.push(d);
    if (d < 0) {
      warnings.push(`Origin ${tri.origins[i]} has no observed cells; excluded from the fit`);
      continue;
    }
    const anchor = tri.values[i]![d]!;
    fittedCum[i]![d] = anchor;
    for (let j = d - 1; j >= 0; j--) {
      fittedCum[i]![j] = fittedCum[i]![j + 1]! / factors[j]!;
    }
  }

  // Fitted past incrementals.
  const fittedIncrementals: (number | null)[][] = fittedCum.map((row, i) => {
    const d = latestIdx[i]!;
    return row.map((v, j) => {
      if (j > d || !isNum(v)) return null;
      if (j === 0) return v;
      return v - row[j - 1]!;
    });
  });

  // Pearson residuals; structural zeros (|q - m| ~ 0 at machine precision
  // where the fit reproduces the cell by construction) leave the pool.
  const residuals: (number | null)[][] = tri.origins.map(() => new Array(K).fill(null));
  let n = 0;
  let sumSq = 0;
  let pool = 0;
  let negativeFitted = 0;
  for (let i = 0; i < I; i++) {
    for (let j = 0; j <= latestIdx[i]!; j++) {
      const q = incr.values[i]![j] ?? null;
      const m = fittedIncrementals[i]![j] ?? null;
      if (!isNum(q) || !isNum(m)) continue;
      n++;
      if (m <= 0) {
        negativeFitted++;
        continue;
      }
      const r = (q - m) / Math.sqrt(m);
      sumSq += r * r;
      if (Math.abs(r) > 1e-10) {
        residuals[i]![j] = r;
        pool++;
      } else {
        residuals[i]![j] = 0; // structural zero: reported, not resampled
      }
    }
  }
  if (negativeFitted > 0) {
    warnings.push(
      `${negativeFitted} fitted incremental(s) are non-positive; their residuals are undefined and excluded (see Shapland on negative incrementals)`,
    );
  }
  const p = 2 * I - 1;
  if (n <= p) {
    throw new ReservingError(
      "TOO_SMALL",
      `The ODP fit has ${n} observations for ${p} parameters; no degrees of freedom remain`,
    );
  }
  const phi = sumSq / (n - p);

  // Future incremental means from the fitted projection.
  const futureMeans: (number | null)[][] = tri.origins.map(() => new Array(K).fill(null));
  const reserveByOrigin: { origin: string; reserve: number }[] = [];
  for (let i = 0; i < I; i++) {
    const d = latestIdx[i]!;
    if (d < 0) continue;
    let cum = tri.values[i]![d]!;
    let reserve = 0;
    for (let j = d + 1; j < K; j++) {
      const next = cum * factors[j - 1]!;
      const m = next - cum;
      futureMeans[i]![j] = m;
      reserve += m;
      cum = next;
    }
    reserveByOrigin.push({ origin: tri.origins[i]!, reserve });
  }

  return {
    factors,
    fittedIncrementals,
    residuals,
    futureMeans,
    reserveByOrigin,
    phi,
    n,
    p,
    poolSize: pool,
    warnings,
  };
}

export interface OdpBootstrapOptions {
  nSims: number;
  seed: number;
  /** Inflate residuals by sqrt(n/(n-p)) before resampling (default true). */
  biasAdjust?: boolean;
  /** Add ODP process variance via gamma sampling (default true). */
  processVariance?: boolean;
}

export interface OdpBootstrapResult extends StochasticResult {
  method: "odpBootstrap";
  fit: OdpFit;
}

/** The ODP bootstrap. Same seed + same triangle = same result, bit for bit. */
export function runOdpBootstrap(tri: Triangle, options: OdpBootstrapOptions): OdpBootstrapResult {
  const { nSims, seed } = options;
  if (!Number.isInteger(nSims) || nSims < 100) {
    throw new ReservingError("TOO_SMALL", "The bootstrap needs an integer nSims >= 100");
  }
  const biasAdjust = options.biasAdjust ?? true;
  const processVariance = options.processVariance ?? true;

  const fit = odpFit(tri);
  const warnings = [...fit.warnings];
  const I = tri.origins.length;
  const K = tri.ages.length;
  const rng = createRng(seed);

  // Residual pool (bias-adjusted), flattened.
  const inflate = biasAdjust ? Math.sqrt(fit.n / (fit.n - fit.p)) : 1;
  const pool: number[] = [];
  for (const row of fit.residuals) {
    for (const r of row) {
      if (isNum(r) && Math.abs(r) > 1e-10) pool.push(r * inflate);
    }
  }
  if (pool.length < 10) {
    throw new ReservingError("TOO_SMALL", "Fewer than 10 usable residuals; bootstrap unreliable");
  }

  const latestIdx = tri.values.map((row) => lastObservedIndex(row));
  let negativeFutureMeans = 0;

  const totals: number[] = new Array(nSims).fill(0);
  const perOrigin: number[][] = tri.origins.map(() => new Array(nSims).fill(0));

  for (let b = 0; b < nSims; b++) {
    // 1. Pseudo past incrementals -> pseudo cumulative triangle.
    const pseudoCum: (number | null)[][] = tri.origins.map(() => new Array(K).fill(null));
    for (let i = 0; i < I; i++) {
      let running = 0;
      for (let j = 0; j <= latestIdx[i]!; j++) {
        const m = fit.fittedIncrementals[i]![j];
        if (!isNum(m) || m <= 0) {
          // Cells without a usable fitted value keep their mean contribution.
          running += isNum(m) ? m : 0;
        } else {
          const r = pool[Math.floor(rng.next() * pool.length)]!;
          running += m + r * Math.sqrt(m);
        }
        pseudoCum[i]![j] = running;
      }
    }
    const pseudo: Triangle = {
      kind: tri.kind,
      origins: tri.origins,
      ages: tri.ages,
      values: pseudoCum,
    };

    // 2. Refit and project; 3. process variance on each future incremental.
    let factors: number[];
    try {
      factors = volumeWeightedFactors(pseudo);
    } catch {
      // A pathological resample (non-positive column volume) is discarded by
      // reusing the fitted factors; counted and warned once at the end.
      factors = fit.factors;
      negativeFutureMeans++;
    }
    for (let i = 0; i < I; i++) {
      const d = latestIdx[i]!;
      if (d < 0) continue;
      let cum = pseudoCum[i]![d]!;
      let reserve = 0;
      for (let j = d + 1; j < K; j++) {
        const next = cum * factors[j - 1]!;
        let m = next - cum;
        if (processVariance) {
          if (m > 0) {
            // Gamma with mean m, variance phi m.
            m = rng.gamma(m / fit.phi) * fit.phi;
          } else if (m < 0) {
            negativeFutureMeans++;
          }
        }
        reserve += m;
        // The projection chain advances on the mean path; process noise is
        // per-cell around the mean (England & Verrall 2002, Appendix 3).
        cum = next;
      }
      perOrigin[i]![b] = reserve;
      totals[b]! += reserve;
    }
  }
  if (negativeFutureMeans > 0) {
    warnings.push(
      `${negativeFutureMeans} simulated future incremental(s)/resample(s) had non-positive means; added deterministically without process variance (documented simplification for downward development)`,
    );
  }

  const byOrigin = tri.origins
    .map((origin, i) => ({ origin, samples: perOrigin[i]! }))
    .filter((e) => latestIdx[tri.origins.indexOf(e.origin)]! >= 0 && e.samples.some((v) => v !== 0))
    .map((e) => ({ origin: e.origin, summary: summarizeSample(e.samples) }));

  return {
    method: "odpBootstrap",
    quantity: "unpaid",
    seed,
    nSims,
    total: summarizeSample(totals),
    byOrigin,
    totalSamples: [...totals].sort((a, b) => a - b),
    fit,
    warnings,
  };
}
