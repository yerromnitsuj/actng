import { describe, expect, it } from "vitest";
import {
  createStructuredDataCheck,
  DIAGNOSTIC_REVIEW_CHECK_CODES,
  reviewDiagnosticData,
  type DiagnosticReviewExposure,
  type DiagnosticReviewSnapshot,
  type ReviewDiagnosticDataOptions,
} from "../src/index.js";

const pairs = [
  { id: "250", paidMeasure: "paid250", incurredMeasure: "incurred250" },
  { id: "primary", paidMeasure: "paidPrimary", incurredMeasure: "incurredPrimary" },
] as const;
const layers = [
  { id: "narrow", paidMeasure: "paid250", incurredMeasure: "incurred250", broaderLayerId: "broad" },
  { id: "broad", paidMeasure: "paidPrimary", incurredMeasure: "incurredPrimary" },
] as const;

function snapshot(overrides: Partial<DiagnosticReviewSnapshot> = {}): DiagnosticReviewSnapshot {
  return {
    id: "row-1", group: "segment", origin: "2024Q1", valuation: "2024Q1", ageMonths: 3,
    measures: {
      reportedCount: 10, openCount: 4, closedNoPayCount: 2, closedWithPayCount: 4,
      paid250: 5, incurred250: 10, paidPrimary: 7, incurredPrimary: 14,
    },
    source: { sourceFile: "loss.csv", sourceRow: 2 },
    ...overrides,
  };
}

function exposure(overrides: Partial<DiagnosticReviewExposure> = {}): DiagnosticReviewExposure {
  return {
    key: "exp-1", group: "segment", origin: "2024Q1", measures: { exposure: 100 }, complete: true,
    source: { sourceFile: "exposure.csv", sourceRow: 2 },
    ...overrides,
  };
}

const completeOptions: ReviewDiagnosticDataOptions = {
  amountPairs: pairs,
  layers,
  controlTotals: [{ id: "latest-paid", measure: "paid250", expected: 8, valuation: "2024Q2" }],
  groupingAssignments: [{ key: "risk-1", group: "segment" }, { key: "risk-1", group: "segment" }],
  cachedFormulaProvenance: [{ id: "cell-A1", declaredFormulaSource: true, formula: "=SUM(A2:A3)", cachedValue: 8 }],
};

function check(report: ReturnType<typeof reviewDiagnosticData>, id: string) {
  return report.checks.find((item) => item.id === id)!;
}

