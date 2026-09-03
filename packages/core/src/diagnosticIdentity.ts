import { canonicalJson, fnv1a64 } from "./canonical.js";
import type {
  AmountBasisDefinition,
  AmountLimitation,
  AmountPerspective,
  DiagnosticComparisonPredicate,
  DiagnosticControlTotalProjection,
  DiagnosticCountPopulationDefinition,
  DiagnosticDeepReadonly,
  DiagnosticDefinition,
  DiagnosticDerivedMeasureDefinition,
  DiagnosticDevelopmentSemantics,
  DiagnosticExposureBasisDefinition,
  DiagnosticExposureTiming,
  DiagnosticMeasureDefinition,
  DiagnosticMeasureKind,
  DiagnosticMeasureSource,
  DiagnosticMetricPresentation,
  DiagnosticMissingPolicy,
  DiagnosticPeriodAxis,
  DiagnosticReviewFilter,
  DiagnosticReviewOperand,
  DiagnosticReviewPredicate,
  DiagnosticReviewRule,
  DiagnosticRuleOperand,
  DiagnosticSourceLocation,
} from "./diagnosticDefinitions.js";
import type {
  DiagnosticClaimExpression,
  DiagnosticMeasureExpression,
  DiagnosticRoleExpression,
} from "./diagnosticExpressions.js";

function compareCodeUnits(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function sortedRecord<T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> {
  const result = Object.create(null) as Record<string, T>;
  for (const [key, value] of [...entries].sort(([left], [right]) => compareCodeUnits(left, right))) {
    result[key] = value;
  }
  return result;
}

function normalizeJsonValue<T>(value: T): T {
  if (typeof value === "number" && Object.is(value, -0)) return 0 as T;
  if (Array.isArray(value)) return value.map((item) => normalizeJsonValue(item)) as T;
  if (value !== null && typeof value === "object") {
    return sortedRecord(Object.entries(value as Record<string, unknown>).map(([key, item]) =>
      [key, normalizeJsonValue(item)] as const,
    )) as T;
  }
  return value;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): DiagnosticDeepReadonly<T> {
  if (value === null || typeof value !== "object") return value as DiagnosticDeepReadonly<T>;
  if (seen.has(value)) return value as DiagnosticDeepReadonly<T>;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value) as DiagnosticDeepReadonly<T>;
}

function attributes(
  value: Readonly<Record<string, string | number | boolean | null>> | undefined,
): Readonly<Record<string, string | number | boolean | null>> {
  return sortedRecord(Object.entries(value ?? {}).map(([key, item]) =>
    [key, normalizeJsonValue(item)] as const,
  ));
}

export type NormalizedAmountLimitationIdentity =
  | { readonly kind: "unlimited" }
  | {
      readonly kind: "layer" | "pre-limited";
      readonly attachment: number;
      readonly limit: number | null;
      readonly application: "claim" | "occurrence" | "policy" | "source-defined";
      readonly derivation:
        | { readonly kind: "sdk" }
        | {
            readonly kind: "external";
            readonly actor: "caller" | "source";
            readonly transformationRef: string;
          };
    }
  | { readonly kind: "unknown"; readonly description: string | null };

export interface NormalizedDiagnosticToleranceIdentity {
  readonly absolute: number;
  readonly relative: number;
}

export interface NormalizedDiagnosticReviewFilterIdentity {
  readonly sourceGroups: readonly string[] | null;
  readonly origins: readonly string[] | null;
  readonly originFrom: string | null;
  readonly originThrough: string | null;
  readonly valuations: readonly string[] | null;
  readonly valuationFrom: string | null;
  readonly valuationThrough: string | null;
  readonly minDevelopmentAge: number | null;
  readonly maxDevelopmentAge: number | null;
}

