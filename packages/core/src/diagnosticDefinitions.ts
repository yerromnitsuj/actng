import {
  MAX_DIAGNOSTIC_DEFINITION_EXPRESSION_NODES,
  MAX_DIAGNOSTIC_EXPRESSION_NODES,
  walkDiagnosticExpression,
  type DiagnosticClaimExpression,
  type DiagnosticMeasureExpression,
  type DiagnosticRoleExpression,
} from "./diagnosticExpressions.js";
import {
  buildDiagnosticIdentities,
  normalizeDiagnosticDefinition,
  type NormalizedDiagnosticCalculationScope,
  type NormalizedDiagnosticDefinitionIdentity,
  type NormalizedDiagnosticFormulaIdentity,
} from "./diagnosticIdentity.js";
import {
  DiagnosticValidationError,
  type DiagnosticValidationIssue,
  type DiagnosticValidationIssueCode,
} from "./types.js";
import { canonicalJson } from "./canonical.js";
import { normalizeDiagnosticPeriodWithAxis } from "./diagnosticPeriodAxis.js";
import {
  diagnosticJsonPreflight,
  hasDiagnosticOwn,
  isDiagnosticPlainRecord,
  isDiagnosticToken,
  isWellFormedDiagnosticString,
} from "./diagnosticRuntime.js";

export type DiagnosticMeasureKind = "count" | "amount" | "exposure";
export type DiagnosticMeasureSource = "loss" | "exposure" | "derived";
export type DiagnosticMissingPolicy = "unknown" | "zero";
export type DiagnosticAggregation = "sum";
export type DiagnosticExposureTiming = "origin-static" | "valuation-specific";
export type DiagnosticDevelopmentSemantics =
  | "cumulative"
  | "incremental"
  | "point-in-time"
  | "unknown";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type DiagnosticDeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DiagnosticDeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DiagnosticDeepReadonly<T[K]> }
    : T;

export interface DiagnosticMeasureDefinition {
  id: string;
  displayName: string;
  description: string;
  source: DiagnosticMeasureSource;
  kind: DiagnosticMeasureKind;
  unit: string;
  developmentSemantics: DiagnosticDevelopmentSemantics;
  aggregation: DiagnosticAggregation;
  missing: DiagnosticMissingPolicy;
  basisId?: string;
  countPopulationId?: string;
  exposureBasisId?: string;
  exposureTiming?: DiagnosticExposureTiming;
}

export interface DiagnosticCountPopulationDefinition {
  id: string;
  displayName: string;
  subject: "claim" | "claimant" | "policy" | "occurrence" | "other" | "unknown";
  unit: string;
  description: string;
  attributes?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DiagnosticExposureBasisDefinition {
  id: string;
  displayName: string;
  basis: "earned" | "written" | "in-force" | "other" | "unknown";
  unit: string;
  description: string;
  sourceDescription?: string;
  attributes?: Readonly<Record<string, string | number | boolean | null>>;
}

export type AmountPerspective = "gross" | "net" | "ceded" | "other" | "unknown";

export type AmountLimitation =
  | { kind: "unlimited" }
  | {
      kind: "layer" | "pre-limited";
      attachment: number;
      limit: number | null;
      application: "claim" | "occurrence" | "policy" | "source-defined";
      derivation:
        | { kind: "sdk" }
        | {
            kind: "external";
            actor: "caller" | "source";
            transformationRef: string;
          };
    }
  | { kind: "unknown"; description?: string };

export interface AmountBasisComponent {
  id: string;
  treatment: "included" | "excluded" | "unknown";
  limitation: AmountLimitation;
}

export interface AmountBasisDefinition {
  id: string;
  displayName: string;
  currency: string;
  perspective: AmountPerspective;
  components: readonly AmountBasisComponent[];
  sourceDescription?: string;
  attributes?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DiagnosticFormulaRole {
  kind: DiagnosticMeasureKind;
  compatibilityGroup?: string;
  developmentSemantics?: DiagnosticDevelopmentSemantics;
}

export interface DiagnosticFormulaTemplate {
  id: string;
  version: string;
  roles: Readonly<Record<string, DiagnosticFormulaRole>>;
  numerator: DiagnosticRoleExpression;
  denominator: DiagnosticRoleExpression;
  denominatorPolicy: "positive-or-null";
}

export interface DiagnosticMetricPresentation {
  displayName: string;
  description: string;
  displayUnit: string;
  scale: number;
  numeratorLabel: string;
  denominatorLabel: string;
}

export type DiagnosticRuleOperand =
  | { source: "measure"; expression: DiagnosticMeasureExpression }
  | { source: "calculation"; field: "numerator" | "denominator" }
  | { source: "constant"; value: number };

export interface DiagnosticComparisonPredicate {
  left: DiagnosticRuleOperand;
  operator: "lt" | "lte" | "eq" | "neq" | "gte" | "gt";
  right: DiagnosticRuleOperand;
  tolerance?: { absolute?: number; relative?: number };
}

export interface DiagnosticComparisonRule {
  id: string;
  code: string;
  message: string;
  severity: "warning" | "fail";
  when: DiagnosticComparisonPredicate;
}

export interface DiagnosticMetricInstance {
  id: string;
  version: string;
  formulaId: string;
  bindings: Readonly<Record<string, DiagnosticMeasureExpression>>;
  presentation: DiagnosticMetricPresentation;
  rules: readonly DiagnosticComparisonRule[];
}

export interface DiagnosticPeriodCoordinate {
  label: string;
  aliases?: readonly string[];
  coordinate: number;
}

export type DiagnosticPeriodAxis =
  | {
      kind: "calendar";
      originCadence: "month" | "quarter" | "year";
      valuationCadence: "month" | "quarter" | "year";
      originAnchor: "start" | "end";
      valuationAnchor: "start" | "end";
      ageUnit: "month";
      ageOffset: number;
    }
  | {
      kind: "ordered";
      id: string;
      version: string;
      ageUnit: string;
      ageOffset: number;
      origins: readonly DiagnosticPeriodCoordinate[];
      valuations: readonly DiagnosticPeriodCoordinate[];
    };

export interface DiagnosticDerivedMeasureDefinition {
  id: string;
  outputMeasureId: string;
  expression: DiagnosticClaimExpression;
}

export interface DiagnosticsFilter {
  sourceGroups?: readonly string[];
  outputGroups?: readonly string[];
  origins?: readonly string[];
  originFrom?: string;
  originThrough?: string;
  valuations?: readonly string[];
  valuationFrom?: string;
  valuationThrough?: string;
  minDevelopmentAge?: number;
  maxDevelopmentAge?: number;
  instanceIds?: readonly string[];
}

interface DiagnosticReviewRuleBase {
  id: string;
  code: string;
  description: string;
  severity: "warning" | "fail";
  tolerance?: { absolute?: number; relative?: number };
  missingInput: "not-evaluated" | "finding";
}

export type DiagnosticReviewOperand =
  | DiagnosticMeasureExpression
  | { op: "constant"; value: number };

export interface DiagnosticReviewPredicate {
  left: DiagnosticReviewOperand;
  operator: "lt" | "lte" | "eq" | "neq" | "gte" | "gt";
  right: DiagnosticReviewOperand;
}

export type DiagnosticControlTotalProjection =
  | { kind: "valuation"; valuation: string }
  | { kind: "latest-valuation-per-origin" }
  | { kind: "all-cells" };

export type DiagnosticReviewFilter = Omit<
  DiagnosticsFilter,
  "outputGroups" | "instanceIds"
>;

export type DiagnosticReviewRule =
  | (DiagnosticReviewRuleBase & {
      kind: "compare";
      when: DiagnosticReviewPredicate;
    })
  | (DiagnosticReviewRuleBase & {
      kind: "reconcile";
      actual: DiagnosticMeasureExpression;
      expected: DiagnosticReviewOperand;
    })
  | (DiagnosticReviewRuleBase & {
      kind: "monotonic";
      expression: DiagnosticMeasureExpression;
      direction: "nondecreasing" | "nonincreasing";
    })
  | (DiagnosticReviewRuleBase & {
      kind: "layer-order";
      narrower: DiagnosticMeasureExpression;
      broader: DiagnosticMeasureExpression;
      comparability:
        | { kind: "compiler-proven" }
        | { kind: "caller-asserted"; rationaleArtifactId: string };
    })
  | (DiagnosticReviewRuleBase & {
      kind: "control-total";
      expression: DiagnosticMeasureExpression;
      expected: number;
      filter?: DiagnosticReviewFilter;
      projection: DiagnosticControlTotalProjection;
    });

export interface DiagnosticDefinition {
  diagnosticDefinitionVersion: "1.0.0";
  id: string;
  version: string;
  lossRowGrain: "claim" | "aggregate";
  measures: readonly DiagnosticMeasureDefinition[];
  countPopulations: readonly DiagnosticCountPopulationDefinition[];
  exposureBases: readonly DiagnosticExposureBasisDefinition[];
  amountBases: readonly AmountBasisDefinition[];
  derivedMeasures: readonly DiagnosticDerivedMeasureDefinition[];
  formulas: readonly DiagnosticFormulaTemplate[];
  instances: readonly DiagnosticMetricInstance[];
  reviewRules: readonly DiagnosticReviewRule[];
  periodAxis: DiagnosticPeriodAxis;
}

export interface DiagnosticSourceLocation {
  readonly artifactId: string;
  readonly sourceFile?: string;
  readonly sourceSheet?: string;
  readonly sourceRow?: number;
  readonly sourceCell?: string;
}

export interface DiagnosticMeasureStats {
  readonly value: number | null;
  readonly sum: number | null;
  readonly observed: number;
  readonly missing: number;
  readonly nonFinite: number;
  readonly imputedZero: number;
  readonly deduplicated: number;
  readonly structural: number;
}

const compiledDiagnosticDefinitionBrand: unique symbol = Symbol(
  "compiled-diagnostic-definition",
);

export interface CompiledDiagnosticDefinition {
  readonly [compiledDiagnosticDefinitionBrand]: true;
  readonly definition: DiagnosticDeepReadonly<NormalizedDiagnosticDefinitionIdentity>;
  readonly formulaFingerprints: Readonly<Record<string, string>>;
  readonly calculationFingerprints: Readonly<Record<string, string>>;
  readonly definitionIntegrity: string;
}

export interface CompiledDiagnosticDefinitionInternals {
  readonly formulasById: ReadonlyMap<
    string,
    NormalizedDiagnosticFormulaIdentity
  >;
  readonly measuresById: ReadonlyMap<string, DiagnosticMeasureDefinition>;
  readonly calculationScopesByInstanceId: ReadonlyMap<
    string,
    NormalizedDiagnosticCalculationScope
  >;
  readonly calculationDependenciesByInstanceId: ReadonlyMap<
    string,
    readonly string[]
  >;
  readonly evaluationDependenciesByInstanceId: ReadonlyMap<
    string,
    readonly string[]
  >;
  readonly derivationsByOutputMeasureId: ReadonlyMap<
    string,
    DiagnosticDerivedMeasureDefinition
  >;
}

const authenticCompiledDefinitions = new WeakSet<object>();
const compiledInternals = new WeakMap<
  object,
  CompiledDiagnosticDefinitionInternals
>();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isDiagnosticPlainRecord(value);
}

function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function pushIssue(
  issues: DiagnosticValidationIssue[],
  code: DiagnosticValidationIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ domain: "definition", code, path, message });
}

function validateAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: DiagnosticValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      pushIssue(
        issues,
        "unknown-key",
        propertyPath(path, key),
        `Unknown key ${key}`,
      );
    } else if (value[key] === undefined) {
      pushIssue(
        issues,
        "invalid-type",
        propertyPath(path, key),
        "Explicit undefined is not allowed",
      );
    }
  }
}

