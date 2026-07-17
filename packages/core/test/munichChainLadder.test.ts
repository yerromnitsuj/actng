import { describe, expect, it } from "vitest";
import { runMunichChainLadder } from "../src/munichChainLadder.js";
import { ReservingError } from "../src/types.js";
import type { Triangle } from "../src/types.js";
import { qmIncurred, qmPaid, qmPublished } from "./fixtures/quargMack2004.js";

/**
 * Published-dataset validation for Quarg-Mack (2004), Chapter 3.3.
 *
 * The paper prints parameters to 3 decimals, ratios to 0.1%, and result
 * quadrangles to whole units, and warns its own results "were calculated
 * with more precision than shown". Computing from the raw triangles, every
 * printed projected cell reproduces within 0.5 absolute, so the pins below
 * use abs <= 1 on quadrangle cells (stricter than the 0.5% budget) and the
 * printed precision on parameter rows.
 */

// The paper's result quadrangles manually set both non-estimable final-column
// sigmas to 0.100; the parameters themselves are data-estimated.
const result = runMunichChainLadder(qmPaid, qmIncurred, {
  lastColumnSigma: {
    paid: qmPublished.manualLastSigma,
    incurred: qmPublished.manualLastSigma,
  },
});

function expectCode(code: "SHAPE" | "TOO_SMALL", fn: () => unknown): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ReservingError);
  expect((thrown as ReservingError).code).toBe(code);
}

describe("Munich chain ladder: Quarg-Mack (2004) printed parameters", () => {
  it("reproduces fhat^P and fhat^I to the printed 3 decimals", () => {
    expect(result.paidFactors).toHaveLength(6);
    qmPublished.paidFactors.forEach((published, s) => {
      expect(result.paidFactors[s]!).toBeCloseTo(published, 3);
    });
    qmPublished.incurredFactors.forEach((published, s) => {
      expect(result.incurredFactors[s]!).toBeCloseTo(published, 3);
    });
  });

  it("reproduces sigmahat^P and sigmahat^I (Mack denominators, pairs - 1) to 3 decimals", () => {
    qmPublished.sigmaPaid.forEach((published, s) => {
      expect(result.sigmaPaid[s]!).toBeCloseTo(published, 3);
    });
    qmPublished.sigmaIncurred.forEach((published, s) => {
      expect(result.sigmaIncurred[s]!).toBeCloseTo(published, 3);
    });
    // The final column is the paper's manual 0.100, surfaced in warnings.
    expect(result.sigmaPaid[5]!).toBeCloseTo(0.1, 12);
    expect(result.sigmaIncurred[5]!).toBeCloseTo(0.1, 12);
    expect(result.warnings.join("\n")).toContain("caller-supplied 0.1");
  });

  it("reproduces the incurred-weighted qhat_s row to the printed 0.1%", () => {
    expect(result.qRatios).toHaveLength(7);
    qmPublished.qRatios.forEach((published, s) => {
      expect(result.qRatios[s]!).toBeCloseTo(published, 3);
    });
  });

  it("reproduces rhohat^P and rhohat^I (ratio-series Mack variances, cells - 1) to 3 decimals", () => {
    qmPublished.rhoPaid.forEach((published, s) => {
      expect(result.rhoPaid[s]!).toBeCloseTo(published, 3);
    });
    qmPublished.rhoIncurred.forEach((published, s) => {
      expect(result.rhoIncurred[s]!).toBeCloseTo(published, 3);
    });
    // rho for the last age column rests on a single observation.
    expect(result.rhoPaid[6]).toBeNull();
    expect(result.rhoIncurred[6]).toBeNull();
  });

  it("reproduces the paper's printed residual spot values", () => {
    expect(result.residuals.paidFactor[0]![0]!).toBeCloseTo(
      qmPublished.residualPins.paidFactorAY1,
      3,
    );
    expect(result.residuals.paidRatio[6]![0]!).toBeCloseTo(qmPublished.residualPins.paidRatioAY7, 3);
    expect(result.residuals.incurredRatio[6]![0]!).toBeCloseTo(
      qmPublished.residualPins.incurredRatioAY7,
      3,
    );
  });

  it("reproduces the through-origin regression lambdas within 0.01", () => {
    expect(Math.abs(result.lambdaPaid - qmPublished.lambdaPaid)).toBeLessThan(0.01);
    expect(Math.abs(result.lambdaIncurred - qmPublished.lambdaIncurred)).toBeLessThan(0.01);
  });
});