export type NormalizedDiagnosticPeriodAxisIdentity =
  | DiagnosticDeepReadonly<Extract<DiagnosticPeriodAxis, { kind: "calendar" }>>
  | (Omit<
      DiagnosticDeepReadonly<Extract<DiagnosticPeriodAxis, { kind: "ordered" }>>,
      "origins" | "valuations"
    > & {
      readonly origins: readonly {
        readonly label: string;
        readonly aliases: readonly string[];
        readonly coordinate: number;
      }[];
      readonly valuations: readonly {
        readonly label: string;
        readonly aliases: readonly string[];
        readonly coordinate: number;
      }[];
    });

export interface NormalizedDiagnosticFormulaIdentity {
  readonly id: string;
  readonly version: string;
  readonly roles: Readonly<Record<string, {
    readonly kind: DiagnosticMeasureKind;
    readonly compatibilityGroup: string | null;
    readonly developmentSemantics: DiagnosticDevelopmentSemantics | null;
  }>>;
  readonly numerator: DiagnosticDeepReadonly<DiagnosticRoleExpression>;
  readonly denominator: DiagnosticDeepReadonly<DiagnosticRoleExpression>;
  readonly denominatorPolicy: "positive-or-null";
}

interface NormalizedDiagnosticReviewRuleBase {
  readonly id: string;
  readonly code: string;
  readonly description: string;
  readonly severity: "warning" | "fail";
  readonly missingInput: "not-evaluated" | "finding";
  readonly tolerance: NormalizedDiagnosticToleranceIdentity;
}

export type NormalizedDiagnosticReviewRuleIdentity =
  | (NormalizedDiagnosticReviewRuleBase & {
      readonly kind: "compare";
      readonly when: DiagnosticDeepReadonly<DiagnosticReviewPredicate>;
    })
  | (NormalizedDiagnosticReviewRuleBase & {
      readonly kind: "reconcile";
      readonly actual: DiagnosticDeepReadonly<DiagnosticMeasureExpression>;
      readonly expected: DiagnosticDeepReadonly<DiagnosticReviewOperand>;
    })
  | (NormalizedDiagnosticReviewRuleBase & {
      readonly kind: "monotonic";
      readonly expression: DiagnosticDeepReadonly<DiagnosticMeasureExpression>;
      readonly direction: "nondecreasing" | "nonincreasing";
    })
  | (NormalizedDiagnosticReviewRuleBase & {
      readonly kind: "layer-order";
      readonly narrower: DiagnosticDeepReadonly<DiagnosticMeasureExpression>;
      readonly broader: DiagnosticDeepReadonly<DiagnosticMeasureExpression>;
      readonly comparability: DiagnosticDeepReadonly<
        Extract<DiagnosticReviewRule, { kind: "layer-order" }>["comparability"]
      >;
    })
  | (NormalizedDiagnosticReviewRuleBase & {
      readonly kind: "control-total";
      readonly expression: DiagnosticDeepReadonly<DiagnosticMeasureExpression>;
      readonly expected: number;
      readonly filter: NormalizedDiagnosticReviewFilterIdentity | null;
      readonly projection: DiagnosticDeepReadonly<DiagnosticControlTotalProjection>;
    });

