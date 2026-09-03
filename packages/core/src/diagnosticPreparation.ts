import { canonicalJson, fnv1a64 } from "./canonical.js";
import {
  assertCompiledDiagnosticDefinition,
  getCompiledDiagnosticDefinitionInternals,
  type CompiledDiagnosticDefinition,
  type DiagnosticDeepReadonly,
  type DiagnosticSourceLocation,
  type DiagnosticsFilter,
  type JsonValue,
} from "./diagnosticDefinitions.js";
import { auditedDiagnosticContribution, finalizeDiagnosticContributions, type DiagnosticMeasureContribution, type DiagnosticStructuralBlocker } from "./diagnosticAggregation.js";
import { deriveDiagnosticClaimMeasures } from "./diagnosticDerivations.js";
import { diagnosticDevelopmentAge, normalizeDiagnosticPeriod } from "./diagnosticPeriods.js";
import { reconcileDiagnosticExposures, type DiagnosticAuditedNumericValue, type DiagnosticExposureObservation, type ReconciledDiagnosticExposure, auditDiagnosticNumber } from "./diagnosticExposure.js";
import type { DiagnosticMeasureStats } from "./diagnosticDefinitions.js";
import type { DiagnosticMetricFinding } from "./diagnosticFormulas.js";
import { DiagnosticValidationError, type DiagnosticValidationIssue } from "./types.js";

export interface DiagnosticLossRecordBase {
  readonly recordId: string;
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly complete: boolean;
  readonly source?: DiagnosticSourceLocation;
  readonly measures: Readonly<Record<string, number | null>>;
}
export interface DiagnosticClaimObservation extends DiagnosticLossRecordBase { readonly rowType: "claim"; readonly claimId: string }
export interface DiagnosticLossSnapshot extends DiagnosticLossRecordBase { readonly rowType: "aggregate" }
export type DiagnosticLossInput = DiagnosticClaimObservation | DiagnosticLossSnapshot;

export interface DiagnosticCompletePeriodCutoff { readonly sourceGroup: string; readonly originThrough: string | null; readonly valuationThrough: string | null }
export interface DiagnosticExpectedCell { readonly sourceGroup: string; readonly origin: string; readonly valuation: string; readonly source?: DiagnosticSourceLocation }
export interface PrepareDiagnosticDataInput {
  readonly definition: CompiledDiagnosticDefinition;
  readonly losses: readonly DiagnosticLossInput[];
  readonly exposures: readonly DiagnosticExposureObservation[];
  readonly filter?: DiagnosticsFilter;
  readonly completePeriodCutoffs?: readonly DiagnosticCompletePeriodCutoff[];
  readonly expectedCells?: readonly DiagnosticExpectedCell[];
}

export type DiagnosticInputDisposition = "invalid" | "complete-period-cutoff" | "filter" | "retained";
export type DiagnosticInputAuditRecord =
  | { readonly kind: "loss"; readonly disposition: DiagnosticInputDisposition; readonly record: DiagnosticDeepReadonly<DiagnosticLossInput> }
  | { readonly kind: "exposure"; readonly disposition: DiagnosticInputDisposition; readonly record: DiagnosticDeepReadonly<DiagnosticExposureObservation> }
  | { readonly kind: "expected-cell"; readonly disposition: Exclude<DiagnosticInputDisposition, "invalid">; readonly record: DiagnosticDeepReadonly<DiagnosticExpectedCell> };

export interface PreparedDiagnosticSourceCell {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly developmentAge: number;
  readonly ageUnit: string;
  readonly lossRecordIds: readonly string[];
  readonly contributions: Readonly<Record<string, readonly DiagnosticMeasureContribution[]>>;
  readonly components: Readonly<Record<string, DiagnosticMeasureStats>>;
  readonly structuralBlockers: Readonly<Record<string, readonly DiagnosticStructuralBlocker[]>>;
  readonly findings: readonly DiagnosticMetricFinding[];
}

