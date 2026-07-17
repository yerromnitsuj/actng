import { describe, expect, it } from "vitest";
import { runCapeCod, runExpectedClaims } from "../src/elrMethods.js";
import {
  gluckCapeCodPP1992,
  gluckGcc075PP1990OwnLevel,
  gluckGcc075PP1992,
  gluckGcc075UltimateTotal,
  gluckRows,
} from "./fixtures/gluck1997.js";

/**
 * Hand-computed Cape Cod (Stanard-Buhlmann) example in the Friedland ch. 10
 * structure: three accident years, no adjustments first, then with
 * trend/on-level factors, verified to the dollar by construction.
 */
describe("runCapeCod", () => {
  const rows = [
    { origin: "2022", reported: 800, cdf: 1.05, premium: 1500 },
    { origin: "2023", reported: 600, cdf: 1.25, premium: 1600 },
    { origin: "2024", reported: 300, cdf: 2.0, premium: 1700 },
  ];

  it("reproduces the hand-computed unadjusted example to the dollar", () => {
    // used-up premium: 1500/1.05 + 1600/1.25 + 1700/2 = 1428.5714 + 1280 + 850
    const usedUp = 1500 / 1.05 + 1600 / 1.25 + 1700 / 2;
    const elr = (800 + 600 + 300) / usedUp; // 1700 / 3558.5714 = 0.477719...
    const r = runCapeCod(rows);
    expect(r.elrAtTargetLevel).toBeCloseTo(elr, 12);
    // 2024: expected ultimate = ELR x 1700; ultimate = 300 + expected x (1 - 1/2)
    const exp2024 = elr * 1700;
    expect(r.rows[2]!.expectedUltimate).toBeCloseTo(exp2024, 9);
    expect(r.rows[2]!.ultimate).toBeCloseTo(300 + exp2024 * 0.5, 9);
    // 2022 nearly mature: ultimate = 800 + ELR x 1500 x (1 - 1/1.05)
    expect(r.rows[0]!.ultimate).toBeCloseTo(800 + elr * 1500 * (1 - 1 / 1.05), 9);
    // Totals foot.
    expect(r.totals.ultimate).toBeCloseTo(
      r.rows.reduce((a, x) => a + x.ultimate, 0),
      9,
    );
  });

  it("adjustment factors change the ELR estimation but restate back per origin", () => {
    // Trend losses at 10%/yr to 2024 level; on-level premium factors given.
    const adj = [
      { ...rows[0]!, lossAdj: 1.21, premiumAdj: 1.15 },
      { ...rows[1]!, lossAdj: 1.1, premiumAdj: 1.08 },
      { ...rows[2]!, lossAdj: 1.0, premiumAdj: 1.0 },
    ];
    const usedUp = (1500 * 1.15) / 1.05 + (1600 * 1.08) / 1.25 + 1700 / 2;
    const elr = (800 * 1.21 + 600 * 1.1 + 300) / usedUp;
    const r = runCapeCod(adj);
    expect(r.elrAtTargetLevel).toBeCloseTo(elr, 12);
    // Origin-level ELR for 2022 = ELR* x premiumAdj / lossAdj.
    const elr2022 = (elr * 1.15) / 1.21;
    expect(r.rows[0]!.elrAtOriginLevel).toBeCloseTo(elr2022, 12);
    expect(r.rows[0]!.ultimate).toBeCloseTo(800 + elr2022 * 1500 * (1 - 1 / 1.05), 9);
  });

  it("a fully mature origin (cdf 1) takes no expected claims", () => {
    const r = runCapeCod([{ origin: "2015", reported: 500, cdf: 1, premium: 900 }]);
    expect(r.rows[0]!.ultimate).toBe(500);
  });

  it("rejects nonsense inputs", () => {
    expect(() => runCapeCod([])).toThrowError(/at least one/);
    expect(() =>
      runCapeCod([{ origin: "x", reported: 1, cdf: 0, premium: 100 }]),
    ).toThrowError(/CDF/);
    expect(() =>
      runCapeCod([{ origin: "x", reported: 1, cdf: 1.1, premium: 0 }]),
    ).toThrowError(/premium/);
  });
});