export interface NormalizedDiagnosticDefinitionIdentity {
  readonly diagnosticDefinitionVersion: "1.0.0";
  readonly id: string;
  readonly version: string;
  readonly lossRowGrain: "claim" | "aggregate";
  readonly measures: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly description: string;
    readonly source: DiagnosticMeasureSource;
    readonly kind: DiagnosticMeasureKind;
    readonly unit: string;
    readonly developmentSemantics: DiagnosticDevelopmentSemantics;
    readonly aggregation: "sum";
    readonly missing: DiagnosticMissingPolicy;
    readonly basisId: string | null;
    readonly countPopulationId: string | null;
    readonly exposureBasisId: string | null;
    readonly exposureTiming: DiagnosticExposureTiming | null;
  }[];
  readonly countPopulations: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly subject: DiagnosticCountPopulationDefinition["subject"];
    readonly unit: string;
    readonly description: string;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  }[];
  readonly exposureBases: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly basis: DiagnosticExposureBasisDefinition["basis"];
    readonly unit: string;
    readonly description: string;
    readonly sourceDescription: string | null;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  }[];
  readonly amountBases: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly currency: string;
    readonly perspective: AmountPerspective;
    readonly components: readonly {
      readonly id: string;
      readonly treatment: "included" | "excluded" | "unknown";
      readonly limitation: NormalizedAmountLimitationIdentity;
    }[];
    readonly sourceDescription: string | null;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  }[];
  readonly derivedMeasures: readonly DiagnosticDeepReadonly<DiagnosticDerivedMeasureDefinition>[];
  readonly formulas: readonly NormalizedDiagnosticFormulaIdentity[];
  readonly instances: readonly {
    readonly id: string;
    readonly version: string;
    readonly formulaId: string;
    readonly bindings: Readonly<Record<string, DiagnosticDeepReadonly<DiagnosticMeasureExpression>>>;
    readonly presentation: DiagnosticDeepReadonly<DiagnosticMetricPresentation>;
    readonly rules: readonly {
      readonly id: string;
      readonly code: string;
      readonly message: string;
      readonly severity: "warning" | "fail";
      readonly when: {
        readonly left: DiagnosticDeepReadonly<DiagnosticRuleOperand>;
        readonly operator: DiagnosticComparisonPredicate["operator"];
        readonly right: DiagnosticDeepReadonly<DiagnosticRuleOperand>;
        readonly tolerance: NormalizedDiagnosticToleranceIdentity;
      };
    }[];
  }[];
  readonly reviewRules: readonly NormalizedDiagnosticReviewRuleIdentity[];
  readonly periodAxis: NormalizedDiagnosticPeriodAxisIdentity;
}

export interface NormalizedDiagnosticCalculationScope {
  readonly formulaFingerprint: string;
  readonly instance: {
    readonly id: string;
    readonly version: string;
    readonly formulaId: string;
    readonly bindings: Readonly<Record<string, DiagnosticDeepReadonly<DiagnosticMeasureExpression>>>;
  };
  readonly lossRowGrain: "claim" | "aggregate";
  readonly measures: readonly {
    readonly id: string;
    readonly source: DiagnosticMeasureSource;
    readonly kind: DiagnosticMeasureKind;
    readonly unit: string;
    readonly developmentSemantics: DiagnosticDevelopmentSemantics;
    readonly aggregation: "sum";
    readonly missing: DiagnosticMissingPolicy;
    readonly basisId: string | null;
    readonly countPopulationId: string | null;
    readonly exposureBasisId: string | null;
    readonly exposureTiming: DiagnosticExposureTiming | null;
  }[];
  readonly countPopulations: readonly {
    readonly id: string;
    readonly subject: DiagnosticCountPopulationDefinition["subject"];
    readonly unit: string;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  }[];
  readonly exposureBases: readonly {
    readonly id: string;
    readonly basis: DiagnosticExposureBasisDefinition["basis"];
    readonly unit: string;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  }[];
  readonly amountBases: readonly {
    readonly id: string;
    readonly currency: string;
    readonly perspective: AmountPerspective;
    readonly components: readonly {
      readonly id: string;
      readonly treatment: "included" | "excluded" | "unknown";
      readonly limitation: NormalizedAmountLimitationIdentity;
    }[];
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  }[];
  readonly derivedMeasures: readonly DiagnosticDeepReadonly<DiagnosticDerivedMeasureDefinition>[];
}

export interface NormalizedDiagnosticSourceLocationIdentity {
  readonly artifactId: string;
  readonly sourceFile: string | null;
  readonly sourceSheet: string | null;
  readonly sourceRow: number | null;
  readonly sourceCell: string | null;
}

