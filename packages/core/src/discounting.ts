import type { ChainLadderResult } from "./types.js";
import { ReservingError } from "./types.js";
import { isNum, safeRatio } from "./util.js";

/**
 * Discounting unpaid claim estimates per ASOP No. 20 ("Discounting of
 * Property/Casualty Unpaid Claim Estimates", the revised standard effective
 * June 1, 2026). The standard's discipline, encoded rather than footnoted:
 *
 * - Rate PROVENANCE is required input ({ source, asOfDate }): the standard
 *   requires the actuary to disclose the basis of the discount rates and the
 *   date as of which they were determined. This module refuses to discount
 *   without it.
 * - Nominal and discounted amounts are reported SIDE BY SIDE, per origin and
 *   in total, with the effective discount factor between them. Neither
 *   replaces the other.
 * - Risk margins are EXPLICIT ONLY: an optional `riskMargin` amount passes
 *   through the result untouched; no total in this module adds it in.
 *   Implicit margins (conservative rates, shaded patterns) are never
 *   manufactured here, and blending a margin into the discounted figure is
 *   left to the consumer to do visibly.
 *
 * Timing convention (payments assumed at period boundaries per the pattern):
 * each expected payment occupies a development interval (fromMonths,
 * toMonths] measured from the VALUATION DATE, i.e. the latest observed
 * diagonal of the triangle behind the pattern. The `convention` option fixes
 * the discount exponent for the interval's payment:
 *
 * - "end-period": t = toMonths / 12 years - the payment falls on the
 *   interval's closing boundary.
 * - "mid-period": t = (fromMonths + toMonths) / 24 years - the standard
 *   uniform-payment approximation (cash spread evenly over the interval is
 *   discounted as if paid at its midpoint).
 *
 * Discount factors are (1 + rate)^(-t) with annual effective spot rates.
 * Under a spot curve, a payment at time t uses the rate for the year
 * containing t (t in (k-1, k] years uses spotByYear[k-1]); payments beyond
 * the curve horizon use the LAST spot rate, with a warning.
 */

export type DiscountConvention = "mid-period" | "end-period";

/** One expected payment, located relative to the valuation date. */
export interface PayoutCashflow {
  /** Months after the valuation date at which the payment interval opens. */
  fromMonths: number;
  /** Months after the valuation date at which the interval closes. */
  toMonths: number;
  /** Expected payment within the interval (negative = expected recovery). */
  amount: number;
}

export interface PayoutPatternRow {
  origin: string;
  /** Age (months) of the latest observed diagonal cell (the valuation age). */
  latestAge: number;
  /** The chain ladder unpaid this row's cashflows tie to (sum of amounts). */
  unpaid: number;
  cashflows: PayoutCashflow[];
}

export interface PayoutPattern {
  rows: PayoutPatternRow[];
  warnings: string[];
}

/**
 * Expected future incremental payments per origin, derived from a chain
 * ladder result: the increment for development interval (ages[j], ages[j+1]]
 * is ultimate x (percentDeveloped[j+1] - percentDeveloped[j]), and the tail
 * cash implied by a tail factor > 1 (ultimate x (1 - percentDeveloped at the
 * last age)) is compressed into a single interval of the same width as the
 * last observed development step, immediately after the last age (warned; a
 * single-age triangle uses a 12-month tail interval). Each row's cashflow
 * amounts sum to its unpaid by construction.
 *
 * `ages` must be the development ages the chain ladder ran on (the result
 * does not carry them). Negative increments (percent developed not monotone,
 * i.e. an LDF below 1) are kept and warned - never dropped or fabricated
 * away.
 */
export function payoutPatternFromChainLadder(
  cl: ChainLadderResult,
  ages: number[],
): PayoutPattern {
  const K = ages.length;
  if (K === 0 || cl.cdfs.length !== K) {
    throw new ReservingError(
      "SHAPE",
      `Expected the development ages the chain ladder ran on (${cl.cdfs.length} CDFs), got ${K} ages`,
    );
  }
  for (let j = 0; j < K; j++) {
    const a = ages[j]!;
    if (!isNum(a) || a <= 0 || (j > 0 && a <= ages[j - 1]!)) {
      throw new ReservingError("SHAPE", "Development ages must be finite, positive, and ascending");
    }
  }

  const warnings: string[] = [];
  const pct = cl.percentDeveloped;
  const lastStep = K >= 2 ? ages[K - 1]! - ages[K - 2]! : 12;
  const negativeColumns = new Set<number>();
  let tailWarned = false;

  const rows: PayoutPatternRow[] = [];
  for (const row of cl.rows) {
    const k = ages.indexOf(row.latestAge);
    if (k < 0) {
      throw new ReservingError(
        "SHAPE",
        `Origin ${row.origin}: latest age ${row.latestAge} is not among the supplied ages; pass the same ages the chain ladder ran on`,
      );
    }
    const cashflows: PayoutCashflow[] = [];
    for (let j = k; j < K - 1; j++) {
      const amount = row.ultimate * (pct[j + 1]! - pct[j]!);
      if (amount < 0 && !negativeColumns.has(j)) {
        negativeColumns.add(j);
        warnings.push(
          `Development interval ${ages[j]}-${ages[j + 1]} months has a negative expected payment (percent developed is not monotone there); negative cashflows are kept, never dropped`,
        );
      }
      cashflows.push({
        fromMonths: ages[j]! - ages[k]!,
        toMonths: ages[j + 1]! - ages[k]!,
        amount,
      });
    }
    const tailAmount = row.ultimate * (1 - pct[K - 1]!);
    if (Math.abs(tailAmount) > 1e-9 * Math.max(1, Math.abs(row.ultimate))) {
      if (!tailWarned) {
        tailWarned = true;
        warnings.push(
          `Tail development beyond ${ages[K - 1]} months is compressed into a single ${lastStep}-month payment interval immediately after the last age; supply explicit cashflows if the tail is long`,
        );
      }
      cashflows.push({
        fromMonths: ages[K - 1]! - ages[k]!,
        toMonths: ages[K - 1]! - ages[k]! + lastStep,
        amount: tailAmount,
      });
    }
    rows.push({ origin: row.origin, latestAge: row.latestAge, unpaid: row.unpaid, cashflows });
  }
  return { rows, warnings };
}

