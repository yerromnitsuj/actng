import type { ClaimSnapshot, Triangle } from "@actuarial-ts/core";

/**
 * ASOP No. 23 (Data Quality)-oriented data review.
 *
 * The report lists every check PERFORMED, not just the ones that found
 * something — the actuary's disclosure needs "what was reviewed" as much as
 * "what was found". A check that could not be evaluated (no as-of date; a
 * triangle shape mismatch blocking cell comparisons) stays in the report
 * with an explicit "not evaluated" detail so the disclosure never overstates
 * the review.
 *
 * Severity philosophy:
 * - "fail"    = the data is wrong or internally inconsistent (negative paid,
 *               dates out of order, duplicate snapshots, paid > incurred).
 * - "warning" = legitimate but rare/reportable (negative case reserves,
 *               salvage-driven negative incremental paid, closed claims
 *               still carrying case).
 *
 * These utilities are designed to support the actuary's compliance with
 * ASOP No. 23; responsibility for compliance remains with the credentialed
 * actuary.
 */

export type DataCheckStatus = "pass" | "warning" | "fail" | "not-evaluated";

export interface DataCheck {
  id: string;
  description: string;
  status: DataCheckStatus;
  details: string[];
}

export interface DataReviewReport {
  checks: DataCheck[];
  summary: { pass: number; warning: number; fail: number; notEvaluated: number };
}

export interface ReviewClaimDataOptions {
  /** ISO date; when given, any claim date after it fails "future-dated". */
  asOfDate?: string;
}

/** At most this many offending items are listed per check, then "+N more". */
const MAX_DETAILS = 20;

function capDetails(items: string[]): string[] {
  if (items.length <= MAX_DETAILS) return items;
  return [...items.slice(0, MAX_DETAILS), `+${items.length - MAX_DETAILS} more`];
}

function makeCheck(
  id: string,
  description: string,
  statusWhenFound: "warning" | "fail",
  findings: string[],
): DataCheck {
  return {
    id,
    description,
    status: findings.length > 0 ? statusWhenFound : "pass",
    details: capDetails(findings),
  };
}

function notEvaluated(id: string, description: string, reason: string): DataCheck {
  // A check that could not run is REPORTED as such - counting it as "pass"
  // would overstate the review in the very disclosure this feeds.
  return { id, description, status: "not-evaluated", details: [`not evaluated: ${reason}`] };
}

function summarize(checks: DataCheck[]): DataReviewReport {
  const summary = { pass: 0, warning: 0, fail: 0, notEvaluated: 0 };
  for (const c of checks) {
    if (c.status === "not-evaluated") summary.notEvaluated++;
    else summary[c.status]++;
  }
  return { checks, summary };
}

const CLAIM_DESCRIPTIONS = {
  "non-finite-value": "Every money field is a finite number (no NaN or Infinity)",
  "negative-paid": "Cumulative paid amounts are non-negative",
  "negative-case": "Case reserves are non-negative (negative case is legitimate but rare)",
  "paid-decreasing":
    "Cumulative paid never decreases across a claim's snapshots ordered by evaluation date",
  "date-order": "accident_date <= report_date <= evaluation_date on every snapshot",
  "duplicate-snapshot": "No claim has two snapshots at the same evaluation date",
  "future-dated": "No claim date exceeds the as-of date",
  "closed-with-case": "Closed claims carry no outstanding case reserve",
} as const;