function normalizeLimitation(limitation: AmountLimitation): NormalizedAmountLimitationIdentity {
  if (limitation.kind === "unlimited") return { kind: "unlimited" };
  if (limitation.kind === "unknown") {
    return { kind: "unknown", description: limitation.description ?? null };
  }
  return {
    kind: limitation.kind,
    attachment: Object.is(limitation.attachment, -0) ? 0 : limitation.attachment,
    limit: limitation.limit !== null && Object.is(limitation.limit, -0) ? 0 : limitation.limit,
    application: limitation.application,
    derivation: limitation.derivation.kind === "sdk"
      ? { kind: "sdk" }
      : {
          kind: "external",
          actor: limitation.derivation.actor,
          transformationRef: limitation.derivation.transformationRef,
        },
  };
}

function normalizeMeasureExpression<T extends DiagnosticMeasureExpression | DiagnosticClaimExpression>(
  expression: T,
): DiagnosticDeepReadonly<T> {
  if (expression.op === "measure") return { op: "measure", measureId: expression.measureId } as DiagnosticDeepReadonly<T>;
  if (expression.op === "claim-layer") {
    return {
      op: "claim-layer",
      measureId: expression.measureId,
      attachment: Object.is(expression.attachment, -0) ? 0 : expression.attachment,
      limit: expression.limit !== null && Object.is(expression.limit, -0) ? 0 : expression.limit,
    } as DiagnosticDeepReadonly<T>;
  }
  if (expression.op === "subtract") {
    return {
      op: "subtract",
      left: normalizeMeasureExpression(expression.left),
      right: normalizeMeasureExpression(expression.right),
    } as DiagnosticDeepReadonly<T>;
  }
  return {
    op: "add",
    terms: expression.terms.map((term) => normalizeMeasureExpression(term)),
  } as unknown as DiagnosticDeepReadonly<T>;
}

function normalizeRoleExpression(expression: DiagnosticRoleExpression): DiagnosticDeepReadonly<DiagnosticRoleExpression> {
  if (expression.op === "role") return { op: "role", role: expression.role };
  if (expression.op === "subtract") {
    return {
      op: "subtract",
      left: normalizeRoleExpression(expression.left),
      right: normalizeRoleExpression(expression.right),
    };
  }
  return { op: "add", terms: expression.terms.map(normalizeRoleExpression) };
}

function normalizeTolerance(
  tolerance: { absolute?: number; relative?: number } | undefined,
): NormalizedDiagnosticToleranceIdentity {
  return {
    absolute: Object.is(tolerance?.absolute ?? 0, -0) ? 0 : (tolerance?.absolute ?? 0),
    relative: Object.is(tolerance?.relative ?? 0, -0) ? 0 : (tolerance?.relative ?? 0),
  };
}

function normalizeRuleOperand(operand: DiagnosticRuleOperand): DiagnosticDeepReadonly<DiagnosticRuleOperand> {
  if (operand.source === "measure") {
    return { source: "measure", expression: normalizeMeasureExpression(operand.expression) };
  }
  if (operand.source === "calculation") return { source: "calculation", field: operand.field };
  return { source: "constant", value: Object.is(operand.value, -0) ? 0 : operand.value };
}

function normalizeReviewOperand(operand: DiagnosticReviewOperand): DiagnosticDeepReadonly<DiagnosticReviewOperand> {
  if (operand.op === "constant") return { op: "constant", value: Object.is(operand.value, -0) ? 0 : operand.value };
  return normalizeMeasureExpression(operand);
}

function normalizeReviewFilter(filter: DiagnosticReviewFilter): NormalizedDiagnosticReviewFilterIdentity {
  return {
    sourceGroups: filter.sourceGroups === undefined ? null : sortedUnique(filter.sourceGroups),
    origins: filter.origins === undefined ? null : sortedUnique(filter.origins),
    originFrom: filter.originFrom ?? null,
    originThrough: filter.originThrough ?? null,
    valuations: filter.valuations === undefined ? null : sortedUnique(filter.valuations),
    valuationFrom: filter.valuationFrom ?? null,
    valuationThrough: filter.valuationThrough ?? null,
    minDevelopmentAge: filter.minDevelopmentAge === undefined
      ? null
      : Object.is(filter.minDevelopmentAge, -0) ? 0 : filter.minDevelopmentAge,
    maxDevelopmentAge: filter.maxDevelopmentAge === undefined
      ? null
      : Object.is(filter.maxDevelopmentAge, -0) ? 0 : filter.maxDevelopmentAge,
  };
}

