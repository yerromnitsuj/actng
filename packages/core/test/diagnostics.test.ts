import { describe, expect, it } from "vitest";
import { calendarYearTest, factorCorrelationTest, mackResiduals } from "../src/diagnostics.js";
import { triangleFromGrid } from "../src/triangle.js";
import {
  raa,
  raaCalendarYearPublished,
  raaCorrelationPublished,
} from "./fixtures/mack1994raa.js";

describe("factorCorrelationTest (Mack 1994, Appendix G)", () => {
  it("reproduces the published RAA worked example exactly", () => {
    const result = factorCorrelationTest(raa);
    expect(result).not.toBeNull();
    // Per-column Spearman statistics as printed: T_k for k = 2..8.
    expect(result!.columns.length).toBe(raaCorrelationPublished.k.length);
    result!.columns.forEach((col, idx) => {
      expect(col.pairs).toBe(raaCorrelationPublished.weights[idx]! + 1);
      expect(col.statistic).toBeCloseTo(raaCorrelationPublished.Tk[idx]!, 9);
    });
    expect(result!.statistic).toBeCloseTo(0.06956, 4); // printed as .070
    expect(result!.variance).toBeCloseTo(raaCorrelationPublished.varT, 12);
    expect(result!.bound50).toBeCloseTo(raaCorrelationPublished.bound, 9);
    expect(result!.correlated).toBe(false);
  });

  it("flags a deliberately correlated triangle", () => {
    // Alternating high/low rows make each origin's factors persistently
    // high or low across columns -> strong positive rank correlation.
    const rows = 12;
    const values: (number | null)[][] = [];
    for (let i = 0; i < rows; i++) {
      const f = i % 2 === 0 ? 2.0 + i * 0.01 : 1.2 + i * 0.01;
      const row: (number | null)[] = [];
      let v = 1000;
      for (let j = 0; j < rows - i; j++) {
        row.push(v);
        v *= f - (j * 0.05 * (f - 1));
      }
      while (row.length < rows) row.push(null);
      values.push(row);
    }
    const tri = triangleFromGrid(
      "paid",
      values.map((_, i) => String(2000 + i)),
      Array.from({ length: rows }, (_, j) => 12 * (j + 1)),
      values,
    );
    const result = factorCorrelationTest(tri);
    expect(result).not.toBeNull();
    expect(result!.correlated).toBe(true);
  });

  it("returns null when the triangle is too small to test", () => {
    const tri = triangleFromGrid(
      "paid",
      ["2021", "2022", "2023"],
      [12, 24, 36],
      [
        [100, 150, 160],
        [110, 165, null],
        [120, null, null],
      ],
    );
    expect(factorCorrelationTest(tri)).toBeNull();
  });
});

describe("calendarYearTest pinned to Mack 1994 Appendix H", () => {
  it("reproduces the published RAA statistics", () => {
    const result = calendarYearTest(raa);
    expect(result).not.toBeNull();
    expect(result!.totalZ).toBe(raaCalendarYearPublished.Z);
    expect(result!.expectedTotalZ).toBeCloseTo(raaCalendarYearPublished.EZ, 3);
    expect(result!.varianceTotalZ).toBeCloseTo(raaCalendarYearPublished.VarZ, 3);
  });
});

describe("mackResiduals", () => {
  it("yields null residuals with a warning on a zero-dispersion triangle", () => {
    const values: (number | null)[][] = [
      [100, 200, 300, 330],
      [150, 300, 450, null],
      [200, 400, null, null],
      [250, null, null, null],
    ];
    const tri = triangleFromGrid(
      "paid",
      ["2021", "2022", "2023", "2024"],
      [12, 24, 36, 48],
      values,
    );
    const result = mackResiduals(tri);
    expect(result.cells.every((c) => c.residual === null)).toBe(true);
    expect(result.warnings.some((w) => w.includes("no dispersion"))).toBe(true);
  });

  it("satisfies the volume-weighted identity sum(residual x sqrt(C)) = 0 per column on RAA", () => {
    const result = mackResiduals(raa);
    const nonNull = result.cells.filter((c) => c.residual !== null);
    expect(nonNull.length).toBeGreaterThan(20);
    const byColumn = new Map<number, { residual: number; origin: string; fromAge: number }[]>();
    for (const cell of nonNull) {
      const list = byColumn.get(cell.fromAge) ?? [];
      list.push({ residual: cell.residual!, origin: cell.origin, fromAge: cell.fromAge });
      byColumn.set(cell.fromAge, list);
    }
    for (const [fromAge, cells] of byColumn) {
      const colIdx = raa.ages.indexOf(fromAge);
      let weighted = 0;
      let scale = 0;
      for (const cell of cells) {
        const i = raa.origins.indexOf(cell.origin);
        const c0 = raa.values[i]![colIdx]!;
        weighted += cell.residual * Math.sqrt(c0);
        scale += Math.abs(cell.residual) * Math.sqrt(c0);
      }
      expect(Math.abs(weighted)).toBeLessThan(1e-9 * Math.max(1, scale));
    }
    // Calendar tags: diagonal index = origin index + column index + 1.
    for (const cell of nonNull) {
      expect(cell.calendar).toBeGreaterThanOrEqual(1);
      expect(cell.calendar).toBeLessThanOrEqual(raa.origins.length);
    }
  });
});
