import type {
  CalendarYearDiagnostic,
  DiagnosticFinding,
  DiagnosticsResult,
  Triangle,
} from "./types.js";
import { isNum, ols, safeRatio } from "./util.js";
import { mackEstimators } from "./mack.js";

/**
 * Data diagnostics an actuary uses to see when the data violates method
 * assumptions:
 * - paid-to-incurred ratios (case adequacy drift distorts incurred methods)
 * - average case reserves (severity/adequacy shifts)
 * - closure rates (settlement-rate shifts distort paid development)
 * - calendar-year effect detection (Mack's 1994 diagonal rank test)
 */

function ratioGrid(numTri: Triangle, denTri: Triangle): (number | null)[][] {
  return numTri.origins.map((_, i) =>
    numTri.ages.map((_, j) =>
      safeRatio(numTri.values[i]?.[j] ?? null, denTri.values[i]?.[j] ?? null),
    ),
  );
}

/**
 * Mack's calendar-year test: within each development column, factors above
 * the column median are Large, below are Small (ties to the median drop out).
 * Under the null of no diagonal effects, Large/Small mix randomly along each
 * calendar diagonal; Z = sum over diagonals of min(#L, #S) has a known mean
 * and variance. A total outside the 95% range flags calendar-year effects.
 */
export function calendarYearTest(tri: Triangle): CalendarYearDiagnostic | null {
  const nOrigins = tri.origins.length;
  const nCols = tri.ages.length - 1;
  if (nCols < 1 || nOrigins < 3) return null;

  // Classify each factor cell as L / S relative to its column median.
  type Mark = "L" | "S";
  const marks: (Mark | null)[][] = tri.origins.map(() => new Array(nCols).fill(null));
  for (let j = 0; j < nCols; j++) {
    const entries: { i: number; f: number }[] = [];
    for (let i = 0; i < nOrigins; i++) {
      const f = safeRatio(tri.values[i]?.[j + 1] ?? null, tri.values[i]?.[j] ?? null);
      if (isNum(f)) entries.push({ i, f });
    }
    if (entries.length < 2) continue;
    const sorted = entries.map((e) => e.f).sort((a, b) => a - b);
    const mid = sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]!
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
    for (const e of entries) {
      if (e.f > mid) marks[e.i]![j] = "L";
      else if (e.f < mid) marks[e.i]![j] = "S";
      // equal to the median -> eliminated
    }
  }

  // Group by calendar diagonal: factor cell (i, j) belongs to diagonal i + j + 1
  // (the calendar period of the numerator age).
  const byDiagonal = new Map<number, { L: number; S: number }>();
  for (let i = 0; i < nOrigins; i++) {
    for (let j = 0; j < nCols; j++) {
      const mark = marks[i]![j];
      if (!mark) continue;
      const d = i + j + 1;
      const bucket = byDiagonal.get(d) ?? { L: 0, S: 0 };
      bucket[mark]++;
      byDiagonal.set(d, bucket);
    }
  }

  const binom = (n: number, k: number): number => {
    if (k < 0 || k > n) return 0;
    let result = 1;
    for (let x = 1; x <= k; x++) result = (result * (n - x + 1)) / x;
    return result;
  };

  const diagonals: CalendarYearDiagnostic["diagonals"] = [];
  let totalZ = 0;
  let expectedTotalZ = 0;
  let varianceTotalZ = 0;
  const sortedDiagonals = [...byDiagonal.entries()].sort((a, b) => a[0] - b[0]);
  for (const [d, { L, S }] of sortedDiagonals) {
    const n = L + S;
    if (n < 1) continue;
    const z = Math.min(L, S);
    const m = Math.floor((n - 1) / 2);
    const c = binom(n - 1, m);
    const expectedZ = n / 2 - (c * n) / 2 ** n;
    const varianceZ =
      (n * (n - 1)) / 4 - (c * n * (n - 1)) / 2 ** n + expectedZ - expectedZ ** 2;
    diagonals.push({ label: `diagonal ${d}`, countLarge: L, countSmall: S, z, expectedZ, varianceZ });
    totalZ += z;
    expectedTotalZ += expectedZ;
    varianceTotalZ += varianceZ;
  }
  if (diagonals.length === 0) return null;

  const half = 1.96 * Math.sqrt(Math.max(0, varianceTotalZ));
  const confidenceInterval: [number, number] = [expectedTotalZ - half, expectedTotalZ + half];
  return {
    diagonals,
    totalZ,
    expectedTotalZ,
    varianceTotalZ,
    significant: totalZ < confidenceInterval[0] || totalZ > confidenceInterval[1],
    confidenceInterval,
  };
}

