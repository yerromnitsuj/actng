import { describe, expect, it } from "vitest";
import type { AveInputRow } from "../src/ave.js";
import { aveRollForward, percentDevelopedFromCdfs } from "../src/ave.js";
import { ComplianceError } from "../src/bundle.js";

function row(overrides: Partial<AveInputRow> = {}): AveInputRow {
  return {
    origin: "2021",
    priorUltimate: 1000,
    priorLatest: 480,
    currentLatest: 700,
    expectedPercentAtPrior: 0.5,
    expectedPercentAtCurrent: 0.7,
    ...overrides,
  };
}

describe("aveRollForward", () => {
  it("matches the hand-computed example", () => {
    // expected = 1000 x (0.7 - 0.5) = 200; actual = 700 - 480 = 220
    const result = aveRollForward([row()]);
    expect(result.rows).toHaveLength(1);
    const r = result.rows[0]!;
    expect(r.origin).toBe("2021");
    expect(r.expectedEmergence).toBeCloseTo(200, 10);
    expect(r.actualEmergence).toBeCloseTo(220, 10);
    expect(r.difference).toBeCloseTo(20, 10);
    expect(r.ratio).toBeCloseTo(1.1, 10);
    expect(result.warnings).toEqual([]);
  });

  it("sums totals across origins, hand-computed", () => {
    const result = aveRollForward([
      row(),
      // expected = 2000 x (0.9 - 0.8) = 200; actual = 1750 - 1600 = 150
      row({
        origin: "2020",
        priorUltimate: 2000,
        priorLatest: 1600,
        currentLatest: 1750,
        expectedPercentAtPrior: 0.8,
        expectedPercentAtCurrent: 0.9,
      }),
    ]);
    expect(result.totals.expectedEmergence).toBeCloseTo(400, 10);
    expect(result.totals.actualEmergence).toBeCloseTo(370, 10);
    expect(result.totals.difference).toBeCloseTo(-30, 10);
    expect(result.totals.ratio).toBeCloseTo(370 / 400, 10);
  });

  it("yields a null ratio (never NaN/Infinity) when expected emergence is 0", () => {
    const result = aveRollForward([
      row({ expectedPercentAtPrior: 0.7, expectedPercentAtCurrent: 0.7, currentLatest: 500 }),
    ]);
    const r = result.rows[0]!;
    expect(r.expectedEmergence).toBe(0);
    expect(r.actualEmergence).toBeCloseTo(20, 10);
    expect(r.ratio).toBeNull();
    expect(result.totals.ratio).toBeNull();
  });

  it("nulls the total ratio only when the TOTAL expected is 0", () => {
    const result = aveRollForward([
      row(), // expected 200
      row({ origin: "2020", expectedPercentAtPrior: 0.6, expectedPercentAtCurrent: 0.6 }), // expected 0
    ]);
    expect(result.rows[1]!.ratio).toBeNull();
    expect(result.totals.ratio).toBeCloseTo(result.totals.actualEmergence / 200, 10);
  });

  it("warns when the pattern goes backwards", () => {
    const result = aveRollForward([
      row({ expectedPercentAtPrior: 0.7, expectedPercentAtCurrent: 0.55 }),
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("pattern goes backwards");
    expect(result.warnings[0]).toContain("2021");
    // The arithmetic is still well-defined: expected = 1000 x (0.55 - 0.7) = -150.
    expect(result.rows[0]!.expectedEmergence).toBeCloseTo(-150, 10);
  });

  it("warns on percents below 0 or above 1.05, naming the field", () => {
    const result = aveRollForward([
      row({ origin: "2019", expectedPercentAtPrior: -0.1, expectedPercentAtCurrent: 1.2 }),
    ]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain("expectedPercentAtPrior -0.1");
    expect(result.warnings[1]).toContain("expectedPercentAtCurrent 1.2");
    for (const warning of result.warnings) {
      expect(warning).toContain("2019");
      expect(warning).toContain("outside [0, 1.05]");
    }
  });

  it("accepts percents slightly above 1 without warning (paid overshoot is legitimate)", () => {
    const result = aveRollForward([
      row({ expectedPercentAtPrior: 0.98, expectedPercentAtCurrent: 1.03 }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("returns zero totals and a null ratio for no rows", () => {
    expect(aveRollForward([])).toEqual({
      rows: [],
      totals: { expectedEmergence: 0, actualEmergence: 0, difference: 0, ratio: null },
      warnings: [],
    });
  });
});

describe("percentDevelopedFromCdfs", () => {
  it("inverts each CDF", () => {
    const percents = percentDevelopedFromCdfs([2, 1.25, 1]);
    expect(percents[0]).toBeCloseTo(0.5, 12);
    expect(percents[1]).toBeCloseTo(0.8, 12);
    expect(percents[2]).toBeCloseTo(1, 12);
  });

  it.each([0, -1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws BAD_CDF on non-positive or non-finite cdf %s",
    (bad) => {
      let thrown: unknown;
      try {
        percentDevelopedFromCdfs([1.5, bad]);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ComplianceError);
      const complianceError = thrown as ComplianceError;
      expect(complianceError.code).toBe("BAD_CDF");
      expect(complianceError.message).toContain("index 1");
    },
  );

  it("handles the empty vector", () => {
    expect(percentDevelopedFromCdfs([])).toEqual([]);
  });
});
