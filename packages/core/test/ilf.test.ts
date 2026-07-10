import { describe, expect, it } from "vitest";
import {
  fitSeverity,
  interpolateIlf,
  kaplanMeierQuantiles,
  validateIlfTable,
  limitedExpectedValue,
  normalCdf,
  severityMean,
  severityObservations,
  tableUncapFactor,
  uncapFactor,
  type SeverityDistribution,
  type SeverityObservation,
} from "../src/ilf.js";

/** Simpson's rule for E[X ∧ c] = ∫0..c S(x) dx (survival representation). */
function levNumeric(dist: SeverityDistribution, c: number, steps = 20000): number {
  const survival = (x: number): number => {
    if (x <= 0) return 1;
    if (dist.kind === "lognormal") {
      return 1 - normalCdf((Math.log(x) - dist.mu) / dist.sigma);
    }
    return Math.pow(dist.theta / (x + dist.theta), dist.alpha);
  };
  const h = c / steps;
  let sum = survival(0) + survival(c);
  for (let i = 1; i < steps; i++) sum += (i % 2 === 0 ? 2 : 4) * survival(i * h);
  return (sum * h) / 3;
}

describe("limited expected values", () => {
  const lognormal: SeverityDistribution = { kind: "lognormal", mu: 9.2, sigma: 1.4 };
  const pareto: SeverityDistribution = { kind: "pareto", theta: 40_000, alpha: 1.8 };

  it("lognormal LEV matches numeric integration", () => {
    for (const c of [50_000, 250_000, 1_000_000]) {
      const closed = limitedExpectedValue(lognormal, c);
      const numeric = levNumeric(lognormal, c);
      expect(Math.abs(closed - numeric) / numeric).toBeLessThan(1e-4);
    }
  });

  it("pareto LEV matches numeric integration and the alpha->1 limit is continuous", () => {
    for (const c of [50_000, 250_000, 1_000_000]) {
      const closed = limitedExpectedValue(pareto, c);
      const numeric = levNumeric(pareto, c);
      expect(Math.abs(closed - numeric) / numeric).toBeLessThan(1e-4);
    }
    // The probe must sit OUTSIDE the |alpha-1| < 1e-9 limit branch, or the
    // assertion compares the limit formula to itself and certifies nothing.
    const nearOne = limitedExpectedValue({ kind: "pareto", theta: 10_000, alpha: 1 + 1e-6 }, 100_000);
    const atOne = limitedExpectedValue({ kind: "pareto", theta: 10_000, alpha: 1 }, 100_000);
    expect(Math.abs(nearOne - atOne) / atOne).toBeLessThan(1e-4);
  });

  it("LEV increases in the limit and approaches the mean", () => {
    const m = severityMean(lognormal)!;
    let prev = 0;
    for (const c of [1e4, 1e5, 1e6, 1e7, 1e9]) {
      const lev = limitedExpectedValue(lognormal, c);
      expect(lev).toBeGreaterThan(prev);
      expect(lev).toBeLessThanOrEqual(m + 1e-9);
      prev = lev;
    }
    expect(limitedExpectedValue(lognormal, 1e12)).toBeCloseTo(m, 2);
  });

  it("uncap factor > 1, and unlimited restoration rejects infinite-mean Pareto", () => {
    expect(uncapFactor(lognormal, 250_000, null)).toBeGreaterThan(1);
    expect(uncapFactor(lognormal, 250_000, 1_000_000)).toBeGreaterThan(1);
    expect(uncapFactor(lognormal, 250_000, 1_000_000)).toBeLessThan(
      uncapFactor(lognormal, 250_000, null),
    );
    expect(() =>
      uncapFactor({ kind: "pareto", theta: 10_000, alpha: 0.9 }, 250_000, null),
    ).toThrowError(/infinite mean/i);
    expect(() => uncapFactor(lognormal, 250_000, 100_000)).toThrowError(/at or above/);
  });
});

