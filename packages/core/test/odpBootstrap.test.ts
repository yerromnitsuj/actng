import { describe, expect, it } from "vitest";
import { odpFit, runOdpBootstrap } from "../src/odpBootstrap.js";
import { runChainLadder } from "../src/chainladder.js";
import { computeDevelopmentFactors } from "../src/factors.js";
import { taylorAshe } from "./fixtures/mack1993.js";
import { raa } from "./fixtures/mack1994raa.js";
import type { Triangle } from "../src/types.js";

function vwReserves(tri: Triangle): { total: number; byOrigin: Map<string, number> } {
  const selected = computeDevelopmentFactors(tri).averages.find((a) => a.spec.key === "all-wtd")!
    .values;
  const cl = runChainLadder(tri, { selected, tailFactor: 1 });
  return {
    total: cl.totals.unpaid,
    byOrigin: new Map(cl.rows.map((r) => [r.origin, r.unpaid])),
  };
}

describe("odpFit (the GLM == chain ladder identity)", () => {
  it("reproduces the volume-weighted chain ladder reserves exactly on Taylor/Ashe", () => {
    const fit = odpFit(taylorAshe);
    const cl = vwReserves(taylorAshe);
    // England (2002) Table 1: chain ladder total 18,681 (thousands).
    expect(cl.total / 1000).toBeCloseTo(18681, 0);
    for (const row of fit.reserveByOrigin) {
      expect(row.reserve).toBeCloseTo(cl.byOrigin.get(row.origin)!, 6);
    }
    const totalFit = fit.reserveByOrigin.reduce((a, r) => a + r.reserve, 0);
    expect(totalFit).toBeCloseTo(cl.total, 6);
  });

  it("reproduces the chain ladder on RAA too (different shape, incurred)", () => {
    const fit = odpFit(raa);
    const cl = vwReserves(raa);
    const totalFit = fit.reserveByOrigin.reduce((a, r) => a + r.reserve, 0);
    expect(totalFit).toBeCloseTo(cl.total, 6);
  });

  it("uses n = I(I+1)/2 observations and p = 2I - 1 parameters on a full triangle", () => {
    const fit = odpFit(taylorAshe);
    expect(fit.n).toBe(55);
    expect(fit.p).toBe(19);
    expect(fit.phi).toBeGreaterThan(0);
  });

  it("fitted past incrementals reproduce the observed row sums (Poisson marginals)", () => {
    // The cross-classified ODP fit preserves row totals of the observed
    // triangle: sum of fitted incrementals in a row equals the observed
    // latest cumulative (the backwards recursion anchors there).
    const fit = odpFit(taylorAshe);
    taylorAshe.values.forEach((row, i) => {
      const observed = row.filter((v): v is number => v !== null);
      if (observed.length === 0) return;
      const latest = observed[observed.length - 1]!;
      const fittedSum = fit.fittedIncrementals[i]!.reduce<number>(
        (a, v) => a + (v ?? 0),
        0,
      );
      expect(fittedSum).toBeCloseTo(latest, 6);
    });
  });
});

describe("runOdpBootstrap", () => {
  const N = 10_000;
  const result = runOdpBootstrap(taylorAshe, { nSims: N, seed: 20260717 });

  it("is deterministic under the seed", () => {
    const again = runOdpBootstrap(taylorAshe, { nSims: 500, seed: 7 });
    const again2 = runOdpBootstrap(taylorAshe, { nSims: 500, seed: 7 });
    expect(again.total.mean).toBe(again2.total.mean);
    expect(again.total.sd).toBe(again2.total.sd);
    expect(again.totalSamples).toEqual(again2.totalSamples);
  });

  it("bootstrap mean ties to the chain ladder total within the known small bias", () => {
    // England (2002) Table 1 prints means of 18,690/18,688 vs CL 18,681 at
    // 1000 sims (SE of the mean ~0.5%, so those runs cannot resolve bias
    // below ~1%). The refit step is a ratio of noisy sums, so a small
    // upward Jensen bias is inherent; E&V's own guidance is to CHECK the
    // mean against the chain ladder, which is why fit.reserveByOrigin is
    // carried in the result. Allow 2%.
    const cl = vwReserves(taylorAshe);
    expect(Math.abs(result.total.mean - cl.total) / cl.total).toBeLessThan(0.02);
  });

  it("total prediction error ~16% of reserves (England 2002 Table 2)", () => {
    const cl = vwReserves(taylorAshe);
    const pe = result.total.sd / cl.total;
    expect(pe).toBeGreaterThan(0.135);
    expect(pe).toBeLessThan(0.185);
  });

  it("per-origin prediction errors track the published pattern (England 2002 Table 2)", () => {
    // Published percentages (analytic | bootstrap): i=5: 31, i=8: 20/21, i=10: 43/44.
    const cl = vwReserves(taylorAshe);
    const peOf = (origin: string): number => {
      const row = result.byOrigin.find((r) => r.origin === origin)!;
      return row.summary.sd / cl.byOrigin.get(origin)!;
    };
    expect(peOf("5")).toBeGreaterThan(0.26);
    expect(peOf("5")).toBeLessThan(0.36);
    expect(peOf("8")).toBeGreaterThan(0.16);
    expect(peOf("8")).toBeLessThan(0.26);
    expect(peOf("10")).toBeGreaterThan(0.37);
    expect(peOf("10")).toBeLessThan(0.50);
  });

  it("the predictive distribution is right-skewed with sane percentiles (England 2002 Table 3)", () => {
    // Published (1000 sims, thousands): mean 18,688, sd 2,956, p50 18,532,
    // p95 23,827 — p50 < mean (right skew), p95 within ~1.3 sd bands.
    expect(result.total.percentiles["p50"]!).toBeLessThan(result.total.mean);
    const p95 = result.total.percentiles["p95"]!;
    expect(p95 / 1000).toBeGreaterThan(22000);
    expect(p95 / 1000).toBeLessThan(26000);
  });

  it("without process variance, simulated SE shrinks (estimation error only)", () => {
    const noProcess = runOdpBootstrap(taylorAshe, {
      nSims: 4000,
      seed: 11,
      processVariance: false,
    });
    expect(noProcess.total.sd).toBeLessThan(result.total.sd);
  });

  it("rejects tiny simulation counts", () => {
    expect(() => runOdpBootstrap(taylorAshe, { nSims: 10, seed: 1 })).toThrowError(/nSims/);
  });
});