declare const preparedDiagnosticDataBrand: unique symbol;
export interface PreparedDiagnosticData {
  readonly [preparedDiagnosticDataBrand]: true;
  readonly definition: CompiledDiagnosticDefinition;
  readonly preparationFingerprint: string;
  readonly filter: DiagnosticDeepReadonly<DiagnosticsFilter> | null;
  readonly completePeriodCutoffs: readonly DiagnosticCompletePeriodCutoff[];
  readonly inputAudit: readonly DiagnosticInputAuditRecord[];
  readonly cells: readonly PreparedDiagnosticSourceCell[];
  readonly exposures: readonly ReconciledDiagnosticExposure[];
  readonly expectedCellsProvided: boolean;
  readonly expectedCells: readonly DiagnosticExpectedCell[];
  readonly findings: readonly DiagnosticMetricFinding[];
}

export interface NormalizedDiagnosticPreparationIdentity {
  readonly definitionIntegrity: string;
  readonly filter: DiagnosticDeepReadonly<DiagnosticsFilter> | null;
  readonly completePeriodCutoffs: readonly DiagnosticCompletePeriodCutoff[];
  readonly inputAudit: readonly DiagnosticInputAuditRecord[];
  readonly cells: readonly PreparedDiagnosticSourceCell[];
  readonly exposures: readonly ReconciledDiagnosticExposure[];
  readonly expectedCellsProvided: boolean;
  readonly expectedCells: readonly DiagnosticExpectedCell[];
  readonly findings: readonly DiagnosticMetricFinding[];
}

const authentic = new WeakSet<object>();
const identities = new WeakMap<object, DiagnosticDeepReadonly<NormalizedDiagnosticPreparationIdentity>>();

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): DiagnosticDeepReadonly<T> {
  if (value === null || typeof value !== "object" || seen.has(value)) return value as DiagnosticDeepReadonly<T>;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value) as DiagnosticDeepReadonly<T>;
}

