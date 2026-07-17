import { describe, expect, it } from "vitest";
import { extrapolateSigma2, mackEstimators } from "../src/mack.js";
import { runMerzWuthrich } from "../src/merzWuthrich.js";
import { ReservingError } from "../src/types.js";
import type { Triangle } from "../src/types.js";
import { mwPublished, mwTriangle } from "./fixtures/merzWuthrich2008.js";

/**
 * Published-dataset validation for Merz-Wuthrich (2008), Tables 2 and 4.
 *
 * The triangle and every printed volatility are in $1,000 and the paper
 * rounds to $1,000, so computed values compare directly: abs diff <=
 * max(1, 0.5% of published) per accident year, 0.2% on the aggregates.
 */

const result = runMerzWuthrich(mwTriangle);
const tolerance = (published: number) => Math.max(1, 0.005 * published);

function expectShapeError(tri: Triangle): void {
  let thrown: unknown;
  try {
    runMerzWuthrich(tri);
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ReservingError);
  expect((thrown as ReservingError).code).toBe("SHAPE");
}

describe("Merz-Wuthrich (2008) published values", () => {
  it("reproduces the printed development factors fhat_j to 4 decimals", () => {
    expect(result.developmentFactors).toHaveLength(mwPublished.factors.length);
    mwPublished.factors.forEach((published, j) => {
      expect(result.developmentFactors[j]!).toBeCloseTo(published, 4);
    });
  });

  it("reproduces the published reserves by accident year and in total", () => {
    expect(result.rows).toHaveLength(9);
    mwPublished.reserves.forEach((published, idx) => {
      expect(Math.abs(result.rows[idx + 1]!.reserve - published)).toBeLessThanOrEqual(1);
    });
    expect(Math.abs(result.totals.reserve - mwPublished.totalReserve)).toBeLessThanOrEqual(2);
  });

  it("reproduces Table 4's one-year CDR msep roots (the solvency column) within 0.5%", () => {
    mwPublished.cdrMsepRoots.forEach((published, idx) => {
      expect(Math.abs(result.rows[idx + 1]!.cdrMsepRoot - published)).toBeLessThanOrEqual(
        tolerance(published),
      );
    });
  });

  it("reproduces the aggregate one-year msep root 81,080 within 0.2%", () => {
    expect(
      Math.abs(result.totals.cdrMsepRoot - mwPublished.totalCdrMsepRoot),
    ).toBeLessThanOrEqual(0.002 * mwPublished.totalCdrMsepRoot);
  });

  it("reproduces Table 4's Mack full-runoff msep roots within 0.5% (total within 0.2%)", () => {
    mwPublished.mackMsepRoots.forEach((published, idx) => {
      expect(Math.abs(result.rows[idx + 1]!.mackMsepRoot - published)).toBeLessThanOrEqual(
        tolerance(published),
      );
    });
    expect(
      Math.abs(result.totals.mackMsepRoot - mwPublished.totalMackMsepRoot),
    ).toBeLessThanOrEqual(0.002 * mwPublished.totalMackMsepRoot);
  });

  it("the aggregate one-year ratio is ~0.748 (81,080 / 108,401)", () => {
    expect(result.totals.oneYearRatio).not.toBeNull();
    expect(result.totals.oneYearRatio!).toBeCloseTo(
      mwPublished.totalCdrMsepRoot / mwPublished.totalMackMsepRoot,
      2,
    );
  });

  it("one-year risk never exceeds full-runoff risk, and equals it for the first open year", () => {
    for (const row of result.rows) {
      expect(row.cdrMsepRoot).toBeLessThanOrEqual(row.mackMsepRoot * (1 + 1e-9));
    }
    expect(result.totals.cdrMsepRoot).toBeLessThanOrEqual(result.totals.mackMsepRoot);
    // With one development step left (i = 1), eq. (3.17) collapses to Mack's
    // msep exactly - Table 4 prints 567 in both columns.
    expect(result.rows[1]!.cdrMsepRoot).toBeCloseTo(result.rows[1]!.mackMsepRoot, 6);
  });

  it("the fully developed oldest year carries zero reserve, zero risk, null ratio", () => {
    const first = result.rows[0]!;
    expect(first.reserve).toBe(0);
    expect(first.cdrMsepRoot).toBe(0);
    expect(first.mackMsepRoot).toBe(0);
    expect(first.oneYearRatio).toBeNull();
  });

  it("reproduces Table 4's true-CDR standard deviations from the shared estimators (3.8)", () => {
    const estimators = mackEstimators(mwTriangle);
    const sigma2 = extrapolateSigma2(estimators.sigma2, mwTriangle.ages, []);
    const I = mwTriangle.ages.length - 1;
    mwPublished.trueCdrSds.forEach((published, idx) => {
      const i = idx + 1;
      const latest = mwTriangle.values[i]![I - i]!;
      let ultimate = latest;
      for (let j = I - i; j < I; j++) ultimate *= estimators.f[j]!;
      // Varhat(CDR_i|D_I)^{1/2} = Chat_{i,J} * sqrt(sjr(I-i) / C_{i,I-i}).
      const sd = ultimate * Math.sqrt(sigma2[I - i]! / estimators.f[I - i]! ** 2 / latest);
      expect(Math.abs(sd - published)).toBeLessThanOrEqual(tolerance(published));
    });
  });

  it("throws SHAPE for non-square triangles (the closed forms assume I = J)", () => {
    expectShapeError({
      ...mwTriangle,
      origins: mwTriangle.origins.slice(0, 8),
      values: mwTriangle.values.slice(0, 8),
    });
  });

  it("throws SHAPE for irregular triangles (missing interior cell / data past the diagonal)", () => {
    const withHole = mwTriangle.values.map((row) => [...row]);
    withHole[3]![2] = null;
    expectShapeError({ ...mwTriangle, values: withHole });

    const pastDiagonal = mwTriangle.values.map((row) => [...row]);
    pastDiagonal[1]![8] = 3906738; // the paper's boxed next-diagonal cell
    expectShapeError({ ...mwTriangle, values: pastDiagonal });
  });
});
