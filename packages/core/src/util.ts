/** Shared numeric helpers. All null-safe by construction. */

/** True when v is a usable finite number. */
export function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
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

/** Sum of the non-null values in a list. */
export function sumDefined(values: (number | null)[]): number {
  let total = 0;
  for (const v of values) if (isNum(v)) total += v;
  return total;
}

/** Index of the last non-null cell in a row; -1 when the row is empty. */
export function lastObservedIndex(row: (number | null)[]): number {
  for (let j = row.length - 1; j >= 0; j--) {
    if (isNum(row[j] ?? null)) return j;
  }
  return -1;
}

/** Round to a given number of decimal places (display and test tolerance only). */
export function round(v: number, places = 0): number {
  const p = 10 ** places;
  return Math.round(v * p) / p;
}
