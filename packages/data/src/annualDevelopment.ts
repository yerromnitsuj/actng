import type { ClaimSnapshot } from "@actuarial-ts/core";
import { ReservingError } from "@actuarial-ts/core";
import { z } from "zod";

/**
 * A claim valuation known only to annual precision.
 *
 * `incurredToDate` is deliberately named for the interpretation already made
 * by the caller. Source-specific adapters must document how their fields were
 * mapped to paid and incurred before calling this function.
 */
export const annualClaimDevelopmentRowSchema = z
  .object({
    claimId: z.string().trim().min(1),
    originYear: z.number().int().min(1).max(9999),
    reportYear: z.number().int().min(1).max(9999).optional(),
    evaluationYear: z.number().int().min(1).max(9999),
    paidToDate: z.number().finite(),
    incurredToDate: z.number().finite(),
    status: z.enum(["open", "closed"]),
  })
  .strict()
  .superRefine((row, ctx) => {
    if (row.evaluationYear < row.originYear) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluationYear"],
        message: "evaluationYear must not precede originYear",
      });
    }
    if (row.reportYear !== undefined && row.reportYear < row.originYear) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reportYear"],
        message: "reportYear must not precede originYear",
      });
    }
    if (row.reportYear !== undefined && row.evaluationYear < row.reportYear) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluationYear"],
        message: "evaluationYear must not precede reportYear",
      });
    }
  });

export type AnnualClaimDevelopmentRow = z.infer<typeof annualClaimDevelopmentRowSchema>;

export type AnnualDuplicatePolicy = "reject" | "combine";

export interface AnnualDevelopmentOptions {
  /**
   * Same-claim, same-year records are ambiguous. The safe default rejects
   * them. `combine` treats them as components of one dollar stream: paid and
   * incurred are summed and the combined record is open when any component is
   * open. The returned finding makes that judgment visible.
   */
  duplicatePolicy?: AnnualDuplicatePolicy;
}

const annualDevelopmentOptionsSchema = z
  .object({ duplicatePolicy: z.enum(["reject", "combine"]).default("reject") })
  .strict();

export type AnnualDevelopmentFindingCode =
  | "annual-dates-derived"
  | "report-year-inferred"
  | "duplicate-snapshots-combined";

export interface AnnualDevelopmentFinding {
  code: AnnualDevelopmentFindingCode;
  severity: "disclosure" | "warning";
  message: string;
  affectedClaims?: number;
  affectedGroups?: number;
  affectedRows?: number;
}

export interface AnnualDevelopmentConventions {
  sourceDatePrecision: "year";
  derivedDateConvention: "calendar-year-end";
  missingReportYearConvention: "earliest-evaluation-year";
  duplicatePolicy: AnnualDuplicatePolicy;
}

export interface AnnualDevelopmentConversion {
  claims: ClaimSnapshot[];
  findings: AnnualDevelopmentFinding[];
  conventions: AnnualDevelopmentConventions;
  sourceRowCount: number;
}

interface ClaimGroup {
  originYear: number;
  reportYears: Set<number>;
  rows: AnnualClaimDevelopmentRow[];
}

function yearEnd(year: number): string {
  return `${String(year).padStart(4, "0")}-12-31`;
}

function issueMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

/**
 * Converts year-precision claim valuations into the exact-date
 * `ClaimSnapshot` contract without pretending the source supplied exact
 * dates. Every derived date uses calendar year-end, and the convention is
 * returned alongside the claims for disclosure.
 *
 * Missing report years are inferred as the earliest evaluation year for the
 * claim. Duplicate claim/evaluation-year rows are rejected unless the caller
 * explicitly selects the auditable `combine` policy.
 */
