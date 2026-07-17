import { describe, expect, it } from "vitest";
import { runCaseOutstanding } from "../src/caseOutstanding.js";
import { triangleFromGrid } from "../src/triangle.js";
import { ReservingError } from "../src/types.js";

/**
 * Hand-computed 4x4 validation of the case-outstanding development
 * technique (Friedland ch. 12), plus the mandatory self-consistency
 * property: when case runs off exactly per the selected pattern, the
 * reserve ties to the projected paid stream and to the fully developed
 * origin's actual outcome.
 */

const ORIGINS = ["2022", "2023", "2024", "2025"];
const AGES = [12, 24, 36, 48];

const paidTri = triangleFromGrid("paid", ORIGINS, AGES, [
  [100, 250, 340, 400],
  [110, 280, 380, null],
  [130, 300, null, null],
  [140, null, null, null],
]);
const caseTri = triangleFromGrid("caseReserve", ORIGINS, AGES, [
  [300, 200, 100, 40],
  [320, 220, 110, null],
  [350, 240, null, null],
  [380, null, null, null],
]);

const selections = {
  caseSelections: [0.7, 0.5, 0.4],
  paidOnCaseSelections: [0.5, 0.45, 0.6],
  tailPaidOnCase: 1,
};

function expectCode(
  code: "SHAPE" | "SELECTION_SHAPE" | "BAD_TAIL" | "NO_SELECTIONS" | "NO_DATA",
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

describe("case-outstanding development: hand-computed 4x4", () => {
  const result = runCaseOutstanding(paidTri, caseTri, selections);

  it("computes the historical case run-off and paid-on-prior-case ratio triangles", () => {
    expect(result.caseRatios[0]![0]!).toBeCloseTo(200 / 300, 12);
    expect(result.caseRatios[0]![1]!).toBeCloseTo(0.5, 12);
    expect(result.caseRatios[0]![2]!).toBeCloseTo(0.4, 12);
    expect(result.caseRatios[2]![0]!).toBeCloseTo(240 / 350, 12);
    expect(result.caseRatios[2]![1]).toBeNull(); // unobserved

    expect(result.paidOnPriorCase[0]![0]!).toBeCloseTo(150 / 300, 12);
    expect(result.paidOnPriorCase[0]![1]!).toBeCloseTo(90 / 200, 12);
    expect(result.paidOnPriorCase[0]![2]!).toBeCloseTo(60 / 100, 12);
    expect(result.paidOnPriorCase[2]![0]!).toBeCloseTo(170 / 350, 12);
    expect(result.paidOnPriorCase[3]![0]).toBeNull();
  });

  it("projects each origin's future paid from its latest case (hand-computed)", () => {
    // 2025 from case 380: pays 190, then case 266 pays 119.7, then case 133
    // pays 79.8, terminal case 53.2 pays out in full.
    const r2025 = result.rows[3]!;
    expect(r2025.futurePaid.map((v) => Number(v.toFixed(10)))).toEqual([190, 119.7, 79.8, 53.2]);
    expect(r2025.projectedCase.map((v) => Number(v.toFixed(10)))).toEqual([266, 133, 53.2]);
    expect(r2025.unpaid).toBeCloseTo(442.7, 10);
    expect(r2025.ultimate).toBeCloseTo(582.7, 10);

    const r2024 = result.rows[2]!;
    expect(r2024.unpaid).toBeCloseTo(108 + 72 + 48, 10);
    expect(r2024.ultimate).toBeCloseTo(528, 10);

    const r2023 = result.rows[1]!;
    expect(r2023.unpaid).toBeCloseTo(66 + 44, 10);
    expect(r2023.ultimate).toBeCloseTo(490, 10);

    // 2022 sits at the last age: only the tail payout of its case remains.
    const r2022 = result.rows[0]!;
    expect(r2022.futurePaid).toEqual([40]);
    expect(r2022.projectedCase).toEqual([]);
    expect(r2022.unpaid).toBeCloseTo(40, 12);
    expect(r2022.ultimate).toBeCloseTo(440, 12);
  });

  it("totals the aligned columns", () => {
    expect(result.totals.paidToDate).toBeCloseTo(400 + 380 + 300 + 140, 12);
    expect(result.totals.caseOutstanding).toBeCloseTo(40 + 110 + 240 + 380, 12);
    expect(result.totals.unpaid).toBeCloseTo(40 + 110 + 228 + 442.7, 10);
    expect(result.totals.ultimate).toBeCloseTo(result.totals.paidToDate + result.totals.unpaid, 10);
  });

  it("unpaid IS the sum of the projected paid stream for every origin", () => {
    for (const row of result.rows) {
      const streamSum = row.futurePaid.reduce((a, v) => a + v, 0);
      expect(row.unpaid).toBeCloseTo(streamSum, 12);
      expect(row.ultimate).toBeCloseTo(row.paidToDate + streamSum, 12);
    }
  });
});

describe("case-outstanding self-consistency property (mandatory)", () => {
  // Synthetic book that runs off EXACTLY at case ratio 0.5 and paid-on-case
  // 0.4 from a common seed case of 1000: case [1000, 500, 250, 125], paid
  // increments [_, 400, 200, 100] on first-column paid 500.
  const exactPaid = triangleFromGrid("paid", ORIGINS, AGES, [
    [500, 900, 1100, 1200],
    [500, 900, 1100, null],
    [500, 900, null, null],
    [500, null, null, null],
  ]);
  const exactCase = triangleFromGrid("caseReserve", ORIGINS, AGES, [
    [1000, 500, 250, 125],
    [1000, 500, 250, null],
    [1000, 500, null, null],
    [1000, null, null, null],
  ]);
  const exactSelections = {
    caseSelections: [0.5, 0.5, 0.5],
    paidOnCaseSelections: [0.4, 0.4, 0.4],
    tailPaidOnCase: 1,
  };
  const result = runCaseOutstanding(exactPaid, exactCase, exactSelections);

  it("recovers the generating ratios in every observable cell", () => {
    result.caseRatios.forEach((row, i) => {
      row.forEach((v, j) => {
        const observable = i + j < 3;
        if (observable) expect(v!).toBeCloseTo(0.5, 12);
        else expect(v).toBeNull();
      });
    });
    result.paidOnPriorCase.forEach((row, i) => {
      row.forEach((v, j) => {
        const observable = i + j < 3;
        if (observable) expect(v!).toBeCloseTo(0.4, 12);
        else expect(v).toBeNull();
      });
    });
  });

  it("reproduces the closed-form geometric reserve for the greenest origin", () => {
    // unpaid = 1000 x 0.4 x (1 + 0.5 + 0.25) + 1000 x 0.5^3 x 1 = 700 + 125.
    const r2025 = result.rows[3]!;
    expect(r2025.unpaid).toBeCloseTo(825, 10);
    expect(r2025.futurePaid.map((v) => Number(v.toFixed(10)))).toEqual([400, 200, 100, 125]);
  });

  it("projects every green origin to the fully developed origin's actual outcome", () => {
    // 2022's realized path: paid 1200 at 48 plus its terminal case 125 paid
    // in full = 1325. Every younger origin shares the pattern and the seed,
    // so each must land exactly there.
    const developedUltimate = 1200 + 125;
    for (const row of result.rows) {
      expect(row.ultimate).toBeCloseTo(developedUltimate, 10);
    }
    // And each projected payment stream replays 2022's observed increments.
    expect(result.rows[3]!.futurePaid.slice(0, 3).map((v) => Number(v.toFixed(10)))).toEqual([
      400, 200, 100,
    ]);
  });
});

describe("case-outstanding: coercions, warnings, and null-safety", () => {
  it("treats a missing paid-on-case selection as 0 and a missing case selection as 1, loudly", () => {
    const result = runCaseOutstanding(paidTri, caseTri, {
      caseSelections: [null, 0.5, 0.4],
      paidOnCaseSelections: [null, 0.45, 0.6],
      tailPaidOnCase: 1,
    });
    const text = result.warnings.join("\n");
    expect(text).toContain("Missing case run-off selection for 12-24 months; treated as 1.000");
    expect(text).toContain("Missing paid-on-case selection for 12-24 months; treated as 0.000");
    // 2025: no payment in 12-24, case carried at 380, then the usual path:
    // 380 x 0.45 + 190 x 0.6 + 76 x 1 = 171 + 114 + 76.
    const r2025 = result.rows[3]!;
    expect(r2025.unpaid).toBeCloseTo(171 + 114 + 76, 10);
  });

  it("coerces a negative case selection to 0 and keeps a negative paid-on-case, both warned", () => {
    const result = runCaseOutstanding(paidTri, caseTri, {
      caseSelections: [-0.2, 0.5, 0.4],
      paidOnCaseSelections: [0.5, -0.1, 0.6],
      tailPaidOnCase: 1,
    });
    const text = result.warnings.join("\n");
    expect(text).toContain("Negative case run-off selection");
    expect(text).toContain("projects net recoveries");
    // 2025: pays 190, case dies at 0, then all zeros.
    expect(result.rows[3]!.unpaid).toBeCloseTo(190, 10);
    // 2024 (from case 240 at 24): pays 240 x (-0.1) = -24, case 120, pays 72, case 48 tail.
    expect(result.rows[2]!.unpaid).toBeCloseTo(-24 + 72 + 48, 10);
  });

  it("warns when the tail default pays out material terminal case, and not when overridden", () => {
    const defaulted = runCaseOutstanding(paidTri, caseTri, {
      caseSelections: selections.caseSelections,
      paidOnCaseSelections: selections.paidOnCaseSelections,
    });
    expect(defaulted.warnings.join("\n")).toContain("assumed paid in full");
    expect(defaulted.tailPaidOnCase).toBe(1);

    const overridden = runCaseOutstanding(paidTri, caseTri, { ...selections, tailPaidOnCase: 0.9 });
    expect(overridden.warnings.join("\n")).not.toContain("assumed paid in full");
    // 2022: 40 x 0.9.
    expect(overridden.rows[0]!.unpaid).toBeCloseTo(36, 12);
  });

  it("projects from the latest JOINTLY observed age when diagonals are ragged, warned", () => {
    const raggedCase = triangleFromGrid("caseReserve", ORIGINS, AGES, [
      [300, 200, 100, 40],
      [320, 220, 110, null],
      [350, 240, null, null],
      [null, null, null, null],
    ]);
    const raggedPaid = triangleFromGrid("paid", ORIGINS, AGES, [
      [100, 250, 340, 400],
      [110, 280, 380, null],
      [130, 300, null, null],
      [140, null, null, null],
    ]);
    // 2025 has paid but no case anywhere -> excluded with a warning.
    const result = runCaseOutstanding(raggedPaid, raggedCase, selections);
    expect(result.rows).toHaveLength(3);
    expect(result.warnings.join("\n")).toContain("2025");

    // Ragged within a row: case observed one age short of paid.
    const shortCase = triangleFromGrid("caseReserve", ["2024"], [12, 24, 36], [[350, null, null]]);
    const longPaid = triangleFromGrid("paid", ["2024"], [12, 24, 36], [[130, 300, null]]);
    const ragged = runCaseOutstanding(longPaid, shortCase, {
      caseSelections: [0.7, 0.5],
      paidOnCaseSelections: [0.5, 0.45],
      tailPaidOnCase: 1,
    });
    expect(ragged.warnings.join("\n")).toContain("different ages");
    expect(ragged.rows[0]!.latestAge).toBe(12);
    // From case 350 at 12: 175 + 110.25 + 122.5 tail.
    expect(ragged.rows[0]!.unpaid).toBeCloseTo(350 * 0.5 + 245 * 0.45 + 122.5, 10);
  });

  it("interior nulls yield null ratios, never NaN", () => {
    const holedCase = triangleFromGrid("caseReserve", ["2022"], AGES, [[300, null, 100, 40]]);
    const holedPaid = triangleFromGrid("paid", ["2022"], AGES, [[100, null, 340, 400]]);
    const result = runCaseOutstanding(holedPaid, holedCase, selections);
    expect(result.caseRatios[0]![0]).toBeNull();
    expect(result.caseRatios[0]![1]).toBeNull();
    expect(result.caseRatios[0]![2]!).toBeCloseTo(0.4, 12);
    expect(result.paidOnPriorCase[0]![0]).toBeNull();
    expect(result.paidOnPriorCase[0]![1]).toBeNull();
    expect(result.paidOnPriorCase[0]![2]!).toBeCloseTo(0.6, 12);
    for (const row of result.rows) {
      expect(Number.isFinite(row.unpaid)).toBe(true);
    }
  });
});

describe("case-outstanding validation", () => {
  it("throws SHAPE when the triangles disagree", () => {
    const otherAges = triangleFromGrid("caseReserve", ORIGINS, [3, 6, 9, 12], caseTri.values);
    expectCode("SHAPE", () => runCaseOutstanding(paidTri, otherAges, selections));
  });

  it("throws SELECTION_SHAPE for wrong-length selections", () => {
    expectCode("SELECTION_SHAPE", () =>
      runCaseOutstanding(paidTri, caseTri, { ...selections, caseSelections: [0.7, 0.5] }),
    );
    expectCode("SELECTION_SHAPE", () =>
      runCaseOutstanding(paidTri, caseTri, { ...selections, paidOnCaseSelections: [0.5] }),
    );
  });

  it("throws BAD_TAIL for a negative or non-finite tail payout ratio", () => {
    expectCode("BAD_TAIL", () =>
      runCaseOutstanding(paidTri, caseTri, { ...selections, tailPaidOnCase: -0.1 }),
    );
    expectCode("BAD_TAIL", () =>
      runCaseOutstanding(paidTri, caseTri, { ...selections, tailPaidOnCase: Number.NaN }),
    );
  });

  it("throws NO_SELECTIONS when nothing is selected at all", () => {
    expectCode("NO_SELECTIONS", () =>
      runCaseOutstanding(paidTri, caseTri, {
        caseSelections: [null, null, null],
        paidOnCaseSelections: [null, null, null],
      }),
    );
  });

  it("throws NO_DATA when no origin has a jointly observed cell", () => {
    const emptyCase = triangleFromGrid("caseReserve", ["2025"], [12, 24], [[null, null]]);
    const somePaid = triangleFromGrid("paid", ["2025"], [12, 24], [[100, null]]);
    expectCode("NO_DATA", () =>
      runCaseOutstanding(somePaid, emptyCase, {
        caseSelections: [0.5],
        paidOnCaseSelections: [0.4],
      }),
    );
  });
});
