import type { Triangle } from "./types.js";
import { ReservingError } from "./types.js";
import { cumulativeToIncremental } from "./triangleAlgebra.js";
import {
  assertSameShape,
  isNum,
  lastJointObservedIndex,
  lastObservedIndex,
  safeRatio,
} from "./util.js";

/**
 * Fisher-Lange disposal-rate (average-cost-per-claim-settled) method: the
 * reserve is future settlements x trended severity, cell by cell.
 *
 * Ground truth:
 * - Disposal rates d[i][j] = incremental CLOSED counts / SUPPLIED ultimate
 *   counts (the ultimates are the caller's independent estimate - e.g. a
 *   count chain ladder - never derived here). The rate used per age is the
 *   caller's `disposalSelections[j]` or, by default, the latest observed
 *   diagonal rate for that age.
 * - Future closed counts for origin i at a future age j = ultimateCounts[i]
 *   x selected d[j].
 * - Severities by settlement age: incremental paid / incremental closed per
 *   cell. The selected severity for age j is the closed-count-weighted
 *   average of the observed cell severities, each trended FROM its cell's
 *   calendar period TO the latest observed diagonal (the internal
 *   reference).
 * - Reserve = sum over future cells of counts x severity trended to that
 *   cell's calendar period.
 *
 * Severity trend convention (compounds by CALENDAR distance): a cell's
 * calendar position is originIndex x ageStep + age (months), where the
 * origin cadence is inferred from the (required equal) development-age
 * spacing. A severity moved y calendar years is multiplied by
 * (1 + severityTrend)^y, fractional years allowed (quarterly triangles
 * compound by quarter-year fractions). Because every observed severity is
 * trended to one reference and then forward to each future cell, the
 * projection is invariant to the reference choice; `targetYear` only shifts
 * the calendar year the DISPLAYED selectedSeverities are stated at.
 *
 * Projection zeros are loud, never silent: an age with no selectable
 * disposal rate projects zero closures with a warning, and a needed age
 * with no observable severity projects zero payment with a warning (the
 * "sparse cell" warnings).
 */

export interface FisherLangeOptions {
  /**
   * Selected disposal rate per development age (length = ages.length);
   * null falls back to the latest observed diagonal rate for that age.
   */
  disposalSelections?: (number | null)[];
  /** Annual severity trend (e.g. 0.05 = +5%/calendar year). */
  severityTrend: number;
  /**
   * Calendar year the displayed selectedSeverities are stated at (default:
   * the latest diagonal's year). Display only - the reserve is invariant.
   * Requires an annual triangle (12-month spacing, first age 12) with
   * numeric origin labels; otherwise ignored with a warning.
   */
  targetYear?: number;
}

export interface FisherLangeRow {
  origin: string;
  /** Age (months) of the latest cell observed in BOTH triangles. */
  latestAge: number;
  paidToDate: number;
  closedToDate: number;
  ultimateCounts: number;
  /** Future closed counts per remaining age column (after latestAge). */
  futureClosedCounts: number[];
  /**
   * Trended severity applied per remaining age column; null where no
   * severity was observable (that cell projected zero payment, warned).
   */
  futureSeverities: (number | null)[];
  unpaid: number;
  ultimate: number;
}

export interface FisherLangeResult {
  method: "fisherLange";
  /** Historical incremental severities (paid / closed) per cell. */
  severities: (number | null)[][];
  /** Historical disposal rates (incremental closed / ultimate counts). */
  disposalRates: (number | null)[][];
  /** Disposal rate used per age (caller's selection or diagonal default). */
  selectedDisposalRates: (number | null)[];
  /** Selected severity per age, stated at referenceYear (display only). */
  selectedSeverities: (number | null)[];
  /** Calendar year selectedSeverities are stated at; null when origin labels don't parse. */
  referenceYear: number | null;
  ultimateCounts: number[];
  rows: FisherLangeRow[];
  totals: { paidToDate: number; unpaid: number; ultimate: number };
  warnings: string[];
}

