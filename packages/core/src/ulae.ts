import { ReservingError } from "./types.js";
import { isNum } from "./util.js";

/**
 * ULAE reserving per Conger & Nolibos (2003), "Estimating ULAE Liabilities:
 * Rediscovering and Expanding Kittel's Approach" (CAS Forum Fall 2003).
 *
 * The generalized framework splits ultimate ULAE into shares spent OPENING
 * (u1), MAINTAINING (u2) and CLOSING (u3) claims, u1 + u2 + u3 = 1, and
 * attaches each share to a calendar-period loss measure:
 *
 * - u1 <-> R: the ULTIMATE cost of claims REPORTED during the period,
 * - u2 <-> P: the losses PAID during the period,
 * - u3 <-> C: the ULTIMATE cost of claims CLOSED during the period.
 *
 * Core identity: M = W x B with loss basis B = u1 R + u2 P + u3 C, so the
 * observed calendar-period ULAE ratio is W = M / B ("losses" always means
 * losses + ALAE). The actuary reviews W by period, selects W*, and books one
 * of the paper's three reserve forms (the Bornhuetter-Ferguson form is their
 * recommended default).
 *
 * Special cases (see ULAE_WEIGHT_PRESETS): Kittel's refined method is
 * u = (50%, 0, 50%) with R = reported and C = paid losses (its no-partial-
 * payment / no-development assumptions); the classical paid-to-paid method
 * adds the steady-state identity R = P = C, collapsing the basis to paid
 * losses alone.
 *
 * Validation choices (documented per the phase plan):
 * - weights must be finite, each within [0, 1], and sum to 1 (1e-6
 *   tolerance) -> BAD_WEIGHTS;
 * - monetary amounts (M, R, P, C, L and their to-date counterparts) must be
 *   finite and non-negative -> BAD_LOSSES;
 * - the selected ratio W* must be finite and non-negative -> BAD_RATIO;
 * - a non-positive PER-PERIOD basis yields W = null with a warning (house
 *   null-safety: division by a non-positive denominator is "no factor",
 *   never an exception), but a reserve that cannot be formed at all (empty
 *   periods, missing measures for a positive weight, development form with
 *   a non-positive basis) throws NO_DATA.
 */

export interface UlaeWeights {
  /** Share of ultimate ULAE spent opening claims (attaches to R). */
  u1: number;
  /** Share spent maintaining claims (attaches to paid losses P). */
  u2: number;
  /** Share spent closing claims (attaches to C). */
  u3: number;
}

/**
 * How the calendar-period loss basis is formed:
 * - "weighted": B = u1 R + u2 P + u3 C (the generalized framework);
 * - "paid": B = P, the classical method's steady-state simplification
 *   (R = P = C for a book in steady state, pp. 98-99 of the paper).
 */
export type UlaeBasisKind = "weighted" | "paid";

/**
 * Weight presets from the paper. The GENERALIZED method is any caller-chosen
 * triple (there is no handbook of u-values; the paper develops them by
 * interviewing claims personnel), so it deliberately has no preset entry.
 */
export const ULAE_WEIGHT_PRESETS = {
  /**
   * Kittel's refined method: 50% opening / 50% closing, with the caller
   * supplying R = reported losses and C = paid losses per Kittel's
   * assumptions (no partial payments or reopenings, no future development).
   * W = M / (50% x (paid + reported)).
   */
  kittel: { weights: { u1: 0.5, u2: 0, u3: 0.5 }, basis: "weighted" } as const,
  /**
   * Classical paid-to-paid: the same 50/50 lifecycle assumption plus the
   * steady-state identity R = P = C, which collapses the basis to paid
   * losses: W = M / P. Reserve = W* x (IBNR + 50% x case reserves).
   */
  classicalPaidToPaid: { weights: { u1: 0.5, u2: 0, u3: 0.5 }, basis: "paid" } as const,
} as const;

/** One calendar period's inputs (all amounts for the period, not cumulative). */
export interface UlaePeriodInput {
  label: string;
  /** M: ULAE paid during the period. */
  ulaePaid: number;
  /** R: ultimate cost of claims reported during the period. */
  reportedUltimate: number;
  /** P: losses paid during the period. */
  paid: number;
  /** C: ultimate cost of claims closed during the period. */
  closedUltimate: number;
}

export interface UlaeRatioRow {
  label: string;
  ulaePaid: number;
  /** B = u1 R + u2 P + u3 C (or P under the "paid" basis). */
  basis: number;
  /** W = M / B; null when the basis is not positive. */
  ratio: number | null;
}

