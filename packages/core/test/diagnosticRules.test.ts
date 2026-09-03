import { describe, expect, it } from "vitest";
import { classifyDiagnosticComparison } from "../src/index.js";

describe("classifyDiagnosticComparison", () => {
  it.each([
    [1, 2, "less"],
    [2, 2, "equal"],
    [3, 2, "greater"],
    [0.9, 1, "equal"],
    [1.125, 1, "equal"],
  ] as const)("classifies %s versus %s", (left, right, relation) => {
    const tolerance = left === right || Number.isInteger(left) ? undefined : { absolute: Math.abs(left - 1) };
    expect(classifyDiagnosticComparison(left, right, tolerance)).toEqual({ status: "evaluated", relation });
  });

  it("handles missing, non-finite, tolerance overflow, and opposite-sign extremes", () => {
    expect(classifyDiagnosticComparison(null, 1)).toEqual({ status: "not-evaluated", reason: "missing" });
    expect(classifyDiagnosticComparison(Number.NaN, 1)).toEqual({ status: "not-evaluated", reason: "non-finite" });
    expect(classifyDiagnosticComparison(1, 2, { absolute: Number.MAX_VALUE, relative: Number.MAX_VALUE })).toEqual({ status: "not-evaluated", reason: "tolerance-overflow" });
    expect(classifyDiagnosticComparison(-Number.MAX_VALUE, Number.MAX_VALUE)).toEqual({ status: "evaluated", relation: "less" });
  });
});