function codeUnit(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined { return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined }

function normalizeFilter(filter: DiagnosticsFilter | undefined): DiagnosticsFilter | null {
  if (filter === undefined) return null;
  const set = (values: readonly string[] | undefined) => values === undefined ? undefined : [...new Set(values)].sort(codeUnit);
  return {
    ...(filter.sourceGroups === undefined ? {} : { sourceGroups: set(filter.sourceGroups) }),
    ...(filter.outputGroups === undefined ? {} : { outputGroups: set(filter.outputGroups) }),
    ...(filter.origins === undefined ? {} : { origins: set(filter.origins) }),
    ...(filter.originFrom === undefined ? {} : { originFrom: filter.originFrom }),
    ...(filter.originThrough === undefined ? {} : { originThrough: filter.originThrough }),
    ...(filter.valuations === undefined ? {} : { valuations: set(filter.valuations) }),
    ...(filter.valuationFrom === undefined ? {} : { valuationFrom: filter.valuationFrom }),
    ...(filter.valuationThrough === undefined ? {} : { valuationThrough: filter.valuationThrough }),
    ...(filter.minDevelopmentAge === undefined ? {} : { minDevelopmentAge: filter.minDevelopmentAge }),
    ...(filter.maxDevelopmentAge === undefined ? {} : { maxDevelopmentAge: filter.maxDevelopmentAge }),
    ...(filter.instanceIds === undefined ? {} : { instanceIds: set(filter.instanceIds) }),
  };
}

function selected(filter: DiagnosticsFilter | null, group: string, origin: string, valuation: string, age: number): boolean {
  return (filter?.sourceGroups === undefined || filter.sourceGroups.includes(group)) &&
    (filter?.origins === undefined || filter.origins.includes(origin)) &&
    (filter?.valuations === undefined || filter.valuations.includes(valuation)) &&
    (filter?.originFrom === undefined || origin >= filter.originFrom) &&
    (filter?.originThrough === undefined || origin <= filter.originThrough) &&
    (filter?.valuationFrom === undefined || valuation >= filter.valuationFrom) &&
    (filter?.valuationThrough === undefined || valuation <= filter.valuationThrough) &&
    (filter?.minDevelopmentAge === undefined || age >= filter.minDevelopmentAge) &&
    (filter?.maxDevelopmentAge === undefined || age <= filter.maxDevelopmentAge);
}

export function prepareDiagnosticData(input: PrepareDiagnosticDataInput): PreparedDiagnosticData {
  assertCompiledDiagnosticDefinition(input.definition);
  const definition = input.definition;
  const internals = getCompiledDiagnosticDefinitionInternals(definition);
  const issues: DiagnosticValidationIssue[] = [];
  const filter = normalizeFilter(input.filter);
  for (const bound of [filter?.minDevelopmentAge, filter?.maxDevelopmentAge]) if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 0)) issues.push({ domain: "configuration", code: "invalid-configuration", path: "$.filter", message: "Development-age bounds must be nonnegative safe integers" });
  if (filter?.minDevelopmentAge !== undefined && filter.maxDevelopmentAge !== undefined && filter.minDevelopmentAge > filter.maxDevelopmentAge) issues.push({ domain: "configuration", code: "invalid-configuration", path: "$.filter", message: "Minimum development age exceeds maximum" });
  input.losses.forEach((row, index) => {
    if (row.rowType !== definition.definition.lossRowGrain) issues.push({ domain: "input", code: "invalid-input-relationship", path: `$.losses[${index}].rowType`, message: "Loss row type does not match definition grain" });
  });
  input.exposures.forEach((row, index) => {
    const measure = internals.measuresById.get(row.measureId);
    if (measure?.exposureTiming === "valuation-specific" && row.valuation === undefined) issues.push({ domain: "input", code: "missing-required", path: `$.exposures[${index}].valuation`, message: "Valuation-specific exposure requires valuation" });
  });
  if (issues.length > 0) throw new DiagnosticValidationError(issues);

  const normalizedLosses: DiagnosticLossInput[] = [];
  const audit: DiagnosticInputAuditRecord[] = [];
  for (const row of input.losses) {
    let disposition: DiagnosticInputDisposition = "retained";
    try {
      const period = diagnosticDevelopmentAge(definition, row.origin, row.valuation);
      const normalized = { ...row, origin: period.origin.label, valuation: period.valuation.label } as DiagnosticLossInput;
      if (!selected(filter, row.sourceGroup, normalized.origin, normalized.valuation, period.developmentAge)) disposition = "filter";
      if (disposition === "retained") normalizedLosses.push(normalized);
      audit.push({ kind: "loss", disposition, record: normalized });
    } catch { audit.push({ kind: "loss", disposition: "invalid", record: row }); }
  }
  const derivedLosses = definition.definition.lossRowGrain === "claim"
    ? deriveDiagnosticClaimMeasures(normalizedLosses as DiagnosticClaimObservation[], definition) as readonly DiagnosticLossInput[]
    : normalizedLosses;
  const cells = new Map<string, DiagnosticLossInput[]>();
  for (const row of derivedLosses) {
    const key = `${row.sourceGroup}\u0000${row.origin}\u0000${row.valuation}`;
    const list = cells.get(key) ?? [];
    list.push(row);
    cells.set(key, list);
  }

  const normalizedExposureInputs: DiagnosticExposureObservation[] = [];
  for (const row of input.exposures) {
    try {
      const origin = normalizeDiagnosticPeriod(definition, "origin", row.origin).label;
      const valuation = row.valuation === undefined ? undefined : normalizeDiagnosticPeriod(definition, "valuation", row.valuation).label;
      const normalized = { ...row, origin, ...(valuation === undefined ? {} : { valuation }) };
      const timing = internals.measuresById.get(row.measureId)?.exposureTiming;
      const age = valuation === undefined ? 0 : diagnosticDevelopmentAge(definition, origin, valuation).developmentAge;
      const keep = timing === "origin-static"
        ? (filter?.sourceGroups === undefined || filter.sourceGroups.includes(row.sourceGroup)) && (filter?.origins === undefined || filter.origins.includes(origin))
        : selected(filter, row.sourceGroup, origin, valuation ?? "", age);
      audit.push({ kind: "exposure", disposition: keep ? "retained" : "filter", record: normalized });
      if (keep) normalizedExposureInputs.push(normalized);
    } catch { audit.push({ kind: "exposure", disposition: "invalid", record: row }); }
  }
  const timingByMeasure = Object.fromEntries(definition.definition.measures.filter((measure) => measure.kind === "exposure").map((measure) => [measure.id, measure.exposureTiming!])) as Record<string, "origin-static" | "valuation-specific">;
  const exposures = reconcileDiagnosticExposures(normalizedExposureInputs, timingByMeasure);
  const preparedCells: PreparedDiagnosticSourceCell[] = [];
  for (const [key, rows] of cells) {
    const [sourceGroup, origin, valuation] = key.split("\u0000") as [string, string, string];
    const period = diagnosticDevelopmentAge(definition, origin, valuation);
    const contributions: Record<string, DiagnosticMeasureContribution[]> = Object.create(null);
    const blockers: Record<string, DiagnosticStructuralBlocker[]> = Object.create(null);
    for (const measure of definition.definition.measures) { contributions[measure.id] = []; blockers[measure.id] = []; }
    for (const row of rows) {
      for (const measure of definition.definition.measures.filter((item) => item.source !== "exposure")) {
        contributions[measure.id]!.push(auditedDiagnosticContribution(row.recordId, own(row.measures, measure.id), measure.missing, row.source ? [row.source] : []));
      }
    }
    for (const exposure of exposures) {
      if (exposure.status !== "valid" || exposure.sourceGroup !== sourceGroup || exposure.origin !== origin || (exposure.valuation !== undefined && exposure.valuation !== valuation)) continue;
      contributions[exposure.measureId]!.push(auditedDiagnosticContribution(exposure.key, exposure.value, "unknown", exposure.sources, exposure.deduplicated));
    }
    for (const measure of definition.definition.measures.filter((item) => item.source === "exposure")) {
      if (contributions[measure.id]!.length === 0) blockers[measure.id]!.push({ code: "loss-without-exposure", message: "Loss cell has no applicable exposure observation", sourceIds: rows.map((row) => row.recordId).sort(codeUnit), sources: [] });
    }
    const components = Object.fromEntries(definition.definition.measures.map((measure) => [measure.id, finalizeDiagnosticContributions(contributions[measure.id]!, measure.missing, blockers[measure.id])])) as Record<string, DiagnosticMeasureStats>;
    preparedCells.push(deepFreeze({ sourceGroup, origin, valuation, developmentAge: period.developmentAge, ageUnit: period.ageUnit, lossRecordIds: rows.map((row) => row.recordId).sort(codeUnit), contributions, components, structuralBlockers: blockers, findings: [] }));
  }
  preparedCells.sort((a, b) => codeUnit(a.sourceGroup, b.sourceGroup) || codeUnit(a.origin, b.origin) || codeUnit(a.valuation, b.valuation));
  const expectedCells = (input.expectedCells ?? []).map((item) => ({ ...item }));
  for (const item of expectedCells) audit.push({ kind: "expected-cell", disposition: "retained", record: item });
  const identity = deepFreeze({ definitionIntegrity: definition.definitionIntegrity, filter, completePeriodCutoffs: [...(input.completePeriodCutoffs ?? [])], inputAudit: audit, cells: preparedCells, exposures, expectedCellsProvided: input.expectedCells !== undefined, expectedCells, findings: [] });
  const preparationFingerprint = `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({ identityVersion: 1, kind: "diagnostic-preparation", preparation: identity }))}`;
  const preparedBase = { definition, preparationFingerprint, filter, completePeriodCutoffs: input.completePeriodCutoffs ?? [], inputAudit: audit, cells: preparedCells, exposures, expectedCellsProvided: input.expectedCells !== undefined, expectedCells, findings: [] };
  const prepared = deepFreeze(preparedBase) as unknown as PreparedDiagnosticData;
  authentic.add(prepared);
  identities.set(prepared, identity);
  return prepared;
}

export function assertPreparedDiagnosticData(value: unknown): asserts value is PreparedDiagnosticData {
  if (value === null || typeof value !== "object" || !authentic.has(value)) throw new DiagnosticValidationError([{ domain: "input", code: "invalid-input-relationship", path: "$.prepared", message: "Value is not authentic prepared diagnostic data" }]);
}
export function getPreparedDiagnosticDataIdentity(value: PreparedDiagnosticData): DiagnosticDeepReadonly<NormalizedDiagnosticPreparationIdentity> { assertPreparedDiagnosticData(value); return identities.get(value)! }
export function verifyPreparedDiagnosticDataIntegrity(value: PreparedDiagnosticData): void {
  const identity = getPreparedDiagnosticDataIdentity(value);
  const tag = `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({ identityVersion: 1, kind: "diagnostic-preparation", preparation: identity }))}`;
  if (tag !== value.preparationFingerprint) throw new DiagnosticValidationError([{ domain: "input", code: "invalid-input-relationship", path: "$.prepared.preparationFingerprint", message: "Prepared diagnostic data integrity does not match its content" }]);
}

export type { JsonValue, DiagnosticAuditedNumericValue };