export function annualDevelopmentToClaimSnapshots(
  input: readonly AnnualClaimDevelopmentRow[],
  options: AnnualDevelopmentOptions = {},
): AnnualDevelopmentConversion {
  const parsedOptions = annualDevelopmentOptionsSchema.safeParse(options);
  if (!parsedOptions.success) {
    throw new ReservingError(
      "UNSUPPORTED_VALUE",
      `Invalid annual development options: ${issueMessage(parsedOptions.error)}`,
    );
  }
  const { duplicatePolicy } = parsedOptions.data;

  const rows: AnnualClaimDevelopmentRow[] = input.map((candidate, inputIndex) => {
    const parsed = annualClaimDevelopmentRowSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ReservingError(
        "SHAPE",
        `Annual claim development row ${inputIndex + 1}: ${issueMessage(parsed.error)}`,
      );
    }
    return parsed.data;
  });

  const byClaim = new Map<string, ClaimGroup>();
  for (const row of rows) {
    const existing = byClaim.get(row.claimId);
    if (existing === undefined) {
      byClaim.set(row.claimId, {
        originYear: row.originYear,
        reportYears: new Set(row.reportYear === undefined ? [] : [row.reportYear]),
        rows: [row],
      });
      continue;
    }
    if (existing.originYear !== row.originYear) {
      throw new ReservingError(
        "SHAPE",
        `Claim ${row.claimId} has conflicting origin years ${existing.originYear} and ${row.originYear}`,
      );
    }
    if (row.reportYear !== undefined) existing.reportYears.add(row.reportYear);
    existing.rows.push(row);
  }

  const findings: AnnualDevelopmentFinding[] = [
    {
      code: "annual-dates-derived",
      severity: "disclosure",
      affectedRows: rows.length,
      message:
        "The source supplies calendar years, not exact dates; accident, report and evaluation dates were derived at calendar year-end.",
    },
  ];
  const claims: ClaimSnapshot[] = [];
  let inferredReportYears = 0;
  let duplicateGroups = 0;
  let duplicateRows = 0;

  for (const [claimId, group] of byClaim) {
    if (group.reportYears.size > 1) {
      throw new ReservingError(
        "SHAPE",
        `Claim ${claimId} has conflicting report years ${[...group.reportYears].sort((a, b) => a - b).join(", ")}`,
      );
    }
    const firstEvaluationYear = group.rows.reduce(
      (earliest, row) => Math.min(earliest, row.evaluationYear),
      group.rows[0]!.evaluationYear,
    );
    const suppliedReportYear = group.reportYears.values().next().value as number | undefined;
    const reportYear = suppliedReportYear ?? firstEvaluationYear;
    if (suppliedReportYear === undefined) inferredReportYears += 1;
    if (reportYear > firstEvaluationYear) {
      throw new ReservingError(
        "SHAPE",
        `Claim ${claimId} has report year ${reportYear} after its first evaluation year ${firstEvaluationYear}`,
      );
    }

    const byEvaluationYear = new Map<number, AnnualClaimDevelopmentRow[]>();
    for (const row of group.rows) {
      const sameYear = byEvaluationYear.get(row.evaluationYear);
      if (sameYear === undefined) byEvaluationYear.set(row.evaluationYear, [row]);
      else sameYear.push(row);
    }

    for (const evaluationYear of [...byEvaluationYear.keys()].sort((a, b) => a - b)) {
      const sameYear = byEvaluationYear.get(evaluationYear)!;
      if (sameYear.length > 1) {
        duplicateGroups += 1;
        duplicateRows += sameYear.length;
        if (duplicatePolicy === "reject") {
          throw new ReservingError(
            "SHAPE",
            `Claim ${claimId} has ${sameYear.length} snapshots in evaluation year ${evaluationYear}; choose duplicatePolicy "combine" only after reviewing the source ambiguity`,
          );
        }
      }

      const paidToDate = sameYear.reduce((sum, row) => sum + row.paidToDate, 0);
      const incurredToDate = sameYear.reduce((sum, row) => sum + row.incurredToDate, 0);
      const caseReserve = incurredToDate - paidToDate;
      if (
        !Number.isFinite(paidToDate) ||
        !Number.isFinite(incurredToDate) ||
        !Number.isFinite(caseReserve)
      ) {
        throw new ReservingError(
          "SHAPE",
          `Claim ${claimId} evaluation year ${evaluationYear}: combined paid, incurred, and case reserve must remain finite`,
        );
      }
      claims.push({
        claimId,
        accidentDate: yearEnd(group.originYear),
        reportDate: yearEnd(reportYear),
        evaluationDate: yearEnd(evaluationYear),
        paidToDate,
        caseReserve,
        status: sameYear.some((row) => row.status === "open") ? "open" : "closed",
      });
    }
  }

  if (inferredReportYears > 0) {
    findings.push({
      code: "report-year-inferred",
      severity: "disclosure",
      affectedClaims: inferredReportYears,
      message:
        "Report year was absent and was inferred as each claim's earliest evaluation year.",
    });
  }
  if (duplicateGroups > 0) {
    findings.push({
      code: "duplicate-snapshots-combined",
      severity: "warning",
      affectedGroups: duplicateGroups,
      affectedRows: duplicateRows,
      message:
        "Same-claim, same-year rows were combined by summing paid and incurred; the combined status is open when any component is open.",
    });
  }

  return {
    claims,
    findings,
    conventions: {
      sourceDatePrecision: "year",
      derivedDateConvention: "calendar-year-end",
      missingReportYearConvention: "earliest-evaluation-year",
      duplicatePolicy,
    },
    sourceRowCount: rows.length,
  };
}