function normalizePeriodAxis(axis: DiagnosticPeriodAxis): NormalizedDiagnosticPeriodAxisIdentity {
  if (axis.kind === "calendar") {
    return {
      kind: "calendar",
      originCadence: axis.originCadence,
      valuationCadence: axis.valuationCadence,
      originAnchor: axis.originAnchor,
      valuationAnchor: axis.valuationAnchor,
      ageUnit: "month",
      ageOffset: Object.is(axis.ageOffset, -0) ? 0 : axis.ageOffset,
    };
  }
  const coordinates = (values: typeof axis.origins) => values.map((coordinate) => ({
    label: coordinate.label,
    aliases: sortedUnique(coordinate.aliases ?? []),
    coordinate: Object.is(coordinate.coordinate, -0) ? 0 : coordinate.coordinate,
  })).sort((left, right) => left.coordinate - right.coordinate || compareCodeUnits(left.label, right.label));
  return {
    kind: "ordered",
    id: axis.id,
    version: axis.version,
    ageUnit: axis.ageUnit,
    ageOffset: Object.is(axis.ageOffset, -0) ? 0 : axis.ageOffset,
    origins: coordinates(axis.origins),
    valuations: coordinates(axis.valuations),
  };
}

function topologicalDerivations(
  derivations: readonly DiagnosticDerivedMeasureDefinition[],
): readonly DiagnosticDerivedMeasureDefinition[] {
  const byOutput = new Map(derivations.map((derivation) => [derivation.outputMeasureId, derivation]));
  const remaining = new Map(derivations.map((derivation) => [derivation.id, derivation]));
  const emittedOutputs = new Set<string>();
  const ordered: DiagnosticDerivedMeasureDefinition[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((derivation) =>
      expressionDependencies(derivation.expression)
        .filter((id) => byOutput.has(id))
        .every((id) => emittedOutputs.has(id)),
    ).sort((left, right) => compareCodeUnits(left.id, right.id));
    if (ready.length === 0) return [...derivations].sort((left, right) => compareCodeUnits(left.id, right.id));
    for (const derivation of ready) {
      ordered.push(derivation);
      emittedOutputs.add(derivation.outputMeasureId);
      remaining.delete(derivation.id);
    }
  }
  return ordered;
}

function normalizeReviewRule(rule: DiagnosticReviewRule): NormalizedDiagnosticReviewRuleIdentity {
  const base: NormalizedDiagnosticReviewRuleBase = {
    id: rule.id,
    code: rule.code,
    description: rule.description,
    severity: rule.severity,
    missingInput: rule.missingInput,
    tolerance: normalizeTolerance(rule.tolerance),
  };
  if (rule.kind === "compare") {
    return {
      ...base,
      kind: "compare",
      when: {
        left: normalizeReviewOperand(rule.when.left),
        operator: rule.when.operator,
        right: normalizeReviewOperand(rule.when.right),
      },
    };
  }
  if (rule.kind === "reconcile") {
    return {
      ...base,
      kind: "reconcile",
      actual: normalizeMeasureExpression(rule.actual),
      expected: normalizeReviewOperand(rule.expected),
    };
  }
  if (rule.kind === "monotonic") {
    return {
      ...base,
      kind: "monotonic",
      expression: normalizeMeasureExpression(rule.expression),
      direction: rule.direction,
    };
  }
  if (rule.kind === "layer-order") {
    return {
      ...base,
      kind: "layer-order",
      narrower: normalizeMeasureExpression(rule.narrower),
      broader: normalizeMeasureExpression(rule.broader),
      comparability: normalizeJsonValue(rule.comparability),
    };
  }
  return {
    ...base,
    kind: "control-total",
    expression: normalizeMeasureExpression(rule.expression),
    expected: Object.is(rule.expected, -0) ? 0 : rule.expected,
    filter: rule.filter === undefined ? null : normalizeReviewFilter(rule.filter),
    projection: normalizeJsonValue(rule.projection),
  };
}

