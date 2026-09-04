import type {
  DiagnosticDeepReadonly,
  DiagnosticMeasureDefinition,
  DiagnosticMetricPresentation,
  DiagnosticsFilter,
  JsonValue,
} from "./diagnosticDefinitions.js";
import { getCompiledDiagnosticDefinitionInternals } from "./diagnosticDefinitions.js";
import { finalizeDiagnosticContributions } from "./diagnosticAggregation.js";
import {
  applyDiagnosticPresentation,
  diagnosticRawRatio,
  evaluateDiagnosticMeasureExpression,
  evaluateDiagnosticRoleExpression,
  type DiagnosticMetricFinding,
  type DiagnosticQuantity,
  type FinalizedDiagnosticMeasure,
} from "./diagnosticFormulas.js";
import {
  classifyDiagnosticComparison,
  diagnosticPredicateMatches,
  type DiagnosticRuleEvaluation,
} from "./diagnosticRules.js";
import {
  assertPreparedDiagnosticData,
  type PreparedDiagnosticData,
} from "./diagnosticPreparation.js";
import type { DiagnosticMeasureStats } from "./diagnosticDefinitions.js";
import {
  DiagnosticValidationError,
  type DiagnosticValidationIssue,
} from "./types.js";
import { canonicalJson } from "./canonical.js";
import {
  projectDiagnosticIdentity,
  type DiagnosticIdentityProjection,
} from "./diagnosticIdentity.js";
import { compareDiagnosticFindings } from "./diagnosticOrdering.js";
import { normalizeDiagnosticPeriod } from "./diagnosticPeriods.js";
import { normalizeDiagnosticSourceLocations } from "./diagnosticSourceOrdering.js";
import {
  diagnosticJsonPreflight,
  hasDiagnosticOwn,
  isDiagnosticPlainRecord,
  isDiagnosticToken,
} from "./diagnosticRuntime.js";

export interface RunMetricDiagnosticsInput {
  readonly prepared: PreparedDiagnosticData;
  readonly groupMap?: Readonly<Record<string, string>>;
  readonly groupDimensions?: Readonly<Record<string, JsonValue>>;
}
export interface DiagnosticMetricEvaluation {
  readonly instanceId: string;
  readonly instanceVersion: string;
  readonly formulaId: string;
  readonly formulaVersion: string;
  readonly semanticReferences: {
    readonly amountBasisIds: readonly string[];
    readonly countPopulationIds: readonly string[];
    readonly exposureBasisIds: readonly string[];
  };
  readonly formulaFingerprint: string;
  readonly calculationFingerprint: string;
  readonly definitionIntegrity: string;
  readonly calculation: {
    readonly numerator: DiagnosticQuantity;
    readonly denominator: DiagnosticQuantity;
    readonly value: number | null;
  };
  readonly presentation: DiagnosticMetricPresentation & {
    readonly value: number | null;
  };
  readonly components: Readonly<Record<string, DiagnosticMeasureStats>>;
  readonly rules: readonly DiagnosticRuleEvaluation[];
  readonly findings: readonly DiagnosticMetricFinding[];
}
export interface DiagnosticEmergencePoint {
  readonly group: string;
  readonly sourceGroups: readonly string[];
  readonly dimensions?: JsonValue;
  readonly origin: string;
  readonly valuation: string;
  readonly developmentAge: number;
  readonly ageUnit: string;
  readonly components: Readonly<Record<string, DiagnosticMeasureStats>>;
  readonly metrics: Readonly<Record<string, DiagnosticMetricEvaluation>>;
  readonly findings: readonly DiagnosticMetricFinding[];
}
export interface DiagnosticMetricTriangleCell {
  readonly origin: string;
  readonly valuation: string;
  readonly developmentAge: number;
  readonly ageUnit: string;
  readonly evaluation: DiagnosticMetricEvaluation;
}
export interface DiagnosticMetricTriangle {
  readonly group: string;
  readonly instanceId: string;
  readonly origins: readonly string[];
  readonly developmentAges: readonly number[];
  readonly ageUnit: string;
  readonly calculationValues: readonly (readonly (number | null)[])[];
  readonly presentationValues: readonly (readonly (number | null)[])[];
  readonly cells: readonly (readonly (DiagnosticMetricTriangleCell | null)[])[];
}
export interface MetricDiagnosticsResult {
  readonly definitionIntegrity: string;
  readonly preparationFingerprint: string;
  readonly ageUnit: string;
  readonly emergence: readonly DiagnosticEmergencePoint[];
  readonly triangles: readonly DiagnosticMetricTriangle[];
  readonly latestDiagonal: readonly DiagnosticEmergencePoint[];
  readonly findings: readonly DiagnosticMetricFinding[];
}
export interface CommonMaturityResult {
  readonly developmentAge: number | null;
  readonly ageUnit: string;
  readonly points: readonly DiagnosticDeepReadonly<DiagnosticEmergencePoint>[];
}
export type NormalizedDiagnosticResultIdentity = DiagnosticIdentityProjection<
  DiagnosticDeepReadonly<MetricDiagnosticsResult>
