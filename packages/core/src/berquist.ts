import type {
  BerquistCaseAdequacyResult,
  BerquistSettlementResult,
  Triangle,
} from "./types.js";
import { ReservingError } from "./types.js";
import { isNum, lastObservedIndex, ols, safeRatio } from "./util.js";

/**
 * Berquist-Sherman adjustments (Berquist & Sherman 1977; Friedland ch. 13).
 *
 * Case-reserve adequacy: restate historical average case reserves (case
 * reserves / open counts, by cell) to the current adequacy level by
 * de-trending the latest diagonal backwards at an annual severity trend,
 * then rebuild adjusted incurred = paid + restated average case x open counts.
 *
 * Settlement-rate: compute disposal rates (closed counts / ultimate counts),
 * take the current settlement pattern from the latest diagonal, and restate
 * historical paid losses by interpolating paid at the disposal-rate-equivalent
 * closed-count level -- the textbook interpolation on (closed count, paid)
 * points within each origin row, not a scalar ratio shortcut.
 */

function assertSameShape(a: Triangle, b: Triangle, what: string): void {
  if (
    a.origins.length !== b.origins.length ||
    a.ages.length !== b.ages.length ||
    a.origins.some((o, i) => o !== b.origins[i]) ||
    a.ages.some((g, j) => g !== b.ages[j])
  ) {
    throw new ReservingError("SHAPE", `${what} triangles must share origins and ages`);
  }
}

/** Last observed row index in a column; -1 when the column is empty. */
function lastObservedRowInColumn(tri: Triangle, j: number): number {
  for (let i = tri.origins.length - 1; i >= 0; i--) {
    if (isNum(tri.values[i]![j] ?? null)) return i;
  }
  return -1;
}

export interface CaseAdequacyOptions {
  /** Annual severity trend override (e.g. 0.15 for +15%/yr). Fitted when omitted. */
  severityTrend?: number;
}

export function berquistCaseAdequacy(
  paid: Triangle,
  incurred: Triangle,
  openCounts: Triangle,
  options: CaseAdequacyOptions = {},
): BerquistCaseAdequacyResult {
  assertSameShape(paid, incurred, "Paid and incurred");
  assertSameShape(paid, openCounts, "Paid and open-count");
  const nOrigins = paid.origins.length;
  const nAges = paid.ages.length;
  const warnings: string[] = [];
  const periodYears = (paid.ages[0] ?? 12) / 12;

  // Average open case reserve per open claim, by cell.
  const averageCaseReserves: (number | null)[][] = [];
  for (let i = 0; i < nOrigins; i++) {
    const row: (number | null)[] = [];
    for (let j = 0; j < nAges; j++) {
      const inc = incurred.values[i]![j] ?? null;
      const pd = paid.values[i]![j] ?? null;
      const open = openCounts.values[i]![j] ?? null;
      const caseAmt = isNum(inc) && isNum(pd) ? inc - pd : null;
      row.push(safeRatio(caseAmt, open));
    }
    averageCaseReserves.push(row);
  }

  // Severity trend: user override, else fitted from ln(average case) regressed
  // on origin index within each column, combined as a point-weighted average.
  let severityTrend: number;
  let trendSource: "fitted" | "user";
  if (options.severityTrend !== undefined) {
    severityTrend = options.severityTrend;
    trendSource = "user";
  } else {
    let weighted = 0;
    let weight = 0;
    for (let j = 0; j < nAges; j++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < nOrigins; i++) {
        const v = averageCaseReserves[i]![j] ?? null;
        if (isNum(v) && v > 0) {
          xs.push(i);
          ys.push(Math.log(v));
        }
      }
      if (xs.length >= 3) {
        const fit = ols(xs, ys);
        if (fit) {
          const annualTrend = Math.exp(fit.slope / periodYears) - 1;
          weighted += annualTrend * fit.n;
          weight += fit.n;
        }
      }
    }
    if (weight > 0) {
      severityTrend = weighted / weight;
      trendSource = "fitted";
    } else {
      severityTrend = 0;
      trendSource = "fitted";
      warnings.push(
        "Could not fit a severity trend from the data (too few open-claim cells); used 0% -- supply a trend explicitly",
      );
    }
  }
  if (severityTrend <= -1) {
    throw new ReservingError("BAD_TREND", "Severity trend must be greater than -100%");
  }

  // Restate: de-trend each column's latest-diagonal average case backwards.
  const restated: (number | null)[][] = averageCaseReserves.map((r) => r.map(() => null));
  for (let j = 0; j < nAges; j++) {
    const diagRow = lastObservedRowInColumn(openCounts, j);
    if (diagRow < 0) continue;
    const diagAvg = averageCaseReserves[diagRow]![j] ?? null;
    for (let i = 0; i <= diagRow; i++) {
      if (!isNum(openCounts.values[i]![j] ?? null)) continue;
      if (!isNum(diagAvg)) {
        // No open claims on the diagonal for this maturity; keep the actual value.
        restated[i]![j] = averageCaseReserves[i]![j] ?? null;
        continue;
      }
      const yearsBack = (diagRow - i) * periodYears;
      restated[i]![j] = diagAvg / Math.pow(1 + severityTrend, yearsBack);
    }
  }

  // Adjusted incurred = paid + restated average case x open counts.
  const adjustedValues: (number | null)[][] = [];
  let fallbackCells = 0;
  for (let i = 0; i < nOrigins; i++) {
    const row: (number | null)[] = [];
    for (let j = 0; j < nAges; j++) {
      const pd = paid.values[i]![j] ?? null;
      const open = openCounts.values[i]![j] ?? null;
      if (!isNum(pd) || !isNum(open)) {
        row.push(null);
        continue;
      }
      if (open === 0) {
        row.push(pd);
        continue;
      }
      const avg = restated[i]![j] ?? null;
      if (!isNum(avg)) {
        row.push(incurred.values[i]![j] ?? null);
        fallbackCells++;
        continue;
      }
      row.push(pd + avg * open);
    }
    adjustedValues.push(row);
  }
  if (fallbackCells > 0) {
    warnings.push(
      `${fallbackCells} cell(s) kept their unadjusted incurred value because no diagonal average case reserve was available at that maturity`,
    );
  }

  return {
    averageCaseReserves,
    severityTrend,
    trendSource,
    restatedAverageCaseReserves: restated,
    adjustedIncurred: {
      kind: "incurred",
      origins: [...paid.origins],
      ages: [...paid.ages],
      values: adjustedValues,
    },
    warnings,
  };
}