/**
 * Discount rates, annual effective:
 * - "flat": one rate for every maturity.
 * - "curve": spotByYear[k] is the spot rate for payments in year k+1 (times
 *   t in (k, k+1] years). Payments beyond the horizon use the last rate.
 */
export type DiscountRates =
  | { kind: "flat"; annualRate: number }
  | { kind: "curve"; spotByYear: number[] };

/**
 * Where the rates came from and when - REQUIRED, because ASOP 20 requires
 * the actuary to disclose the basis of the discount rate(s) and the date as
 * of which they were determined.
 */
export interface RateProvenance {
  /** e.g. "US Treasury CMT curve", "company investment yield per ASOP 20 5.3". */
  source: string;
  /** ISO date (yyyy-mm-dd) the rates were determined as of. */
  asOfDate: string;
}

/** Explicit cashflows for one origin (the non-pattern input path). */
export interface OriginCashflows {
  origin: string;
  cashflows: PayoutCashflow[];
}

export interface DiscountUnpaidInput {
  /** Payout pattern from payoutPatternFromChainLadder. Exactly one of pattern/cashflows. */
  pattern?: PayoutPattern;
  /** Explicit per-origin cashflows. Exactly one of pattern/cashflows. */
  cashflows?: OriginCashflows[];
  rates: DiscountRates;
  provenance: RateProvenance;
  convention: DiscountConvention;
  /**
   * Explicit risk margin (a dollar amount, not a rate). Carried through the
   * result UNCHANGED and kept out of every total - never blended.
   */
  riskMargin?: number;
}

export interface DiscountedCashflowDetail {
  /** Payment time in years from the valuation date under the chosen convention. */
  timeYears: number;
  amount: number;
  /** Annual effective spot rate applied at timeYears. */
  rate: number;
  /** (1 + rate)^(-timeYears). */
  discountFactor: number;
  discounted: number;
}

export interface DiscountedUnpaidRow {
  origin: string;
  /** Undiscounted expected future payments (sum of cashflow amounts). */
  nominal: number;
  discounted: number;
  /** nominal - discounted (the amount of discount taken). */
  discount: number;
  /** discounted / nominal; null when nominal is not positive. */
  effectiveDiscountFactor: number | null;
  cashflows: DiscountedCashflowDetail[];
}

export interface DiscountUnpaidResult {
  method: "discountedUnpaid";
  convention: DiscountConvention;
  rates: DiscountRates;
  provenance: RateProvenance;
  rows: DiscountedUnpaidRow[];
  totals: {
    nominal: number;
    discounted: number;
    discount: number;
    effectiveDiscountFactor: number | null;
  };
  /**
   * The caller's explicit risk margin, passed through untouched (null when
   * none was supplied). NOT included in any total above: presenting it as a
   * separate line is the consumer's job, per the explicit-only rule.
   */
  riskMargin: number | null;
  warnings: string[];
}

const ISO_DATE = /^\d{4}-(\d{2})-(\d{2})$/;

function validateProvenance(provenance: RateProvenance | undefined): RateProvenance {
  if (
    provenance === undefined ||
    typeof provenance.source !== "string" ||
    provenance.source.trim() === ""
  ) {
    throw new ReservingError(
      "NO_PROVENANCE",
      "Rate provenance is required: ASOP 20 requires disclosing the basis of the discount rates (source) and the date they were determined (asOfDate)",
    );
  }
  const match =
    typeof provenance.asOfDate === "string" ? ISO_DATE.exec(provenance.asOfDate) : null;
  const m = match ? Number(match[1]) : 0;
  const d = match ? Number(match[2]) : 0;
  if (!match || m < 1 || m > 12 || d < 1 || d > 31) {
    throw new ReservingError(
      "BAD_DATE",
      `Rate provenance asOfDate must be an ISO date (yyyy-mm-dd), got "${provenance.asOfDate}"`,
    );
  }
  return provenance;
}

