import { describe, expect, it } from "vitest";
import { CREATED_AT, annualPaidDoc } from "./helpers.js";
import {
  INTERCHANGE_SPEC_VERSION,
  type StochasticResultDoc,
  crosscheck,
  crosscheckReportDocSchema,
  crosscheckStochastic,
  stampIntegrity,
  verifyIntegrity,
} from "../src/index.js";

const triangleDoc = annualPaidDoc();
const TRI_TAG = triangleDoc.integrity;

interface BuildOptions {
  engine?: { name: string; version: string };
  profile?: string;
  triangleIntegrity?: string;
  selectionIntegrity?: string | null;
  nSims?: number;
  seed?: number;
  reproducibility?: "seeded-reproducible" | "witnessed";
  /** Multiplies every mean; 1.0 = identical to the reference. */
  meanScale?: number;
  /** Multiplies every sd. */
  sdScale?: number;
  origins?: string[];
}

/** Hand-built StochasticResultDoc for referee tests (spec 5 / 16). */
function buildStochasticDoc(options: BuildOptions = {}): StochasticResultDoc {
  const meanScale = options.meanScale ?? 1;
  const sdScale = options.sdScale ?? 1;
  const origins = options.origins ?? ["2021", "2022", "2023"];
  const base: Record<string, { mean: number; sd: number }> = {
    "2021": { mean: 0, sd: 0 },
    "2022": { mean: 378.5, sd: 42.1 },
    "2023": { mean: 1249.25, sd: 111.4 },
    "2024": { mean: 900, sd: 90 },
  };
  const byOrigin = origins.map((origin) => {
    const cell = base[origin] ?? { mean: 500, sd: 50 };
    return {
      origin,
      mean: cell.mean * meanScale,
      sd: cell.sd * sdScale,
      cv: cell.mean === 0 ? null : (cell.sd * sdScale) / (cell.mean * meanScale),
      percentiles: { "50": cell.mean * meanScale, "95": cell.mean * meanScale * 1.6 },
    };
  });
  const totalMean = byOrigin.reduce((sum, r) => sum + r.mean, 0);
  const totalSd = 150 * sdScale;

  const result: Record<string, unknown> = {
    appliesTo: {
      triangleIntegrity: options.triangleIntegrity ?? TRI_TAG,
      selectionIntegrity: options.selectionIntegrity ?? null,
    },
    engine: {
      name: options.engine?.name ?? "actuarial-ts",
      version: options.engine?.version ?? "0.2.0",
      ...(options.profile !== undefined ? { conventionProfile: options.profile } : {}),
    },
    method: "odpBootstrap",
    parameters: { n_sims: options.nSims ?? 1000 },
    nSims: options.nSims ?? 1000,
    summary: {
      mean: totalMean,
      sd: totalSd,
      cv: totalSd / totalMean,
      percentiles: { "50": totalMean, "95": totalMean * 1.6 },
    },
    byOrigin,
  };
  if (options.seed !== undefined) result["seed"] = options.seed;
  if (options.reproducibility !== undefined) {
    result["reproducibility"] = options.reproducibility;
  }

  return stampIntegrity<StochasticResultDoc>({
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind: "stochastic-result",
    generator: { name: "@actuarial-ts/interchange", version: "0.2.0" },
    createdAt: CREATED_AT,
    extensions: {},
    result,
  } as unknown as StochasticResultDoc);
}