export function normalizeDiagnosticDefinition(
  definition: DiagnosticDefinition,
): DiagnosticDeepReadonly<NormalizedDiagnosticDefinitionIdentity> {
  const normalized: NormalizedDiagnosticDefinitionIdentity = {
    diagnosticDefinitionVersion: "1.0.0",
    id: definition.id,
    version: definition.version,
    lossRowGrain: definition.lossRowGrain,
    measures: definition.measures.map((measure) => ({
      id: measure.id,
      displayName: measure.displayName,
      description: measure.description,
      source: measure.source,
      kind: measure.kind,
      unit: measure.unit,
      developmentSemantics: measure.developmentSemantics,
      aggregation: "sum" as const,
      missing: measure.missing,
      basisId: measure.basisId ?? null,
      countPopulationId: measure.countPopulationId ?? null,
      exposureBasisId: measure.exposureBasisId ?? null,
      exposureTiming: measure.exposureTiming ?? null,
    })).sort((left, right) => compareCodeUnits(left.id, right.id)),
    countPopulations: definition.countPopulations.map((population) => ({
      id: population.id,
      displayName: population.displayName,
      subject: population.subject,
      unit: population.unit,
      description: population.description,
      attributes: attributes(population.attributes),
    })).sort((left, right) => compareCodeUnits(left.id, right.id)),
    exposureBases: definition.exposureBases.map((basis) => ({
      id: basis.id,
      displayName: basis.displayName,
      basis: basis.basis,
      unit: basis.unit,
      description: basis.description,
      sourceDescription: basis.sourceDescription ?? null,
      attributes: attributes(basis.attributes),
    })).sort((left, right) => compareCodeUnits(left.id, right.id)),
    amountBases: definition.amountBases.map((basis) => ({
      id: basis.id,
      displayName: basis.displayName,
      currency: basis.currency,
      perspective: basis.perspective,
      components: basis.components.map((component) => ({
        id: component.id,
        treatment: component.treatment,
        limitation: normalizeLimitation(component.limitation),
      })).sort((left, right) => compareCodeUnits(left.id, right.id)),
      sourceDescription: basis.sourceDescription ?? null,
      attributes: attributes(basis.attributes),
    })).sort((left, right) => compareCodeUnits(left.id, right.id)),
    derivedMeasures: topologicalDerivations(definition.derivedMeasures).map((derivation) => ({
      id: derivation.id,
      outputMeasureId: derivation.outputMeasureId,
      expression: normalizeMeasureExpression(derivation.expression),
    })),
    formulas: definition.formulas.map((formula) => ({
      id: formula.id,
      version: formula.version,
      roles: sortedRecord(Object.entries(formula.roles).map(([name, role]) => [name, {
        kind: role.kind,
        compatibilityGroup: role.compatibilityGroup ?? null,
        developmentSemantics: role.developmentSemantics ?? null,
      }] as const)),
      numerator: normalizeRoleExpression(formula.numerator),
      denominator: normalizeRoleExpression(formula.denominator),
      denominatorPolicy: "positive-or-null" as const,
    })).sort((left, right) => compareCodeUnits(left.id, right.id)),
    instances: definition.instances.map((instance) => ({
      id: instance.id,
      version: instance.version,
      formulaId: instance.formulaId,
      bindings: sortedRecord(Object.entries(instance.bindings).map(([role, expression]) =>
        [role, normalizeMeasureExpression(expression)] as const,
      )),
      presentation: {
        displayName: instance.presentation.displayName,
        description: instance.presentation.description,
        displayUnit: instance.presentation.displayUnit,
        scale: Object.is(instance.presentation.scale, -0) ? 0 : instance.presentation.scale,
        numeratorLabel: instance.presentation.numeratorLabel,
        denominatorLabel: instance.presentation.denominatorLabel,
      },
      rules: instance.rules.map((rule) => ({
        id: rule.id,
        code: rule.code,
        message: rule.message,
        severity: rule.severity,
        when: {
          left: normalizeRuleOperand(rule.when.left),
          operator: rule.when.operator,
          right: normalizeRuleOperand(rule.when.right),
          tolerance: normalizeTolerance(rule.when.tolerance),
        },
      })),
    })),
    reviewRules: definition.reviewRules.map(normalizeReviewRule),
    periodAxis: normalizePeriodAxis(definition.periodAxis),
  };
  return deepFreeze(normalized);
}

