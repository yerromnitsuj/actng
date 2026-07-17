import { describe, expect, it } from "vitest";
import { clarkGrowth, runClarkCapeCod, runClarkLdf } from "../src/clark.js";
import { ReservingError } from "../src/types.js";
import type { Triangle } from "../src/types.js";
import {
  clarkCapeCodPublished,
  clarkLdfLoglogisticPublished,
  clarkLdfWeibullPublished,
  clarkOnlevelPremium,
  clarkTriangle,
} from "./fixtures/clark2003.js";

/**
 * Published-value validation against Clark (2003), Section 4 (pp. 59-69).
 *
 * Tolerances: fitted omega/theta within 0.5% relative (optimizer-dependent),
 * reserve totals within 0.3%, per-AY spot reserves within 1%, sigma^2 within
 * 2%, process SDs within 1%, parameter/total SDs within 5% (numerical-Hessian
 * dependent). The implementation actually lands within ~0.01% of every pin;
 * the tolerances leave room for optimizer/finite-difference drift only.
 */

function expectRelClose(actual: number, expected: number, relTol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(relTol * Math.abs(expected));
}

function row(result: ReturnType<typeof runClarkLdf>, origin: string) {
  const found = result.rows.find((r) => r.origin === origin);
  if (!found) throw new Error(`missing row ${origin}`);
  return found;
}

describe("Clark (2003) LDF method, loglogistic (pp. 61-63, untruncated)", () => {
  const published = clarkLdfLoglogisticPublished;
  const result = runClarkLdf(clarkTriangle, { curve: "loglogistic" });

  it("reproduces the published MLE parameters", () => {
    expectRelClose(result.omega, published.omega, 0.005);
    expectRelClose(result.theta, published.theta, 0.005);
  });

  it("reproduces the published dispersion sigma^2 with 43 dof", () => {
    expectRelClose(result.sigma2, published.sigma2, 0.02);
    expect(result.dof).toBe(published.dof);
  });

  it("reproduces the published total reserve and ultimate", () => {
    expectRelClose(result.totals.reserve, published.untruncated.totalReserve, 0.003);
    const totalUltimate = result.rows.reduce((a, r) => a + r.ultimate, 0);
    expectRelClose(totalUltimate, published.untruncated.totalUltimate, 0.003);
  });

  it("reproduces the published per-AY spot rows", () => {
    const r1991 = row(result, "1991");
    const pins = published.untruncated.rows;
    expect(Math.abs(r1991.growthAtAge - pins["1991"].growthAtAge)).toBeLessThanOrEqual(0.0005);
    expectRelClose(r1991.ultimate, pins["1991"].ultimate, 0.01);
    expectRelClose(r1991.reserve, pins["1991"].reserve, 0.01);
    expectRelClose(row(result, "1996").reserve, pins["1996"].reserve, 0.01);
    const r2000 = row(result, "2000");
    expect(Math.abs(r2000.growthAtAge - pins["2000"].growthAtAge)).toBeLessThanOrEqual(0.0005);
    expectRelClose(r2000.reserve, pins["2000"].reserve, 0.01);
  });

  it("warns that untruncated reserves rely on tail extrapolation", () => {
    expect(result.warnings.some((w) => w.includes("truncat"))).toBe(true);
  });
});

describe("Clark (2003) LDF method, loglogistic truncated at 240 months (pp. 64-65)", () => {
  const published = clarkLdfLoglogisticPublished;
  const pins = published.truncatedAt240;
  const result = runClarkLdf(clarkTriangle, { curve: "loglogistic", truncationAgeMonths: 240 });

  it("reproduces the published truncated total reserve", () => {
    expectRelClose(result.totals.reserve, pins.totalReserve, 0.003);
    const totalLossesAt240 = result.rows.reduce((a, r) => a + r.ultimate, 0);
    expectRelClose(totalLossesAt240, pins.totalLossesAt240, 0.003);
  });

  it("reproduces the published 1991 truncated LDF 1.1716 = G(234)/G(114)", () => {
    const r1991 = row(result, "1991");
    // ultimate/latest is the truncated LDF for a hole-free LDF-method row.
    expectRelClose(r1991.ultimate / r1991.latest, pins.rows["1991"].truncatedLdf, 0.001);
    expectRelClose(r1991.ultimate, pins.rows["1991"].ultimateAt240, 0.01);
    expectRelClose(r1991.reserve, pins.rows["1991"].reserve, 0.01);
    expectRelClose(row(result, "1996").reserve, pins.rows["1996"].reserve, 0.01);
    expectRelClose(row(result, "2000").reserve, pins.rows["2000"].reserve, 0.01);
  });

  it("reproduces the published variance table (p. 65)", () => {
    expectRelClose(result.totals.processSd, pins.processSdTotal, 0.01);
    expectRelClose(result.totals.parameterSd, pins.parameterSdTotal, 0.05);
    expectRelClose(result.totals.totalSd, pins.totalSdTotal, 0.05);
    const r1991 = row(result, "1991");
    expectRelClose(r1991.processSd, pins.rows["1991"].processSd, 0.01);
    expectRelClose(r1991.parameterSd, pins.rows["1991"].parameterSd, 0.05);
    expectRelClose(r1991.totalSd, pins.rows["1991"].totalSd, 0.05);
    const r2000 = row(result, "2000");
    expectRelClose(r2000.processSd, pins.rows["2000"].processSd, 0.01);
    expectRelClose(r2000.parameterSd, pins.rows["2000"].parameterSd, 0.05);
  });
});

