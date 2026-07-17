import type { BornhuetterFergusonResult, ChainLadderResult } from "./types.js";
import { ReservingError } from "./types.js";

/**
 * Benktander-Hovinen method (the "iterated Bornhuetter-Ferguson").
 *
 * Ground truth (Mack 2000, "Credible Claims Reserves: The Benktander
 * Method", ASTIN Bulletin 30(2)):
 * - With q = 1 - 1/CDF (the expected unreported/unpaid fraction) and C the
 *   losses to date: U_GB = C + q x U_BF — Bornhuetter-Ferguson applied once
 *   more, with the BF ultimate as the a-priori.
 * - Equivalently a credibility mixture U_GB = (1-q) x U_CL + q x U_BF with
 *   credibility Z = 1-q on the chain ladder: mature periods lean on CL,
 *   green periods lean on the a-priori — automatically.
 * - Mack (2000) shows U_GB has a smaller mean squared error than both CL and
 *   BF over a wide parameter range; it is the standard "use both" answer.
 *
 * Rows are the BF result's rows (BF excludes origins with no usable
 * premium; those stay excluded here). CDFs below 1 (incurred bases with
 * expected downward development) make q negative — the estimator still
 * evaluates, but it is an extrapolation past the chain ladder rather than a
 * mixture, and the result says so in warnings.
 */

export interface BenktanderRow {
  origin: string;
  latestValue: number;
  cdf: number;
  /** Credibility on the chain ladder: Z = 1 - q = 1/CDF. */
  credibilityZ: number;
  clUltimate: number;
  bfUltimate: number;
  ultimate: number;
  unpaid: number;
}

export interface BenktanderResult {
  method: "benktander";
  basis: BornhuetterFergusonResult["basis"];
  rows: BenktanderRow[];
  totals: { latest: number; ultimate: number; unpaid: number };
  warnings: string[];
}

export function runBenktander(
  chainLadder: ChainLadderResult,
  bf: BornhuetterFergusonResult,
): BenktanderResult {
  const warnings: string[] = [];
  const clByOrigin = new Map(chainLadder.rows.map((r) => [r.origin, r]));

  const rows: BenktanderRow[] = bf.rows.map((bfRow) => {
    const cl = clByOrigin.get(bfRow.origin);
    if (!cl) {
      throw new ReservingError(
        "SHAPE",
        `Origin ${bfRow.origin} is in the Bornhuetter-Ferguson result but missing from the chain ladder result; both must come from the same run`,
      );
    }
    const q = 1 - 1 / bfRow.cdf;
    if (q < 0) {
      warnings.push(
        `Origin ${bfRow.origin}: CDF ${bfRow.cdf.toFixed(3)} is below 1, so Benktander extrapolates past the chain ladder rather than blending (expected downward development)`,
      );
    }
    const ultimate = bfRow.latestValue + q * bfRow.ultimate;
    return {
      origin: bfRow.origin,
      latestValue: bfRow.latestValue,
      cdf: bfRow.cdf,
      credibilityZ: 1 - q,
      clUltimate: cl.ultimate,
      bfUltimate: bfRow.ultimate,
      ultimate,
      unpaid: ultimate - bfRow.latestValue,
    };
  });

  return {
    method: "benktander",
    basis: bf.basis,
    rows,
    totals: {
      latest: rows.reduce((a, r) => a + r.latestValue, 0),
      ultimate: rows.reduce((a, r) => a + r.ultimate, 0),
      unpaid: rows.reduce((a, r) => a + r.unpaid, 0),
    },
    warnings,
  };
}
