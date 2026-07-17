import type { Triangle } from "./types.js";
import { ReservingError } from "./types.js";
import { cumulativeToIncremental } from "./triangleAlgebra.js";
import { isNum, lastObservedIndex } from "./util.js";

/**
 * Clark (2003), "LDF Curve-Fitting and Stochastic Reserving: A Maximum
 * Likelihood Approach", CAS Forum Fall 2003, pp. 41-92.
 *
 * Expected cumulative emergence is a parametric growth curve G(x):
 * - loglogistic: G(x) = x^omega / (x^omega + theta^omega)  (thick tail)
 * - Weibull:     G(x) = 1 - exp(-(x/theta)^omega)          (lighter tail)
 * where x is measured from the AVERAGE accident date of the origin period:
 * for a fully-earned accident year evaluated at age t months,
 * x = max(t - 6, t / 2) (Clark Appendix B, annual cadence).
 *
 * Two methods for the expected incremental loss between ages x and y:
 * - LDF:      mu = ULT_i * [G(y) - G(x)]            (one free ULT per origin)
 * - Cape Cod: mu = Premium_i * ELR * [G(y) - G(x)]  (one ELR for all origins)
 *
 * Increments are over-dispersed Poisson with Var = sigma^2 * mu; with
 * sigma^2 treated as known the MLE maximizes the quasi-loglikelihood
 * l = SUM [c ln(mu) - mu]. Setting dl/dULT_i = 0 (resp. dl/dELR = 0) gives
 * ULT_i = SUM_t c_it / SUM_t dG_it (resp. ELR = SUM c / SUM P dG), so both
 * methods reduce to a 2-parameter search over (omega, theta) with the
 * ultimates/ELR profiled out. sigma^2 = [1/(n-p)] SUM (c - mu)^2 / mu.
 *
 * Variances (delta method / Rao-Cramer): process variance of a reserve R is
 * sigma^2 * R; parameter variance is (dR)' SIGMA (dR) with
 * SIGMA = -sigma^2 * I^{-1}, I the observed information matrix of second
 * derivatives of l with respect to ALL parameters (ULTs/ELR included).
 * Both I and dR are computed by central finite differences with a relative
 * step of 1e-4 (small enough for quadrature accuracy on this smooth
 * likelihood, large enough that the second differences sit several orders of
 * magnitude above double-precision noise in the loglikelihood).
 *
 * Truncation: the loglogistic can extrapolate a very thick tail, so Clark
 * truncates development at a chosen age T: the truncated LDF is
 * G(avgAge(T)) / G(x), i.e. reserves emerge only up to G(avgAge(T)) rather
 * than to 1. Untruncated runs carry a warning to that effect.
 */

// ---------------------------------------------------------------------------
// Growth curves

export type ClarkCurve = "loglogistic" | "weibull";

/**
 * The growth function G(x) for x in months from the average accident date.
 * G(x) = expected fraction of ultimate emerged by x; G(x <= 0) = 0.
 */
export function clarkGrowth(
  curve: ClarkCurve,
  omega: number,
  theta: number,
): (xMonths: number) => number {
  if (!isNum(omega) || omega <= 0 || !isNum(theta) || theta <= 0) {
    throw new ReservingError(
      "BAD_FIT",
      "Growth-curve parameters omega and theta must be positive finite numbers",
    );
  }
  if (curve === "loglogistic") {
    // 1 / (1 + (theta/x)^omega) is the overflow-safe form of
    // x^omega / (x^omega + theta^omega).
    return (x) => (x <= 0 ? 0 : 1 / (1 + Math.pow(theta / x, omega)));
  }
  return (x) => (x <= 0 ? 0 : 1 - Math.exp(-Math.pow(x / theta, omega)));
}

/** Average-age convention for annual origins: age t months -> max(t-6, t/2). */
function avgAge(t: number): number {
  return t <= 0 ? 0 : Math.max(t - 6, t / 2);
}

// ---------------------------------------------------------------------------
// Result shapes

