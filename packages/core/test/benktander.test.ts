import {
  registerSourceFile,
  sourceExpected,
  sourceTolerance,
} from "../../../tools/validation/source-contract.js";

import { describe, expect, it } from "vitest";
import { runChainLadder } from "../src/chainladder.js";
import { runBornhuetterFerguson } from "../src/bf.js";
import { runBenktander } from "../src/benktander.js";
import { computeDevelopmentFactors } from "../src/factors.js";
import type { ExposureRecord, Triangle } from "../src/types.js";
import { taylorAshe } from "./fixtures/mack1993.js";
import { mack2000Inputs } from "./fixtures/mack2000.js";

function volumeWeighted(tri: Triangle): (number | null)[] {
  return computeDevelopmentFactors(tri).averages.find(
    (a) => a.spec.key === "all-wtd",
  )!.values;
}

const exposures: ExposureRecord[] = taylorAshe.origins.map((origin) => ({
  origin,
  earnedPremium: 6_000_000,
  exposureUnits: null,
}));

describe("Benktander-Hovinen (Mack 2000)", () => {
  const cl = runChainLadder(taylorAshe, {
    selected: volumeWeighted(taylorAshe),
    tailFactor: 1,
  });
  const bf = runBornhuetterFerguson(taylorAshe, cl, exposures);
  const gb = runBenktander(cl, bf);

  it("is BF iterated once: U_GB = latest + (1 - 1/CDF) x U_BF, row for row", () => {
    for (const row of gb.rows) {
      const bfRow = bf.rows.find((r) => r.origin === row.origin)!;
      const q = 1 - 1 / bfRow.cdf;
      expect(row.ultimate).toBeCloseTo(
        bfRow.latestValue + q * bfRow.ultimate,
        sourceTolerance("mack-2000-benktander", "decimalPlaces:6"),
      );
    }
  });

  it("equals the credibility blend (1-q) x U_CL + q x U_BF", () => {
    for (const row of gb.rows) {
      const clRow = cl.rows.find((r) => r.origin === row.origin)!;
      const bfRow = bf.rows.find((r) => r.origin === row.origin)!;
      const q = 1 - 1 / bfRow.cdf;
      expect(row.ultimate).toBeCloseTo(
        (1 - q) * clRow.ultimate + q * bfRow.ultimate,
        sourceTolerance("mack-2000-benktander", "decimalPlaces:6"),
      );
    }
  });

  it("collapses toward the chain ladder as maturity approaches (q -> 0)", () => {
    // The oldest origin is fully developed under a flat tail: cdf = 1, q = 0.
    const oldest = gb.rows[0]!;
    const clRow = cl.rows[0]!;
    expect(oldest.credibilityZ).toBeCloseTo(
      sourceExpected<number>("mack-2000-benktander", "literal:1"),
      sourceTolerance("mack-2000-benktander", "decimalPlaces:9"),
    );
    expect(oldest.ultimate).toBeCloseTo(
      clRow.ultimate,
      sourceTolerance("mack-2000-benktander", "decimalPlaces:6"),
    );
  });

  it("lies between CL and BF on every row (a credibility mixture)", () => {
    for (const row of gb.rows) {
      const clRow = cl.rows.find((r) => r.origin === row.origin)!;
      const bfRow = bf.rows.find((r) => r.origin === row.origin)!;
      const lo = Math.min(clRow.ultimate, bfRow.ultimate) - 1e-6;
      const hi = Math.max(clRow.ultimate, bfRow.ultimate) + 1e-6;
      expect(row.ultimate).toBeGreaterThanOrEqual(lo);
      expect(row.ultimate).toBeLessThanOrEqual(hi);
    }
  });

  it("totals are the sum of rows and carry BF's coverage (not the triangle's)", () => {
    const sum = gb.rows.reduce((a, r) => a + r.ultimate, 0);
    expect(gb.totals.ultimate).toBeCloseTo(
      sum,
      sourceTolerance("mack-2000-benktander", "decimalPlaces:6"),
    );
    expect(gb.rows.length).toBe(bf.rows.length);
  });

  it("reproduces Mack (2000) Section 4's published numerical example", () => {
    // As printed (all relative to premium = 100): a-priori U_0 = 90%,
    // payout ratio p_k = 0.50 (CDF = 2), paid to date C_k = 55%.
    // Printed results: R_BF = 45, U_CL = 110, R_CL = 55, R_GB = 50.
    const {
      premium,
      priorUltimate,
      paidToDate,
      percentDeveloped,
      chainLadderUltimate,
      bornhuetterFergusonReserve,
    } = mack2000Inputs;
    const published = sourceExpected<
      typeof import("./fixtures/mack2000.js").mack2000Published
    >("mack-2000-benktander", "mack2000Published");
    const clFixture = {
      method: "chainLadder",
      basis: "paid",
      rows: [
        {
          origin: "1",
          latestAge: 36,
          latestValue: paidToDate,
          cdf: 1 / percentDeveloped,
          percentDeveloped,
          ultimate: chainLadderUltimate,
          unpaid: chainLadderUltimate - paidToDate,
        },
      ],
      totals: {
        latest: paidToDate,
        ultimate: chainLadderUltimate,
        unpaid: chainLadderUltimate - paidToDate,
      },
      warnings: [],
    } as never;
    const bfFixture = {
      method: "bornhuetterFerguson",
      basis: "paid",
      rows: [
        {
          origin: "1",
          latestValue: paidToDate,
          cdf: 1 / percentDeveloped,
          aprioriLossRatio: priorUltimate / premium,
          earnedPremium: premium,
          expectedUltimate: priorUltimate,
          expectedUnreported: bornhuetterFergusonReserve,
          ultimate: paidToDate + bornhuetterFergusonReserve,
          unpaid: bornhuetterFergusonReserve,
        },
      ],
      totals: {
        latest: paidToDate,
        ultimate: paidToDate + bornhuetterFergusonReserve,
        unpaid: bornhuetterFergusonReserve,
      },
      warnings: [],
    } as never;
    const result = runBenktander(clFixture, bfFixture);
    expect(result.rows[0]!.ultimate).toBeCloseTo(
      published.ultimate,
      sourceTolerance("mack-2000-benktander", "decimalPlaces:9"),
    );
    expect(result.rows[0]!.unpaid).toBeCloseTo(
      published.reserve,
      sourceTolerance("mack-2000-benktander", "decimalPlaces:9"),
    );
    expect(result.rows[0]!.credibilityZ).toBeCloseTo(
      published.credibility,
      sourceTolerance("mack-2000-benktander", "decimalPlaces:9"),
    );
    // Mack's ultimate-level credibility identity: U_GB = (1-q^2) U_CL + q^2 U_0.
    expect(result.rows[0]!.ultimate).toBeCloseTo(
      0.75 * 110 + 0.25 * 90,
      sourceTolerance("mack-2000-benktander", "decimalPlaces:9"),
    );
  });

  it("throws SHAPE when a BF origin is missing from the chain ladder result", () => {
    const clMissing = { ...cl, rows: cl.rows.slice(1) };
    expect(() => runBenktander(clMissing, bf)).toThrowError(/SHAPE|missing/i);
  });
});

registerSourceFile(import.meta.url);