describe("Munich chain ladder: Quarg-Mack (2004) printed projections", () => {
  it("reproduces the worked first step for accident year 7 (the simultaneous recursion)", () => {
    const paid24 = result.projectedPaid[6]![1]!;
    const incurred24 = result.projectedIncurred[6]![1]!;
    expect(Math.abs(paid24 - qmPublished.workedStepAY7.paidAge24)).toBeLessThanOrEqual(1);
    expect(Math.abs(incurred24 - qmPublished.workedStepAY7.incurredAge24)).toBeLessThanOrEqual(1);
    // Implied MCL first factors 2.768 / 1.559, and Q_{7,2} = 72.3%.
    expect(paid24 / 2044).toBeCloseTo(qmPublished.workedStepAY7.mclPaidFactor, 3);
    expect(incurred24 / 5022).toBeCloseTo(qmPublished.workedStepAY7.mclIncurredFactor, 3);
    expect(paid24 / incurred24).toBeCloseTo(qmPublished.workedStepAY7.ratioAge24, 3);
  });

  it("reproduces every printed projected cell of both result quadrangles within 1 absolute", () => {
    for (let i = 0; i < 7; i++) {
      const firstProjected = 7 - i;
      qmPublished.mclProjectedPaid[i]!.forEach((published, k) => {
        expect(
          Math.abs(result.projectedPaid[i]![firstProjected + k]! - published),
        ).toBeLessThanOrEqual(1);
      });
      qmPublished.mclProjectedIncurred[i]!.forEach((published, k) => {
        expect(
          Math.abs(result.projectedIncurred[i]![firstProjected + k]! - published),
        ).toBeLessThanOrEqual(1);
      });
    }
  });

  it("reproduces the MCL ultimates per accident year within 1 absolute (well under 0.5%)", () => {
    expect(result.rows).toHaveLength(7);
    qmPublished.mclPaidUltimates.forEach((published, i) => {
      expect(Math.abs(result.rows[i]!.paidUltimate - published)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(result.rows[i]!.paidUltimate - published) / published,
      ).toBeLessThan(0.005);
    });
    qmPublished.mclIncurredUltimates.forEach((published, i) => {
      expect(Math.abs(result.rows[i]!.incurredUltimate - published)).toBeLessThanOrEqual(1);
    });
  });

  it("matches Figure 16's SCL anchors: AY7 paid falls ~27% short, AY6 exceeds by ~10%", () => {
    expect(result.rows[6]!.sclFinalRatio!).toBeGreaterThan(0.7);
    expect(result.rows[6]!.sclFinalRatio!).toBeLessThan(0.76);
    expect(result.rows[5]!.sclFinalRatio!).toBeGreaterThan(1.08);
    expect(result.rows[5]!.sclFinalRatio!).toBeLessThan(1.12);
    // MCL ultimate P/I about 97-100% in all years.
    for (const row of result.rows) {
      expect(row.finalRatio!).toBeGreaterThan(0.965);
      expect(row.finalRatio!).toBeLessThan(1.005);
    }
  });

  it("closes the paid/incurred gap: |MCL P/I - 1| <= |SCL P/I - 1| per year (documented AY4 slack)", () => {
    // Strict inequality is falsified by the paper's own printed values for
    // accident year 4, where SCL was already nearly converged (SCL gap
    // 0.91%, MCL gap 0.92% - a 1bp excursion to the other side of 100%).
    // Pin the property with 0.1pp slack everywhere, strictly where the SCL
    // gap is material (> 2%), and on the worst-year gap.
    let maxMcl = 0;
    let maxScl = 0;
    for (const row of result.rows) {
      const mclGap = Math.abs(row.finalRatio! - 1);
      const sclGap = Math.abs(row.sclFinalRatio! - 1);
      expect(mclGap).toBeLessThanOrEqual(sclGap + 0.001);
      if (sclGap > 0.02) expect(mclGap).toBeLessThan(sclGap);
      maxMcl = Math.max(maxMcl, mclGap);
      maxScl = Math.max(maxScl, sclGap);
    }
    expect(maxMcl).toBeLessThan(maxScl);
    // And in aggregate the MCL ultimates practically reconcile.
    expect(result.totals.paidUltimate / result.totals.incurredUltimate).toBeGreaterThan(0.98);
    expect(result.totals.paidUltimate / result.totals.incurredUltimate).toBeLessThan(1.005);
  });

  it("falls back to Mack's sigma extrapolation (with a warning) when no manual last sigma is given", () => {
    const fallback = runMunichChainLadder(qmPaid, qmIncurred);
    expect(fallback.warnings.join("\n")).toContain("Mack's extrapolation rule");
    // Parameters other than the final sigma are unchanged.
    expect(fallback.lambdaPaid).toBeCloseTo(result.lambdaPaid, 12);
    expect(fallback.sigmaPaid[4]!).toBeCloseTo(result.sigmaPaid[4]!, 12);
    // Only the final development step differs, so earlier projections agree.
    expect(fallback.projectedPaid[6]![1]!).toBeCloseTo(result.projectedPaid[6]![1]!, 9);
  });
});

