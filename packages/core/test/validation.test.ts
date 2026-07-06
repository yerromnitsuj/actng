import { describe, expect, it } from "vitest";
import { computeDevelopmentFactors } from "../src/factors.js";
import { runChainLadder } from "../src/chainladder.js";
import { runMack } from "../src/mack.js";
import {
  mortgage,
  mortgagePublished,
  taylorAshe,
  taylorAshePublished,
} from "./fixtures/mack1993.js";
import type { Triangle } from "../src/types.js";

/**
 * Published-dataset validation (the build is not done until these pass).
 *
 * Reproduces Mack (1993) Tables 1-6 and Mack (1999) Tables 1-2:
 * chain ladder factors, reserves, Mack sigma^2 and standard errors on the
 * Taylor/Ashe and mortgage-guarantee triangles, and ultimates under the
 * published 1.05 tail.
 */

function volumeWeightedSelections(tri: Triangle): (number | null)[] {
  const dev = computeDevelopmentFactors(tri);
  const allWtd = dev.averages.find((a) => a.spec.key === "all-wtd");
  if (!allWtd) throw new Error("missing all-year volume-weighted average");
  return allWtd.values;
}

describe("Mack (1993) Table 1: Taylor/Ashe chain ladder", () => {
  const selections = volumeWeightedSelections(taylorAshe);

  it("reproduces the published development factors", () => {
    const { factors, factorTolerance } = taylorAshePublished;
    expect(selections).toHaveLength(factors.length);
    factors.forEach((published, k) => {
      expect(selections[k]).not.toBeNull();
      expect(Math.abs(selections[k]! - published)).toBeLessThanOrEqual(factorTolerance[k]!);
    });
  });

  it("reproduces the published chain ladder reserves by origin and in total", () => {
    const result = runChainLadder(taylorAshe, { selected: selections, tailFactor: 1 });
    expect(result.warnings).toHaveLength(0);
    const { reservesIn1000s, totalReserveIn1000s } = taylorAshePublished;
    // Origins 2..10 (origin 1 is fully developed, reserve 0).
    reservesIn1000s.forEach((published, idx) => {
      const row = result.rows[idx + 1]!;
      expect(Math.abs(row.unpaid / 1000 - published)).toBeLessThanOrEqual(1);
    });
    expect(Math.abs(result.totals.unpaid / 1000 - totalReserveIn1000s)).toBeLessThanOrEqual(2);
  });
});

describe("Mack (1993) Tables 1-3: Taylor/Ashe standard errors", () => {
  const result = runMack(taylorAshe);

  it("reproduces the published sigma^2 estimates including the extrapolated last value", () => {
    const { sigma2Over1000 } = taylorAshePublished;
    expect(result.sigmaSquared).toHaveLength(sigma2Over1000.length);
    sigma2Over1000.forEach((published, k) => {
      const computed = result.sigmaSquared[k]! / 1000;
      expect(Math.abs(computed - published)).toBeLessThanOrEqual(
        Math.max(0.01, published * 0.01),
      );
    });
  });

  it("reproduces the published standard errors as % of reserve", () => {
    const { sePercent, totalSePercent } = taylorAshePublished;
    sePercent.forEach((published, idx) => {
      const row = result.rows[idx + 1]!;
      const pct = (row.standardError / row.reserve) * 100;
      expect(Math.abs(pct - published)).toBeLessThanOrEqual(1);
    });
    const totalPct = (result.totals.standardError / result.totals.reserve) * 100;
    expect(Math.abs(totalPct - totalSePercent)).toBeLessThanOrEqual(1);
  });
});

describe("Mack (1993) Tables 4-6: mortgage guarantee data", () => {
  const selections = volumeWeightedSelections(mortgage);
  const result = runMack(mortgage);

  it("reproduces the published development factors", () => {
    const { factors, factorTolerance } = mortgagePublished;
    factors.forEach((published, k) => {
      expect(selections[k]).not.toBeNull();
      expect(Math.abs(selections[k]! - published)).toBeLessThanOrEqual(factorTolerance[k]!);
    });
  });

  it("reproduces the published sigma^2 estimates", () => {
    const { sigma2Over1000 } = mortgagePublished;
    sigma2Over1000.forEach((published, k) => {
      const computed = result.sigmaSquared[k]! / 1000;
      expect(Math.abs(computed - published)).toBeLessThanOrEqual(
        Math.max(0.01, published * 0.01),
      );
    });
  });

  it("reproduces the published chain ladder reserves", () => {
    const cl = runChainLadder(mortgage, { selected: selections, tailFactor: 1 });
    const { reservesIn1000s, totalReserveIn1000s } = mortgagePublished;
    reservesIn1000s.forEach((published, idx) => {
      const row = cl.rows[idx + 1]!;
      expect(Math.abs(row.unpaid / 1000 - published)).toBeLessThanOrEqual(1);
    });
    expect(Math.abs(cl.totals.unpaid / 1000 - totalReserveIn1000s)).toBeLessThanOrEqual(2);
  });

  it("reproduces the published standard errors as % of reserve", () => {
    const { sePercent, totalSePercent } = mortgagePublished;
    sePercent.forEach((published, idx) => {
      const row = result.rows[idx + 1]!;
      const pct = (row.standardError / row.reserve) * 100;
      expect(Math.abs(pct - published)).toBeLessThanOrEqual(1);
    });
    const totalPct = (result.totals.standardError / result.totals.reserve) * 100;
    expect(Math.abs(totalPct - totalSePercent)).toBeLessThanOrEqual(1);
  });
});

describe("Mack (1999) Tables 1-2: mortgage data with a 1.05 tail", () => {
  it("reproduces the published ultimates under the judgmental tail", () => {
    const selections = volumeWeightedSelections(mortgage);
    const cl = runChainLadder(mortgage, {
      selected: selections,
      tailFactor: mortgagePublished.tailFactor,
    });
    const { ultimatesWithTailIn1000s, totalUltimateWithTailIn1000s } = mortgagePublished;
    ultimatesWithTailIn1000s.forEach((published, idx) => {
      const row = cl.rows[idx]!;
      // Mack 1999 prints ultimates rounded to 1000s; allow rounding + factor
      // print-precision slack of 2 (in 1000s).
      expect(Math.abs(row.ultimate / 1000 - published)).toBeLessThanOrEqual(2);
    });
    expect(
      Math.abs(cl.totals.ultimate / 1000 - totalUltimateWithTailIn1000s),
    ).toBeLessThanOrEqual(5);
  });
});