function validateScalarAttributes(
  value: unknown,
  path: string,
  issues: DiagnosticValidationIssue[],
): void {
  if (value === undefined) return;
  if (!isPlainRecord(value)) {
    pushIssue(
      issues,
      "invalid-type",
      path,
      "Attributes must be a plain object",
    );
    return;
  }
  for (const [key, scalar] of Object.entries(value)) {
    validateToken(key, propertyPath(path, key), "Attribute key", issues);
    if (
      scalar !== null &&
      typeof scalar !== "string" &&
      typeof scalar !== "number" &&
      typeof scalar !== "boolean"
    ) {
      pushIssue(
        issues,
        "invalid-type",
        propertyPath(path, key),
        "Attribute value must be a string, finite number, boolean, or null",
      );
    } else if (typeof scalar === "number") {
      validateFinite(
        scalar,
        propertyPath(path, key),
        "Attribute number",
        issues,
      );
    } else if (
      typeof scalar === "string" &&
      !isWellFormedDiagnosticString(scalar)
    ) {
      pushIssue(
        issues,
        "invalid-string",
        propertyPath(path, key),
        "Attribute string contains invalid Unicode",
      );
    }
  }
}

function validateToken(
  value: unknown,
  path: string,
  label: string,
  issues: DiagnosticValidationIssue[],
): value is string {
  if (typeof value !== "string") {
    pushIssue(issues, "invalid-type", path, `${label} must be a string`);
    return false;
  }
  if (!isWellFormedDiagnosticString(value)) {
    pushIssue(
      issues,
      "invalid-string",
      path,
      `${label} contains an invalid Unicode string`,
    );
    return false;
  }
  if (!isDiagnosticToken(value)) {
    pushIssue(
      issues,
      "invalid-string",
      path,
      `${label} must be nonempty without surrounding ASCII whitespace`,
    );
    return false;
  }
  return true;
}

function validateFinite(
  value: unknown,
  path: string,
  label: string,
  issues: DiagnosticValidationIssue[],
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    pushIssue(issues, "invalid-number", path, `${label} must be finite`);
    return false;
  }
  return true;
}

function validateJsonValue(
  value: unknown,
  issues: DiagnosticValidationIssue[],
): void {
  issues.push(...diagnosticJsonPreflight(value, "definition"));
}

function requireArray(
  value: unknown,
  path: string,
  issues: DiagnosticValidationIssue[],
): readonly unknown[] {
  if (!Array.isArray(value)) {
    pushIssue(issues, "invalid-type", path, "Expected an array");
    return [];
  }
  return value;
}

function collectCatalog<T extends { readonly id: string }>(
  values: readonly T[],
  path: string,
  issues: DiagnosticValidationIssue[],
): Map<string, T> {
  const result = new Map<string, T>();
  values.forEach((value, index) => {
    const idPath = `${path}[${index}].id`;
    if (!validateToken(value?.id, idPath, "ID", issues)) return;
    if (result.has(value.id)) {
      pushIssue(issues, "duplicate-id", idPath, `Duplicate ID ${value.id}`);
    } else result.set(value.id, value);
  });
  return result;
}

function semanticReference(measure: DiagnosticMeasureDefinition): string {
  if (measure.kind === "amount") return `amount:${measure.basisId ?? ""}`;
  if (measure.kind === "count")
    return `count:${measure.countPopulationId ?? ""}`;
  return `exposure:${measure.exposureBasisId ?? ""}`;
}

function transitiveMeasureIds(
  roots: readonly string[],
  derivations: ReadonlyMap<string, DiagnosticDerivedMeasureDefinition>,
): readonly string[] {
  const result = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    const derivation = derivations.get(id);
    if (derivation) {
      stack.push(
        ...walkDiagnosticExpression(derivation.expression, "claim", "$", [])
          .dependencies,
      );
    }
  }
  return [...result].sort();
}

interface ProjectedAmountBasis {
  readonly currency: string;
  readonly perspective: AmountPerspective;
  readonly components: readonly AmountBasisComponent[];
}

interface ProjectedClaimSemantics {
  readonly kind: DiagnosticMeasureKind;
  readonly unit: string;
  readonly reference: string;
  readonly amountBasis?: ProjectedAmountBasis;
}

function projectedAmountBasis(
  basis: AmountBasisDefinition,
): ProjectedAmountBasis {
  return {
    currency: basis.currency,
    perspective: basis.perspective,
    components: [...basis.components].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
  };
}

function projectedBasisKey(basis: ProjectedAmountBasis): string {
  return canonicalJson(basis);
}

function projectClaimExpression(
  expression: DiagnosticClaimExpression,
  path: string,
  measures: ReadonlyMap<string, DiagnosticMeasureDefinition>,
  amountBases: ReadonlyMap<string, AmountBasisDefinition>,
  issues: DiagnosticValidationIssue[],
): ProjectedClaimSemantics | null {
  if (expression.op === "measure") {
    const measure = measures.get(expression.measureId);
    if (!measure) return null;
    if (measure.kind !== "amount") {
      return {
        kind: measure.kind,
        unit: measure.unit,
        reference: semanticReference(measure),
      };
    }
    const basis = measure.basisId
      ? amountBases.get(measure.basisId)
      : undefined;
    return basis
      ? {
          kind: "amount",
          unit: measure.unit,
          reference: `amount:${measure.basisId}`,
          amountBasis: projectedAmountBasis(basis),
        }
      : null;
  }
  if (expression.op === "claim-layer") {
    const measure = measures.get(expression.measureId);
    if (!measure || measure.kind !== "amount" || !measure.basisId) {
      pushIssue(
        issues,
        "incompatible-semantics",
        path,
        "Claim layers require an amount measure",
      );
      return null;
    }
    const basis = amountBases.get(measure.basisId);
    const component = basis?.components[0];
    if (
      !basis ||
      basis.components.length !== 1 ||
      component?.treatment !== "included" ||
      component.limitation.kind !== "unlimited"
    ) {
      pushIssue(
        issues,
        "incompatible-semantics",
        path,
        "Claim layers require one included unlimited source component",
      );
      return null;
    }
    return {
      kind: "amount",
      unit: measure.unit,
      reference: "amount:projected",
      amountBasis: {
        currency: basis.currency,
        perspective: basis.perspective,
        components: [
          {
            id: component.id,
            treatment: "included",
            limitation: {
              kind: "layer",
              attachment: expression.attachment,
              limit: expression.limit,
              application: "claim",
              derivation: { kind: "sdk" },
            },
          },
        ],
      },
    };
  }
  const children =
    expression.op === "add"
      ? expression.terms
      : [expression.left, expression.right];
  const projected = children.map((child, index) =>
    projectClaimExpression(
      child,
      expression.op === "add"
        ? `${path}.terms[${index}]`
        : `${path}.${index === 0 ? "left" : "right"}`,
      measures,
      amountBases,
      issues,
    ),
  );
  if (projected.some((item) => item === null)) return null;
  const present = projected as ProjectedClaimSemantics[];
  if (expression.op === "subtract") {
    const [left, right] = present;
    if (
      left!.kind !== right!.kind ||
      left!.unit !== right!.unit ||
      (left!.kind === "amount"
        ? projectedBasisKey(left!.amountBasis!) !==
          projectedBasisKey(right!.amountBasis!)
        : left!.reference !== right!.reference)
    ) {
      pushIssue(
        issues,
        "incompatible-semantics",
        path,
        "Claim subtraction requires one exact semantic basis",
      );
      return null;
    }
    return left!;
  }
  const first = present[0]!;
  if (
    present.some((item) => item.kind !== first.kind || item.unit !== first.unit)
  ) {
    pushIssue(
      issues,
      "incompatible-semantics",
      path,
      "Claim addition requires one kind and unit",
    );
    return null;
  }
  if (first.kind !== "amount") {
    if (present.some((item) => item.reference !== first.reference)) {
      pushIssue(
        issues,
        "incompatible-semantics",
        path,
        "Claim addition requires one exact semantic basis",
      );
      return null;
    }
    return first;
  }
  const bases = present.map((item) => item.amountBasis!);
  if (
    bases.some(
      (basis) =>
        basis.currency !== bases[0]!.currency ||
        basis.perspective !== bases[0]!.perspective,
    )
  ) {
    pushIssue(
      issues,
      "incompatible-semantics",
      path,
      "Amount addition cannot mix currency or perspective",
    );
    return null;
  }
  const componentIds = new Set<string>();
  const components: AmountBasisComponent[] = [];
  for (const basis of bases) {
    for (const component of basis.components) {
      if (componentIds.has(component.id)) {
        pushIssue(
          issues,
          "incompatible-semantics",
          path,
          `Amount addition overlaps component ${component.id}`,
        );
        return null;
      }
      componentIds.add(component.id);
      components.push(component);
    }
  }
  const amountBasis = {
    currency: bases[0]!.currency,
    perspective: bases[0]!.perspective,
    components: components.sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
  };
  return {
    kind: "amount",
    unit: first.unit,
    reference: "amount:projected",
    amountBasis,
  };
}

function expressionSemantics(
  expression: DiagnosticMeasureExpression,
  path: string,
  measures: ReadonlyMap<string, DiagnosticMeasureDefinition>,
  issues: DiagnosticValidationIssue[],
): {
  readonly measureIds: readonly string[];
  readonly signature: string | null;
} {
  const walked = walkDiagnosticExpression(expression, "measure", path, issues);
  const found = walked.dependencies
    .map((id) => measures.get(id))
    .filter(
      (value): value is DiagnosticMeasureDefinition => value !== undefined,
    );
  for (const id of walked.dependencies) {
    if (!measures.has(id)) {
      pushIssue(issues, "unknown-reference", path, `Unknown measure ${id}`);
    }
  }
  const signatures = new Set(
    found.map((measure) =>
      canonicalJson([measure.kind, measure.unit, semanticReference(measure)]),
    ),
  );
  if (signatures.size > 1) {
    pushIssue(
      issues,
      "incompatible-semantics",
      path,
      "Expression combines incompatible measure semantics",
    );
  }
  return {
    measureIds: walked.dependencies,
    signature: signatures.size === 1 ? [...signatures][0]! : null,
  };
}

function validateTolerance(
  value: { absolute?: number; relative?: number } | undefined,
  path: string,
  issues: DiagnosticValidationIssue[],
): void {
  for (const key of ["absolute", "relative"] as const) {
    const component = value?.[key];
    if (component === undefined) continue;
    if (
      !validateFinite(component, `${path}.${key}`, `${key} tolerance`, issues)
    )
      continue;
    if (component < 0) {
      pushIssue(
        issues,
        "invalid-number",
        `${path}.${key}`,
        `${key} tolerance must be nonnegative`,
      );
    }
  }
}

function validateReviewFilter(
  value: unknown,
  path: string,
  axis: DiagnosticPeriodAxis,
  issues: DiagnosticValidationIssue[],
): void {
  if (!isPlainRecord(value)) {
    pushIssue(issues, "invalid-type", path, "Review filter must be an object");
    return;
  }
  const periodCoordinates = new Map<string, number>();
  const validatePeriods = (
    key: "origins" | "valuations",
    side: "origin" | "valuation",
  ) => {
    const raw = value[key];
    if (raw === undefined) return;
    const entries = requireArray(raw, `${path}.${key}`, issues);
    entries.forEach((entry, index) => {
      const entryPath = `${path}.${key}[${index}]`;
      if (!validateToken(entry, entryPath, `${side} period`, issues)) return;
      const normalized = normalizeDiagnosticPeriodWithAxis(axis, side, entry);
      if (!normalized)
        pushIssue(
          issues,
          "invalid-period",
          entryPath,
          `Unknown ${side} period ${JSON.stringify(entry)}`,
        );
    });
  };
  const validateEndpoint = (
    key: "originFrom" | "originThrough" | "valuationFrom" | "valuationThrough",
    side: "origin" | "valuation",
  ) => {
    const raw = value[key];
    if (raw === undefined) return;
    if (!validateToken(raw, `${path}.${key}`, `${side} period`, issues)) return;
    const normalized = normalizeDiagnosticPeriodWithAxis(axis, side, raw);
    if (!normalized)
      pushIssue(
        issues,
        "invalid-period",
        `${path}.${key}`,
        `Unknown ${side} period ${JSON.stringify(raw)}`,
      );
    else periodCoordinates.set(key, normalized.coordinate);
  };
  if (value.sourceGroups !== undefined)
    requireArray(value.sourceGroups, `${path}.sourceGroups`, issues).forEach(
      (item, index) => {
        validateToken(
          item,
          `${path}.sourceGroups[${index}]`,
          "Source group",
          issues,
        );
      },
    );
  validatePeriods("origins", "origin");
  validateEndpoint("originFrom", "origin");
  validateEndpoint("originThrough", "origin");
  validatePeriods("valuations", "valuation");
  validateEndpoint("valuationFrom", "valuation");
  validateEndpoint("valuationThrough", "valuation");
  for (const key of ["minDevelopmentAge", "maxDevelopmentAge"] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (
      !validateFinite(raw, `${path}.${key}`, key, issues) ||
      !Number.isSafeInteger(raw) ||
      raw < 0
    ) {
      pushIssue(
        issues,
        "invalid-number",
        `${path}.${key}`,
        `${key} must be a nonnegative safe integer`,
      );
    }
  }
  if (
    (periodCoordinates.get("originFrom") ?? -Infinity) >
    (periodCoordinates.get("originThrough") ?? Infinity)
  ) {
    pushIssue(
      issues,
      "invalid-input-relationship",
      path,
      "originFrom must not follow originThrough",
    );
  }
  if (
    (periodCoordinates.get("valuationFrom") ?? -Infinity) >
    (periodCoordinates.get("valuationThrough") ?? Infinity)
  ) {
    pushIssue(
      issues,
      "invalid-input-relationship",
      path,
      "valuationFrom must not follow valuationThrough",
    );
  }
  if (
    typeof value.minDevelopmentAge === "number" &&
    typeof value.maxDevelopmentAge === "number" &&
    value.minDevelopmentAge > value.maxDevelopmentAge
  ) {
    pushIssue(
      issues,
      "invalid-input-relationship",
      path,
      "minDevelopmentAge must not exceed maxDevelopmentAge",
    );
  }
}