>;

function codeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function pointer(path: string, segment: string | number): string {
  return `${path}/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`;
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
function quantity(
  measure: DiagnosticMeasureDefinition,
  value: number | null,
): DiagnosticQuantity {
  return {
    kind: measure.kind,
    unit: measure.unit,
    ...(measure.basisId ? { basisId: measure.basisId } : {}),
    ...(measure.countPopulationId
      ? { countPopulationId: measure.countPopulationId }
      : {}),
    ...(measure.exposureBasisId
      ? { exposureBasisId: measure.exposureBasisId }
      : {}),
    value,
  };
}

const READINESS_ORDER = [
  "missing",
  "imputed",
  "non-finite",
  "structural-ambiguity",
  "aggregation-overflow",
  "expression-overflow",
  "tolerance-overflow",
] as const;
function readiness(
  values: readonly (typeof READINESS_ORDER)[number][],
): (typeof READINESS_ORDER)[number][] {
  return READINESS_ORDER.filter((value) => values.includes(value));
}
function expressionMeasureIds(
  expression: import("./diagnosticExpressions.js").DiagnosticMeasureExpression,
): string[] {
  if (expression.op === "measure") return [expression.measureId];
  return [
    ...new Set(
      (expression.op === "add"
        ? expression.terms
        : [expression.left, expression.right]
      ).flatMap(expressionMeasureIds),
    ),
  ].sort(codeUnit);
}
function unionSources(
  values: readonly import("./diagnosticDefinitions.js").DiagnosticSourceLocation[],
): import("./diagnosticDefinitions.js").DiagnosticSourceLocation[] {
  return normalizeDiagnosticSourceLocations(values);
}

function mergeFindings(
  values: readonly DiagnosticMetricFinding[],
): DiagnosticMetricFinding[] {
  const merged = new Map<string, DiagnosticMetricFinding>();
  for (const value of values) {
    const key = canonicalJson({ ...value, sources: [] });
    const previous = merged.get(key);
    const sources = normalizeDiagnosticSourceLocations([
      ...(previous?.sources ?? []),
      ...value.sources,
    ]);
    merged.set(key, { ...(previous ?? value), sources });
  }
  return [...merged.values()].sort(compareDiagnosticFindings);
}

export function validateDiagnosticGroupingConfiguration(
  input: RunMetricDiagnosticsInput,
): void {
  assertPreparedDiagnosticData(input.prepared);
  const boundaryIssues: DiagnosticValidationIssue[] = [];
  for (const [value, path] of [
    [input.groupMap, "$.groupMap"],
    [input.groupDimensions, "$.groupDimensions"],
  ] as const) {
    if (value === undefined) continue;
    if (!isDiagnosticPlainRecord(value))
      boundaryIssues.push({
        domain: "configuration",
        code: "invalid-type",
        path,
        message: "Grouping configuration must be a plain object",
      });
    else
      boundaryIssues.push(
        ...diagnosticJsonPreflight(value, "configuration").map((issue) => ({
          ...issue,
          path: issue.path === "$" ? path : `${path}${issue.path.slice(1)}`,
        })),
      );
  }
  if (boundaryIssues.length > 0)
    throw new DiagnosticValidationError(boundaryIssues);
  const auditedSourceGroups = input.prepared.inputAudit.flatMap((item) => {
    return input.prepared.filter?.sourceGroups === undefined ||
      input.prepared.filter.sourceGroups.includes(item.record.sourceGroup)
      ? [item.record.sourceGroup]
      : [];
  });
  const sourceGroups = new Set([
    ...auditedSourceGroups,
    ...input.prepared.cells.map((cell) => cell.sourceGroup),
  ]);
  for (const [source, target] of Object.entries(input.groupMap ?? {})) {
    if (!sourceGroups.has(source))
      throw new DiagnosticValidationError([
        {
          domain: "configuration",
          code: "invalid-configuration",
          path: `$.groupMap[${JSON.stringify(source)}]`,
          message: "Group map contains an unused source group",
        },
      ]);
    if (!isDiagnosticToken(source))
      throw new DiagnosticValidationError([
        {
          domain: "configuration",
          code: "invalid-string",
          path: `$.groupMap[${JSON.stringify(source)}]`,
          message: "Source group must be a nonempty token",
        },
      ]);
    if (!isDiagnosticToken(target))
      throw new DiagnosticValidationError([
        {
          domain: "configuration",
          code: "invalid-string",
          path: `$.groupMap[${JSON.stringify(source)}]`,
          message: "Output group must be a nonempty token",
        },
      ]);
  }
  const outputGroups = new Set(
    [...sourceGroups].map((source) =>
      input.groupMap !== undefined && hasDiagnosticOwn(input.groupMap, source)
        ? input.groupMap[source]!
        : source,
    ),
  );
  for (const group of Object.keys(input.groupDimensions ?? {}))
    if (!outputGroups.has(group))
      throw new DiagnosticValidationError([
        {
          domain: "configuration",
          code: "invalid-configuration",
          path: `$.groupDimensions[${JSON.stringify(group)}]`,
          message: "Dimensions contain an unused output group",
        },
      ]);
  for (const group of input.prepared.filter?.outputGroups ?? [])
    if (!outputGroups.has(group))
      throw new DiagnosticValidationError([
        {
          domain: "configuration",
          code: "unknown-reference",
          path: "$.prepared.filter.outputGroups",
          message: `Unknown output group ${group}`,
        },
      ]);
}

function mergeStats(
  cells: readonly PreparedDiagnosticData["cells"][number][],
  measure: { readonly id: string; readonly missing: "unknown" | "zero" },
): DiagnosticMeasureStats {
  const contributions = cells.flatMap(
    (cell) => cell.contributions[measure.id] ?? [],
  );
  const blockers = [
    ...new Map(
      cells
        .flatMap((cell) => cell.structuralBlockers[measure.id] ?? [])
        .map((blocker) => [canonicalJson(blocker), blocker]),
    ).entries(),
  ]
    .sort(([left], [right]) => codeUnit(left, right))
    .map(([, blocker]) => blocker);
  return finalizeDiagnosticContributions(
    contributions,
    measure.missing,
    blockers,
  );
}

function inferExpressionMeasure(
  expression: import("./diagnosticExpressions.js").DiagnosticMeasureExpression,
  measures: ReadonlyMap<string, DiagnosticMeasureDefinition>,
): DiagnosticMeasureDefinition {
  const id =
    expression.op === "measure"
      ? expression.measureId
      : expression.op === "add"
        ? inferExpressionMeasure(expression.terms[0]!, measures).id
        : inferExpressionMeasure(expression.left, measures).id;
  return measures.get(id)!;
}

function inferRoleExpressionMeasure(
  expression: import("./diagnosticExpressions.js").DiagnosticRoleExpression,
  bindings: Readonly<
    Record<
      string,
      import("./diagnosticExpressions.js").DiagnosticMeasureExpression
    >
  >,
  measures: ReadonlyMap<string, DiagnosticMeasureDefinition>,
): DiagnosticMeasureDefinition {
  const role =
    expression.op === "role"
      ? expression.role
      : inferRoleExpressionMeasure(
          expression.op === "add" ? expression.terms[0]! : expression.left,
          bindings,
          measures,
        ).id;
  if (expression.op !== "role") return measures.get(role)!;
  return inferExpressionMeasure(bindings[role]!, measures);
}

function evaluatePoint(
  prepared: PreparedDiagnosticData,
  components: Readonly<Record<string, DiagnosticMeasureStats>>,
  instanceId: string,
  context: {
    readonly group: string;
    readonly origin: string;
    readonly valuation: string;
    readonly developmentAge: number;
    readonly ageUnit: string;
  },
  preparedFindings: readonly DiagnosticMetricFinding[],
  blockerFindingsByMeasure: Readonly<
    Record<string, readonly DiagnosticMetricFinding[]>
  >,
  sourcesByMeasure: Readonly<
    Record<
      string,
      readonly import("./diagnosticDefinitions.js").DiagnosticSourceLocation[]
    >
  >,
): DiagnosticMetricEvaluation {
  const definition = prepared.definition;
  const internals = getCompiledDiagnosticDefinitionInternals(definition);
  const instance = definition.definition.instances.find(
    (item) => item.id === instanceId,
  )!;
  const formula = definition.definition.formulas.find(
    (item) => item.id === instance.formulaId,
  )!;
  const instanceIndex = definition.definition.instances.findIndex(
    (item) => item.id === instance.id,
  );
  const formulaIndex = definition.definition.formulas.findIndex(
    (item) => item.id === formula.id,
  );
  const measureStates: Record<string, FinalizedDiagnosticMeasure> =
    Object.create(null);
  for (const [measureId, stats] of Object.entries(components)) {
    const measure = internals.measuresById.get(measureId)!;
    const readiness = [
      ...(stats.missing > 0
        ? [stats.imputedZero > 0 ? ("imputed" as const) : ("missing" as const)]
        : []),
      ...(stats.nonFinite > 0 ? ["non-finite" as const] : []),
      ...(stats.structural > 0 ? ["structural-ambiguity" as const] : []),
      ...(stats.sum === null && stats.nonFinite === 0 && stats.structural === 0
        ? ["aggregation-overflow" as const]
        : []),
    ];
    measureStates[measureId] = {
      quantity: quantity(measure, stats.value),
      stats,
      readiness,
      sources: sourcesByMeasure[measureId] ?? [],
    };
  }
  const expressionSources = (
    expression: import("./diagnosticExpressions.js").DiagnosticMeasureExpression,
  ) =>
    unionSources(
      expressionMeasureIds(expression).flatMap(
        (measureId) => sourcesByMeasure[measureId] ?? [],
      ),
    );
  const withOverflowSources = <
    T extends {
      readonly value: number | null;
      readonly reasons: readonly (typeof READINESS_ORDER)[number][];
      readonly overflows: readonly import("./diagnosticRules.js").DiagnosticExpressionOverflow[];
    },
  >(
    result: T,
    sources: readonly import("./diagnosticDefinitions.js").DiagnosticSourceLocation[],
  ) => ({
    ...result,
    overflows: result.overflows.map((overflow) => ({
      ...overflow,
      sources: overflow.sources.length > 0 ? overflow.sources : sources,
    })),
  });
  const bindings = Object.fromEntries(
    Object.entries(instance.bindings).map(([role, expression]) => {
      const sources = expressionSources(expression);
      const path = pointer(
        pointer(pointer(pointer("", "instances"), instanceIndex), "bindings"),
        role,
      );
      return [
        role,
        withOverflowSources(
          evaluateDiagnosticMeasureExpression(expression, measureStates, path),
          sources,
        ),
      ];
    }),
  );
  const calculationSources = unionSources(
    (
      internals.calculationDependenciesByInstanceId.get(instance.id) ?? []
    ).flatMap((measureId) => sourcesByMeasure[measureId] ?? []),
  );
  const roleExpressionSources = (
    expression: import("./diagnosticExpressions.js").DiagnosticRoleExpression,
  ): import("./diagnosticDefinitions.js").DiagnosticSourceLocation[] => {
    if (expression.op === "role")
      return expressionSources(instance.bindings[expression.role]!);
    return unionSources(
      (expression.op === "add"
        ? expression.terms
        : [expression.left, expression.right]
      ).flatMap(roleExpressionSources),
    );
  };
  const numeratorSources = roleExpressionSources(formula.numerator);
  const denominatorSources = roleExpressionSources(formula.denominator);
  const formulaPath = pointer(pointer("", "formulas"), formulaIndex);
  const numeratorResult = withOverflowSources(
    evaluateDiagnosticRoleExpression(
      formula.numerator,
      bindings,
      pointer(formulaPath, "numerator"),
    ),
    numeratorSources,
  );
  const denominatorResult = withOverflowSources(
    evaluateDiagnosticRoleExpression(
      formula.denominator,
      bindings,
      pointer(formulaPath, "denominator"),
    ),
    denominatorSources,
  );
  const raw = diagnosticRawRatio(
    numeratorResult.value,
    denominatorResult.value,
  );
  const presented = applyDiagnosticPresentation(raw, instance.presentation);
  const numeratorMeasure = inferRoleExpressionMeasure(
    formula.numerator,
    instance.bindings,
    internals.measuresById,
  );
  const denominatorMeasure = inferRoleExpressionMeasure(
    formula.denominator,
    instance.bindings,
    internals.measuresById,
  );
  const ruleEvaluations: DiagnosticRuleEvaluation[] = [];
  const deps =
    internals.evaluationDependenciesByInstanceId.get(instance.id) ?? [];
  const findingContext = {
    instanceId: instance.id,
    ...context,
    sources: calculationSources,
  };
  const findings: DiagnosticMetricFinding[] = mergeFindings([
    ...preparedFindings.filter(
      (finding) =>
        finding.category !== "structural" &&
        (finding.measureId === undefined || deps.includes(finding.measureId)),
    ),
    ...deps.flatMap((measureId) => blockerFindingsByMeasure[measureId] ?? []),
  ]);
  for (const overflow of [
    ...numeratorResult.overflows,
    ...denominatorResult.overflows,
  ])
    findings.push({
      code: "diagnostic-expression-overflow",
      message: "Measure expression overflowed",
      severity: "fail",
      category: "aggregation",
      expressionPath: overflow.expressionPath,
      ...findingContext,
      sources: overflow.sources,
    });
  if (numeratorResult.value === null)
    findings.push({
      code: "diagnostic-numerator-unavailable",
      message: "Calculation numerator is unavailable",
      severity: "warning",
      category: "calculation",
      ...findingContext,
    });
  if (denominatorResult.value === null)
    findings.push({
      code: "diagnostic-denominator-unavailable",
      message: "Calculation denominator is unavailable",
      severity: "warning",
      category: "calculation",
      ...findingContext,
    });
  else if (denominatorResult.value <= 0)
    findings.push({
      code: "diagnostic-denominator-not-positive",
      message: "Calculation denominator is not strictly positive",
      severity: "warning",
      category: "calculation",
      ...findingContext,
    });
  else if (numeratorResult.value !== null && raw === null)
    findings.push({
      code: "diagnostic-calculation-overflow",
      message: "Calculation result overflowed",
      severity: "fail",
      category: "calculation",
      ...findingContext,
    });
  if (presented.finding)
    findings.push({ ...presented.finding, ...findingContext });
  type Operand = {
    readonly value: number | null;
    readonly reasons: readonly (typeof READINESS_ORDER)[number][];
    readonly overflows: readonly import("./diagnosticRules.js").DiagnosticExpressionOverflow[];
    readonly sources: readonly import("./diagnosticDefinitions.js").DiagnosticSourceLocation[];
  };
  const operand = (
    item: (typeof instance.rules)[number]["when"]["left"],
    path: string,
  ): Operand => {
    if (item.source === "constant")
      return { value: item.value, reasons: [], overflows: [], sources: [] };
    if (item.source === "calculation") {
      const result =
        item.field === "numerator" ? numeratorResult : denominatorResult;
      return {
        ...result,
        sources:
          item.field === "numerator" ? numeratorSources : denominatorSources,
      };
    }
    const sources = expressionSources(item.expression);
    return {
      ...withOverflowSources(
        evaluateDiagnosticMeasureExpression(
          item.expression,
          measureStates,
          pointer(path, "expression"),
        ),
        sources,
      ),
      sources,
    };
  };
  for (const [ruleIndex, rule] of instance.rules.entries()) {
    const rulePath = pointer(
      pointer(
        pointer(pointer(pointer("", "instances"), instanceIndex), "rules"),
        ruleIndex,
      ),
      "when",
    );
    const left = operand(rule.when.left, pointer(rulePath, "left"));
    const right = operand(rule.when.right, pointer(rulePath, "right"));
    const ruleSources = unionSources([...left.sources, ...right.sources]);
    const expressionOverflows = [
      ...new Map(
        [...left.overflows, ...right.overflows].map((overflow) => [
          canonicalJson(overflow),
          overflow,
        ]),
      ).entries(),
    ]
      .sort(([a], [b]) => codeUnit(a, b))
      .map(([, overflow]) => overflow);
    const reasons = readiness([
      ...left.reasons,
      ...right.reasons,
      ...(expressionOverflows.length > 0
        ? ["expression-overflow" as const]
        : []),
    ]);
    const classified =
      reasons.length > 0
        ? null
        : classifyDiagnosticComparison(
            left.value,
            right.value,
            rule.when.tolerance,
          );
    if (classified === null || classified.status === "not-evaluated") {
      const notEvaluatedReasons = readiness([
        ...reasons,
        ...(classified?.status === "not-evaluated" ? [classified.reason] : []),
        ...((left.value === null || right.value === null) &&
        reasons.length === 0
          ? ["missing" as const]
          : []),
      ]);
      ruleEvaluations.push({
        ruleId: rule.id,
        status: "not-evaluated",
        severity: rule.severity,
        left: left.value,
        right: right.value,
        relation: null,
        notEvaluatedReasons,
        expressionOverflows,
        code: "diagnostic-rule-not-evaluated",
        message: "Diagnostic metric rule was not evaluated",
      });
      for (const overflow of expressionOverflows)
        findings.push({
          code: "diagnostic-expression-overflow",
          message: "Measure expression overflowed",
          severity: "fail",
          category: "aggregation",
          ruleId: rule.id,
          expressionPath: overflow.expressionPath,
          ...findingContext,
          sources: overflow.sources,
        });
      findings.push({
        code: "diagnostic-rule-not-evaluated",
        message: "Diagnostic metric rule was not evaluated",
        severity: "info",
        category: "rule",
        ruleId: rule.id,
        ...findingContext,
        sources: ruleSources,
      });
      continue;
    }
    const triggered = diagnosticPredicateMatches(
      rule.when.operator,
      classified.relation,
    );
    ruleEvaluations.push({
      ruleId: rule.id,
      status: triggered ? "triggered" : "pass",
      severity: rule.severity,
      left: left.value,
      right: right.value,
      relation: classified.relation,
      notEvaluatedReasons: [],
      expressionOverflows: [],
      code: triggered ? rule.code : null,
      message: triggered ? rule.message : null,
    });
    if (triggered)
      findings.push({
        code: rule.code,
        message: rule.message,
        severity: rule.severity,
        category: "rule",
        ruleId: rule.id,
        ...findingContext,
        sources: ruleSources,
      });
  }
  const refs = {
    amountBasisIds: [
      ...new Set(
        deps.flatMap((id) =>
          internals.measuresById.get(id)?.basisId
            ? [internals.measuresById.get(id)!.basisId!]
            : [],
        ),
      ),
    ].sort(codeUnit),
    countPopulationIds: [
      ...new Set(
        deps.flatMap((id) =>
          internals.measuresById.get(id)?.countPopulationId
            ? [internals.measuresById.get(id)!.countPopulationId!]
            : [],
        ),
      ),
    ].sort(codeUnit),
    exposureBasisIds: [
      ...new Set(
        deps.flatMap((id) =>
          internals.measuresById.get(id)?.exposureBasisId
            ? [internals.measuresById.get(id)!.exposureBasisId!]
            : [],
        ),
      ),
    ].sort(codeUnit),
  };
  return deepFreeze({
    instanceId: instance.id,
    instanceVersion: instance.version,
    formulaId: formula.id,
    formulaVersion: formula.version,
    semanticReferences: refs,
    formulaFingerprint: definition.formulaFingerprints[formula.id]!,
    calculationFingerprint: definition.calculationFingerprints[instance.id]!,
    definitionIntegrity: definition.definitionIntegrity,
    calculation: {
      numerator: quantity(numeratorMeasure, numeratorResult.value),
      denominator: quantity(denominatorMeasure, denominatorResult.value),
      value: raw,
    },
    presentation: { ...instance.presentation, value: presented.value },
    components: Object.fromEntries(deps.map((id) => [id, components[id]!])),
    rules: ruleEvaluations,
    findings: mergeFindings(findings),
  });
}

export function runMetricDiagnostics(
  input: RunMetricDiagnosticsInput,
): DiagnosticDeepReadonly<MetricDiagnosticsResult> {
  validateDiagnosticGroupingConfiguration(input);
  const prepared = input.prepared;
  const buckets = new Map<string, typeof prepared.cells>();
  for (const cell of prepared.cells) {
    const group =
      input.groupMap !== undefined &&
      hasDiagnosticOwn(input.groupMap, cell.sourceGroup)
        ? input.groupMap[cell.sourceGroup]!
        : cell.sourceGroup;
    if (
      prepared.filter?.outputGroups !== undefined &&
      !prepared.filter.outputGroups.includes(group)
    )
      continue;
    const key = canonicalJson([group, cell.origin, cell.valuation]);
    buckets.set(key, [...(buckets.get(key) ?? []), cell]);
  }
  const selectedInstances = prepared.definition.definition.instances.filter(
    (instance) =>
      prepared.filter?.instanceIds === undefined ||
      prepared.filter.instanceIds.includes(instance.id),
  );
  const emergence: DiagnosticEmergencePoint[] = [];
  for (const [key, cells] of buckets) {
    const [group, origin, valuation] = JSON.parse(key) as [
      string,
      string,
      string,
    ];
    const components = Object.fromEntries(
      prepared.definition.definition.measures.map((measure) => [
        measure.id,
        mergeStats(cells, measure),
      ]),
    );
    const sourcesByMeasure = Object.fromEntries(
      prepared.definition.definition.measures.map((measure) => [
        measure.id,
        unionSources(
          cells.flatMap((cell) => [
            ...(cell.contributions[measure.id] ?? []).flatMap(
              (item) => item.sources,
            ),
            ...(cell.structuralBlockers[measure.id] ?? []).flatMap(
              (item) => item.sources,
            ),
          ]),
        ),
      ]),
    );
    const context = {
      group,
      origin,
      valuation,
      developmentAge: cells[0]!.developmentAge,
      ageUnit: cells[0]!.ageUnit,
    };
    const mappedOverflowFindings =
      prepared.definition.definition.measures.flatMap(
        (measure): DiagnosticMetricFinding[] => {
          const stats = components[measure.id]!;
          return stats.sum === null &&
            stats.nonFinite === 0 &&
            stats.structural === 0
            ? [
                {
                  code: "diagnostic-measure-overflow",
                  message: "Measure aggregation overflowed",
                  severity: "fail",
                  category: "aggregation",
                  measureId: measure.id,
                  ...context,
                  sources: sourcesByMeasure[measure.id] ?? [],
                },
              ]
            : [];
        },
      );
    const mappedDeduplicationFindings =
      prepared.definition.definition.measures.flatMap(
        (measure): DiagnosticMetricFinding[] => {
          const stats = components[measure.id]!;
          return stats.deduplicated > 0
            ? [
                {
                  code: "diagnostic-exposure-deduplicated",
                  message: `${stats.deduplicated} repeated exposure observation(s) were counted once by stable key`,
                  severity: "info",
                  category: "aggregation",
                  measureId: measure.id,
                  ...context,
                  sources: sourcesByMeasure[measure.id] ?? [],
                },
              ]
            : [];
        },
      );
    const mappedFindings = mergeFindings([
      ...cells.flatMap((cell) =>
        cell.findings.map((finding) => ({ ...finding, group })),
      ),
      ...mappedOverflowFindings,
      ...mappedDeduplicationFindings,
    ]);
    const blockerFindingsByMeasure = Object.fromEntries(
      prepared.definition.definition.measures.map((measure) => [
        measure.id,
        mergeFindings(
          cells.flatMap((cell) =>
            (cell.structuralBlockers[measure.id] ?? []).flatMap((blocker) =>
              blocker.finding ? [{ ...blocker.finding, group }] : [],
            ),
          ),
        ),
      ]),
    );
    const metrics = Object.fromEntries(
      selectedInstances.map((instance) => [
        instance.id,
        evaluatePoint(
          prepared,
          components,
          instance.id,
          context,
          mappedFindings,
          blockerFindingsByMeasure,
          sourcesByMeasure,
        ),
      ]),
    );
    emergence.push({
      group,
      sourceGroups: [...new Set(cells.map((cell) => cell.sourceGroup))].sort(
        codeUnit,
      ),
      ...(input.groupDimensions &&
      Object.prototype.hasOwnProperty.call(input.groupDimensions, group)
        ? { dimensions: input.groupDimensions[group] }
        : {}),
      origin,
      valuation,
      developmentAge: cells[0]!.developmentAge,
      ageUnit: cells[0]!.ageUnit,
      components,
      metrics,
      findings: mergeFindings([
        ...mappedFindings,
        ...Object.values(metrics).flatMap((metric) => metric.findings),
      ]),
    });
  }
  const periodCoordinate = (side: "origin" | "valuation", label: string) =>
    normalizeDiagnosticPeriod(prepared.definition, side, label).coordinate;
  emergence.sort(
    (a, b) =>
      codeUnit(a.group, b.group) ||
      periodCoordinate("origin", a.origin) -
        periodCoordinate("origin", b.origin) ||
      periodCoordinate("valuation", a.valuation) -
        periodCoordinate("valuation", b.valuation) ||
      codeUnit(a.origin, b.origin) ||
      codeUnit(a.valuation, b.valuation),
  );
  const groups = [...new Set(emergence.map((point) => point.group))].sort(
    codeUnit,
  );
  const triangles: DiagnosticMetricTriangle[] = [];
  for (const group of groups)
    for (const instance of selectedInstances) {
      const points = emergence.filter((point) => point.group === group);
      const origins = [...new Set(points.map((point) => point.origin))].sort(
        (a, b) =>
          periodCoordinate("origin", a) - periodCoordinate("origin", b) ||
          codeUnit(a, b),
      );
      const ages = [
        ...new Set(points.map((point) => point.developmentAge)),
      ].sort((a, b) => a - b);
      const cells = origins.map((origin) =>
        ages.map((age) => {
          const point = points.find(
            (item) => item.origin === origin && item.developmentAge === age,
          );
          return point
            ? {
                origin: point.origin,
                valuation: point.valuation,
                developmentAge: point.developmentAge,
                ageUnit: point.ageUnit,
                evaluation: point.metrics[instance.id]!,
              }
            : null;
        }),
      );
      triangles.push({
        group,
        instanceId: instance.id,
        origins,
        developmentAges: ages,
        ageUnit: prepared.definition.definition.periodAxis.ageUnit,
        calculationValues: cells.map((row) =>
          row.map((cell) => cell?.evaluation.calculation.value ?? null),
        ),
        presentationValues: cells.map((row) =>
          row.map((cell) => cell?.evaluation.presentation.value ?? null),
        ),
        cells,
      });
    }
  const latestDiagonal = groups.flatMap((group) => {
    const groupPoints = emergence.filter((point) => point.group === group);
    return [...new Set(groupPoints.map((point) => point.origin))].flatMap(
      (origin) => {
        const points = groupPoints.filter((point) => point.origin === origin);
        return points.length
          ? [
              points.reduce((latest, point) =>
                point.developmentAge > latest.developmentAge ? point : latest,
              ),
            ]
          : [];
      },
    );
  });
  const attachedPreparationFindings = new Set(
    prepared.cells
      .flatMap((cell) => cell.findings)
      .map((finding) => canonicalJson(finding)),
  );
  const unattachedPreparationFindings = prepared.findings.filter(
    (finding) => !attachedPreparationFindings.has(canonicalJson(finding)),
  );
  return deepFreeze({
    definitionIntegrity: prepared.definition.definitionIntegrity,
    preparationFingerprint: prepared.preparationFingerprint,
    ageUnit: prepared.definition.definition.periodAxis.ageUnit,
    emergence,
    triangles,
    latestDiagonal,
    findings: mergeFindings([
      ...unattachedPreparationFindings,
      ...emergence.flatMap((point) => point.findings),
    ]),
  });
}

function viewGroups(
  result: DiagnosticDeepReadonly<MetricDiagnosticsResult>,
  outputGroups: readonly string[],
  path: string,
): readonly string[] {
  if (!Array.isArray(outputGroups))
    throw new DiagnosticValidationError([
      {
        domain: "view",
        code: "invalid-type",
        path,
        message: "Output groups must be an array",
      },
    ]);
  const produced = new Set(result.emergence.map((point) => point.group));
  const issues: DiagnosticValidationIssue[] = [];
  outputGroups.forEach((group, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isDiagnosticToken(group))
      issues.push({
        domain: "view",
        code: "invalid-string",
        path: itemPath,
        message: "Output group must be a nonempty token",
      });
    else if (!produced.has(group))
      issues.push({
        domain: "view",
        code: "unknown-reference",
        path: itemPath,
        message: `Unknown output group ${group}`,
      });
  });
  if (issues.length > 0) throw new DiagnosticValidationError(issues);
  return [...new Set(outputGroups)].sort(codeUnit);
}

