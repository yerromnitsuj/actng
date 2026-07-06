import { describe, expect, it } from "vitest";
import { computeDevelopmentFactors } from "../src/factors.js";
import { runChainLadder } from "../src/chainladder.js";
import { runBornhuetterFerguson } from "../src/bf.js";
import { fitTail } from "../src/tail.js";
import { berquistCaseAdequacy, berquistSettlement } from "../src/berquist.js";
import { buildTriangles, triangleFromGrid } from "../src/triangle.js";
import { calendarYearTest, runDiagnostics } from "../src/diagnostics.js";
import { ReservingError, type ClaimSnapshot, type Triangle } from "../src/types.js";

const N = null;

function tri(values: (number | null)[][], ages?: number[]): Triangle {
  return triangleFromGrid(
    "paid",
    values.map((_, i) => String(2000 + i)),
    ages ?? values[0]!.map((_, j) => (j + 1) * 12),
    values,
  );
}

describe("age-to-age factors", () => {
  it("volume-weighted average is sum/sum, not the mean of ratios", () => {
    const t = tri([
      [100, 200],
      [300, 330],
      [500, N],
    ]);
    const dev = computeDevelopmentFactors(t);
    const straight = dev.averages.find((a) => a.spec.key === "all-str")!.values[0];
    const weighted = dev.averages.find((a) => a.spec.key === "all-wtd")!.values[0];
    expect(straight).toBeCloseTo((2.0 + 1.1) / 2, 10);
    expect(weighted).toBeCloseTo(530 / 400, 10); // NOT 1.55
  });

  it("never divides by a missing, zero, or negative denominator", () => {
    const t = tri([
      [0, 50],
      [-10, 20],
      [N, 30],
      [100, 150],
    ]);
    const dev = computeDevelopmentFactors(t);
    expect(dev.individual[0]![0]).toBeNull();
    expect(dev.individual[1]![0]).toBeNull();
    expect(dev.individual[2]![0]).toBeNull();
    expect(dev.individual[3]![0]).toBeCloseTo(1.5, 10);
    // Averages only use the single valid row.
    const weighted = dev.averages.find((a) => a.spec.key === "all-wtd")!.values[0];
    expect(weighted).toBeCloseTo(1.5, 10);
  });

  it("medial average drops the single highest and lowest", () => {
    const t = tri([
      [100, 110],
      [100, 150],
      [100, 120],
      [100, 130],
      [100, 140],
      [100, N],
    ]);
    const dev = computeDevelopmentFactors(t);
    const medial = dev.averages.find((a) => a.spec.key === "med-5x1")!.values[0];
    expect(medial).toBeCloseTo((1.2 + 1.3 + 1.4) / 3, 10);
  });

  it("geometric average is the nth root of the product", () => {
    const t = tri([
      [100, 200],
      [100, 800],
      [50, N],
    ]);
    const dev = computeDevelopmentFactors(t);
    const geo = dev.averages.find((a) => a.spec.key === "geo-all")!.values[0];
    expect(geo).toBeCloseTo(4, 10);
  });

  it("n-year averages use only the most recent n factors", () => {
    const t = tri([
      [100, 400],
      [100, 200],
      [100, 110],
      [100, 120],
      [100, 130],
      [100, N],
    ]);
    const dev = computeDevelopmentFactors(t);
    const threeStraight = dev.averages.find((a) => a.spec.key === "3-str")!.values[0];
    expect(threeStraight).toBeCloseTo((1.1 + 1.2 + 1.3) / 3, 10);
  });
});