export interface SettlementOptions {
  /** Selected ultimate claim counts per origin (same order as triangle origins). */
  ultimateCounts: number[];
  /** Interpolation between (closed count, paid) points. Friedland uses exponential. */
  interpolation?: "exponential" | "linear";
}

interface Point {
  x: number; // cumulative closed counts
  y: number; // cumulative paid
}

function interpolate(
  points: Point[],
  x: number,
  mode: "exponential" | "linear",
  warnings: string[],
  cellLabel: string,
): number | null {
  if (points.length === 0) return null;
  // Exact hit keeps the actual value.
  for (const p of points) {
    if (Math.abs(p.x - x) < 1e-9) return p.y;
  }
  let lower: Point | null = null;
  let upper: Point | null = null;
  for (const p of points) {
    if (p.x < x && (!lower || p.x > lower.x)) lower = p;
    if (p.x > x && (!upper || p.x < upper.x)) upper = p;
  }
  if (lower && upper) {
    return interpolateSegment(lower, upper, x, mode);
  }
  if (!lower && upper) {
    // Below every observed point: anchor at the origin (0 closed, 0 paid).
    return interpolateSegment({ x: 0, y: 0 }, upper, x, mode);
  }
  if (lower && !upper) {
    // Above every observed point: extrapolate from the last segment.
    const below = points.filter((p) => p.x < lower!.x);
    const prev = below.length > 0 ? below[below.length - 1]! : { x: 0, y: 0 };
    warnings.push(
      `Adjusted closed counts at ${cellLabel} exceed every observed count in that origin row; paid was extrapolated beyond the data`,
    );
    return interpolateSegment(prev, lower, x, mode);
  }
  return null;
}

function interpolateSegment(
  p1: Point,
  p2: Point,
  x: number,
  mode: "exponential" | "linear",
): number {
  if (p2.x === p1.x) return p1.y;
  if (mode === "exponential" && p1.y > 0 && p2.y > 0) {
    // y = a * e^(b x) through both points (log-linear in paid).
    const b = Math.log(p2.y / p1.y) / (p2.x - p1.x);
    const a = p1.y * Math.exp(-b * p1.x);
    return a * Math.exp(b * x);
  }
  // Linear (also the fallback when a zero paid value makes exponential undefined).
  return p1.y + ((p2.y - p1.y) * (x - p1.x)) / (p2.x - p1.x);
}

