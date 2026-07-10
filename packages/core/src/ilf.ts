import type { ClaimSnapshot } from "./types.js";
import { ReservingError } from "./types.js";
import { isNum } from "./util.js";

/**
 * Increased-limits machinery: severity distributions, limited expected
 * values, and the uncap factor E[X] / E[X ∧ cap] that restores developed
 * capped ultimates to total limits.
 *
 * Severities are fitted at the cap's BASE-YEAR cost level (each claim
 * deflated by the layer's index), so an indexed cap - a constant layer in
 * real terms - yields one uncap factor for all origin years. Under a flat
 * cap with real severity trend the factor truly varies by year; the fit
 * warns in that case, and per-year refinement arrives with the trend module.
 */

// ---------------------------------------------------------------------------
// Normal CDF (Abramowitz & Stegun 7.1.26; |error| < 1.5e-7)

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// ---------------------------------------------------------------------------
// Severity distributions

export type SeverityDistribution =
  | { kind: "lognormal"; mu: number; sigma: number }
  | { kind: "pareto"; theta: number; alpha: number };

/** Mean E[X]; null when infinite (Pareto alpha <= 1). */
export function severityMean(dist: SeverityDistribution): number | null {
  if (dist.kind === "lognormal") {
    return Math.exp(dist.mu + (dist.sigma * dist.sigma) / 2);
  }
  if (dist.alpha <= 1) return null;
  return dist.theta / (dist.alpha - 1);
}

/** Limited expected value E[X ∧ c]. */
export function limitedExpectedValue(dist: SeverityDistribution, c: number): number {
  if (!isNum(c) || c <= 0) {
    throw new ReservingError("BAD_LIMIT", "The limit for a LEV must be a positive number");
  }
  if (dist.kind === "lognormal") {
    const { mu, sigma } = dist;
    const z1 = (Math.log(c) - mu - sigma * sigma) / sigma;
    const z2 = (Math.log(c) - mu) / sigma;
    return Math.exp(mu + (sigma * sigma) / 2) * normalCdf(z1) + c * (1 - normalCdf(z2));
  }
  const { theta, alpha } = dist;
  if (Math.abs(alpha - 1) < 1e-9) {
    // alpha -> 1 limit of the closed form: theta * ln((c + theta)/theta)
    return theta * Math.log((c + theta) / theta);
  }
  return (theta / (alpha - 1)) * (1 - Math.pow(theta / (c + theta), alpha - 1));
}

/**
 * The uncap factor to a target limit: E[X ∧ target] / E[X ∧ cap], with
 * target null meaning unlimited (E[X] / E[X ∧ cap]). Throws when the
 * distribution has no finite mean and target is unlimited.
 */
export function uncapFactor(
  dist: SeverityDistribution,
  cap: number,
  target: number | null,
): number {
  const denominator = limitedExpectedValue(dist, cap);
  if (!(denominator > 0)) {
    throw new ReservingError("BAD_LIMIT", "E[X ∧ cap] is not positive; check the fit and cap");
  }
  if (target === null) {
    const mean = severityMean(dist);
    if (mean === null) {
      throw new ReservingError(
        "INFINITE_MEAN",
        "This Pareto fit has alpha <= 1 (infinite mean); an unlimited restoration is undefined - pick a finite target limit or a different curve",
      );
    }
    return mean / denominator;
  }
  if (target < cap) {
    throw new ReservingError("BAD_LIMIT", "The restoration target must be at or above the cap");
  }
  const factor = limitedExpectedValue(dist, target) / denominator;
  if (!Number.isFinite(factor)) {
    throw new ReservingError(
      "BAD_FIT",
      "The fitted distribution produced a non-finite limited expected value (degenerate parameters); the fit is not usable for restoration",
    );
  }
  return factor;
}

// ---------------------------------------------------------------------------
// Censoring-aware MLE (closed claims exact, open claims right-censored)

export interface SeverityObservation {
  /** Severity at the claim's latest evaluation, at base-year cost level. */
  value: number;
  /**
   * True when the claim is still open. Its reported incurred is then treated
   * as a right-censoring floor on ultimate severity - a CASE-ADEQUACY
   * ASSUMPTION, not a fact: redundant case reserves overstate the fitted
   * tail, deficient ones understate it. Fits must carry this caveat.
   */
  censored: boolean;
}

export interface SeverityFit {
  distribution: SeverityDistribution;
  logLikelihood: number;
  nExact: number;
  nCensored: number;
  nExcludedNonPositive: number;
  valid: boolean;
  warnings: string[];
  /**
   * Kaplan-Meier (censoring-adjusted) empirical quantiles vs fitted
   * unconditional quantiles. Closed-claims-only quantiles are biased small
   * (large claims stay open), so the empirical side uses the product-limit
   * estimator; null where censoring exhausts the observable range.
   */
  quantileCheck: { p: number; empirical: number | null; fitted: number }[];
}

