import type { Triangle } from "./types.js";
import { ReservingError } from "./types.js";
import { isNum } from "./util.js";

/**
 * Triangle algebra: incremental <-> cumulative conversion and cell-wise
 * arithmetic. Prerequisites for the stochastic methods (the ODP model works
 * on incrementals) and for gross/ceded/net and paid+case identities.
 *
 * Ground truth:
 * - cumulativeToIncremental: an interior null makes the increments touching
 *   it undefined - the hole's cell and the cell immediately after it are
 *   null, and increments RESUME wherever two consecutive cells are both
 *   observed. Nothing is ever fabricated to bridge a hole.
 * - incrementalToCumulative: accumulation stops at the FIRST null in a row
 *   (a later observed increment has no defined cumulative base).
 * - Incremental[0] = cumulative[0] (the first cell is its own increment).
 */

function sameShape(a: Triangle, b: Triangle): boolean {
  return (
    a.origins.length === b.origins.length &&
    a.origins.every((o, i) => o === b.origins[i]) &&
    a.ages.length === b.ages.length &&
    a.ages.every((v, j) => v === b.ages[j])
  );
}

function assertShape(a: Triangle, b: Triangle): void {
  if (!sameShape(a, b)) {
    throw new ReservingError(
      "SHAPE",
      "Triangle algebra requires identical origins and development ages",
    );
  }
}

/** Cumulative -> incremental. First cell passes through; nulls propagate. */
export function cumulativeToIncremental(tri: Triangle): Triangle {
  return {
    kind: tri.kind,
    origins: [...tri.origins],
    ages: [...tri.ages],
    values: tri.values.map((row) => {
      const out: (number | null)[] = new Array(row.length).fill(null);
      for (let j = 0; j < row.length; j++) {
        const cur = row[j] ?? null;
        if (!isNum(cur)) continue;
        if (j === 0) {
          out[0] = cur;
          continue;
        }
        const prev = row[j - 1] ?? null;
        out[j] = isNum(prev) ? cur - prev : null;
      }
      return out;
    }),
  };
}

/** Incremental -> cumulative. A null stops accumulation for the row. */
export function incrementalToCumulative(tri: Triangle): Triangle {
  return {
    kind: tri.kind,
    origins: [...tri.origins],
    ages: [...tri.ages],
    values: tri.values.map((row) => {
      const out: (number | null)[] = new Array(row.length).fill(null);
      let running: number | null = null;
      for (let j = 0; j < row.length; j++) {
        const v = row[j] ?? null;
        if (!isNum(v)) break;
        running = (running ?? 0) + v;
        out[j] = running;
      }
      return out;
    }),
  };
}

/** Cell-wise a + b; null wherever either side is null. */
export function addTriangles(a: Triangle, b: Triangle): Triangle {
  assertShape(a, b);
  return {
    kind: a.kind,
    origins: [...a.origins],
    ages: [...a.ages],
    values: a.values.map((row, i) =>
      row.map((v, j) => {
        const w = b.values[i]![j] ?? null;
        return isNum(v ?? null) && isNum(w) ? v! + w : null;
      }),
    ),
  };
}

/** Cell-wise a - b (gross - ceded = net); null wherever either side is null. */
export function subtractTriangles(a: Triangle, b: Triangle): Triangle {
  assertShape(a, b);
  return {
    kind: a.kind,
    origins: [...a.origins],
    ages: [...a.ages],
    values: a.values.map((row, i) =>
      row.map((v, j) => {
        const w = b.values[i]![j] ?? null;
        return isNum(v ?? null) && isNum(w) ? v! - w : null;
      }),
    ),
  };
}