describe("chain ladder", () => {
  const t = tri([
    [100, 150, 165],
    [120, 180, N],
    [110, N, N],
  ]);

  it("builds CDFs right to left and applies them to the latest diagonal", () => {
    const result = runChainLadder(t, { selected: [1.5, 1.1], tailFactor: 1.02 });
    expect(result.cdfs).toEqual([1.5 * 1.1 * 1.02, 1.1 * 1.02, 1.02]);
    expect(result.rows[2]!.ultimate).toBeCloseTo(110 * 1.5 * 1.1 * 1.02, 8);
    expect(result.rows[1]!.ultimate).toBeCloseTo(180 * 1.1 * 1.02, 8);
    expect(result.rows[0]!.ultimate).toBeCloseTo(165 * 1.02, 8);
    expect(result.rows[2]!.unpaid).toBeCloseTo(110 * 1.5 * 1.1 * 1.02 - 110, 8);
    expect(result.percentDeveloped[0]).toBeCloseTo(1 / (1.5 * 1.1 * 1.02), 10);
  });

  it("warns loudly on missing selections and treats them as 1.0", () => {
    const result = runChainLadder(t, { selected: [1.5, N], tailFactor: 1 });
    expect(result.warnings.some((w) => w.includes("Missing LDF"))).toBe(true);
    expect(result.cdfs[1]).toBe(1);
    expect(result.rows[1]!.ultimate).toBeCloseTo(180, 8);
  });

  it("refuses to run when every selection is missing", () => {
    expect(() => runChainLadder(t, { selected: [N, N], tailFactor: 1 })).toThrowError(
      ReservingError,
    );
  });

  it("rejects a selection vector of the wrong length", () => {
    expect(() => runChainLadder(t, { selected: [1.5], tailFactor: 1 })).toThrowError(
      /Expected 2 LDF selections/,
    );
  });
});

describe("Bornhuetter-Ferguson", () => {
  it("matches the hand-computed example and the BF identity", () => {
    const t = tri([
      [100, 150],
      [120, N],
    ]);
    const cl = runChainLadder(t, { selected: [1.5], tailFactor: 1 });
    const bf = runBornhuetterFerguson(t, cl, [
      { origin: "2000", earnedPremium: 200 },
      { origin: "2001", earnedPremium: 200 },
    ]);
    // Mature origin 2000 anchors the a-priori at 150/200 = 0.75.
    expect(bf.rows[0]!.aprioriLossRatio).toBeCloseTo(0.75, 10);
    // BF ultimate = actual + expected x (1 - 1/CDF) = 120 + 150 * (1 - 1/1.5).
    expect(bf.rows[1]!.ultimate).toBeCloseTo(170, 8);
    expect(bf.rows[0]!.ultimate).toBeCloseTo(150, 8);
  });

  it("honors a-priori overrides", () => {
    const t = tri([
      [100, 150],
      [120, N],
    ]);
    const cl = runChainLadder(t, { selected: [1.5], tailFactor: 1 });
    const bf = runBornhuetterFerguson(
      t,
      cl,
      [
        { origin: "2000", earnedPremium: 200 },
        { origin: "2001", earnedPremium: 200 },
      ],
      { aprioriLossRatio: 0.9 },
    );
    expect(bf.rows[1]!.ultimate).toBeCloseTo(120 + 180 * (1 - 1 / 1.5), 8);
  });
});

describe("tail fitting", () => {
  it("recovers a perfect exponential decay and its tail", () => {
    // f_j = 1 + e^{-j} for j = 1..5 -> tail over j >= 6 is ~1.00393.
    const ldfs = [1, 2, 3, 4, 5].map((j) => 1 + Math.exp(-j));
    const fit = fitTail({ method: "exponentialDecay", selectedLdfs: ldfs });
    expect(fit.valid).toBe(true);
    expect(fit.slope).toBeCloseTo(-1, 6);
    expect(fit.intercept).toBeCloseTo(0, 6);
    expect(fit.rSquared).toBeGreaterThan(0.9999);
    expect(fit.tailFactor).toBeGreaterThan(1.0035);
    expect(fit.tailFactor).toBeLessThan(1.0045);
  });

  it("rejects growth (non-decaying) patterns", () => {
    const fit = fitTail({
      method: "exponentialDecay",
      selectedLdfs: [1.05, 1.1, 1.2, 1.4],
    });
    expect(fit.valid).toBe(false);
    expect(fit.tailFactor).toBe(1);
    expect(fit.warnings.join(" ")).toMatch(/grows with age/);
  });

  it("requires at least three usable points", () => {
    const fit = fitTail({ method: "exponentialDecay", selectedLdfs: [1.5, 1.2, 1.0, N] });
    expect(fit.valid).toBe(false);
    expect(fit.warnings.join(" ")).toMatch(/at least 3/);
  });

  it("flags a divergent inverse power fit instead of returning garbage", () => {
    // f_j - 1 = j^{-0.5}: slope -0.5 > -1, the infinite product diverges.
    const ldfs = [1, 2, 3, 4, 5].map((j) => 1 + Math.pow(j, -0.5));
    const fit = fitTail({ method: "inversePower", selectedLdfs: ldfs });
    expect(fit.valid).toBe(false);
    expect(fit.warnings.join(" ")).toMatch(/divergent/);
  });
});

