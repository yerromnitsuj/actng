import { canonicalJson, fnv1a64 } from "./canonical.js";
import {
  assertCompiledDiagnosticDefinition,
  getCompiledDiagnosticDefinitionInternals,
  type CompiledDiagnosticDefinition,
  type DiagnosticDeepReadonly,
  type DiagnosticMeasureStats,
  type DiagnosticSourceLocation,
  type DiagnosticsFilter,
  type JsonValue,
} from "./diagnosticDefinitions.js";
import {
  auditedDiagnosticContribution,
  finalizeDiagnosticContributions,
  type DiagnosticMeasureContribution,
  type DiagnosticStructuralBlocker,
} from "./diagnosticAggregation.js";
import {
  deriveDiagnosticClaimMeasuresWithAudit,
  type DiagnosticDerivedValueAudit,
} from "./diagnosticDerivations.js";
import {
  compareDiagnosticPeriods,
  normalizeDiagnosticPeriod,
  type DiagnosticNormalizedPeriod,
} from "./diagnosticPeriods.js";
import {
  auditDiagnosticNumber,
  reconcileDiagnosticExposures,
  type DiagnosticAuditedNumericValue,
  type DiagnosticExposureAuditObservation,
  type DiagnosticExposureObservation,
  type ReconciledDiagnosticExposure,
} from "./diagnosticExposure.js";
import type { DiagnosticMetricFinding } from "./diagnosticFormulas.js";
import {
  DiagnosticValidationError,
  type DiagnosticValidationIssue,
} from "./types.js";
import { normalizeDiagnosticSourceLocations } from "./diagnosticSourceOrdering.js";
import {
  isDiagnosticPlainRecord,
  isDiagnosticToken,
} from "./diagnosticRuntime.js";

export interface DiagnosticLossRecordBase {
  readonly recordId: string;
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly complete: boolean;
  readonly source?: DiagnosticSourceLocation;
  readonly measures: Readonly<Record<string, number | null>>;
}

export interface DiagnosticClaimObservation extends DiagnosticLossRecordBase {
  readonly rowType: "claim";
  readonly claimId: string;
}

export interface DiagnosticLossSnapshot extends DiagnosticLossRecordBase {
  readonly rowType: "aggregate";
}

export type DiagnosticLossInput =
  | DiagnosticClaimObservation
  | DiagnosticLossSnapshot;

export interface DiagnosticCompletePeriodCutoff {
  readonly sourceGroup: string;
  readonly originThrough: string | null;
  readonly valuationThrough: string | null;
}

export interface DiagnosticExpectedCell {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly source?: DiagnosticSourceLocation;
}

export interface PrepareDiagnosticDataInput {
  readonly definition: CompiledDiagnosticDefinition;
  readonly losses: readonly DiagnosticLossInput[];
  readonly exposures: readonly DiagnosticExposureObservation[];
  readonly filter?: DiagnosticsFilter;
  readonly completePeriodCutoffs?: readonly DiagnosticCompletePeriodCutoff[];
  readonly expectedCells?: readonly DiagnosticExpectedCell[];
}

export type DiagnosticInputDisposition =
  | "invalid"
  | "complete-period-cutoff"
  | "filter"
  | "retained";

export interface DiagnosticLossInputAuditSnapshot {
  readonly recordId: string;
  readonly rowType: "claim" | "aggregate";
  readonly claimId: string | null;
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly complete: boolean;
  readonly measures: Readonly<Record<string, DiagnosticAuditedNumericValue>>;
  readonly source: DiagnosticSourceLocation | null;
}

export interface DiagnosticExposureInputAuditSnapshot {
  readonly key: string;
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string | null;
  readonly measureId: string;
  readonly value: DiagnosticAuditedNumericValue;
  readonly complete: boolean;
  readonly source: DiagnosticSourceLocation | null;
}

export interface DiagnosticExpectedCellAuditSnapshot {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly source: DiagnosticSourceLocation | null;
}

export type DiagnosticInputAuditRecord =
  | {
      readonly kind: "loss";
      readonly disposition: DiagnosticInputDisposition;
      readonly record: DiagnosticLossInputAuditSnapshot;
    }
  | {
      readonly kind: "exposure";
      readonly disposition: DiagnosticInputDisposition;
      readonly record: DiagnosticExposureInputAuditSnapshot;
    }
  | {
      readonly kind: "expected-cell";
      readonly disposition: Exclude<DiagnosticInputDisposition, "invalid">;
      readonly record: DiagnosticExpectedCellAuditSnapshot;
    };

export interface PreparedDiagnosticSourceCell {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly developmentAge: number;
  readonly ageUnit: string;
  readonly lossRecordIds: readonly string[];
  readonly contributions: Readonly<
    Record<string, readonly DiagnosticMeasureContribution[]>
  >;
  readonly components: Readonly<Record<string, DiagnosticMeasureStats>>;
  readonly structuralBlockers: Readonly<
    Record<string, readonly DiagnosticStructuralBlocker[]>
  >;
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

interface NormalizedCoordinate {
  readonly origin: DiagnosticNormalizedPeriod;
  readonly valuation: DiagnosticNormalizedPeriod;
  readonly developmentAge: number;
  readonly ageUnit: string;
}

interface LossCandidate {
  row: DiagnosticLossInput;
  snapshot: DiagnosticLossInputAuditSnapshot;
  disposition: DiagnosticInputDisposition;
  coordinate: NormalizedCoordinate | null;
  invalid: boolean;
}

interface ExposureCandidate {
  row: DiagnosticExposureObservation;
  snapshot: DiagnosticExposureInputAuditSnapshot;
  disposition: DiagnosticInputDisposition;
  origin: DiagnosticNormalizedPeriod | null;
  valuation: DiagnosticNormalizedPeriod | null;
  developmentAge: number | null;
  ageUnit: string | null;
  timing: "origin-static" | "valuation-specific" | null;
  invalid: boolean;
}

interface ExpectedCandidate {
  readonly row: DiagnosticExpectedCell;
  readonly snapshot: DiagnosticExpectedCellAuditSnapshot;
  disposition: Exclude<DiagnosticInputDisposition, "invalid">;
  readonly coordinate: NormalizedCoordinate;
}

interface NormalizedCutoff {
  readonly value: DiagnosticCompletePeriodCutoff;
  readonly originThrough: DiagnosticNormalizedPeriod | null;
  readonly valuationThrough: DiagnosticNormalizedPeriod | null;
}

interface PendingBlocker {
  readonly finding: DiagnosticMetricFinding;
  readonly measureIds: readonly string[];
  readonly cellKeys: readonly string[];
  readonly sourceIds: readonly string[];
}

const authentic = new WeakSet<object>();
const identities = new WeakMap<
  object,
  DiagnosticDeepReadonly<NormalizedDiagnosticPreparationIdentity>
>();

const STRUCTURAL = {
  "duplicate-loss-record-id": ["Loss record identity is duplicated", "fail"],
  "duplicate-claim-snapshot": ["Claim snapshot identity is duplicated", "fail"],
  "claim-identity-conflict": [
    "Claim identity has conflicting source group or origin",
    "fail",
  ],
  "duplicate-aggregate-snapshot": [
    "Aggregate source-cell identity is duplicated",
    "fail",
  ],
  "duplicate-exposure-identity": ["Exposure identity is duplicated", "fail"],
  "conflicting-exposure-identity": [
    "Exposure identity has conflicting observations",
    "fail",
  ],
  "unknown-origin-period": [
    "Origin period is not declared by the period axis",
    "fail",
  ],
  "unknown-valuation-period": [
    "Valuation period is not declared by the period axis",
    "fail",
  ],
  "valuation-before-origin": ["Valuation precedes origin", "fail"],
  "unsafe-development-age": [
    "Derived development age is not a nonnegative safe integer",
    "fail",
  ],
  "undeclared-loss-measure": [
    "Loss input contains an undeclared measure",
    "fail",
  ],
  "wrong-source-loss-measure": [
    "Loss input contains a measure that is not raw loss input",
    "fail",
  ],
  "undeclared-exposure-measure": [
    "Exposure input contains an undeclared measure",
    "fail",
  ],
  "wrong-source-exposure-measure": [
    "Exposure input names a measure that is not exposure input",
    "fail",
  ],
  "incomplete-loss-record": ["Loss record is marked incomplete", "fail"],
  "missing-exposure-value": [
    "Exposure observation has a missing value",
    "fail",
  ],
  "incomplete-exposure": ["Exposure observation is marked incomplete", "fail"],
  "non-finite-exposure": ["Exposure observation is non-finite", "fail"],
  "loss-without-exposure": [
    "Loss source cell has no matching required exposure",
    "warning",
  ],
  "exposure-without-loss": [
    "Exposure has no matching retained loss source cell",
    "warning",
  ],
  "missing-expected-cell": ["Expected source cell is absent", "fail"],
} as const;

type StructuralCode = keyof typeof STRUCTURAL;

function codeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function own<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function deepFreeze<T>(
  value: T,
  seen = new WeakSet<object>(),
): DiagnosticDeepReadonly<T> {
  if (value === null || typeof value !== "object" || seen.has(value))
    return value as DiagnosticDeepReadonly<T>;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child, seen);
  return Object.freeze(value) as DiagnosticDeepReadonly<T>;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(codeUnit);
}

