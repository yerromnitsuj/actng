import { ReservingError } from "./types.js";
import { isNum } from "./util.js";

/**
 * Trend machinery: log-linear regressions on year-indexed actuarial series
 * (ultimate frequency, severity, pure premium), with the same menu
 * discipline as the LDF exhibit - several fitted windows plus judgment.
 *
 * ln(y) = a + b·t fitted by ordinary least squares; the annual trend is
 * e^b - 1. R-squared is reported so thin or noisy series are judged, not
 * trusted blindly.
 */

export interface TrendPoint {
  /** Origin year (the regression x, centered internally). */
  year: number;
  /** The series value (must be positive to enter the log fit). */
  value: number | null;
}

export interface TrendFit {
  key: string;
  label: string;
  /** Annual trend rate, e.g. 0.05 = +5%/yr; null when the window can't fit. */
  annualRate: number | null;
  rSquared: number | null;
  nPoints: number;
  /** Yearly values the window actually used. */
  usedYears: number[];
  warnings: string[];
}

export interface TrendAnalysis {
  points: TrendPoint[];
  fits: TrendFit[];
}

function fitWindow(
  points: { year: number; value: number }[],
  key: string,
  label: string,
): TrendFit {
  const warnings: string[] = [];
  if (points.length < 3) {
    return {
      key,
      label,
      annualRate: null,
      rSquared: null,
      nPoints: points.length,
      usedYears: points.map((p) => p.year),
      warnings: ["Fewer than 3 usable points; no fit"],
    };
  }
  const xs = points.map((p) => p.year);
  const ys = points.map((p) => Math.log(p.value));
  const xMean = xs.reduce((a, v) => a + v, 0) / xs.length;
  const yMean = ys.reduce((a, v) => a + v, 0) / ys.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - xMean;
    const dy = ys[i]! - yMean;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) {
    return {
      key,
      label,
      annualRate: null,
      rSquared: null,
      nPoints: points.length,
      usedYears: xs,
      warnings: ["No variation in years; no fit"],
    };
  }
  const slope = sxy / sxx;
  const rSquared = syy > 0 ? (sxy * sxy) / (sxx * syy) : 1;
  if (points.length < 5) {
    warnings.push(`Only ${points.length} points; the fitted trend is volatile`);
  }
  return {
    key,
    label,
    annualRate: Math.exp(slope) - 1,
    rSquared,
    nPoints: points.length,
    usedYears: xs,
    warnings,
  };
}

/**
 * Fits the standard windows over a year-indexed series: all years, last 5
 * YEARS, last 3 YEARS, and all years excluding the highest and lowest values
 * (the ex-hi-lo medial convention). Windows are sized in POINTS PER YEAR so
 * a quarterly series' "Last 5 years" really spans 5 years (20 quarters), not
 * 5 points. Non-positive and missing values are excluded from every window
 * (a log fit cannot see them), with a warning.
 */
export function analyzeTrend(points: TrendPoint[], pointsPerYear = 1): TrendAnalysis {
  const usable = points
    .filter((p): p is { year: number; value: number } => isNum(p.value) && p.value! > 0)
    .sort((a, b) => a.year - b.year);
  const excluded = points.length - usable.length;

  const fits: TrendFit[] = [];
  const base = (key: string, label: string, pts: { year: number; value: number }[]) => {
    const fit = fitWindow(pts, key, label);
    if (excluded > 0) {
      fit.warnings.push(`${excluded} missing/non-positive year(s) excluded from the series`);
    }
    fits.push(fit);
  };

  const ppy = Math.max(1, Math.round(pointsPerYear));
  base("all", "All years", usable);
  base("last5", "Last 5 years", usable.slice(-5 * ppy));
  base("last3", "Last 3 years", usable.slice(-3 * ppy));
  if (usable.length >= 5) {
    const sortedByValue = [...usable].sort((a, b) => a.value - b.value);
    const hi = sortedByValue[sortedByValue.length - 1]!;
    const lo = sortedByValue[0]!;
    base(
      "exhilo",
      "Ex high/low",
      usable.filter((p) => p !== hi && p !== lo),
    );
  } else {
    fits.push({
      key: "exhilo",
      label: "Ex high/low",
      annualRate: null,
      rSquared: null,
      nPoints: usable.length,
      usedYears: [],
      warnings: ["Needs at least 5 usable points"],
    });
  }

  return { points, fits };
}

/**
 * Trend a value from one year's cost level to another's:
 * value × (1 + rate)^(toYear − fromYear). Midpoint-to-midpoint conventions
 * are the caller's responsibility (whole years in, whole years out).
 */
export function trendValue(
  value: number,
  rate: number,
  fromYear: number,
  toYear: number,
): number {
  if (!isNum(rate) || rate <= -1) {
    throw new ReservingError("BAD_TREND", "A trend rate must be a number greater than -100%");
  }
  return value * Math.pow(1 + rate, toYear - fromYear);
}
