import { describe, expect, it } from "vitest";
import { runFisherLange } from "../src/fisherLange.js";
import { triangleFromGrid } from "../src/triangle.js";
import { ReservingError } from "../src/types.js";

/**
 * Closed-form validation of the Fisher-Lange disposal-rate method.
 *
 * Base book (annual, ages 12/24/36): every origin ultimately closes 100
 * claims as 50/30/20 by settlement age, so cumulative closed counts run
 * 50/80/100 and the latest-diagonal disposal rates are [0.5, 0.3, 0.2]
 * (summing to 1).
 */

const ORIGINS = ["2023", "2024", "2025"];
const AGES = [12, 24, 36];
const closedTri = triangleFromGrid("closedCount", ORIGINS, AGES, [
  [50, 80, 100],
  [50, 80, null],
  [50, null, null],
]);
const ULTIMATES = [100, 100, 100];

function expectCode(
  code: "SHAPE" | "SELECTION_SHAPE" | "BAD_COUNTS" | "BAD_TREND" | "BAD_DATE" | "TOO_SMALL" | "NO_DATA",
  fn: () => unknown,
): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ReservingError);
  expect((thrown as ReservingError).code).toBe(code);
}

describe("Fisher-Lange: constant severity closed form (mandatory)", () => {
  // Every closure costs exactly 10 with zero trend, so the reserve must be
  // 10 x ultimate counts x (future disposal share), exactly.
  const paidTri = triangleFromGrid("paid", ORIGINS, AGES, [
    [500, 800, 1000],
    [500, 800, null],
    [500, null, null],
  ]);
  const result = runFisherLange(paidTri, closedTri, ULTIMATES, { severityTrend: 0 });

  it("defaults disposal selections to the latest observed diagonal", () => {
    expect(result.selectedDisposalRates.map((d) => d!)).toEqual([0.5, 0.3, 0.2]);
    expect(result.disposalRates[2]![0]!).toBeCloseTo(0.5, 12);
    expect(result.disposalRates[1]![1]!).toBeCloseTo(0.3, 12);
    expect(result.disposalRates[0]![2]!).toBeCloseTo(0.2, 12);
  });

  it("recovers the constant severity in every cell and in the selections", () => {
    for (const row of result.severities) {
      for (const s of row) {
        if (s !== null) expect(s).toBeCloseTo(10, 12);
      }
    }
    result.selectedSeverities.forEach((s) => expect(s!).toBeCloseTo(10, 12));
  });

  it("reserve = severity x ultimate counts x future disposal share, per origin", () => {
    const [r2023, r2024, r2025] = result.rows;
    expect(r2023!.unpaid).toBeCloseTo(0, 12);
    expect(r2023!.ultimate).toBeCloseTo(1000, 12);

    expect(r2024!.futureClosedCounts).toEqual([20]);
    expect(r2024!.unpaid).toBeCloseTo(10 * 100 * 0.2, 10);
    expect(r2024!.ultimate).toBeCloseTo(1000, 10);

    expect(r2025!.futureClosedCounts.map((c) => Number(c.toFixed(9)))).toEqual([30, 20]);
    expect(r2025!.unpaid).toBeCloseTo(10 * 100 * (0.3 + 0.2), 10);
    expect(r2025!.ultimate).toBeCloseTo(1000, 10);

    expect(result.totals.unpaid).toBeCloseTo(700, 10);
    expect(result.totals.ultimate).toBeCloseTo(3000, 10);
    expect(result.warnings).toHaveLength(0);
  });

  it("states the reference at the latest diagonal's calendar year", () => {
    expect(result.referenceYear).toBe(2025);
  });
});