describe("Generalized Cape Cod (Gluck 1997 decay)", () => {
  const rows = gluckRows.map((g) => ({
    origin: g.year,
    reported: g.paidToDate,
    cdf: g.cdf,
    premium: g.exposures,
    lossAdj: g.trendTo1992,
  }));

  it("decay = 1 is byte-identical to the standard Cape Cod", () => {
    const std = runCapeCod(rows, { baseIsPurePremium: true });
    const gcc = runCapeCod(rows, { baseIsPurePremium: true, decay: 1 });
    expect(gcc.elrAtTargetLevel).toBe(std.elrAtTargetLevel);
    gcc.rows.forEach((r, i) => {
      expect(r.ultimate).toBe(std.rows[i]!.ultimate);
      expect(r.elrAtTargetLevel).toBe(std.elrAtTargetLevel);
    });
  });

  it("reproduces Gluck's Table 1 pooled pure premium at the 1992 level", () => {
    const std = runCapeCod(rows, { baseIsPurePremium: true });
    expect(Math.abs(std.elrAtTargetLevel - gluckCapeCodPP1992)).toBeLessThan(1e-3);
  });

  it("reproduces Gluck's Table 4 per-year expected pure premiums with D = 0.75", () => {
    const gcc = runCapeCod(rows, { baseIsPurePremium: true, decay: 0.75 });
    gcc.rows.forEach((r, i) => {
      expect(Math.abs(r.elrAtTargetLevel - gluckGcc075PP1992[i]!)).toBeLessThan(1e-3);
    });
    // The 1990 target restated to its own accident-year level (col 12).
    const y1990 = gcc.rows[11]!;
    expect(Math.abs(y1990.elrAtOriginLevel - gluckGcc075PP1990OwnLevel)).toBeLessThan(1e-3);
  });

  it("reproduces Gluck's Table 4 BF ultimate total with D = 0.75", () => {
    const gcc = runCapeCod(rows, { baseIsPurePremium: true, decay: 0.75 });
    expect(Math.abs(gcc.totals.ultimate - gluckGcc075UltimateTotal)).toBeLessThan(5);
  });

  it("decay = 0 makes every year stand alone and reproduces the development ultimate", () => {
    const gcc = runCapeCod(rows, { baseIsPurePremium: true, decay: 0 });
    gcc.rows.forEach((r, i) => {
      const g = gluckRows[i]!;
      expect(r.ultimate).toBeCloseTo(g.paidToDate * g.cdf, 6);
    });
  });

  it("rejects a decay outside [0, 1]", () => {
    expect(() => runCapeCod(rows, { decay: 1.2 })).toThrowError(/decay/i);
    expect(() => runCapeCod(rows, { decay: -0.1 })).toThrowError(/decay/i);
  });
});

describe("runExpectedClaims", () => {
  it("applies the restated ELR per origin with no dependence on emerged losses", () => {
    const r = runExpectedClaims(
      [
        { origin: "2023", reported: 999999, cdf: 1.3, premium: 1000, lossAdj: 1.1, premiumAdj: 1.05 },
        { origin: "2024", reported: 0, cdf: 2.0, premium: 1200 },
      ],
      0.65,
    );
    expect(r.rows[0]!.ultimate).toBeCloseTo(((0.65 * 1.05) / 1.1) * 1000, 9);
    expect(r.rows[1]!.ultimate).toBeCloseTo(0.65 * 1200, 9);
  });
  it("rejects a non-positive ELR", () => {
    expect(() =>
      runExpectedClaims([{ origin: "x", reported: 0, cdf: 1.5, premium: 100 }], 0),
    ).toThrowError(/positive/);
  });
});

describe("cdf below 1 (incurred bases with case run-off)", () => {
  it("posts an expected take-down, not an error", () => {
    const r = runCapeCod([
      { origin: "2022", reported: 1000, cdf: 0.95, premium: 1500 },
      { origin: "2024", reported: 400, cdf: 1.6, premium: 1500 },
    ]);
    const row = r.rows[0]!;
    // (1 - 1/0.95) < 0: the provision is negative by construction.
    expect(row.ultimate).toBeLessThan(row.reported);
    expect(row.ultimate).toBeCloseTo(
      1000 + row.expectedUltimate * (1 - 1 / 0.95),
      9,
    );
    expect(r.warnings.join(" ")).toMatch(/take-down/);
  });
});
