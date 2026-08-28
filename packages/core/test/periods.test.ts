import { describe, expect, it } from "vitest";
import {
  addQuarters,
  compareQuarterPeriods,
  completeQuarterCutoff,
  completeQuarterlyCutoffs,
  developmentAgeMonths,
  formatQuarterPeriod,
  parseQuarterPeriod,
  policyPeriodLabel,
  sortQuarterPeriods,
} from "../src/index.js";

describe("quarter periods", () => {
  it("parses and formats every documented representation", () => {
    for (const label of ["2024Q3", "2024-Q3", "Q3 2024"]) {
      expect(parseQuarterPeriod(label)).toEqual({ year: 2024, quarter: 3 });
    }
    expect(formatQuarterPeriod({ year: 2024, quarter: 3 })).toBe("2024Q3");
    expect(formatQuarterPeriod({ year: 2024, quarter: 3 }, "hyphenated")).toBe("2024-Q3");
    expect(formatQuarterPeriod({ year: 2024, quarter: 3 }, "quarter-first")).toBe("Q3 2024");
    expect(parseQuarterPeriod(formatQuarterPeriod({ year: 99, quarter: 1 }))).toEqual({ year: 99, quarter: 1 });
  });

  it("compares and sorts numerically across Q4/Q1 year boundaries", () => {
    expect(compareQuarterPeriods("2024Q4", "2025Q1")).toBeLessThan(0);
    expect(sortQuarterPeriods(["2025Q1", "2024Q4", "2024Q2"])).toEqual([
      "2024Q2", "2024Q4", "2025Q1",
    ]);
    expect(addQuarters("2024Q4", 1)).toEqual({ year: 2025, quarter: 1 });
  });

  it("uses age 3 for the first quarter-end observation and supports explicit age zero", () => {
    expect(developmentAgeMonths("2024Q4", "2024Q4")).toBe(3);
    expect(developmentAgeMonths("2024Q4", "2025Q1")).toBe(6);
    expect(developmentAgeMonths("2023Q4", "2025Q1")).toBe(18);
    expect(developmentAgeMonths("2024Q4", "2024Q4", "elapsed")).toBe(0);
    expect(() => developmentAgeMonths("2025Q1", "2024Q4")).toThrow(/precedes/);
  });

  it("supports Q3-Q2 policy years without making that boundary the default", () => {
    expect(policyPeriodLabel("2024Q2")).toBe("2024");
    expect(policyPeriodLabel("2024Q2", { startQuarter: 3 })).toBe("2023");
    expect(policyPeriodLabel("2024Q3", { startQuarter: 3 })).toBe("2024");
    expect(policyPeriodLabel("2025Q2", { startQuarter: 3 })).toBe("2024");
    expect(policyPeriodLabel("2025Q3", { startQuarter: 3 })).toBe("2025");
    expect(policyPeriodLabel("2026Q2", { startQuarter: 3 })).toBe("2025");
    expect(policyPeriodLabel("2024Q3", { mapper: (p) => `FY-${p.year + 1}` })).toBe("FY-2025");
  });

  it("excludes partial quarters unless explicitly included", () => {
    expect(completeQuarterCutoff("2025-02-15")).toEqual({ year: 2024, quarter: 4 });
    expect(completeQuarterCutoff("2025-03-31")).toEqual({ year: 2025, quarter: 1 });
    expect(completeQuarterCutoff("2025-02-15", { includePartial: true })).toEqual({ year: 2025, quarter: 1 });
    expect(completeQuarterlyCutoffs("2025-02-15", { includePartialValuation: true })).toEqual({
      originThrough: { year: 2024, quarter: 4 },
      valuationThrough: { year: 2025, quarter: 1 },
    });
  });

  it("rejects malformed periods and dates", () => {
    for (const value of ["2024Q0", "2024Q5", "24Q1", "2024-13-01"]) {
      if (value.includes("-13-")) expect(() => completeQuarterCutoff(value)).toThrow();
      else expect(() => parseQuarterPeriod(value)).toThrow();
    }
  });
});