export interface UlaeRatiosResult {
  weights: UlaeWeights;
  basis: UlaeBasisKind;
  rows: UlaeRatioRow[];
  totals: { ulaePaid: number; basis: number; ratio: number | null };
  warnings: string[];
}

export type UlaeReserveForm = "expected" | "bornhuetterFerguson" | "development";

export interface UlaeReserveInput {
  /** W*: the selected ratio of ultimate ULAE to the loss basis. */
  selectedW: number;
  /** L: independently estimated ultimate losses for the reserved group. */
  ultimateLosses: number;
  /** R(t): ultimate cost of claims reported as of the evaluation date. Required when u1 > 0. */
  reportedToDate?: number;
  /** P(t): losses paid as of the evaluation date. Required when u2 > 0. */
  paidToDate?: number;
  /** C(t): ultimate cost of claims closed as of the evaluation date. Required when u3 > 0. */
  closedToDate?: number;
  /** M(t): ULAE paid to date. Required for the expected and development forms. */
  ulaePaidToDate?: number;
  weights: UlaeWeights;
  form: UlaeReserveForm;
}

export interface UlaeReserveResult {
  form: UlaeReserveForm;
  /** The indicated unpaid ULAE. */
  unpaidUlae: number;
  /** B(t) = u1 R(t) + u2 P(t) + u3 C(t); null when a needed measure was omitted. */
  basisToDate: number | null;
  /**
   * The Bornhuetter-Ferguson form's split (opening = W* u1 (L - R(t)),
   * maintaining = W* u2 (L - P(t)), closing = W* u3 (L - C(t))); null for
   * the other forms.
   */
  components: { opening: number; maintaining: number; closing: number } | null;
  warnings: string[];
}

const WEIGHT_SUM_TOLERANCE = 1e-6;

function validateWeights(weights: UlaeWeights): void {
  const { u1, u2, u3 } = weights;
  for (const [name, value] of [
    ["u1", u1],
    ["u2", u2],
    ["u3", u3],
  ] as const) {
    if (!isNum(value) || value < 0 || value > 1) {
      throw new ReservingError(
        "BAD_WEIGHTS",
        `ULAE weight ${name} must be a finite number within [0, 1], got ${value}`,
      );
    }
  }
  if (Math.abs(u1 + u2 + u3 - 1) > WEIGHT_SUM_TOLERANCE) {
    throw new ReservingError(
      "BAD_WEIGHTS",
      `ULAE weights must sum to 1 (u1 + u2 + u3 = ${u1 + u2 + u3})`,
    );
  }
}

function requireNonNegative(value: number, name: string): void {
  if (!isNum(value) || value < 0) {
    throw new ReservingError("BAD_LOSSES", `${name} must be a finite, non-negative number, got ${value}`);
  }
}

/**
 * Calendar-period ULAE ratios W = M / B (the paper's Exhibits B-F machinery).
 * Pass opts.basis = "paid" for the classical paid-to-paid collapse.
 */
export function ulaeRatios(
  periods: UlaePeriodInput[],
  weights: UlaeWeights,
  opts: { basis?: UlaeBasisKind } = {},
): UlaeRatiosResult {
  validateWeights(weights);
  if (periods.length === 0) {
    throw new ReservingError("NO_DATA", "ULAE ratios need at least one calendar period");
  }
  const basisKind: UlaeBasisKind = opts.basis ?? "weighted";
  const warnings: string[] = [];
  const rows: UlaeRatioRow[] = [];
  let totalM = 0;
  let totalB = 0;
  for (const period of periods) {
    requireNonNegative(period.ulaePaid, `Period ${period.label}: ulaePaid`);
    requireNonNegative(period.reportedUltimate, `Period ${period.label}: reportedUltimate`);
    requireNonNegative(period.paid, `Period ${period.label}: paid`);
    requireNonNegative(period.closedUltimate, `Period ${period.label}: closedUltimate`);
    const basis =
      basisKind === "paid"
        ? period.paid
        : weights.u1 * period.reportedUltimate +
          weights.u2 * period.paid +
          weights.u3 * period.closedUltimate;
    const ratio = basis > 0 ? period.ulaePaid / basis : null;
    if (ratio === null) {
      warnings.push(
        `Period ${period.label} has a non-positive loss basis; its ULAE ratio is not computable`,
      );
    }
    rows.push({ label: period.label, ulaePaid: period.ulaePaid, basis, ratio });
    totalM += period.ulaePaid;
    totalB += basis;
  }
  return {
    weights,
    basis: basisKind,
    rows,
    totals: { ulaePaid: totalM, basis: totalB, ratio: totalB > 0 ? totalM / totalB : null },
    warnings,
  };
}