export function sameMaturity(
  result: DiagnosticDeepReadonly<MetricDiagnosticsResult>,
  developmentAge: number,
  outputGroups?: readonly string[],
): readonly DiagnosticDeepReadonly<DiagnosticEmergencePoint>[] {
  if (!Number.isSafeInteger(developmentAge) || developmentAge < 0)
    throw new DiagnosticValidationError([
      {
        domain: "view",
        code: "invalid-number",
        path: "$.developmentAge",
        message: "Development age must be a nonnegative safe integer",
      },
    ]);
  const groups =
    outputGroups === undefined
      ? null
      : new Set(viewGroups(result, outputGroups, "$.outputGroups"));
  return result.emergence.filter(
    (point) =>
      point.developmentAge === developmentAge &&
      (groups === null || groups.has(point.group)),
  );
}

export function commonMaturity(
  result: DiagnosticDeepReadonly<MetricDiagnosticsResult>,
  outputGroups: readonly string[],
): DiagnosticDeepReadonly<CommonMaturityResult> {
  const groups = viewGroups(result, outputGroups, "$.outputGroups");
  if (groups.length === 0)
    return deepFreeze({
      developmentAge: null,
      ageUnit: result.ageUnit,
      points: [],
    });
  const common = [
    ...new Set(
      result.emergence
        .filter((point) => point.group === groups[0])
        .map((point) => point.developmentAge),
    ),
  ]
    .filter((age) =>
      groups.every((group) =>
        result.emergence.some(
          (point) => point.group === group && point.developmentAge === age,
        ),
      ),
    )
    .sort((left, right) => right - left);
  const developmentAge = common[0] ?? null;
  return deepFreeze({
    developmentAge,
    ageUnit: result.ageUnit,
    points:
      developmentAge === null
        ? []
        : sameMaturity(result, developmentAge, groups),
  });
}
export function getMetricDiagnosticsResultIdentity(
  result: DiagnosticDeepReadonly<MetricDiagnosticsResult>,
): NormalizedDiagnosticResultIdentity {
  return projectDiagnosticIdentity(result);
}
