import type { LdfSelections, Triangle } from "./types.js";
import { ReservingError } from "./types.js";
import { isNum, lastObservedIndex, safeRatio } from "./util.js";
import { runChainLadder } from "./chainladder.js";

/**
 * Frequency-severity ultimate method (Friedland, "Estimating Unpaid Claims
 * Using Basic Techniques", ch. 11, the development technique applied to
 * claim counts and average values).
 *
 * Ground truth:
 * - Ultimate claims_i = ultimate counts_i x ultimate severity_i.
 * - Ultimate counts: chain ladder on the (reported) count triangle with the
 *   caller's selected count LDFs and tail.
 * - Ultimate severity: chain ladder on the average-severity triangle
 *   (losses / counts, cell-wise and null-safe) with the caller's selected
 *   severity LDFs and tail — developing average values is the standard
 *   Friedland treatment.
 * - Selections are the CALLER's judgment on both bases, per the engine-wide
 *   rule; this module never picks factors.
 *
 * Caveat the caller must own (doc, not warning): severity here is per
 * REPORTED claim including closed-without-payment; a drifting CWP share
 * masquerades as severity development. Check closure diagnostics before
 * leaning on this method.
 */

export interface FrequencySeverityOptions {
  /** Selected count LDFs, one per development interval (null = unselected -> 1.000 with a warning). */
  countSelected: LdfSelections["selected"];
  countTailFactor?: number;
  /** Selected severity LDFs on the average-severity triangle. */
  severitySelected: LdfSelections["selected"];
  severityTailFactor?: number;
}

export interface FrequencySeverityRow {
  origin: string;
  /** Latest observed value on the LOSS triangle (the dollars basis). */
  latestValue: number;
  ultimateCounts: number;
  ultimateSeverity: number;
  ultimate: number;
  unpaid: number;
}

export interface FrequencySeverityResult {
  method: "frequencySeverity";
  basis: Triangle["kind"];
  rows: FrequencySeverityRow[];
  totals: { latest: number; ultimate: number; unpaid: number };
  warnings: string[];
}

/**
 * Average-severity triangle: cell-wise losses / counts. Null-safe: a
 * missing, zero, or negative count yields a null severity cell.
 */
export function severityTriangle(lossTri: Triangle, countTri: Triangle): Triangle {
  assertSameShape(lossTri, countTri);
  return {
    kind: lossTri.kind,
    origins: [...lossTri.origins],
    ages: [...lossTri.ages],
    values: lossTri.values.map((row, i) =>
      row.map((loss, j) => safeRatio(loss ?? null, countTri.values[i]![j] ?? null)),
    ),
  };
}

function assertSameShape(a: Triangle, b: Triangle): void {
  const sameOrigins =
    a.origins.length === b.origins.length && a.origins.every((o, i) => o === b.origins[i]);
  const sameAges = a.ages.length === b.ages.length && a.ages.every((v, i) => v === b.ages[i]);
  if (!sameOrigins || !sameAges) {
    throw new ReservingError(
      "SHAPE",
      "The loss and count triangles must share identical origins and development ages",
    );
  }
}

export function runFrequencySeverity(
  lossTri: Triangle,
  countTri: Triangle,
  options: FrequencySeverityOptions,
): FrequencySeverityResult {
  assertSameShape(lossTri, countTri);
  const warnings: string[] = [];

  const countCl = runChainLadder(countTri, {
    selected: options.countSelected,
    tailFactor: options.countTailFactor ?? 1,
  });
  for (const w of countCl.warnings) warnings.push(`counts: ${w}`);

  const sevTri = severityTriangle(lossTri, countTri);
  const sevCl = runChainLadder(sevTri, {
    selected: options.severitySelected,
    tailFactor: options.severityTailFactor ?? 1,
  });
  for (const w of sevCl.warnings) warnings.push(`severity: ${w}`);

  const countByOrigin = new Map(countCl.rows.map((r) => [r.origin, r]));
  const sevByOrigin = new Map(sevCl.rows.map((r) => [r.origin, r]));

  const rows: FrequencySeverityRow[] = [];
  for (let i = 0; i < lossTri.origins.length; i++) {
    const origin = lossTri.origins[i]!;
    const counts = countByOrigin.get(origin);
    const sev = sevByOrigin.get(origin);
    if (!counts || !sev) {
      warnings.push(
        `Origin ${origin} has no observed counts or severities; excluded from frequency-severity`,
      );
      continue;
    }
    const latestIdx = lastObservedIndex(lossTri.values[i]!);
    const latestValue = latestIdx >= 0 ? lossTri.values[i]![latestIdx]! : 0;
    const ultimate = counts.ultimate * sev.ultimate;
    if (!isNum(ultimate)) {
      warnings.push(`Origin ${origin}: the frequency-severity ultimate is not computable`);
      continue;
    }
    rows.push({
      origin,
      latestValue,
      ultimateCounts: counts.ultimate,
      ultimateSeverity: sev.ultimate,
      ultimate,
      unpaid: ultimate - latestValue,
    });
  }
  if (rows.length === 0) {
    throw new ReservingError(
      "NO_DATA",
      "No origin period has both observed counts and observed severities",
    );
  }

  return {
    method: "frequencySeverity",
    basis: lossTri.kind,
    rows,
    totals: {
      latest: rows.reduce((a, r) => a + r.latestValue, 0),
      ultimate: rows.reduce((a, r) => a + r.ultimate, 0),
      unpaid: rows.reduce((a, r) => a + r.unpaid, 0),
    },
    warnings,
  };
}
