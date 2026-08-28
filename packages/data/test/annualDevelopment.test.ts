import { describe, expect, it } from "vitest";
import { buildTriangles, ReservingError } from "@actuarial-ts/core";
import {
  annualDevelopmentToClaimSnapshots,
  type AnnualClaimDevelopmentRow,
} from "../src/annualDevelopment.js";

function row(
  overrides: Partial<AnnualClaimDevelopmentRow> = {},
): AnnualClaimDevelopmentRow {
  return {
    claimId: "1995-000001",
    originYear: 1995,
    evaluationYear: 1995,
    paidToDate: 100,
    incurredToDate: 150,
    status: "open",
    ...overrides,
  };
}

describe("annualDevelopmentToClaimSnapshots", () => {
  it("derives year-end dates and exposes the convention", () => {
    const result = annualDevelopmentToClaimSnapshots([
      row(),
      row({ evaluationYear: 1996, paidToDate: 140, incurredToDate: 140, status: "closed" }),
    ]);

    expect(result.claims).toEqual([
      {
        claimId: "1995-000001",
        accidentDate: "1995-12-31",
        reportDate: "1995-12-31",
        evaluationDate: "1995-12-31",
        paidToDate: 100,
        caseReserve: 50,
        status: "open",
      },
      {
        claimId: "1995-000001",
        accidentDate: "1995-12-31",
        reportDate: "1995-12-31",
        evaluationDate: "1996-12-31",
        paidToDate: 140,
        caseReserve: 0,
        status: "closed",
      },
    ]);
    expect(result.conventions).toEqual({
      sourceDatePrecision: "year",
      derivedDateConvention: "calendar-year-end",
      missingReportYearConvention: "earliest-evaluation-year",
      duplicatePolicy: "reject",
    });
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "annual-dates-derived",
      "report-year-inferred",
    ]);
  });

  it("uses a supplied report year consistently across a claim timeline", () => {
    const result = annualDevelopmentToClaimSnapshots([
      row({ originYear: 1995, reportYear: 1996, evaluationYear: 1996 }),
      row({ originYear: 1995, reportYear: 1996, evaluationYear: 1997 }),
    ]);

    expect(result.claims.every((claim) => claim.reportDate === "1996-12-31")).toBe(true);
    expect(result.findings.some((finding) => finding.code === "report-year-inferred")).toBe(false);
  });

  it("rejects ambiguous duplicate claim-year snapshots by default", () => {
    expect(() =>
      annualDevelopmentToClaimSnapshots([
        row(),
        row({ paidToDate: 25, incurredToDate: 40 }),
      ]),
    ).toThrow(/choose duplicatePolicy "combine"/);
  });

  it("combines duplicate dollar streams only when explicitly selected", () => {
    const result = annualDevelopmentToClaimSnapshots(
      [
        row({ paidToDate: 100, incurredToDate: 150, status: "closed" }),
        row({ paidToDate: 25, incurredToDate: 40, status: "open" }),
      ],
      { duplicatePolicy: "combine" },
    );

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]).toMatchObject({
      paidToDate: 125,
      caseReserve: 65,
      status: "open",
    });
    expect(result.findings.at(-1)).toMatchObject({
      code: "duplicate-snapshots-combined",
      severity: "warning",
      affectedGroups: 1,
      affectedRows: 2,
    });
  });

  it("rejects a duplicate combination that overflows a finite money field", () => {
    expect(() =>
      annualDevelopmentToClaimSnapshots(
        [
          row({ paidToDate: Number.MAX_VALUE, incurredToDate: Number.MAX_VALUE }),
          row({ paidToDate: Number.MAX_VALUE, incurredToDate: Number.MAX_VALUE }),
        ],
        { duplicatePolicy: "combine" },
      ),
    ).toThrow(/must remain finite/);
  });

  it("preserves negative inferred case reserve for the review layer", () => {
    const result = annualDevelopmentToClaimSnapshots([
      row({ paidToDate: 200, incurredToDate: 175 }),
    ]);
    expect(result.claims[0]!.caseReserve).toBe(-25);
  });

  it("feeds the core timeline builder without losing late reports or annual gaps", () => {
    const conversion = annualDevelopmentToClaimSnapshots([
      row({
        originYear: 1995,
        reportYear: 1996,
        evaluationYear: 1996,
        paidToDate: 100,
        incurredToDate: 150,
      }),
      row({
        originYear: 1995,
        reportYear: 1996,
        evaluationYear: 1998,
        paidToDate: 140,
        incurredToDate: 140,
        status: "closed",
      }),
    ]);
    const triangles = buildTriangles(conversion.claims, {
      cadence: "annual",
      asOfDate: "1998-12-31",
    });

    expect(triangles.paid.ages).toEqual([12, 24, 36, 48]);
    expect(triangles.paid.values[0]).toEqual([0, 100, 100, 140]);
    expect(triangles.reportedCount.values[0]).toEqual([0, 1, 1, 1]);
  });

  it("rejects invalid row relationships and conflicting claim metadata", () => {
    expect(() =>
      annualDevelopmentToClaimSnapshots([row({ evaluationYear: 1994 })]),
    ).toThrow(ReservingError);
    expect(() =>
      annualDevelopmentToClaimSnapshots([
        row(),
        row({ originYear: 1996, evaluationYear: 1996 }),
      ]),
    ).toThrow(/conflicting origin years/);
    expect(() =>
      annualDevelopmentToClaimSnapshots([
        row({ reportYear: 1995 }),
        row({ reportYear: 1996, evaluationYear: 1996 }),
      ]),
    ).toThrow(/conflicting report years/);
  });
});