function validateRates(rates: DiscountRates): void {
  if (rates.kind === "flat") {
    if (!isNum(rates.annualRate) || rates.annualRate <= -1) {
      throw new ReservingError(
        "BAD_RATE",
        `Flat annual discount rate must be a finite number greater than -100%, got ${rates.annualRate}`,
      );
    }
    return;
  }
  if (rates.spotByYear.length === 0) {
    throw new ReservingError("BAD_RATE", "A spot curve needs at least one annual rate");
  }
  rates.spotByYear.forEach((r, k) => {
    if (!isNum(r) || r <= -1) {
      throw new ReservingError(
        "BAD_RATE",
        `Spot rate for year ${k + 1} must be a finite number greater than -100%, got ${r}`,
      );
    }
  });
}

/**
 * Discounts expected future payments and reports nominal and discounted
 * unpaid side by side, per origin and in total. See the module doc for the
 * timing convention, curve lookup, and the ASOP 20 provenance/risk-margin
 * rules this function enforces.
 */
export function discountUnpaid(input: DiscountUnpaidInput): DiscountUnpaidResult {
  const hasPattern = input.pattern !== undefined;
  const hasCashflows = input.cashflows !== undefined;
  if (hasPattern === hasCashflows) {
    throw new ReservingError(
      "BAD_CASHFLOWS",
      "Provide exactly one cashflow source: a payout pattern OR explicit per-origin cashflows",
    );
  }
  validateRates(input.rates);
  const provenance = validateProvenance(input.provenance);
  if (input.riskMargin !== undefined && (!isNum(input.riskMargin) || input.riskMargin < 0)) {
    throw new ReservingError(
      "BAD_MARGIN",
      `An explicit risk margin must be a finite, non-negative amount, got ${input.riskMargin}`,
    );
  }

  const sources: OriginCashflows[] = hasPattern
    ? input.pattern!.rows.map((r) => ({ origin: r.origin, cashflows: r.cashflows }))
    : input.cashflows!;
  if (sources.length === 0) {
    throw new ReservingError("NO_DATA", "No origins to discount");
  }

  const warnings: string[] = [];
  const spot = input.rates.kind === "curve" ? input.rates.spotByYear : null;
  let horizonWarned = false;
  const negativeOrigins: string[] = [];

  const rows: DiscountedUnpaidRow[] = sources.map((source) => {
    let nominal = 0;
    let discounted = 0;
    let hasNegative = false;
    const details: DiscountedCashflowDetail[] = source.cashflows.map((cf) => {
      if (
        !isNum(cf.fromMonths) ||
        cf.fromMonths < 0 ||
        !isNum(cf.toMonths) ||
        cf.toMonths < cf.fromMonths ||
        !isNum(cf.amount)
      ) {
        throw new ReservingError(
          "BAD_CASHFLOWS",
          `Origin ${source.origin}: cashflows need finite amounts and 0 <= fromMonths <= toMonths`,
        );
      }
      if (cf.amount < 0) hasNegative = true;
      const timeYears =
        input.convention === "end-period"
          ? cf.toMonths / 12
          : (cf.fromMonths + cf.toMonths) / 24;
      let rate: number;
      if (spot === null) {
        rate = (input.rates as { kind: "flat"; annualRate: number }).annualRate;
      } else {
        if (timeYears > spot.length && !horizonWarned) {
          horizonWarned = true;
          warnings.push(
            `Cashflows beyond the ${spot.length}-year spot curve horizon are discounted at the last spot rate (${spot[spot.length - 1]}); extend the curve to refine`,
          );
        }
        rate = spot[Math.min(Math.max(Math.ceil(timeYears), 1), spot.length) - 1]!;
      }
      const discountFactor = (1 + rate) ** -timeYears;
      const pv = cf.amount * discountFactor;
      nominal += cf.amount;
      discounted += pv;
      return { timeYears, amount: cf.amount, rate, discountFactor, discounted: pv };
    });
    if (hasNegative) negativeOrigins.push(source.origin);
    return {
      origin: source.origin,
      nominal,
      discounted,
      discount: nominal - discounted,
      effectiveDiscountFactor: safeRatio(discounted, nominal),
      cashflows: details,
    };
  });

  if (negativeOrigins.length > 0) {
    warnings.push(
      `Negative expected cashflows for origin(s) ${negativeOrigins.join(", ")}; discounted as-is (negative flows reduce the discounted unpaid)`,
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({
      nominal: acc.nominal + r.nominal,
      discounted: acc.discounted + r.discounted,
      discount: acc.discount + r.discount,
    }),
    { nominal: 0, discounted: 0, discount: 0 },
  );

  return {
    method: "discountedUnpaid",
    convention: input.convention,
    rates: input.rates,
    provenance,
    rows,
    totals: { ...totals, effectiveDiscountFactor: safeRatio(totals.discounted, totals.nominal) },
    riskMargin: input.riskMargin ?? null,
    warnings,
  };
}
