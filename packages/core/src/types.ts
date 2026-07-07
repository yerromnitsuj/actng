/**
 * Core domain types for the reserving engine.
 *
 * Triangle semantics (ground truth for the whole engine):
 * - rows = origin periods, columns = development ages
 * - cells not yet observable are null
 * - every computation must be null-safe; division by a missing, zero, or
 *   negative denominator yields "no factor" (null), never an exception or NaN
 */

/** Cadence of origin periods. */
export type OriginCadence = "annual" | "quarterly";

/** The kinds of triangles the engine knows how to build and analyze. */
export type TriangleKind =
  | "paid"
  | "incurred"
  | "caseReserve"
  | "reportedCount"
  | "openCount"
  | "closedCount"
  | "closedWithPayCount";

export interface Triangle {
  kind: TriangleKind;
  /** Human-readable origin period labels, ascending (e.g. "2019", "2021Q3"). */
  origins: string[];
  /** Development ages in months, ascending (e.g. [12, 24, 36] or [3, 6, 9]). */
  ages: number[];
  /** values[originIndex][ageIndex]; null = not yet observable / missing. */
  values: (number | null)[][];
}

/** A single claim evaluation snapshot: one row per claim per evaluation date. */
export interface ClaimSnapshot {
  claimId: string;
  /** ISO date (yyyy-mm-dd) the loss occurred. */
  accidentDate: string;
  /** ISO date the claim was reported to the insurer. */
  reportDate: string;
  /** ISO date this snapshot was evaluated. */
  evaluationDate: string;
  /** Cumulative paid loss as of the evaluation date. */
  paidToDate: number;
  /** Outstanding case reserve as of the evaluation date. */
  caseReserve: number;
  /** Claim status as of the evaluation date. */
  status: "open" | "closed";
}

/** Exposure/premium by origin period. */
export interface ExposureRecord {
  /** Origin period label matching triangle origins (e.g. "2021" or "2021Q3"). */
  origin: string;
  /** Earned premium (or another exposure base) for the period. */
  earnedPremium: number;
}

/** How a link-ratio average is computed for a development column. */
export interface AverageSpec {
  key: string;
  label: string;
  kind: "straight" | "weighted" | "medial" | "geometric";
  /** Number of most recent origin periods to include; omit for all-year. */
  years?: number;
}

/** Age-to-age factors for one triangle. */
export interface DevelopmentFactors {
  /** For column j: development from ages[j] to ages[j+1]. Length = ages.length - 1. */
  fromAges: number[];
  toAges: number[];
  /** individual[originIndex][columnIndex]; null where not computable. */
  individual: (number | null)[][];
  /** Per-average-key, per-column computed averages; null where not computable. */
  averages: { spec: AverageSpec; values: (number | null)[] }[];
}

/** Per-column LDF selection made by the user or the advisor. */
export interface LdfSelections {
  /** selected[j] = LDF for development column j; null = not selected. */
  selected: (number | null)[];
  tailFactor: number;
}

export interface ChainLadderRow {
  origin: string;
  /** Age (months) of the latest observed diagonal cell for this origin. */
  latestAge: number;
  /** Value on the latest observed diagonal. */
  latestValue: number;
  /** Cumulative development factor from latestAge to ultimate. */
  cdf: number;
  percentDeveloped: number;
  ultimate: number;
  /** ultimate - latestValue (IBNR on incurred basis; unpaid on paid basis). */
  unpaid: number;
}

export interface ChainLadderResult {
  method: "chainLadder";
  basis: TriangleKind;
  /** cdfs[j] = cumulative factor from ages[j] to ultimate (last = tail factor). */
  cdfs: number[];
  percentDeveloped: number[];
  rows: ChainLadderRow[];
  totals: { latest: number; ultimate: number; unpaid: number };
  warnings: string[];
}