const QUANTILE_PROBES = [0.5, 0.75, 0.9, 0.95, 0.99];

function lognormalQuantile(mu: number, sigma: number, p: number): number {
  // Inverse normal via Acklam's rational approximation (sufficient here).
  const q = inverseNormalCdf(p);
  return Math.exp(mu + sigma * q);
}

function paretoQuantile(theta: number, alpha: number, p: number): number {
  return theta * (Math.pow(1 - p, -1 / alpha) - 1);
}

function inverseNormalCdf(p: number): number {
  // Acklam's algorithm; |relative error| < 1.15e-9 over (0,1).
  if (p <= 0 || p >= 1) throw new ReservingError("BAD_LIMIT", "quantile p must be in (0,1)");
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269,
    -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197,
    -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373,
    4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pLow = 0.02425;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p <= 1 - pLow) {
    q = p - 0.5;
    r = q * q;
    return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}

/** Deterministic Nelder-Mead in 2D (fixed iteration budget, no randomness). */
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

const MIN_OBSERVATIONS = 10;
const THIN_OBSERVATIONS = 30;

/**
 * Fits a severity distribution by maximum likelihood with right-censoring:
 * closed claims contribute the density, open claims the survival at their
 * reported incurred. Treating reported incurred as a floor on ultimate
 * severity is a CASE-ADEQUACY assumption - on books with redundant reserves
 * the fitted tail (and any uncap factor from it) is overstated. Fits are
 * additionally gated on censored share and parameter sanity: a likelihood
 * dominated by open claims can push the tail arbitrarily heavy while looking
 * converged.
 */
export function fitSeverity(
  observations: SeverityObservation[],
  kind: SeverityDistribution["kind"],
): SeverityFit {
  const warnings: string[] = [];
  const usable = observations.filter((o) => isNum(o.value) && o.value > 0);
  const nExcluded = observations.length - usable.length;
  const exact = usable.filter((o) => !o.censored).map((o) => o.value);
  const censored = usable.filter((o) => o.censored).map((o) => o.value);

  const invalid = (message: string): SeverityFit => ({
    distribution:
      kind === "lognormal"
        ? { kind: "lognormal", mu: 0, sigma: 1 }
        : { kind: "pareto", theta: 1, alpha: 2 },
    logLikelihood: NaN,
    nExact: exact.length,
    nCensored: censored.length,
    nExcludedNonPositive: nExcluded,
    valid: false,
    warnings: [...warnings, message],
    quantileCheck: [],
  });

  if (usable.length < MIN_OBSERVATIONS) {
    return invalid(
      `Only ${usable.length} usable claim severities; at least ${MIN_OBSERVATIONS} are needed for a credible fit`,
    );
  }
  if (exact.length < 5) {
    return invalid(
      `Only ${exact.length} closed (uncensored) claims; the likelihood is dominated by censoring and the fit is not credible`,
    );
  }
  const censoredShare = censored.length / usable.length;
  if (censoredShare > 0.8) {
    return invalid(
      `${Math.round(censoredShare * 100)}% of usable claims are open (right-censored): the likelihood is censoring-dominated and the fitted tail is not credible`,
    );
  }
  if (censoredShare > 0.5) {
    warnings.push(
      `${Math.round(censoredShare * 100)}% of usable claims are open: the fit leans heavily on the case-adequacy assumption; treat the tail with caution`,
    );
  }
  if (usable.length < THIN_OBSERVATIONS) {
    warnings.push(
      `Only ${usable.length} usable claim severities; treat the fitted tail with caution`,
    );
  }
  if (nExcluded > 0) {
    warnings.push(`${nExcluded} zero/negative severities excluded from the fit`);
  }

  let dist: SeverityDistribution;
  let logLik: number;

  if (kind === "lognormal") {
    const negLogLik = (p: [number, number]): number => {
      const mu = p[0];
      const sigma = Math.exp(p[1]); // positivity via log-space
      let ll = 0;
      for (const x of exact) {
        const z = (Math.log(x) - mu) / sigma;
        ll += -Math.log(sigma * x) - 0.5 * Math.log(2 * Math.PI) - 0.5 * z * z;
      }
      for (const x of censored) {
        const s = 1 - normalCdf((Math.log(x) - mu) / sigma);
        ll += Math.log(Math.max(s, 1e-300));
      }
      return -ll;
    };
    // Method-of-moments start on log(exact).
    const logs = exact.map((x) => Math.log(x));
    const m = logs.reduce((a, v) => a + v, 0) / logs.length;
    const sd = Math.sqrt(
      Math.max(1e-6, logs.reduce((a, v) => a + (v - m) ** 2, 0) / Math.max(1, logs.length - 1)),
    );
    const best = nelderMead2(negLogLik, [m, Math.log(sd)], [0.5, 0.5]);
    dist = { kind: "lognormal", mu: best[0], sigma: Math.exp(best[1]) };
    logLik = -negLogLik(best);
  } else {
    const negLogLik = (p: [number, number]): number => {
      const theta = Math.exp(p[0]);
      const alpha = Math.exp(p[1]);
      let ll = 0;
      for (const x of exact) {
        ll += Math.log(alpha) + alpha * Math.log(theta) - (alpha + 1) * Math.log(x + theta);
      }
      for (const x of censored) {
        ll += alpha * (Math.log(theta) - Math.log(x + theta));
      }
      return -ll;
    };
    const mean = exact.reduce((a, v) => a + v, 0) / exact.length;
    const best = nelderMead2(negLogLik, [Math.log(mean), Math.log(2)], [1, 0.5]);
    dist = { kind: "pareto", theta: Math.exp(best[0]), alpha: Math.exp(best[1]) };
    logLik = -negLogLik(best);
  }

  // Parameter-sanity gates: an optimizer that "converged" onto a degenerate
  // or implausibly heavy tail is a failed fit for restoration purposes.
  const problems: string[] = [];
  if (!Number.isFinite(logLik)) {
    problems.push("The likelihood did not converge to a finite value");
  }
  if (dist.kind === "lognormal") {
    if (dist.sigma < 1e-6) {
      problems.push("Fitted sigma is ~0 (degenerate point mass); the fit is not usable");
    } else if (dist.sigma > 3.5) {
      problems.push(
        `Fitted lognormal sigma ${dist.sigma.toFixed(2)} implies an implausibly heavy tail - typically a censoring-dominated likelihood; the fit is not usable for restoration`,
      );
    } else if (dist.sigma > 2.5) {
      warnings.push(
        `Fitted lognormal sigma ${dist.sigma.toFixed(2)} is very heavy for casualty severity; verify against the claim-size distribution before restoring with it`,
      );
    }
  } else {
    if (dist.alpha <= 1) {
      problems.push(
        `Fitted Pareto alpha ${dist.alpha.toFixed(3)} <= 1 (infinite mean): the fit is not usable for restoration at ANY target`,
      );
    } else if (dist.alpha < 1.2) {
      warnings.push(
        `Fitted Pareto alpha ${dist.alpha.toFixed(3)} is an extremely heavy tail; verify before restoring with it`,
      );
    }
  }

  const kmQuantiles = kaplanMeierQuantiles(exact, censored, QUANTILE_PROBES);
  const quantileCheck = QUANTILE_PROBES.map((p, i) => ({
    p,
    empirical: kmQuantiles[i]!,
    fitted:
      dist.kind === "lognormal"
        ? lognormalQuantile(dist.mu, dist.sigma, p)
        : paretoQuantile(dist.theta, dist.alpha, p),
  }));

  return {
    distribution: dist,
    logLikelihood: logLik,
    nExact: exact.length,
    nCensored: censored.length,
    nExcludedNonPositive: nExcluded,
    valid: problems.length === 0,
    warnings: [...warnings, ...problems],
    quantileCheck,
  };
}