export function berquistSettlement(
  paid: Triangle,
  closedCounts: Triangle,
  options: SettlementOptions,
): BerquistSettlementResult {
  assertSameShape(paid, closedCounts, "Paid and closed-count");
  const { ultimateCounts } = options;
  const interpolation = options.interpolation ?? "exponential";
  const nOrigins = paid.origins.length;
  const nAges = paid.ages.length;
  if (ultimateCounts.length !== nOrigins) {
    throw new ReservingError(
      "SHAPE",
      `Expected ${nOrigins} ultimate claim counts (one per origin), got ${ultimateCounts.length}`,
    );
  }
  const warnings: string[] = [];

  // Disposal rates = closed counts / ultimate counts.
  const disposalRates: (number | null)[][] = [];
  for (let i = 0; i < nOrigins; i++) {
    const ult = ultimateCounts[i]!;
    const row: (number | null)[] = [];
    for (let j = 0; j < nAges; j++) {
      row.push(safeRatio(closedCounts.values[i]![j] ?? null, ult > 0 ? ult : null));
    }
    disposalRates.push(row);
  }

  // Current settlement pattern: disposal rates along the latest diagonal.
  const selectedDisposalRates: (number | null)[] = [];
  for (let j = 0; j < nAges; j++) {
    const diagRow = lastObservedRowInColumn(closedCounts, j);
    selectedDisposalRates.push(diagRow >= 0 ? (disposalRates[diagRow]![j] ?? null) : null);
  }

  // Restated closed counts at the current settlement pattern.
  const adjustedClosedCounts: (number | null)[][] = [];
  for (let i = 0; i < nOrigins; i++) {
    const ult = ultimateCounts[i]!;
    const row: (number | null)[] = [];
    for (let j = 0; j < nAges; j++) {
      const observed = isNum(closedCounts.values[i]![j] ?? null);
      const sel = selectedDisposalRates[j] ?? null;
      row.push(observed && isNum(sel) && ult > 0 ? sel * ult : null);
    }
    adjustedClosedCounts.push(row);
  }

  // Interpolate adjusted paid within each origin row on (closed, paid) points.
  const adjustedValues: (number | null)[][] = [];
  for (let i = 0; i < nOrigins; i++) {
    const points: Point[] = [];
    for (let j = 0; j < nAges; j++) {
      const c = closedCounts.values[i]![j] ?? null;
      const p = paid.values[i]![j] ?? null;
      if (isNum(c) && isNum(p)) points.push({ x: c, y: p });
    }
    points.sort((a, b) => a.x - b.x);
    // Collapse duplicate closed counts, keeping the latest evaluation's paid
    // (points sort stably by closed count, so for equal counts the later
    // development age comes last; taking its value also handles the rare
    // decreasing-paid case, e.g. recoveries).
    const dedup: Point[] = [];
    for (const p of points) {
      const last = dedup[dedup.length - 1];
      if (last && Math.abs(last.x - p.x) < 1e-9) last.y = p.y;
      else dedup.push({ ...p });
    }

    const row: (number | null)[] = [];
    for (let j = 0; j < nAges; j++) {
      const target = adjustedClosedCounts[i]![j] ?? null;
      const actualPaid = paid.values[i]![j] ?? null;
      if (!isNum(target) || !isNum(actualPaid)) {
        row.push(actualPaid);
        continue;
      }
      const label = `${paid.origins[i]} @ ${paid.ages[j]}mo`;
      const y = interpolate(dedup, target, interpolation, warnings, label);
      row.push(isNum(y) ? Math.max(0, y) : actualPaid);
    }
    adjustedValues.push(row);
  }

  return {
    disposalRates,
    selectedDisposalRates,
    ultimateCounts: [...ultimateCounts],
    adjustedClosedCounts,
    interpolation,
    adjustedPaid: {
      kind: "paid",
      origins: [...paid.origins],
      ages: [...paid.ages],
      values: adjustedValues,
    },
    warnings,
  };
}
