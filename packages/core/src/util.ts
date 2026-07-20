/** Shared numeric helpers. All null-safe by construction. */

import type { Triangle } from "./types.js";
import { ReservingError } from "./types.js";

/** True when v is a usable finite number. */
export function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Shared origins/ages shape guard: throws ReservingError("SHAPE", message)
 * unless both triangles have the same number of origins and ages AND the
 * same origin/age labels in the same order. `message` is thrown verbatim,
 * so callers own their exact wording.
 */
export function assertSameShape(a: Triangle, b: Triangle, message: string): void {
  if (
    a.origins.length !== b.origins.length ||
    a.ages.length !== b.ages.length ||
    a.origins.some((o, i) => o !== b.origins[i]) ||
    a.ages.some((g, j) => g !== b.ages[j])
  ) {
    throw new ReservingError("SHAPE", message);
  }
}

/**
 * Safe ratio: returns null when either side is missing or the denominator
 * is missing, zero, or negative ("no factor", never an exception).
 */
export function safeRatio(num: number | null, den: number | null): number | null {
  if (!isNum(num) || !isNum(den) || den <= 0) return null;
  return num / den;
}

/** Ordinary least squares of y on x. Returns null when fewer than 2 points. */
export function ols(
  x: number[],
  y: number[],
): { intercept: number; slope: number; rSquared: number; n: number } | null {
  const n = Math.min(x.length, y.length);
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]!;
    sy += y[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  // R^2 = 1 - SSE/SST; when SST is 0 the fit is a perfect horizontal line.
  const rSquared = syy === 0 ? 1 : 1 - (syy - (sxy * sxy) / sxx) / syy;
  return { intercept, slope, rSquared, n };
}

/** Index of the last non-null cell in a row; -1 when the row is empty. */
export function lastObservedIndex(row: (number | null)[]): number {
  for (let j = row.length - 1; j >= 0; j--) {
    if (isNum(row[j] ?? null)) return j;
  }
  return -1;
}

/**
 * Index of the last cell observed in BOTH rows (paired-triangle diagonals);
 * -1 when no cell is jointly observed. Interior holes are respected: the
 * search walks left until both sides are numbers.
 */
export function lastJointObservedIndex(a: (number | null)[], b: (number | null)[]): number {
  for (let j = Math.min(a.length, b.length) - 1; j >= 0; j--) {
    if (isNum(a[j] ?? null) && isNum(b[j] ?? null)) return j;
  }
  return -1;
}