describe("Clark (2003) LDF method, Weibull (pp. 64-65)", () => {
  const published = clarkLdfWeibullPublished;
  const result = runClarkLdf(clarkTriangle, { curve: "weibull" });

  it("reproduces the published MLE parameters", () => {
    expectRelClose(result.omega, published.omega, 0.005);
    expectRelClose(result.theta, published.theta, 0.005);
  });

  it("reproduces the published totals", () => {
    expectRelClose(result.totals.reserve, published.untruncated.totalReserve, 0.003);
    const totalUltimate = result.rows.reduce((a, r) => a + r.ultimate, 0);
    expectRelClose(totalUltimate, published.untruncated.totalUltimate, 0.003);
  });

  it("reproduces the published per-AY spot rows", () => {
    const pins = published.untruncated.rows;
    const r1991 = row(result, "1991");
    expect(Math.abs(r1991.growthAtAge - pins["1991"].growthAtAge)).toBeLessThanOrEqual(0.0005);
    expectRelClose(r1991.reserve, pins["1991"].reserve, 0.01);
    expectRelClose(row(result, "1996").reserve, pins["1996"].reserve, 0.01);
    const r2000 = row(result, "2000");
    expect(Math.abs(r2000.growthAtAge - pins["2000"].growthAtAge)).toBeLessThanOrEqual(0.0005);
    expectRelClose(r2000.reserve, pins["2000"].reserve, 0.01);
  });
});

describe("Clark (2003) Cape Cod method, loglogistic truncated at 240 (pp. 66-69)", () => {
  const published = clarkCapeCodPublished;
  const pins = published.truncatedAt240;
  const result = runClarkCapeCod(clarkTriangle, clarkOnlevelPremium, {
    curve: "loglogistic",
    truncationAgeMonths: 240,
  });

  it("reproduces the published MLE parameters and ELR", () => {
    expectRelClose(result.omega, published.omega, 0.005);
    expectRelClose(result.theta, published.theta, 0.005);
    expect(result.elr).toBeDefined();
    expectRelClose(result.elr!, published.elr, 0.005);
  });

  it("reproduces the published dispersion sigma^2 with 52 dof", () => {
    expectRelClose(result.sigma2, published.sigma2, 0.02);
    expect(result.dof).toBe(published.dof);
  });

  it("reproduces the published total reserve", () => {
    expectRelClose(result.totals.reserve, pins.totalReserve, 0.003);
  });

  it("reproduces the published per-AY spot rows", () => {
    const r1991 = row(result, "1991");
    expect(Math.abs(r1991.growthAtAge - pins.rows["1991"].growthAtAge)).toBeLessThanOrEqual(0.0005);
    expectRelClose(r1991.reserve, pins.rows["1991"].reserve, 0.01);
    expectRelClose(row(result, "1996").reserve, pins.rows["1996"].reserve, 0.01);
    const r2000 = row(result, "2000");
    expect(Math.abs(r2000.growthAtAge - pins.rows["2000"].growthAtAge)).toBeLessThanOrEqual(0.0005);
    expectRelClose(r2000.reserve, pins.rows["2000"].reserve, 0.01);
  });

  it("reproduces the published variance table (p. 69)", () => {
    expectRelClose(result.totals.processSd, pins.processSdTotal, 0.01);
    expectRelClose(result.totals.parameterSd, pins.parameterSdTotal, 0.05);
    expectRelClose(result.totals.totalSd, pins.totalSdTotal, 0.05);
    const r1991 = row(result, "1991");
    expectRelClose(r1991.processSd, pins.rows["1991"].processSd, 0.01);
    expectRelClose(r1991.parameterSd, pins.rows["1991"].parameterSd, 0.05);
    expectRelClose(r1991.totalSd, pins.rows["1991"].totalSd, 0.05);
    expectRelClose(row(result, "2000").parameterSd, pins.rows["2000"].parameterSd, 0.05);
  });
});

