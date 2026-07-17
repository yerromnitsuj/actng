import { describe, expect, it } from "vitest";
import { runChainLadder } from "../src/chainladder.js";
import {
  discountUnpaid,
  payoutPatternFromChainLadder,
} from "../src/discounting.js";
import type { DiscountUnpaidInput, PayoutPattern } from "../src/discounting.js";
import { triangleFromGrid } from "../src/triangle.js";
import { ReservingError } from "../src/types.js";

/**
 * Hand-computed closed-form validation for ASOP 20 discounting.
 *
 * Base triangle: ages 12/24/36, LDFs [1.6, 1.25], tail 1.0 ->
 * cdfs [2.0, 1.25, 1.0], percent developed [0.5, 0.8, 1.0].
 * - 2023: latest 200 @ 36 -> ultimate 200, unpaid 0, no future cash.
 * - 2024: latest 192 @ 24 -> ultimate 240, unpaid 48 = one payment of 48
 *   in (0, 12] months.
 * - 2025: latest 150 @ 12 -> ultimate 300, unpaid 150 = 90 in (0, 12]
 *   plus 60 in (12, 24].
 */

const AGES = [12, 24, 36];
const paidTri = triangleFromGrid("paid", ["2023", "2024", "2025"], AGES, [
  [100, 160, 200],
  [120, 192, null],
  [150, null, null],
]);
const cl = runChainLadder(paidTri, { selected: [1.6, 1.25], tailFactor: 1 });
const pattern = payoutPatternFromChainLadder(cl, AGES);

const provenance = { source: "US Treasury CMT curve", asOfDate: "2026-06-30" };

function expectCode(
  code:
    | "BAD_CASHFLOWS"
    | "BAD_RATE"
    | "BAD_DATE"
    | "BAD_MARGIN"
    | "NO_PROVENANCE"
    | "NO_DATA"
    | "SHAPE",
  fn: () => unknown,
): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ReservingError);
  expect((thrown as ReservingError).code).toBe(code);
}

describe("payoutPatternFromChainLadder", () => {
  it("derives per-origin future increments from CDF differences applied to unpaid", () => {
    expect(pattern.rows).toHaveLength(3);

    const r2023 = pattern.rows[0]!;
    expect(r2023.cashflows).toHaveLength(0);
    expect(r2023.unpaid).toBeCloseTo(0, 12);

    const r2024 = pattern.rows[1]!;
    expect(r2024.cashflows).toHaveLength(1);
    expect(r2024.cashflows[0]).toEqual({ fromMonths: 0, toMonths: 12, amount: expect.any(Number) });
    expect(r2024.cashflows[0]!.amount).toBeCloseTo(48, 10);

    const r2025 = pattern.rows[2]!;
    expect(r2025.cashflows).toHaveLength(2);
    expect(r2025.cashflows[0]!.amount).toBeCloseTo(90, 10); // 300 x (0.8 - 0.5)
    expect(r2025.cashflows[1]!.amount).toBeCloseTo(60, 10); // 300 x (1.0 - 0.8)
    expect(r2025.cashflows[1]!.fromMonths).toBe(12);
    expect(r2025.cashflows[1]!.toMonths).toBe(24);
    expect(pattern.warnings).toHaveLength(0);
  });

  it("every row's cashflows sum to its chain ladder unpaid (tie-out identity)", () => {
    for (const row of pattern.rows) {
      const sum = row.cashflows.reduce((a, c) => a + c.amount, 0);
      expect(sum).toBeCloseTo(row.unpaid, 10);
    }
  });

  it("compresses tail cash into one last-step-width interval after the last age, warned", () => {
    const tri = triangleFromGrid("paid", ["2025"], [12, 24], [[100, null]]);
    const tailCl = runChainLadder(tri, { selected: [2.0], tailFactor: 1.25 });
    // cdfs [2.5, 1.25], pct [0.4, 0.8]; ultimate 250, unpaid 150.
    const p = payoutPatternFromChainLadder(tailCl, [12, 24]);
    const row = p.rows[0]!;
    expect(row.cashflows).toHaveLength(2);
    expect(row.cashflows[0]!.amount).toBeCloseTo(100, 10); // 250 x (0.8 - 0.4)
    expect(row.cashflows[1]).toMatchObject({ fromMonths: 12, toMonths: 24 });
    expect(row.cashflows[1]!.amount).toBeCloseTo(50, 10); // 250 x (1 - 0.8)
    expect(row.cashflows.reduce((a, c) => a + c.amount, 0)).toBeCloseTo(150, 10);
    expect(p.warnings.join("\n")).toContain("compressed");
  });

  it("keeps negative increments (LDF below 1) with a warning, never drops them", () => {
    const tri = triangleFromGrid("paid", ["2025"], [12, 24], [[100, null]]);
    const downCl = runChainLadder(tri, { selected: [0.8], tailFactor: 1 });
    const p = payoutPatternFromChainLadder(downCl, [12, 24]);
    expect(p.rows[0]!.cashflows[0]!.amount).toBeCloseTo(-20, 10); // 80 x (1 - 1.25)
    expect(p.warnings.join("\n")).toContain("negative");
  });

  it("throws SHAPE for mismatched or malformed ages", () => {
    expectCode("SHAPE", () => payoutPatternFromChainLadder(cl, [12, 24]));
    expectCode("SHAPE", () => payoutPatternFromChainLadder(cl, [12, 24, 24]));
    expectCode("SHAPE", () => payoutPatternFromChainLadder(cl, [36, 24, 12]));
    // Ages that don't contain a row's latest age.
    expectCode("SHAPE", () => payoutPatternFromChainLadder(cl, [6, 18, 30]));
  });
});

