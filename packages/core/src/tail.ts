import type { TailFit, TailMethod } from "./types.js";
import { isNum, ols } from "./util.js";

/**
 * Tail factor curve fitting per Sherman (1984) and Boor (2006).
 *
 * - Exponential decay: ln(LDF_j - 1) is linear in the development period index.
 * - Inverse power:     ln(LDF_j - 1) is linear in ln(period index).
 *
 * The fit runs on the SELECTED age-to-age factors. Guards:
 * - fewer than MIN_POINTS usable points (factor > 1) -> invalid;
 * - non-negative slope (growth instead of decay) -> invalid;
 * - extrapolation is capped in horizon and in total tail size, with a loud
 *   warning when the cap binds (inverse power with slope > -1 diverges).
 */

const MIN_POINTS = 3;
/** Extrapolate at most this many development periods beyond the last age. */
const MAX_HORIZON = 200;
/** Stop extrapolating once the incremental factor is this close to 1. */
const CONVERGENCE_EPS = 1e-7;
/** A fitted tail beyond this bound is treated as divergent. */
const MAX_TAIL = 5;

export interface FitTailOptions {
  method: TailMethod;
  /**
   * Selected LDFs by development column (from ages[j] to ages[j+1]);
   * null entries are skipped.
   */
  selectedLdfs: (number | null)[];
  /** Cap on extrapolated development periods (default 200). */
  maxHorizon?: number;
}

export function fitTail(options: FitTailOptions): TailFit {
  const { method, selectedLdfs } = options;
  const maxHorizon = options.maxHorizon ?? MAX_HORIZON;
  const warnings: string[] = [];

  // x = 1-based development period index of each factor; y = ln(f - 1).
  const xs: number[] = [];
  const ys: number[] = [];
  let skippedAtOrBelowOne = 0;
  for (let j = 0; j < selectedLdfs.length; j++) {
    const f = selectedLdfs[j] ?? null;
    if (!isNum(f)) continue;
    if (f <= 1) {
      skippedAtOrBelowOne++;
      continue;
    }
    const idx = j + 1;
    xs.push(method === "exponentialDecay" ? idx : Math.log(idx));
    ys.push(Math.log(f - 1));
  }
  if (skippedAtOrBelowOne > 0) {
    warnings.push(
      `${skippedAtOrBelowOne} selected factor(s) at or below 1.000 were excluded from the fit (ln(f-1) undefined)`,
    );
  }

  const invalid = (message: string): TailFit => ({
    method,
    intercept: NaN,
    slope: NaN,
    rSquared: NaN,
    nPoints: xs.length,
    extrapolatedFactors: [],
    tailFactor: 1,
    valid: false,
    warnings: [...warnings, message],
  });

  if (xs.length < MIN_POINTS) {
    return invalid(
      `Only ${xs.length} usable point(s); at least ${MIN_POINTS} factors above 1.000 are required to fit a tail curve`,
    );
  }
  const fit = ols(xs, ys);
  if (!fit) return invalid("Degenerate regression (no variation in development ages)");
  if (fit.slope >= 0) {
    return invalid(
      "Fitted curve grows with age instead of decaying; the selected factors do not support a tail extrapolation with this model",
    );
  }

  // Extrapolate incremental factors beyond the last SELECTED column. Trailing
  // null selections carry no development of their own (chain ladder treats
  // them as 1.000), so the extrapolation must start right after the last
  // non-null selection or the curve's predicted factors for those columns
  // would silently vanish from the tail.
  let lastIdx = 0; // 1-based index of the last non-null selection
  for (let j = selectedLdfs.length - 1; j >= 0; j--) {
    if (isNum(selectedLdfs[j] ?? null)) {
      lastIdx = j + 1;
      break;
    }
  }
  if (lastIdx < selectedLdfs.length) {
    warnings.push(
      `The last ${selectedLdfs.length - lastIdx} development column(s) have no selected factor; the fitted tail covers them via the curve (chain ladder would otherwise treat them as 1.000)`,
    );
  }
  const extrapolatedFactors: number[] = [];
  let tail = 1;
  let converged = false;
  for (let step = 1; step <= maxHorizon; step++) {
    const idx = lastIdx + step;
    const x = method === "exponentialDecay" ? idx : Math.log(idx);
    const f = 1 + Math.exp(fit.intercept + fit.slope * x);
    extrapolatedFactors.push(f);
    tail *= f;
    if (tail > MAX_TAIL) {
      return invalid(
        `Extrapolated tail exceeded ${MAX_TAIL.toFixed(1)} after ${step} periods; the fit is divergent (inverse power with slope > -1 has an unbounded product). Enter a tail judgmentally instead.`,
      );
    }
    if (f - 1 < CONVERGENCE_EPS) {
      converged = true;
      break;
    }
  }
  if (!converged) {
    warnings.push(
      `Extrapolation stopped at the ${maxHorizon}-period horizon before the factors converged to 1.000; the tail is truncated and understated`,
    );
  }

  if (fit.rSquared < 0.8) {
    warnings.push(
      `Fit quality is weak (R-squared ${fit.rSquared.toFixed(3)}); treat this tail as indicative only`,
    );
  }

  return {
    method,
    intercept: fit.intercept,
    slope: fit.slope,
    rSquared: fit.rSquared,
    nPoints: fit.n,
    extrapolatedFactors,
    tailFactor: tail,
    valid: true,
    warnings,
  };
}

/** Fits both supported curves so the user can compare them side by side. */
export function fitAllTails(
  selectedLdfs: (number | null)[],
): { exponentialDecay: TailFit; inversePower: TailFit } {
  return {
    exponentialDecay: fitTail({ method: "exponentialDecay", selectedLdfs }),
    inversePower: fitTail({ method: "inversePower", selectedLdfs }),
  };
}
