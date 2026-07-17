import { describe, expect, it } from "vitest";
import { runChainLadder } from "../src/chainladder.js";
import { netOfRecoveries, runSalvageSubro } from "../src/salvageSubro.js";
import { subtractTriangles } from "../src/triangleAlgebra.js";
import { triangleFromGrid } from "../src/triangle.js";
import { ReservingError } from "../src/types.js";

/**
 * Hand-computed validation of the salvage & subrogation projection plus the
 * netting algebra, including the triangleAlgebra identity: with the same
 * selections on both triangles, net-of-recoveries equals a chain ladder on
 * the cell-wise difference triangle.
 */

const ORIGINS = ["2023", "2024", "2025"];
const AGES = [12, 24, 36];

const recoveryTri = triangleFromGrid("paid", ORIGINS, AGES, [
  [10, 25, 30],
  [12, 30, null],
  [8, null, null],
]);
const grossTri = triangleFromGrid("paid", ORIGINS, AGES, [
  [100, 180, 200],
  [120, 210, null],
  [90, null, null],
]);

function expectCode(code: "NO_DATA" | "SELECTION_SHAPE", fn: () => unknown): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ReservingError);
  expect((thrown as ReservingError).code).toBe(code);
}

describe("runSalvageSubro: chain ladder on the recovery triangle", () => {
  const result = runSalvageSubro(recoveryTri, { selected: [2.5, 1.2], tailFactor: 1 });

  it("projects ultimate recoveries per origin (hand-computed cdfs [3.0, 1.2, 1.0])", () => {
    expect(result.cdfs.map((c) => Number(c.toFixed(10)))).toEqual([3, 1.2, 1]);
    const [r2023, r2024, r2025] = result.rows;
    expect(r2023!.ultimateRecoveries).toBeCloseTo(30, 10);
    expect(r2023!.futureRecoveries).toBeCloseTo(0, 10);
    expect(r2024!.ultimateRecoveries).toBeCloseTo(36, 10);
    expect(r2024!.futureRecoveries).toBeCloseTo(6, 10);
    expect(r2025!.ultimateRecoveries).toBeCloseTo(24, 10);
    expect(r2025!.futureRecoveries).toBeCloseTo(16, 10);
    expect(result.totals.receivedToDate).toBeCloseTo(30 + 30 + 8, 12);
    expect(result.totals.ultimateRecoveries).toBeCloseTo(90, 10);
    expect(result.totals.futureRecoveries).toBeCloseTo(22, 10);
  });

  it("always warns that recovery development is slower and lumpier than loss development", () => {
    expect(result.warnings[0]).toContain("more slowly and less smoothly");
  });

  it("passes chain ladder warnings through (missing selection coerced to 1.000)", () => {
    const r = runSalvageSubro(recoveryTri, { selected: [2.5, null], tailFactor: 1 });
    expect(r.warnings.join("\n")).toContain("Missing LDF selection");
  });

  it("warns on negative cumulative recovery cells", () => {
    const negative = triangleFromGrid("paid", ["2025"], [12, 24], [[-5, null]]);
    const r = runSalvageSubro(negative, { selected: [2.0], tailFactor: 1 });
    expect(r.warnings.join("\n")).toContain("Negative cumulative recoveries for origin(s) 2025");
  });

  it("propagates chain ladder validation (SELECTION_SHAPE)", () => {
    expectCode("SELECTION_SHAPE", () => runSalvageSubro(recoveryTri, { selected: [2.5] }));
  });
});