describe("discountUnpaid: flat-rate closed forms", () => {
  it("end-period: single payment of 100 one year out discounts to 100/1.05", () => {
    const result = discountUnpaid({
      cashflows: [{ origin: "2025", cashflows: [{ fromMonths: 0, toMonths: 12, amount: 100 }] }],
      rates: { kind: "flat", annualRate: 0.05 },
      provenance,
      convention: "end-period",
    });
    expect(result.rows[0]!.nominal).toBeCloseTo(100, 12);
    expect(result.rows[0]!.discounted).toBeCloseTo(100 / 1.05, 10);
    expect(result.rows[0]!.discount).toBeCloseTo(100 - 100 / 1.05, 10);
    expect(result.rows[0]!.effectiveDiscountFactor!).toBeCloseTo(1 / 1.05, 10);
    expect(result.rows[0]!.cashflows[0]!.timeYears).toBeCloseTo(1, 12);
  });

  it("mid-period: the same payment discounts to 100/1.05^0.5 (t = half a year)", () => {
    const result = discountUnpaid({
      cashflows: [{ origin: "2025", cashflows: [{ fromMonths: 0, toMonths: 12, amount: 100 }] }],
      rates: { kind: "flat", annualRate: 0.05 },
      provenance,
      convention: "mid-period",
    });
    expect(result.rows[0]!.discounted).toBeCloseTo(100 / 1.05 ** 0.5, 10);
    expect(result.rows[0]!.cashflows[0]!.timeYears).toBeCloseTo(0.5, 12);
  });

  it("multi-period pattern: nominal and discounted side by side, per origin and total", () => {
    const result = discountUnpaid({
      pattern,
      rates: { kind: "flat", annualRate: 0.05 },
      provenance,
      convention: "end-period",
    });
    const [r2023, r2024, r2025] = result.rows;
    expect(r2023!.nominal).toBeCloseTo(0, 10);
    expect(r2023!.discounted).toBeCloseTo(0, 10);
    expect(r2023!.effectiveDiscountFactor).toBeNull();
    expect(r2024!.discounted).toBeCloseTo(48 / 1.05, 10);
    expect(r2025!.discounted).toBeCloseTo(90 / 1.05 + 60 / 1.05 ** 2, 10);
    expect(r2025!.effectiveDiscountFactor!).toBeCloseTo(
      (90 / 1.05 + 60 / 1.05 ** 2) / 150,
      10,
    );
    expect(result.totals.nominal).toBeCloseTo(198, 10);
    expect(result.totals.discounted).toBeCloseTo(138 / 1.05 + 60 / 1.05 ** 2, 10);
    expect(result.totals.discount).toBeCloseTo(
      198 - (138 / 1.05 + 60 / 1.05 ** 2),
      10,
    );
    // Nominal per origin ties exactly to the chain ladder unpaid.
    cl.rows.forEach((clRow, i) => {
      expect(result.rows[i]!.nominal).toBeCloseTo(clRow.unpaid, 10);
    });
  });

  it("mid-period discounts less than end-period at a positive rate (property)", () => {
    const base = {
      pattern,
      rates: { kind: "flat", annualRate: 0.05 } as const,
      provenance,
    };
    const end = discountUnpaid({ ...base, convention: "end-period" });
    const mid = discountUnpaid({ ...base, convention: "mid-period" });
    expect(mid.totals.discounted).toBeGreaterThan(end.totals.discounted);
    expect(mid.totals.nominal).toBeCloseTo(end.totals.nominal, 12);
  });

  it("a zero rate discounts nothing (effective factor 1)", () => {
    const result = discountUnpaid({
      pattern,
      rates: { kind: "flat", annualRate: 0 },
      provenance,
      convention: "end-period",
    });
    expect(result.totals.discounted).toBeCloseTo(result.totals.nominal, 10);
    expect(result.totals.effectiveDiscountFactor!).toBeCloseTo(1, 12);
  });
});