/**
 * Median relative shift of the most recent origin periods against the prior
 * ones, per development column, restricted to columns that are still
 * developing (median value below the maturity cap). This is how an actuary
 * reads a closure-rate exhibit: a step change in the recent rows at immature
 * ages, not a smooth trend across saturated columns.
 */
function recentVsPriorShift(
  grid: (number | null)[][],
  options: { recent?: number; maturityCap?: number } = {},
): number | null {
  const recentN = options.recent ?? 3;
  const maturityCap = options.maturityCap ?? Infinity;
  if (grid.length === 0) return null;
  const nCols = grid[0]!.length;
  const shifts: number[] = [];
  for (let j = 0; j < nCols; j++) {
    const values: number[] = [];
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i]![j] ?? null;
      if (isNum(v)) values.push(v);
    }
    if (values.length < recentN + 2) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    if (median >= maturityCap) continue; // column is saturated; no signal left
    const recent = values.slice(-recentN);
    const prior = values.slice(0, values.length - recentN);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const priorAvg = avg(prior);
    if (priorAvg === 0) continue;
    shifts.push(avg(recent) / priorAvg - 1);
  }
  if (shifts.length === 0) return null;
  shifts.sort((a, b) => a - b);
  const mid = Math.floor(shifts.length / 2);
  return shifts.length % 2 === 1 ? shifts[mid]! : (shifts[mid - 1]! + shifts[mid]!) / 2;
}

/**
 * Median relative per-period trend of a metric across development columns,
 * fitted down each column (same maturity across origin periods).
 */
function medianColumnTrend(grid: (number | null)[][]): number | null {
  if (grid.length === 0) return null;
  const nCols = grid[0]!.length;
  const trends: number[] = [];
  for (let j = 0; j < nCols; j++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i]![j] ?? null;
      if (isNum(v) && v > 0) {
        xs.push(i);
        ys.push(Math.log(v));
      }
    }
    if (xs.length >= 3) {
      const fit = ols(xs, ys);
      if (fit) trends.push(Math.exp(fit.slope) - 1);
    }
  }
  if (trends.length === 0) return null;
  trends.sort((a, b) => a - b);
  const mid = Math.floor(trends.length / 2);
  return trends.length % 2 === 1 ? trends[mid]! : (trends[mid - 1]! + trends[mid]!) / 2;
}

export interface DiagnosticsInput {
  paid: Triangle;
  incurred: Triangle;
  openCounts: Triangle;
  reportedCounts: Triangle;
  closedCounts: Triangle;
}

export function runDiagnostics(input: DiagnosticsInput): DiagnosticsResult {
  const { paid, incurred, openCounts, reportedCounts, closedCounts } = input;

  const paidToIncurredRatios = ratioGrid(paid, incurred);
  const caseGrid: (number | null)[][] = paid.origins.map((_, i) =>
    paid.ages.map((_, j) => {
      const inc = incurred.values[i]?.[j] ?? null;
      const pd = paid.values[i]?.[j] ?? null;
      const open = openCounts.values[i]?.[j] ?? null;
      const caseAmt = isNum(inc) && isNum(pd) ? inc - pd : null;
      return safeRatio(caseAmt, open);
    }),
  );
  const closureRates = ratioGrid(closedCounts, reportedCounts);
  const cyTest = calendarYearTest(paid);

  const findings: DiagnosticFinding[] = [];
  const closureShift = recentVsPriorShift(closureRates, { recent: 3, maturityCap: 0.95 });
  if (closureShift !== null && Math.abs(closureShift) > 0.05) {
    findings.push({
      severity: "warning",
      code: "SETTLEMENT_RATE_SHIFT",
      message: `Claim settlement is ${closureShift > 0 ? "speeding up" : "slowing down"}: at still-developing maturities, closure rates for the most recent origin periods run ${(Math.abs(closureShift) * 100).toFixed(0)}% ${closureShift > 0 ? "above" : "below"} the prior periods. Paid development factors are distorted; weigh the Berquist-Sherman settlement-rate adjustment.`,
    });
  }
  const caseTrend = medianColumnTrend(caseGrid);
  if (caseTrend !== null && Math.abs(caseTrend) > 0.08) {
    findings.push({
      severity: "warning",
      code: "CASE_ADEQUACY_SHIFT",
      message: `Average case reserves at the same maturity are trending ${caseTrend > 0 ? "up" : "down"} ${(caseTrend * 100).toFixed(1)}% per period, which suggests a change in case reserve adequacy (or severity). Incurred development is distorted; consider the Berquist-Sherman case-reserve adjustment and compare against a severity trend expectation.`,
    });
  }
  const p2iTrend = medianColumnTrend(paidToIncurredRatios);
  if (p2iTrend !== null && Math.abs(p2iTrend) > 0.03) {
    findings.push({
      severity: "info",
      code: "PAID_TO_INCURRED_SHIFT",
      message: `Paid-to-incurred ratios at the same maturity are drifting ${p2iTrend > 0 ? "up" : "down"} (median ${(p2iTrend * 100).toFixed(1)}% per period). Paid and incurred projections are likely to diverge; investigate before relying on either alone.`,
    });
  }
  if (cyTest?.significant) {
    findings.push({
      severity: "warning",
      code: "CALENDAR_YEAR_EFFECT",
      message: `Mack's calendar-year test rejects the null of no diagonal effects (Z = ${cyTest.totalZ.toFixed(1)} vs expected ${cyTest.expectedTotalZ.toFixed(1)}, 95% range ${cyTest.confidenceInterval[0].toFixed(1)}-${cyTest.confidenceInterval[1].toFixed(1)}). Calendar-period influences (inflation spikes, process changes, reserve reviews) are present; development-based methods assume these away.`,
    });
  }
  if (findings.length === 0) {
    findings.push({
      severity: "info",
      code: "NO_MATERIAL_DISTORTIONS",
      message:
        "No material settlement-rate, case-adequacy, or calendar-year distortions detected. Standard development assumptions look reasonable for this data.",
    });
  }

  return {
    paidToIncurredRatios,
    averageCaseReserves: caseGrid,
    closureRates,
    calendarYearTest: cyTest,
    findings,
  };
}