describe("reviewDiagnosticData", () => {
  it("lists every stable check code and passes clean configured data", () => {
    const rows = [
      snapshot(),
      snapshot({ id: "row-2", valuation: "2024Q2", ageMonths: 6, measures: {
        reportedCount: 12, openCount: 3, closedNoPayCount: 3, closedWithPayCount: 6,
        paid250: 8, incurred250: 12, paidPrimary: 10, incurredPrimary: 16,
      } }),
    ];
    const report = reviewDiagnosticData(rows, [exposure()], completeOptions);
    expect(report.checks.map((item) => item.id)).toEqual(DIAGNOSTIC_REVIEW_CHECK_CODES);
    expect(report.checks.every((item) => item.status === "pass")).toBe(true);
    expect(report.summary).toEqual({ pass: DIAGNOSTIC_REVIEW_CHECK_CODES.length, warning: 0, fail: 0, notEvaluated: 0 });
  });

  it("finds duplicate aggregate snapshot and exposure keys with source context", () => {
    const report = reviewDiagnosticData(
      [snapshot(), snapshot({ id: "duplicate", source: { sourceFile: "loss.csv", sourceRow: 9 } })],
      [exposure(), exposure({ valuation: "2024Q2", source: { sourceFile: "exposure.csv", sourceRow: 8 } })],
      completeOptions,
    );
    expect(check(report, "duplicate-aggregate-snapshot")).toMatchObject({ status: "fail" });
    expect(check(report, "duplicate-exposure-key").findings![0]!.context).toMatchObject({
      origin: "2024Q1", group: "segment", sourceFile: "exposure.csv", sourceRow: 8,
    });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("finds invalid ages, mismatches, and valuation-before-origin independently", () => {
    const report = reviewDiagnosticData([
      snapshot({ id: "bad-age", ageMonths: -3 }),
      snapshot({ id: "mismatch", valuation: "2024Q2", ageMonths: 3 }),
      snapshot({ id: "reverse", origin: "2024Q2", valuation: "2024Q1" }),
    ], [exposure()], completeOptions);
    expect(check(report, "invalid-development-age").status).toBe("fail");
    expect(check(report, "development-age-mismatch").status).toBe("fail");
    expect(check(report, "valuation-before-origin").status).toBe("fail");
  });

  it("finds count reconciliation, closed-no-pay, and paid-over-incurred issues", () => {
    const report = reviewDiagnosticData([snapshot({ measures: {
      reportedCount: 5, openCount: 3, closedNoPayCount: 6, closedWithPayCount: 1,
      paid250: 11, incurred250: 10, paidPrimary: 7, incurredPrimary: 14,
    } })], [exposure()], completeOptions);
    expect(check(report, "count-reconciliation").status).toBe("fail");
    expect(check(report, "closed-no-pay-exceeds-reported").status).toBe("fail");
    expect(check(report, "paid-exceeds-incurred").status).toBe("fail");
  });

  it("finds decreasing cumulative paid/reported/closed reopen signals", () => {
    const report = reviewDiagnosticData([
      snapshot(),
      snapshot({ id: "later", valuation: "2024Q2", ageMonths: 6, measures: {
        reportedCount: 9, openCount: 6, closedNoPayCount: 1, closedWithPayCount: 2,
        paid250: 4, incurred250: 10, paidPrimary: 6, incurredPrimary: 14,
      } }),
    ], [exposure()], { ...completeOptions, controlTotals: [] });
    expect(check(report, "cumulative-paid-decreasing").status).toBe("warning");
    expect(check(report, "cumulative-reported-decreasing").status).toBe("fail");
    expect(check(report, "closed-reopen-signal").status).toBe("warning");
  });

  it("finds layer ordering and control-total failures using configurable tolerances", () => {
    const bad = snapshot({ measures: {
      reportedCount: 10, openCount: 4, closedNoPayCount: 2, closedWithPayCount: 4,
      paid250: 15, incurred250: 20, paidPrimary: 14, incurredPrimary: 19,
    } });
    const report = reviewDiagnosticData([bad], [exposure()], {
      ...completeOptions,
      controlTotals: [{ id: "control", measure: "incurred250", expected: 10 }],
    });
    expect(check(report, "layer-order").status).toBe("fail");
    expect(check(report, "layer-control-reconciliation").status).toBe("fail");
    const tolerated = reviewDiagnosticData([bad], [exposure()], {
      ...completeOptions,
      tolerance: { absolute: 11 },
      controlTotals: [{ id: "control", measure: "incurred250", expected: 10 }],
    });
    expect(check(tolerated, "layer-control-reconciliation").status).toBe("pass");
  });

  it("finds both sides of loss/exposure joins plus zero and incomplete exposure", () => {
    const report = reviewDiagnosticData(
      [snapshot(), snapshot({ id: "orphan-loss", group: "loss-only" })],
      [exposure({ measures: { exposure: 0 } }), exposure({ key: "exp-2", group: "exposure-only", complete: false, measures: { exposure: null } })],
      completeOptions,
    );
    expect(check(report, "loss-without-exposure").status).toBe("warning");
    expect(check(report, "exposure-without-loss").status).toBe("warning");
    expect(check(report, "zero-exposure").status).toBe("fail");
    expect(check(report, "incomplete-exposure").status).toBe("fail");
  });

  it("finds inconsistent generic grouping and missing cached-formula provenance", () => {
    const report = reviewDiagnosticData([snapshot()], [exposure()], {
      ...completeOptions,
      groupingAssignments: [{ key: "risk-1", group: "alpha" }, { key: "risk-1", group: "beta", source: { sourceFile: "map.csv", sourceRow: 3 } }],
      cachedFormulaProvenance: [{ id: "A1", declaredFormulaSource: true, cachedValue: 10, sourceFile: "book.xlsx", sourceRow: 1 }],
    });
    expect(check(report, "inconsistent-group-mapping").status).toBe("fail");
    expect(check(report, "cached-formula-provenance").status).toBe("warning");
    expect(check(report, "cached-formula-provenance").findings![0]!.context).toEqual({ sourceFile: "book.xlsx", sourceRow: 1 });
  });

  it("supports configurable severity without changing stable codes", () => {
    const report = reviewDiagnosticData([snapshot({ measures: {
      reportedCount: 10, openCount: 4, closedNoPayCount: 2, closedWithPayCount: 4,
      paid250: 12, incurred250: 10, paidPrimary: 7, incurredPrimary: 14,
    } })], [exposure()], {
      ...completeOptions,
      severities: { "paid-exceeds-incurred": "warning" },
    });
    expect(check(report, "paid-exceeds-incurred")).toMatchObject({ id: "paid-exceeds-incurred", status: "warning" });
  });

  it("keeps structured finding context genuinely optional and JSON-safe", () => {
    const result = createStructuredDataCheck(
      "caller-check",
      "Caller check",
      "warning",
      [{ code: "caller-check", message: "Finding without row context" }],
    );
    expect(result.findings![0]).toEqual({
      code: "caller-check",
      message: "Finding without row context",
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("reports unconfigured optional checks as not evaluated, never pass", () => {
    const report = reviewDiagnosticData([snapshot()], [exposure()]);
    for (const id of ["paid-exceeds-incurred", "cumulative-paid-decreasing", "layer-order", "layer-control-reconciliation", "inconsistent-group-mapping", "cached-formula-provenance"]) {
      expect(check(report, id).status).toBe("not-evaluated");
    }
  });

  it("never passes measure-based checks when required measures are absent", () => {
    const report = reviewDiagnosticData([
      snapshot({ measures: {} }),
    ], [exposure()], completeOptions);
    for (const id of [
      "count-reconciliation",
      "closed-no-pay-exceeds-reported",
      "paid-exceeds-incurred",
      "cumulative-paid-decreasing",
      "cumulative-reported-decreasing",
      "closed-reopen-signal",
      "layer-order",
    ]) {
      expect(check(report, id).status).toBe("not-evaluated");
      expect(check(report, id).details[0]).toMatch(/^not evaluated:/);
    }
  });

  it("reports partially missing required measures as findings", () => {
    const report = reviewDiagnosticData([
      snapshot({ measures: {
        reportedCount: 10, openCount: 4, closedNoPayCount: 2,
        paid250: 5, incurred250: 10, paidPrimary: 7,
      } }),
    ], [exposure()], completeOptions);
    expect(check(report, "count-reconciliation")).toMatchObject({ status: "fail" });
    expect(check(report, "count-reconciliation").findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining("closedWithPayCount") }),
    ]));
    expect(check(report, "paid-exceeds-incurred")).toMatchObject({ status: "fail" });
    expect(check(report, "paid-exceeds-incurred").findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining("incurredPrimary") }),
    ]));
  });

  it("does not claim cumulative checks passed when no timeline is comparable", () => {
    const report = reviewDiagnosticData([snapshot()], [exposure()], completeOptions);
    for (const id of [
      "cumulative-paid-decreasing",
      "cumulative-reported-decreasing",
      "closed-reopen-signal",
    ]) expect(check(report, id).status).toBe("not-evaluated");
  });

  it("still reports a known violation when another snapshot is incomplete", () => {
    const report = reviewDiagnosticData([
      snapshot({ measures: {
        reportedCount: 5, openCount: 3, closedNoPayCount: 6, closedWithPayCount: 1,
        paid250: 11, incurred250: 10, paidPrimary: 7, incurredPrimary: 14,
      } }),
      snapshot({ id: "incomplete", valuation: "2024Q2", ageMonths: 6, measures: {} }),
    ], [exposure()], completeOptions);
    expect(check(report, "count-reconciliation").status).toBe("fail");
    expect(check(report, "paid-exceeds-incurred").status).toBe("fail");
  });
});