/** Reviews claim-level snapshots against the ASOP 23-oriented check suite. */
export function reviewClaimData(
  claims: ClaimSnapshot[],
  opts: ReviewClaimDataOptions = {},
): DataReviewReport {
  const negativePaid: string[] = [];
  const negativeCase: string[] = [];
  const dateOrder: string[] = [];
  const futureDated: string[] = [];
  const closedWithCase: string[] = [];

  claims.forEach((c, idx) => {
    const where = `claim ${c.claimId} row ${idx + 1} (eval ${c.evaluationDate})`;
    if (c.paidToDate < 0) {
      negativePaid.push(`${where}: paid_to_date ${c.paidToDate}`);
    }
    if (c.caseReserve < 0) {
      negativeCase.push(`${where}: case_reserve ${c.caseReserve}`);
    }
    if (c.reportDate < c.accidentDate) {
      dateOrder.push(
        `${where}: report_date ${c.reportDate} precedes accident_date ${c.accidentDate}`,
      );
    }
    if (c.evaluationDate < c.reportDate) {
      dateOrder.push(
        `${where}: evaluation_date ${c.evaluationDate} precedes report_date ${c.reportDate}`,
      );
    }
    if (opts.asOfDate !== undefined) {
      const asOf = opts.asOfDate;
      if (c.accidentDate > asOf) {
        futureDated.push(`${where}: accident_date ${c.accidentDate} exceeds as-of ${asOf}`);
      }
      if (c.reportDate > asOf) {
        futureDated.push(`${where}: report_date ${c.reportDate} exceeds as-of ${asOf}`);
      }
      if (c.evaluationDate > asOf) {
        futureDated.push(`${where}: evaluation_date ${c.evaluationDate} exceeds as-of ${asOf}`);
      }
    }
    if (c.status === "closed" && c.caseReserve > 0) {
      closedWithCase.push(`${where}: case_reserve ${c.caseReserve} on a closed claim`);
    }
  });

  // Per-claim timeline checks: duplicates and decreasing cumulative paid.
  const byClaim = new Map<string, ClaimSnapshot[]>();
  for (const c of claims) {
    const list = byClaim.get(c.claimId);
    if (list) list.push(c);
    else byClaim.set(c.claimId, [c]);
  }
  const paidDecreasing: string[] = [];
  const duplicates: string[] = [];
  for (const [claimId, snaps] of byClaim) {
    const sorted = [...snaps].sort((a, b) => a.evaluationDate.localeCompare(b.evaluationDate));
    const seenEvals = new Set<string>();
    for (const s of sorted) {
      if (seenEvals.has(s.evaluationDate)) {
        duplicates.push(`claim ${claimId}: duplicate snapshot at ${s.evaluationDate}`);
      }
      seenEvals.add(s.evaluationDate);
    }
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k - 1]!;
      const cur = sorted[k]!;
      // Same-date pairs are the duplicate check's finding, not this one's.
      if (cur.evaluationDate === prev.evaluationDate) continue;
      if (cur.paidToDate < prev.paidToDate) {
        paidDecreasing.push(
          `claim ${claimId}: paid_to_date ${prev.paidToDate} -> ${cur.paidToDate} between ${prev.evaluationDate} and ${cur.evaluationDate}`,
        );
      }
    }
  }

  const nonFinite: string[] = [];
  for (const c of claims) {
    const where = `claim ${c.claimId}`;
    if (!Number.isFinite(c.paidToDate)) nonFinite.push(`${where}: paid_to_date ${String(c.paidToDate)}`);
    if (!Number.isFinite(c.caseReserve)) nonFinite.push(`${where}: case_reserve ${String(c.caseReserve)}`);
  }

  const futureCheck =
    opts.asOfDate === undefined
      ? notEvaluated("future-dated", CLAIM_DESCRIPTIONS["future-dated"], "no asOfDate provided")
      : makeCheck("future-dated", CLAIM_DESCRIPTIONS["future-dated"], "fail", futureDated);

  return summarize([
    // First: if the numbers are not numbers, the other verdicts are noise.
    makeCheck("non-finite-value", CLAIM_DESCRIPTIONS["non-finite-value"], "fail", nonFinite),
    makeCheck("negative-paid", CLAIM_DESCRIPTIONS["negative-paid"], "fail", negativePaid),
    makeCheck("negative-case", CLAIM_DESCRIPTIONS["negative-case"], "warning", negativeCase),
    makeCheck("paid-decreasing", CLAIM_DESCRIPTIONS["paid-decreasing"], "fail", paidDecreasing),
    makeCheck("date-order", CLAIM_DESCRIPTIONS["date-order"], "fail", dateOrder),
    makeCheck("duplicate-snapshot", CLAIM_DESCRIPTIONS["duplicate-snapshot"], "fail", duplicates),
    futureCheck,
    makeCheck("closed-with-case", CLAIM_DESCRIPTIONS["closed-with-case"], "warning", closedWithCase),
  ]);
}

const TRIANGLE_DESCRIPTIONS = {
  "non-finite-value": "Every observed cell is a finite number (no NaN or Infinity)",
  "shape-mismatch": "Paid and incurred triangles share the same origins and ages",
  "paid-exceeds-incurred": "Paid never exceeds incurred in any cell (1e-9 relative tolerance)",
  "negative-incremental-paid":
    "Cumulative paid is non-decreasing along each origin row (salvage/subrogation can legitimately violate this)",
  "negative-incremental-incurred":
    "Cumulative incurred is non-decreasing along each origin row (case takedowns can legitimately violate this)",
  "interior-missing": "No row has a missing cell between observed cells",
} as const;

/**
 * Findings for NaN/Infinity in observed cells. This check exists because every
 * OTHER check is a relational comparison, and every relational comparison is
 * false for NaN — so without it, a triangle of NaN cells passes the entire
 * review and renders into disclosure Section 3 as clean data. It runs FIRST:
 * if the numbers are not numbers, the other verdicts are noise.
 */
function nonFiniteTriangleFindings(tri: Triangle): string[] {
  const out: string[] = [];
  for (let i = 0; i < tri.values.length; i++) {
    const row = tri.values[i]!;
    for (let j = 0; j < row.length; j++) {
      const v = row[j];
      if (v === null || v === undefined) continue;
      if (!Number.isFinite(v)) {
        out.push(`${tri.kind} ${tri.origins[i]} age ${tri.ages[j]}: ${String(v)}`);
      }
    }
  }
  return out;
}