describe("netOfRecoveries: origin-aligned netting", () => {
  const gross = runChainLadder(grossTri, { selected: [1.8, 1.1], tailFactor: 1 });
  const recoveries = runSalvageSubro(recoveryTri, { selected: [2.5, 1.2], tailFactor: 1 });
  const net = netOfRecoveries(gross, recoveries);

  it("nets ultimates and unpaid per origin (hand-computed)", () => {
    // Gross cdfs [1.98, 1.1, 1]: ultimates 200 / 231 / 178.2.
    const [r2023, r2024, r2025] = net.rows;
    expect(r2023!.netUltimate).toBeCloseTo(200 - 30, 10);
    expect(r2023!.netUnpaid).toBeCloseTo(0, 10);
    expect(r2024!.netUltimate).toBeCloseTo(231 - 36, 10);
    expect(r2024!.netUnpaid).toBeCloseTo(21 - 6, 10);
    expect(r2025!.netUltimate).toBeCloseTo(178.2 - 24, 10);
    expect(r2025!.netUnpaid).toBeCloseTo(88.2 - 16, 10);
  });

  it("net = gross - recoveries holds exactly within every row and the totals", () => {
    for (const row of net.rows) {
      expect(row.netUltimate).toBeCloseTo(row.grossUltimate - row.ultimateRecoveries, 12);
      expect(row.netUnpaid).toBeCloseTo(row.grossUnpaid - row.futureRecoveries, 12);
    }
    expect(net.totals.netUltimate).toBeCloseTo(
      net.totals.grossUltimate - net.totals.ultimateRecoveries,
      10,
    );
    expect(net.totals.netUnpaid).toBeCloseTo(
      net.totals.grossUnpaid - net.totals.futureRecoveries,
      10,
    );
  });

  it("triangleAlgebra identity: same selections -> net equals CL on the difference triangle", () => {
    const selections = { selected: [1.8, 1.1], tailFactor: 1 };
    const sameFactorRecoveries = runSalvageSubro(recoveryTri, selections);
    const netted = netOfRecoveries(gross, sameFactorRecoveries);
    const differenceCl = runChainLadder(subtractTriangles(grossTri, recoveryTri), selections);
    netted.rows.forEach((row, i) => {
      expect(row.netUltimate).toBeCloseTo(differenceCl.rows[i]!.ultimate, 10);
      expect(row.netUnpaid).toBeCloseTo(differenceCl.rows[i]!.unpaid, 10);
    });
    expect(netted.totals.netUltimate).toBeCloseTo(differenceCl.totals.ultimate, 10);
    expect(netted.totals.netUnpaid).toBeCloseTo(differenceCl.totals.unpaid, 10);
  });

  it("excludes (with warnings) origins missing on either side - never fabricates", () => {
    const shortRecoveryTri = triangleFromGrid("paid", ["2023", "2024"], AGES, [
      [10, 25, 30],
      [12, 30, null],
    ]);
    const shortRecoveries = runSalvageSubro(shortRecoveryTri, {
      selected: [2.5, 1.2],
      tailFactor: 1,
    });
    const partial = netOfRecoveries(gross, shortRecoveries);
    expect(partial.rows.map((r) => r.origin)).toEqual(["2023", "2024"]);
    expect(partial.warnings.join("\n")).toContain("2025 has no recovery projection");
    expect(partial.totals.grossUltimate).toBeCloseTo(200 + 231, 10);

    const shortGrossTri = triangleFromGrid("paid", ["2023"], AGES, [[100, 180, 200]]);
    const shortGross = runChainLadder(shortGrossTri, { selected: [1.8, 1.1], tailFactor: 1 });
    const partial2 = netOfRecoveries(shortGross, recoveries);
    expect(partial2.rows.map((r) => r.origin)).toEqual(["2023"]);
    const text = partial2.warnings.join("\n");
    expect(text).toContain("2024 has a recovery projection but no gross result");
    expect(text).toContain("2025 has a recovery projection but no gross result");
  });

  it("throws NO_DATA when the projections share no origin", () => {
    const otherGrossTri = triangleFromGrid("paid", ["2019"], AGES, [[100, 180, 200]]);
    const otherGross = runChainLadder(otherGrossTri, { selected: [1.8, 1.1], tailFactor: 1 });
    expectCode("NO_DATA", () => netOfRecoveries(otherGross, recoveries));
  });

  it("warns when projected recoveries exceed the gross (negative net)", () => {
    const bigRecoveryTri = triangleFromGrid("paid", ["2025"], AGES, [[80, null, null]]);
    const bigRecoveries = runSalvageSubro(bigRecoveryTri, { selected: [2.5, 1.2], tailFactor: 1 });
    const smallGrossTri = triangleFromGrid("paid", ["2025"], AGES, [[90, null, null]]);
    const smallGross = runChainLadder(smallGrossTri, { selected: [1.5, 1.1], tailFactor: 1 });
    // Gross ultimate 90 x 1.65 = 148.5 < recovery ultimate 80 x 3 = 240.
    const result = netOfRecoveries(smallGross, bigRecoveries);
    expect(result.rows[0]!.netUltimate).toBeCloseTo(148.5 - 240, 10);
    expect(result.warnings.join("\n")).toContain("recoveries exceed gross losses");
  });
});