describe("crosscheckStochastic (spec 5 / 16)", () => {
  it("emits a valid, integrity-stamped crosscheck report", () => {
    const report = crosscheckStochastic({
      a: buildStochasticDoc({ reproducibility: "witnessed" }),
      b: buildStochasticDoc({ reproducibility: "witnessed" }),
      createdAt: CREATED_AT,
    });
    expect(crosscheckReportDocSchema.safeParse(report).success).toBe(true);
    expect(verifyIntegrity(report).ok).toBe(true);
    expect(report.kind).toBe("crosscheck-report");
  });

  it("agrees when two witnessed engines draw the same distribution", () => {
    const report = crosscheckStochastic({
      a: buildStochasticDoc({ reproducibility: "witnessed", engine: { name: "actuarial-ts", version: "0.2.0" } }),
      b: buildStochasticDoc({ reproducibility: "witnessed", engine: { name: "chainladder-python", version: "0.9.2" } }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("agree");
  });

  it("states plainly that a witnessed agreement is not a reproducible replay", () => {
    const report = crosscheckStochastic({
      a: buildStochasticDoc({ reproducibility: "witnessed" }),
      b: buildStochasticDoc({ reproducibility: "seeded-reproducible" }),
      createdAt: CREATED_AT,
    });
    expect(report.report.warnings.join(" ")).toContain("WITNESSED");
    expect(report.report.warnings.join(" ")).toMatch(/will NOT reproduce/i);
  });

  it("DERIVES the tolerance from n and CV, so more simulations bind tighter", () => {
    const small = crosscheckStochastic({
      a: buildStochasticDoc({ nSims: 250, reproducibility: "witnessed" }),
      b: buildStochasticDoc({ nSims: 250, reproducibility: "witnessed" }),
      createdAt: CREATED_AT,
    });
    const large = crosscheckStochastic({
      a: buildStochasticDoc({ nSims: 25_000, reproducibility: "witnessed" }),
      b: buildStochasticDoc({ nSims: 25_000, reproducibility: "witnessed" }),
      createdAt: CREATED_AT,
    });
    expect(large.report.tolerance.central).toBeLessThan(small.report.tolerance.central);
    // 100x the simulations => 10x tighter (1/sqrt(n)).
    const ratio = small.report.tolerance.standardError! / large.report.tolerance.standardError!;
    expect(ratio).toBeGreaterThan(9);
    expect(ratio).toBeLessThan(11);
  });

  it("tolerates ordinary sampling noise instead of calling it disagreement", () => {
    // At n=250 the 4-sigma sd bound is ~25%, so a 5% sd difference — the exact
    // deviation that made the old byte-identity test flake — must NOT disagree.
    const report = crosscheckStochastic({
      a: buildStochasticDoc({ nSims: 250, reproducibility: "witnessed" }),
      b: buildStochasticDoc({ nSims: 250, reproducibility: "witnessed", sdScale: 1.05 }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("agree");
  });

  it("judges each origin against ITS OWN bound, not the diversified total's", () => {
    // A single origin is materially more volatile than the total, which
    // diversifies. On realistic Taylor/Ashe numbers the per-origin CV runs
    // 0.35-0.45 against a total CV near 0.15, so a bound derived once from the
    // total holds origins to roughly 3x too tight a standard and reports
    // ordinary sampling noise as disagreement.
    //
    // Build a doc whose ORIGINS are volatile (CV ~0.45) while the TOTAL is
    // calm (CV ~0.05), then perturb one origin by 12% — inside that origin's
    // own bound, but far outside a bound derived from the total.
    const volatile = (meanScale: number): StochasticResultDoc => {
      const byOrigin = ["2021", "2022", "2023"].map((origin, i) => ({
        origin,
        mean: 1000 * (i + 1) * (origin === "2023" ? meanScale : 1),
        sd: 450 * (i + 1),
        cv: 0.45,
        percentiles: { "50": 1000 * (i + 1), "95": 1600 * (i + 1) },
      }));
      return stampIntegrity<StochasticResultDoc>({
        interchangeVersion: INTERCHANGE_SPEC_VERSION,
        kind: "stochastic-result",
        generator: { name: "@actuarial-ts/interchange", version: "0.2.0" },
        createdAt: CREATED_AT,
        extensions: {},
        result: {
          appliesTo: { triangleIntegrity: TRI_TAG, selectionIntegrity: null },
          engine: { name: "actuarial-ts", version: "0.2.0" },
          method: "odpBootstrap",
          parameters: { n_sims: 250 },
          nSims: 250,
          reproducibility: "witnessed",
          summary: { mean: 6000, sd: 300, cv: 0.05, percentiles: { "50": 6000, "95": 6300 } },
          byOrigin,
        },
      } as unknown as StochasticResultDoc);
    };

    const report = crosscheckStochastic({
      a: volatile(1),
      b: volatile(1.12),
      createdAt: CREATED_AT,
    });

    const total = report.report.tolerance.central;
    const cell = report.report.deviations.perOrigin.find((r) => r.origin === "2023")! as unknown as {
      centralBound: number;
      unpaid: number;
    };
    // The origin's own bound must be materially looser than the total's.
    expect(cell.centralBound).toBeGreaterThan(total * 2);
    // The 12% move sits inside the origin's bound, outside the total's.
    expect(cell.unpaid).toBeGreaterThan(total);
    expect(cell.unpaid).toBeLessThan(cell.centralBound);
    expect(report.report.verdict).toBe("agree");
  });

  it("still catches a real disagreement well outside the sampling bound", () => {
    const report = crosscheckStochastic({
      a: buildStochasticDoc({ nSims: 1000, reproducibility: "witnessed" }),
      b: buildStochasticDoc({ nSims: 1000, reproducibility: "witnessed", meanScale: 1.5 }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("disagree");
  });

  it("WITHHOLDS the Monte Carlo allowance when both claim seeded-reproducible at one seed", () => {
    // Both promise byte-reproducibility at seed 42, so a 5% sd gap that would
    // be ordinary noise for witnessed engines is a broken promise here.
    const report = crosscheckStochastic({
      a: buildStochasticDoc({ nSims: 250, seed: 42, reproducibility: "seeded-reproducible" }),
      b: buildStochasticDoc({ nSims: 250, seed: 42, reproducibility: "seeded-reproducible", sdScale: 1.05 }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("disagree");
    expect(report.report.warnings.join(" ")).toContain("WITHHELD");
  });

  it("grants the allowance to seeded-reproducible results drawn at DIFFERENT seeds", () => {
    const report = crosscheckStochastic({
      a: buildStochasticDoc({ nSims: 250, seed: 42, reproducibility: "seeded-reproducible" }),
      b: buildStochasticDoc({ nSims: 250, seed: 43, reproducibility: "seeded-reproducible", sdScale: 1.05 }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("agree");
  });

  it("treats an unstated reproducibility class as unknown, not as a guarantee", () => {
    const report = crosscheckStochastic({
      a: buildStochasticDoc({ seed: 42 }),
      b: buildStochasticDoc({ seed: 42 }),
      createdAt: CREATED_AT,
    });
    expect(report.report.warnings.join(" ")).toMatch(/does not state a reproducibility class/);
  });

  it("refuses different triangles, selections, profiles and origin sets", () => {
    const base = buildStochasticDoc({ reproducibility: "witnessed" });
    const cases: StochasticResultDoc[] = [
      buildStochasticDoc({ reproducibility: "witnessed", triangleIntegrity: "0123456789abcdef" }),
      buildStochasticDoc({ reproducibility: "witnessed", selectionIntegrity: "0123456789abcdef" }),
      buildStochasticDoc({ reproducibility: "witnessed", origins: ["2021", "2022", "2024"] }),
    ];
    for (const other of cases) {
      const report = crosscheckStochastic({ a: base, b: other, createdAt: CREATED_AT });
      expect(report.report.verdict).toBe("not-comparable");
    }
    const profiled = crosscheckStochastic({
      a: buildStochasticDoc({ reproducibility: "witnessed", profile: "odp-bootstrap-distribution" }),
      b: buildStochasticDoc({ reproducibility: "witnessed", profile: "something-else" }),
      createdAt: CREATED_AT,
    });
    expect(profiled.report.verdict).toBe("not-comparable");
  });

  it("rejects a tampered document on its integrity tag", () => {
    const doc = buildStochasticDoc({ reproducibility: "witnessed" });
    const tampered = {
      ...doc,
      result: { ...doc.result, summary: { ...doc.result.summary, mean: 1 } },
    } as StochasticResultDoc;
    expect(() =>
      crosscheckStochastic({ a: tampered, b: doc, createdAt: CREATED_AT }),
    ).toThrow(/integrity check/);
  });

  // --- regressions found by adversarial review ---

  it("compares POINT estimates carried beside the distribution", () => {
    // Found by review: two results whose point ultimates differed 10x still
    // returned `agree`, because only the distribution summaries were compared
    // and deviations.totals.ultimate was hard-coded null.
    const withPoints = (ultimate: number): StochasticResultDoc => {
      const base = buildStochasticDoc({ reproducibility: "witnessed" });
      const result = {
        ...(base.result as unknown as Record<string, unknown>),
        rows: [{ origin: "2022", ultimate, unpaid: 378.5 }],
        totals: { ultimate, unpaid: 1627.75 },
      };
      return stampIntegrity<StochasticResultDoc>({
        ...base,
        result,
      } as unknown as StochasticResultDoc);
    };

    const report = crosscheckStochastic({
      a: withPoints(5_000),
      b: withPoints(50_000),
      createdAt: CREATED_AT,
    });
    expect(report.report.deviations.totals.ultimate).toBeGreaterThan(0.8);
    expect(report.report.verdict).toBe("disagree");
    expect(report.report.warnings.join(" ")).toContain("POINT estimates");
  });

  it("grants the allowance when the same seed ran DIFFERENT simulation counts", () => {
    // Found by review: holdToExact keyed only on (both seeded-reproducible +
    // same seed), so a 1k-sim and a 10k-sim run at seed 42 were held to float
    // noise — but they are legitimately different draws.
    const report = crosscheckStochastic({
      a: buildStochasticDoc({ nSims: 1_000, seed: 42, reproducibility: "seeded-reproducible" }),
      b: buildStochasticDoc({
        nSims: 10_000,
        seed: 42,
        reproducibility: "seeded-reproducible",
        sdScale: 1.01,
      }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("agree");
    expect(report.report.warnings.join(" ")).toContain("different");
    expect(report.report.tolerance.central).toBeGreaterThan(1e-9);
  });

  it("rejects a non-positive exactTolerance with the caller's own mistake", () => {
    // Found by review: exactTolerance 0 produced an invalid report and threw an
    // internal schema dump instead of naming the bad option.
    expect(() =>
      crosscheckStochastic({
        a: buildStochasticDoc({ seed: 1, reproducibility: "seeded-reproducible" }),
        b: buildStochasticDoc({ seed: 1, reproducibility: "seeded-reproducible" }),
        exactTolerance: 0,
        createdAt: CREATED_AT,
      }),
    ).toThrow(/exactTolerance' must be positive/);
  });

  it("records what a reader needs to interpret a distributional verdict", () => {
    const report = crosscheckStochastic({
      a: buildStochasticDoc({ nSims: 500, seed: 7, reproducibility: "witnessed" }),
      b: buildStochasticDoc({ nSims: 250, seed: 7, reproducibility: "seeded-reproducible" }),
      createdAt: CREATED_AT,
    });
    const comparison = (report.report as unknown as { comparison: Record<string, unknown> })
      .comparison;
    expect(comparison["kind"]).toBe("distributional");
    expect(comparison["nSims"]).toEqual({ a: 500, b: 250 });
    expect(comparison["reproducibility"]).toEqual({ a: "witnessed", b: "seeded-reproducible" });
    expect(comparison["monteCarloAllowance"]).toBe(true);
  });
});

describe("crosscheck refuses stochastic input with an actionable message", () => {
  it("names crosscheckStochastic instead of dumping a schema error", () => {
    const stochastic = buildStochasticDoc({ reproducibility: "witnessed" });
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      crosscheck({ a: stochastic as any, b: stochastic as any, createdAt: CREATED_AT }),
    ).toThrow(/crosscheckStochastic/);
  });
});
