import type { Triangle } from "./types.js";
import { ReservingError } from "./types.js";
import { isNum, lastJointObservedIndex, lastObservedIndex, safeRatio } from "./util.js";

/**
 * Case-outstanding development technique (Friedland, "Estimating Unpaid
 * Claims Using Basic Techniques", ch. 12): for books where the case reserves
 * are the only reliable triangle (classic self-insured situation), unpaid
 * claims are projected from the run-off of the case outstanding itself.
 *
 * Ground truth:
 * - Two historical ratio triangles drive the review:
 *   caseRatios[i][j]      = case[i][j+1] / case[i][j]   (case run-off), and
 *   paidOnPriorCase[i][j] = (paid[i][j+1] - paid[i][j]) / case[i][j]
 *   (incremental paid in the interval as a ratio of the case reserve held at
 *   its start - "paid on prior case").
 * - The CALLER selects both patterns (this module never picks factors). The
 *   projection walks each origin's latest case forward: payments in the next
 *   interval = case x paidOnCaseSelection, next case = case x caseSelection.
 * - Case remaining at the last development age pays out at `tailPaidOnCase`
 *   times its face value (default 1: paid in full, the conventional
 *   assumption; a warning notes when the default was relied on).
 * - unpaid = the sum of the projected future payments including the tail
 *   payout - the reserve IS the projected paid stream, an identity the
 *   self-consistency test enforces.
 *
 * Selection coercions (loud, never silent):
 * - missing case selection -> 1.000 (case carried forward), warned;
 * - negative case selection -> 0.000 (case cannot go negative), warned;
 * - missing paid-on-case selection -> 0.000 (no payment projected), warned;
 * - negative paid-on-case selection -> kept (projects net recoveries), warned;
 * - ALL selections missing across both arrays -> NO_SELECTIONS.
 */

export interface CaseOutstandingOptions {
  /** Selected case run-off ratios (next case / current case), one per interval. */
  caseSelections: (number | null)[];
  /** Selected incremental-paid-to-prior-case ratios, one per interval. */
  paidOnCaseSelections: (number | null)[];
  /**
   * Payments after the last age as a ratio of the case remaining there.
   * Default 1 (remaining case pays out in full).
   */
  tailPaidOnCase?: number;
}

export interface CaseOutstandingRow {
  origin: string;
  /** Age (months) of the latest cell observed in BOTH triangles. */
  latestAge: number;
  paidToDate: number;
  /** Case outstanding at the latest age (the projection's seed). */
  caseOutstanding: number;
  /**
   * Projected future incremental paid: futurePaid[m] pays in the interval
   * ending at the (m+1)-th age after latestAge; the LAST element is the tail
   * payout of the case remaining at the final development age.
   */
  futurePaid: number[];
  /** Projected case outstanding at each later age (parallel run-off path). */
  projectedCase: number[];
  /** Sum of futurePaid (the reserve). */
  unpaid: number;
  /** paidToDate + unpaid. */
  ultimate: number;
}

export interface CaseOutstandingResult {
  method: "caseOutstanding";
  /** Historical case run-off ratios, [origin][interval]; null where not computable. */
  caseRatios: (number | null)[][];
  /** Historical incremental paid / prior case, [origin][interval]. */
  paidOnPriorCase: (number | null)[][];
  /** The tail payout ratio the projection used. */
  tailPaidOnCase: number;
  rows: CaseOutstandingRow[];
  totals: { paidToDate: number; caseOutstanding: number; unpaid: number; ultimate: number };
  warnings: string[];
}

function assertSameShape(a: Triangle, b: Triangle): void {
  const sameOrigins =
    a.origins.length === b.origins.length && a.origins.every((o, i) => o === b.origins[i]);
  const sameAges = a.ages.length === b.ages.length && a.ages.every((v, j) => v === b.ages[j]);
  if (!sameOrigins || !sameAges) {
    throw new ReservingError(
      "SHAPE",
      "The paid and case-outstanding triangles must share identical origins and development ages",
    );
  }
}