export interface ClarkOptions {
  curve: ClarkCurve;
  /**
   * Development age (months) at which the growth curve is truncated: reserves
   * emerge only up to G(avgAge(truncationAgeMonths)). Omit to extrapolate to
   * ultimate (G -> 1), which the result then warns about.
   */
  truncationAgeMonths?: number;
}

export interface ClarkRow {
  origin: string;
  /** Latest observed cumulative loss. */
  latest: number;
  /** G(x) at the origin's latest average age - expected fraction emerged. */
  growthAtAge: number;
  /** latest + reserve (losses at the truncation age when one is set). */
  ultimate: number;
  reserve: number;
  processSd: number;
  parameterSd: number;
  totalSd: number;
}

export interface ClarkResult {
  method: "clarkLdf" | "clarkCapeCod";
  curve: ClarkCurve;
  omega: number;
  theta: number;
  /** ODP dispersion: Var(c) = sigma2 * E[c]. */
  sigma2: number;
  /** Degrees of freedom n - p used for sigma2. */
  dof: number;
  /** Cape Cod only: the profiled MLE expected loss ratio. */
  elr?: number;
  rows: ClarkRow[];
  totals: { reserve: number; processSd: number; parameterSd: number; totalSd: number };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Deterministic Nelder-Mead (2D)

/**
 * Deterministic fixed-budget Nelder-Mead in 2D. Local copy of the private
 * optimizer in ilf.ts (deliberately duplicated rather than exporting that
 * module's internal helper; this is the house-standard severity-MLE search
 * verbatim). No randomness anywhere: the caller seeds a deterministic
 * starting simplex and the iteration budget is fixed.
 */
function nelderMead2(
  f: (p: [number, number]) => number,
  start: [number, number],
  scale: [number, number],
  iterations = 400,
): [number, number] {
  type Pt = { x: [number, number]; v: number };
  const mk = (x: [number, number]): Pt => ({ x, v: f(x) });
  let simplex: Pt[] = [
    mk(start),
    mk([start[0] + scale[0], start[1]]),
    mk([start[0], start[1] + scale[1]]),
  ];
  for (let it = 0; it < iterations; it++) {
    simplex.sort((p, q) => p.v - q.v);
    const [best, mid, worst] = simplex as [Pt, Pt, Pt];
    const centroid: [number, number] = [
      (best.x[0] + mid.x[0]) / 2,
      (best.x[1] + mid.x[1]) / 2,
    ];
    const reflect = mk([
      centroid[0] + (centroid[0] - worst.x[0]),
      centroid[1] + (centroid[1] - worst.x[1]),
    ]);
    if (reflect.v < best.v) {
      const expand = mk([
        centroid[0] + 2 * (centroid[0] - worst.x[0]),
        centroid[1] + 2 * (centroid[1] - worst.x[1]),
      ]);
      simplex[2] = expand.v < reflect.v ? expand : reflect;
    } else if (reflect.v < mid.v) {
      simplex[2] = reflect;
    } else {
      const contract = mk([
        centroid[0] + 0.5 * (worst.x[0] - centroid[0]),
        centroid[1] + 0.5 * (worst.x[1] - centroid[1]),
      ]);
      if (contract.v < worst.v) {
        simplex[2] = contract;
      } else {
        // Shrink toward the best point.
        simplex = [
          best,
          mk([(best.x[0] + mid.x[0]) / 2, (best.x[1] + mid.x[1]) / 2]),
          mk([(best.x[0] + worst.x[0]) / 2, (best.x[1] + worst.x[1]) / 2]),
        ];
      }
    }
  }
  simplex.sort((p, q) => p.v - q.v);
  return simplex[0]!.x;
}

// ---------------------------------------------------------------------------
// Small dense linear algebra (for the delta method)

/** Gauss-Jordan inverse with partial pivoting; throws when singular. */
function invertMatrix(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    const pivotValue = a[pivot]![col]!;
    if (!isNum(pivotValue) || Math.abs(pivotValue) < 1e-300) {
      throw new ReservingError(
        "BAD_FIT",
        "The information matrix is singular; parameter variances are not computable for this fit",
      );
    }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const scale = a[col]![col]!;
    for (let j = 0; j < 2 * n; j++) a[col]![j] = a[col]![j]! / scale;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r]![col]!;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r]![j] = a[r]![j]! - factor * a[col]![j]!;
    }
  }
  return a.map((row) => row.slice(n));
}