export interface BornhuetterFergusonRow {
  origin: string;
  latestValue: number;
  cdf: number;
  /** A-priori expected loss ratio applied to the exposure base. */
  aprioriLossRatio: number;
  earnedPremium: number;
  expectedUltimate: number;
  expectedUnreported: number;
  ultimate: number;
  unpaid: number;
}

export interface BornhuetterFergusonResult {
  method: "bornhuetterFerguson";
  basis: TriangleKind;
  rows: BornhuetterFergusonRow[];
  totals: { latest: number; ultimate: number; unpaid: number };
  warnings: string[];
}

export type TailMethod = "exponentialDecay" | "inversePower";

export interface TailFit {
  method: TailMethod;
  /** ln(f-1) = intercept + slope * x, x = period index (exp) or ln(index) (power). */
  intercept: number;
  slope: number;
  rSquared: number;
  nPoints: number;
  /** Individual extrapolated age-to-age factors beyond the last observed age. */
  extrapolatedFactors: number[];
  tailFactor: number;
  valid: boolean;
  warnings: string[];
}

export interface MackRow {
  origin: string;
  latest: number;
  ultimate: number;
  reserve: number;
  standardError: number;
  /** standardError / reserve; null when reserve is 0. */
  cv: number | null;
}

export interface MackResult {
  method: "mack";
  /** The projection factors: selected LDFs when supplied, else volume-weighted. */
  developmentFactors: number[];
  sigmaSquared: number[];
  /** Tail factor the projection used (1 = none). */
  tailFactor?: number;
  /** Extrapolated sigma^2 for the tail step; present only when a tail was applied. */
  sigmaSquaredTail?: number;
  rows: MackRow[];
  totals: {
    latest: number;
    ultimate: number;
    reserve: number;
    standardError: number;
    cv: number | null;
  };
  warnings: string[];
}

export interface BerquistCaseAdequacyResult {
  /** Average open case reserve per open claim, by cell. */
  averageCaseReserves: (number | null)[][];
  /** Annual severity trend used to restate historical average case reserves. */
  severityTrend: number;
  /** Whether the trend was fitted from the data or supplied by the user. */
  trendSource: "fitted" | "user";
  restatedAverageCaseReserves: (number | null)[][];
  /** paid + restated average case reserve x open counts. */
  adjustedIncurred: Triangle;
  warnings: string[];
}

export interface BerquistSettlementResult {
  /** disposal[i][j] = closed counts / ultimate counts for origin i. */
  disposalRates: (number | null)[][];
  /** Selected disposal rate per age (latest diagonal). */
  selectedDisposalRates: (number | null)[];
  ultimateCounts: number[];
  adjustedClosedCounts: (number | null)[][];
  interpolation: "exponential" | "linear";
  adjustedPaid: Triangle;
  warnings: string[];
}

export interface CalendarYearDiagnostic {
  /** One entry per calendar-period diagonal that has testable factors. */
  diagonals: {
    label: string;
    countLarge: number;
    countSmall: number;
    z: number;
    expectedZ: number;
    varianceZ: number;
  }[];
  totalZ: number;
  expectedTotalZ: number;
  varianceTotalZ: number;
  /** Total Z outside the 95% confidence range indicates calendar-year effects. */
  significant: boolean;
  confidenceInterval: [number, number];
}

export interface DiagnosticsResult {
  paidToIncurredRatios: (number | null)[][];
  averageCaseReserves: (number | null)[][];
  /** closed / reported counts by cell. */
  closureRates: (number | null)[][];
  calendarYearTest: CalendarYearDiagnostic | null;
  /** Human-readable findings an actuary would care about. */
  findings: DiagnosticFinding[];
}

export interface DiagnosticFinding {
  severity: "info" | "warning" | "critical";
  code: string;
  message: string;
}

/** Thrown for invalid analysis input (all-missing selections, shape mismatches). */
export class ReservingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReservingError";
    this.code = code;
  }
}