describe("Berquist-Sherman case-reserve adequacy", () => {
  it("restates historical average case reserves off the latest diagonal", () => {
    const paid = tri([
      [50, 80],
      [60, N],
    ]);
    const incurred = tri([
      [100, 120],
      [130, N],
    ]);
    const open = tri([
      [5, 2],
      [7, N],
    ]);
    const result = berquistCaseAdequacy(paid, incurred, open, { severityTrend: 0.1 });
    expect(result.trendSource).toBe("user");
    // Diagonal average case: col 0 -> row 1 = (130-60)/7 = 10; col 1 -> row 0 = 20.
    expect(result.restatedAverageCaseReserves[1]![0]).toBeCloseTo(10, 10);
    expect(result.restatedAverageCaseReserves[0]![0]).toBeCloseTo(10 / 1.1, 10);
    expect(result.restatedAverageCaseReserves[0]![1]).toBeCloseTo(20, 10);
    // Adjusted incurred = paid + restated avg case x open counts.
    expect(result.adjustedIncurred.values[0]![0]).toBeCloseTo(50 + (10 / 1.1) * 5, 8);
    expect(result.adjustedIncurred.values[0]![1]).toBeCloseTo(80 + 20 * 2, 8);
    expect(result.adjustedIncurred.values[1]![0]).toBeCloseTo(60 + 10 * 7, 8);
    expect(result.adjustedIncurred.values[1]![1]).toBeNull();
  });
});

describe("Berquist-Sherman settlement-rate adjustment", () => {
  const paid = tri([
    [100, 200, 300],
    [150, 260, N],
    [120, N, N],
  ]);
  const closed = tri([
    [10, 20, 30],
    [12, 22, N],
    [9, N, N],
  ]);
  const ultimateCounts = [40, 40, 30];

  it("selects the latest-diagonal disposal rates and restates closed counts", () => {
    const result = berquistSettlement(paid, closed, { ultimateCounts, interpolation: "linear" });
    expect(result.selectedDisposalRates).toEqual([9 / 30, 22 / 40, 30 / 40]);
    expect(result.adjustedClosedCounts[0]).toEqual([12, 22, 30]);
    expect(result.adjustedClosedCounts[2]![0]).toBeCloseTo(9, 10);
  });

  it("interpolates adjusted paid at the restated closed counts (linear)", () => {
    const result = berquistSettlement(paid, closed, { ultimateCounts, interpolation: "linear" });
    // Row 0 targets 12 and 22 closed: between (10,100)-(20,200) and (20,200)-(30,300).
    expect(result.adjustedPaid.values[0]![0]).toBeCloseTo(120, 8);
    expect(result.adjustedPaid.values[0]![1]).toBeCloseTo(220, 8);
    // Exact hits keep actual values (the diagonal is unchanged by construction).
    expect(result.adjustedPaid.values[0]![2]).toBeCloseTo(300, 8);
    expect(result.adjustedPaid.values[1]![0]).toBeCloseTo(150, 8);
    expect(result.adjustedPaid.values[1]![1]).toBeCloseTo(260, 8);
    expect(result.adjustedPaid.values[2]![0]).toBeCloseTo(120, 8);
  });

  it("interpolates exponentially through the bracketing points when asked", () => {
    const result = berquistSettlement(paid, closed, {
      ultimateCounts,
      interpolation: "exponential",
    });
    // y = a e^{bx} through (10,100) and (20,200): y(12) = 100 * 2^{0.2}.
    expect(result.adjustedPaid.values[0]![0]).toBeCloseTo(100 * Math.pow(2, 0.2), 6);
    expect(result.adjustedPaid.values[0]![1]).toBeCloseTo(200 * Math.pow(1.5, 0.2), 6);
  });

  it("rejects a wrong-length ultimate count vector", () => {
    expect(() => berquistSettlement(paid, closed, { ultimateCounts: [40, 40] })).toThrowError(
      ReservingError,
    );
  });
});

