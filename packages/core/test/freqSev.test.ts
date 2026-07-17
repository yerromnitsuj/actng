import { describe, expect, it } from "vitest";
import { triangleFromGrid } from "../src/triangle.js";
import { computeDevelopmentFactors } from "../src/factors.js";
import { runChainLadder } from "../src/chainladder.js";
import { runFrequencySeverity, severityTriangle } from "../src/freqSev.js";
import type { Triangle } from "../src/types.js";

const N = null;

const counts: Triangle = triangleFromGrid(
  "reportedCount",
  ["2021", "2022", "2023"],
  [12, 24, 36],
  [
    [100, 150, 160],
    [110, 165, N],
    [120, N, N],
  ],
);

const SEV = 1000;
const losses: Triangle = triangleFromGrid(
  "incurred",
  ["2021", "2022", "2023"],
  [12, 24, 36],
  [
    [100 * SEV, 150 * SEV, 160 * SEV],
    [110 * SEV, 165 * SEV, N],
    [120 * SEV, N, N],
  ],
);

function vw(tri: Triangle): (number | null)[] {
  return computeDevelopmentFactors(tri).averages.find((a) => a.spec.key === "all-wtd")!.values;
}

describe("severityTriangle", () => {
  it("is the cell-wise loss/count ratio, null-safe", () => {
    const sev = severityTriangle(losses, counts);
    expect(sev.values[0]![0]).toBeCloseTo(SEV, 9);
    expect(sev.values[1]![2]).toBeNull();
    expect(sev.origins).toEqual(losses.origins);
    expect(sev.ages).toEqual(losses.ages);
  });

  it("yields null (not NaN/throw) when a count cell is zero", () => {
    const zeroCounts = triangleFromGrid("reportedCount", ["2021"], [12], [[0]]);
    const oneLoss = triangleFromGrid("incurred", ["2021"], [12], [[5000]]);
    expect(severityTriangle(oneLoss, zeroCounts).values[0]![0]).toBeNull();
  });

  it("throws SHAPE on mismatched dimensions", () => {
    const small = triangleFromGrid("reportedCount", ["2021"], [12], [[1]]);
    expect(() => severityTriangle(losses, small)).toThrowError(/identical origins/i);
  });
});

describe("runFrequencySeverity (Friedland ch. 11)", () => {
  it("with constant severity, reproduces the chain ladder on losses exactly", () => {
    const sev = severityTriangle(losses, counts);
    const result = runFrequencySeverity(losses, counts, {
      countSelected: vw(counts),
      severitySelected: vw(sev),
    });
    const cl = runChainLadder(losses, { selected: vw(losses), tailFactor: 1 });
    result.rows.forEach((row, i) => {
      expect(row.ultimateSeverity).toBeCloseTo(SEV, 6);
      expect(row.ultimate).toBeCloseTo(cl.rows[i]!.ultimate, 6);
      expect(row.unpaid).toBeCloseTo(cl.rows[i]!.unpaid, 6);
    });
    expect(result.totals.ultimate).toBeCloseTo(cl.totals.ultimate, 6);
  });

  it("ultimate = ultimate counts x ultimate severity, row for row", () => {
    const sev = severityTriangle(losses, counts);
    const result = runFrequencySeverity(losses, counts, {
      countSelected: vw(counts),
      countTailFactor: 1.02,
      severitySelected: vw(sev),
      severityTailFactor: 1.01,
    });
    for (const row of result.rows) {
      expect(row.ultimate).toBeCloseTo(row.ultimateCounts * row.ultimateSeverity, 6);
    }
  });

  it("carries the loss triangle's latest diagonal so unpaid ties to the loss basis", () => {
    const sev = severityTriangle(losses, counts);
    const result = runFrequencySeverity(losses, counts, {
      countSelected: vw(counts),
      severitySelected: vw(sev),
    });
    expect(result.rows[2]!.latestValue).toBeCloseTo(120 * SEV, 9);
    expect(result.rows[2]!.unpaid).toBeCloseTo(result.rows[2]!.ultimate - 120 * SEV, 9);
  });
});
