import { ReservingError } from "./types.js";
import { isNum } from "./util.js";

/**
 * Expected-loss-ratio methods (Friedland ch. 8 and 10).
 *
 * Cape Cod (Stanard-Buhlmann) derives its ELR mechanically from the data:
 * ELR* = sum(adjusted reported) / sum(adjusted used-up premium), where the
 * per-origin adjustment factors bring losses and premium to a common (target)
 * cost and rate level. Expected unreported for each origin then comes from
 * the ELR restated to THAT origin's own level.
 *
 * The Expected Claims method applies a selected ELR (at target level) the
 * same way, with no reliance on the origin's own emerged losses.
 */

export interface ElrMethodRow {
  origin: string;
  /** Reported (or paid) losses on the latest diagonal, the method's basis. */
  reported: number;
  /** Cumulative development factor to ultimate for this origin's age. */
  cdf: number;
  /** Earned premium for the origin (raw). */
  premium: number;
  /**
   * Factor bringing this origin's LOSSES to the target cost level
   * (e.g. (1+sevTrend)^(target-year) x uncap adjustment). Default 1.
   */
  lossAdj?: number;
  /**
   * Factor bringing this origin's PREMIUM to the target rate/cost level
   * (on-level factor x premium trend). Default 1.
   */
  premiumAdj?: number;
}

export interface CapeCodRow {
  origin: string;
  reported: number;
  cdf: number;
  premium: number;
  usedUpPremium: number;
  /** The mechanical ELR restated to this origin's own level. */
  elrAtOriginLevel: number;
  expectedUltimate: number;
  ultimate: number;
  ibnrToReported: number;
}

export interface CapeCodResult {
  method: "capeCod";
  /** The mechanical ELR at the TARGET (adjusted) level. */
  elrAtTargetLevel: number;
  rows: CapeCodRow[];
  totals: { reported: number; ultimate: number; usedUpPremium: number };
  warnings: string[];
}

function validateRows(rows: ElrMethodRow[]): void {
  if (rows.length === 0) {
    throw new ReservingError("NO_DATA", "ELR methods need at least one origin row");
  }
  for (const r of rows) {
    // CDFs below 1 are legitimate on incurred bases (case run-off develops
    // reported incurred DOWNWARD); the methods then post an expected
    // take-down rather than a provision. Only non-positive CDFs are garbage.
    if (!isNum(r.cdf) || r.cdf <= 0) {
      throw new ReservingError(
        "BAD_CDF",
        `Origin ${r.origin}: the CDF to ultimate must be positive (got ${r.cdf})`,
      );
    }
    if (!isNum(r.premium) || r.premium <= 0) {
      throw new ReservingError(
        "BAD_PREMIUM",
        `Origin ${r.origin}: earned premium must be positive`,
      );
    }
    if (!isNum(r.reported) || r.reported < 0) {
      throw new ReservingError("BAD_LOSSES", `Origin ${r.origin}: reported must be >= 0`);
    }
    const lossAdj = r.lossAdj ?? 1;
    const premiumAdj = r.premiumAdj ?? 1;
    if (!isNum(lossAdj) || lossAdj <= 0 || !isNum(premiumAdj) || premiumAdj <= 0) {
      throw new ReservingError(
        "BAD_ADJ",
        `Origin ${r.origin}: adjustment factors must be positive`,
      );
    }
  }
}

/**
 * Cape Cod: ELR* = sum(reported x lossAdj) / sum(premium x premiumAdj / cdf).
 * Ultimate_i = reported_i + expectedUltimate_i x (1 - 1/cdf_i), with
 * expectedUltimate_i = ELR* x premium_i x premiumAdj_i / lossAdj_i (the
 * target-level ELR restated to origin i's own level, times its premium).
 */
export function runCapeCod(rows: ElrMethodRow[]): CapeCodResult {
  validateRows(rows);
  const warnings: string[] = [];

  let lossSum = 0;
  let usedUpSum = 0;
  for (const r of rows) {
    lossSum += r.reported * (r.lossAdj ?? 1);
    usedUpSum += (r.premium * (r.premiumAdj ?? 1)) / r.cdf;
  }
  if (!(usedUpSum > 0)) {
    throw new ReservingError("BAD_PREMIUM", "Used-up premium is not positive");
  }
  const elr = lossSum / usedUpSum;
  if (rows.some((r) => r.cdf < 1)) {
    warnings.push(
      "Some origins have CDFs below 1 (expected downward development): their Cape Cod provision is an expected take-down, standard for incurred bases with case redundancy",
    );
  }
  if (elr > 2) {
    warnings.push(
      `Cape Cod mechanical ELR is ${(elr * 100).toFixed(0)}% - check that premium and losses are on comparable levels`,
    );
  }

  const out: CapeCodRow[] = rows.map((r) => {
    const lossAdj = r.lossAdj ?? 1;
    const premiumAdj = r.premiumAdj ?? 1;
    const usedUp = (r.premium * premiumAdj) / r.cdf;
    const elrAtOriginLevel = (elr * premiumAdj) / lossAdj;
    const expectedUltimate = elrAtOriginLevel * r.premium;
    const ultimate = r.reported + expectedUltimate * (1 - 1 / r.cdf);
    return {
      origin: r.origin,
      reported: r.reported,
      cdf: r.cdf,
      premium: r.premium,
      usedUpPremium: usedUp,
      elrAtOriginLevel,
      expectedUltimate,
      ultimate,
      ibnrToReported: ultimate - r.reported,
    };
  });

  return {
    method: "capeCod",
    elrAtTargetLevel: elr,
    rows: out,
    totals: {
      reported: out.reduce((a, r) => a + r.reported, 0),
      ultimate: out.reduce((a, r) => a + r.ultimate, 0),
      usedUpPremium: out.reduce((a, r) => a + r.usedUpPremium, 0),
    },
    warnings,
  };
}

export interface ExpectedClaimsRow {
  origin: string;
  premium: number;
  elrAtOriginLevel: number;
  ultimate: number;
}

export interface ExpectedClaimsResult {
  method: "expectedClaims";
  /** The selected ELR at the target level the caller supplied. */
  selectedElrAtTargetLevel: number;
  rows: ExpectedClaimsRow[];
  totals: { ultimate: number };
  warnings: string[];
}

/**
 * Expected Claims: ultimate_i = selectedELR (target level) restated to the
 * origin's level (x premiumAdj_i / lossAdj_i) x premium_i. Pure a-priori -
 * the origin's own emerged losses never enter.
 */
export function runExpectedClaims(
  rows: ElrMethodRow[],
  selectedElrAtTargetLevel: number,
): ExpectedClaimsResult {
  validateRows(rows);
  if (!isNum(selectedElrAtTargetLevel) || selectedElrAtTargetLevel <= 0) {
    throw new ReservingError("BAD_ELR", "The selected ELR must be a positive number");
  }
  const out: ExpectedClaimsRow[] = rows.map((r) => {
    const elrAtOriginLevel =
      (selectedElrAtTargetLevel * (r.premiumAdj ?? 1)) / (r.lossAdj ?? 1);
    return {
      origin: r.origin,
      premium: r.premium,
      elrAtOriginLevel,
      ultimate: elrAtOriginLevel * r.premium,
    };
  });
  return {
    method: "expectedClaims",
    selectedElrAtTargetLevel,
    rows: out,
    totals: { ultimate: out.reduce((a, r) => a + r.ultimate, 0) },
    warnings: [],
  };
}