/** Relative step for all finite differences (see module header). */
const FD_RELATIVE_STEP = 1e-4;

function fdSteps(q: number[]): number[] {
  return q.map((v) => FD_RELATIVE_STEP * Math.max(Math.abs(v), 1));
}

/** Central-difference Hessian of f at q. */
function numericHessian(f: (q: number[]) => number, q: number[]): number[][] {
  const n = q.length;
  const h = fdSteps(q);
  const f0 = f(q);
  const at = (deltas: [number, number][]): number => {
    const p = [...q];
    for (const [idx, d] of deltas) p[idx] = p[idx]! + d;
    return f(p);
  };
  const hess: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const hi = h[i]!;
    hess[i]![i] = (at([[i, hi]]) - 2 * f0 + at([[i, -hi]])) / (hi * hi);
    for (let j = i + 1; j < n; j++) {
      const hj = h[j]!;
      const mixed =
        (at([
          [i, hi],
          [j, hj],
        ]) -
          at([
            [i, hi],
            [j, -hj],
          ]) -
          at([
            [i, -hi],
            [j, hj],
          ]) +
          at([
            [i, -hi],
            [j, -hj],
          ])) /
        (4 * hi * hj);
      hess[i]![j] = mixed;
      hess[j]![i] = mixed;
    }
  }
  return hess;
}

/** Central-difference gradient of f at q. */
function numericGradient(f: (q: number[]) => number, q: number[]): number[] {
  const h = fdSteps(q);
  return q.map((_, i) => {
    const plus = [...q];
    const minus = [...q];
    plus[i] = plus[i]! + h[i]!;
    minus[i] = minus[i]! - h[i]!;
    return (f(plus) - f(minus)) / (2 * h[i]!);
  });
}

