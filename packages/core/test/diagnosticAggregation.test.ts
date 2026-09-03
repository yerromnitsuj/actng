import { describe, expect, it } from "vitest";
import { auditedDiagnosticContribution, finalizeDiagnosticContributions } from "../src/index.js";

describe("definition-driven diagnostic aggregation", () => {
  it("distinguishes unknown missingness, zero imputation, and explicit zero", () => {
    const unknown = finalizeDiagnosticContributions([
      auditedDiagnosticContribution("b", 2, "unknown"),
      auditedDiagnosticContribution("a", null, "unknown"),
    ], "unknown");
    expect(unknown).toMatchObject({ value: null, sum: 2, observed: 1, missing: 1, imputedZero: 0 });
    const zero = finalizeDiagnosticContributions([
      auditedDiagnosticContribution("b", 2, "zero"),
      auditedDiagnosticContribution("a", null, "zero"),
      auditedDiagnosticContribution("c", 0, "zero"),
    ], "zero");
    expect(zero).toMatchObject({ value: 2, sum: 2, observed: 2, missing: 1, imputedZero: 1 });
  });

  it("is row-permutation invariant and uses compensated summation", () => {
    const values = [1e16, 1, -1e16].map((value, index) => auditedDiagnosticContribution(String(index), value, "unknown"));
    expect(finalizeDiagnosticContributions(values, "unknown")).toEqual(finalizeDiagnosticContributions([...values].reverse(), "unknown"));
    expect(finalizeDiagnosticContributions(values, "unknown").value).toBe(1);
  });

  it("fails closed for non-finite input, overflow, and structural blockers", () => {
    expect(finalizeDiagnosticContributions([auditedDiagnosticContribution("a", Infinity, "zero")], "zero")).toMatchObject({ value: null, sum: null, nonFinite: 1 });
    expect(finalizeDiagnosticContributions([auditedDiagnosticContribution("a", Number.MAX_VALUE, "unknown"), auditedDiagnosticContribution("b", Number.MAX_VALUE, "unknown")], "unknown")).toMatchObject({ value: null, sum: null });
    expect(finalizeDiagnosticContributions([auditedDiagnosticContribution("a", 1, "unknown")], "unknown", [{ code: "duplicate", message: "Duplicate", sourceIds: ["a"], sources: [] }])).toMatchObject({ value: null, sum: null, structural: 1 });
  });
});