export function runCaseOutstanding(
  paid: Triangle,
  caseOutstanding: Triangle,
  options: CaseOutstandingOptions,
): CaseOutstandingResult {
  assertSameShape(paid, caseOutstanding);
  const nOrigins = paid.origins.length;
  const nAges = paid.ages.length;
  const nIntervals = nAges - 1;
  for (const [name, selections] of [
    ["caseSelections", options.caseSelections],
    ["paidOnCaseSelections", options.paidOnCaseSelections],
  ] as const) {
    if (selections.length !== nIntervals) {
      throw new ReservingError(
        "SELECTION_SHAPE",
        `Expected ${nIntervals} ${name} (one per development interval), got ${selections.length}`,
      );
    }
  }
  const tailPaidOnCase = options.tailPaidOnCase ?? 1;
  if (!isNum(tailPaidOnCase) || tailPaidOnCase < 0) {
    throw new ReservingError(
      "BAD_TAIL",
      `tailPaidOnCase must be a finite, non-negative ratio, got ${options.tailPaidOnCase}`,
    );
  }
  const anySelected =
    options.caseSelections.some((s) => isNum(s)) ||
    options.paidOnCaseSelections.some((s) => isNum(s));
  if (nIntervals > 0 && !anySelected) {
    throw new ReservingError(
      "NO_SELECTIONS",
      "No case run-off or paid-on-case ratios are selected for any interval; select patterns before running the analysis",
    );
  }

  const warnings: string[] = [];

  // Effective selections with the documented coercions, warned per interval.
  const effectiveCase: number[] = options.caseSelections.map((s, j) => {
    const label = `${paid.ages[j]}-${paid.ages[j + 1]} months`;
    if (!isNum(s)) {
      warnings.push(`Missing case run-off selection for ${label}; treated as 1.000 (case carried forward)`);
      return 1;
    }
    if (s < 0) {
      warnings.push(
        `Negative case run-off selection for ${label} would project negative case; treated as 0.000`,
      );
      return 0;
    }
    return s;
  });
  const effectivePaid: number[] = options.paidOnCaseSelections.map((s, j) => {
    const label = `${paid.ages[j]}-${paid.ages[j + 1]} months`;
    if (!isNum(s)) {
      warnings.push(`Missing paid-on-case selection for ${label}; treated as 0.000 (no payment projected)`);
      return 0;
    }
    if (s < 0) {
      warnings.push(`Negative paid-on-case selection for ${label} projects net recoveries; kept as given`);
    }
    return s;
  });

  // Historical ratio triangles (null-safe: prior case must be positive, and
  // an incremental paid needs both cumulative cells observed).
  const caseRatios: (number | null)[][] = [];
  const paidOnPriorCase: (number | null)[][] = [];
  for (let i = 0; i < nOrigins; i++) {
    const cRow: (number | null)[] = [];
    const pRow: (number | null)[] = [];
    for (let j = 0; j < nIntervals; j++) {
      const casePrior = caseOutstanding.values[i]![j] ?? null;
      const caseNext = caseOutstanding.values[i]![j + 1] ?? null;
      const paidPrior = paid.values[i]![j] ?? null;
      const paidNext = paid.values[i]![j + 1] ?? null;
      cRow.push(safeRatio(caseNext, casePrior));
      pRow.push(
        isNum(paidPrior) && isNum(paidNext)
          ? safeRatio(paidNext - paidPrior, casePrior)
          : null,
      );
    }
    caseRatios.push(cRow);
    paidOnPriorCase.push(pRow);
  }

  const rows: CaseOutstandingRow[] = [];
  let tailDefaultRelevant = false;
  for (let i = 0; i < nOrigins; i++) {
    const paidRow = paid.values[i]!;
    const caseRow = caseOutstanding.values[i]!;
    const lastPaid = lastObservedIndex(paidRow);
    const lastCase = lastObservedIndex(caseRow);
    const k = lastJointObservedIndex(paidRow, caseRow);
    if (k < 0) {
      warnings.push(
        `Origin ${paid.origins[i]} has no age with both paid and case outstanding observed; excluded from results`,
      );
      continue;
    }
    if (lastPaid !== lastCase) {
      warnings.push(
        `Origin ${paid.origins[i]}: paid and case diagonals end at different ages (${paid.ages[lastPaid]} vs ${paid.ages[lastCase]}); projected from the latest jointly observed age ${paid.ages[k]}`,
      );
    }

    const paidToDate = paidRow[k]!;
    const seedCase = caseRow[k]!;
    if (seedCase < 0) {
      warnings.push(
        `Origin ${paid.origins[i]}: case outstanding at the seed age is negative (${seedCase}); the projection carries the sign through, so review whether net recoveries are genuinely expected`,
      );
    }
    const futurePaid: number[] = [];
    const projectedCase: number[] = [];
    let current = seedCase;
    let warnedNegativeProjection = seedCase < 0;
    for (let j = k; j < nIntervals; j++) {
      futurePaid.push(current * effectivePaid[j]!);
      current *= effectiveCase[j]!;
      projectedCase.push(current);
      if (current < 0 && !warnedNegativeProjection) {
        warnedNegativeProjection = true;
        warnings.push(
          `Origin ${paid.origins[i]}: projected case outstanding turns negative (${current}) at age ${paid.ages[j + 1] ?? "tail"}; downstream reserves inherit the sign`,
        );
      }
    }
    if (current !== 0 && options.tailPaidOnCase === undefined) tailDefaultRelevant = true;
    futurePaid.push(current * tailPaidOnCase);

    const unpaid = futurePaid.reduce((a, v) => a + v, 0);
    rows.push({
      origin: paid.origins[i]!,
      latestAge: paid.ages[k]!,
      paidToDate,
      caseOutstanding: seedCase,
      futurePaid,
      projectedCase,
      unpaid,
      ultimate: paidToDate + unpaid,
    });
  }
  if (rows.length === 0) {
    throw new ReservingError(
      "NO_DATA",
      "No origin period has both paid and case outstanding observed at any age",
    );
  }
  if (tailDefaultRelevant) {
    warnings.push(
      `Case outstanding remaining at ${paid.ages[nAges - 1]} months is assumed paid in full (tailPaidOnCase defaulted to 1); supply tailPaidOnCase to select otherwise`,
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({
      paidToDate: acc.paidToDate + r.paidToDate,
      caseOutstanding: acc.caseOutstanding + r.caseOutstanding,
      unpaid: acc.unpaid + r.unpaid,
      ultimate: acc.ultimate + r.ultimate,
    }),
    { paidToDate: 0, caseOutstanding: 0, unpaid: 0, ultimate: 0 },
  );

  return {
    method: "caseOutstanding",
    caseRatios,
    paidOnPriorCase,
    tailPaidOnCase,
    rows,
    totals,
    warnings,
  };
}
