import type {
  BornhuetterFergusonResult,
  ChainLadderResult,
  DevelopmentFactors,
  DiagnosticsResult,
  ExposureRecord,
  MackResult,
  TailFit,
  Triangle,
} from "@actuarial-ts/core";

/** Server payload shapes (mirrors apps/server responses). */

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  claimRowCount: number;
  claimCount: number;
  exposureCount: number;
}

export type SelectionMethodKey =
  | "clPaid"
  | "clIncurred"
  | "bfPaid"
  | "bfIncurred"
  | "gbPaid"
  | "gbIncurred"
  | "bsCase"
  | "bsSettlement"
  | "ccPaid"
  | "ccIncurred"
  | "expectedClaims"
  | "freqSev";

export interface UltimateSelectionState {
  defaultWeights: Record<SelectionMethodKey, number>;
  weightsByOrigin: Record<string, Record<SelectionMethodKey, number>>;
  overrides: Record<string, number>;
}

export interface UltimateSelectionRow {
  origin: string;
  ultimates: Record<SelectionMethodKey, number | null>;
  weights: Record<SelectionMethodKey, number>;
  customWeights: boolean;
  weighted: number | null;
  override: number | null;
  selected: number | null;
  latestPaid: number;
  latestIncurred: number;
  ibnr: number | null;
  unpaid: number | null;
  restorationShortfall: boolean;
  restorationOverage: boolean;
}

export interface UltimateSelectionView {
  analysisId: string;
  analysisLabel: string;
  analysisRanAt: string;
  layer: LayerState;
  restored: ResolvedIlf | null;
  methods: { key: SelectionMethodKey; label: string; weight: number }[];
  rows: UltimateSelectionRow[];
  totals: {
    latestPaid: number;
    latestIncurred: number;
    weighted: number | null;
    selected: number | null;
    ibnr: number | null;
    unpaid: number | null;
    unselectedOrigins: string[];
  };
}

export type LayerKey = "unlimited" | "capped";

export interface TailChoice {
  source: "manual" | "exponentialDecay" | "inversePower";
  value: number;
}

export interface LayerState {
  active: LayerKey;
  cap: number | null;
  indexRate: number;
  baseYear: number | null;
}

export interface TrendChoice {
  source: "all" | "last5" | "last3" | "exhilo" | "manual";
  value: number | null;
}

export interface TrendFit {
  key: string;
  label: string;
  annualRate: number | null;
  rSquared: number | null;
  nPoints: number;
  usedYears: number[];
  warnings: string[];
}

export type ElrMethod = "loss-ratio" | "pure-premium";

export interface TrendReview {
  targetYear: number;
  method: ElrMethod;
  level: "unlimited" | "limited" | "restored";
  severityLayer: LayerKey;
  rows: {
    origin: string;
    year: number;
    earnedPremium: number | null;
    onLevelFactor: number;
    ultimateCounts: number | null;
    frequency: number | null;
    severity: number | null;
    purePremium: number | null;
    trendedFrequency: number | null;
    trendedSeverity: number | null;
  }[];
  frequency: { fits: TrendFit[]; selection: TrendChoice; selectionStale: boolean };
  severity: { fits: TrendFit[]; selection: TrendChoice; selectionStale: boolean };
  notes: string[];
}

export interface WorkspaceState {
  cadence: "annual" | "quarterly";
  asOfDate: string;
  basis: "paid" | "incurred";
  layer: LayerState;
  ilf: IlfState;
  selections: Record<LayerKey, { paid: (number | null)[]; incurred: (number | null)[] }>;
  tail: Record<LayerKey, { paid: TailChoice; incurred: TailChoice }>;
  bf: Record<LayerKey, { aprioriLossRatio: number | null }>;
  berquist: Record<
    LayerKey,
    { severityTrend: number | null; interpolation: "exponential" | "linear" }
  >;
  ultimateSelection: UltimateSelectionState;
  trend: {
    frequency: TrendChoice;
    severity: Record<LayerKey, TrendChoice>;
    targetYear: number | null;
  };
  rates: { history: { effectiveDate: string; change: number }[]; premiumTrend: number | null };
  elr: {
    method: ElrMethod;
    selected: number | null;
    selectedAtLevel: "unlimited" | "limited" | "restored" | null;
  };
}

export interface ElrReview {
  targetYear: number;
  /** loss-ratio -> ratios/premium; pure-premium -> pure premiums ($/unit)/exposure units. */
  method: ElrMethod;
  level: "unlimited" | "limited" | "restored";
  rows: {
    origin: string;
    /** Exposure base: on-level earned premium (loss-ratio) or exposure units (pure-premium). */
    premium: number;
    onLevelFactor: number;
    premiumAdj: number;
    lossAdj: number;
    onLevelTrendedPremium: number;
    selectedUltimate: number | null;
    trendedUltimate: number | null;
    /** A loss ratio or a pure premium, per `method`. */
    lossRatioAtTarget: number | null;
  }[];
  averages: { key: string; label: string; value: number | null }[];
  capeCodElr: { paid: number | null; incurred: number | null };
  selected: number | null;
  selectedAtLevel: "unlimited" | "limited" | "restored" | null;
  warnings: string[];
}

export interface ClaimSizeYearRow {
  year: number;
  claimCount: number;
  totalIncurred: number;
  maxClaim: number;
  percentiles: { p: number; value: number }[];
}

