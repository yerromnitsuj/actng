import { describe, expect, it } from "vitest";
import { ULAE_WEIGHT_PRESETS, ulaeRatios, ulaeReserve } from "../src/ulae.js";
import type { UlaePeriodInput } from "../src/ulae.js";
import { ReservingError } from "../src/types.js";
import {
  cnAccidentYears,
  cnCalendarYears,
  cnExhibitB,
  cnExhibitC,
  cnExhibitD,
  cnExhibitE,
  cnExhibitF,
  cnTotals,
} from "./fixtures/congerNolibos2003.js";

/**
 * Published-dataset validation for Conger-Nolibos (2003), Exhibits A-F
 * (XYZ Insurance Company, ULAE reserves as of 12/31/2002, $000's).
 *
 * Ratios are printed to 3 decimals and reserves/bases to whole $000's, so
 * pins use toBeCloseTo(x, 3) for ratios and abs <= 0.5 for dollar figures.
 */

/** Exhibit D/E periods: R = ultimate cost of claims reported in the CY. */
const generalizedPeriods: UlaePeriodInput[] = cnCalendarYears.map((cy) => ({
  label: cy.label,
  ulaePaid: cy.M,
  reportedUltimate: cy.R,
  paid: cy.P,
  closedUltimate: 0, // u3 = 0 throughout the worked example (no closing effort)
}));

/**
 * Kittel periods: per Kittel's assumptions, R = CY REPORTED losses (no
 * future development) and C = CY PAID losses (no partial payments).
 */
const kittelPeriods: UlaePeriodInput[] = cnCalendarYears.map((cy) => ({
  label: cy.label,
  ulaePaid: cy.M,
  reportedUltimate: cy.reported,
  paid: cy.P,
  closedUltimate: cy.P,
}));

