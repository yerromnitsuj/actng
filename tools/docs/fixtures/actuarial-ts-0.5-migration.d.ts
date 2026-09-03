/**
 * Frozen, minimal ambient declaration fixture for the 0.5.0 side of the
 * generalized-diagnostics migration guide. These declarations were extracted
 * from the verified 0.5.0 build on 2026-09-03. They are documentation evidence
 * only: they are not exported, packed, or a compatibility promise.
 */

declare module "@actuarial-ts/core" {
  export type SparseValuePolicy = "preserve-null" | "zero-fill";
  export type DiagnosticMeasureMap = Readonly<Record<string, number | null | undefined>>;

  export type MeasureExpression =
    | { op: "measure"; measure: string }
    | { op: "add"; terms: readonly MeasureExpression[] }
    | { op: "subtract"; left: MeasureExpression; right: MeasureExpression };

  export interface DiagnosticWarning {
    code: string;
    message: string;
    component?: string;
    exposureKey?: string;
  }

  export interface MetricWarningContext {
    definition: MetricDefinition;
    components: Readonly<Record<string, number | null>>;
    rawNumerator: number | null;
    rawDenominator: number | null;
    value: number | null;
  }

  export interface MetricWarningRule {
    code: "PAID_EXCEEDS_INCURRED";
    when: "numerator-greater-than-denominator";
    message: string;
    tolerance?: number;
  }

  export interface MetricDefinition {
    id: string;
    version: string;
    displayName: string;
    description: string;
    unit:
      | "count-per-million"
      | "ratio"
      | "currency-per-exposure"
      | "currency-per-claim"
      | (string & {});
    scale: number;
    numerator: MeasureExpression;
    denominator: MeasureExpression;
    numeratorLabel: string;
    denominatorLabel: string;
    basis: string;
    requiredComponents: readonly string[];
    warningRules?: readonly MetricWarningRule[];
    evaluateWarnings?: (context: MetricWarningContext) => readonly DiagnosticWarning[];
  }

  export interface DiagnosticLossRow<TDimensions = unknown> {
    id: string;
    group: string;
    origin: string;
    valuation: string;
    ageMonths: number;
    policyPeriod?: string;
    dimensions?: TDimensions;
    measures: DiagnosticMeasureMap;
  }

  export interface DiagnosticExposureRow<TDimensions = unknown> {
    key: string;
    group: string;
    origin: string;
    valuation?: string;
    measures: DiagnosticMeasureMap;
    complete?: boolean;
    dimensions?: TDimensions;
  }

  export interface DiagnosticsFilter {
    groups?: readonly string[];
    origins?: readonly string[];
    originFrom?: string;
    originThrough?: string;
    valuations?: readonly string[];
    valuationFrom?: string;
    valuationThrough?: string;
    policyPeriods?: readonly string[];
    minAgeMonths?: number;
    maxAgeMonths?: number;
  }

  export interface RunMetricDiagnosticsInput<TDimensions = unknown> {
    losses: readonly DiagnosticLossRow<TDimensions>[];
    exposures?: readonly DiagnosticExposureRow<TDimensions>[];
    metrics: readonly MetricDefinition[];
    sparsePolicy?: SparseValuePolicy;
    filter?: DiagnosticsFilter;
    groupMap?: Readonly<Record<string, string>>;
    groupDimensions?: Readonly<Record<string, TDimensions>>;
  }

  export interface MetricEvaluation {
    metricId: string;
    metricVersion: string;
    value: number | null;
    rawNumerator: number | null;
    rawDenominator: number | null;
    numeratorLabel: string;
    denominatorLabel: string;
    unit: MetricDefinition["unit"];
    scale: number;
    basis: string;
    rawComponents: Record<string, number | null>;
    warnings: DiagnosticWarning[];
  }

  export interface DiagnosticEmergencePoint<TDimensions = unknown> {
    group: string;
    dimensions?: TDimensions;
    origin: string;
    valuation: string;
    ageMonths: number;
    components: Record<string, number | null>;
    componentWarnings: DiagnosticWarning[];
    metrics: Record<string, MetricEvaluation>;
  }

  export interface DiagnosticMetricTriangle {
    group: string;
    metricId: string;
    origins: string[];
    ages: number[];
    values: (number | null)[][];
    cells: (MetricEvaluation | null)[][];
  }

