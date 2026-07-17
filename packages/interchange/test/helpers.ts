import {
  type LdfSelections,
  type Triangle,
  computeDevelopmentFactors,
  triangleFromGrid,
} from "@actuarial-ts/core";
import { type TriangleDoc, triangleToDoc } from "../src/index.js";

/** Fixed timestamp for envelopes: purity means tests never read a clock. */
export const CREATED_AT = "2026-07-17T00:00:00Z";

/**
 * A realistic 5x5 annual cumulative paid triangle (constructed inline via
 * triangleFromGrid — core's test fixtures are not exported).
 */
export function annualPaidTriangle(): Triangle {
  return triangleFromGrid(
    "paid",
    ["2021", "2022", "2023", "2024", "2025"],
    [12, 24, 36, 48, 60],
    [
      [1001, 1855, 2423, 2988, 3335],
      [1113, 2103, 2774, 3422, null],
      [1265, 2433, 3233, null, null],
      [1490, 2873, null, null, null],
      [1725, null, null, null, null],
    ],
  );
}

/** A small quarterly incurred triangle ("YYYYQn" labels). */
export function quarterlyIncurredTriangle(): Triangle {
  return triangleFromGrid(
    "incurred",
    ["2024Q1", "2024Q2", "2024Q3", "2024Q4"],
    [3, 6, 9, 12],
    [
      [400, 620, 750, 810],
      [430, 660, 800, null],
      [455, 700, null, null],
      [480, null, null, null],
    ],
  );
}

export function annualPaidDoc(): TriangleDoc {
  return triangleToDoc(annualPaidTriangle(), {
    createdAt: CREATED_AT,
    valuationDate: "2025-12-31",
  });
}

/** The all-year volume-weighted selections for a triangle (coherent by
 * construction with the "all-wtd" intent). */
export function allWtdSelections(tri: Triangle): LdfSelections {
  const dev = computeDevelopmentFactors(tri);
  const allWtd = dev.averages.find((a) => a.spec.key === "all-wtd")!;
  return { selected: [...allWtd.values], tailFactor: 1 };
}