function normalizeSources(
  values: readonly (DiagnosticSourceLocation | undefined | null)[],
): DiagnosticSourceLocation[] {
  return normalizeDiagnosticSourceLocations(values);
}

function structuralFinding(
  code: StructuralCode,
  context: Omit<
    DiagnosticMetricFinding,
    "code" | "message" | "severity" | "category" | "sources"
  > & {
    readonly sources?: readonly DiagnosticSourceLocation[];
  } = {},
): DiagnosticMetricFinding {
  const [message, severity] = STRUCTURAL[code];
  return {
    code,
    message,
    severity,
    category: "structural",
    ...context,
    sources: normalizeSources(context.sources ?? []),
  };
}

function aggregationFinding(
  code:
    | "diagnostic-measure-missing"
    | "diagnostic-measure-imputed-zero"
    | "diagnostic-measure-non-finite"
    | "diagnostic-measure-overflow",
  context: Omit<
    DiagnosticMetricFinding,
    "code" | "message" | "severity" | "category" | "sources"
  > & { readonly sources?: readonly DiagnosticSourceLocation[] },
): DiagnosticMetricFinding {
  const catalog = {
    "diagnostic-measure-missing": ["Measure input is missing", "warning"],
    "diagnostic-measure-imputed-zero": [
      "Missing measure input was imputed as zero",
      "info",
    ],
    "diagnostic-measure-non-finite": ["Measure input is non-finite", "fail"],
    "diagnostic-measure-overflow": ["Measure aggregation overflowed", "fail"],
  } as const;
  const [message, severity] = catalog[code];
  return {
    code,
    message,
    severity,
    category: "aggregation",
    ...context,
    sources: normalizeSources(context.sources ?? []),
  };
}

function mergeFindings(
  values: readonly DiagnosticMetricFinding[],
): DiagnosticMetricFinding[] {
  const merged = new Map<string, DiagnosticMetricFinding>();
  for (const value of values) {
    const key = canonicalJson({ ...value, sources: [] });
    const previous = merged.get(key);
    merged.set(
      key,
      previous === undefined
        ? { ...value, sources: normalizeSources(value.sources) }
        : {
            ...previous,
            sources: normalizeSources([...previous.sources, ...value.sources]),
          },
    );
  }
  return [...merged.values()].sort(
    (left, right) =>
      codeUnit(left.code, right.code) ||
      codeUnit(
        canonicalJson({ ...left, sources: [] }),
        canonicalJson({ ...right, sources: [] }),
      ) ||
      codeUnit(canonicalJson(left.sources), canonicalJson(right.sources)),
  );
}

function snapshotLoss(
  row: DiagnosticLossInput,
): DiagnosticLossInputAuditSnapshot {
  const measures = Object.fromEntries(
    Object.keys(row.measures)
      .sort(codeUnit)
      .map((measureId) => [
        measureId,
        auditDiagnosticNumber(row.measures[measureId] ?? null),
      ]),
  );
  return {
    recordId: row.recordId,
    rowType: row.rowType,
    claimId: row.rowType === "claim" ? row.claimId : null,
    sourceGroup: row.sourceGroup,
    origin: row.origin,
    valuation: row.valuation,
    complete: row.complete,
    measures,
    source: row.source === undefined ? null : { ...row.source },
  };
}

function snapshotExposure(
  row: DiagnosticExposureObservation,
): DiagnosticExposureInputAuditSnapshot {
  return {
    key: row.key,
    sourceGroup: row.sourceGroup,
    origin: row.origin,
    valuation: row.valuation ?? null,
    measureId: row.measureId,
    value: auditDiagnosticNumber(row.value),
    complete: row.complete,
    source: row.source === undefined ? null : { ...row.source },
  };
}

function normalizeConfiguredPeriod(
  definition: CompiledDiagnosticDefinition,
  side: "origin" | "valuation",
  label: string,
  path: string,
  issues: DiagnosticValidationIssue[],
): DiagnosticNormalizedPeriod | null {
  try {
    return normalizeDiagnosticPeriod(definition, side, label);
  } catch {
    issues.push({
      domain: "configuration",
      code: "invalid-period",
      path,
      message: `Unknown ${side} period ${JSON.stringify(label)}`,
    });
    return null;
  }
}

function normalizeFilter(
  definition: CompiledDiagnosticDefinition,
  input: DiagnosticsFilter | undefined,
  knownSourceGroups: ReadonlySet<string>,
  issues: DiagnosticValidationIssue[],
): {
  readonly value: DiagnosticsFilter | null;
  readonly originCoordinates: ReadonlyMap<string, number>;
  readonly valuationCoordinates: ReadonlyMap<string, number>;
} {
  if (input === undefined)
    return {
      value: null,
      originCoordinates: new Map(),
      valuationCoordinates: new Map(),
    };
  const checkTokens = (
    values: readonly string[] | undefined,
    path: string,
  ): string[] | undefined => {
    if (values === undefined) return undefined;
    values.forEach((value, index) => {
      if (typeof value !== "string" || value.length === 0)
        issues.push({
          domain: "configuration",
          code: "invalid-string",
          path: `${path}[${index}]`,
          message: "Filter values must be nonempty strings",
        });
    });
    return uniqueSorted(
      values.filter((value) => typeof value === "string" && value.length > 0),
    );
  };
  const normalizeList = (
    values: readonly string[] | undefined,
    side: "origin" | "valuation",
    path: string,
  ) => {
    const checked = checkTokens(values, path);
    if (checked === undefined)
      return { labels: undefined, coordinates: new Map<string, number>() };
    const normalized = checked
      .map((label, index) =>
        normalizeConfiguredPeriod(
          definition,
          side,
          label,
          `${path}[${index}]`,
          issues,
        ),
      )
      .filter((value): value is DiagnosticNormalizedPeriod => value !== null);
    return {
      labels: uniqueSorted(normalized.map((value) => value.label)),
      coordinates: new Map(
        normalized.map((value) => [value.label, value.coordinate]),
      ),
    };
  };
  const origins = normalizeList(input.origins, "origin", "$.filter.origins");
  const valuations = normalizeList(
    input.valuations,
    "valuation",
    "$.filter.valuations",
  );
  const originFrom =
    input.originFrom === undefined
      ? null
      : normalizeConfiguredPeriod(
          definition,
          "origin",
          input.originFrom,
          "$.filter.originFrom",
          issues,
        );
  const originThrough =
    input.originThrough === undefined
      ? null
      : normalizeConfiguredPeriod(
          definition,
          "origin",
          input.originThrough,
          "$.filter.originThrough",
          issues,
        );
  const valuationFrom =
    input.valuationFrom === undefined
      ? null
      : normalizeConfiguredPeriod(
          definition,
          "valuation",
          input.valuationFrom,
          "$.filter.valuationFrom",
          issues,
        );
  const valuationThrough =
    input.valuationThrough === undefined
      ? null
      : normalizeConfiguredPeriod(
          definition,
          "valuation",
          input.valuationThrough,
          "$.filter.valuationThrough",
          issues,
        );
  if (
    originFrom &&
    originThrough &&
    compareDiagnosticPeriods(originFrom, originThrough) > 0
  )
    issues.push({
      domain: "configuration",
      code: "invalid-configuration",
      path: "$.filter",
      message: "Origin range start exceeds end",
    });
  if (
    valuationFrom &&
    valuationThrough &&
    compareDiagnosticPeriods(valuationFrom, valuationThrough) > 0
  )
    issues.push({
      domain: "configuration",
      code: "invalid-configuration",
      path: "$.filter",
      message: "Valuation range start exceeds end",
    });
  for (const [name, bound] of [
    ["minDevelopmentAge", input.minDevelopmentAge],
    ["maxDevelopmentAge", input.maxDevelopmentAge],
  ] as const) {
    if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 0))
      issues.push({
        domain: "configuration",
        code: "invalid-configuration",
        path: `$.filter.${name}`,
        message: "Development-age bounds must be nonnegative safe integers",
      });
  }
  if (
    input.minDevelopmentAge !== undefined &&
    input.maxDevelopmentAge !== undefined &&
    input.minDevelopmentAge > input.maxDevelopmentAge
  )
    issues.push({
      domain: "configuration",
      code: "invalid-configuration",
      path: "$.filter",
      message: "Minimum development age exceeds maximum",
    });
  const sourceGroups = checkTokens(input.sourceGroups, "$.filter.sourceGroups");
  const outputGroups = checkTokens(input.outputGroups, "$.filter.outputGroups");
  const instanceIds = checkTokens(input.instanceIds, "$.filter.instanceIds");
  const validInstances = new Set(
    definition.definition.instances.map((instance) => instance.id),
  );
  for (const [index, sourceGroup] of (sourceGroups ?? []).entries()) {
    if (!knownSourceGroups.has(sourceGroup))
      issues.push({
        domain: "configuration",
        code: "unknown-reference",
        path: `$.filter.sourceGroups[${index}]`,
        message: `Unknown source group ${sourceGroup}`,
      });
  }
  for (const [index, instanceId] of (instanceIds ?? []).entries())
    if (!validInstances.has(instanceId))
      issues.push({
        domain: "configuration",
        code: "unknown-reference",
        path: `$.filter.instanceIds[${index}]`,
        message: `Unknown metric instance ${instanceId}`,
      });
  const value: DiagnosticsFilter = {
    ...(sourceGroups === undefined ? {} : { sourceGroups }),
    ...(outputGroups === undefined ? {} : { outputGroups }),
    ...(origins.labels === undefined ? {} : { origins: origins.labels }),
    ...(originFrom === null ? {} : { originFrom: originFrom.label }),
    ...(originThrough === null ? {} : { originThrough: originThrough.label }),
    ...(valuations.labels === undefined
      ? {}
      : { valuations: valuations.labels }),
    ...(valuationFrom === null ? {} : { valuationFrom: valuationFrom.label }),
    ...(valuationThrough === null
      ? {}
      : { valuationThrough: valuationThrough.label }),
    ...(input.minDevelopmentAge === undefined
      ? {}
      : { minDevelopmentAge: input.minDevelopmentAge }),
    ...(input.maxDevelopmentAge === undefined
      ? {}
      : { maxDevelopmentAge: input.maxDevelopmentAge }),
    ...(instanceIds === undefined ? {} : { instanceIds }),
  };
  return {
    value,
    originCoordinates: new Map([
      ...origins.coordinates,
      ...(originFrom
        ? [[originFrom.label, originFrom.coordinate] as const]
        : []),
      ...(originThrough
        ? [[originThrough.label, originThrough.coordinate] as const]
        : []),
    ]),
    valuationCoordinates: new Map([
      ...valuations.coordinates,
      ...(valuationFrom
        ? [[valuationFrom.label, valuationFrom.coordinate] as const]
        : []),
      ...(valuationThrough
        ? [[valuationThrough.label, valuationThrough.coordinate] as const]
        : []),
    ]),
  };
}