describe("discountUnpaid: spot curve", () => {
  it("each payment uses the spot rate for the year containing it", () => {
    const result = discountUnpaid({
      pattern,
      rates: { kind: "curve", spotByYear: [0.03, 0.05] },
      provenance,
      convention: "end-period",
    });
    // 2024: 48 at t=1 -> 3%; 2025: 90 at t=1 -> 3%, 60 at t=2 -> 5%.
    expect(result.rows[1]!.discounted).toBeCloseTo(48 / 1.03, 10);
    expect(result.rows[2]!.discounted).toBeCloseTo(90 / 1.03 + 60 / 1.05 ** 2, 10);
    expect(result.warnings).toHaveLength(0);
  });

  it("mid-period year assignment: t = 0.5 and t = 1.5 fall in years 1 and 2", () => {
    const result = discountUnpaid({
      cashflows: [
        {
          origin: "2025",
          cashflows: [
            { fromMonths: 0, toMonths: 12, amount: 90 },
            { fromMonths: 12, toMonths: 24, amount: 60 },
          ],
        },
      ],
      rates: { kind: "curve", spotByYear: [0.03, 0.05] },
      provenance,
      convention: "mid-period",
    });
    expect(result.rows[0]!.discounted).toBeCloseTo(90 / 1.03 ** 0.5 + 60 / 1.05 ** 1.5, 10);
  });

  it("warns and uses the last spot rate for cash beyond the curve horizon", () => {
    const result = discountUnpaid({
      pattern,
      rates: { kind: "curve", spotByYear: [0.04] },
      provenance,
      convention: "end-period",
    });
    // 2025's 60 at t=2 exceeds the 1-year horizon -> last rate 4%.
    expect(result.rows[2]!.discounted).toBeCloseTo(90 / 1.04 + 60 / 1.04 ** 2, 10);
    expect(result.warnings.join("\n")).toContain("horizon");
  });
});

describe("discountUnpaid: risk margin stays explicit and unblended", () => {
  const base: DiscountUnpaidInput = {
    pattern,
    rates: { kind: "flat", annualRate: 0.05 },
    provenance,
    convention: "end-period",
  };

  it("carries the margin through untouched and out of every total", () => {
    const without = discountUnpaid(base);
    const withMargin = discountUnpaid({ ...base, riskMargin: 25 });
    expect(withMargin.riskMargin).toBe(25);
    expect(without.riskMargin).toBeNull();
    expect(withMargin.totals).toEqual(without.totals);
    expect(withMargin.rows).toEqual(without.rows);
  });

  it("throws BAD_MARGIN for a negative or non-finite margin", () => {
    expectCode("BAD_MARGIN", () => discountUnpaid({ ...base, riskMargin: -5 }));
    expectCode("BAD_MARGIN", () => discountUnpaid({ ...base, riskMargin: Number.NaN }));
  });
});