describe("censored MLE severity fits", () => {
  /** Deterministic LCG so the test is reproducible. */
  function lcg(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it("recovers lognormal parameters from censored data", () => {
    const rand = lcg(42);
    const mu = 9.5;
    const sigma = 1.2;
    const normal = () => {
      const u1 = Math.max(rand(), 1e-12);
      const u2 = rand();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };
    const obs: SeverityObservation[] = [];
    for (let i = 0; i < 800; i++) {
      const x = Math.exp(mu + sigma * normal());
      // INDEPENDENT random right-censoring (an informative censor level -
      // e.g. a fraction of the realized value - would bias any MLE):
      // observe min(X, C) with C drawn from its own distribution.
      const c = Math.exp(mu + 0.3 + sigma * normal());
      obs.push(c < x ? { value: c, censored: true } : { value: x, censored: false });
    }
    const fit = fitSeverity(obs, "lognormal");
    expect(fit.valid).toBe(true);
    expect(fit.distribution.kind).toBe("lognormal");
    if (fit.distribution.kind === "lognormal") {
      expect(Math.abs(fit.distribution.mu - mu)).toBeLessThan(0.15);
      expect(Math.abs(fit.distribution.sigma - sigma)).toBeLessThan(0.15);
    }
    expect(fit.nCensored).toBeGreaterThan(100);
  });

  it("refuses to fit thin or censoring-dominated data", () => {
    const few: SeverityObservation[] = Array.from({ length: 5 }, (_, i) => ({
      value: 1000 * (i + 1),
      censored: false,
    }));
    expect(fitSeverity(few, "lognormal").valid).toBe(false);
    const allCensored: SeverityObservation[] = Array.from({ length: 50 }, (_, i) => ({
      value: 1000 * (i + 1),
      censored: i >= 3, // only 3 exact
    }));
    expect(fitSeverity(allCensored, "pareto").valid).toBe(false);
  });

  it("builds base-level observations with open claims censored", () => {
    const obs = severityObservations(
      [
        {
          claimId: "a",
          accidentDate: "2023-01-01",
          reportDate: "2023-01-05",
          evaluationDate: "2023-12-31",
          paidToDate: 50_000,
          caseReserve: 50_000,
          status: "open",
        },
        {
          claimId: "b",
          accidentDate: "2025-02-01",
          reportDate: "2025-02-03",
          evaluationDate: "2025-12-31",
          paidToDate: 121_000,
          caseReserve: 0,
          status: "closed",
        },
      ],
      { indexRate: 0.1, baseYear: 2025 },
    );
    const a = obs.find((o) => o.censored)!;
    // 100k at 2023 level, inflated to 2025 base: 100k / 1.1^-2 = 121k.
    expect(a.value).toBeCloseTo(121_000, 6);
    const b = obs.find((o) => !o.censored)!;
    expect(b.value).toBe(121_000);
  });
});

describe("ILF tables", () => {
  const table = [
    { limit: 100_000, factor: 1.0 },
    { limit: 250_000, factor: 1.35 },
    { limit: 1_000_000, factor: 1.9 },
  ];

  it("is exact at knots and monotone between them", () => {
    expect(interpolateIlf(table, 100_000)).toBe(1.0);
    expect(interpolateIlf(table, 250_000)).toBe(1.35);
    expect(interpolateIlf(table, 1_000_000)).toBe(1.9);
    const mid = interpolateIlf(table, 500_000);
    expect(mid).toBeGreaterThan(1.35);
    expect(mid).toBeLessThan(1.9);
  });

  it("refuses to extrapolate beyond the table and rejects bad tables", () => {
    expect(() => interpolateIlf(table, 2_000_000)).toThrowError(/outside/);
    expect(() => interpolateIlf(table, 50_000)).toThrowError(/outside/);
    expect(() =>
      interpolateIlf(
        [
          { limit: 100_000, factor: 1.2 },
          { limit: 250_000, factor: 1.0 },
        ],
        150_000,
      ),
    ).toThrowError(/non-decreasing/);
  });

  it("computes table uncap factors as an ILF ratio", () => {
    expect(tableUncapFactor(table, 250_000, 1_000_000)).toBeCloseTo(1.9 / 1.35, 9);
    expect(() => tableUncapFactor(table, 250_000, 100_000)).toThrowError(/at or above/);
  });
});

describe("fit validity gates (phase-2 review fixes)", () => {
  const open = (v: number) => ({ value: v, censored: true });
  const closed = (v: number) => ({ value: v, censored: false });

  it("refuses censoring-dominated fits (the 69,825x probe from the review)", () => {
    // 12 closed small + 28 open large: an ordinary immature casualty year.
    const obs = [
      ...Array.from({ length: 12 }, (_, i) => closed(3_000 + i * 2_000)),
      ...Array.from({ length: 28 }, (_, i) => open(80_000 + i * 15_000)),
    ];
    const fit = fitSeverity(obs, "lognormal");
    // 70% censored passes the 80% share gate, so the sigma sanity gate must catch it.
    expect(fit.valid).toBe(false);
    expect(fit.warnings.join(" ")).toMatch(/sigma|censoring/i);
  });

  it("refuses fits with censored share above 80% outright", () => {
    const obs = [
      ...Array.from({ length: 5 }, (_, i) => closed(10_000 + i * 1_000)),
      ...Array.from({ length: 30 }, (_, i) => open(50_000 + i * 5_000)),
    ];
    const fit = fitSeverity(obs, "lognormal");
    expect(fit.valid).toBe(false);
    expect(fit.warnings.join(" ")).toMatch(/censoring-dominated/);
  });

  it("marks Pareto alpha <= 1 invalid for restoration at ANY target", () => {
    // Heavy censored mass drives alpha below 1 on this shape.
    const obs = [
      ...Array.from({ length: 10 }, (_, i) => closed(2_000 + i * 500)),
      ...Array.from({ length: 20 }, (_, i) => open(100_000 + i * 40_000)),
    ];
    const fit = fitSeverity(obs, "pareto");
    if (fit.distribution.kind === "pareto" && fit.distribution.alpha <= 1) {
      expect(fit.valid).toBe(false);
      expect(fit.warnings.join(" ")).toMatch(/alpha/);
    } else {
      // If the optimizer lands elsewhere the censored-share gate must hold instead.
      expect(fit.valid).toBe(false);
    }
  });

  it("degenerate point mass (all-equal severities) is invalid, not a 1.0x curve", () => {
    const obs = Array.from({ length: 20 }, () => closed(50_000));
    const fit = fitSeverity(obs, "lognormal");
    expect(fit.valid).toBe(false);
    expect(fit.warnings.join(" ")).toMatch(/degenerate|sigma/i);
  });

  it("a clean mostly-closed book still fits valid", () => {
    // Deterministic lognormal-ish spread, 25% censored at values consistent
    // with their size (independent censoring).
    const values = Array.from({ length: 40 }, (_, i) => 5_000 * Math.exp(0.12 * i));
    const obs = values.map((v, i) => (i % 4 === 0 ? open(v) : closed(v)));
    const fit = fitSeverity(obs, "lognormal");
    expect(fit.valid).toBe(true);
  });
});

describe("kaplanMeierQuantiles", () => {
  it("matches the hand-computed product-limit on a small example", () => {
    // events 1, 2, 4; censored 3.
    // S(1) = 3/4; S(2) = 3/4 * 2/3 = 1/2; S(4) = 1/2 * 0 = 0.
    const q = kaplanMeierQuantiles([1, 2, 4], [3], [0.5, 0.75, 0.9]);
    expect(q[0]).toBe(2); // first value where S <= 0.5
    expect(q[1]).toBe(4); // S <= 0.25 only at 4
    expect(q[2]).toBe(4);
  });

  it("returns null where censoring exhausts the observable range", () => {
    // events 1, 2; censored 10, 11, 12 (n=5):
    // S(1) = 4/5 = 0.8; S(2) = 0.8 * 3/4 = 0.6; the curve never falls below 0.6.
    const q = kaplanMeierQuantiles([1, 2], [10, 11, 12], [0.25, 0.5, 0.99]);
    expect(q[0]).toBe(2); // threshold 0.75: S(2)=0.6 <= 0.75
    expect(q[1]).toBeNull(); // threshold 0.5 never reached
    expect(q[2]).toBeNull();
  });

  it("with no censoring reduces to the empirical step quantile", () => {
    const q = kaplanMeierQuantiles([10, 20, 30, 40], [], [0.5, 0.75]);
    expect(q[0]).toBe(20);
    expect(q[1]).toBe(30);
  });
});

describe("validateIlfTable", () => {
  it("rejects duplicate limits and decreasing factors identically to interpolation", () => {
    expect(() =>
      validateIlfTable([
        { limit: 100_000, factor: 1 },
        { limit: 100_000, factor: 1.2 },
        { limit: 250_000, factor: 1.4 },
      ]),
    ).toThrowError(/Duplicate limit/);
    expect(() =>
      validateIlfTable([
        { limit: 100_000, factor: 1.4 },
        { limit: 250_000, factor: 1.2 },
      ]),
    ).toThrowError(/non-decreasing/);
  });
});