describe("triangle builder", () => {
  const claims: ClaimSnapshot[] = [
    {
      claimId: "A",
      accidentDate: "2022-03-10",
      reportDate: "2022-04-01",
      evaluationDate: "2022-12-31",
      paidToDate: 1000,
      caseReserve: 500,
      status: "open",
    },
    {
      claimId: "A",
      accidentDate: "2022-03-10",
      reportDate: "2022-04-01",
      evaluationDate: "2023-12-31",
      paidToDate: 1800,
      caseReserve: 0,
      status: "closed",
    },
    {
      claimId: "B",
      accidentDate: "2023-06-15",
      reportDate: "2023-07-01",
      evaluationDate: "2023-12-31",
      paidToDate: 0,
      caseReserve: 800,
      status: "open",
    },
  ];

  it("builds all triangles with correct cells and null unobservables", () => {
    const set = buildTriangles(claims, { cadence: "annual", asOfDate: "2023-12-31" });
    expect(set.paid.origins).toEqual(["2022", "2023"]);
    expect(set.paid.ages).toEqual([12, 24]);
    expect(set.paid.values).toEqual([
      [1000, 1800],
      [0, N],
    ]);
    expect(set.incurred.values).toEqual([
      [1500, 1800],
      [800, N],
    ]);
    expect(set.reportedCount.values).toEqual([
      [1, 1],
      [1, N],
    ]);
    expect(set.openCount.values).toEqual([
      [1, 0],
      [1, N],
    ]);
    expect(set.closedCount.values).toEqual([
      [0, 1],
      [0, N],
    ]);
    expect(set.closedWithPayCount.values).toEqual([
      [0, 1],
      [0, N],
    ]);
  });

  it("supports quarterly cadence", () => {
    const set = buildTriangles(claims, { cadence: "quarterly", asOfDate: "2023-12-31" });
    expect(set.paid.origins[0]).toBe("2022Q1");
    expect(set.paid.ages[0]).toBe(3);
    // Claim A sits in 2022Q1. Its age-3 evaluation (2022-03-31) precedes the
    // 2022-04-01 report date, so it is unreported there and appears at age 6;
    // paid stays 0 until the first snapshot (2022-12-31, age 12).
    expect(set.reportedCount.values[0]![0]).toBe(0);
    expect(set.reportedCount.values[0]![1]).toBe(1);
    expect(set.paid.values[0]![1]).toBe(0);
  });

  it("throws on an empty loss run", () => {
    expect(() => buildTriangles([], { cadence: "annual", asOfDate: "2023-12-31" })).toThrowError(
      ReservingError,
    );
  });
});

describe("diagnostics", () => {
  it("flags a strong alternating calendar-year effect", () => {
    // Cumulative triangle whose factors alternate high/low by diagonal parity.
    const n = 12;
    const values: (number | null)[][] = [];
    for (let i = 0; i < n; i++) {
      const row: (number | null)[] = [];
      let v = 1000;
      for (let j = 0; j < n; j++) {
        if (i + j >= n) {
          row.push(N);
          continue;
        }
        if (j > 0) v *= (i + j) % 2 === 0 ? 1.02 : 1.35;
        row.push(v);
      }
      values.push(row);
    }
    const result = calendarYearTest(tri(values));
    expect(result).not.toBeNull();
    expect(result!.significant).toBe(true);
    expect(result!.totalZ).toBeLessThan(result!.confidenceInterval[0]);
  });

  it("returns findings and grids for a full diagnostic run", () => {
    const paid = tri([
      [50, 80, 95],
      [60, 90, N],
      [55, N, N],
    ]);
    const incurred = tri([
      [100, 110, 100],
      [110, 105, N],
      [95, N, N],
    ]);
    const counts = tri([
      [10, 10, 10],
      [10, 10, N],
      [9, N, N],
    ]);
    const closed = tri([
      [4, 7, 9],
      [5, 8, N],
      [4, N, N],
    ]);
    const open = tri([
      [6, 3, 1],
      [5, 2, N],
      [5, N, N],
    ]);
    const result = runDiagnostics({
      paid,
      incurred,
      openCounts: open,
      reportedCounts: counts,
      closedCounts: closed,
    });
    expect(result.paidToIncurredRatios[0]![0]).toBeCloseTo(0.5, 10);
    expect(result.closureRates[0]![2]).toBeCloseTo(0.9, 10);
    expect(result.averageCaseReserves[0]![0]).toBeCloseTo(50 / 6, 10);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