// ---------------------------------------------------------------------------
// Mack (1994) Appendix G: test for correlations between subsequent
// development factors.

export interface FactorCorrelationColumn {
  /** Development year k in Mack's 1-indexed notation (subsequent factors F_k vs preceding F_{k-1}). */
  k: number;
  /** Number of (preceding, subsequent) factor pairs used. */
  pairs: number;
  /** Spearman rank correlation T_k. */
  statistic: number;
}

export interface FactorCorrelationResult {
  columns: FactorCorrelationColumn[];
  /** T: the (pairs-1)-weighted average of the T_k. E[T] = 0 under the null. */
  statistic: number;
  /** Var(T) = 1 / sum of weights. */
  variance: number;
  /** Half-width of the 50% interval: 0.67 x sqrt(Var(T)). */
  bound50: number;
  /** True when |T| exceeds the 50% bound (be reluctant with chain ladder). */
  correlated: boolean;
  warnings: string[];
}

/** Average ranks (ties averaged), 1-based. */
function averageRanks(values: number[]): number[] {
  const order = values
    .map((v, idx) => ({ v, idx }))
    .sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length).fill(0);
  let pos = 0;
  while (pos < order.length) {
    let end = pos;
    while (end + 1 < order.length && order[end + 1]!.v === order[pos]!.v) end++;
    const avg = (pos + end) / 2 + 1;
    for (let x = pos; x <= end; x++) ranks[order[x]!.idx] = avg;
    pos = end + 1;
  }
  return ranks;
}

/**
 * Mack's Spearman test for correlation between subsequent development
 * factors (Mack 1994, CAS Forum Spring 1994, Appendix G).
 *
 * For each development year k = 2..I-2: rank the subsequent factors F_k over
 * the rows where the NEXT factor exists, rank the preceding factors F_{k-1}
 * over those same rows (re-ranked after dropping the deeper rows), and take
 * T_k = 1 - 6 sum(d^2) / (n(n^2-1)). Combine with weights (pairs - 1) —
 * inverse to Var(T_k) = 1/(n_k - 1). Under the null E[T] = 0 and
 * Var(T) = 1/sum(weights); the DELIBERATELY tight 50% interval
 * (|T| <= 0.67 sqrt(Var)) screens for correlation in a substantial part of
 * the triangle rather than formally testing at 5%.
 *
 * Returns null when no column pair has at least two factor pairs.
 */