describe("Munich chain ladder: degenerate inputs", () => {
  const smallPaid: Triangle = {
    kind: "paid",
    origins: ["1", "2"],
    ages: [12, 24],
    values: [
      [100, 180],
      [110, null],
    ],
  };
  const smallIncurred: Triangle = {
    kind: "incurred",
    origins: ["1", "2"],
    ages: [12, 24],
    values: [
      [150, 190],
      [160, null],
    ],
  };

  it("throws SHAPE when the triangles' origins or ages differ", () => {
    expectCode("SHAPE", () =>
      runMunichChainLadder(qmPaid, {
        ...qmIncurred,
        origins: qmIncurred.origins.slice(0, 6),
        values: qmIncurred.values.slice(0, 6),
      }),
    );
    expectCode("SHAPE", () =>
      runMunichChainLadder(qmPaid, { ...qmIncurred, ages: [12, 24, 36, 48, 60, 72, 96] }),
    );
    expectCode("SHAPE", () =>
      runMunichChainLadder(qmPaid, {
        ...qmIncurred,
        values: qmIncurred.values.map((row, i) => (i === 3 ? row.slice(0, 5) : row)),
      }),
    );
  });

  it("throws TOO_SMALL when no development column has two paired factors", () => {
    // 2x2: one factor per triangle, sigma never estimable, no residual pairs.
    expectCode("TOO_SMALL", () => runMunichChainLadder(smallPaid, smallIncurred));
    // Single development age.
    expectCode("TOO_SMALL", () =>
      runMunichChainLadder(
        { ...smallPaid, ages: [12], values: [[100], [110]] },
        { ...smallIncurred, ages: [12], values: [[150], [160]] },
      ),
    );
  });

  it("collapses to the separate chain ladder (lambda = 0, with a warning) when P/I is in lockstep", () => {
    // Incurred = paid x 2 everywhere (P/I = 50%, exact in binary floating
    // point): the ratio series has zero variation, rho = 0, no
    // standardizable ratio residuals - the paper's safety mechanism should
    // yield SCL, not an exception.
    const paid: Triangle = {
      kind: "paid",
      origins: ["1", "2", "3", "4"],
      ages: [12, 24, 36, 48],
      values: [
        [100, 210, 260, 280],
        [120, 230, 290, null],
        [90, 200, null, null],
        [130, null, null, null],
      ],
    };
    const incurred: Triangle = {
      kind: "incurred",
      origins: paid.origins,
      ages: paid.ages,
      values: paid.values.map((row) => row.map((v) => (v === null ? null : v * 2))),
    };
    const collapsed = runMunichChainLadder(paid, incurred);
    expect(collapsed.lambdaPaid).toBe(0);
    expect(collapsed.lambdaIncurred).toBe(0);
    expect(collapsed.warnings.join("\n")).toContain("lambda^P set to 0");
    for (const row of collapsed.rows) {
      expect(row.paidUltimate).toBeCloseTo(row.sclPaidUltimate, 9);
      expect(row.incurredUltimate).toBeCloseTo(row.sclIncurredUltimate, 9);
    }
  });

  it("skips origins with no observations in one triangle, with a warning", () => {
    const paid: Triangle = {
      ...qmPaid,
      values: qmPaid.values.map((row, i) => (i === 6 ? row.map(() => null) : row)),
    };
    const partial = runMunichChainLadder(paid, qmIncurred);
    expect(partial.rows).toHaveLength(6);
    expect(partial.warnings.join("\n")).toContain("no observed paid values");
  });
});