describe("discountUnpaid: warnings and validation", () => {
  const flat = { kind: "flat", annualRate: 0.05 } as const;

  it("warns on negative cashflows and discounts them as-is", () => {
    const result = discountUnpaid({
      cashflows: [{ origin: "2025", cashflows: [{ fromMonths: 0, toMonths: 12, amount: -20 }] }],
      rates: flat,
      provenance,
      convention: "end-period",
    });
    expect(result.rows[0]!.discounted).toBeCloseTo(-20 / 1.05, 10);
    expect(result.rows[0]!.effectiveDiscountFactor).toBeNull(); // nominal not positive
    expect(result.warnings.join("\n")).toContain("Negative expected cashflows");
  });

  it("requires exactly one cashflow source (BAD_CASHFLOWS)", () => {
    const common = { rates: flat, provenance, convention: "end-period" as const };
    expectCode("BAD_CASHFLOWS", () => discountUnpaid({ ...common }));
    expectCode("BAD_CASHFLOWS", () => discountUnpaid({ ...common, pattern, cashflows: [] }));
  });

  it("rejects malformed cashflows (BAD_CASHFLOWS) and empty input (NO_DATA)", () => {
    const common = { rates: flat, provenance, convention: "end-period" as const };
    expectCode("NO_DATA", () => discountUnpaid({ ...common, cashflows: [] }));
    expectCode("BAD_CASHFLOWS", () =>
      discountUnpaid({
        ...common,
        cashflows: [{ origin: "x", cashflows: [{ fromMonths: -1, toMonths: 12, amount: 1 }] }],
      }),
    );
    expectCode("BAD_CASHFLOWS", () =>
      discountUnpaid({
        ...common,
        cashflows: [{ origin: "x", cashflows: [{ fromMonths: 12, toMonths: 6, amount: 1 }] }],
      }),
    );
    expectCode("BAD_CASHFLOWS", () =>
      discountUnpaid({
        ...common,
        cashflows: [
          { origin: "x", cashflows: [{ fromMonths: 0, toMonths: 12, amount: Number.NaN }] },
        ],
      }),
    );
  });

  it("rejects bad rates (BAD_RATE)", () => {
    const common = { pattern, provenance, convention: "end-period" as const };
    expectCode("BAD_RATE", () =>
      discountUnpaid({ ...common, rates: { kind: "flat", annualRate: Number.NaN } }),
    );
    expectCode("BAD_RATE", () =>
      discountUnpaid({ ...common, rates: { kind: "flat", annualRate: -1 } }),
    );
    expectCode("BAD_RATE", () => discountUnpaid({ ...common, rates: { kind: "curve", spotByYear: [] } }));
    expectCode("BAD_RATE", () =>
      discountUnpaid({ ...common, rates: { kind: "curve", spotByYear: [0.03, Number.NaN] } }),
    );
  });

  it("requires rate provenance (NO_PROVENANCE) with a valid ISO asOfDate (BAD_DATE)", () => {
    const common = { pattern, rates: flat, convention: "end-period" as const };
    expectCode("NO_PROVENANCE", () =>
      discountUnpaid({ ...common, provenance: undefined as unknown as typeof provenance }),
    );
    expectCode("NO_PROVENANCE", () =>
      discountUnpaid({ ...common, provenance: { source: "   ", asOfDate: "2026-06-30" } }),
    );
    expectCode("BAD_DATE", () =>
      discountUnpaid({ ...common, provenance: { source: "curve", asOfDate: "June 30, 2026" } }),
    );
    expectCode("BAD_DATE", () =>
      discountUnpaid({ ...common, provenance: { source: "curve", asOfDate: "2026-13-01" } }),
    );
  });

  it("echoes convention, rates, and provenance for the ASOP 20 disclosure trail", () => {
    const result = discountUnpaid({
      pattern,
      rates: flat,
      provenance,
      convention: "mid-period",
    });
    expect(result.convention).toBe("mid-period");
    expect(result.rates).toEqual(flat);
    expect(result.provenance).toEqual(provenance);
  });

  it("pattern warnings stay on the pattern; discount warnings are discount-stage only", () => {
    const noisyPattern: PayoutPattern = {
      rows: [
        {
          origin: "2025",
          latestAge: 12,
          unpaid: 100,
          cashflows: [{ fromMonths: 0, toMonths: 12, amount: 100 }],
        },
      ],
      warnings: ["pattern-stage warning"],
    };
    const result = discountUnpaid({
      pattern: noisyPattern,
      rates: flat,
      provenance,
      convention: "end-period",
    });
    expect(result.warnings).toHaveLength(0);
  });
});