function normalizeCutoffs(
  definition: CompiledDiagnosticDefinition,
  input: readonly DiagnosticCompletePeriodCutoff[],
  knownSourceGroups: ReadonlySet<string>,
  issues: DiagnosticValidationIssue[],
): readonly NormalizedCutoff[] {
  const groups = new Set<string>();
  const normalized: NormalizedCutoff[] = [];
  input.forEach((cutoff, index) => {
    if (!knownSourceGroups.has(cutoff.sourceGroup))
      issues.push({
        domain: "configuration",
        code: "unknown-reference",
        path: `$.completePeriodCutoffs[${index}].sourceGroup`,
        message: `Unknown source group ${cutoff.sourceGroup}`,
      });
    if (groups.has(cutoff.sourceGroup))
      issues.push({
        domain: "configuration",
        code: "duplicate-id",
        path: `$.completePeriodCutoffs[${index}].sourceGroup`,
        message: "Complete-period cutoff source group is duplicated",
      });
    groups.add(cutoff.sourceGroup);
    const origin =
      cutoff.originThrough === null
        ? null
        : normalizeConfiguredPeriod(
            definition,
            "origin",
            cutoff.originThrough,
            `$.completePeriodCutoffs[${index}].originThrough`,
            issues,
          );
    const valuation =
      cutoff.valuationThrough === null
        ? null
        : normalizeConfiguredPeriod(
            definition,
            "valuation",
            cutoff.valuationThrough,
            `$.completePeriodCutoffs[${index}].valuationThrough`,
            issues,
          );
    normalized.push({
      value: {
        sourceGroup: cutoff.sourceGroup,
        originThrough: origin?.label ?? null,
        valuationThrough: valuation?.label ?? null,
      },
      originThrough: origin,
      valuationThrough: valuation,
    });
  });
  return normalized.sort((left, right) =>
    codeUnit(left.value.sourceGroup, right.value.sourceGroup),
  );
}

function coordinateFor(
  definition: CompiledDiagnosticDefinition,
  originLabel: string,
  valuationLabel: string,
): {
  readonly coordinate: NormalizedCoordinate | null;
  readonly issue:
    | "unknown-origin-period"
    | "unknown-valuation-period"
    | "valuation-before-origin"
    | "unsafe-development-age"
    | null;
} {
  let origin: DiagnosticNormalizedPeriod;
  let valuation: DiagnosticNormalizedPeriod;
  try {
    origin = normalizeDiagnosticPeriod(definition, "origin", originLabel);
  } catch {
    return { coordinate: null, issue: "unknown-origin-period" };
  }
  try {
    valuation = normalizeDiagnosticPeriod(
      definition,
      "valuation",
      valuationLabel,
    );
  } catch {
    return { coordinate: null, issue: "unknown-valuation-period" };
  }
  const developmentAge =
    valuation.coordinate -
    origin.coordinate +
    definition.definition.periodAxis.ageOffset;
  if (!Number.isSafeInteger(developmentAge))
    return { coordinate: null, issue: "unsafe-development-age" };
  if (developmentAge < 0)
    return { coordinate: null, issue: "valuation-before-origin" };
  return {
    coordinate: {
      origin,
      valuation,
      developmentAge,
      ageUnit: definition.definition.periodAxis.ageUnit,
    },
    issue: null,
  };
}

function cellKey(
  sourceGroup: string,
  origin: string,
  valuation: string,
): string {
  return canonicalJson([sourceGroup, origin, valuation]);
}

function parseCellKey(key: string): readonly [string, string, string] {
  return JSON.parse(key) as [string, string, string];
}

function coordinateContext(candidate: {
  readonly row: { readonly sourceGroup: string };
  readonly coordinate: NormalizedCoordinate | null;
}): Partial<DiagnosticMetricFinding> {
  if (candidate.coordinate === null) return {};
  return {
    sourceGroup: candidate.row.sourceGroup,
    origin: candidate.coordinate.origin.label,
    valuation: candidate.coordinate.valuation.label,
    developmentAge: candidate.coordinate.developmentAge,
    ageUnit: candidate.coordinate.ageUnit,
  };
}

function selectedBySource(
  filter: DiagnosticsFilter | null,
  sourceGroup: string,
): boolean {
  return (
    filter?.sourceGroups === undefined ||
    filter.sourceGroups.includes(sourceGroup)
  );
}

function selectedByOrigin(
  filter: DiagnosticsFilter | null,
  origin: DiagnosticNormalizedPeriod,
  coordinates: ReadonlyMap<string, number>,
): boolean {
  const from =
    filter?.originFrom === undefined
      ? null
      : coordinates.get(filter.originFrom)!;
  const through =
    filter?.originThrough === undefined
      ? null
      : coordinates.get(filter.originThrough)!;
  return (
    (filter?.origins === undefined || filter.origins.includes(origin.label)) &&
    (from === null || origin.coordinate >= from) &&
    (through === null || origin.coordinate <= through)
  );
}

function selectedByValuation(
  filter: DiagnosticsFilter | null,
  valuation: DiagnosticNormalizedPeriod,
  coordinates: ReadonlyMap<string, number>,
): boolean {
  const from =
    filter?.valuationFrom === undefined
      ? null
      : coordinates.get(filter.valuationFrom)!;
  const through =
    filter?.valuationThrough === undefined
      ? null
      : coordinates.get(filter.valuationThrough)!;
  return (
    (filter?.valuations === undefined ||
      filter.valuations.includes(valuation.label)) &&
    (from === null || valuation.coordinate >= from) &&
    (through === null || valuation.coordinate <= through)
  );
}

function selectedByAge(filter: DiagnosticsFilter | null, age: number): boolean {
  return (
    (filter?.minDevelopmentAge === undefined ||
      age >= filter.minDevelopmentAge) &&
    (filter?.maxDevelopmentAge === undefined || age <= filter.maxDevelopmentAge)
  );
}

function beyondCutoff(
  candidate: {
    readonly row: { readonly sourceGroup: string };
    readonly coordinate: NormalizedCoordinate;
  },
  cutoffByGroup: ReadonlyMap<string, NormalizedCutoff>,
): boolean {
  const cutoff = cutoffByGroup.get(candidate.row.sourceGroup);
  return (
    cutoff !== undefined &&
    ((cutoff.originThrough !== null &&
      compareDiagnosticPeriods(
        candidate.coordinate.origin,
        cutoff.originThrough,
      ) > 0) ||
      (cutoff.valuationThrough !== null &&
        compareDiagnosticPeriods(
          candidate.coordinate.valuation,
          cutoff.valuationThrough,
        ) > 0))
  );
}

function addToMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function commonCoordinate(
  candidates: readonly LossCandidate[],
): Partial<DiagnosticMetricFinding> {
  const keys = uniqueSorted(
    candidates.flatMap((candidate) =>
      candidate.coordinate === null
        ? []
        : [
            cellKey(
              candidate.row.sourceGroup,
              candidate.coordinate.origin.label,
              candidate.coordinate.valuation.label,
            ),
          ],
    ),
  );
  return keys.length === 1 ? coordinateContext(candidates[0]!) : {};
}

function exposureIdentity(candidate: ExposureCandidate): string {
  return canonicalJson(
    candidate.timing === "valuation-specific"
      ? [
          candidate.row.measureId,
          candidate.row.key,
          candidate.row.valuation ?? null,
        ]
      : [candidate.row.measureId, candidate.row.key],
  );
}