export function normalizeDiagnosticSourceLocation(
  source: DiagnosticSourceLocation,
): NormalizedDiagnosticSourceLocationIdentity {
  return deepFreeze({
    artifactId: source.artifactId,
    sourceFile: source.sourceFile ?? null,
    sourceSheet: source.sourceSheet ?? null,
    sourceRow: source.sourceRow === undefined ? null : Object.is(source.sourceRow, -0) ? 0 : source.sourceRow,
    sourceCell: source.sourceCell ?? null,
  });
}

function expressionDependencies(expression: DiagnosticMeasureExpression | DiagnosticClaimExpression): readonly string[] {
  if (expression.op === "measure" || expression.op === "claim-layer") return [expression.measureId];
  if (expression.op === "subtract") return sortedUnique([
    ...expressionDependencies(expression.left),
    ...expressionDependencies(expression.right),
  ]);
  return sortedUnique(expression.terms.flatMap(expressionDependencies));
}

function ruleMeasureDependencies(operand: DiagnosticDeepReadonly<DiagnosticRuleOperand>): readonly string[] {
  return operand.source === "measure" ? expressionDependencies(operand.expression) : [];
}

function tag<K extends string, T>(kind: K, property: string, value: T): string {
  return `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({
    identityVersion: 1,
    kind,
    [property]: value,
  }))}`;
}

export interface BuiltDiagnosticIdentities {
  readonly formulaFingerprints: Readonly<Record<string, string>>;
  readonly calculationFingerprints: Readonly<Record<string, string>>;
  readonly definitionIntegrity: string;
  readonly calculationScopesByInstanceId: ReadonlyMap<string, NormalizedDiagnosticCalculationScope>;
  readonly calculationDependenciesByInstanceId: ReadonlyMap<string, readonly string[]>;
  readonly evaluationDependenciesByInstanceId: ReadonlyMap<string, readonly string[]>;
}

