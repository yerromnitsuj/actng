import { describe, expect, it } from "vitest";
import { runMack } from "../src/mack.js";
import { triangleFromGrid } from "../src/triangle.js";
import type { Triangle } from "../src/types.js";

/**
 * Structural invariants of the Mack estimator, as distinct from the published
 * values pinned in validation.test.ts.
 */

/**
 * A ragged triangle whose maturity does NOT decrease with row index: origin
 * "A" is observed to age 36 while "B" — listed after it — is observed to 48.
 *
 * This is the case Mack's cross-covariance corollary has to be stated
 * pair-wise for. The published formula sums from the maturity of the more
 * developed of the two accident years; that equals the earlier row's maturity
 * only when the triangle happens to be sorted maturity-descending, which a
 * run-off triangle usually is and this one is not.
 */
const RAGGED_ROWS: Record<string, (number | null)[]> = {
  A: [100, 193, 291, null],
  B: [110, 235, 318, 455],
  C: [95, 201, null, null],
  D: [130, null, null, null],
};

function raggedTriangle(order: string[]): Triangle {
  return triangleFromGrid(
    "paid",
    order,
    [12, 24, 36, 48],
    order.map((label) => RAGGED_ROWS[label]!),
  );
}

describe("Mack total standard error", () => {
  it("does not depend on the order the origins are listed in", () => {
    // The same four accident years, presented four different ways. Every
    // ordering satisfies the documented contract on Triangle.origins (labels
    // ascending is not required to imply maturity descending), so all four
    // must agree — a reserve range that moves when rows are reordered is not
    // a property of the data.
    const orderings = [
      ["A", "B", "C", "D"],
      ["B", "A", "C", "D"],
      ["D", "C", "B", "A"],
      ["C", "A", "D", "B"],
    ];

    const results = orderings.map((o) => runMack(raggedTriangle(o), {}));
    const [first] = results;

    for (const result of results) {
      expect(result.totals.reserve).toBeCloseTo(first!.totals.reserve, 9);
      expect(result.totals.standardError).toBeCloseTo(first!.totals.standardError, 9);
    }
  });

  it("gives each origin the same standard error regardless of its position", () => {
    // Per-origin mse never had the ordering bug; pinning it here keeps the
    // pair-wise total honest — if a future change makes the total invariant by
    // breaking the rows, this fails.
    const byLabel = (order: string[]) =>
      new Map(runMack(raggedTriangle(order), {}).rows.map((r) => [r.origin, r.standardError]));

    const natural = byLabel(["A", "B", "C", "D"]);
    const shuffled = byLabel(["C", "A", "D", "B"]);

    for (const [origin, se] of natural) {
      expect(shuffled.get(origin)).toBeCloseTo(se, 9);
    }
  });
});
