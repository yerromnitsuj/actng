/**
 * Actual-vs-expected roll-forward: the back-test that asks "did losses emerge
 * between the prior and current valuations the way the prior analysis
 * expected?" — the standard bridge exhibit for the ASOP 41 changes-from-prior
 * discussion and for judging whether prior assumptions still hold (ASOP 43).
 *
 * Ground truth (per origin):
 * - expectedEmergence = priorUltimate x (expectedPercentAtCurrent - expectedPercentAtPrior)
 * - actualEmergence   = currentLatest - priorLatest
 * - difference        = actualEmergence - expectedEmergence (positive = worse
 *   than expected on a loss basis)
 * - ratio             = actualEmergence / expectedEmergence, and null — never
 *   NaN or Infinity — when expectedEmergence is 0, matching core's
 *   null-safety philosophy (no factor, not an exception).
 * - totals sum the rows; the total ratio follows the same null rule.
 * - Suspicious inputs produce WARNINGS, not errors: a development pattern
 *   that goes backwards (expectedPercentAtCurrent < expectedPercentAtPrior)
 *   or a percent outside [0, 1.05] is reportable, but the arithmetic is still
 *   well-defined and the actuary decides what it means. (Slightly above 1 is
 *   legitimate: paid patterns can overshoot ultimate before salvage/subro.)
 *
 * Errors follow the package's ComplianceError style (see bundle.ts):
 * `percentDevelopedFromCdfs` throws BAD_CDF on a non-positive or non-finite
 * CDF because no percent-developed interpretation exists for it.
 *
 * These utilities are designed to support the actuary's compliance with
 * ASOP Nos. 41 and 43; responsibility for compliance remains with the
 * credentialed actuary.
 */

import { ComplianceError } from "./bundle.js";

export interface AveInputRow {
  /** Origin period label (e.g. "2021"). */
  origin: string;
  /** The prior analysis's selected ultimate for this origin. */
  priorUltimate: number;
  /** Latest observed value (paid or incurred, matching the pattern basis) at the prior valuation. */
  priorLatest: number;
  /** Latest observed value at the current valuation, same basis as priorLatest. */
  currentLatest: number;
  /** Prior analysis's expected percent developed at the prior valuation age (fraction). */
  expectedPercentAtPrior: number;
  /** Prior analysis's expected percent developed at the current valuation age (fraction). */
  expectedPercentAtCurrent: number;
}

export interface AveResultRow {
  origin: string;
  expectedEmergence: number;
  actualEmergence: number;
  /** actualEmergence - expectedEmergence. */
  difference: number;
  /** actualEmergence / expectedEmergence; null when expectedEmergence is 0. */
  ratio: number | null;
}

export interface AveRollForwardResult {
  rows: AveResultRow[];
  totals: {
    expectedEmergence: number;
    actualEmergence: number;
    difference: number;
    /** Total actual / total expected; null when total expected is 0. */
    ratio: number | null;
  };
  warnings: string[];
}

/** Percents above this are flagged (slightly above 1 is legitimate; see doc block). */
const PERCENT_MAX = 1.05;

/** Rolls the prior analysis forward and compares expected to actual emergence per origin. */
export function aveRollForward(rows: AveInputRow[]): AveRollForwardResult {
  const outRows: AveResultRow[] = [];
  const warnings: string[] = [];
  let totalExpected = 0;
  let totalActual = 0;

  for (const row of rows) {
    const pctPrior = row.expectedPercentAtPrior;
    const pctCurrent = row.expectedPercentAtCurrent;
    if (pctCurrent < pctPrior) {
      warnings.push(
        `origin ${row.origin}: pattern goes backwards (expectedPercentAtCurrent ${pctCurrent} < expectedPercentAtPrior ${pctPrior})`,
      );
    }
    for (const [name, pct] of [
      ["expectedPercentAtPrior", pctPrior],
      ["expectedPercentAtCurrent", pctCurrent],
    ] as const) {
      if (pct < 0 || pct > PERCENT_MAX) {
        warnings.push(`origin ${row.origin}: ${name} ${pct} outside [0, ${PERCENT_MAX}]`);
      }
    }

    const expectedEmergence = row.priorUltimate * (pctCurrent - pctPrior);
    const actualEmergence = row.currentLatest - row.priorLatest;
    const difference = actualEmergence - expectedEmergence;
    const ratio = expectedEmergence === 0 ? null : actualEmergence / expectedEmergence;
    outRows.push({ origin: row.origin, expectedEmergence, actualEmergence, difference, ratio });
    totalExpected += expectedEmergence;
    totalActual += actualEmergence;
  }

  return {
    rows: outRows,
    totals: {
      expectedEmergence: totalExpected,
      actualEmergence: totalActual,
      difference: totalActual - totalExpected,
      ratio: totalExpected === 0 ? null : totalActual / totalExpected,
    },
    warnings,
  };
}

/**
 * Percent developed per age from a CDF vector: percent[j] = 1 / cdfs[j]
 * (cdfs[j] = cumulative factor from ages[j] to ultimate, tail included, per
 * core's ChainLadderResult convention). Convenience for pattern-based callers
 * building aveRollForward inputs. Throws ComplianceError("BAD_CDF") on a
 * non-positive or non-finite CDF.
 */
export function percentDevelopedFromCdfs(cdfs: number[]): number[] {
  return cdfs.map((cdf, index) => {
    if (!Number.isFinite(cdf) || cdf <= 0) {
      throw new ComplianceError("BAD_CDF", `cdf at index ${index} is ${cdf}; every CDF must be a finite number > 0`);
    }
    return 1 / cdf;
  });
}