/** Findings where a row's cumulative values decrease between observed cells. */
function negativeIncrementalFindings(tri: Triangle): string[] {
  const out: string[] = [];
  for (let i = 0; i < tri.values.length; i++) {
    const row = tri.values[i]!;
    let prev: number | null = null;
    let prevAge: number | null = null;
    for (let j = 0; j < row.length; j++) {
      const v = row[j];
      if (v === null || v === undefined) continue;
      const age = tri.ages[j]!;
      if (prev !== null && v < prev) {
        out.push(
          `${tri.kind} ${tri.origins[i]} age ${prevAge} -> ${age}: ${prev} -> ${v}`,
        );
      }
      prev = v;
      prevAge = age;
    }
  }
  return out;
}

/** Findings for null cells with observed cells both before and after in the row. */
function interiorMissingFindings(tri: Triangle): string[] {
  const out: string[] = [];
  for (let i = 0; i < tri.values.length; i++) {
    const row = tri.values[i]!;
    const observed = row.map((v) => v !== null);
    const first = observed.indexOf(true);
    const last = observed.lastIndexOf(true);
    if (first === -1) continue;
    for (let j = first + 1; j < last; j++) {
      if (!observed[j]) {
        out.push(`${tri.kind} ${tri.origins[i]} age ${tri.ages[j]}: interior cell missing`);
      }
    }
  }
  return out;
}

/** Reviews a paid/incurred triangle pair for cross-triangle consistency. */
export function reviewTriangles(paid: Triangle, incurred: Triangle): DataReviewReport {
  const shapeFindings: string[] = [];
  const sameOrigins =
    paid.origins.length === incurred.origins.length &&
    paid.origins.every((o, i) => o === incurred.origins[i]);
  const sameAges =
    paid.ages.length === incurred.ages.length &&
    paid.ages.every((a, j) => a === incurred.ages[j]);
  if (!sameOrigins) {
    shapeFindings.push(
      `origins differ: paid [${paid.origins.join(", ")}] vs incurred [${incurred.origins.join(", ")}]`,
    );
  }
  if (!sameAges) {
    shapeFindings.push(
      `ages differ: paid [${paid.ages.join(", ")}] vs incurred [${incurred.ages.join(", ")}]`,
    );
  }
  const nonFiniteCheck = makeCheck(
    "non-finite-value",
    TRIANGLE_DESCRIPTIONS["non-finite-value"],
    "fail",
    [...nonFiniteTriangleFindings(paid), ...nonFiniteTriangleFindings(incurred)],
  );
  const shapeCheck = makeCheck(
    "shape-mismatch",
    TRIANGLE_DESCRIPTIONS["shape-mismatch"],
    "fail",
    shapeFindings,
  );
  if (shapeFindings.length > 0) {
    // Cell-level comparisons are meaningless across mismatched grids; the
    // remaining checks stay listed (disclosure) but are not evaluated.
    const reason = "triangle shapes differ";
    return summarize([
      nonFiniteCheck,
      shapeCheck,
      notEvaluated("paid-exceeds-incurred", TRIANGLE_DESCRIPTIONS["paid-exceeds-incurred"], reason),
      notEvaluated(
        "negative-incremental-paid",
        TRIANGLE_DESCRIPTIONS["negative-incremental-paid"],
        reason,
      ),
      notEvaluated(
        "negative-incremental-incurred",
        TRIANGLE_DESCRIPTIONS["negative-incremental-incurred"],
        reason,
      ),
      notEvaluated("interior-missing", TRIANGLE_DESCRIPTIONS["interior-missing"], reason),
    ]);
  }

  const paidExceeds: string[] = [];
  for (let i = 0; i < paid.values.length; i++) {
    const paidRow = paid.values[i]!;
    const incRow = incurred.values[i]!;
    for (let j = 0; j < paidRow.length; j++) {
      const p = paidRow[j];
      const inc = incRow[j];
      if (p === null || p === undefined || inc === null || inc === undefined) continue;
      const tolerance = 1e-9 * Math.max(1, Math.abs(p), Math.abs(inc));
      if (p - inc > tolerance) {
        paidExceeds.push(`${paid.origins[i]} age ${paid.ages[j]}: paid ${p} > incurred ${inc}`);
      }
    }
  }

  return summarize([
    nonFiniteCheck,
    shapeCheck,
    makeCheck(
      "paid-exceeds-incurred",
      TRIANGLE_DESCRIPTIONS["paid-exceeds-incurred"],
      "fail",
      paidExceeds,
    ),
    makeCheck(
      "negative-incremental-paid",
      TRIANGLE_DESCRIPTIONS["negative-incremental-paid"],
      "warning",
      negativeIncrementalFindings(paid),
    ),
    makeCheck(
      "negative-incremental-incurred",
      TRIANGLE_DESCRIPTIONS["negative-incremental-incurred"],
      "warning",
      negativeIncrementalFindings(incurred),
    ),
    makeCheck(
      "interior-missing",
      TRIANGLE_DESCRIPTIONS["interior-missing"],
      "warning",
      [...interiorMissingFindings(paid), ...interiorMissingFindings(incurred)],
    ),
  ]);
}