function measureExpressionBasis(
  expression: DiagnosticMeasureExpression,
  measures: ReadonlyMap<string, DiagnosticMeasureDefinition>,
  amountBases: ReadonlyMap<string, AmountBasisDefinition>,
): AmountBasisDefinition | null {
  const ids = walkDiagnosticExpression(
    expression,
    "measure",
    "$",
    [],
  ).dependencies;
  const found = ids.map((id) => measures.get(id));
  if (
    found.length === 0 ||
    found.some((measure) => measure?.kind !== "amount" || !measure.basisId)
  )
    return null;
  const basisIds = new Set(found.map((measure) => measure!.basisId!));
  return basisIds.size === 1
    ? (amountBases.get([...basisIds][0]!) ?? null)
    : null;
}

interface LayerComponentTrace {
  readonly rawMeasureId: string;
  readonly hasLayer: boolean;
}

function traceLayerComponents(
  measureId: string,
  measures: ReadonlyMap<string, DiagnosticMeasureDefinition>,
  amountBases: ReadonlyMap<string, AmountBasisDefinition>,
  derivations: ReadonlyMap<string, DiagnosticDerivedMeasureDefinition>,
  seen = new Set<string>(),
): ReadonlyMap<string, LayerComponentTrace> | null {
  if (seen.has(measureId)) return null;
  const derivation = derivations.get(measureId);
  if (!derivation) {
    const measure = measures.get(measureId);
    const basis =
      measure?.kind === "amount" && measure.basisId
        ? amountBases.get(measure.basisId)
        : undefined;
    return basis
      ? new Map(
          basis.components.map((component) => [
            component.id,
            { rawMeasureId: measureId, hasLayer: false },
          ]),
        )
      : null;
  }
  const nextSeen = new Set(seen).add(measureId);
  const visit = (
    expression: DiagnosticClaimExpression,
  ): ReadonlyMap<string, LayerComponentTrace> | null => {
    if (expression.op === "measure")
      return traceLayerComponents(
        expression.measureId,
        measures,
        amountBases,
        derivations,
        nextSeen,
      );
    if (expression.op === "claim-layer") {
      const nested = traceLayerComponents(
        expression.measureId,
        measures,
        amountBases,
        derivations,
        nextSeen,
      );
      if (!nested || nested.size !== 1) return null;
      return new Map(
        [...nested].map(([componentId, trace]) => [
          componentId,
          { ...trace, hasLayer: true },
        ]),
      );
    }
    if (expression.op === "subtract") return null;
    const result = new Map<string, LayerComponentTrace>();
    for (const term of expression.terms) {
      const traced = visit(term);
      if (!traced) return null;
      for (const [componentId, trace] of traced) {
        if (result.has(componentId)) return null;
        result.set(componentId, trace);
      }
    }
    return result;
  };
  return visit(derivation.expression);
}

function limitationInterval(limitation: AmountLimitation): {
  readonly attachment: number;
  readonly exhaustion: number;
  readonly application: "claim" | "occurrence" | "policy" | null;
} | null {
  if (limitation.kind === "unlimited")
    return { attachment: 0, exhaustion: Infinity, application: null };
  if (
    limitation.kind !== "layer" ||
    limitation.derivation.kind !== "sdk" ||
    limitation.application === "source-defined"
  )
    return null;
  return {
    attachment: limitation.attachment,
    exhaustion:
      limitation.limit === null
        ? Infinity
        : limitation.attachment + limitation.limit,
    application: limitation.application,
  };
}

function validateLayerComparability(
  rule: Extract<DiagnosticReviewRule, { kind: "layer-order" }>,
  path: string,
  measures: ReadonlyMap<string, DiagnosticMeasureDefinition>,
  amountBases: ReadonlyMap<string, AmountBasisDefinition>,
  derivations: ReadonlyMap<string, DiagnosticDerivedMeasureDefinition>,
  issues: DiagnosticValidationIssue[],
): void {
  const narrowerBasis = measureExpressionBasis(
    rule.narrower,
    measures,
    amountBases,
  );
  const broaderBasis = measureExpressionBasis(
    rule.broader,
    measures,
    amountBases,
  );
  if (
    !narrowerBasis ||
    !broaderBasis ||
    narrowerBasis.currency !== broaderBasis.currency
  ) {
    pushIssue(
      issues,
      "incompatible-semantics",
      path,
      "Layer-order operands must be amounts with the same currency",
    );
    return;
  }
  if (rule.comparability.kind === "caller-asserted") return;
  if (narrowerBasis.perspective !== broaderBasis.perspective) {
    pushIssue(
      issues,
      "incompatible-semantics",
      path,
      "Compiler-proven layer order requires the same amount perspective",
    );
    return;
  }
  const proveMeasures = (
    narrowerMeasureId: string,
    broaderMeasureId: string,
  ): { readonly valid: boolean; readonly hasLayer: boolean } => {
    const narrowerMeasure = measures.get(narrowerMeasureId);
    const broaderMeasure = measures.get(broaderMeasureId);
    const narrowBasis =
      narrowerMeasure?.kind === "amount" && narrowerMeasure.basisId
        ? amountBases.get(narrowerMeasure.basisId)
        : undefined;
    const broadBasis =
      broaderMeasure?.kind === "amount" && broaderMeasure.basisId
        ? amountBases.get(broaderMeasure.basisId)
        : undefined;
    if (
      !narrowBasis ||
      !broadBasis ||
      narrowBasis.currency !== broadBasis.currency ||
      narrowBasis.perspective !== broadBasis.perspective
    )
      return { valid: false, hasLayer: false };
    const narrowComponents = [...narrowBasis.components].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const broadComponents = [...broadBasis.components].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const narrowTraces = traceLayerComponents(
      narrowerMeasureId,
      measures,
      amountBases,
      derivations,
    );
    const broadTraces = traceLayerComponents(
      broaderMeasureId,
      measures,
      amountBases,
      derivations,
    );
    if (
      !narrowTraces ||
      !broadTraces ||
      narrowComponents.length !== broadComponents.length
    )
      return { valid: false, hasLayer: false };
    let hasLayer = false;
    for (let index = 0; index < narrowComponents.length; index++) {
      const narrower = narrowComponents[index]!;
      const broader = broadComponents[index]!;
      const narrowerInterval = limitationInterval(narrower.limitation);
      const broaderInterval = limitationInterval(broader.limitation);
      const narrowerTrace = narrowTraces.get(narrower.id);
      const broaderTrace = broadTraces.get(broader.id);
      if (
        narrower.id !== broader.id ||
        narrower.treatment !== broader.treatment ||
        narrower.treatment === "unknown" ||
        !narrowerInterval ||
        !broaderInterval ||
        !narrowerTrace ||
        !broaderTrace ||
        narrowerTrace.rawMeasureId !== broaderTrace.rawMeasureId ||
        (broaderInterval.application !== null &&
          narrowerInterval.application !== broaderInterval.application) ||
        narrowerInterval.attachment < broaderInterval.attachment ||
        narrowerInterval.exhaustion > broaderInterval.exhaustion
      )
        return { valid: false, hasLayer: false };
      hasLayer ||= narrowerTrace.hasLayer || broaderTrace.hasLayer;
    }
    return { valid: true, hasLayer };
  };
  const proveExpressions = (
    narrower: DiagnosticMeasureExpression,
    broader: DiagnosticMeasureExpression,
  ): { readonly valid: boolean; readonly hasLayer: boolean } => {
    if (narrower.op === "measure" && broader.op === "measure")
      return proveMeasures(narrower.measureId, broader.measureId);
    if (
      narrower.op !== "add" ||
      broader.op !== "add" ||
      narrower.terms.length !== broader.terms.length
    )
      return { valid: false, hasLayer: false };
    const children = narrower.terms.map((term, index) =>
      proveExpressions(term, broader.terms[index]!),
    );
    return {
      valid: children.every((item) => item.valid),
      hasLayer: children.some((item) => item.hasLayer),
    };
  };
  const proof = proveExpressions(rule.narrower, rule.broader);
  if (!proof.valid || !proof.hasLayer) {
    pushIssue(
      issues,
      "incompatible-semantics",
      path,
      "Compiler metadata does not prove that the narrower layer is contained by the broader layer",
    );
  }
}

