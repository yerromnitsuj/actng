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
  /**
   * The ELR governing THIS origin at the target level. With decay = 1 it is
   * the single pooled Cape Cod ELR (same for every row); with decay < 1 it
   * is the origin's own decay-weighted average (Gluck 1997).
   */
  elrAtTargetLevel: number;
  /** elrAtTargetLevel restated to this origin's own level. */
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
        `Origin ${r.origin}: the exposure base (earned premium or exposure units) must be positive`,
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
 *
 * Generalized Cape Cod (Gluck 1997, PCAS LXXXIV, eq. 6.1): with a decay
 * factor D in [0, 1], each origin gets its OWN target-level ELR — the
 * weighted average over all origins with weights usedUp_j x D^|i-j|
 * (distance in origin-row steps). D = 1 is the standard Cape Cod (single
 * pooled ELR); D = 0 makes every year stand alone, reproducing the pure
 * development ultimate. Gluck's practical guidance: D between 0.50 and
 * 1.00, with 0.75 as a customary default; lower D suits large stable books
 * (trend error dominates), higher D suits small erratic ones (development
 * error dominates).
 */
export function runCapeCod(
  rows: ElrMethodRow[],
  opts: { baseIsPurePremium?: boolean; decay?: number } = {},
): CapeCodResult {
  validateRows(rows);
  const warnings: string[] = [];
  const decay = opts.decay ?? 1;
  if (!isNum(decay) || decay < 0 || decay > 1) {
    throw new ReservingError("BAD_ADJ", `The decay factor must be between 0 and 1 (got ${decay})`);
  }

  const losses = rows.map((r) => r.reported * (r.lossAdj ?? 1));
  const usedUps = rows.map((r) => (r.premium * (r.premiumAdj ?? 1)) / r.cdf);
  let lossSum = 0;
  let usedUpSum = 0;
  for (let j = 0; j < rows.length; j++) {
    lossSum += losses[j]!;
    usedUpSum += usedUps[j]!;
  }
  if (!(usedUpSum > 0)) {
    throw new ReservingError("BAD_PREMIUM", "Used-up premium is not positive");
  }
  const pooledElr = lossSum / usedUpSum;

  // Per-origin target-level ELR: pooled when D = 1 (same float, same code
  // path — the published Cape Cod behavior must stay byte-identical), the
  // Gluck decay-weighted average otherwise. 0^0 = 1 in JS, so D = 0 cleanly
  // reduces to "own year only".
  const elrByRow: number[] = rows.map((_, i) => {
    if (decay === 1) return pooledElr;
    let num = 0;
    let den = 0;
    for (let j = 0; j < rows.length; j++) {
      const w = decay ** Math.abs(i - j);
      num += losses[j]! * w;
      den += usedUps[j]! * w;
    }
    if (!(den > 0)) {
      throw new ReservingError(
        "BAD_PREMIUM",
        `Origin ${rows[i]!.origin}: decayed used-up premium is not positive`,
      );
    }
    return num / den;
  });

  if (rows.some((r) => r.cdf < 1)) {
    warnings.push(
      "Some origins have CDFs below 1 (expected downward development): their Cape Cod provision is an expected take-down, standard for incurred bases with case redundancy",
    );
  }
  // A pure premium (losses per exposure unit) is a dollar amount, not a ratio,
  // so the "ELR looks too high" sanity check only applies to the loss-ratio base.
  if (!opts.baseIsPurePremium && pooledElr > 2) {
    warnings.push(
      `Cape Cod mechanical ELR is ${(pooledElr * 100).toFixed(0)}% - check that premium and losses are on comparable levels`,
    );
  }

  const out: CapeCodRow[] = rows.map((r, i) => {
    const lossAdj = r.lossAdj ?? 1;
    const premiumAdj = r.premiumAdj ?? 1;
    const usedUp = (r.premium * premiumAdj) / r.cdf;
    const elrAtTargetLevel = elrByRow[i]!;
    const elrAtOriginLevel = (elrAtTargetLevel * premiumAdj) / lossAdj;
    const expectedUltimate = elrAtOriginLevel * r.premium;
    const ultimate = r.reported + expectedUltimate * (1 - 1 / r.cdf);
    return {
      origin: r.origin,
      reported: r.reported,
      cdf: r.cdf,
      premium: r.premium,
      usedUpPremium: usedUp,
      elrAtTargetLevel,
      elrAtOriginLevel,
      expectedUltimate,
      ultimate,
      ibnrToReported: ultimate - r.reported,
    };
  });

  return {
    method: "capeCod",
    // With decay < 1 there is no single ELR; the scalar is the pooled (D=1)
    // reference value. Per-row elrAtTargetLevel drives the ultimates.
    elrAtTargetLevel: pooledElr,
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
