import { describe, expect, it } from "vitest";
import { parallelogramOnLevel } from "../src/onlevel.js";

/**
 * Textbook parallelogram geometry (Werner & Modlin ch. 5): annual policies
 * written uniformly, earning evenly. The closed forms are asserted at the
 * EXACT date fraction (2024 is a leap year, so 2024-07-01 sits at
 * x = 182/366 of the year, not 0.5 - the engine is honest about calendars).
 */
describe("parallelogramOnLevel", () => {
  it("no history -> factors exactly 1", () => {
    const r = parallelogramOnLevel(["2023", "2024"], []);
    expect(r.currentLevel).toBe(1);
    for (const row of r.rows) expect(row.onLevelFactor).toBe(1);
  });

  it("reproduces the closed-form unit-square shares at the exact date fraction", () => {
    // +10% effective 2024-07-01 at x = 182/366 through the year:
    // new-level share of CY-2024 = (1-x)^2/2; of CY-2025 = 1 - x^2/2.
    const x = 182 / 366;
    const r = parallelogramOnLevel(["2023", "2024", "2025"], [
      { effectiveDate: "2024-07-01", change: 0.1 },
    ]);
    const share2024 = (1 - x) ** 2 / 2;
    const avg2024 = (1 - share2024) * 1 + share2024 * 1.1;
    const row2024 = r.rows.find((o) => o.origin === "2024")!;
    expect(row2024.averageRateLevel).toBeCloseTo(avg2024, 9);
    expect(row2024.onLevelFactor).toBeCloseTo(1.1 / avg2024, 9);

    const share2025 = 1 - x ** 2 / 2;
    const avg2025 = (1 - share2025) * 1 + share2025 * 1.1;
    const row2025 = r.rows.find((o) => o.origin === "2025")!;
    expect(row2025.averageRateLevel).toBeCloseTo(avg2025, 9);

    // CY2023 fully pre-change: factor = the full 1.1.
    expect(r.rows.find((o) => o.origin === "2023")!.onLevelFactor).toBeCloseTo(1.1, 9);
  });

  it("a 1/1 change splits the year 50/50 exactly", () => {
    const r = parallelogramOnLevel(["2024"], [{ effectiveDate: "2024-01-01", change: 0.2 }]);
    expect(r.rows[0]!.averageRateLevel).toBeCloseTo(0.5 * 1 + 0.5 * 1.2, 9);
  });

  it("compounds multiple changes into the current level", () => {
    const r = parallelogramOnLevel(["2020"], [
      { effectiveDate: "2022-01-01", change: 0.1 },
      { effectiveDate: "2023-01-01", change: -0.05 },
    ]);
    expect(r.currentLevel).toBeCloseTo(1.1 * 0.95, 9);
    // 2020 earned entirely at level 1 -> OLF = current level.
    expect(r.rows[0]!.onLevelFactor).toBeCloseTo(1.1 * 0.95, 9);
  });

  it("handles quarterly origins with annual-term geometry", () => {
    // Change at e = 2024 + 182/366 (just before Q3 starts). Q3 2024 =
    // [2024.5, 2024.75); earned density rises linearly over
    // [p0-1, p1-1) to 0.25, holds at 0.25 over [p1-1, p0), falls over
    // [p0, p1). Old-level area = integral over written-time w < e:
    // full rising triangle (0.25^2/2) + constant run from p1-1 to e.
    const e = 2024 + 182 / 366;
    const p1 = 2024.75;
    const oldArea = (0.25 * 0.25) / 2 + (e - (p1 - 1)) * 0.25;
    const total = 0.25;
    const newShare = 1 - oldArea / total;
    const r = parallelogramOnLevel(["2024Q3"], [
      { effectiveDate: "2024-07-01", change: 0.1 },
    ]);
    expect(r.rows[0]!.averageRateLevel).toBeCloseTo((1 - newShare) * 1 + newShare * 1.1, 9);
  });

  it("rejects rate changes at or below -100%", () => {
    expect(() =>
      parallelogramOnLevel(["2024"], [{ effectiveDate: "2024-01-01", change: -1 }]),
    ).toThrowError(/-100%/);
  });
});