/**
 * Kaplan-Meier product-limit quantiles over exact + right-censored values:
 * the censoring-adjusted empirical benchmark (closed-only quantiles are
 * biased small because large claims stay open). Returns null for probes the
 * survival curve cannot reach (censoring exhausts the observable range).
 * Ties convention: events precede censorings at the same value.
 */
export function kaplanMeierQuantiles(
  exact: number[],
  censored: number[],
  probes: number[],
): (number | null)[] {
  const events = [...exact].sort((a, b) => a - b);
  const all = [
    ...exact.map((v) => ({ v, event: true })),
    ...censored.map((v) => ({ v, event: false })),
  ];
  const n = all.length;
  if (n === 0 || events.length === 0) return probes.map(() => null);

  // Survival steps at each distinct event value.
  const steps: { value: number; survival: number }[] = [];
  let survival = 1;
  const distinct = [...new Set(events)];
  for (const t of distinct) {
    const atRisk = all.filter((o) => o.v >= t).length; // censored ties still at risk
    const d = events.filter((v) => v === t).length;
    if (atRisk <= 0) break;
    survival *= 1 - d / atRisk;
    steps.push({ value: t, survival });
  }

  return probes.map((p) => {
    const threshold = 1 - p;
    for (const step of steps) {
      if (step.survival <= threshold + 1e-12) return step.value;
    }
    return null; // curve never falls this far: censored beyond observable range
  });
}

/**
 * Structural validation shared by every ILF-table write path (import route,
 * workspace patch) and by interpolation: >= 2 rows, positive limits and
 * factors, unique limits, factors non-decreasing in the limit. Throws
 * ReservingError so garbage is rejected at the door, identically everywhere.
 */