/**
 * The paper's three reserve forms (pp. 113-115), analogous to expected-loss /
 * Bornhuetter-Ferguson / development loss reserving:
 *
 * - "expected":            unpaid = W* L - M(t)
 * - "bornhuetterFerguson": unpaid = W* [u1 (L - R(t)) + u2 (L - P(t)) + u3 (L - C(t))]
 *                          = W* (L - B(t))  -- the paper's recommended default
 * - "development":         unpaid = M(t) (L / B(t) - 1)
 *
 * With Kittel's weights (50/0/50) and C(t) = P(t) the B-F form reduces to
 * W* x (IBNR + 50% x case reserves) - the Kittel identity.
 */
export function ulaeReserve(input: UlaeReserveInput): UlaeReserveResult {
  validateWeights(input.weights);
  if (!isNum(input.selectedW) || input.selectedW < 0) {
    throw new ReservingError(
      "BAD_RATIO",
      `Selected ULAE ratio W* must be a finite, non-negative number, got ${input.selectedW}`,
    );
  }
  requireNonNegative(input.ultimateLosses, "ultimateLosses");
  const { u1, u2, u3 } = input.weights;
  const warnings: string[] = [];

  // A measure is needed when its weight is positive (B-F and development
  // forms); an omitted-but-unweighted measure is treated as 0 in B(t).
  const measure = (
    value: number | undefined,
    weight: number,
    name: string,
    needed: boolean,
  ): number => {
    if (value === undefined) {
      if (needed && weight > 0) {
        throw new ReservingError(
          "NO_DATA",
          `${name} is required when its ULAE weight is positive (${input.form} form)`,
        );
      }
      return 0;
    }
    requireNonNegative(value, name);
    return value;
  };
  const needsBasis = input.form !== "expected";
  const R = measure(input.reportedToDate, u1, "reportedToDate", needsBasis);
  const P = measure(input.paidToDate, u2, "paidToDate", needsBasis);
  const C = measure(input.closedToDate, u3, "closedToDate", needsBasis);
  const haveBasis =
    (u1 === 0 || input.reportedToDate !== undefined) &&
    (u2 === 0 || input.paidToDate !== undefined) &&
    (u3 === 0 || input.closedToDate !== undefined);
  const basisToDate = haveBasis ? u1 * R + u2 * P + u3 * C : null;

  const requireM = (): number => {
    if (input.ulaePaidToDate === undefined) {
      throw new ReservingError(
        "NO_DATA",
        `ulaePaidToDate is required for the ${input.form} ULAE reserve form`,
      );
    }
    requireNonNegative(input.ulaePaidToDate, "ulaePaidToDate");
    return input.ulaePaidToDate;
  };

  let unpaidUlae: number;
  let components: UlaeReserveResult["components"] = null;
  switch (input.form) {
    case "expected": {
      const M = requireM();
      unpaidUlae = input.selectedW * input.ultimateLosses - M;
      if (unpaidUlae < 0) {
        warnings.push(
          "ULAE paid to date exceeds W* x ultimate losses; the expected-form reserve is negative",
        );
      }
      break;
    }
    case "bornhuetterFerguson": {
      const L = input.ultimateLosses;
      components = {
        opening: input.selectedW * u1 * (L - R),
        maintaining: input.selectedW * u2 * (L - P),
        closing: input.selectedW * u3 * (L - C),
      };
      unpaidUlae = components.opening + components.maintaining + components.closing;
      break;
    }
    case "development": {
      const M = requireM();
      if (basisToDate === null || basisToDate <= 0) {
        throw new ReservingError(
          "NO_DATA",
          "The development ULAE reserve form needs a positive loss basis to date (B = u1 R + u2 P + u3 C)",
        );
      }
      unpaidUlae = M * (input.ultimateLosses / basisToDate - 1);
      warnings.push(
        "The development form is overly responsive to random ULAE emergence (Conger-Nolibos); the Bornhuetter-Ferguson form is the paper's recommended default",
      );
      break;
    }
  }

  return { form: input.form, unpaidUlae, basisToDate, components, warnings };
}
