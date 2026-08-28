import type {
  AmountLayerDefinition,
  MeasureExpression,
  MetricDefinition,
  SparseValuePolicy,
} from "@actuarial-ts/core";

/** Serializable metric metadata: executable warning callbacks are deliberately excluded. */
export interface DiagnosticMetricProvenance {
  id: string;
  definitionVersion: string;
  displayName: string;
  unit: string;
  scale: number;
  numerator: MeasureExpression;
  denominator: MeasureExpression;
  numeratorLabel: string;
  denominatorLabel: string;
  basis: string;
  requiredComponents: string[];
}

export interface DiagnosticLayerProvenance {
  id: string;
  displayName: string;
  paidMeasure: string;
  incurredMeasure: string;
  paid: AmountLayerDefinition["paid"];
  incurred: AmountLayerDefinition["incurred"];
  basis: AmountLayerDefinition["basis"];
}

export interface CreateDiagnosticsProvenanceInput {
  packageVersions: Readonly<Record<string, string>>;
  formulaPack: { id: string; version: string };
  metrics: readonly MetricDefinition[];
  layers?: readonly AmountLayerDefinition[];
  exposure: { basis: string; frequencyScale: number };
  sparsePolicy: SparseValuePolicy;
  ageConvention: string;
  completePeriodCutoffs: Readonly<Record<string, string | number | boolean | null>>;
  appliedFilters?: Readonly<Record<string, unknown>>;
  groupingSelections?: Readonly<Record<string, unknown>>;
  inputReferences: readonly { id: string; hash?: string }[];
}

/**
 * Audit metadata for a diagnostic run. This helper lives in compliance so
 * core numeric results stay deterministic and free of application filter or
 * persistence state. The returned record can be placed directly in
 * `createBundle(...).parameters` or an interchange `extensions` object.
 */
export function createDiagnosticsProvenance(
  input: CreateDiagnosticsProvenanceInput,
): {
  packageVersions: Record<string, string>;
  formulaPack: { id: string; version: string };
  metrics: DiagnosticMetricProvenance[];
  layers: DiagnosticLayerProvenance[];
  exposure: { basis: string; frequencyScale: number };
  sparsePolicy: SparseValuePolicy;
  ageConvention: string;
  completePeriodCutoffs: Record<string, string | number | boolean | null>;
  appliedFilters?: Record<string, unknown>;
  groupingSelections?: Record<string, unknown>;
  inputReferences: { id: string; hash?: string }[];
} {
  const metrics = input.metrics.map((metric) => ({
    id: metric.id,
    definitionVersion: metric.version,
    displayName: metric.displayName,
    unit: metric.unit,
    scale: metric.scale,
    numerator: metric.numerator,
    denominator: metric.denominator,
    numeratorLabel: metric.numeratorLabel,
    denominatorLabel: metric.denominatorLabel,
    basis: metric.basis,
    requiredComponents: [...metric.requiredComponents],
  }));
  const layers = (input.layers ?? []).map((layer) => ({
    id: layer.id,
    displayName: layer.displayName,
    paidMeasure: layer.paidMeasure,
    incurredMeasure: layer.incurredMeasure,
    paid: layer.paid,
    incurred: layer.incurred,
    basis: layer.basis,
  }));
  return {
    packageVersions: { ...input.packageVersions },
    formulaPack: { ...input.formulaPack },
    metrics,
    layers,
    exposure: { ...input.exposure },
    sparsePolicy: input.sparsePolicy,
    ageConvention: input.ageConvention,
    completePeriodCutoffs: { ...input.completePeriodCutoffs },
    ...(input.appliedFilters ? { appliedFilters: { ...input.appliedFilters } } : {}),
    ...(input.groupingSelections ? { groupingSelections: { ...input.groupingSelections } } : {}),
    inputReferences: input.inputReferences.map((reference) => ({ ...reference })),
  };
}

