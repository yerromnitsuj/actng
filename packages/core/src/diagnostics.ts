import type {
  CalendarYearDiagnostic,
  DiagnosticFinding,
  DiagnosticsResult,
  Triangle,
} from "./types.js";
import { isNum, ols, safeRatio } from "./util.js";

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
  const closureTrend = medianColumnTrend(closureRates);
  if (closureTrend !== null && Math.abs(closureTrend) > 0.02) {
    findings.push({
      severity: "warning",
      code: "SETTLEMENT_RATE_SHIFT",
      message: `Claim closure rates are ${closureTrend > 0 ? "speeding up" : "slowing down"} across accident periods (median ${(closureTrend * 100).toFixed(1)}% per period at the same maturity). Paid development factors are distorted; consider the Berquist-Sherman settlement-rate adjustment.`,
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