describe("Fisher-Lange: severity trend compounds by calendar distance", () => {
  // Severities grow exactly 10%/calendar year: the earliest cell (2023 @ 12,
  // calendar 2023) pays 10 per closure, so a cell y calendar years later
  // pays 10 x 1.1^y. Incremental paid = severity x incremental closed.
  const g = 1.1;
  const paidTri = triangleFromGrid("paid", ORIGINS, AGES, [
    [500, 500 + 30 * 10 * g, 500 + 30 * 10 * g + 20 * 10 * g ** 2],
    [50 * 10 * g, 50 * 10 * g + 30 * 10 * g ** 2, null],
    [50 * 10 * g ** 2, null, null],
  ]);
  const result = runFisherLange(paidTri, closedTri, ULTIMATES, { severityTrend: 0.1 });

  it("selected severities land on the latest diagonal's severity (10 x 1.1^2)", () => {
    result.selectedSeverities.forEach((s) => expect(s!).toBeCloseTo(10 * g ** 2, 10));
    expect(result.referenceYear).toBe(2025);
  });

  it("future cells compound the trend by their calendar distance from the diagonal", () => {
    const [r2023, r2024, r2025] = result.rows;
    // 2024's one future cell (age 36) sits 1 calendar year past the diagonal.
    expect(r2024!.futureSeverities[0]!).toBeCloseTo(10 * g ** 3, 10);
    expect(r2024!.unpaid).toBeCloseTo(20 * 10 * g ** 3, 8);
    // 2025's future cells sit 1 and 2 calendar years out.
    expect(r2025!.futureSeverities[0]!).toBeCloseTo(10 * g ** 3, 10);
    expect(r2025!.futureSeverities[1]!).toBeCloseTo(10 * g ** 4, 10);
    expect(r2025!.unpaid).toBeCloseTo(30 * 10 * g ** 3 + 20 * 10 * g ** 4, 8);
    expect(r2023!.unpaid).toBeCloseTo(0, 12);
  });

  it("targetYear shifts only the DISPLAYED severities; the projection is invariant", () => {
    const shifted = runFisherLange(paidTri, closedTri, ULTIMATES, {
      severityTrend: 0.1,
      targetYear: 2026,
    });
    expect(shifted.referenceYear).toBe(2026);
    shifted.selectedSeverities.forEach((s) => expect(s!).toBeCloseTo(10 * g ** 3, 10));
    expect(shifted.rows).toEqual(result.rows);
    expect(shifted.totals).toEqual(result.totals);
  });

  it("ignores targetYear (with a warning) when origin labels aren't calendar years", () => {
    const labeled = triangleFromGrid("paid", ["A", "B", "C"], AGES, paidTri.values);
    const counts = triangleFromGrid("closedCount", ["A", "B", "C"], AGES, closedTri.values);
    const result2 = runFisherLange(labeled, counts, ULTIMATES, {
      severityTrend: 0.1,
      targetYear: 2026,
    });
    expect(result2.referenceYear).toBeNull();
    expect(result2.warnings.join("\n")).toContain("targetYear ignored");
    expect(result2.totals.unpaid).toBeCloseTo(result.totals.unpaid, 10);
  });
});

describe("Fisher-Lange: sparse cells and selection handling", () => {
  it("warns on a needed age with no observable severity and projects zero there", () => {
    // A closes nothing (and pays nothing) in 12-24; B hasn't reached it.
    const paid = triangleFromGrid("paid", ["A", "B"], [12, 24], [
      [500, 500],
      [500, null],
    ]);
    const closed = triangleFromGrid("closedCount", ["A", "B"], [12, 24], [
      [50, 50],
      [50, null],
    ]);
    const result = runFisherLange(paid, closed, [50, 50], {
      severityTrend: 0,
      disposalSelections: [null, 0.5],
    });
    const text = result.warnings.join("\n");
    expect(text).toContain("No severity is observable for age 24");
    expect(text).toContain("disposal rates sum to 1.5000"); // diagonal 1.0 + selected 0.5
    const rB = result.rows[1]!;
    expect(rB.futureClosedCounts).toEqual([25]);
    expect(rB.futureSeverities).toEqual([null]);
    expect(rB.unpaid).toBe(0);
  });

  it("warns on an age with no selectable disposal rate and projects zero closures", () => {
    const paid = triangleFromGrid("paid", ["A", "B"], AGES, [
      [500, 800, null],
      [500, null, null],
    ]);
    const closed = triangleFromGrid("closedCount", ["A", "B"], AGES, [
      [50, 80, null],
      [50, null, null],
    ]);
    const result = runFisherLange(paid, closed, [100, 100], { severityTrend: 0 });
    expect(result.warnings.join("\n")).toContain("No disposal rate is selectable for age 36");
    expect(result.rows[0]!.futureClosedCounts).toEqual([0]);
    expect(result.rows[0]!.unpaid).toBe(0);
    // B's age-24 projection still works off A's diagonal (0.3 at severity 10).
    expect(result.rows[1]!.unpaid).toBeCloseTo(100 * 0.3 * 10, 10);
  });

  it("ignores a negative disposal selection in favor of the diagonal, warned", () => {
    const paid = triangleFromGrid("paid", ORIGINS, AGES, [
      [500, 800, 1000],
      [500, 800, null],
      [500, null, null],
    ]);
    const result = runFisherLange(paid, closedTri, ULTIMATES, {
      severityTrend: 0,
      disposalSelections: [-0.2, null, null],
    });
    expect(result.warnings.join("\n")).toContain("Negative disposal-rate selection");
    expect(result.selectedDisposalRates[0]!).toBeCloseTo(0.5, 12);
  });

  it("warns when the selected disposal rates leave closures beyond the triangle", () => {
    const paid = triangleFromGrid("paid", ORIGINS, AGES, [
      [500, 800, 1000],
      [500, 800, null],
      [500, null, null],
    ]);
    const result = runFisherLange(paid, closedTri, ULTIMATES, {
      severityTrend: 0,
      disposalSelections: [0.5, 0.3, 0.1],
    });
    expect(result.warnings.join("\n")).toContain("NOT projected");
  });
});