function quadraticForm(g: number[], m: number[][]): number {
  let total = 0;
  for (let i = 0; i < g.length; i++) {
    for (let j = 0; j < g.length; j++) total += g[i]! * m[i]![j]! * g[j]!;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Data preparation

interface ClarkCell {
  /** Index into the INCLUDED origins (not the raw triangle row index). */
  origin: number;
  /** Average-age endpoints of the increment (months from avg accident date). */
  fromX: number;
  toX: number;
  value: number;
}

interface ClarkData {
  origins: string[];
  latest: number[];
  latestAge: number[];
  /** x = avgAge(latestAge) per included origin. */
  latestX: number[];
  cells: ClarkCell[];
  warnings: string[];
}

function prepareAnnualIncrements(tri: Triangle): ClarkData {
  const { ages } = tri;
  if (tri.origins.length === 0 || ages.length === 0) {
    throw new ReservingError("NO_DATA", "The triangle has no origins or development ages");
  }
  if (ages.some((a) => !Number.isInteger(a) || a <= 0 || a % 12 !== 0)) {
    throw new ReservingError(
      "SHAPE",
      "Clark methods are implemented for annual cadence: development ages must be positive multiples of 12 months",
    );
  }
  for (let j = 1; j < ages.length; j++) {
    if (ages[j]! <= ages[j - 1]!) {
      throw new ReservingError("SHAPE", "Development ages must be strictly ascending");
    }
  }

  const incremental = cumulativeToIncremental(tri);
  const warnings: string[] = [];
  const origins: string[] = [];
  const latest: number[] = [];
  const latestAge: number[] = [];
  const latestX: number[] = [];
  const cells: ClarkCell[] = [];
  let negativeIncrements = 0;

  for (let i = 0; i < tri.origins.length; i++) {
    const cumRow = tri.values[i]!;
    const lastIdx = lastObservedIndex(cumRow);
    if (lastIdx < 0) {
      warnings.push(`Origin ${tri.origins[i]} has no observed cells and was excluded`);
      continue;
    }
    // The profiled-ultimate algebra telescopes (sum of increments = latest)
    // only when the row is observed contiguously from its first age.
    for (let j = 0; j <= lastIdx; j++) {
      if (!isNum(cumRow[j] ?? null)) {
        throw new ReservingError(
          "SHAPE",
          `Origin ${tri.origins[i]} has an interior gap at age ${ages[j]}; Clark methods need contiguous observed development`,
        );
      }
    }
    const originIdx = origins.length;
    origins.push(tri.origins[i]!);
    latest.push(cumRow[lastIdx]!);
    latestAge.push(ages[lastIdx]!);
    latestX.push(avgAge(ages[lastIdx]!));
    const incRow = incremental.values[i]!;
    for (let j = 0; j <= lastIdx; j++) {
      const value = incRow[j]!;
      if (value < 0) negativeIncrements++;
      cells.push({
        origin: originIdx,
        fromX: avgAge(j === 0 ? 0 : ages[j - 1]!),
        toX: avgAge(ages[j]!),
        value,
      });
    }
  }

  if (origins.length === 0 || cells.length === 0) {
    throw new ReservingError("NO_DATA", "The triangle has no observed cells");
  }
  if (negativeIncrements > 0) {
    warnings.push(
      `${negativeIncrements} negative incremental cell(s); the ODP quasi-likelihood accommodates occasional negatives, but systematically negative expected development needs a different model`,
    );
  }
  return { origins, latest, latestAge, latestX, cells, warnings };
}

// ---------------------------------------------------------------------------
// Fitting

/**
 * Fits (omega, theta) by deterministic Nelder-Mead on the profiled negative
 * quasi-loglikelihood, searching in log space for positivity. The starting
 * simplex is seeded from the data: theta starts at half the oldest origin's
 * average age (the emergence midpoint of the observed history), omega at 1.5
 * (between the two curves' typical casualty shapes). A second, tighter
 * simplex polishes the coarse optimum; both budgets are fixed.
 */
function fitGrowthCurve(
  negLoglik: (p: [number, number]) => number,
  maxLatestX: number,
): { omega: number; theta: number } {
  const start: [number, number] = [Math.log(1.5), Math.log(Math.max(maxLatestX / 2, 1))];
  const coarse = nelderMead2(negLoglik, start, [0.5, 0.5], 500);
  const polished = nelderMead2(negLoglik, coarse, [0.02, 0.02], 300);
  if (!Number.isFinite(negLoglik(polished))) {
    throw new ReservingError(
      "BAD_FIT",
      "The growth-curve fit did not converge to a finite likelihood; the data do not support this curve",
    );
  }
  return { omega: Math.exp(polished[0]!), theta: Math.exp(polished[1]!) };
}

/** Per-cell G(toX) - G(fromX); null signals an unusable parameter point. */
function growthDiffs(
  curve: ClarkCurve,
  omega: number,
  theta: number,
  cells: ClarkCell[],
): number[] | null {
  if (!isNum(omega) || omega <= 0 || !isNum(theta) || theta <= 0) return null;
  const g = clarkGrowth(curve, omega, theta);
  const out = new Array<number>(cells.length);
  for (let k = 0; k < cells.length; k++) {
    const d = g(cells[k]!.toX) - g(cells[k]!.fromX);
    if (!isNum(d) || d <= 0) return null;
    out[k] = d;
  }
  return out;
}

function quasiLoglik(cells: ClarkCell[], mu: number[]): number {
  let l = 0;
  for (let k = 0; k < cells.length; k++) {
    const m = mu[k]!;
    if (!(m > 0)) return Number.NaN;
    l += cells[k]!.value * Math.log(m) - m;
  }
  return l;
}

function dispersion(
  cells: ClarkCell[],
  mu: number[],
  nParams: number,
): { sigma2: number; dof: number } {
  const dof = cells.length - nParams;
  if (dof <= 0) {
    throw new ReservingError(
      "TOO_SMALL",
      `${cells.length} incremental cells cannot support ${nParams} parameters; Clark's dispersion estimate needs n > p`,
    );
  }
  let sum = 0;
  for (let k = 0; k < cells.length; k++) {
    sum += (cells[k]!.value - mu[k]!) ** 2 / mu[k]!;
  }
  return { sigma2: sum / dof, dof };
}

function resolveTruncation(
  opts: ClarkOptions,
  latestAge: number[],
  warnings: string[],
): number | null {
  const trunc = opts.truncationAgeMonths;
  if (trunc === undefined) {
    warnings.push(
      `Reserves extrapolate the fitted ${opts.curve} growth curve to ultimate (G -> 1); Clark (2003) recommends truncating the tail at a finite age via truncationAgeMonths${opts.curve === "loglogistic" ? " - the loglogistic tail is thick and extrapolation can dominate the reserve" : ""}`,
    );
    return null;
  }
  if (!isNum(trunc) || trunc <= 0) {
    throw new ReservingError("BAD_TAIL", "truncationAgeMonths must be a positive number of months");
  }
  const maxAge = Math.max(...latestAge);
  if (trunc < maxAge) {
    throw new ReservingError(
      "BAD_TAIL",
      `truncationAgeMonths (${trunc}) must be at or beyond every origin's latest observed age (${maxAge})`,
    );
  }
  return trunc;
}

/**
 * Delta-method variance assembly shared by both methods.
 *
 * fullLoglik takes the FULL natural-scale parameter vector q (ULTs or ELR
 * first, then omega, theta); reserveAt(q, rowIndex) is the reserve function
 * whose gradient enters (dR)' SIGMA (dR). The total uses the summed gradient,
 * so cross-origin parameter covariance is included.
 */
function deltaMethodSds(
  fullLoglik: (q: number[]) => number,
  reserveAt: (q: number[], row: number) => number,
  qHat: number[],
  nRows: number,
  sigma2: number,
): { perRow: number[]; total: number } {
  const hessian = numericHessian(fullLoglik, qHat);
  const inverse = invertMatrix(hessian);
  // SIGMA = -sigma^2 * I^{-1} (Rao-Cramer with the observed information).
  const covariance = inverse.map((row) => row.map((v) => -sigma2 * v));
  const gradients = Array.from({ length: nRows }, (_, i) =>
    numericGradient((q) => reserveAt(q, i), qHat),
  );
  const perRow = gradients.map((g) => Math.sqrt(Math.max(0, quadraticForm(g, covariance))));
  const totalGradient = qHat.map((_, j) => gradients.reduce((acc, g) => acc + g[j]!, 0));
  const total = Math.sqrt(Math.max(0, quadraticForm(totalGradient, covariance)));
  return { perRow, total };
}

function assembleResult(
  method: ClarkResult["method"],
  opts: ClarkOptions,
  data: ClarkData,
  fit: { omega: number; theta: number; sigma2: number; dof: number },
  reserves: number[],
  parameterSds: { perRow: number[]; total: number },
  warnings: string[],
  elr?: number,
): ClarkResult {
  const g = clarkGrowth(opts.curve, fit.omega, fit.theta);
  const rows: ClarkRow[] = data.origins.map((origin, i) => {
    const reserve = reserves[i]!;
    const processSd = Math.sqrt(fit.sigma2 * Math.max(0, reserve));
    const parameterSd = parameterSds.perRow[i]!;
    return {
      origin,
      latest: data.latest[i]!,
      growthAtAge: g(data.latestX[i]!),
      ultimate: data.latest[i]! + reserve,
      reserve,
      processSd,
      parameterSd,
      totalSd: Math.sqrt(processSd ** 2 + parameterSd ** 2),
    };
  });
  const totalReserve = reserves.reduce((a, v) => a + v, 0);
  const totalProcessSd = Math.sqrt(fit.sigma2 * Math.max(0, totalReserve));
  return {
    method,
    curve: opts.curve,
    omega: fit.omega,
    theta: fit.theta,
    sigma2: fit.sigma2,
    dof: fit.dof,
    ...(elr === undefined ? {} : { elr }),
    rows,
    totals: {
      reserve: totalReserve,
      processSd: totalProcessSd,
      parameterSd: parameterSds.total,
      totalSd: Math.sqrt(totalProcessSd ** 2 + parameterSds.total ** 2),
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Method #2: LDF (one free ultimate per origin)

export function runClarkLdf(tri: Triangle, opts: ClarkOptions): ClarkResult {
  const data = prepareAnnualIncrements(tri);
  const warnings = [...data.warnings];
  const nOrigins = data.origins.length;

  // Profiling requires positive observed losses per origin (ULT_i > 0).
  const sumC = new Array<number>(nOrigins).fill(0);
  for (const cell of data.cells) sumC[cell.origin] = sumC[cell.origin]! + cell.value;
  for (let i = 0; i < nOrigins; i++) {
    if (!(sumC[i]! > 0)) {
      throw new ReservingError(
        "BAD_LOSSES",
        `Origin ${data.origins[i]} has non-positive total observed losses; the LDF method's profiled ultimate is undefined`,
      );
    }
  }

  const profiledUlts = (diffs: number[]): number[] => {
    const sumDg = new Array<number>(nOrigins).fill(0);
    for (let k = 0; k < data.cells.length; k++) {
      sumDg[data.cells[k]!.origin] = sumDg[data.cells[k]!.origin]! + diffs[k]!;
    }
    return sumDg.map((d, i) => sumC[i]! / d);
  };

  const negLoglik = (p: [number, number]): number => {
    const diffs = growthDiffs(opts.curve, Math.exp(p[0]), Math.exp(p[1]), data.cells);
    if (!diffs) return Number.POSITIVE_INFINITY;
    const ults = profiledUlts(diffs);
    const mu = data.cells.map((cell, k) => ults[cell.origin]! * diffs[k]!);
    const l = quasiLoglik(data.cells, mu);
    return Number.isFinite(l) ? -l : Number.POSITIVE_INFINITY;
  };

  const { omega, theta } = fitGrowthCurve(negLoglik, Math.max(...data.latestX));
  const diffsHat = growthDiffs(opts.curve, omega, theta, data.cells);
  if (!diffsHat) {
    throw new ReservingError("BAD_FIT", "The fitted growth curve is degenerate on this triangle");
  }
  const ultsHat = profiledUlts(diffsHat);
  const muHat = data.cells.map((cell, k) => ultsHat[cell.origin]! * diffsHat[k]!);
  const { sigma2, dof } = dispersion(data.cells, muHat, nOrigins + 2);

  const trunc = resolveTruncation(opts, data.latestAge, warnings);
  const truncX = trunc === null ? null : avgAge(trunc);

  // Reserve as a function of the FULL vector q = [ULT_1..ULT_n, omega, theta].
  const reserveAt = (q: number[], i: number): number => {
    const g = clarkGrowth(opts.curve, q[nOrigins]!, q[nOrigins + 1]!);
    const gEnd = truncX === null ? 1 : g(truncX);
    return q[i]! * (gEnd - g(data.latestX[i]!));
  };
  const fullLoglik = (q: number[]): number => {
    const diffs = growthDiffs(opts.curve, q[nOrigins]!, q[nOrigins + 1]!, data.cells);
    if (!diffs) return Number.NaN;
    const mus = data.cells.map((cell, k) => q[cell.origin]! * diffs[k]!);
    return quasiLoglik(data.cells, mus);
  };

  const qHat = [...ultsHat, omega, theta];
  const reserves = data.origins.map((_, i) => reserveAt(qHat, i));
  const parameterSds = deltaMethodSds(fullLoglik, reserveAt, qHat, nOrigins, sigma2);

  return assembleResult(
    "clarkLdf",
    opts,
    data,
    { omega, theta, sigma2, dof },
    reserves,
    parameterSds,
    warnings,
  );
}

// ---------------------------------------------------------------------------
// Method #1: Cape Cod (Premium x ELR x growth)

export function runClarkCapeCod(
  tri: Triangle,
  exposures: { origin: string; premium: number }[],
  opts: ClarkOptions,
): ClarkResult {
  const data = prepareAnnualIncrements(tri);
  const warnings = [...data.warnings];

  const premiumByOrigin = new Map(exposures.map((e) => [e.origin, e.premium]));
  const premium = data.origins.map((origin) => {
    const p = premiumByOrigin.get(origin) ?? null;
    if (!isNum(p) || p <= 0) {
      throw new ReservingError(
        "BAD_PREMIUM",
        `Origin ${origin} needs a positive onlevel premium for the Cape Cod method`,
      );
    }
    return p;
  });

  let totalC = 0;
  for (const cell of data.cells) totalC += cell.value;
  if (!(totalC > 0)) {
    throw new ReservingError(
      "BAD_LOSSES",
      "Total observed losses are non-positive; the profiled ELR is undefined",
    );
  }

  const profiledElr = (diffs: number[]): number => {
    let denom = 0;
    for (let k = 0; k < data.cells.length; k++) {
      denom += premium[data.cells[k]!.origin]! * diffs[k]!;
    }
    return totalC / denom;
  };

  const negLoglik = (p: [number, number]): number => {
    const diffs = growthDiffs(opts.curve, Math.exp(p[0]), Math.exp(p[1]), data.cells);
    if (!diffs) return Number.POSITIVE_INFINITY;
    const elr = profiledElr(diffs);
    const mu = data.cells.map((cell, k) => premium[cell.origin]! * elr * diffs[k]!);
    const l = quasiLoglik(data.cells, mu);
    return Number.isFinite(l) ? -l : Number.POSITIVE_INFINITY;
  };

  const { omega, theta } = fitGrowthCurve(negLoglik, Math.max(...data.latestX));
  const diffsHat = growthDiffs(opts.curve, omega, theta, data.cells);
  if (!diffsHat) {
    throw new ReservingError("BAD_FIT", "The fitted growth curve is degenerate on this triangle");
  }
  const elrHat = profiledElr(diffsHat);
  const muHat = data.cells.map((cell, k) => premium[cell.origin]! * elrHat * diffsHat[k]!);
  const { sigma2, dof } = dispersion(data.cells, muHat, 3);

  const trunc = resolveTruncation(opts, data.latestAge, warnings);
  const truncX = trunc === null ? null : avgAge(trunc);

  // Reserve as a function of the FULL vector q = [ELR, omega, theta].
  const reserveAt = (q: number[], i: number): number => {
    const g = clarkGrowth(opts.curve, q[1]!, q[2]!);
    const gEnd = truncX === null ? 1 : g(truncX);
    return premium[i]! * q[0]! * (gEnd - g(data.latestX[i]!));
  };
  const fullLoglik = (q: number[]): number => {
    if (!(q[0]! > 0)) return Number.NaN;
    const diffs = growthDiffs(opts.curve, q[1]!, q[2]!, data.cells);
    if (!diffs) return Number.NaN;
    const mus = data.cells.map((cell, k) => premium[cell.origin]! * q[0]! * diffs[k]!);
    return quasiLoglik(data.cells, mus);
  };

  const qHat = [elrHat, omega, theta];
  const reserves = data.origins.map((_, i) => reserveAt(qHat, i));
  const parameterSds = deltaMethodSds(fullLoglik, reserveAt, qHat, data.origins.length, sigma2);

  return assembleResult(
    "clarkCapeCod",
    opts,
    data,
    { omega, theta, sigma2, dof },
    reserves,
    parameterSds,
    warnings,
    elrHat,
  );
}