function exposureCoordinateContext(
  candidates: readonly ExposureCandidate[],
): Partial<DiagnosticMetricFinding> {
  const coherentSource = uniqueSorted(
    candidates.map((candidate) => candidate.row.sourceGroup),
  );
  const coherentOrigin = uniqueSorted(
    candidates.flatMap((candidate) =>
      candidate.origin ? [candidate.origin.label] : [],
    ),
  );
  const coherentValuation = uniqueSorted(
    candidates.flatMap((candidate) =>
      candidate.valuation ? [candidate.valuation.label] : [],
    ),
  );
  if (coherentSource.length !== 1 || coherentOrigin.length !== 1) return {};
  const first = candidates[0]!;
  if (
    first.timing === "valuation-specific" &&
    coherentValuation.length === 1 &&
    first.developmentAge !== null &&
    first.ageUnit !== null
  ) {
    return {
      sourceGroup: coherentSource[0],
      origin: coherentOrigin[0],
      valuation: coherentValuation[0],
      developmentAge: first.developmentAge,
      ageUnit: first.ageUnit,
    };
  }
  return { sourceGroup: coherentSource[0], origin: coherentOrigin[0] };
}

function auditSort(
  left: DiagnosticInputAuditRecord,
  right: DiagnosticInputAuditRecord,
): number {
  const rank = { loss: 0, exposure: 1, "expected-cell": 2 } as const;
  const disposition = {
    invalid: 0,
    "complete-period-cutoff": 1,
    filter: 2,
    retained: 3,
  } as const;
  return (
    rank[left.kind] - rank[right.kind] ||
    codeUnit(canonicalJson(left.record), canonicalJson(right.record)) ||
    disposition[left.disposition] - disposition[right.disposition]
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isDiagnosticPlainRecord(value);
}

function preparationBoundaryIssues(
  value: unknown,
): DiagnosticValidationIssue[] {
  const issues: DiagnosticValidationIssue[] = [];
  if (!isPlainRecord(value))
    return [
      {
        domain: "input",
        code: "invalid-type",
        path: "$",
        message: "Preparation input must be an object",
      },
    ];
  const issue = (
    domain: "input" | "configuration",
    code: DiagnosticValidationIssue["code"],
    path: string,
    message: string,
  ) => issues.push({ domain, code, path, message });
  const token = (
    item: unknown,
    path: string,
    domain: "input" | "configuration" = "input",
  ) => {
    if (typeof item !== "string")
      issue(domain, "invalid-type", path, "Expected a string");
    else if (!isDiagnosticToken(item))
      issue(
        domain,
        "invalid-string",
        path,
        "Expected a nonempty token with valid Unicode and no U+0000",
      );
  };
  const exactKeys = (
    item: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
    domain: "input" | "configuration",
  ) => {
    for (const key of Object.keys(item)) {
      const keyPath = `${path}.${key}`;
      if (!allowed.includes(key))
        issue(domain, "unknown-key", keyPath, `Unknown key ${key}`);
      else if (item[key] === undefined)
        issue(
          domain,
          "invalid-type",
          keyPath,
          "Explicit undefined is not allowed",
        );
    }
  };
  const source = (item: unknown, path: string) => {
    if (!isPlainRecord(item)) {
      issue("input", "invalid-type", path, "Source location must be an object");
      return;
    }
    exactKeys(
      item,
      ["artifactId", "sourceFile", "sourceSheet", "sourceRow", "sourceCell"],
      path,
      "input",
    );
    token(item.artifactId, `${path}.artifactId`);
    for (const key of ["sourceFile", "sourceSheet", "sourceCell"] as const)
      if (item[key] !== undefined) token(item[key], `${path}.${key}`);
    if (
      item.sourceRow !== undefined &&
      (typeof item.sourceRow !== "number" ||
        !Number.isSafeInteger(item.sourceRow) ||
        item.sourceRow < 0)
    )
      issue(
        "input",
        "invalid-number",
        `${path}.sourceRow`,
        "Source row must be a nonnegative safe integer",
      );
  };
  const array = (
    item: unknown,
    path: string,
    domain: "input" | "configuration",
  ): readonly unknown[] => {
    if (!Array.isArray(item)) {
      issue(domain, "invalid-type", path, "Expected an array");
      return [];
    }
    return item;
  };
  exactKeys(
    value,
    [
      "definition",
      "losses",
      "exposures",
      "filter",
      "completePeriodCutoffs",
      "expectedCells",
    ],
    "$",
    "configuration",
  );
  for (const [index, raw] of array(
    value.losses,
    "$.losses",
    "input",
  ).entries()) {
    const path = `$.losses[${index}]`;
    if (!isPlainRecord(raw)) {
      issue("input", "invalid-type", path, "Loss record must be an object");
      continue;
    }
    exactKeys(
      raw,
      [
        "rowType",
        "recordId",
        "claimId",
        "sourceGroup",
        "origin",
        "valuation",
        "complete",
        "source",
        "measures",
      ],
      path,
      "input",
    );
    if (raw.rowType !== "claim" && raw.rowType !== "aggregate")
      issue(
        "input",
        "invalid-type",
        `${path}.rowType`,
        "Loss row type must be claim or aggregate",
      );
    token(raw.recordId, `${path}.recordId`);
    token(raw.sourceGroup, `${path}.sourceGroup`);
    token(raw.origin, `${path}.origin`);
    token(raw.valuation, `${path}.valuation`);
    if (raw.rowType === "claim") token(raw.claimId, `${path}.claimId`);
    else if (raw.claimId !== undefined)
      issue(
        "input",
        "unknown-key",
        `${path}.claimId`,
        "Aggregate loss rows cannot contain claimId",
      );
    if (typeof raw.complete !== "boolean")
      issue(
        "input",
        "invalid-type",
        `${path}.complete`,
        "Loss completeness must be boolean",
      );
    if (raw.source !== undefined) source(raw.source, `${path}.source`);
    if (!isPlainRecord(raw.measures))
      issue(
        "input",
        "invalid-type",
        `${path}.measures`,
        "Measures must be an object",
      );
    else
      for (const [measureId, amount] of Object.entries(raw.measures)) {
        token(measureId, `${path}.measures`);
        if (amount !== null && typeof amount !== "number")
          issue(
            "input",
            "invalid-type",
            `${path}.measures.${measureId}`,
            "Measure value must be a number or null",
          );
      }
  }
  for (const [index, raw] of array(
    value.exposures,
    "$.exposures",
    "input",
  ).entries()) {
    const path = `$.exposures[${index}]`;
    if (!isPlainRecord(raw)) {
      issue(
        "input",
        "invalid-type",
        path,
        "Exposure observation must be an object",
      );
      continue;
    }
    exactKeys(
      raw,
      [
        "key",
        "sourceGroup",
        "origin",
        "valuation",
        "measureId",
        "value",
        "complete",
        "source",
      ],
      path,
      "input",
    );
    token(raw.key, `${path}.key`);
    token(raw.sourceGroup, `${path}.sourceGroup`);
    token(raw.origin, `${path}.origin`);
    token(raw.measureId, `${path}.measureId`);
    if (raw.valuation !== undefined) token(raw.valuation, `${path}.valuation`);
    if (raw.value !== null && typeof raw.value !== "number")
      issue(
        "input",
        "invalid-type",
        `${path}.value`,
        "Exposure value must be a number or null",
      );
    if (typeof raw.complete !== "boolean")
      issue(
        "input",
        "invalid-type",
        `${path}.complete`,
        "Exposure completeness must be boolean",
      );
    if (raw.source !== undefined) source(raw.source, `${path}.source`);
  }
  if (value.filter !== undefined && !isPlainRecord(value.filter))
    issue(
      "configuration",
      "invalid-type",
      "$.filter",
      "Filter must be an object",
    );
  if (isPlainRecord(value.filter)) {
    const filter = value.filter;
    const keys = [
      "sourceGroups",
      "outputGroups",
      "origins",
      "originFrom",
      "originThrough",
      "valuations",
      "valuationFrom",
      "valuationThrough",
      "minDevelopmentAge",
      "maxDevelopmentAge",
      "instanceIds",
    ] as const;
    exactKeys(filter, keys, "$.filter", "configuration");
    for (const key of [
      "sourceGroups",
      "outputGroups",
      "origins",
      "valuations",
      "instanceIds",
    ] as const)
      if (filter[key] !== undefined)
        array(filter[key], `$.filter.${key}`, "configuration").forEach(
          (item, index) =>
            token(item, `$.filter.${key}[${index}]`, "configuration"),
        );
    for (const key of [
      "originFrom",
      "originThrough",
      "valuationFrom",
      "valuationThrough",
    ] as const)
      if (filter[key] !== undefined)
        token(filter[key], `$.filter.${key}`, "configuration");
  }
  if (value.completePeriodCutoffs !== undefined)
    for (const [index, raw] of array(
      value.completePeriodCutoffs,
      "$.completePeriodCutoffs",
      "configuration",
    ).entries()) {
      const path = `$.completePeriodCutoffs[${index}]`;
      if (!isPlainRecord(raw)) {
        issue(
          "configuration",
          "invalid-type",
          path,
          "Cutoff must be an object",
        );
        continue;
      }
      exactKeys(
        raw,
        ["sourceGroup", "originThrough", "valuationThrough"],
        path,
        "configuration",
      );
      token(raw.sourceGroup, `${path}.sourceGroup`, "configuration");
      for (const key of ["originThrough", "valuationThrough"] as const)
        if (raw[key] !== null)
          token(raw[key], `${path}.${key}`, "configuration");
    }
  if (value.expectedCells !== undefined)
    for (const [index, raw] of array(
      value.expectedCells,
      "$.expectedCells",
      "configuration",
    ).entries()) {
      const path = `$.expectedCells[${index}]`;
      if (!isPlainRecord(raw)) {
        issue(
          "configuration",
          "invalid-type",
          path,
          "Expected cell must be an object",
        );
        continue;
      }
      exactKeys(
        raw,
        ["sourceGroup", "origin", "valuation", "source"],
        path,
        "configuration",
      );
      token(raw.sourceGroup, `${path}.sourceGroup`, "configuration");
      token(raw.origin, `${path}.origin`, "configuration");
      token(raw.valuation, `${path}.valuation`, "configuration");
      if (raw.source !== undefined) source(raw.source, `${path}.source`);
    }
  return issues;
}

export function prepareDiagnosticData(
  input: PrepareDiagnosticDataInput,
): PreparedDiagnosticData {
  assertCompiledDiagnosticDefinition(
    (input as unknown as { readonly definition?: unknown } | null)?.definition,
  );
  const boundaryIssues = preparationBoundaryIssues(input);
  if (boundaryIssues.length > 0)
    throw new DiagnosticValidationError(boundaryIssues);
  const definition = input.definition;
  const internals = getCompiledDiagnosticDefinitionInternals(definition);
  const issues: DiagnosticValidationIssue[] = [];
  const knownSourceGroups = new Set<string>([
    ...input.losses.map((row) => row.sourceGroup),
    ...input.exposures.map((row) => row.sourceGroup),
    ...(input.expectedCells ?? []).map((row) => row.sourceGroup),
  ]);
  const normalizedFilter = normalizeFilter(
    definition,
    input.filter,
    knownSourceGroups,
    issues,
  );
  const normalizedCutoffs = normalizeCutoffs(
    definition,
    input.completePeriodCutoffs ?? [],
    knownSourceGroups,
    issues,
  );
  const cutoffByGroup = new Map(
    normalizedCutoffs.map((cutoff) => [cutoff.value.sourceGroup, cutoff]),
  );

  input.losses.forEach((row, index) => {
    if (row.rowType !== definition.definition.lossRowGrain)
      issues.push({
        domain: "input",
        code: "invalid-input-relationship",
        path: `$.losses[${index}].rowType`,
        message: "Loss row type does not match definition grain",
      });
  });
  input.exposures.forEach((row, index) => {
    const measure = internals.measuresById.get(row.measureId);
    if (
      measure?.exposureTiming === "valuation-specific" &&
      row.valuation === undefined
    )
      issues.push({
        domain: "input",
        code: "missing-required",
        path: `$.exposures[${index}].valuation`,
        message: "Valuation-specific exposure requires valuation",
      });
  });

  const expectedCandidates: ExpectedCandidate[] = [];
  const expectedKeys = new Set<string>();
  (input.expectedCells ?? []).forEach((row, index) => {
    const origin = normalizeConfiguredPeriod(
      definition,
      "origin",
      row.origin,
      `$.expectedCells[${index}].origin`,
      issues,
    );
    const valuation = normalizeConfiguredPeriod(
      definition,
      "valuation",
      row.valuation,
      `$.expectedCells[${index}].valuation`,
      issues,
    );
    if (!origin || !valuation) return;
    const developmentAge =
      valuation.coordinate -
      origin.coordinate +
      definition.definition.periodAxis.ageOffset;
    if (!Number.isSafeInteger(developmentAge) || developmentAge < 0) {
      issues.push({
        domain: "configuration",
        code: "invalid-period",
        path: `$.expectedCells[${index}].valuation`,
        message:
          "Expected-cell valuation precedes origin or produces an unsafe development age",
      });
      return;
    }
    const normalized = {
      ...row,
      origin: origin.label,
      valuation: valuation.label,
    };
    const key = cellKey(row.sourceGroup, origin.label, valuation.label);
    if (expectedKeys.has(key))
      issues.push({
        domain: "configuration",
        code: "duplicate-id",
        path: `$.expectedCells[${index}]`,
        message:
          "Expected source cell is duplicated after period normalization",
      });
    expectedKeys.add(key);
    expectedCandidates.push({
      row: normalized,
      snapshot: {
        sourceGroup: row.sourceGroup,
        origin: origin.label,
        valuation: valuation.label,
        source: row.source === undefined ? null : { ...row.source },
      },
      disposition: "retained",
      coordinate: {
        origin,
        valuation,
        developmentAge,
        ageUnit: definition.definition.periodAxis.ageUnit,
      },
    });
  });
  if (issues.length > 0) throw new DiagnosticValidationError(issues);

  const filter = normalizedFilter.value;
  const findings: DiagnosticMetricFinding[] = [];
  const pendingBlockers: PendingBlocker[] = [];
  const lossCandidates: LossCandidate[] = input.losses.map((inputRow) => ({
    row: {
      ...inputRow,
      measures: Object.fromEntries(
        Object.keys(inputRow.measures)
          .sort(codeUnit)
          .map((key) => [key, inputRow.measures[key]!]),
      ),
    } as DiagnosticLossInput,
    snapshot: snapshotLoss(inputRow),
    disposition: selectedBySource(filter, inputRow.sourceGroup)
      ? "retained"
      : "filter",
    coordinate: null,
    invalid: false,
  }));

  for (const candidate of lossCandidates) {
    if (candidate.disposition !== "retained") continue;
    let origin: DiagnosticNormalizedPeriod | null = null;
    let valuation: DiagnosticNormalizedPeriod | null = null;
    try {
      origin = normalizeDiagnosticPeriod(
        definition,
        "origin",
        candidate.row.origin,
      );
    } catch {
      findings.push(
        structuralFinding("unknown-origin-period", {
          recordId: candidate.row.recordId,
          sourceGroup: candidate.row.sourceGroup,
          origin: candidate.row.origin,
          valuation: candidate.row.valuation,
          sources: candidate.row.source ? [candidate.row.source] : [],
        }),
      );
    }
    if (origin !== null)
      candidate.snapshot = { ...candidate.snapshot, origin: origin.label };
    try {
      valuation = normalizeDiagnosticPeriod(
        definition,
        "valuation",
        candidate.row.valuation,
      );
    } catch {
      findings.push(
        structuralFinding("unknown-valuation-period", {
          recordId: candidate.row.recordId,
          sourceGroup: candidate.row.sourceGroup,
          origin: origin?.label ?? candidate.row.origin,
          valuation: candidate.row.valuation,
          sources: candidate.row.source ? [candidate.row.source] : [],
        }),
      );
    }
    if (valuation !== null)
      candidate.snapshot = {
        ...candidate.snapshot,
        valuation: valuation.label,
      };
    if (origin === null || valuation === null) {
      candidate.disposition = "invalid";
      candidate.invalid = true;
      continue;
    }
    const developmentAge =
      valuation.coordinate -
      origin.coordinate +
      definition.definition.periodAxis.ageOffset;
    if (!Number.isSafeInteger(developmentAge) || developmentAge < 0) {
      const code: StructuralCode = Number.isSafeInteger(developmentAge)
        ? "valuation-before-origin"
        : "unsafe-development-age";
      findings.push(
        structuralFinding(code, {
          recordId: candidate.row.recordId,
          sourceGroup: candidate.row.sourceGroup,
          origin: origin.label,
          valuation: valuation.label,
          sources: candidate.row.source ? [candidate.row.source] : [],
        }),
      );
      candidate.disposition = "invalid";
      candidate.invalid = true;
      continue;
    }
    candidate.coordinate = {
      origin,
      valuation,
      developmentAge,
      ageUnit: definition.definition.periodAxis.ageUnit,
    };
    candidate.row = {
      ...candidate.row,
      origin: origin.label,
      valuation: valuation.label,
    } as DiagnosticLossInput;
    candidate.snapshot = {
      ...candidate.snapshot,
      origin: candidate.row.origin,
      valuation: candidate.row.valuation,
    };
    if (
      beyondCutoff(
        candidate as LossCandidate & { coordinate: NormalizedCoordinate },
        cutoffByGroup,
      )
    )
      candidate.disposition = "complete-period-cutoff";
    else if (
      !selectedByOrigin(filter, origin, normalizedFilter.originCoordinates) ||
      !selectedByValuation(
        filter,
        valuation,
        normalizedFilter.valuationCoordinates,
      ) ||
      !selectedByAge(filter, developmentAge)
    )
      candidate.disposition = "filter";
  }

  const exposureCandidates: ExposureCandidate[] = input.exposures.map(
    (inputRow) => ({
      row: { ...inputRow },
      snapshot: snapshotExposure(inputRow),
      disposition: selectedBySource(filter, inputRow.sourceGroup)
        ? "retained"
        : "filter",
      origin: null,
      valuation: null,
      developmentAge: null,
      ageUnit: null,
      timing:
        internals.measuresById.get(inputRow.measureId)?.exposureTiming ?? null,
      invalid: false,
    }),
  );
  for (const candidate of exposureCandidates) {
    if (candidate.disposition !== "retained") continue;
    try {
      candidate.origin = normalizeDiagnosticPeriod(
        definition,
        "origin",
        candidate.row.origin,
      );
    } catch {
      findings.push(
        structuralFinding("unknown-origin-period", {
          measureId: candidate.row.measureId,
          exposureKey: candidate.row.key,
          sourceGroup: candidate.row.sourceGroup,
          origin: candidate.row.origin,
          sources: candidate.row.source ? [candidate.row.source] : [],
        }),
      );
    }
    if (candidate.origin !== null)
      candidate.snapshot = {
        ...candidate.snapshot,
        origin: candidate.origin.label,
      };
    if (candidate.row.valuation !== undefined) {
      try {
        candidate.valuation = normalizeDiagnosticPeriod(
          definition,
          "valuation",
          candidate.row.valuation,
        );
      } catch {
        findings.push(
          structuralFinding("unknown-valuation-period", {
            measureId: candidate.row.measureId,
            exposureKey: candidate.row.key,
            sourceGroup: candidate.row.sourceGroup,
            origin: candidate.origin?.label ?? candidate.row.origin,
            valuation: candidate.row.valuation,
            sources: candidate.row.source ? [candidate.row.source] : [],
          }),
        );
      }
      if (candidate.valuation !== null)
        candidate.snapshot = {
          ...candidate.snapshot,
          valuation: candidate.valuation.label,
        };
    }
    if (
      candidate.origin === null ||
      (candidate.row.valuation !== undefined && candidate.valuation === null)
    ) {
      candidate.disposition = "invalid";
      candidate.invalid = true;
      continue;
    }
    if (candidate.valuation !== null) {
      const age =
        candidate.valuation.coordinate -
        candidate.origin.coordinate +
        definition.definition.periodAxis.ageOffset;
      if (!Number.isSafeInteger(age) || age < 0) {
        const code: StructuralCode = Number.isSafeInteger(age)
          ? "valuation-before-origin"
          : "unsafe-development-age";
        findings.push(
          structuralFinding(code, {
            measureId: candidate.row.measureId,
            exposureKey: candidate.row.key,
            sourceGroup: candidate.row.sourceGroup,
            origin: candidate.origin.label,
            valuation: candidate.valuation.label,
            sources: candidate.row.source ? [candidate.row.source] : [],
          }),
        );
        candidate.disposition = "invalid";
        candidate.invalid = true;
        continue;
      }
      candidate.developmentAge = age;
      candidate.ageUnit = definition.definition.periodAxis.ageUnit;
    }
    candidate.row = {
      ...candidate.row,
      origin: candidate.origin.label,
      ...(candidate.valuation ? { valuation: candidate.valuation.label } : {}),
    };
    candidate.snapshot = {
      ...candidate.snapshot,
      origin: candidate.origin.label,
      valuation: candidate.valuation?.label ?? null,
    };
    const cutoff = cutoffByGroup.get(candidate.row.sourceGroup);
    const beyondOrigin =
      cutoff?.originThrough !== null &&
      cutoff?.originThrough !== undefined &&
      compareDiagnosticPeriods(candidate.origin, cutoff.originThrough) > 0;
    const beyondValuation =
      candidate.timing === "valuation-specific" &&
      cutoff?.valuationThrough !== null &&
      cutoff?.valuationThrough !== undefined &&
      candidate.valuation !== null &&
      compareDiagnosticPeriods(candidate.valuation, cutoff.valuationThrough) >
        0;
    if (beyondOrigin || beyondValuation)
      candidate.disposition = "complete-period-cutoff";
    else {
      const originSelected = selectedByOrigin(
        filter,
        candidate.origin,
        normalizedFilter.originCoordinates,
      );
      const valuationSelected =
        candidate.timing === "valuation-specific" &&
        candidate.valuation !== null
          ? selectedByValuation(
              filter,
              candidate.valuation,
              normalizedFilter.valuationCoordinates,
            ) && selectedByAge(filter, candidate.developmentAge!)
          : true;
      if (!originSelected || !valuationSelected)
        candidate.disposition = "filter";
    }
  }

  for (const candidate of expectedCandidates) {
    if (!selectedBySource(filter, candidate.row.sourceGroup))
      candidate.disposition = "filter";
    else if (beyondCutoff(candidate, cutoffByGroup))
      candidate.disposition = "complete-period-cutoff";
    else if (
      !selectedByOrigin(
        filter,
        candidate.coordinate.origin,
        normalizedFilter.originCoordinates,
      ) ||
      !selectedByValuation(
        filter,
        candidate.coordinate.valuation,
        normalizedFilter.valuationCoordinates,
      ) ||
      !selectedByAge(filter, candidate.coordinate.developmentAge)
    )
      candidate.disposition = "filter";
  }

  const provisionalLosses = lossCandidates.filter(
    (candidate) => candidate.disposition === "retained",
  );
  const lossFindings = (
    code: StructuralCode,
    candidates: readonly LossCandidate[],
    extra: Partial<DiagnosticMetricFinding> = {},
  ) => {
    const finding = structuralFinding(code, {
      ...commonCoordinate(candidates),
      ...extra,
      sources: normalizeSources(
        candidates.map((candidate) => candidate.row.source),
      ),
    });
    findings.push(finding);
    for (const candidate of candidates) candidate.invalid = true;
    pendingBlockers.push({
      finding,
      measureIds: definition.definition.measures
        .filter((measure) => measure.source !== "exposure")
        .map((measure) => measure.id),
      cellKeys: uniqueSorted(
        candidates.flatMap((candidate) =>
          candidate.coordinate
            ? [
                cellKey(
                  candidate.row.sourceGroup,
                  candidate.coordinate.origin.label,
                  candidate.coordinate.valuation.label,
                ),
              ]
            : [],
        ),
      ),
      sourceIds: uniqueSorted(
        candidates.map((candidate) => candidate.row.recordId),
      ),
    });
  };

  for (const candidate of provisionalLosses) {
    const localCodes: {
      code: StructuralCode;
      measureId?: string;
      offendingKey?: string;
    }[] = [];
    for (const measureId of Object.keys(candidate.row.measures).sort(
      codeUnit,
    )) {
      const measure = internals.measuresById.get(measureId);
      if (!measure)
        localCodes.push({
          code: "undeclared-loss-measure",
          measureId,
          offendingKey: measureId,
        });
      else if (measure.source !== "loss")
        localCodes.push({
          code: "wrong-source-loss-measure",
          measureId,
          offendingKey: measureId,
        });
    }
    if (!candidate.row.complete)
      localCodes.push({ code: "incomplete-loss-record" });
    for (const item of localCodes)
      lossFindings(item.code, [candidate], {
        recordId: candidate.row.recordId,
        ...(candidate.row.rowType === "claim"
          ? { claimId: candidate.row.claimId }
          : {}),
        ...(item.measureId ? { measureId: item.measureId } : {}),
        ...(item.offendingKey ? { offendingKey: item.offendingKey } : {}),
      });
  }

  const byRecordId = new Map<string, LossCandidate[]>();
  for (const candidate of provisionalLosses)
    addToMap(byRecordId, candidate.row.recordId, candidate);
  for (const [recordId, cohort] of byRecordId)
    if (cohort.length > 1)
      lossFindings("duplicate-loss-record-id", cohort, { recordId });
  if (definition.definition.lossRowGrain === "aggregate") {
    const byCell = new Map<string, LossCandidate[]>();
    for (const candidate of provisionalLosses)
      addToMap(
        byCell,
        cellKey(
          candidate.row.sourceGroup,
          candidate.row.origin,
          candidate.row.valuation,
        ),
        candidate,
      );
    for (const cohort of byCell.values())
      if (cohort.length > 1)
        lossFindings("duplicate-aggregate-snapshot", cohort);
  } else {
    const bySnapshot = new Map<string, LossCandidate[]>();
    const byClaim = new Map<string, LossCandidate[]>();
    for (const candidate of provisionalLosses) {
      const claimId = (candidate.row as DiagnosticClaimObservation).claimId;
      addToMap(
        bySnapshot,
        canonicalJson([
          claimId,
          candidate.row.sourceGroup,
          candidate.row.origin,
          candidate.row.valuation,
        ]),
        candidate,
      );
      addToMap(byClaim, claimId, candidate);
    }
    for (const cohort of bySnapshot.values())
      if (cohort.length > 1)
        lossFindings("duplicate-claim-snapshot", cohort, {
          claimId: (cohort[0]!.row as DiagnosticClaimObservation).claimId,
        });
    for (const [claimId, cohort] of byClaim)
      if (
        uniqueSorted(
          cohort.map((candidate) =>
            canonicalJson([candidate.row.sourceGroup, candidate.row.origin]),
          ),
        ).length > 1
      )
        lossFindings("claim-identity-conflict", cohort, { claimId });
  }
  for (const candidate of provisionalLosses)
    if (candidate.invalid) candidate.disposition = "invalid";

  const declaredExposureCandidates: ExposureCandidate[] = [];
  for (const candidate of exposureCandidates.filter(
    (item) => item.disposition === "retained",
  )) {
    const measure = internals.measuresById.get(candidate.row.measureId);
    if (!measure) {
      findings.push(
        structuralFinding("undeclared-exposure-measure", {
          measureId: candidate.row.measureId,
          offendingKey: candidate.row.measureId,
          exposureKey: candidate.row.key,
          ...(candidate.origin ? { origin: candidate.origin.label } : {}),
          sources: candidate.row.source ? [candidate.row.source] : [],
        }),
      );
      candidate.invalid = true;
      candidate.disposition = "invalid";
    } else if (measure.source !== "exposure") {
      findings.push(
        structuralFinding("wrong-source-exposure-measure", {
          measureId: candidate.row.measureId,
          offendingKey: candidate.row.measureId,
          exposureKey: candidate.row.key,
          ...(candidate.origin ? { origin: candidate.origin.label } : {}),
          sources: candidate.row.source ? [candidate.row.source] : [],
        }),
      );
      candidate.invalid = true;
      candidate.disposition = "invalid";
    } else declaredExposureCandidates.push(candidate);
  }

  const reconciled = reconcileDiagnosticExposures(
    declaredExposureCandidates.map((candidate) => candidate.row),
    Object.fromEntries(
      definition.definition.measures
        .filter((measure) => measure.source === "exposure")
        .map((measure) => [measure.id, measure.exposureTiming!]),
    ),
  ) as ReconciledDiagnosticExposure[];
  const exposureCohorts = new Map<string, ExposureCandidate[]>();
  for (const candidate of declaredExposureCandidates)
    addToMap(exposureCohorts, exposureIdentity(candidate), candidate);
  const invalidExposureBlockers: {
    finding: DiagnosticMetricFinding;
    candidates: readonly ExposureCandidate[];
  }[] = [];
  for (const exposure of reconciled) {
    const timing = internals.measuresById.get(
      exposure.measureId,
    )?.exposureTiming;
    const identity = canonicalJson(
      timing === "valuation-specific"
        ? [
            exposure.measureId,
            exposure.key,
            exposure.status === "valid"
              ? (exposure.valuation ?? null)
              : (exposure.observations[0]?.valuation ?? null),
          ]
        : [exposure.measureId, exposure.key],
    );
    const cohort = exposureCohorts.get(identity) ?? [];
    if (exposure.status === "valid") continue;
    for (const candidate of cohort) {
      candidate.invalid = true;
      candidate.disposition = "invalid";
    }
    const context = exposureCoordinateContext(cohort);
    const issueCodes: Record<(typeof exposure.issues)[number], StructuralCode> =
      {
        missing: "missing-exposure-value",
        incomplete: "incomplete-exposure",
        "non-finite": "non-finite-exposure",
        duplicate: "duplicate-exposure-identity",
        conflict: "conflicting-exposure-identity",
      };
    for (const issue of exposure.issues) {
      const finding = structuralFinding(issueCodes[issue], {
        ...context,
        measureId: exposure.measureId,
        exposureKey: exposure.key,
        sources: normalizeSources(
          cohort.map((candidate) => candidate.row.source),
        ),
      });
      findings.push(finding);
      invalidExposureBlockers.push({ finding, candidates: cohort });
    }
  }

  const retainedCandidates = lossCandidates.filter(
    (candidate) => candidate.disposition === "retained",
  );
  const retainedRows = retainedCandidates.map((candidate) => candidate.row);
  const derivedAudits =
    definition.definition.lossRowGrain === "claim"
      ? deriveDiagnosticClaimMeasuresWithAudit(
          retainedRows as readonly DiagnosticClaimObservation[],
          definition,
        )
      : [];
  const derivedRows =
    definition.definition.lossRowGrain === "claim"
      ? derivedAudits.map((item) => item.row as DiagnosticLossInput)
      : retainedRows;
  const derivedByRecord = new Map(
    derivedRows.map((row) => [row.recordId, row]),
  );
  const derivedAuditByRecord = new Map(
    derivedAudits.map((item) => [
      (item.row as DiagnosticClaimObservation).recordId,
      item,
    ]),
  );
  const cellRows = new Map<string, DiagnosticLossInput[]>();
  for (const candidate of retainedCandidates)
    addToMap(
      cellRows,
      cellKey(
        candidate.row.sourceGroup,
        candidate.row.origin,
        candidate.row.valuation,
      ),
      derivedByRecord.get(candidate.row.recordId)!,
    );

  const allMeasureIds = definition.definition.measures
    .map((measure) => measure.id)
    .sort(codeUnit);
  const nonExposureMeasures = definition.definition.measures
    .filter((measure) => measure.source !== "exposure")
    .sort((left, right) => codeUnit(left.id, right.id));
  const exposureMeasures = definition.definition.measures
    .filter((measure) => measure.source === "exposure")
    .sort((left, right) => codeUnit(left.id, right.id));
  const preparedCells: PreparedDiagnosticSourceCell[] = [];
  const invalidExposureTargets = new Map<string, Set<string>>();
  for (const item of invalidExposureBlockers) {
    const targets = new Set<string>();
    for (const candidate of item.candidates) {
      if (!candidate.origin) continue;
      if (candidate.timing === "valuation-specific" && candidate.valuation)
        targets.add(
          cellKey(
            candidate.row.sourceGroup,
            candidate.origin.label,
            candidate.valuation.label,
          ),
        );
      else
        for (const key of cellRows.keys()) {
          const [sourceGroup, origin] = parseCellKey(key);
          if (
            sourceGroup === candidate.row.sourceGroup &&
            origin === candidate.origin.label
          )
            targets.add(key);
        }
    }
    invalidExposureTargets.set(canonicalJson(item.finding), targets);
    pendingBlockers.push({
      finding: item.finding,
      measureIds: [item.finding.measureId!],
      cellKeys: [...targets],
      sourceIds: item.finding.exposureKey ? [item.finding.exposureKey] : [],
    });
  }

  const validAttachmentKeys = new Map<ReconciledDiagnosticExposure, string[]>();
  for (const exposure of reconciled) {
    if (exposure.status !== "valid") continue;
    const timing = internals.measuresById.get(
      exposure.measureId,
    )!.exposureTiming;
    const keys = [...cellRows.keys()].filter((key) => {
      const [sourceGroup, origin, valuation] = parseCellKey(key);
      return (
        sourceGroup === exposure.sourceGroup &&
        origin === exposure.origin &&
        (timing === "origin-static" || valuation === exposure.valuation)
      );
    });
    validAttachmentKeys.set(exposure, keys);
    if (keys.length === 0)
      findings.push(
        structuralFinding("exposure-without-loss", {
          measureId: exposure.measureId,
          exposureKey: exposure.key,
          sourceGroup: exposure.sourceGroup,
          origin: exposure.origin,
          ...(exposure.valuation ? { valuation: exposure.valuation } : {}),
          sources: exposure.sources,
        }),
      );
  }

  for (const [key, rows] of cellRows) {
    const [sourceGroup, origin, valuation] = parseCellKey(key);
    const coordinate = coordinateFor(definition, origin, valuation).coordinate!;
    const contributions = Object.fromEntries(
      allMeasureIds.map((measureId) => [
        measureId,
        [] as DiagnosticMeasureContribution[],
      ]),
    ) as Record<string, DiagnosticMeasureContribution[]>;
    const blockers = Object.fromEntries(
      allMeasureIds.map((measureId) => [
        measureId,
        [] as DiagnosticStructuralBlocker[],
      ]),
    ) as Record<string, DiagnosticStructuralBlocker[]>;
    const cellFindings: DiagnosticMetricFinding[] = [];
    const derivedContribution = (
      row: DiagnosticLossInput,
      missingPolicy: "unknown" | "zero",
      state: DiagnosticDerivedValueAudit,
    ): DiagnosticMeasureContribution => {
      const base = {
        sourceId: row.recordId,
        sources: row.source ? [row.source] : [],
        deduplicated: 0,
      } as const;
      if (state.status === "observed")
        return { ...base, status: "observed", value: state.value };
      if (state.status === "non-finite")
        return {
          ...base,
          status: "non-finite",
          value: null,
          nonFiniteKind: state.nonFiniteKind,
        };
      return missingPolicy === "zero"
        ? { ...base, status: "imputed-zero", value: 0 }
        : { ...base, status: "missing", value: null };
    };
    for (const row of rows)
      for (const measure of nonExposureMeasures) {
        if (measure.source === "derived") {
          const state = derivedAuditByRecord.get(row.recordId)!.derived[
            measure.id
          ]!;
          contributions[measure.id]!.push(
            derivedContribution(row, measure.missing, state),
          );
          for (const overflow of derivedAuditByRecord.get(row.recordId)!
            .expressionOverflows[measure.id] ?? []) {
            cellFindings.push({
              code: "diagnostic-expression-overflow",
              message: "Measure expression overflowed",
              severity: "fail",
              category: "aggregation",
              measureId: measure.id,
              expressionPath: overflow.expressionPath,
              recordId: row.recordId,
              sourceGroup,
              origin,
              valuation,
              developmentAge: coordinate.developmentAge,
              ageUnit: coordinate.ageUnit,
              sources: row.source ? [row.source] : [],
            });
          }
        } else
          contributions[measure.id]!.push(
            auditedDiagnosticContribution(
              row.recordId,
              own(row.measures, measure.id),
              measure.missing,
              row.source ? [row.source] : [],
            ),
          );
      }
    for (const exposure of reconciled)
      if (
        exposure.status === "valid" &&
        validAttachmentKeys.get(exposure)?.includes(key)
      )
        contributions[exposure.measureId]!.push(
          auditedDiagnosticContribution(
            exposure.key,
            exposure.value,
            "unknown",
            exposure.sources,
            exposure.deduplicated,
          ),
        );
    for (const pending of pendingBlockers) {
      if (!pending.cellKeys.includes(key)) continue;
      cellFindings.push(pending.finding);
      const blocker = {
        code: pending.finding.code,
        message: pending.finding.message,
        sourceIds: uniqueSorted(pending.sourceIds),
        sources: normalizeSources(pending.finding.sources),
        finding: pending.finding,
      };
      for (const measureId of pending.measureIds)
        blockers[measureId]!.push(blocker);
    }
    for (const measure of exposureMeasures) {
      const attempted =
        [...validAttachmentKeys.entries()].some(
          ([exposure, keys]) =>
            exposure.status === "valid" &&
            exposure.measureId === measure.id &&
            keys.includes(key),
        ) ||
        invalidExposureBlockers.some(
          (item) =>
            item.finding.measureId === measure.id &&
            invalidExposureTargets.get(canonicalJson(item.finding))?.has(key),
        );
      if (contributions[measure.id]!.length === 0 && !attempted) {
        const sources = normalizeSources(rows.map((row) => row.source));
        const finding = structuralFinding("loss-without-exposure", {
          measureId: measure.id,
          sourceGroup,
          origin,
          valuation,
          developmentAge: coordinate.developmentAge,
          ageUnit: coordinate.ageUnit,
          sources,
        });
        findings.push(finding);
        cellFindings.push(finding);
        blockers[measure.id]!.push({
          code: finding.code,
          message: finding.message,
          sourceIds: uniqueSorted(rows.map((row) => row.recordId)),
          sources,
          finding,
        });
      }
    }
    for (const measureId of allMeasureIds) {
      blockers[measureId] = [
        ...new Map(
          blockers[measureId]!.map((blocker) => [
            canonicalJson(blocker),
            blocker,
          ]),
        ).values(),
      ].sort((left, right) =>
        codeUnit(canonicalJson(left), canonicalJson(right)),
      );
      contributions[measureId]!.sort(
        (left, right) =>
          codeUnit(left.sourceId, right.sourceId) ||
          codeUnit(canonicalJson(left), canonicalJson(right)),
      );
    }
    const components = Object.fromEntries(
      allMeasureIds.map((measureId) => {
        const measure = internals.measuresById.get(measureId)!;
        return [
          measureId,
          finalizeDiagnosticContributions(
            contributions[measureId]!,
            measure.missing,
            blockers[measureId],
          ),
        ];
      }),
    ) as Record<string, DiagnosticMeasureStats>;
    for (const measureId of allMeasureIds) {
      const measureContributions = contributions[measureId]!;
      const context = {
        measureId,
        sourceGroup,
        origin,
        valuation,
        developmentAge: coordinate.developmentAge,
        ageUnit: coordinate.ageUnit,
      };
      const missing = measureContributions.filter(
        (item) => item.status === "missing",
      );
      const imputed = measureContributions.filter(
        (item) => item.status === "imputed-zero",
      );
      const nonFinite = measureContributions.filter(
        (item) => item.status === "non-finite",
      );
      if (missing.length > 0)
        cellFindings.push(
          aggregationFinding("diagnostic-measure-missing", {
            ...context,
            sources: missing.flatMap((item) => item.sources),
          }),
        );
      if (imputed.length > 0)
        cellFindings.push(
          aggregationFinding("diagnostic-measure-imputed-zero", {
            ...context,
            sources: imputed.flatMap((item) => item.sources),
          }),
        );
      if (nonFinite.length > 0)
        cellFindings.push(
          aggregationFinding("diagnostic-measure-non-finite", {
            ...context,
            sources: nonFinite.flatMap((item) => item.sources),
          }),
        );
      if (
        components[measureId]!.sum === null &&
        components[measureId]!.nonFinite === 0 &&
        components[measureId]!.structural === 0
      )
        cellFindings.push(
          aggregationFinding("diagnostic-measure-overflow", {
            ...context,
            sources: measureContributions.flatMap((item) => item.sources),
          }),
        );
    }
    findings.push(...cellFindings);
    preparedCells.push({
      sourceGroup,
      origin,
      valuation,
      developmentAge: coordinate.developmentAge,
      ageUnit: coordinate.ageUnit,
      lossRecordIds: uniqueSorted(rows.map((row) => row.recordId)),
      contributions,
      components,
      structuralBlockers: blockers,
      findings: mergeFindings(cellFindings),
    });
  }

  for (const candidate of expectedCandidates.filter(
    (item) => item.disposition === "retained",
  )) {
    const key = cellKey(
      candidate.row.sourceGroup,
      candidate.row.origin,
      candidate.row.valuation,
    );
    if (!cellRows.has(key))
      findings.push(
        structuralFinding("missing-expected-cell", {
          sourceGroup: candidate.row.sourceGroup,
          origin: candidate.row.origin,
          valuation: candidate.row.valuation,
          developmentAge: candidate.coordinate.developmentAge,
          ageUnit: candidate.coordinate.ageUnit,
          sources: candidate.row.source ? [candidate.row.source] : [],
        }),
      );
  }

  const originCoordinates = new Map<string, number>();
  const valuationCoordinates = new Map<string, number>();
  for (const cell of preparedCells) {
    originCoordinates.set(
      cell.origin,
      normalizeDiagnosticPeriod(definition, "origin", cell.origin).coordinate,
    );
    valuationCoordinates.set(
      cell.valuation,
      normalizeDiagnosticPeriod(definition, "valuation", cell.valuation)
        .coordinate,
    );
  }
  preparedCells.sort(
    (left, right) =>
      codeUnit(left.sourceGroup, right.sourceGroup) ||
      originCoordinates.get(left.origin)! -
        originCoordinates.get(right.origin)! ||
      valuationCoordinates.get(left.valuation)! -
        valuationCoordinates.get(right.valuation)! ||
      codeUnit(left.origin, right.origin) ||
      codeUnit(left.valuation, right.valuation),
  );
  const expectedCells = expectedCandidates
    .filter((candidate) => candidate.disposition === "retained")
    .sort(
      (left, right) =>
        codeUnit(left.row.sourceGroup, right.row.sourceGroup) ||
        compareDiagnosticPeriods(
          left.coordinate.origin,
          right.coordinate.origin,
        ) ||
        compareDiagnosticPeriods(
          left.coordinate.valuation,
          right.coordinate.valuation,
        ),
    )
    .map((candidate) => candidate.row);
  const audit: DiagnosticInputAuditRecord[] = [
    ...lossCandidates.map(
      (candidate): DiagnosticInputAuditRecord => ({
        kind: "loss",
        disposition: candidate.disposition,
        record: candidate.snapshot,
      }),
    ),
    ...exposureCandidates.map(
      (candidate): DiagnosticInputAuditRecord => ({
        kind: "exposure",
        disposition: candidate.disposition,
        record: candidate.snapshot,
      }),
    ),
    ...expectedCandidates.map(
      (candidate): DiagnosticInputAuditRecord => ({
        kind: "expected-cell",
        disposition: candidate.disposition,
        record: candidate.snapshot,
      }),
    ),
  ].sort(auditSort);
  const normalizedFindings = mergeFindings(findings);
  const frozenCells = preparedCells.map((cell) => deepFreeze(cell));
  const cutoffValues = normalizedCutoffs.map((cutoff) => cutoff.value);
  const identity = deepFreeze({
    definitionIntegrity: definition.definitionIntegrity,
    filter,
    completePeriodCutoffs: cutoffValues,
    inputAudit: audit,
    cells: frozenCells,
    exposures: reconciled,
    expectedCellsProvided: input.expectedCells !== undefined,
    expectedCells,
    findings: normalizedFindings,
  });
  const preparationFingerprint = `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({ identityVersion: 1, kind: "diagnostic-preparation", preparation: identity }))}`;
  const prepared = deepFreeze({
    definition,
    preparationFingerprint,
    ...identity,
  }) as unknown as PreparedDiagnosticData;
  authentic.add(prepared);
  identities.set(prepared, identity);
  return prepared;
}

export function assertPreparedDiagnosticData(
  value: unknown,
): asserts value is PreparedDiagnosticData {
  if (value === null || typeof value !== "object" || !authentic.has(value))
    throw new DiagnosticValidationError([
      {
        domain: "input",
        code: "invalid-input-relationship",
        path: "$.prepared",
        message: "Prepared diagnostic data is not authentic",
      },
    ]);
}

export function getPreparedDiagnosticDataIdentity(
  value: PreparedDiagnosticData,
): DiagnosticDeepReadonly<NormalizedDiagnosticPreparationIdentity> {
  assertPreparedDiagnosticData(value);
  return identities.get(value)!;
}

export function verifyPreparedDiagnosticDataIntegrity(
  value: PreparedDiagnosticData,
): void {
  const identity = getPreparedDiagnosticDataIdentity(value);
  const tag = `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({ identityVersion: 1, kind: "diagnostic-preparation", preparation: identity }))}`;
  if (tag !== value.preparationFingerprint)
    throw new DiagnosticValidationError([
      {
        domain: "input",
        code: "invalid-input-relationship",
        path: "$.prepared.preparationFingerprint",
        message:
          "Prepared diagnostic data integrity does not match its content",
      },
    ]);
}

export type {
  JsonValue,
  DiagnosticAuditedNumericValue,
  DiagnosticExposureAuditObservation,
};