describe("Fisher-Lange validation", () => {
  const paidTri = triangleFromGrid("paid", ORIGINS, AGES, [
    [500, 800, 1000],
    [500, 800, null],
    [500, null, null],
  ]);

  it("throws SHAPE for mismatched triangles, unequal age spacing, or wrong counts length", () => {
    const otherAges = triangleFromGrid("closedCount", ORIGINS, [3, 6, 9], closedTri.values);
    expectCode("SHAPE", () => runFisherLange(paidTri, otherAges, ULTIMATES, { severityTrend: 0 }));

    const uneven = triangleFromGrid("paid", ORIGINS, [12, 24, 48], paidTri.values);
    const unevenCounts = triangleFromGrid("closedCount", ORIGINS, [12, 24, 48], closedTri.values);
    expectCode("SHAPE", () =>
      runFisherLange(uneven, unevenCounts, ULTIMATES, { severityTrend: 0 }),
    );

    expectCode("SHAPE", () => runFisherLange(paidTri, closedTri, [100], { severityTrend: 0 }));
  });

  it("throws BAD_COUNTS for non-finite or negative ultimate counts", () => {
    expectCode("BAD_COUNTS", () =>
      runFisherLange(paidTri, closedTri, [100, Number.NaN, 100], { severityTrend: 0 }),
    );
    expectCode("BAD_COUNTS", () =>
      runFisherLange(paidTri, closedTri, [100, -1, 100], { severityTrend: 0 }),
    );
  });

  it("throws BAD_TREND for a trend at or below -100%", () => {
    expectCode("BAD_TREND", () =>
      runFisherLange(paidTri, closedTri, ULTIMATES, { severityTrend: -1 }),
    );
  });

  it("throws SELECTION_SHAPE for wrong-length disposal selections", () => {
    expectCode("SELECTION_SHAPE", () =>
      runFisherLange(paidTri, closedTri, ULTIMATES, {
        severityTrend: 0,
        disposalSelections: [0.5, 0.3],
      }),
    );
  });

  it("throws BAD_DATE for a non-integer targetYear", () => {
    expectCode("BAD_DATE", () =>
      runFisherLange(paidTri, closedTri, ULTIMATES, { severityTrend: 0, targetYear: 2025.5 }),
    );
  });

  it("throws TOO_SMALL below two development ages and NO_DATA on empty triangles", () => {
    const oneAge = triangleFromGrid("paid", ["2025"], [12], [[100]]);
    const oneAgeCounts = triangleFromGrid("closedCount", ["2025"], [12], [[10]]);
    expectCode("TOO_SMALL", () => runFisherLange(oneAge, oneAgeCounts, [10], { severityTrend: 0 }));

    const empty = triangleFromGrid("paid", ["2025"], [12, 24], [[null, null]]);
    const emptyCounts = triangleFromGrid("closedCount", ["2025"], [12, 24], [[null, null]]);
    expectCode("NO_DATA", () => runFisherLange(empty, emptyCounts, [10], { severityTrend: 0 }));
  });

  it("a zero-count origin projects a zero reserve, not NaN", () => {
    const result = runFisherLange(paidTri, closedTri, [100, 100, 0], { severityTrend: 0 });
    const r2025 = result.rows[2]!;
    expect(r2025.futureClosedCounts).toEqual([0, 0]);
    expect(r2025.unpaid).toBe(0);
    expect(Number.isFinite(r2025.ultimate)).toBe(true);
  });
});
