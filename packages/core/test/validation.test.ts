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

describe("Mack on the selected basis (selected factors + tail)", () => {
  it("is identical to Mack (1993) when the selections ARE the volume-weighted factors and there is no tail", () => {
    const base = runMack(taylorAshe);
    const selected = runMack(taylorAshe, {
      selected: base.developmentFactors,
      tailFactor: 1,
    });
    base.rows.forEach((row, i) => {
      expect(selected.rows[i]!.ultimate).toBeCloseTo(row.ultimate, 6);
      expect(selected.rows[i]!.standardError).toBeCloseTo(row.standardError, 6);
    });
    expect(selected.totals.standardError).toBeCloseTo(base.totals.standardError, 6);
  });

  it("reproduces the Mack (1999) published ultimates through runMack with the 1.05 tail", () => {
    const mack = runMack(mortgage, { tailFactor: mortgagePublished.tailFactor });
    const { ultimatesWithTailIn1000s, totalUltimateWithTailIn1000s } = mortgagePublished;
    ultimatesWithTailIn1000s.forEach((published, idx) => {
      expect(Math.abs(mack.rows[idx]!.ultimate / 1000 - published)).toBeLessThanOrEqual(2);
    });
    expect(
      Math.abs(mack.totals.ultimate / 1000 - totalUltimateWithTailIn1000s),
    ).toBeLessThanOrEqual(5);
  });

  it("agrees with the chain ladder's ultimates row for row on the same selections and tail", () => {
    const selections = volumeWeightedSelections(taylorAshe).map((v) =>
      v === null ? null : v * 1.01,
    );
    const cl = runChainLadder(taylorAshe, { selected: selections, tailFactor: 1.03 });
    const mack = runMack(taylorAshe, { selected: selections, tailFactor: 1.03 });
    cl.rows.forEach((row, i) => {
      expect(mack.rows[i]!.ultimate).toBeCloseTo(row.ultimate, 6);
      expect(mack.rows[i]!.reserve).toBeCloseTo(row.unpaid, 6);
    });
    expect(mack.totals.ultimate).toBeCloseTo(cl.totals.ultimate, 6);
  });

  it("a tail strictly increases the total standard error and flags the approximation", () => {
    const noTail = runMack(taylorAshe);
    const withTail = runMack(taylorAshe, { tailFactor: 1.05 });
    expect(withTail.totals.standardError).toBeGreaterThan(noTail.totals.standardError);
    expect(withTail.totals.reserve).toBeGreaterThan(noTail.totals.reserve);
    expect(withTail.tailFactor).toBe(1.05);
    expect(withTail.sigmaSquaredTail).toBeGreaterThan(0);
    expect(withTail.warnings.some((w) => w.includes("tail step"))).toBe(true);
  });
});
