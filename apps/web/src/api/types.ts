import type {
  BornhuetterFergusonResult,
  ChainLadderResult,
  DevelopmentFactors,
  DiagnosticsResult,
  ExposureRecord,
  MackResult,
  TailFit,
  Triangle,
} from "@actng/core";

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
  | "bsCase"
  | "bsSettlement";

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
}

export interface UltimateSelectionView {
  analysisId: string;
  analysisLabel: string;
  analysisRanAt: string;
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

export interface WorkspaceState {
  cadence: "annual" | "quarterly";
  asOfDate: string;
  basis: "paid" | "incurred";
  selections: { paid: (number | null)[]; incurred: (number | null)[] };
  tail: {
    paid: { source: "manual" | "exponentialDecay" | "inversePower"; value: number };
    incurred: { source: "manual" | "exponentialDecay" | "inversePower"; value: number };
  };
  bf: { aprioriLossRatio: number | null };
  berquist: { severityTrend: number | null; interpolation: "exponential" | "linear" };
  ultimateSelection: UltimateSelectionState;
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