function validatePeriodAxis(
  axis: DiagnosticPeriodAxis,
  issues: DiagnosticValidationIssue[],
): void {
  if (!isPlainRecord(axis)) {
    pushIssue(
      issues,
      "invalid-type",
      "$.periodAxis",
      "Period axis must be an object",
    );
    return;
  }
  if (
    !validateFinite(
      axis.ageOffset,
      "$.periodAxis.ageOffset",
      "Period age offset",
      issues,
    ) ||
    !Number.isSafeInteger(axis.ageOffset)
  ) {
    pushIssue(
      issues,
      "invalid-number",
      "$.periodAxis.ageOffset",
      "Period age offset must be a safe integer",
    );
  }
  if (axis.kind === "calendar") {
    validateAllowedKeys(
      axis,
      [
        "kind",
        "originCadence",
        "valuationCadence",
        "originAnchor",
        "valuationAnchor",
        "ageUnit",
        "ageOffset",
      ],
      "$.periodAxis",
      issues,
    );
    if (!["month", "quarter", "year"].includes(axis.originCadence)) {
      pushIssue(
        issues,
        "invalid-period",
        "$.periodAxis.originCadence",
        "Unknown origin cadence",
      );
    }
    if (!["month", "quarter", "year"].includes(axis.valuationCadence)) {
      pushIssue(
        issues,
        "invalid-period",
        "$.periodAxis.valuationCadence",
        "Unknown valuation cadence",
      );
    }
    if (axis.originAnchor !== "start" && axis.originAnchor !== "end") {
      pushIssue(
        issues,
        "invalid-period",
        "$.periodAxis.originAnchor",
        "Unknown origin anchor",
      );
    }
    if (axis.valuationAnchor !== "start" && axis.valuationAnchor !== "end") {
      pushIssue(
        issues,
        "invalid-period",
        "$.periodAxis.valuationAnchor",
        "Unknown valuation anchor",
      );
    }
    if (axis.ageUnit !== "month") {
      pushIssue(
        issues,
        "invalid-period",
        "$.periodAxis.ageUnit",
        "Calendar axes use month age units",
      );
    }
    return;
  }
  validateAllowedKeys(
    axis,
    ["kind", "id", "version", "ageUnit", "ageOffset", "origins", "valuations"],
    "$.periodAxis",
    issues,
  );
  if (axis.kind !== "ordered") {
    pushIssue(
      issues,
      "invalid-period",
      "$.periodAxis.kind",
      "Unknown period-axis kind",
    );
    return;
  }
  validateToken(axis.id, "$.periodAxis.id", "Ordered-axis ID", issues);
  validateToken(
    axis.version,
    "$.periodAxis.version",
    "Ordered-axis version",
    issues,
  );
  validateToken(
    axis.ageUnit,
    "$.periodAxis.ageUnit",
    "Ordered-axis age unit",
    issues,
  );
  for (const side of ["origins", "valuations"] as const) {
    const coordinates = requireArray(
      axis[side],
      `$.periodAxis.${side}`,
      issues,
    ) as readonly DiagnosticPeriodCoordinate[];
    const names = new Set<string>();
    const coordinateValues = new Set<number>();
    coordinates.forEach((coordinate, index) => {
      const base = `$.periodAxis.${side}[${index}]`;
      if (!isPlainRecord(coordinate)) {
        pushIssue(
          issues,
          "invalid-type",
          base,
          "Period coordinate must be an object",
        );
        return;
      }
      validateAllowedKeys(
        coordinate,
        ["label", "aliases", "coordinate"],
        base,
        issues,
      );
      if (
        validateToken(
          coordinate?.label,
          `${base}.label`,
          "Period label",
          issues,
        )
      ) {
        if (names.has(coordinate.label))
          pushIssue(
            issues,
            "duplicate-id",
            `${base}.label`,
            `Duplicate period label or alias ${coordinate.label}`,
          );
        names.add(coordinate.label);
      }
      if (
        !validateFinite(
          coordinate?.coordinate,
          `${base}.coordinate`,
          "Period coordinate",
          issues,
        ) ||
        !Number.isSafeInteger(coordinate.coordinate)
      ) {
        pushIssue(
          issues,
          "invalid-number",
          `${base}.coordinate`,
          "Period coordinate must be a safe integer",
        );
      } else if (coordinateValues.has(coordinate.coordinate)) {
        pushIssue(
          issues,
          "duplicate-id",
          `${base}.coordinate`,
          `Duplicate period coordinate ${coordinate.coordinate}`,
        );
      } else coordinateValues.add(coordinate.coordinate);
      const aliases =
        coordinate.aliases === undefined
          ? []
          : requireArray(coordinate.aliases, `${base}.aliases`, issues);
      for (const [aliasIndex, alias] of aliases.entries()) {
        if (
          !validateToken(
            alias,
            `${base}.aliases[${aliasIndex}]`,
            "Period alias",
            issues,
          )
        )
          continue;
        if (names.has(alias))
          pushIssue(
            issues,
            "duplicate-id",
            `${base}.aliases[${aliasIndex}]`,
            `Duplicate period label or alias ${alias}`,
          );
        names.add(alias);
      }
    });
  }
}

