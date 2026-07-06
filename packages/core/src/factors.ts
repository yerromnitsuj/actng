import type { AverageSpec, DevelopmentFactors, Triangle } from "./types.js";
import { isNum, safeRatio } from "./util.js";

/**
 * Age-to-age (link ratio) development factors and the averages menu.
 *
 * Ground truth:
 * - f[i][j] = C[i][j+1] / C[i][j] on cumulative data.
 * - The volume-weighted average for a column is sum(numerators) / sum(denominators)
 *   over exactly the rows where BOTH cells exist -- not the mean of ratios.
 * - Division by a missing, zero, or negative denominator = no factor (null).
 */

export const DEFAULT_AVERAGES: AverageSpec[] = [
  { key: "all-wtd", label: "All-year volume-weighted", kind: "weighted" },
  { key: "all-str", label: "All-year straight", kind: "straight" },
  { key: "5-wtd", label: "5-year volume-weighted", kind: "weighted", years: 5 },
  { key: "5-str", label: "5-year straight", kind: "straight", years: 5 },
  { key: "3-wtd", label: "3-year volume-weighted", kind: "weighted", years: 3 },
  { key: "3-str", label: "3-year straight", kind: "straight", years: 3 },
  { key: "med-5x1", label: "Medial 5-year (excl. hi/lo)", kind: "medial", years: 5 },
  { key: "geo-all", label: "All-year geometric", kind: "geometric" },
];

interface ColumnPair {
  rowIndex: number;
  numerator: number;
  denominator: number;
  factor: number;
}

/** Valid (both cells present, positive denominator) pairs for column j, in origin order. */
function columnPairs(tri: Triangle, j: number): ColumnPair[] {
  const pairs: ColumnPair[] = [];
  for (let i = 0; i < tri.origins.length; i++) {
    const den = tri.values[i]![j] ?? null;
    const num = tri.values[i]![j + 1] ?? null;
    const factor = safeRatio(num, den);
    if (factor !== null && isNum(num) && isNum(den)) {
      pairs.push({ rowIndex: i, numerator: num, denominator: den, factor });
    }
  }
  return pairs;
}

function averageForColumn(pairs: ColumnPair[], spec: AverageSpec): number | null {
  // An "n-year" average covers the latest n ORIGIN PERIODS that can carry a
  // factor in this column (ending at the last row with a valid factor) -- not
  // the last n valid factors. With an interior missing factor the window must
  // not silently reach further back in time.
  let window = pairs;
  if (spec.years !== undefined && pairs.length > 0) {
    const lastRow = pairs[pairs.length - 1]!.rowIndex;
    window = pairs.filter((p) => p.rowIndex > lastRow - spec.years!);
  }
  if (window.length === 0) return null;
  switch (spec.kind) {
    case "straight": {
      let s = 0;
      for (const p of window) s += p.factor;
      return s / window.length;
    }
    case "weighted": {
      let num = 0;
      let den = 0;
      for (const p of window) {
        num += p.numerator;
        den += p.denominator;
      }
      return den > 0 ? num / den : null;
    }
    case "medial": {
      if (window.length < 3) {
        // Not enough points to exclude hi/lo; fall back to a straight average.
        let s = 0;
        for (const p of window) s += p.factor;
        return s / window.length;
      }
      const sorted = window.map((p) => p.factor).sort((a, b) => a - b);
      const inner = sorted.slice(1, sorted.length - 1);
      let s = 0;
      for (const f of inner) s += f;
      return s / inner.length;
    }
    case "geometric": {
      let logSum = 0;
      for (const p of window) {
        if (p.factor <= 0) return null; // geometric mean undefined
        logSum += Math.log(p.factor);
      }
      return Math.exp(logSum / window.length);
    }
  }
}

export function computeDevelopmentFactors(
  tri: Triangle,
  averageSpecs: AverageSpec[] = DEFAULT_AVERAGES,
): DevelopmentFactors {
  const nCols = Math.max(0, tri.ages.length - 1);
  const individual: (number | null)[][] = tri.origins.map((_, i) => {
    const row: (number | null)[] = [];
    for (let j = 0; j < nCols; j++) {
      row.push(safeRatio(tri.values[i]![j + 1] ?? null, tri.values[i]![j] ?? null));
    }
    return row;
  });

  const pairsByColumn: ColumnPair[][] = [];
  for (let j = 0; j < nCols; j++) pairsByColumn.push(columnPairs(tri, j));

  const averages = averageSpecs.map((spec) => ({
    spec,
    values: pairsByColumn.map((pairs) => averageForColumn(pairs, spec)),
  }));

  return {
    fromAges: tri.ages.slice(0, nCols),
    toAges: tri.ages.slice(1),
    individual,
    averages,
  };
}