export function buildDiagnosticIdentities(
  definition: DiagnosticDeepReadonly<NormalizedDiagnosticDefinitionIdentity>,
): BuiltDiagnosticIdentities {
  const formulas = new Map(definition.formulas.map((formula) => [formula.id, formula]));
  const measures = new Map(definition.measures.map((measure) => [measure.id, measure]));
  const derivations = new Map(definition.derivedMeasures.map((derivation) => [derivation.outputMeasureId, derivation]));
  const populations = new Map(definition.countPopulations.map((population) => [population.id, population]));
  const exposureBases = new Map(definition.exposureBases.map((basis) => [basis.id, basis]));
  const amountBases = new Map(definition.amountBases.map((basis) => [basis.id, basis]));

  const formulaFingerprints = sortedRecord(definition.formulas.map((formula) =>
    [formula.id, tag("diagnostic-formula", "formula", formula)] as const,
  ));
  const calculationFingerprints = Object.create(null) as Record<string, string>;
  const calculationScopesByInstanceId = new Map<string, NormalizedDiagnosticCalculationScope>();
  const calculationDependenciesByInstanceId = new Map<string, readonly string[]>();
  const evaluationDependenciesByInstanceId = new Map<string, readonly string[]>();

  const transitiveDependencies = (roots: readonly string[]): readonly string[] => {
    const found = new Set<string>();
    const stack = [...roots];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (found.has(id)) continue;
      found.add(id);
      const derivation = derivations.get(id);
      if (derivation) stack.push(...expressionDependencies(derivation.expression));
    }
    return [...found].sort(compareCodeUnits);
  };

  for (const instance of definition.instances) {
    const calculationDependencies = transitiveDependencies(
      Object.values(instance.bindings).flatMap(expressionDependencies),
    );
    const evaluationDependencies = transitiveDependencies([
      ...calculationDependencies,
      ...instance.rules.flatMap((rule) => [
        ...ruleMeasureDependencies(rule.when.left),
        ...ruleMeasureDependencies(rule.when.right),
      ]),
    ]);
    calculationDependenciesByInstanceId.set(instance.id, calculationDependencies);
    evaluationDependenciesByInstanceId.set(instance.id, evaluationDependencies);

    const selectedMeasures = calculationDependencies.map((id) => measures.get(id)!).filter(Boolean);
    const selectedDerivations = definition.derivedMeasures.filter((derivation) => calculationDependencies.includes(derivation.outputMeasureId));
    const countPopulationIds = sortedUnique(selectedMeasures.flatMap((measure) => measure.countPopulationId === null ? [] : [measure.countPopulationId]));
    const exposureBasisIds = sortedUnique(selectedMeasures.flatMap((measure) => measure.exposureBasisId === null ? [] : [measure.exposureBasisId]));
    const amountBasisIds = sortedUnique(selectedMeasures.flatMap((measure) => measure.basisId === null ? [] : [measure.basisId]));
    const scope: NormalizedDiagnosticCalculationScope = {
      formulaFingerprint: formulaFingerprints[instance.formulaId]!,
      instance: {
        id: instance.id,
        version: instance.version,
        formulaId: instance.formulaId,
        bindings: instance.bindings,
      },
      lossRowGrain: definition.lossRowGrain,
      measures: selectedMeasures.map((measure) => ({
        id: measure.id,
        source: measure.source,
        kind: measure.kind,
        unit: measure.unit,
        developmentSemantics: measure.developmentSemantics,
        aggregation: "sum",
        missing: measure.missing,
        basisId: measure.basisId,
        countPopulationId: measure.countPopulationId,
        exposureBasisId: measure.exposureBasisId,
        exposureTiming: measure.exposureTiming,
      })),
      countPopulations: countPopulationIds.map((id) => {
        const population = populations.get(id)!;
        return { id, subject: population.subject, unit: population.unit, attributes: population.attributes };
      }),
      exposureBases: exposureBasisIds.map((id) => {
        const basis = exposureBases.get(id)!;
        return { id, basis: basis.basis, unit: basis.unit, attributes: basis.attributes };
      }),
      amountBases: amountBasisIds.map((id) => {
        const basis = amountBases.get(id)!;
        return {
          id,
          currency: basis.currency,
          perspective: basis.perspective,
          components: basis.components,
          attributes: basis.attributes,
        };
      }),
      derivedMeasures: selectedDerivations,
    };
    const frozenScope = deepFreeze(scope);
    calculationScopesByInstanceId.set(instance.id, frozenScope);
    calculationFingerprints[instance.id] = tag("diagnostic-calculation", "calculation", frozenScope);
  }

  return {
    formulaFingerprints: deepFreeze(formulaFingerprints),
    calculationFingerprints: deepFreeze(sortedRecord(Object.entries(calculationFingerprints))),
    definitionIntegrity: tag("diagnostic-definition", "definition", definition),
    calculationScopesByInstanceId,
    calculationDependenciesByInstanceId,
    evaluationDependenciesByInstanceId,
  };
}