describe("Clark growth-curve and method properties", () => {
  it("G is monotone increasing from 0 toward 1 for both curves", () => {
    for (const curve of ["loglogistic", "weibull"] as const) {
      const g = clarkGrowth(curve, 1.4, 48);
      expect(g(0)).toBe(0);
      expect(g(-12)).toBe(0);
      // Strictly increasing over the working range; beyond it the Weibull
      // saturates at 1 within double precision, so only non-decrease holds.
      let prev = 0;
      for (let x = 6; x <= 360; x += 6) {
        const value = g(x);
        expect(value).toBeGreaterThan(prev);
        expect(value).toBeLessThan(1);
        prev = value;
      }
      for (let x = 366; x <= 1200; x += 6) {
        const value = g(x);
        expect(value).toBeGreaterThanOrEqual(prev);
        expect(value).toBeLessThanOrEqual(1);
        prev = value;
      }
      expect(g(1e9)).toBeGreaterThan(0.999);
    }
  });

  it("clarkGrowth rejects non-positive parameters", () => {
    expect(() => clarkGrowth("loglogistic", 0, 48)).toThrowError(ReservingError);
    expect(() => clarkGrowth("weibull", 1.4, -1)).toThrowError(ReservingError);
  });

  it("LDF ultimates satisfy the profiled-MLE identity ULT_i = latest / G(x_i)", () => {
    // dl/dULT_i = 0 gives ULT_i = sum_t c_it / sum_t dG_it, which telescopes
    // to latest / G(x_i) on a contiguous row; ultimate = latest + reserve
    // must land exactly there.
    const result = runClarkLdf(clarkTriangle, { curve: "loglogistic" });
    for (const r of result.rows) {
      expectRelClose(r.ultimate, r.latest / r.growthAtAge, 1e-9);
    }
  });

  it("truncation reduces every origin's reserve", () => {
    const full = runClarkLdf(clarkTriangle, { curve: "loglogistic" });
    const truncated = runClarkLdf(clarkTriangle, {
      curve: "loglogistic",
      truncationAgeMonths: 240,
    });
    truncated.rows.forEach((r, i) => {
      expect(r.reserve).toBeLessThan(full.rows[i]!.reserve);
    });
    expect(truncated.totals.reserve).toBeLessThan(full.totals.reserve);
    expect(truncated.warnings.some((w) => w.includes("extrapolate"))).toBe(false);
  });

  it("the Weibull tail is lighter than the loglogistic on the same data", () => {
    const loglogistic = runClarkLdf(clarkTriangle, { curve: "loglogistic" });
    const weibull = runClarkLdf(clarkTriangle, { curve: "weibull" });
    expect(row(weibull, "1991").reserve).toBeLessThan(row(loglogistic, "1991").reserve);
    expect(weibull.totals.reserve).toBeLessThan(loglogistic.totals.reserve);
  });

  it("rejects quarterly triangles (annual cadence only)", () => {
    const quarterly: Triangle = {
      kind: "paid",
      origins: ["2023Q1", "2023Q2", "2023Q3"],
      ages: [3, 6, 9],
      values: [
        [100, 180, 230],
        [110, 190, null],
        [120, null, null],
      ],
    };
    let thrown: unknown;
    try {
      runClarkLdf(quarterly, { curve: "loglogistic" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ReservingError);
    expect((thrown as ReservingError).code).toBe("SHAPE");
    expect((thrown as ReservingError).message).toContain("annual cadence");
  });

  it("rejects a truncation age inside the observed history", () => {
    let thrown: unknown;
    try {
      runClarkLdf(clarkTriangle, { curve: "loglogistic", truncationAgeMonths: 60 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ReservingError);
    expect((thrown as ReservingError).code).toBe("BAD_TAIL");
  });

  it("Cape Cod requires a positive premium for every origin", () => {
    const missingOne = clarkOnlevelPremium.slice(1);
    let thrown: unknown;
    try {
      runClarkCapeCod(clarkTriangle, missingOne, { curve: "loglogistic" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ReservingError);
    expect((thrown as ReservingError).code).toBe("BAD_PREMIUM");
  });
});