function validateDefinition(value: unknown): DiagnosticDefinition {
  const issues: DiagnosticValidationIssue[] = [];
  validateJsonValue(value, issues);
  if (!isPlainRecord(value)) {
    pushIssue(
      issues,
      "invalid-type",
      "$",
      "Diagnostic definition must be a plain object",
    );
    throw new DiagnosticValidationError(issues);
  }
  const definition = value as unknown as DiagnosticDefinition;
  validateAllowedKeys(
    value,
    [
      "diagnosticDefinitionVersion",
      "id",
      "version",
      "lossRowGrain",
      "measures",
      "countPopulations",
      "exposureBases",
      "amountBases",
      "derivedMeasures",
      "formulas",
      "instances",
      "reviewRules",
      "periodAxis",
    ],
    "$",
    issues,
  );
  if (definition.diagnosticDefinitionVersion !== "1.0.0") {
    pushIssue(
      issues,
      "invalid-type",
      "$.diagnosticDefinitionVersion",
      "Diagnostic definition version must be 1.0.0",
    );
  }
  validateToken(definition.id, "$.id", "Definition ID", issues);
  validateToken(definition.version, "$.version", "Definition version", issues);
  if (
    definition.lossRowGrain !== "claim" &&
    definition.lossRowGrain !== "aggregate"
  ) {
    pushIssue(
      issues,
      "invalid-type",
      "$.lossRowGrain",
      "Loss row grain must be claim or aggregate",
    );
  }

  const measures = requireArray(
    definition.measures,
    "$.measures",
    issues,
  ) as readonly DiagnosticMeasureDefinition[];
  const populations = requireArray(
    definition.countPopulations,
    "$.countPopulations",
    issues,
  ) as readonly DiagnosticCountPopulationDefinition[];
  const exposureBases = requireArray(
    definition.exposureBases,
    "$.exposureBases",
    issues,
  ) as readonly DiagnosticExposureBasisDefinition[];
  const amountBases = requireArray(
    definition.amountBases,
    "$.amountBases",
    issues,
  ) as readonly AmountBasisDefinition[];
  const derivations = requireArray(
    definition.derivedMeasures,
    "$.derivedMeasures",
    issues,
  ) as readonly DiagnosticDerivedMeasureDefinition[];
  const formulas = requireArray(
    definition.formulas,
    "$.formulas",
    issues,
  ) as readonly DiagnosticFormulaTemplate[];
  const instances = requireArray(
    definition.instances,
    "$.instances",
    issues,
  ) as readonly DiagnosticMetricInstance[];
  const reviewRules = requireArray(
    definition.reviewRules,
    "$.reviewRules",
    issues,
  ) as readonly DiagnosticReviewRule[];

  const measureMap = collectCatalog(measures, "$.measures", issues);
  const populationMap = collectCatalog(
    populations,
    "$.countPopulations",
    issues,
  );
  const exposureBasisMap = collectCatalog(
    exposureBases,
    "$.exposureBases",
    issues,
  );
  const amountBasisMap = collectCatalog(amountBases, "$.amountBases", issues);
  collectCatalog(derivations, "$.derivedMeasures", issues);
  const derivationsByOutput = new Map<
    string,
    DiagnosticDerivedMeasureDefinition
  >();
  for (const derivation of derivations) {
    if (
      isPlainRecord(derivation) &&
      typeof derivation.outputMeasureId === "string" &&
      !derivationsByOutput.has(derivation.outputMeasureId)
    ) {
      derivationsByOutput.set(derivation.outputMeasureId, derivation);
    }
  }
  const formulaMap = collectCatalog(formulas, "$.formulas", issues);
  collectCatalog(instances, "$.instances", issues);
  const reviewRuleMap = collectCatalog(reviewRules, "$.reviewRules", issues);

  populations.forEach((population, index) => {
    const base = `$.countPopulations[${index}]`;
    if (!isPlainRecord(population)) {
      pushIssue(
        issues,
        "invalid-type",
        base,
        "Count population must be an object",
      );
      return;
    }
    validateAllowedKeys(
      population,
      ["id", "displayName", "subject", "unit", "description", "attributes"],
      base,
      issues,
    );
    validateToken(
      population.displayName,
      `${base}.displayName`,
      "Population display name",
      issues,
    );
    validateToken(
      population.description,
      `${base}.description`,
      "Population description",
      issues,
    );
    validateToken(population.unit, `${base}.unit`, "Population unit", issues);
    if (
      ![
        "claim",
        "claimant",
        "policy",
        "occurrence",
        "other",
        "unknown",
      ].includes(population.subject)
    ) {
      pushIssue(
        issues,
        "invalid-type",
        `${base}.subject`,
        "Unknown count-population subject",
      );
    }
    validateScalarAttributes(
      population.attributes,
      `${base}.attributes`,
      issues,
    );
  });

  exposureBases.forEach((basis, index) => {
    const base = `$.exposureBases[${index}]`;
    if (!isPlainRecord(basis)) {
      pushIssue(
        issues,
        "invalid-type",
        base,
        "Exposure basis must be an object",
      );
      return;
    }
    validateAllowedKeys(
      basis,
      [
        "id",
        "displayName",
        "basis",
        "unit",
        "description",
        "sourceDescription",
        "attributes",
      ],
      base,
      issues,
    );
    validateToken(
      basis.displayName,
      `${base}.displayName`,
      "Exposure-basis display name",
      issues,
    );
    validateToken(
      basis.description,
      `${base}.description`,
      "Exposure-basis description",
      issues,
    );
    validateToken(basis.unit, `${base}.unit`, "Exposure-basis unit", issues);
    if (basis.sourceDescription !== undefined)
      validateToken(
        basis.sourceDescription,
        `${base}.sourceDescription`,
        "Exposure source description",
        issues,
      );
    if (
      !["earned", "written", "in-force", "other", "unknown"].includes(
        basis.basis,
      )
    ) {
      pushIssue(
        issues,
        "invalid-type",
        `${base}.basis`,
        "Unknown exposure basis",
      );
    }
    validateScalarAttributes(basis.attributes, `${base}.attributes`, issues);
  });

  amountBases.forEach((basis, index) => {
    const base = `$.amountBases[${index}]`;
    if (!isPlainRecord(basis)) {
      pushIssue(issues, "invalid-type", base, "Amount basis must be an object");
      return;
    }
    validateAllowedKeys(
      basis,
      [
        "id",
        "displayName",
        "currency",
        "perspective",
        "components",
        "sourceDescription",
        "attributes",
      ],
      base,
      issues,
    );
    validateToken(
      basis.displayName,
      `${base}.displayName`,
      "Amount-basis display name",
      issues,
    );
    validateToken(
      basis.currency,
      `${base}.currency`,
      "Amount-basis currency",
      issues,
    );
    if (basis.sourceDescription !== undefined)
      validateToken(
        basis.sourceDescription,
        `${base}.sourceDescription`,
        "Amount source description",
        issues,
      );
    if (
      !["gross", "net", "ceded", "other", "unknown"].includes(basis.perspective)
    ) {
      pushIssue(
        issues,
        "invalid-type",
        `${base}.perspective`,
        "Unknown amount perspective",
      );
    }
    validateScalarAttributes(basis.attributes, `${base}.attributes`, issues);
    const components = requireArray(
      basis.components,
      `${base}.components`,
      issues,
    ) as readonly AmountBasisComponent[];
    if (components.length === 0)
      pushIssue(
        issues,
        "missing-required",
        `${base}.components`,
        "Amount basis requires at least one component",
      );
    const componentIds = collectCatalog(
      components,
      `${base}.components`,
      issues,
    );
    if (
      componentIds.size > 0 &&
      components.every((component) => component.treatment === "excluded")
    ) {
      pushIssue(
        issues,
        "incompatible-semantics",
        `${base}.components`,
        "Amount basis cannot exclude every component",
      );
    }
    components.forEach((component, componentIndex) => {
      const componentBase = `${base}.components[${componentIndex}]`;
      if (!isPlainRecord(component)) {
        pushIssue(
          issues,
          "invalid-type",
          componentBase,
          "Amount-basis component must be an object",
        );
        return;
      }
      validateAllowedKeys(
        component,
        ["id", "treatment", "limitation"],
        componentBase,
        issues,
      );
      if (!["included", "excluded", "unknown"].includes(component.treatment)) {
        pushIssue(
          issues,
          "invalid-type",
          `${componentBase}.treatment`,
          "Unknown component treatment",
        );
      }
      const limitation = component.limitation;
      if (!isPlainRecord(limitation)) {
        pushIssue(
          issues,
          "invalid-type",
          `${componentBase}.limitation`,
          "Amount limitation must be an object",
        );
        return;
      }
      if (limitation.kind === "unknown") {
        validateAllowedKeys(
          limitation,
          ["kind", "description"],
          `${componentBase}.limitation`,
          issues,
        );
        if (limitation.description !== undefined)
          validateToken(
            limitation.description,
            `${componentBase}.limitation.description`,
            "Unknown limitation description",
            issues,
          );
      } else if (
        limitation.kind === "layer" ||
        limitation.kind === "pre-limited"
      ) {
        validateAllowedKeys(
          limitation,
          ["kind", "attachment", "limit", "application", "derivation"],
          `${componentBase}.limitation`,
          issues,
        );
        if (
          !["claim", "occurrence", "policy", "source-defined"].includes(
            limitation.application,
          )
        ) {
          pushIssue(
            issues,
            "invalid-type",
            `${componentBase}.limitation.application`,
            "Unknown limitation application",
          );
        }
        if (
          validateFinite(
            limitation.attachment,
            `${componentBase}.limitation.attachment`,
            "Attachment",
            issues,
          ) &&
          limitation.attachment < 0
        ) {
          pushIssue(
            issues,
            "invalid-number",
            `${componentBase}.limitation.attachment`,
            "Attachment must be nonnegative",
          );
        }
        if (limitation.limit !== null) {
          if (
            validateFinite(
              limitation.limit,
              `${componentBase}.limitation.limit`,
              "Layer width",
              issues,
            ) &&
            limitation.limit <= 0
          ) {
            pushIssue(
              issues,
              "invalid-number",
              `${componentBase}.limitation.limit`,
              "Layer width must be positive",
            );
          }
          if (
            Number.isFinite(limitation.attachment) &&
            Number.isFinite(limitation.limit) &&
            !Number.isFinite(limitation.attachment + limitation.limit)
          ) {
            pushIssue(
              issues,
              "invalid-number",
              `${componentBase}.limitation.limit`,
              "Attachment plus layer width must be finite",
            );
          }
        }
        if (limitation.derivation?.kind === "sdk") {
          if (isPlainRecord(limitation.derivation))
            validateAllowedKeys(
              limitation.derivation,
              ["kind"],
              `${componentBase}.limitation.derivation`,
              issues,
            );
          if (
            limitation.kind !== "layer" ||
            limitation.application !== "claim"
          ) {
            pushIssue(
              issues,
              "incompatible-semantics",
              `${componentBase}.limitation.derivation`,
              "SDK limitations require a claim layer",
            );
          }
        } else if (limitation.derivation?.kind === "external") {
          if (isPlainRecord(limitation.derivation))
            validateAllowedKeys(
              limitation.derivation,
              ["kind", "actor", "transformationRef"],
              `${componentBase}.limitation.derivation`,
              issues,
            );
          if (
            limitation.derivation.actor !== "caller" &&
            limitation.derivation.actor !== "source"
          ) {
            pushIssue(
              issues,
              "invalid-type",
              `${componentBase}.limitation.derivation.actor`,
              "External derivation actor must be caller or source",
            );
          }
          validateToken(
            limitation.derivation.transformationRef,
            `${componentBase}.limitation.derivation.transformationRef`,
            "Transformation reference",
            issues,
          );
        } else {
          pushIssue(
            issues,
            "invalid-type",
            `${componentBase}.limitation.derivation`,
            "Limited basis requires a derivation record",
          );
        }
      } else if (limitation.kind !== "unlimited") {
        pushIssue(
          issues,
          "invalid-type",
          `${componentBase}.limitation.kind`,
          "Unknown amount limitation kind",
        );
      } else
        validateAllowedKeys(
          limitation,
          ["kind"],
          `${componentBase}.limitation`,
          issues,
        );
    });
  });

  measures.forEach((measure, index) => {
    const base = `$.measures[${index}]`;
    if (!isPlainRecord(measure)) {
      pushIssue(issues, "invalid-type", base, "Measure must be an object");
      return;
    }
    validateAllowedKeys(
      measure,
      [
        "id",
        "displayName",
        "description",
        "source",
        "kind",
        "unit",
        "developmentSemantics",
        "aggregation",
        "missing",
        "basisId",
        "countPopulationId",
        "exposureBasisId",
        "exposureTiming",
      ],
      base,
      issues,
    );
    validateToken(
      measure.displayName,
      `${base}.displayName`,
      "Measure display name",
      issues,
    );
    validateToken(
      measure.description,
      `${base}.description`,
      "Measure description",
      issues,
    );
    validateToken(measure.unit, `${base}.unit`, "Measure unit", issues);
    if (measure.aggregation !== "sum")
      pushIssue(
        issues,
        "incompatible-semantics",
        `${base}.aggregation`,
        "Only sum aggregation is supported",
      );
    if (measure.missing !== "unknown" && measure.missing !== "zero")
      pushIssue(
        issues,
        "invalid-type",
        `${base}.missing`,
        "Unknown missing-value policy",
      );
    if (
      !["cumulative", "incremental", "point-in-time", "unknown"].includes(
        measure.developmentSemantics,
      )
    ) {
      pushIssue(
        issues,
        "invalid-type",
        `${base}.developmentSemantics`,
        "Unknown development semantics",
      );
    }
    if (measure.kind === "amount") {
      const basis = measure.basisId
        ? amountBasisMap.get(measure.basisId)
        : undefined;
      if (!basis)
        pushIssue(
          issues,
          "unknown-reference",
          `${base}.basisId`,
          "Amount measure requires an existing amount basis",
        );
      else if (measure.unit !== basis.currency)
        pushIssue(
          issues,
          "incompatible-semantics",
          `${base}.unit`,
          "Amount measure unit must equal basis currency",
        );
      if (
        measure.countPopulationId !== undefined ||
        measure.exposureBasisId !== undefined ||
        measure.exposureTiming !== undefined
      ) {
        pushIssue(
          issues,
          "incompatible-semantics",
          base,
          "Amount measure has inapplicable population or exposure semantics",
        );
      }
    } else if (measure.kind === "count") {
      const population = measure.countPopulationId
        ? populationMap.get(measure.countPopulationId)
        : undefined;
      if (!population)
        pushIssue(
          issues,
          "unknown-reference",
          `${base}.countPopulationId`,
          "Count measure requires an existing count population",
        );
      else if (measure.unit !== population.unit)
        pushIssue(
          issues,
          "incompatible-semantics",
          `${base}.unit`,
          "Count measure unit must equal population unit",
        );
      if (
        measure.basisId !== undefined ||
        measure.exposureBasisId !== undefined ||
        measure.exposureTiming !== undefined
      ) {
        pushIssue(
          issues,
          "incompatible-semantics",
          base,
          "Count measure has inapplicable amount or exposure semantics",
        );
      }
    } else if (measure.kind === "exposure") {
      const basis = measure.exposureBasisId
        ? exposureBasisMap.get(measure.exposureBasisId)
        : undefined;
      if (!basis)
        pushIssue(
          issues,
          "unknown-reference",
          `${base}.exposureBasisId`,
          "Exposure measure requires an existing exposure basis",
        );
      else if (measure.unit !== basis.unit)
        pushIssue(
          issues,
          "incompatible-semantics",
          `${base}.unit`,
          "Exposure measure unit must equal exposure-basis unit",
        );
      if (measure.source !== "exposure")
        pushIssue(
          issues,
          "incompatible-semantics",
          `${base}.source`,
          "Exposure measure source must be exposure",
        );
      if (
        measure.exposureTiming !== "origin-static" &&
        measure.exposureTiming !== "valuation-specific"
      ) {
        pushIssue(
          issues,
          "missing-required",
          `${base}.exposureTiming`,
          "Exposure measure requires timing",
        );
      }
      if (measure.missing !== "unknown")
        pushIssue(
          issues,
          "incompatible-semantics",
          `${base}.missing`,
          "Exposure missingness must remain unknown",
        );
      if (
        measure.basisId !== undefined ||
        measure.countPopulationId !== undefined
      ) {
        pushIssue(
          issues,
          "incompatible-semantics",
          base,
          "Exposure measure has inapplicable amount or population semantics",
        );
      }
    } else {
      pushIssue(issues, "invalid-type", `${base}.kind`, "Unknown measure kind");
    }
    if (
      measure.kind !== "exposure" &&
      measure.source !== "loss" &&
      measure.source !== "derived"
    ) {
      pushIssue(
        issues,
        "invalid-type",
        `${base}.source`,
        "Non-exposure measure source must be loss or derived",
      );
    }
    if (measure.kind !== "exposure" && measure.source === "exposure") {
      pushIssue(
        issues,
        "incompatible-semantics",
        `${base}.source`,
        "Only exposure measures may use exposure source",
      );
    }
    if (measure.kind === "amount" && measure.basisId) {
      const basis = amountBasisMap.get(measure.basisId);
      const hasSdkLimitation =
        basis?.components.some(
          (component) =>
            (component.limitation.kind === "layer" ||
              component.limitation.kind === "pre-limited") &&
            component.limitation.derivation.kind === "sdk",
        ) ?? false;
      if (hasSdkLimitation && measure.source !== "derived") {
        pushIssue(
          issues,
          "incompatible-semantics",
          `${base}.source`,
          "SDK-limited amount measures must be derived",
        );
      }
    }
  });

  let definitionExpressionNodes = 0;
  const formulaRoleUsage = new Map<string, readonly string[]>();
  formulas.forEach((formula, index) => {
    const base = `$.formulas[${index}]`;
    if (!isPlainRecord(formula)) {
      pushIssue(issues, "invalid-type", base, "Formula must be an object");
      return;
    }
    validateAllowedKeys(
      formula,
      [
        "id",
        "version",
        "roles",
        "numerator",
        "denominator",
        "denominatorPolicy",
      ],
      base,
      issues,
    );
    validateToken(
      formula.version,
      `${base}.version`,
      "Formula version",
      issues,
    );
    if (formula.denominatorPolicy !== "positive-or-null") {
      pushIssue(
        issues,
        "incompatible-semantics",
        `${base}.denominatorPolicy`,
        "Unknown denominator policy",
      );
    }
    if (!isPlainRecord(formula.roles)) {
      pushIssue(
        issues,
        "invalid-type",
        `${base}.roles`,
        "Formula roles must be an object",
      );
      return;
    }
    for (const [roleName, role] of Object.entries(formula.roles)) {
      validateToken(
        roleName,
        propertyPath(`${base}.roles`, roleName),
        "Formula role",
        issues,
      );
      if (
        !isPlainRecord(role) ||
        !["count", "amount", "exposure"].includes(role.kind)
      ) {
        pushIssue(
          issues,
          "invalid-type",
          propertyPath(`${base}.roles`, roleName),
          "Formula role has an invalid kind",
        );
      } else {
        const rolePath = propertyPath(`${base}.roles`, roleName);
        validateAllowedKeys(
          role,
          ["kind", "compatibilityGroup", "developmentSemantics"],
          rolePath,
          issues,
        );
        if (
          role.developmentSemantics !== undefined &&
          !["cumulative", "incremental", "point-in-time", "unknown"].includes(
            role.developmentSemantics as string,
          )
        ) {
          pushIssue(
            issues,
            "invalid-type",
            `${rolePath}.developmentSemantics`,
            "Unknown formula-role development semantics",
          );
        }
      }
      if (role.compatibilityGroup !== undefined)
        validateToken(
          role.compatibilityGroup,
          `${propertyPath(`${base}.roles`, roleName)}.compatibilityGroup`,
          "Compatibility group",
          issues,
        );
    }
    const numerator = walkDiagnosticExpression(
      formula.numerator,
      "role",
      `${base}.numerator`,
      issues,
    );
    const denominator = walkDiagnosticExpression(
      formula.denominator,
      "role",
      `${base}.denominator`,
      issues,
    );
    definitionExpressionNodes += numerator.nodeCount + denominator.nodeCount;
    const used = [
      ...new Set([...numerator.dependencies, ...denominator.dependencies]),
    ].sort();
    formulaRoleUsage.set(formula.id, used);
    for (const role of used) {
      if (!hasDiagnosticOwn(formula.roles, role)) {
        pushIssue(
          issues,
          "unknown-reference",
          base,
          `Formula ${formula.id} references unknown role ${role}`,
        );
      }
    }
    for (const role of Object.keys(formula.roles)) {
      if (!used.includes(role))
        pushIssue(
          issues,
          "incompatible-semantics",
          propertyPath(`${base}.roles`, role),
          `Formula role ${role} is unused`,
        );
    }
    for (const [side, walked] of [
      ["numerator", numerator],
      ["denominator", denominator],
    ] as const) {
      const kinds = new Set(
        walked.dependencies
          .map((role) => formula.roles[role]?.kind)
          .filter(Boolean),
      );
      if (kinds.size > 1)
        pushIssue(
          issues,
          "incompatible-semantics",
          `${base}.${side}`,
          "Formula arithmetic combines different role kinds",
        );
    }
  });

  const instanceRuleIds = new Set<string>();
  instances.forEach((instance, index) => {
    const base = `$.instances[${index}]`;
    if (!isPlainRecord(instance)) {
      pushIssue(
        issues,
        "invalid-type",
        base,
        "Metric instance must be an object",
      );
      return;
    }
    validateAllowedKeys(
      instance,
      ["id", "version", "formulaId", "bindings", "presentation", "rules"],
      base,
      issues,
    );
    validateToken(
      instance.version,
      `${base}.version`,
      "Instance version",
      issues,
    );
    validateToken(
      instance.formulaId,
      `${base}.formulaId`,
      "Formula reference",
      issues,
    );
    const formula = formulaMap.get(instance.formulaId);
    if (!formula) {
      pushIssue(
        issues,
        "unknown-reference",
        `${base}.formulaId`,
        `Unknown formula ${instance.formulaId}`,
      );
      return;
    }
    if (!isPlainRecord(instance.bindings)) {
      pushIssue(
        issues,
        "invalid-type",
        `${base}.bindings`,
        "Instance bindings must be an object",
      );
      return;
    }
    const usedRoles = formulaRoleUsage.get(formula.id) ?? [];
    const bindingSemantics = new Map<
      string,
      ReturnType<typeof expressionSemantics>
    >();
    for (const roleName of usedRoles) {
      if (!hasDiagnosticOwn(instance.bindings, roleName)) {
        pushIssue(
          issues,
          "missing-required",
          propertyPath(`${base}.bindings`, roleName),
          `Missing binding for role ${roleName}`,
        );
        continue;
      }
      const expression = instance.bindings[roleName]!;
      const semantics = expressionSemantics(
        expression,
        propertyPath(`${base}.bindings`, roleName),
        measureMap,
        issues,
      );
      bindingSemantics.set(roleName, semantics);
      definitionExpressionNodes += walkDiagnosticExpression(
        expression,
        "measure",
        propertyPath(`${base}.bindings`, roleName),
        [],
      ).nodeCount;
      const role = formula.roles[roleName]!;
      const boundMeasures = semantics.measureIds
        .map((id) => measureMap.get(id))
        .filter(
          (item): item is DiagnosticMeasureDefinition => item !== undefined,
        );
      if (boundMeasures.some((measure) => measure.kind !== role.kind)) {
        pushIssue(
          issues,
          "incompatible-semantics",
          propertyPath(`${base}.bindings`, roleName),
          `Binding kind does not match role ${roleName}`,
        );
      }
      if (role.developmentSemantics !== undefined) {
        const leaves = transitiveMeasureIds(
          semantics.measureIds,
          derivationsByOutput,
        )
          .map((id) => measureMap.get(id))
          .filter(
            (measure): measure is DiagnosticMeasureDefinition =>
              measure !== undefined,
          );
        if (
          leaves.some(
            (measure) =>
              measure.developmentSemantics !== role.developmentSemantics,
          )
        ) {
          pushIssue(
            issues,
            "incompatible-semantics",
            propertyPath(`${base}.bindings`, roleName),
            `Transitive binding development semantics do not match role ${roleName}`,
          );
        }
      }
    }
    const calculationSignatures = new Map<
      "numerator" | "denominator",
      string | null
    >();
    for (const [side, roleExpression] of [
      ["numerator", formula.numerator],
      ["denominator", formula.denominator],
    ] as const) {
      const roleIds = walkDiagnosticExpression(
        roleExpression,
        "role",
        `${base}.${side}`,
        [],
      ).dependencies;
      const signatures = new Set(
        roleIds
          .map((roleId) => bindingSemantics.get(roleId)?.signature)
          .filter(
            (signature): signature is string =>
              signature !== null && signature !== undefined,
          ),
      );
      calculationSignatures.set(
        side,
        signatures.size === 1 ? [...signatures][0]! : null,
      );
      if (signatures.size > 1) {
        pushIssue(
          issues,
          "incompatible-semantics",
          `${base}.bindings`,
          `Bound ${side} arithmetic combines incompatible semantics`,
        );
      }
    }
    for (const binding of Object.keys(instance.bindings)) {
      if (!usedRoles.includes(binding)) {
        pushIssue(
          issues,
          "unknown-reference",
          propertyPath(`${base}.bindings`, binding),
          `Unexpected binding for role ${binding}`,
        );
      }
    }
    const compatibility = new Map<string, string>();
    for (const roleName of usedRoles) {
      const role = formula.roles[roleName]!;
      const binding = instance.bindings[roleName];
      if (!role.compatibilityGroup || !binding) continue;
      const semantics = expressionSemantics(
        binding,
        propertyPath(`${base}.bindings`, roleName),
        measureMap,
        [],
      );
      if (semantics.signature === null) continue;
      const previous = compatibility.get(role.compatibilityGroup);
      if (previous !== undefined && previous !== semantics.signature) {
        pushIssue(
          issues,
          "incompatible-semantics",
          propertyPath(`${base}.bindings`, roleName),
          `Compatibility group ${role.compatibilityGroup} binds different semantics`,
        );
      } else compatibility.set(role.compatibilityGroup, semantics.signature);
    }
    if (!isPlainRecord(instance.presentation)) {
      pushIssue(
        issues,
        "invalid-type",
        `${base}.presentation`,
        "Metric presentation must be an object",
      );
    } else
      validateAllowedKeys(
        instance.presentation,
        [
          "displayName",
          "description",
          "displayUnit",
          "scale",
          "numeratorLabel",
          "denominatorLabel",
        ],
        `${base}.presentation`,
        issues,
      );
    for (const [key, text] of [
      ["displayName", instance.presentation?.displayName],
      ["description", instance.presentation?.description],
      ["displayUnit", instance.presentation?.displayUnit],
      ["numeratorLabel", instance.presentation?.numeratorLabel],
      ["denominatorLabel", instance.presentation?.denominatorLabel],
    ] as const)
      validateToken(
        text,
        `${base}.presentation.${key}`,
        `Presentation ${key}`,
        issues,
      );
    if (
      !validateFinite(
        instance.presentation?.scale,
        `${base}.presentation.scale`,
        "Presentation scale",
        issues,
      ) ||
      instance.presentation.scale <= 0
    ) {
      pushIssue(
        issues,
        "invalid-number",
        `${base}.presentation.scale`,
        "Presentation scale must be positive",
      );
    }
    requireArray(instance.rules, `${base}.rules`, issues).forEach(
      (rawRule, ruleIndex) => {
        const ruleBase = `${base}.rules[${ruleIndex}]`;
        if (!isPlainRecord(rawRule)) {
          pushIssue(
            issues,
            "invalid-type",
            ruleBase,
            "Metric rule must be an object",
          );
          return;
        }
        const rule = rawRule as unknown as DiagnosticComparisonRule;
        validateAllowedKeys(
          rawRule,
          ["id", "code", "message", "severity", "when"],
          ruleBase,
          issues,
        );
        if (
          validateToken(rule.id, `${ruleBase}.id`, "Metric rule ID", issues)
        ) {
          if (rule.id.startsWith("diagnostic/structural/"))
            pushIssue(
              issues,
              "incompatible-semantics",
              `${ruleBase}.id`,
              "Metric rule ID uses the reserved structural prefix",
            );
          if (instanceRuleIds.has(rule.id) || reviewRuleMap.has(rule.id))
            pushIssue(
              issues,
              "duplicate-id",
              `${ruleBase}.id`,
              `Duplicate rule ID ${rule.id}`,
            );
          instanceRuleIds.add(rule.id);
        }
        validateToken(
          rule.code,
          `${ruleBase}.code`,
          "Metric rule code",
          issues,
        );
        validateToken(
          rule.message,
          `${ruleBase}.message`,
          "Metric rule message",
          issues,
        );
        if (rule.severity !== "warning" && rule.severity !== "fail")
          pushIssue(
            issues,
            "invalid-type",
            `${ruleBase}.severity`,
            "Metric rule severity must be warning or fail",
          );
        if (!isPlainRecord(rule.when)) {
          pushIssue(
            issues,
            "invalid-type",
            `${ruleBase}.when`,
            "Metric rule predicate must be an object",
          );
          return;
        }
        validateAllowedKeys(
          rule.when,
          ["left", "operator", "right", "tolerance"],
          `${ruleBase}.when`,
          issues,
        );
        if (rule.when.tolerance !== undefined) {
          if (!isPlainRecord(rule.when.tolerance))
            pushIssue(
              issues,
              "invalid-type",
              `${ruleBase}.when.tolerance`,
              "Tolerance must be an object",
            );
          else
            validateAllowedKeys(
              rule.when.tolerance,
              ["absolute", "relative"],
              `${ruleBase}.when.tolerance`,
              issues,
            );
        }
        if (
          !["lt", "lte", "eq", "neq", "gte", "gt"].includes(rule.when.operator)
        )
          pushIssue(
            issues,
            "invalid-type",
            `${ruleBase}.when.operator`,
            "Unknown metric comparison operator",
          );
        validateTolerance(
          rule.when?.tolerance,
          `${ruleBase}.when.tolerance`,
          issues,
        );
        const operandSignatures = new Map<
          "left" | "right",
          string | null | undefined
        >();
        for (const [side, operand] of [
          ["left", rule.when?.left],
          ["right", rule.when?.right],
        ] as const) {
          const operandPath = `${ruleBase}.when.${side}`;
          if (isPlainRecord(operand)) {
            const allowed =
              operand.source === "measure"
                ? ["source", "expression"]
                : operand.source === "calculation"
                  ? ["source", "field"]
                  : operand.source === "constant"
                    ? ["source", "value"]
                    : ["source"];
            validateAllowedKeys(operand, allowed, operandPath, issues);
          }
          if (operand?.source === "measure") {
            const semantic = expressionSemantics(
              operand.expression,
              `${operandPath}.expression`,
              measureMap,
              issues,
            );
            const operandNodes =
              1 +
              walkDiagnosticExpression(
                operand.expression,
                "measure",
                `${operandPath}.expression`,
                [],
              ).nodeCount;
            definitionExpressionNodes += operandNodes;
            if (operandNodes > MAX_DIAGNOSTIC_EXPRESSION_NODES) {
              pushIssue(
                issues,
                "expression-limit",
                operandPath,
                `Metric rule operand node count exceeds ${MAX_DIAGNOSTIC_EXPRESSION_NODES}`,
              );
            }
            operandSignatures.set(side, semantic.signature);
          } else if (operand?.source === "calculation") {
            definitionExpressionNodes += 1;
            if (
              operand.field !== "numerator" &&
              operand.field !== "denominator"
            )
              pushIssue(
                issues,
                "invalid-type",
                `${operandPath}.field`,
                "Unknown calculation field",
              );
            else
              operandSignatures.set(
                side,
                calculationSignatures.get(operand.field),
              );
          } else if (operand?.source === "constant") {
            definitionExpressionNodes += 1;
            operandSignatures.set(side, undefined);
            validateFinite(
              operand.value,
              `${operandPath}.value`,
              "Rule constant",
              issues,
            );
          } else
            pushIssue(
              issues,
              "invalid-type",
              operandPath,
              "Unknown metric rule operand",
            );
        }
        const leftSignature = operandSignatures.get("left");
        const rightSignature = operandSignatures.get("right");
        if (
          leftSignature !== undefined &&
          rightSignature !== undefined &&
          leftSignature !== null &&
          rightSignature !== null &&
          leftSignature !== rightSignature
        ) {
          pushIssue(
            issues,
            "incompatible-semantics",
            `${ruleBase}.when`,
            "Metric comparison operands must have identical quantity semantics",
          );
        }
      },
    );
  });

  const derivedOutputs = new Map<string, DiagnosticDerivedMeasureDefinition>();
  derivations.forEach((derivation, index) => {
    const base = `$.derivedMeasures[${index}]`;
    if (!isPlainRecord(derivation)) {
      pushIssue(
        issues,
        "invalid-type",
        base,
        "Derived measure must be an object",
      );
      return;
    }
    validateAllowedKeys(
      derivation,
      ["id", "outputMeasureId", "expression"],
      base,
      issues,
    );
    validateToken(
      derivation.outputMeasureId,
      `${base}.outputMeasureId`,
      "Derived output measure",
      issues,
    );
    const output = measureMap.get(derivation.outputMeasureId);
    if (!output)
      pushIssue(
        issues,
        "unknown-reference",
        `${base}.outputMeasureId`,
        `Unknown derived output ${derivation.outputMeasureId}`,
      );
    else if (output.source !== "derived")
      pushIssue(
        issues,
        "incompatible-semantics",
        `${base}.outputMeasureId`,
        "Derivation output must declare source derived",
      );
    if (derivedOutputs.has(derivation.outputMeasureId))
      pushIssue(
        issues,
        "duplicate-id",
        `${base}.outputMeasureId`,
        `Duplicate derived output ${derivation.outputMeasureId}`,
      );
    derivedOutputs.set(derivation.outputMeasureId, derivation);
    const walked = walkDiagnosticExpression(
      derivation.expression,
      "claim",
      `${base}.expression`,
      issues,
    );
    definitionExpressionNodes += walked.nodeCount;
    for (const id of walked.dependencies)
      if (!measureMap.has(id))
        pushIssue(
          issues,
          "unknown-reference",
          `${base}.expression`,
          `Unknown derivation measure ${id}`,
        );
    const transitiveIds = transitiveMeasureIds(
      walked.dependencies,
      derivationsByOutput,
    );
    const transitiveInputs = transitiveIds
      .map((id) => measureMap.get(id))
      .filter(
        (item): item is DiagnosticMeasureDefinition => item !== undefined,
      );
    if (
      output &&
      transitiveInputs.some(
        (input) => input.developmentSemantics !== output.developmentSemantics,
      )
    ) {
      pushIssue(
        issues,
        "incompatible-semantics",
        `${base}.expression`,
        "Derived output and inputs must share development semantics",
      );
    }
    if (definition.lossRowGrain !== "claim") {
      pushIssue(
        issues,
        "incompatible-semantics",
        base,
        "Derived measures require claim-grain input",
      );
    }
    const expressionStack: unknown[] = [derivation.expression];
    while (expressionStack.length > 0) {
      const current = expressionStack.pop();
      if (!isPlainRecord(current)) continue;
      if (current.op === "claim-layer") {
        const attachment = current.attachment;
        const limit = current.limit;
        const attachmentOk = validateFinite(
          attachment,
          `${base}.expression.attachment`,
          "Claim-layer attachment",
          issues,
        );
        if (attachmentOk && attachment < 0)
          pushIssue(
            issues,
            "invalid-number",
            `${base}.expression.attachment`,
            "Claim-layer attachment must be nonnegative",
          );
        if (limit !== null) {
          const limitOk = validateFinite(
            limit,
            `${base}.expression.limit`,
            "Claim-layer width",
            issues,
          );
          if (limitOk && limit <= 0)
            pushIssue(
              issues,
              "invalid-number",
              `${base}.expression.limit`,
              "Claim-layer width must be positive",
            );
          if (attachmentOk && limitOk && !Number.isFinite(attachment + limit)) {
            pushIssue(
              issues,
              "invalid-number",
              `${base}.expression.limit`,
              "Attachment plus claim-layer width must be finite",
            );
          }
        }
      } else if (current.op === "add" && Array.isArray(current.terms))
        expressionStack.push(...current.terms);
      else if (current.op === "subtract")
        expressionStack.push(current.left, current.right);
    }
    const projection = projectClaimExpression(
      derivation.expression,
      `${base}.expression`,
      measureMap,
      amountBasisMap,
      issues,
    );
    if (output && projection) {
      const expected =
        output.kind === "amount" && output.basisId
          ? amountBasisMap.get(output.basisId)
          : undefined;
      const matches =
        output.kind === projection.kind &&
        output.unit === projection.unit &&
        (output.kind === "amount"
          ? expected !== undefined &&
            projectedBasisKey(projectedAmountBasis(expected)) ===
              projectedBasisKey(projection.amountBasis!)
          : semanticReference(output) === projection.reference);
      if (!matches)
        pushIssue(
          issues,
          "incompatible-semantics",
          `${base}.expression`,
          "Derived expression does not project the output measure semantics",
        );
    }
  });
  for (const [measureId, measure] of measureMap) {
    if (measure.source === "derived" && !derivedOutputs.has(measureId)) {
      pushIssue(
        issues,
        "missing-required",
        "$.derivedMeasures",
        `Derived measure ${measureId} requires exactly one derivation`,
      );
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      pushIssue(
        issues,
        "cycle",
        "$.derivedMeasures",
        `Derived measure graph contains a cycle at ${id}`,
      );
      return;
    }
    visiting.add(id);
    const derivation = derivedOutputs.get(id);
    if (derivation) {
      const deps = walkDiagnosticExpression(
        derivation.expression,
        "claim",
        "$.derivedMeasures",
        [],
      ).dependencies;
      for (const dependency of deps)
        if (derivedOutputs.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of derivedOutputs.keys()) visit(id);

  reviewRules.forEach((rule, index) => {
    const base = `$.reviewRules[${index}]`;
    if (!isPlainRecord(rule)) {
      pushIssue(issues, "invalid-type", base, "Review rule must be an object");
      return;
    }
    const commonKeys = [
      "kind",
      "id",
      "code",
      "description",
      "severity",
      "tolerance",
      "missingInput",
    ];
    const branchKeys =
      rule.kind === "compare"
        ? ["when"]
        : rule.kind === "reconcile"
          ? ["actual", "expected"]
          : rule.kind === "monotonic"
            ? ["expression", "direction"]
            : rule.kind === "layer-order"
              ? ["narrower", "broader", "comparability"]
              : rule.kind === "control-total"
                ? ["expression", "expected", "filter", "projection"]
                : [];
    validateAllowedKeys(rule, [...commonKeys, ...branchKeys], base, issues);
    if (rule.tolerance !== undefined) {
      if (!isPlainRecord(rule.tolerance))
        pushIssue(
          issues,
          "invalid-type",
          `${base}.tolerance`,
          "Tolerance must be an object",
        );
      else
        validateAllowedKeys(
          rule.tolerance,
          ["absolute", "relative"],
          `${base}.tolerance`,
          issues,
        );
    }
    validateToken(rule.code, `${base}.code`, "Review rule code", issues);
    validateToken(
      rule.description,
      `${base}.description`,
      "Review rule description",
      issues,
    );
    if (
      typeof rule.id === "string" &&
      rule.id.startsWith("diagnostic/structural/")
    )
      pushIssue(
        issues,
        "incompatible-semantics",
        `${base}.id`,
        "Review rule ID uses the reserved structural prefix",
      );
    if (rule.severity !== "warning" && rule.severity !== "fail")
      pushIssue(
        issues,
        "invalid-type",
        `${base}.severity`,
        "Review severity must be warning or fail",
      );
    if (
      rule.missingInput !== "not-evaluated" &&
      rule.missingInput !== "finding"
    )
      pushIssue(
        issues,
        "invalid-type",
        `${base}.missingInput`,
        "Review missing-input policy must be not-evaluated or finding",
      );
    validateTolerance(rule.tolerance, `${base}.tolerance`, issues);
    const roots: {
      readonly expression: DiagnosticMeasureExpression;
      readonly path: string;
    }[] = [];
    const operand = (value: unknown, path: string): void => {
      if (isPlainRecord(value) && value.op === "constant") {
        validateFinite(value.value, `${path}.value`, "Review constant", issues);
        definitionExpressionNodes++;
      } else
        roots.push({ expression: value as DiagnosticMeasureExpression, path });
    };
    if (rule.kind === "compare") {
      if (!isPlainRecord(rule.when))
        pushIssue(
          issues,
          "invalid-type",
          `${base}.when`,
          "Compare rule predicate must be an object",
        );
      else {
        validateAllowedKeys(
          rule.when,
          ["left", "operator", "right"],
          `${base}.when`,
          issues,
        );
        operand(rule.when.left, `${base}.when.left`);
        operand(rule.when.right, `${base}.when.right`);
        if (
          !["lt", "lte", "eq", "neq", "gte", "gt"].includes(rule.when.operator)
        )
          pushIssue(
            issues,
            "invalid-type",
            `${base}.when.operator`,
            "Unknown review comparison operator",
          );
      }
    } else if (rule.kind === "reconcile") {
      roots.push({ expression: rule.actual, path: `${base}.actual` });
      operand(rule.expected, `${base}.expected`);
    } else if (rule.kind === "monotonic") {
      roots.push({ expression: rule.expression, path: `${base}.expression` });
      if (
        rule.direction !== "nondecreasing" &&
        rule.direction !== "nonincreasing"
      )
        pushIssue(
          issues,
          "invalid-type",
          `${base}.direction`,
          "Unknown monotonic direction",
        );
    } else if (rule.kind === "layer-order") {
      roots.push(
        { expression: rule.narrower, path: `${base}.narrower` },
        { expression: rule.broader, path: `${base}.broader` },
      );
      if (
        !isPlainRecord(rule.comparability) ||
        (rule.comparability.kind !== "compiler-proven" &&
          rule.comparability.kind !== "caller-asserted")
      ) {
        pushIssue(
          issues,
          "invalid-type",
          `${base}.comparability`,
          "Unknown layer comparability evidence",
        );
      } else if (rule.comparability.kind === "caller-asserted") {
        validateAllowedKeys(
          rule.comparability,
          ["kind", "rationaleArtifactId"],
          `${base}.comparability`,
          issues,
        );
        validateToken(
          rule.comparability.rationaleArtifactId,
          `${base}.comparability.rationaleArtifactId`,
          "Rationale artifact ID",
          issues,
        );
      }
      if (
        isPlainRecord(rule.comparability) &&
        rule.comparability.kind === "compiler-proven"
      )
        validateAllowedKeys(
          rule.comparability,
          ["kind"],
          `${base}.comparability`,
          issues,
        );
      if (
        isPlainRecord(rule.comparability) &&
        (rule.comparability.kind === "compiler-proven" ||
          rule.comparability.kind === "caller-asserted")
      ) {
        validateLayerComparability(
          rule,
          `${base}.comparability`,
          measureMap,
          amountBasisMap,
          derivationsByOutput,
          issues,
        );
      }
    } else if (rule.kind === "control-total") {
      roots.push({ expression: rule.expression, path: `${base}.expression` });
      validateFinite(
        rule.expected,
        `${base}.expected`,
        "Control total",
        issues,
      );
      if (rule.filter !== undefined)
        validateReviewFilter(
          rule.filter,
          `${base}.filter`,
          definition.periodAxis,
          issues,
        );
      if (
        !isPlainRecord(rule.projection) ||
        !["valuation", "latest-valuation-per-origin", "all-cells"].includes(
          rule.projection.kind,
        )
      ) {
        pushIssue(
          issues,
          "invalid-type",
          `${base}.projection`,
          "Unknown control-total projection",
        );
      } else if (rule.projection.kind === "valuation") {
        validateAllowedKeys(
          rule.projection,
          ["kind", "valuation"],
          `${base}.projection`,
          issues,
        );
        if (
          validateToken(
            rule.projection.valuation,
            `${base}.projection.valuation`,
            "Control-total valuation",
            issues,
          ) &&
          !normalizeDiagnosticPeriodWithAxis(
            definition.periodAxis,
            "valuation",
            rule.projection.valuation,
          )
        ) {
          pushIssue(
            issues,
            "invalid-period",
            `${base}.projection.valuation`,
            `Unknown valuation period ${JSON.stringify(rule.projection.valuation)}`,
          );
        }
      } else
        validateAllowedKeys(
          rule.projection,
          ["kind"],
          `${base}.projection`,
          issues,
        );
    } else
      pushIssue(
        issues,
        "invalid-type",
        `${base}.kind`,
        "Unknown review-rule kind",
      );
    const compatibleOperands = (
      left: DiagnosticReviewOperand,
      right: DiagnosticReviewOperand,
      path: string,
    ): void => {
      if (left.op === "constant" || right.op === "constant") return;
      const leftSignature = expressionSemantics(
        left,
        `${path}.left`,
        measureMap,
        [],
      ).signature;
      const rightSignature = expressionSemantics(
        right,
        `${path}.right`,
        measureMap,
        [],
      ).signature;
      if (
        leftSignature !== null &&
        rightSignature !== null &&
        leftSignature !== rightSignature
      ) {
        pushIssue(
          issues,
          "incompatible-semantics",
          path,
          "Review comparison operands must have identical quantity semantics",
        );
      }
    };
    if (rule.kind === "compare" && isPlainRecord(rule.when)) {
      compatibleOperands(rule.when.left, rule.when.right, `${base}.when`);
    } else if (rule.kind === "reconcile") {
      compatibleOperands(rule.actual, rule.expected, base);
    }
    roots.forEach(({ expression, path }) => {
      const semantics = expressionSemantics(
        expression,
        path,
        measureMap,
        issues,
      );
      definitionExpressionNodes += walkDiagnosticExpression(
        expression,
        "measure",
        path,
        [],
      ).nodeCount;
      if (rule.kind === "monotonic") {
        const leaves = transitiveMeasureIds(
          semantics.measureIds,
          derivationsByOutput,
        )
          .map((id) => measureMap.get(id))
          .filter(
            (item): item is DiagnosticMeasureDefinition => item !== undefined,
          );
        if (
          leaves.some(
            (measure) =>
              measure.developmentSemantics !== "cumulative" &&
              measure.developmentSemantics !== "point-in-time",
          )
        ) {
          pushIssue(
            issues,
            "incompatible-semantics",
            path,
            "Monotonic review requires cumulative or point-in-time leaves",
          );
        }
      }
      if (
        rule.kind === "control-total" &&
        rule.projection?.kind === "all-cells"
      ) {
        const leaves = transitiveMeasureIds(
          semantics.measureIds,
          derivationsByOutput,
        )
          .map((id) => measureMap.get(id))
          .filter(
            (item): item is DiagnosticMeasureDefinition => item !== undefined,
          );
        if (
          leaves.some(
            (measure) =>
              measure.developmentSemantics === "cumulative" ||
              measure.exposureTiming === "origin-static",
          )
        ) {
          pushIssue(
            issues,
            "incompatible-semantics",
            `${base}.projection`,
            "All-cells control totals cannot repeat cumulative or origin-static measures",
          );
        }
      }
    });
  });

  if (definitionExpressionNodes > MAX_DIAGNOSTIC_DEFINITION_EXPRESSION_NODES) {
    pushIssue(
      issues,
      "expression-limit",
      "$",
      `Definition expression node count exceeds ${MAX_DIAGNOSTIC_DEFINITION_EXPRESSION_NODES}`,
    );
  }
  validatePeriodAxis(definition.periodAxis, issues);
  if (issues.length > 0) throw new DiagnosticValidationError(issues);
  return definition;
}

function optionalFromNullable<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

function omitProperties<T extends object>(
  value: T,
  keys: readonly string[],
): Record<string, unknown> {
  const result = { ...value } as Record<string, unknown>;
  for (const key of keys) delete result[key];
  return result;
}

/**
 * The normalized wire projection materializes optional semantic fields as
 * null. Convert only those documented defaults back to the authored view so
 * both accepted inputs travel through the exact same semantic compiler.
 */
function authoredView(
  value: DiagnosticDefinition | NormalizedDiagnosticDefinitionIdentity,
): DiagnosticDefinition {
  const definition = value as NormalizedDiagnosticDefinitionIdentity;
  const reviewRules = definition.reviewRules.map((rule) => {
    const tolerance = { ...rule.tolerance };
    if (rule.kind !== "control-total") return { ...rule, tolerance };
    const filter =
      rule.filter === null || rule.filter === undefined
        ? undefined
        : (Object.fromEntries(
            Object.entries({
              sourceGroups: optionalFromNullable(rule.filter.sourceGroups),
              origins: optionalFromNullable(rule.filter.origins),
              originFrom: optionalFromNullable(rule.filter.originFrom),
              originThrough: optionalFromNullable(rule.filter.originThrough),
              valuations: optionalFromNullable(rule.filter.valuations),
              valuationFrom: optionalFromNullable(rule.filter.valuationFrom),
              valuationThrough: optionalFromNullable(
                rule.filter.valuationThrough,
              ),
              minDevelopmentAge: optionalFromNullable(
                rule.filter.minDevelopmentAge,
              ),
              maxDevelopmentAge: optionalFromNullable(
                rule.filter.maxDevelopmentAge,
              ),
            }).filter(([, item]) => item !== undefined),
          ) as DiagnosticReviewFilter);
    return {
      ...omitProperties(rule, ["filter"]),
      tolerance,
      ...(filter === undefined ? {} : { filter }),
    } as DiagnosticReviewRule;
  }) as readonly DiagnosticReviewRule[];
  return {
    ...definition,
    diagnosticDefinitionVersion: definition.diagnosticDefinitionVersion,
    id: definition.id,
    version: definition.version,
    lossRowGrain: definition.lossRowGrain,
    measures: definition.measures.map((measure) => ({
      ...omitProperties(measure, [
        "basisId",
        "countPopulationId",
        "exposureBasisId",
        "exposureTiming",
      ]),
      id: measure.id,
      displayName: measure.displayName,
      description: measure.description,
      source: measure.source,
      kind: measure.kind,
      unit: measure.unit,
      developmentSemantics: measure.developmentSemantics,
      aggregation: measure.aggregation,
      missing: measure.missing,
      ...(measure.basisId === null || measure.basisId === undefined
        ? {}
        : { basisId: measure.basisId }),
      ...(measure.countPopulationId === null ||
      measure.countPopulationId === undefined
        ? {}
        : { countPopulationId: measure.countPopulationId }),
      ...(measure.exposureBasisId === null ||
      measure.exposureBasisId === undefined
        ? {}
        : { exposureBasisId: measure.exposureBasisId }),
      ...(measure.exposureTiming === null ||
      measure.exposureTiming === undefined
        ? {}
        : { exposureTiming: measure.exposureTiming }),
    })),
    countPopulations: definition.countPopulations.map((population) => ({
      ...population,
    })),
    exposureBases: definition.exposureBases.map((basis) => ({
      ...omitProperties(basis, ["sourceDescription"]),
      id: basis.id,
      displayName: basis.displayName,
      basis: basis.basis,
      unit: basis.unit,
      description: basis.description,
      ...(basis.sourceDescription === null ||
      basis.sourceDescription === undefined
        ? {}
        : { sourceDescription: basis.sourceDescription }),
      ...(basis.attributes === undefined
        ? {}
        : { attributes: basis.attributes }),
    })),
    amountBases: definition.amountBases.map((basis) => ({
      ...omitProperties(basis, ["sourceDescription"]),
      id: basis.id,
      displayName: basis.displayName,
      currency: basis.currency,
      perspective: basis.perspective,
      components: basis.components.map((component) => ({
        ...component,
        id: component.id,
        treatment: component.treatment,
        limitation:
          component.limitation.kind === "unknown"
            ? {
                ...omitProperties(component.limitation, ["description"]),
                kind: "unknown" as const,
                ...(component.limitation.description === null ||
                component.limitation.description === undefined
                  ? {}
                  : { description: component.limitation.description }),
              }
            : component.limitation,
      })),
      ...(basis.sourceDescription === null ||
      basis.sourceDescription === undefined
        ? {}
        : { sourceDescription: basis.sourceDescription }),
      ...(basis.attributes === undefined
        ? {}
        : { attributes: basis.attributes }),
    })),
    derivedMeasures: definition.derivedMeasures.map((derivation) => ({
      ...derivation,
    })),
    formulas: definition.formulas.map((formula) => ({
      ...formula,
      id: formula.id,
      version: formula.version,
      roles: Object.fromEntries(
        Object.entries(formula.roles).map(([name, role]) => [
          name,
          {
            ...omitProperties(role, [
              "compatibilityGroup",
              "developmentSemantics",
            ]),
            kind: role.kind,
            ...(role.compatibilityGroup === null ||
            role.compatibilityGroup === undefined
              ? {}
              : { compatibilityGroup: role.compatibilityGroup }),
            ...(role.developmentSemantics === null ||
            role.developmentSemantics === undefined
              ? {}
              : { developmentSemantics: role.developmentSemantics }),
          },
        ]),
      ),
      numerator: formula.numerator,
      denominator: formula.denominator,
      denominatorPolicy: formula.denominatorPolicy,
    })),
    instances: definition.instances.map((instance) => ({
      ...instance,
      id: instance.id,
      version: instance.version,
      formulaId: instance.formulaId,
      bindings: instance.bindings,
      presentation: instance.presentation,
      rules: instance.rules.map((rule) => ({
        ...rule,
        when: { ...rule.when, tolerance: { ...rule.when.tolerance } },
      })),
    })),
    reviewRules,
    periodAxis: definition.periodAxis,
  };
}

/** Compiles, validates, normalizes, fingerprints, and freezes a diagnostic definition. */
export function compileDiagnosticDefinition(
  value: DiagnosticDefinition | NormalizedDiagnosticDefinitionIdentity,
): CompiledDiagnosticDefinition {
  const boundaryIssues: DiagnosticValidationIssue[] = [];
  validateJsonValue(value, boundaryIssues);
  if (boundaryIssues.length > 0)
    throw new DiagnosticValidationError(boundaryIssues);
  let authored: DiagnosticDefinition;
  try {
    authored = authoredView(value);
  } catch {
    throw new DiagnosticValidationError([
      {
        domain: "definition",
        code: "invalid-type",
        path: "$",
        message:
          "Diagnostic definition does not have the required object and array structure",
      },
    ]);
  }
  let definition: DiagnosticDefinition;
  try {
    definition = validateDefinition(authored);
  } catch (error) {
    if (error instanceof DiagnosticValidationError) throw error;
    throw new DiagnosticValidationError([
      {
        domain: "definition",
        code: "invalid-type",
        path: "$",
        message: "Diagnostic definition contains a malformed nested value",
      },
    ]);
  }
  const normalized = normalizeDiagnosticDefinition(definition);
  const identities = buildDiagnosticIdentities(normalized);
  const compiledBase = {
    definition: normalized,
    formulaFingerprints: identities.formulaFingerprints,
    calculationFingerprints: identities.calculationFingerprints,
    definitionIntegrity: identities.definitionIntegrity,
  };
  Object.defineProperty(compiledBase, compiledDiagnosticDefinitionBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  const compiled = compiledBase as CompiledDiagnosticDefinition;
  Object.freeze(compiled);
  authenticCompiledDefinitions.add(compiled);
  compiledInternals.set(compiled, {
    formulasById: new Map(
      normalized.formulas.map((formula) => [formula.id, formula]),
    ),
    measuresById: new Map(
      definition.measures.map((measure) => [measure.id, measure]),
    ),
    calculationScopesByInstanceId: identities.calculationScopesByInstanceId,
    calculationDependenciesByInstanceId:
      identities.calculationDependenciesByInstanceId,
    evaluationDependenciesByInstanceId:
      identities.evaluationDependenciesByInstanceId,
    derivationsByOutputMeasureId: new Map(
      normalized.derivedMeasures.map((derivation) => [
        derivation.outputMeasureId,
        derivation as DiagnosticDerivedMeasureDefinition,
      ]),
    ),
  });
  return compiled;
}

export function assertCompiledDiagnosticDefinition(
  value: unknown,
): asserts value is CompiledDiagnosticDefinition {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null ||
    !authenticCompiledDefinitions.has(value)
  ) {
    throw new DiagnosticValidationError([
      {
        domain: "definition",
        code: "invalid-input-relationship",
        path: "$",
        message: "Value is not an authentic compiled diagnostic definition",
      },
    ]);
  }
}

/** @internal Shared only by core diagnostic runtime modules; not re-exported. */
export function getCompiledDiagnosticDefinitionInternals(
  value: CompiledDiagnosticDefinition,
): CompiledDiagnosticDefinitionInternals {
  assertCompiledDiagnosticDefinition(value);
  return compiledInternals.get(value)!;
}
