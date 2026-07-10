import { describe, expect, it } from "vitest";
import { analyzeTrend, trendValue } from "../src/trend.js";

describe("analyzeTrend", () => {
  it("recovers an exact exponential trend with R^2 = 1", () => {
    // y = 1000 * 1.07^(year-2020): every window must recover 7.0% exactly.
    const points = Array.from({ length: 8 }, (_, i) => ({
      year: 2020 + i,
      value: 1000 * Math.pow(1.07, i),
    }));
    const a = analyzeTrend(points);
    for (const key of ["all", "last5", "last3", "exhilo"]) {
      const fit = a.fits.find((f) => f.key === key)!;
      expect(fit.annualRate).toBeCloseTo(0.07, 10);
      expect(fit.rSquared).toBeCloseTo(1, 10);
    }
  });

  it("matches a hand-computed OLS on a noisy series", () => {
    // ln(y) on years 0..4: [0, 0.10, 0.16, 0.33, 0.38]
    // slope = Sxy/Sxx with x = year: Sxx = 10, Sxy = 0.99 -> slope 0.099
    const lnY = [0, 0.1, 0.16, 0.33, 0.38];
    const points = lnY.map((v, i) => ({ year: 2020 + i, value: Math.exp(v) }));
    const fit = analyzeTrend(points).fits.find((f) => f.key === "all")!;
    const xMean = 2;
    const yMean = lnY.reduce((a, b) => a + b, 0) / 5;
    let sxx = 0, sxy = 0, syy = 0;
    lnY.forEach((y, x) => {
      sxx += (x - xMean) ** 2;
      sxy += (x - xMean) * (y - yMean);
      syy += (y - yMean) ** 2;
    });
    expect(fit.annualRate).toBeCloseTo(Math.exp(sxy / sxx) - 1, 12);
    expect(fit.rSquared).toBeCloseTo((sxy * sxy) / (sxx * syy), 12);
  });

  it("ex-hi-lo removes exactly the highest and lowest VALUES, not endpoints", () => {
    const points = [
      { year: 2020, value: 100 },
      { year: 2021, value: 500 }, // hi
      { year: 2022, value: 110 },
      { year: 2023, value: 50 }, // lo
      { year: 2024, value: 121 },
    ];
    const fit = analyzeTrend(points).fits.find((f) => f.key === "exhilo")!;
    expect(fit.usedYears).toEqual([2020, 2022, 2024]);
    // Remaining series grows 10% per 2-year step: annual rate = sqrt(1.1) - 1.
    expect(fit.annualRate).toBeCloseTo(Math.sqrt(1.1) - 1, 9);
  });

  it("excludes non-positive values with a warning and degrades honestly", () => {
    const points = [
      { year: 2020, value: 100 },
      { year: 2021, value: 0 },
      { year: 2022, value: null },
      { year: 2023, value: 121 },
    ];
    const a = analyzeTrend(points);
    const all = a.fits.find((f) => f.key === "all")!;
    expect(all.annualRate).toBeNull(); // only 2 usable points
    expect(all.warnings.join(" ")).toMatch(/excluded/);
  });
});

describe("trendValue", () => {
  it("compounds forward and discounts backward symmetrically", () => {
    const forward = trendValue(1000, 0.08, 2020, 2025);
    expect(forward).toBeCloseTo(1000 * 1.08 ** 5, 9);
    expect(trendValue(forward, 0.08, 2025, 2020)).toBeCloseTo(1000, 9);
  });
  it("rejects rates at or below -100%", () => {
    expect(() => trendValue(100, -1, 2020, 2021)).toThrowError(/-100%/);
  });
});

describe("cadence-aware windows", () => {
  it("last-5/3-year windows span years, not points, on quarterly series", () => {
    // 6 years of quarterly points with an exact 6%/yr trend.
    const points = [];
    for (let y = 0; y < 6; y++) {
      for (let q = 0; q < 4; q++) {
        const x = 2020 + y + (q + 0.5) / 4;
        points.push({ year: x, value: 1000 * Math.pow(1.06, x - 2020) });
      }
    }
    const a = analyzeTrend(points, 4);
    const last5 = a.fits.find((f) => f.key === "last5")!;
    const last3 = a.fits.find((f) => f.key === "last3")!;
    expect(last5.nPoints).toBe(20); // 5 years x 4 quarters
    expect(last3.nPoints).toBe(12);
    expect(last5.usedYears[last5.usedYears.length - 1]! - last5.usedYears[0]!).toBeCloseTo(4.75, 9);
    expect(last5.annualRate).toBeCloseTo(0.06, 10);
    expect(last3.annualRate).toBeCloseTo(0.06, 10);
  });
});