export function factorCorrelationTest(tri: Triangle): FactorCorrelationResult | null {
  const n = tri.origins.length;
  const nCols = tri.ages.length - 1;
  const warnings: string[] = [];

  // F[i][c] = C[i][c+1] / C[i][c] (0-indexed column c holds Mack's F_{c+1}).
  const F: (number | null)[][] = tri.origins.map((_, i) =>
    Array.from({ length: nCols }, (_, c) =>
      safeRatio(tri.values[i]?.[c + 1] ?? null, tri.values[i]?.[c] ?? null),
    ),
  );

  const columns: FactorCorrelationColumn[] = [];
  for (let k = 2; k <= Math.min(n - 2, nCols); k++) {
    const cs = k - 1; // 0-indexed subsequent column (F_k)
    const cp = k - 2; // 0-indexed preceding column (F_{k-1})
    const sub: number[] = [];
    const pre: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = F[i]![cs] ?? null;
      const b = F[i]![cp] ?? null;
      if (isNum(a) && isNum(b)) {
        sub.push(a);
        pre.push(b);
      }
    }
    const m = sub.length;
    if (m < 2) continue;
    const hasTies =
      new Set(sub).size !== sub.length || new Set(pre).size !== pre.length;
    if (hasTies) {
      warnings.push(
        `Development year ${k}: tied factors; the Spearman statistic is approximate under ties`,
      );
    }
    const r = averageRanks(sub);
    const s = averageRanks(pre);
    let d2 = 0;
    for (let x = 0; x < m; x++) d2 += (r[x]! - s[x]!) ** 2;
    const Tk = 1 - (6 * d2) / (m * (m * m - 1));
    columns.push({ k, pairs: m, statistic: Tk });
  }

  if (columns.length === 0) return null;
  const weightSum = columns.reduce((a, c) => a + (c.pairs - 1), 0);
  if (weightSum <= 0) return null;
  const statistic = columns.reduce((a, c) => a + (c.pairs - 1) * c.statistic, 0) / weightSum;
  const variance = 1 / weightSum;
  const bound50 = 0.67 * Math.sqrt(variance);
  return {
    columns,
    statistic,
    variance,
    bound50,
    correlated: Math.abs(statistic) > bound50,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Mack residuals: standardized development residuals for plotting and for
// eyeballing origin / development / calendar structure.

export interface MackResidualCell {
  origin: string;
  fromAge: number;
  toAge: number;
  /** 1-based calendar diagonal of the factor's numerator cell. */
  calendar: number;
  factor: number;
  /** (F - f_k) sqrt(C_ik) / sigma_k; null where sigma^2 is not data-estimable or zero. */
  residual: number | null;
}

export interface MackResidualsResult {
  cells: MackResidualCell[];
  warnings: string[];
}

/**
 * Standardized Mack residuals r_ik = (F_ik - f_k) sqrt(C_ik) / sigma_k
 * around the volume-weighted factors, with sigma^2_k estimated from the
 * data (Mack 1994). Columns whose sigma^2 cannot be estimated from at least
 * two factors — or where the factors show no dispersion at all — yield null
 * residuals with a warning; extrapolated sigma^2 is deliberately NOT used
 * here (a residual against an extrapolated scale is not a diagnostic).
 *
 * Structural property: within each column, sum_i residual_ik x sqrt(C_ik)
 * = 0 exactly, because f_k is the volume-weighted average.
 */
export function mackResiduals(tri: Triangle): MackResidualsResult {
  const warnings: string[] = [];
  const { f, sigma2 } = mackEstimators(tri);
  const cells: MackResidualCell[] = [];
  const flaggedColumns = new Set<number>();

  for (let c = 0; c < tri.ages.length - 1; c++) {
    const s2 = sigma2[c] ?? null;
    const usable = isNum(s2) && s2 > 0;
    if (!usable && !flaggedColumns.has(c)) {
      flaggedColumns.add(c);
      warnings.push(
        `Column ${tri.ages[c]}-${tri.ages[c + 1]}: sigma^2 is ${s2 === null ? "not estimable from the data" : "zero (no dispersion)"}; residuals are null there`,
      );
    }
    for (let i = 0; i < tri.origins.length; i++) {
      const c0 = tri.values[i]?.[c] ?? null;
      const c1 = tri.values[i]?.[c + 1] ?? null;
      if (!isNum(c0) || !isNum(c1) || c0 <= 0) continue;
      const factor = c1 / c0;
      cells.push({
        origin: tri.origins[i]!,
        fromAge: tri.ages[c]!,
        toAge: tri.ages[c + 1]!,
        calendar: i + c + 1,
        factor,
        residual: usable ? ((factor - f[c]!) * Math.sqrt(c0)) / Math.sqrt(s2!) : null,
      });
    }
  }
  return { cells, warnings };
}