function expectCode(
  code: "BAD_WEIGHTS" | "BAD_LOSSES" | "BAD_RATIO" | "NO_DATA",
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

describe("ULAE ratios: Conger-Nolibos (2003) worked example", () => {
  it("reproduces Exhibit D (60/40/0): W = M/B per calendar year and in total", () => {
    const result = ulaeRatios(generalizedPeriods, cnExhibitD.weights);
    expect(result.rows).toHaveLength(6);
    cnExhibitD.bases.forEach((published, i) => {
      expect(Math.abs(result.rows[i]!.basis - published)).toBeLessThanOrEqual(0.5);
    });
    cnExhibitD.ratios.forEach((published, i) => {
      expect(result.rows[i]!.ratio!).toBeCloseTo(published, 3);
    });
    expect(Math.abs(result.totals.basis - cnExhibitD.totalBasis)).toBeLessThanOrEqual(0.5);
    expect(result.totals.ratio!).toBeCloseTo(cnExhibitD.totalRatio, 3);
    expect(result.totals.ulaePaid).toBe(cnTotals.ulaePaid);
  });

  it("reproduces Exhibit E (70/30/0)", () => {
    const result = ulaeRatios(generalizedPeriods, cnExhibitE.weights);
    cnExhibitE.bases.forEach((published, i) => {
      expect(Math.abs(result.rows[i]!.basis - published)).toBeLessThanOrEqual(0.5);
    });
    cnExhibitE.ratios.forEach((published, i) => {
      expect(result.rows[i]!.ratio!).toBeCloseTo(published, 3);
    });
    expect(Math.abs(result.totals.basis - cnExhibitE.totalBasis)).toBeLessThanOrEqual(0.5);
    expect(result.totals.ratio!).toBeCloseTo(cnExhibitE.totalRatio, 3);
  });

  it("reproduces Exhibit B (classical paid-to-paid preset: basis collapses to paid losses)", () => {
    const preset = ULAE_WEIGHT_PRESETS.classicalPaidToPaid;
    const result = ulaeRatios(generalizedPeriods, preset.weights, { basis: preset.basis });
    cnExhibitB.ratios.forEach((published, i) => {
      expect(result.rows[i]!.ratio!).toBeCloseTo(published, 3);
      expect(result.rows[i]!.basis).toBe(cnCalendarYears[i]!.P);
    });
    expect(result.totals.ratio!).toBeCloseTo(cnExhibitB.totalRatio, 3);
  });

  it("reproduces Exhibit C (Kittel preset: W = M / (50% x (paid + reported)))", () => {
    const preset = ULAE_WEIGHT_PRESETS.kittel;
    const result = ulaeRatios(kittelPeriods, preset.weights, { basis: preset.basis });
    cnExhibitC.ratios.forEach((published, i) => {
      expect(result.rows[i]!.ratio!).toBeCloseTo(published, 3);
    });
    expect(result.totals.ratio!).toBeCloseTo(cnExhibitC.totalRatio, 3);
  });

  it("reproduces Exhibit F (simplified: accident-year ultimate A substitutes for R when u3 = 0)", () => {
    const simplifiedPeriods = cnCalendarYears.map((cy, i) => ({
      label: cy.label,
      ulaePaid: cy.M,
      reportedUltimate: cnExhibitF.accidentYearUltimates[i]!,
      paid: cy.P,
      closedUltimate: 0,
    }));
    const result = ulaeRatios(simplifiedPeriods, cnExhibitF.weights);
    cnExhibitF.bases.forEach((published, i) => {
      expect(Math.abs(result.rows[i]!.basis - published)).toBeLessThanOrEqual(0.5);
    });
    cnExhibitF.ratios.forEach((published, i) => {
      expect(result.rows[i]!.ratio!).toBeCloseTo(published, 3);
    });
    expect(Math.abs(result.totals.basis - cnExhibitF.totalBasis)).toBeLessThanOrEqual(0.5);
    expect(result.totals.ratio!).toBeCloseTo(cnExhibitF.totalRatio, 3);
  });

  it("pins the paper's smallest self-contained slice (Exhibit D, 1997)", () => {
    const result = ulaeRatios(
      [{ label: "1997", ulaePaid: 1978, reportedUltimate: 27200, paid: 4590, closedUltimate: 0 }],
      { u1: 0.6, u2: 0.4, u3: 0 },
    );
    expect(result.rows[0]!.basis).toBeCloseTo(18156, 9);
    expect(result.rows[0]!.ratio!).toBeCloseTo(0.109, 3);
  });
});

describe("ULAE reserve: the three forms on the worked example", () => {
  const base = {
    ultimateLosses: cnTotals.ultimateLosses,
    reportedToDate: cnTotals.reportedUltimate, // R(t): sum of CY R columns
    paidToDate: cnTotals.paid,
    closedToDate: 0,
    ulaePaidToDate: cnTotals.ulaePaid,
  };

  it("reproduces Exhibit D's three reserves (expected / B-F / development)", () => {
    const expected = ulaeReserve({
      ...base,
      selectedW: cnExhibitD.selectedW,
      weights: cnExhibitD.weights,
      form: "expected",
    });
    expect(Math.abs(expected.unpaidUlae - cnExhibitD.reserves.expected)).toBeLessThanOrEqual(0.5);

    const bf = ulaeReserve({
      ...base,
      selectedW: cnExhibitD.selectedW,
      weights: cnExhibitD.weights,
      form: "bornhuetterFerguson",
    });
    expect(Math.abs(bf.unpaidUlae - cnExhibitD.reserves.bornhuetterFerguson)).toBeLessThanOrEqual(
      0.5,
    );
    // B-F form = W* x (L - B(t)).
    expect(bf.basisToDate).not.toBeNull();
    expect(bf.unpaidUlae).toBeCloseTo(
      cnExhibitD.selectedW * (cnTotals.ultimateLosses - bf.basisToDate!),
      9,
    );
    // Component split: opening on pure IBNR, maintaining on total unpaid.
    expect(bf.components!.opening).toBeCloseTo(
      cnExhibitD.selectedW * 0.6 * (cnTotals.ultimateLosses - cnTotals.reportedUltimate),
      9,
    );
    expect(bf.components!.maintaining).toBeCloseTo(
      cnExhibitD.selectedW * 0.4 * (cnTotals.ultimateLosses - cnTotals.paid),
      9,
    );
    expect(bf.components!.closing).toBe(0);

    const dev = ulaeReserve({
      ...base,
      selectedW: cnExhibitD.selectedW,
      weights: cnExhibitD.weights,
      form: "development",
    });
    expect(Math.abs(dev.unpaidUlae - cnExhibitD.reserves.development)).toBeLessThanOrEqual(0.5);
    expect(dev.warnings.join("\n")).toContain("overly responsive");
  });

  it("reproduces Exhibit E's reserves (the weight-sensitivity run)", () => {
    for (const [form, published] of [
      ["expected", cnExhibitE.reserves.expected],
      ["bornhuetterFerguson", cnExhibitE.reserves.bornhuetterFerguson],
      ["development", cnExhibitE.reserves.development],
    ] as const) {
      const result = ulaeReserve({
        ...base,
        selectedW: cnExhibitE.selectedW,
        weights: cnExhibitE.weights,
        form,
      });
      expect(Math.abs(result.unpaidUlae - published)).toBeLessThanOrEqual(0.5);
    }
  });

  it("reproduces Exhibits B and C reserves via the Kittel identity inputs", () => {
    // Kittel assumptions: R(t) = reported losses to date, C(t) = paid to date.
    const kittelInputs = {
      ultimateLosses: cnTotals.ultimateLosses,
      reportedToDate: cnTotals.reported,
      paidToDate: cnTotals.paid,
      closedToDate: cnTotals.paid,
      weights: ULAE_WEIGHT_PRESETS.kittel.weights,
      form: "bornhuetterFerguson",
    } as const;
    const classical = ulaeReserve({ ...kittelInputs, selectedW: cnExhibitB.selectedW });
    expect(Math.abs(classical.unpaidUlae - cnExhibitB.reserve)).toBeLessThanOrEqual(0.5);
    const kittel = ulaeReserve({ ...kittelInputs, selectedW: cnExhibitC.selectedW });
    expect(Math.abs(kittel.unpaidUlae - cnExhibitC.reserve)).toBeLessThanOrEqual(0.5);
  });

  it("satisfies the Kittel identity: B-F reserve = W* x (IBNR + 50% x case reserves)", () => {
    // Algebra: with u = (0.5, 0, 0.5) and C(t) = P(t),
    // W* [0.5(L - R) + 0.5(L - P)] = W* [(L - R) + 0.5(R - P)].
    const cases = [
      {
        W: 0.115,
        L: cnTotals.ultimateLosses,
        reported: cnTotals.reported,
        paid: cnTotals.paid,
      },
      { W: 0.2, L: 1000, reported: 800, paid: 500 },
      { W: 0.08, L: 44321, reported: 39876, paid: 21001 },
    ];
    for (const c of cases) {
      const result = ulaeReserve({
        selectedW: c.W,
        ultimateLosses: c.L,
        reportedToDate: c.reported,
        paidToDate: c.paid,
        closedToDate: c.paid,
        weights: ULAE_WEIGHT_PRESETS.kittel.weights,
        form: "bornhuetterFerguson",
      });
      const ibnr = c.L - c.reported;
      const caseReserves = c.reported - c.paid;
      expect(result.unpaidUlae).toBeCloseTo(c.W * (ibnr + 0.5 * caseReserves), 9);
    }
  });

  it("reproduces Exhibit F's reserves (pure-IBNR variants of the B-F form)", () => {
    for (const [pureIbnr, published] of [
      [cnExhibitF.pureIbnr.fourPercent, cnExhibitF.reserves.fourPercent],
      [cnExhibitF.pureIbnr.sixPercent, cnExhibitF.reserves.sixPercent],
    ] as const) {
      const result = ulaeReserve({
        selectedW: cnExhibitF.selectedW,
        ultimateLosses: cnTotals.ultimateLosses,
        // L - R(t) = estimated pure IBNR (the simplification's R substitute).
        reportedToDate: cnTotals.ultimateLosses - pureIbnr,
        paidToDate: cnTotals.paid,
        weights: cnExhibitF.weights,
        form: "bornhuetterFerguson",
      });
      expect(Math.abs(result.unpaidUlae - published)).toBeLessThanOrEqual(0.5);
    }
  });

  it("the exhibits' inputs tie out (fixture self-consistency)", () => {
    const totalM = cnCalendarYears.reduce((s, cy) => s + cy.M, 0);
    const totalP = cnCalendarYears.reduce((s, cy) => s + cy.P, 0);
    const totalReported = cnCalendarYears.reduce((s, cy) => s + cy.reported, 0);
    const totalR = cnCalendarYears.reduce((s, cy) => s + cy.R, 0);
    const totalL = cnAccidentYears.reduce((s, ay) => s + ay.ultimate, 0);
    expect(totalM).toBe(cnTotals.ulaePaid);
    expect(totalP).toBe(cnTotals.paid);
    expect(totalR).toBe(cnTotals.reportedUltimate);
    expect(totalL).toBe(cnTotals.ultimateLosses);
    // The paper's own printed totals carry a 1-unit rounding artifact: the
    // reported column sums to 599,548 but Exhibits A.1/A.2 print 599,547
    // (and the IBNR column sums to 113,852 vs the printed 113,853). The
    // fixture pins the PRINTED totals, which are internally consistent with
    // the printed case reserve and reserves.
    expect(Math.abs(totalReported - cnTotals.reported)).toBeLessThanOrEqual(1);
    expect(cnTotals.ibnr).toBe(cnTotals.ultimateLosses - cnTotals.reported);
    expect(cnTotals.caseReserve).toBe(cnTotals.reported - cnTotals.paid);
  });
});

describe("ULAE validation", () => {
  const okWeights = { u1: 0.6, u2: 0.4, u3: 0 };
  const okPeriod: UlaePeriodInput = {
    label: "2002",
    ulaePaid: 100,
    reportedUltimate: 900,
    paid: 700,
    closedUltimate: 650,
  };

  it("throws BAD_WEIGHTS for weights outside [0, 1], non-finite, or not summing to 1", () => {
    expectCode("BAD_WEIGHTS", () => ulaeRatios([okPeriod], { u1: 0.6, u2: 0.5, u3: 0 }));
    expectCode("BAD_WEIGHTS", () => ulaeRatios([okPeriod], { u1: -0.1, u2: 1.1, u3: 0 }));
    expectCode("BAD_WEIGHTS", () => ulaeRatios([okPeriod], { u1: Number.NaN, u2: 0.5, u3: 0.5 }));
    expectCode("BAD_WEIGHTS", () =>
      ulaeReserve({
        selectedW: 0.1,
        ultimateLosses: 100,
        weights: { u1: 0.2, u2: 0.2, u3: 0.2 },
        form: "expected",
        ulaePaidToDate: 5,
      }),
    );
  });

  it("throws BAD_LOSSES for negative monetary amounts (including negative M)", () => {
    expectCode("BAD_LOSSES", () => ulaeRatios([{ ...okPeriod, ulaePaid: -1 }], okWeights));
    expectCode("BAD_LOSSES", () => ulaeRatios([{ ...okPeriod, paid: -5 }], okWeights));
    expectCode("BAD_LOSSES", () =>
      ulaeReserve({
        selectedW: 0.1,
        ultimateLosses: -100,
        weights: okWeights,
        form: "expected",
        ulaePaidToDate: 5,
      }),
    );
    expectCode("BAD_LOSSES", () =>
      ulaeReserve({
        selectedW: 0.1,
        ultimateLosses: 100,
        weights: okWeights,
        form: "expected",
        ulaePaidToDate: -5,
      }),
    );
  });

  it("throws BAD_RATIO for a negative or non-finite selected W*", () => {
    expectCode("BAD_RATIO", () =>
      ulaeReserve({
        selectedW: -0.1,
        ultimateLosses: 100,
        weights: okWeights,
        form: "expected",
        ulaePaidToDate: 5,
      }),
    );
    expectCode("BAD_RATIO", () =>
      ulaeReserve({
        selectedW: Number.POSITIVE_INFINITY,
        ultimateLosses: 100,
        weights: okWeights,
        form: "expected",
        ulaePaidToDate: 5,
      }),
    );
  });

  it("throws NO_DATA for empty periods, missing weighted measures, or a non-positive development basis", () => {
    expectCode("NO_DATA", () => ulaeRatios([], okWeights));
    // reportedToDate omitted while u1 > 0 (B-F form needs it).
    expectCode("NO_DATA", () =>
      ulaeReserve({
        selectedW: 0.1,
        ultimateLosses: 100,
        paidToDate: 50,
        weights: okWeights,
        form: "bornhuetterFerguson",
      }),
    );
    // Expected form without ULAE paid to date.
    expectCode("NO_DATA", () =>
      ulaeReserve({
        selectedW: 0.1,
        ultimateLosses: 100,
        weights: okWeights,
        form: "expected",
      }),
    );
    // Development form with a zero basis.
    expectCode("NO_DATA", () =>
      ulaeReserve({
        selectedW: 0.1,
        ultimateLosses: 100,
        reportedToDate: 0,
        paidToDate: 0,
        closedToDate: 0,
        ulaePaidToDate: 5,
        weights: okWeights,
        form: "development",
      }),
    );
  });

  it("yields a null per-period ratio (with a warning) on a zero basis - house null-safety", () => {
    const result = ulaeRatios(
      [{ label: "empty", ulaePaid: 10, reportedUltimate: 0, paid: 0, closedUltimate: 0 }],
      okWeights,
    );
    expect(result.rows[0]!.ratio).toBeNull();
    expect(result.totals.ratio).toBeNull();
    expect(result.warnings.join("\n")).toContain("non-positive loss basis");
  });

  it("warns when the expected-form reserve goes negative instead of masking it", () => {
    const result = ulaeReserve({
      selectedW: 0.05,
      ultimateLosses: 100,
      ulaePaidToDate: 50,
      weights: okWeights,
      form: "expected",
    });
    expect(result.unpaidUlae).toBeCloseTo(-45, 9);
    expect(result.warnings.join("\n")).toContain("negative");
  });

  it("expected form ignores unavailable measures (basisToDate reported as null)", () => {
    const result = ulaeReserve({
      selectedW: 0.1,
      ultimateLosses: 100,
      ulaePaidToDate: 5,
      weights: okWeights,
      form: "expected",
    });
    expect(result.unpaidUlae).toBeCloseTo(5, 9);
    expect(result.basisToDate).toBeNull();
    expect(result.components).toBeNull();
  });
});