export function runFisherLange(
  paid: Triangle,
  closedCounts: Triangle,
  ultimateCounts: number[],
  options: FisherLangeOptions,
): FisherLangeResult {
  assertSameShape(
    paid,
    closedCounts,
    "The paid and closed-count triangles must share identical origins and development ages",
  );
  const nOrigins = paid.origins.length;
  const nAges = paid.ages.length;
  if (nAges < 2) {
    throw new ReservingError("TOO_SMALL", "Fisher-Lange requires at least two development ages");
  }
  const step = paid.ages[1]! - paid.ages[0]!;
  for (let j = 1; j < nAges; j++) {
    if (paid.ages[j]! - paid.ages[j - 1]! !== step) {
      throw new ReservingError(
        "SHAPE",
        "Fisher-Lange infers calendar distance from the age step, which requires equally spaced development ages",
      );
    }
  }
  if (ultimateCounts.length !== nOrigins) {
    throw new ReservingError(
      "SHAPE",
      `Expected ${nOrigins} ultimate claim counts (one per origin), got ${ultimateCounts.length}`,
    );
  }
  ultimateCounts.forEach((u, i) => {
    if (!isNum(u) || u < 0) {
      throw new ReservingError(
        "BAD_COUNTS",
        `Ultimate counts must be finite and non-negative; origin ${paid.origins[i]} has ${u}`,
      );
    }
  });
  if (!isNum(options.severityTrend) || options.severityTrend <= -1) {
    throw new ReservingError("BAD_TREND", "Severity trend must be greater than -100%");
  }
  if (options.disposalSelections !== undefined && options.disposalSelections.length !== nAges) {
    throw new ReservingError(
      "SELECTION_SHAPE",
      `Expected ${nAges} disposal-rate selections (one per age), got ${options.disposalSelections.length}`,
    );
  }
  if (options.targetYear !== undefined && !Number.isInteger(options.targetYear)) {
    throw new ReservingError(
      "BAD_DATE",
      `targetYear must be an integer calendar year, got ${options.targetYear}`,
    );
  }

  const warnings: string[] = [];
  const growth = 1 + options.severityTrend;
  const incPaid = cumulativeToIncremental(paid).values;
  const incClosed = cumulativeToIncremental(closedCounts).values;
  const calMonths = (i: number, j: number): number => i * step + paid.ages[j]!;

  // Calendar guard: calMonths places origins by array index, which assumes
  // consecutive origin periods. For annual triangles with numeric year
  // labels the assumption is checkable for free - a gap (e.g. 2020, 2023,
  // 2024) silently compresses severity-trend distances, so warn loudly.
  // Quarterly/non-numeric labels stay unchecked (integer label spacing can
  // never equal a quarterly step; the cadence inference is documented above).
  if (step === 12 && paid.origins.every((o) => /^\d+$/.test(o))) {
    for (let i = 1; i < nOrigins; i++) {
      const gap = Number(paid.origins[i]) - Number(paid.origins[i - 1]);
      if (gap !== 1) {
        warnings.push(
          `Origins ${paid.origins[i - 1]} and ${paid.origins[i]} are ${gap} years apart but are trended as consecutive; with a nonzero severity trend the reserve is misstated - insert explicit null rows for the missing years`,
        );
      }
    }
  }

  // Historical severity and disposal-rate triangles (null-safe by safeRatio).
  const severities: (number | null)[][] = [];
  const disposalRates: (number | null)[][] = [];
  for (let i = 0; i < nOrigins; i++) {
    const ult = ultimateCounts[i]!;
    severities.push(
      paid.ages.map((_, j) => safeRatio(incPaid[i]![j] ?? null, incClosed[i]![j] ?? null)),
    );
    disposalRates.push(
      paid.ages.map((_, j) => safeRatio(incClosed[i]![j] ?? null, ult > 0 ? ult : null)),
    );
  }

  // Reference: the latest observed calendar position across both incremental
  // triangles. All severity statements below are internally at REF.
  let refMonths = -1;
  let refI = -1;
  let refJ = -1;
  for (let i = 0; i < nOrigins; i++) {
    for (let j = 0; j < nAges; j++) {
      if (!isNum(incPaid[i]![j] ?? null) && !isNum(incClosed[i]![j] ?? null)) continue;
      const cal = calMonths(i, j);
      if (cal > refMonths) {
        refMonths = cal;
        refI = i;
        refJ = j;
      }
    }
  }
  if (refMonths < 0) {
    throw new ReservingError("NO_DATA", "No observed cells in the paid or closed-count triangles");
  }

  // Selected disposal rate per age: caller's, else latest diagonal.
  const diagonalDisposal = (j: number): number | null => {
    for (let i = nOrigins - 1; i >= 0; i--) {
      const d = disposalRates[i]![j] ?? null;
      if (isNum(d)) return d;
    }
    return null;
  };
  const selectedDisposalRates: (number | null)[] = paid.ages.map((age, j) => {
    const caller = options.disposalSelections?.[j] ?? null;
    if (isNum(caller)) {
      if (caller >= 0) return caller;
      warnings.push(
        `Negative disposal-rate selection for age ${age} months; ignored in favor of the latest diagonal rate`,
      );
    }
    return diagonalDisposal(j);
  });
  const disposalSum = selectedDisposalRates.reduce<number>((a, d) => a + (isNum(d) ? d : 0), 0);
  if (Math.abs(disposalSum - 1) > 0.01) {
    warnings.push(
      `Selected disposal rates sum to ${disposalSum.toFixed(4)} across all ages; ` +
        (disposalSum < 1
          ? "claims closing beyond the last development age are NOT projected"
          : "more closures than ultimate counts are projected - review the pattern"),
    );
  }

  // Selected severity per age at REF: closed-count-weighted average of the
  // observed cell severities, each trended to REF.
  const selectedSevAtRef: (number | null)[] = paid.ages.map((_, j) => {
    let trendedPaid = 0;
    let closed = 0;
    for (let i = 0; i < nOrigins; i++) {
      if (!isNum(severities[i]![j] ?? null)) continue;
      trendedPaid += incPaid[i]![j]! * growth ** ((refMonths - calMonths(i, j)) / 12);
      closed += incClosed[i]![j]!;
    }
    return safeRatio(trendedPaid, closed);
  });

  // Projection.
  const warnedNoDisposal = new Set<number>();
  const warnedNoSeverity = new Set<number>();
  const rows: FisherLangeRow[] = [];
  for (let i = 0; i < nOrigins; i++) {
    const paidRow = paid.values[i]!;
    const closedRow = closedCounts.values[i]!;
    const lastPaid = lastObservedIndex(paidRow);
    const lastClosed = lastObservedIndex(closedRow);
    const k = lastJointObservedIndex(paidRow, closedRow);
    if (k < 0) {
      warnings.push(
        `Origin ${paid.origins[i]} has no age with both paid and closed counts observed; excluded from results`,
      );
      continue;
    }
    if (lastPaid !== lastClosed) {
      warnings.push(
        `Origin ${paid.origins[i]}: paid and closed-count diagonals end at different ages (${paid.ages[lastPaid]} vs ${paid.ages[lastClosed]}); projected from the latest jointly observed age ${paid.ages[k]}`,
      );
    }

    const futureClosedCounts: number[] = [];
    const futureSeverities: (number | null)[] = [];
    let unpaid = 0;
    for (let j = k + 1; j < nAges; j++) {
      const d = selectedDisposalRates[j];
      if (!isNum(d)) {
        if (!warnedNoDisposal.has(j)) {
          warnedNoDisposal.add(j);
          warnings.push(
            `No disposal rate is selectable for age ${paid.ages[j]} months (sparse column); future closures there are projected as zero`,
          );
        }
        futureClosedCounts.push(0);
        futureSeverities.push(null);
        continue;
      }
      const counts = ultimateCounts[i]! * d;
      futureClosedCounts.push(counts);
      const sevRef = selectedSevAtRef[j];
      if (!isNum(sevRef)) {
        if (counts > 0 && !warnedNoSeverity.has(j)) {
          warnedNoSeverity.add(j);
          warnings.push(
            `No severity is observable for age ${paid.ages[j]} months (sparse column); payments there are projected as zero`,
          );
        }
        futureSeverities.push(null);
        continue;
      }
      const sev = sevRef * growth ** ((calMonths(i, j) - refMonths) / 12);
      futureSeverities.push(sev);
      unpaid += counts * sev;
    }

    const paidToDate = paidRow[k]!;
    rows.push({
      origin: paid.origins[i]!,
      latestAge: paid.ages[k]!,
      paidToDate,
      closedToDate: closedRow[k]!,
      ultimateCounts: ultimateCounts[i]!,
      futureClosedCounts,
      futureSeverities,
      unpaid,
      ultimate: paidToDate + unpaid,
    });
  }
  if (rows.length === 0) {
    throw new ReservingError(
      "NO_DATA",
      "No origin period has both paid and closed counts observed at any age",
    );
  }

  // Display statement year for the selected severities. Derivable only for
  // annual triangles whose first age is 12 months and whose origin labels
  // are numeric years; the projection above never depends on it.
  let referenceYear: number | null = null;
  if (step === 12 && paid.ages[0] === 12 && /^\d+$/.test(paid.origins[refI] ?? "")) {
    referenceYear = Number(paid.origins[refI]) + refJ;
  }
  let displayShiftYears = 0;
  if (options.targetYear !== undefined) {
    if (referenceYear === null) {
      warnings.push(
        "targetYear ignored: stating severities at a calendar year needs an annual triangle (12-month spacing, first age 12) with numeric origin labels",
      );
    } else {
      displayShiftYears = options.targetYear - referenceYear;
      referenceYear = options.targetYear;
    }
  }
  const selectedSeverities = selectedSevAtRef.map((s) =>
    isNum(s) ? s * growth ** displayShiftYears : null,
  );

  const totals = rows.reduce(
    (acc, r) => ({
      paidToDate: acc.paidToDate + r.paidToDate,
      unpaid: acc.unpaid + r.unpaid,
      ultimate: acc.ultimate + r.ultimate,
    }),
    { paidToDate: 0, unpaid: 0, ultimate: 0 },
  );

  return {
    method: "fisherLange",
    severities,
    disposalRates,
    selectedDisposalRates,
    selectedSeverities,
    referenceYear,
    ultimateCounts: [...ultimateCounts],
    rows,
    totals,
    warnings,
  };
}
