import { ReservingError } from "./types.js";

export type QuarterNumber = 1 | 2 | 3 | 4;

export interface QuarterPeriod {
  year: number;
  quarter: QuarterNumber;
}

export type QuarterFormat = "compact" | "hyphenated" | "quarter-first";
export type DevelopmentAgeConvention = "quarter-end-first-observation" | "elapsed";

const QUARTER_PATTERNS = [
  /^(\d{4})Q([1-4])$/i,
  /^(\d{4})-Q([1-4])$/i,
  /^Q([1-4])\s+(\d{4})$/i,
] as const;

/** Parses `2024Q3`, `2024-Q3`, or `Q3 2024`; no lexical date guessing. */
export function parseQuarterPeriod(value: string): QuarterPeriod {
  const text = value.trim();
  for (let i = 0; i < QUARTER_PATTERNS.length; i++) {
    const match = QUARTER_PATTERNS[i]!.exec(text);
    if (!match) continue;
    const quarterFirst = i === 2;
    const year = Number(match[quarterFirst ? 2 : 1]);
    const quarter = Number(match[quarterFirst ? 1 : 2]) as QuarterNumber;
    if (Number.isSafeInteger(year) && year >= 1 && year <= 9999) return { year, quarter };
  }
  throw new ReservingError(
    "BAD_ORIGIN",
    `Quarter period must be YYYYQn, YYYY-Qn, or Qn YYYY with n from 1 to 4; got ${JSON.stringify(value)}`,
  );
}

export function formatQuarterPeriod(
  period: QuarterPeriod,
  format: QuarterFormat = "compact",
): string {
  assertQuarterPeriod(period);
  const year = String(period.year).padStart(4, "0");
  if (format === "hyphenated") return `${year}-Q${period.quarter}`;
  if (format === "quarter-first") return `Q${period.quarter} ${year}`;
  return `${year}Q${period.quarter}`;
}

export function compareQuarterPeriods(a: QuarterPeriod | string, b: QuarterPeriod | string): number {
  const left = typeof a === "string" ? parseQuarterPeriod(a) : assertQuarterPeriod(a);
  const right = typeof b === "string" ? parseQuarterPeriod(b) : assertQuarterPeriod(b);
  return quarterIndex(left) - quarterIndex(right);
}

export function sortQuarterPeriods<T extends QuarterPeriod | string>(periods: readonly T[]): T[] {
  return [...periods].sort(compareQuarterPeriods);
}

export function quarterIndex(period: QuarterPeriod): number {
  assertQuarterPeriod(period);
  return period.year * 4 + period.quarter - 1;
}

export function addQuarters(period: QuarterPeriod | string, count: number): QuarterPeriod {
  if (!Number.isSafeInteger(count)) {
    throw new ReservingError("BAD_ORIGIN", `Quarter offset must be an integer; got ${count}`);
  }
  const parsed = typeof period === "string" ? parseQuarterPeriod(period) : assertQuarterPeriod(period);
  const index = quarterIndex(parsed) + count;
  const year = Math.floor(index / 4);
  const quarter = ((index % 4 + 4) % 4 + 1) as QuarterNumber;
  return assertQuarterPeriod({ year, quarter });
}

/**
 * Development age in months. The default reflects quarter-end snapshots:
 * the first observation in an origin quarter is age 3. Select `elapsed` only
 * when the source genuinely defines a same-quarter observation as age zero.
 */
export function developmentAgeMonths(
  origin: QuarterPeriod | string,
  valuation: QuarterPeriod | string,
  convention: DevelopmentAgeConvention = "quarter-end-first-observation",
): number {
  const o = typeof origin === "string" ? parseQuarterPeriod(origin) : assertQuarterPeriod(origin);
  const v = typeof valuation === "string" ? parseQuarterPeriod(valuation) : assertQuarterPeriod(valuation);
  const elapsed = quarterIndex(v) - quarterIndex(o);
  if (elapsed < 0) {
    throw new ReservingError(
      "BAD_DATE",
      `Valuation quarter ${formatQuarterPeriod(v)} precedes origin quarter ${formatQuarterPeriod(o)}`,
    );
  }
  return (elapsed + (convention === "quarter-end-first-observation" ? 1 : 0)) * 3;
}

export interface PolicyPeriodOptions {
  /** First calendar quarter in the policy/fiscal year. Defaults to Q1. */
  startQuarter?: QuarterNumber;
  /** Caller override for nonstandard labels or boundaries. */
  mapper?: (period: QuarterPeriod) => string;
}

/** Maps a calendar quarter to the starting year of its policy/fiscal period. */
export function policyPeriodLabel(
  period: QuarterPeriod | string,
  options: PolicyPeriodOptions = {},
): string {
  const parsed = typeof period === "string" ? parseQuarterPeriod(period) : assertQuarterPeriod(period);
  if (options.mapper) return options.mapper({ ...parsed });
  const startQuarter = options.startQuarter ?? 1;
  if (![1, 2, 3, 4].includes(startQuarter)) {
    throw new ReservingError("BAD_ORIGIN", `Policy-year startQuarter must be 1 through 4; got ${startQuarter}`);
  }
  const startYear = startQuarter === 1 || parsed.quarter >= startQuarter ? parsed.year : parsed.year - 1;
  return String(startYear);
}

export interface CompleteQuarterCutoffOptions {
  /** Include the in-progress quarter. Default false: only completed quarters. */
  includePartial?: boolean;
}

/** Returns the latest included quarter for an ISO calendar date. */
export function completeQuarterCutoff(
  asOfDate: string,
  options: CompleteQuarterCutoffOptions = {},
): QuarterPeriod {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOfDate);
  if (!match) throw new ReservingError("BAD_DATE", `asOfDate must be YYYY-MM-DD; got ${JSON.stringify(asOfDate)}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!) {
    throw new ReservingError("BAD_DATE", `asOfDate is not a valid calendar date: ${asOfDate}`);
  }
  const quarter = (Math.floor((month - 1) / 3) + 1) as QuarterNumber;
  if (options.includePartial) return { year, quarter };
  const endMonth = quarter * 3;
  const endDay = daysInMonth[endMonth - 1]!;
  if (month === endMonth && day === endDay) return { year, quarter };
  return addQuarters({ year, quarter }, -1);
}

export interface CompleteQuarterlyCutoffsOptions {
  originAsOfDate?: string;
  valuationAsOfDate?: string;
  includePartialOrigin?: boolean;
  includePartialValuation?: boolean;
}

/** Explicit origin and valuation cutoffs, independently configurable. */
export function completeQuarterlyCutoffs(
  asOfDate: string,
  options: CompleteQuarterlyCutoffsOptions = {},
): { originThrough: QuarterPeriod; valuationThrough: QuarterPeriod } {
  return {
    originThrough: completeQuarterCutoff(options.originAsOfDate ?? asOfDate, {
      includePartial: options.includePartialOrigin,
    }),
    valuationThrough: completeQuarterCutoff(options.valuationAsOfDate ?? asOfDate, {
      includePartial: options.includePartialValuation,
    }),
  };
}

function assertQuarterPeriod(period: QuarterPeriod): QuarterPeriod {
  if (
    !Number.isSafeInteger(period.year) ||
    period.year < 1 ||
    period.year > 9999 ||
    ![1, 2, 3, 4].includes(period.quarter)
  ) {
    throw new ReservingError("BAD_ORIGIN", `Invalid quarter period ${JSON.stringify(period)}`);
  }
  return period;
}