export interface CapCandidate {
  cap: number;
  byYear: {
    year: number;
    effectiveCap: number;
    pierceCount: number;
    pierceShare: number;
    excessShare: number;
  }[];
  totalPierceCount: number;
  totalPierceShare: number;
  totalExcessShare: number;
}

export interface IlfState {
  source: "none" | "fitted" | "table" | "illustrative";
  fittedKind: "lognormal" | "pareto";
  curveId: string | null;
  table: { limit: number; factor: number }[] | null;
  targetLimit: number | null;
}

export type SeverityDistribution =
  | { kind: "lognormal"; mu: number; sigma: number }
  | { kind: "pareto"; theta: number; alpha: number };

export interface SeverityFit {
  distribution: SeverityDistribution;
  logLikelihood: number;
  nExact: number;
  nCensored: number;
  nExcludedNonPositive: number;
  valid: boolean;
  warnings: string[];
  quantileCheck: { p: number; empirical: number | null; fitted: number }[];
}

export interface ResolvedIlf {
  factor: number;
  sourceLabel: string;
  targetLimit: number | null;
  warnings: string[];
}

export interface IlfReview {
  config: IlfState;
  fits: { lognormal: SeverityFit; pareto: SeverityFit } | null;
  resolved: ResolvedIlf | null;
  unresolvedReason: string | null;
  illustrativeCurves: { id: string; label: string }[];
}

export interface LayerReview {
  diagnostics: {
    years: ClaimSizeYearRow[];
    candidates: CapCandidate[];
    baseYear: number;
    indexRate: number;
    nonZeroClaimCount: number;
  };
  volatility: {
    unlimited: { paid: (number | null)[]; incurred: (number | null)[] };
    capped: { paid: (number | null)[]; incurred: (number | null)[] } | null;
  };
}

export interface TriangleSet {
  paid: Triangle;
  incurred: Triangle;
  caseReserve: Triangle;
  reportedCount: Triangle;
  openCount: Triangle;
  closedCount: Triangle;
  closedWithPayCount: Triangle;
}

export interface WorkspaceView {
  state: WorkspaceState;
  triangles: TriangleSet;
  factors: { paid: DevelopmentFactors; incurred: DevelopmentFactors };
  tailFits: {
    paid: { exponentialDecay: TailFit; inversePower: TailFit };
    incurred: { exponentialDecay: TailFit; inversePower: TailFit };
  };
  diagnostics: DiagnosticsResult;
  dataAsOf: { claimRows: number; claimCount: number };
  exposures: ExposureRecord[];
  ultimateSelection: UltimateSelectionView | null;
  layerReview: LayerReview;
  trendReview: TrendReview | null;
  elrReview: ElrReview | null;
  ilfReview: IlfReview;
}

export interface MethodSummary {
  method: string;
  basis: "paid" | "incurred";
  ultimate: number;
  ibnr: number;
  unpaid: number;
  note?: string;
}

export interface AnalysisResults {
  ranAt: string;
  asOfDate: string;
  cadence: string;
  /** The development layer this run was built on (absent on pre-layer runs = unlimited). */
  layer?: LayerState;
  ilfUnresolvedReason?: string | null;
  capeCod?: {
    paid: { elrAtTargetLevel: number; totals: { ultimate: number } } | null;
    incurred: { elrAtTargetLevel: number; totals: { ultimate: number } } | null;
    skippedReason?: string;
  };
  expectedClaims?: { selectedElrAtTargetLevel: number; totals: { ultimate: number } } | null;
  /** Set when a selected ELR could not drive Expected Claims / the ELR-derived BF
   * a-priori this run (level mismatch) - the selection exhibit surfaces this so the
   * blank columns are explained rather than silent. */
  elrDerivedSkipReason?: string | null;
  /** The a-priori method this run used (loss-ratio or pure-premium). */
  aprioriMethod?: ElrMethod;
  ilf?: ResolvedIlf | null;
  unlimitedDiagonals?: Record<string, { paid: number; incurred: number }>;
  chainLadder: { paid: ChainLadderResult; incurred: ChainLadderResult };
  bornhuetterFerguson: {
    paid: BornhuetterFergusonResult | null;
    incurred: BornhuetterFergusonResult | null;
    skippedReason?: string;
  };
  berquistSherman: {
    caseAdequacy: {
      severityTrend: number;
      trendSource: string;
      warnings: string[];
      adjustedIncurredTriangle: Triangle;
      chainLadder: ChainLadderResult;
    } | null;
    settlement: {
      interpolation: string;
      warnings: string[];
      ultimateCounts: number[];
      adjustedPaidTriangle: Triangle;
      chainLadder: ChainLadderResult;
    } | null;
    skippedReason?: string;
  };
  mack: { paid: MackResult | null; incurred: MackResult | null; skippedReason?: string };
  diagnostics: DiagnosticsResult;
  summary: MethodSummary[];
  warnings: string[];
}

export interface AnalysisRecord {
  id: string;
  projectId: string;
  label: string;
  inputs: unknown;
  results: AnalysisResults;
  createdAt: string;
}

export interface AnalysisListItem {
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
}

export interface Note {
  id: string;
  projectId: string;
  author: "user" | "advisor";
  text: string;
  createdAt: string;
}

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolEvent {
  toolName: string;
  args: unknown;
  result: unknown;
  isAction: boolean;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  toolEvents: ToolEvent[];
  createdAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export type ChatStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolName: string; args: unknown }
  | { type: "tool-result"; toolName: string; result: unknown; isAction: boolean }
  | { type: "done"; messageId: string; workspaceChanged: boolean }
  | { type: "error"; message: string };