  export interface MetricDiagnosticsResult<TDimensions = unknown> {
    emergence: DiagnosticEmergencePoint<TDimensions>[];
    triangles: DiagnosticMetricTriangle[];
    latestDiagonal: DiagnosticEmergencePoint<TDimensions>[];
  }

  export interface CasualtyDiagnosticComponentKeys {
    reported: string;
    open: string;
    closedNoPay: string;
    closedWithPay: string;
    exposure: string;
    paid250: string;
    incurred250: string;
    paidPrimary: string;
    incurredPrimary: string;
  }

  export interface CasualtyMetricPresetOptions {
    components?: Partial<CasualtyDiagnosticComponentKeys>;
    frequencyScale?: number;
    frequencyUnit?: MetricDefinition["unit"];
    definitionVersion?: string;
    basisLabels?: {
      limited250?: string;
      primary?: string;
      counts?: string;
    };
    displayOverrides?: Readonly<Record<string, Partial<Pick<
      MetricDefinition,
      "displayName" | "description" | "unit" | "numeratorLabel" | "denominatorLabel" | "basis"
    >>>>;
  }

  export const CASUALTY_DIAGNOSTIC_COMPONENTS: Readonly<CasualtyDiagnosticComponentKeys>;
  export const CASUALTY_QUARTERLY_METRICS: readonly MetricDefinition[];
  export function createCasualtyQuarterlyMetrics(
    options?: CasualtyMetricPresetOptions,
  ): readonly MetricDefinition[];
  export function runMetricDiagnostics<TDimensions = unknown>(
    input: RunMetricDiagnosticsInput<TDimensions>,
  ): MetricDiagnosticsResult<TDimensions>;
}

declare module "@actuarial-ts/data" {
  export interface ValidatedDiagnosticDataset {
    losses: import("@actuarial-ts/core").DiagnosticLossRow[];
    exposures?: import("@actuarial-ts/core").DiagnosticExposureRow[];
  }

  export type ValidatedMetricDiagnosticsOptions = Omit<
    import("@actuarial-ts/core").RunMetricDiagnosticsInput,
    "losses" | "exposures"
  >;

  export function validateDiagnosticDataset(value: unknown): ValidatedDiagnosticDataset;
  export function runValidatedMetricDiagnostics(
    dataset: unknown,
    options: ValidatedMetricDiagnosticsOptions,
  ): import("@actuarial-ts/core").MetricDiagnosticsResult;
  export function reviewDiagnosticData(
    snapshots: readonly import("@actuarial-ts/core").DiagnosticLossRow[],
    exposures: readonly import("@actuarial-ts/core").DiagnosticExposureRow[],
    options?: unknown,
  ): unknown;
}

declare module "@actuarial-ts/interchange" {
  export const INTERCHANGE_SPEC_VERSION: "1.0.0";
  export const INTERCHANGE_PACKAGE_VERSION: "0.5.0";

  export interface DocumentLike {
    kind: string;
    [key: string]: unknown;
  }

  export function stampIntegrity<T extends DocumentLike>(
    doc: DocumentLike & Omit<T, "integrity">,
  ): T;
}

declare module "@actuarial-ts/compliance" {
  export interface CreateDiagnosticsProvenanceInput {
    packageVersions: Readonly<Record<string, string>>;
    formulaPack: { id: string; version: string };
    metrics: readonly import("@actuarial-ts/core").MetricDefinition[];
    exposure: { basis: string; frequencyScale: number };
    sparsePolicy: import("@actuarial-ts/core").SparseValuePolicy;
    ageConvention: string;
    completePeriodCutoffs: Readonly<Record<string, string | number | boolean | null>>;
    appliedFilters?: Readonly<Record<string, unknown>>;
    groupingSelections?: Readonly<Record<string, unknown>>;
    inputReferences: readonly { id: string; hash?: string }[];
  }

  export function createDiagnosticsProvenance(
    input: CreateDiagnosticsProvenanceInput,
  ): Record<string, unknown>;
}

declare module "@actuarial-ts/agents" {
  export type ToolEnvelopeFailure = {
    success: false;
    error: { code: string; message: string };
  };

  export type ActuarialToolKind = "read" | "action";

  export function defineActuarialTool<
    TShape extends Record<string, unknown>,
    TResult,
  >(options: {
    id: string;
    description: string;
    kind: ActuarialToolKind;
    inputSchema: unknown;
    tenant: "required" | "none";
    execute: (
      input: TShape,
      tenant: string | null,
      context: unknown,
    ) => Promise<TResult>;
  }): unknown;
}