export function validateIlfTable(table: IlfTableRow[]): IlfTableRow[] {
  if (!Array.isArray(table) || table.length < 2) {
    throw new ReservingError("BAD_TABLE", "An ILF table needs at least two limit/factor rows");
  }
  const rows = [...table].sort((a, b) => a.limit - b.limit);
  for (const row of rows) {
    if (!isNum(row.limit) || row.limit <= 0 || !isNum(row.factor) || row.factor <= 0) {
      throw new ReservingError("BAD_TABLE", "ILF rows must have positive limits and factors");
    }
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.limit === rows[i - 1]!.limit) {
      throw new ReservingError(
        "BAD_TABLE",
        `Duplicate limit ${rows[i]!.limit.toLocaleString()} in the ILF table`,
      );
    }
    if (rows[i]!.factor < rows[i - 1]!.factor) {
      throw new ReservingError("BAD_TABLE", "ILF factors must be non-decreasing in the limit");
    }
  }
  return rows;
}

/**
 * Base-year-level severity observations from a loss run: each claim's latest
 * evaluation on or before asOfDate, deflated by the cap index, open claims
 * censored at reported incurred.
 */
export function severityObservations(
  claims: ClaimSnapshot[],
  options: { asOfDate?: string; indexRate?: number; baseYear: number },
): SeverityObservation[] {
  const asOf = options.asOfDate ?? "9999-12-31";
  const indexRate = options.indexRate ?? 0;
  const latest = new Map<string, ClaimSnapshot>();
  for (const snap of claims) {
    if (snap.evaluationDate > asOf) continue;
    const prev = latest.get(snap.claimId);
    if (!prev || snap.evaluationDate > prev.evaluationDate) latest.set(snap.claimId, snap);
  }
  return [...latest.values()].map((snap) => {
    const year = Number(snap.accidentDate.slice(0, 4));
    const incurred = snap.paidToDate + snap.caseReserve;
    return {
      value: incurred / Math.pow(1 + indexRate, year - options.baseYear),
      censored: snap.status === "open",
    };
  });
}

// ---------------------------------------------------------------------------
// ILF tables (imported) and illustrative curves

export interface IlfTableRow {
  limit: number;
  factor: number;
}

/**
 * Log-log interpolated ILF at a limit. Exact at knots; throws when the
 * table does not bracket the requested limit (extrapolating an ILF table is
 * how excess layers get silently mispriced).
 */
export function interpolateIlf(table: IlfTableRow[], limit: number): number {
  const rows = validateIlfTable(table);
  if (limit < rows[0]!.limit || limit > rows[rows.length - 1]!.limit) {
    throw new ReservingError(
      "TABLE_RANGE",
      `The table covers limits ${rows[0]!.limit.toLocaleString()} to ${rows[rows.length - 1]!.limit.toLocaleString()}; ${limit.toLocaleString()} is outside it`,
    );
  }
  for (let i = 1; i < rows.length; i++) {
    const lo = rows[i - 1]!;
    const hi = rows[i]!;
    if (limit === lo.limit) return lo.factor;
    if (limit === hi.limit) return hi.factor;
    if (limit > lo.limit && limit < hi.limit) {
      const t = (Math.log(limit) - Math.log(lo.limit)) / (Math.log(hi.limit) - Math.log(lo.limit));
      return Math.exp(Math.log(lo.factor) + t * (Math.log(hi.factor) - Math.log(lo.factor)));
    }
  }
  return rows[rows.length - 1]!.factor;
}

/** Table-based uncap factor: ILF(target)/ILF(cap). */
export function tableUncapFactor(table: IlfTableRow[], cap: number, target: number): number {
  if (target < cap) {
    throw new ReservingError("BAD_LIMIT", "The restoration target must be at or above the cap");
  }
  return interpolateIlf(table, target) / interpolateIlf(table, cap);
}

/**
 * Illustrative severity curves for when no licensed table and no credible
 * own-data fit exist. Parameters are textbook-plausible shapes, NOT ISO or
 * NCCI factors - the UI must say so loudly.
 */
export const ILLUSTRATIVE_CURVES: {
  id: string;
  label: string;
  distribution: SeverityDistribution;
}[] = [
  {
    id: "casualty-lognormal-moderate",
    label: "Illustrative casualty severity - lognormal, moderate tail",
    distribution: { kind: "lognormal", mu: 9.2, sigma: 1.4 },
  },
  {
    id: "casualty-lognormal-heavy",
    label: "Illustrative casualty severity - lognormal, heavy tail",
    distribution: { kind: "lognormal", mu: 9.0, sigma: 1.8 },
  },
  {
    id: "liability-pareto",
    label: "Illustrative liability severity - Pareto (theta 40k, alpha 1.8)",
    distribution: { kind: "pareto", theta: 40_000, alpha: 1.8 },
  },
];
