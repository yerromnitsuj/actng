import {
  MAX_DIAGNOSTIC_DEFINITION_EXPRESSION_NODES,
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

export type DiagnosticDeepReadonly<T> =
  T extends readonly (infer U)[]
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

export type DiagnosticReviewFilter = Omit<DiagnosticsFilter, "outputGroups" | "instanceIds">;

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

const compiledDiagnosticDefinitionBrand: unique symbol = Symbol("compiled-diagnostic-definition");

export interface CompiledDiagnosticDefinition {
  readonly [compiledDiagnosticDefinitionBrand]: true;
  readonly definition: DiagnosticDeepReadonly<NormalizedDiagnosticDefinitionIdentity>;
  readonly formulaFingerprints: Readonly<Record<string, string>>;
  readonly calculationFingerprints: Readonly<Record<string, string>>;
  readonly definitionIntegrity: string;
}

export interface CompiledDiagnosticDefinitionInternals {
  readonly formulasById: ReadonlyMap<string, NormalizedDiagnosticFormulaIdentity>;
  readonly measuresById: ReadonlyMap<string, DiagnosticMeasureDefinition>;
  readonly calculationScopesByInstanceId: ReadonlyMap<string, NormalizedDiagnosticCalculationScope>;
  readonly calculationDependenciesByInstanceId: ReadonlyMap<string, readonly string[]>;
  readonly evaluationDependenciesByInstanceId: ReadonlyMap<string, readonly string[]>;
  readonly derivationsByOutputMeasureId: ReadonlyMap<string, DiagnosticDerivedMeasureDefinition>;
}

const authenticCompiledDefinitions = new WeakSet<object>();
const compiledInternals = new WeakMap<object, CompiledDiagnosticDefinitionInternals>();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function hasWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
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
  if (!hasWellFormedUtf16(value)) {
    pushIssue(issues, "invalid-string", path, `${label} contains an invalid Unicode string`);
    return false;
  }
  if (value.length === 0 || /^[\u0009-\u000d\u0020]|[\u0009-\u000d\u0020]$/.test(value)) {
    pushIssue(issues, "invalid-string", path, `${label} must be nonempty without surrounding ASCII whitespace`);
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

interface JsonFrame {
  readonly value: unknown;
  readonly path: string;
  readonly exiting: boolean;
}

function validateJsonValue(value: unknown, issues: DiagnosticValidationIssue[]): void {
  const active = new WeakSet<object>();
  const stack: JsonFrame[] = [{ value, path: "$", exiting: false }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.value === null || typeof frame.value === "boolean") continue;
    if (typeof frame.value === "string") {
      if (!hasWellFormedUtf16(frame.value)) {
        pushIssue(issues, "invalid-json-value", frame.path, "String is not well-formed UTF-16 or contains U+0000");
      }
      continue;
    }
    if (typeof frame.value === "number") {
      if (!Number.isFinite(frame.value)) {
        pushIssue(issues, "invalid-json-value", frame.path, "JSON numeric value must be finite");
      }
      continue;
    }
    if (typeof frame.value !== "object" || frame.value === undefined) {
      pushIssue(issues, "invalid-json-value", frame.path, "Value is not plain JSON data");
      continue;
    }
    const object = frame.value as object;
    if (frame.exiting) {
      active.delete(object);
      continue;
    }
    if (active.has(object)) {
      pushIssue(issues, "cycle", frame.path, "JSON value contains a cycle");
      continue;
    }
    if (!Array.isArray(object) && !isPlainRecord(object)) {
      pushIssue(issues, "invalid-json-value", frame.path, "Value must use a plain object or array prototype");
      continue;
    }
    active.add(object);
    stack.push({ value: object, path: frame.path, exiting: true });
    if (Array.isArray(object)) {
      for (let index = object.length - 1; index >= 0; index--) {
        stack.push({ value: object[index], path: `${frame.path}[${index}]`, exiting: false });
      }
    } else {
      for (const key of Object.keys(object).sort().reverse()) {
        if (!hasWellFormedUtf16(key)) {
          pushIssue(issues, "invalid-json-value", propertyPath(frame.path, key), "Object key is not well-formed UTF-16 or contains U+0000");
        }
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (!descriptor || !("value" in descriptor)) {
          pushIssue(issues, "invalid-json-value", propertyPath(frame.path, key), "JSON objects may contain only data properties");
          continue;
        }
        stack.push({ value: descriptor.value, path: propertyPath(frame.path, key), exiting: false });
      }
    }
  }
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
  if (measure.kind === "count") return `count:${measure.countPopulationId ?? ""}`;
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
      stack.push(...walkDiagnosticExpression(derivation.expression, "claim", "$", []).dependencies);
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

function projectedAmountBasis(basis: AmountBasisDefinition): ProjectedAmountBasis {
  return {
    currency: basis.currency,
    perspective: basis.perspective,
    components: [...basis.components].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
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
      return { kind: measure.kind, unit: measure.unit, reference: semanticReference(measure) };
    }
    const basis = measure.basisId ? amountBases.get(measure.basisId) : undefined;
    return basis
      ? { kind: "amount", unit: measure.unit, reference: `amount:${measure.basisId}`, amountBasis: projectedAmountBasis(basis) }
      : null;
  }
  if (expression.op === "claim-layer") {
    const measure = measures.get(expression.measureId);
    if (!measure || measure.kind !== "amount" || !measure.basisId) {
      pushIssue(issues, "incompatible-semantics", path, "Claim layers require an amount measure");
      return null;
    }
    const basis = amountBases.get(measure.basisId);
    const component = basis?.components[0];
    if (!basis || basis.components.length !== 1 || component?.treatment !== "included" || component.limitation.kind !== "unlimited") {
      pushIssue(issues, "incompatible-semantics", path, "Claim layers require one included unlimited source component");
      return null;
    }
    return {
      kind: "amount",
      unit: measure.unit,
      reference: "amount:projected",
      amountBasis: {
        currency: basis.currency,
        perspective: basis.perspective,
        components: [{
          id: component.id,
          treatment: "included",
          limitation: {
            kind: "layer",
            attachment: expression.attachment,
            limit: expression.limit,
            application: "claim",
            derivation: { kind: "sdk" },
          },
        }],
      },
    };
  }
  const children = expression.op === "add" ? expression.terms : [expression.left, expression.right];
  const projected = children.map((child, index) => projectClaimExpression(
    child,
    expression.op === "add" ? `${path}.terms[${index}]` : `${path}.${index === 0 ? "left" : "right"}`,
    measures,
    amountBases,
    issues,
  ));
  if (projected.some((item) => item === null)) return null;
  const present = projected as ProjectedClaimSemantics[];
  if (expression.op === "subtract") {
    const [left, right] = present;
    if (left!.kind !== right!.kind || left!.unit !== right!.unit ||
        (left!.kind === "amount"
          ? projectedBasisKey(left!.amountBasis!) !== projectedBasisKey(right!.amountBasis!)
          : left!.reference !== right!.reference)) {
      pushIssue(issues, "incompatible-semantics", path, "Claim subtraction requires one exact semantic basis");
      return null;
    }
    return left!;
  }
  const first = present[0]!;
  if (present.some((item) => item.kind !== first.kind || item.unit !== first.unit)) {
    pushIssue(issues, "incompatible-semantics", path, "Claim addition requires one kind and unit");
    return null;
  }
  if (first.kind !== "amount") {
    if (present.some((item) => item.reference !== first.reference)) {
      pushIssue(issues, "incompatible-semantics", path, "Claim addition requires one exact semantic basis");
      return null;
    }
    return first;
  }
  const bases = present.map((item) => item.amountBasis!);
  if (bases.some((basis) => basis.currency !== bases[0]!.currency || basis.perspective !== bases[0]!.perspective)) {
    pushIssue(issues, "incompatible-semantics", path, "Amount addition cannot mix currency or perspective");
    return null;
  }
  const componentIds = new Set<string>();
  const components: AmountBasisComponent[] = [];
  for (const basis of bases) {
    for (const component of basis.components) {
      if (componentIds.has(component.id)) {
        pushIssue(issues, "incompatible-semantics", path, `Amount addition overlaps component ${component.id}`);
        return null;
      }
      componentIds.add(component.id);
      components.push(component);
    }
  }
  const amountBasis = {
    currency: bases[0]!.currency,
    perspective: bases[0]!.perspective,
    components: components.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  };
  return { kind: "amount", unit: first.unit, reference: "amount:projected", amountBasis };
}

function expressionSemantics(
  expression: DiagnosticMeasureExpression,
  path: string,
  measures: ReadonlyMap<string, DiagnosticMeasureDefinition>,
  issues: DiagnosticValidationIssue[],
): { readonly measureIds: readonly string[]; readonly signature: string | null } {
  const walked = walkDiagnosticExpression(expression, "measure", path, issues);
  const found = walked.dependencies
    .map((id) => measures.get(id))
    .filter((value): value is DiagnosticMeasureDefinition => value !== undefined);
  for (const id of walked.dependencies) {
    if (!measures.has(id)) {
      pushIssue(issues, "unknown-reference", path, `Unknown measure ${id}`);
    }
  }
  const signatures = new Set(found.map((measure) =>
    `${measure.kind}\u0000${measure.unit}\u0000${semanticReference(measure)}`,
  ));
  if (signatures.size > 1) {
    pushIssue(issues, "incompatible-semantics", path, "Expression combines incompatible measure semantics");
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
    if (!validateFinite(component, `${path}.${key}`, `${key} tolerance`, issues)) continue;
    if (component < 0) {
      pushIssue(issues, "invalid-number", `${path}.${key}`, `${key} tolerance must be nonnegative`);
    }
  }
}

function validatePeriodAxis(axis: DiagnosticPeriodAxis, issues: DiagnosticValidationIssue[]): void {
  if (!isPlainRecord(axis)) {
    pushIssue(issues, "invalid-type", "$.periodAxis", "Period axis must be an object");
    return;
  }
  if (!validateFinite(axis.ageOffset, "$.periodAxis.ageOffset", "Period age offset", issues) ||
      !Number.isSafeInteger(axis.ageOffset)) {
    pushIssue(issues, "invalid-number", "$.periodAxis.ageOffset", "Period age offset must be a safe integer");
  }
  if (axis.kind === "calendar") {
    if (!["month", "quarter", "year"].includes(axis.originCadence)) {
      pushIssue(issues, "invalid-period", "$.periodAxis.originCadence", "Unknown origin cadence");
    }
    if (!["month", "quarter", "year"].includes(axis.valuationCadence)) {
      pushIssue(issues, "invalid-period", "$.periodAxis.valuationCadence", "Unknown valuation cadence");
    }
    if (axis.ageUnit !== "month") {
      pushIssue(issues, "invalid-period", "$.periodAxis.ageUnit", "Calendar axes use month age units");
    }
    return;
  }
  if (axis.kind !== "ordered") {
    pushIssue(issues, "invalid-period", "$.periodAxis.kind", "Unknown period-axis kind");
    return;
  }
  validateToken(axis.id, "$.periodAxis.id", "Ordered-axis ID", issues);
  validateToken(axis.version, "$.periodAxis.version", "Ordered-axis version", issues);
  validateToken(axis.ageUnit, "$.periodAxis.ageUnit", "Ordered-axis age unit", issues);
  for (const side of ["origins", "valuations"] as const) {
    const coordinates = requireArray(axis[side], `$.periodAxis.${side}`, issues) as readonly DiagnosticPeriodCoordinate[];
    const names = new Set<string>();
    const coordinateValues = new Set<number>();
    coordinates.forEach((coordinate, index) => {
      const base = `$.periodAxis.${side}[${index}]`;
      if (validateToken(coordinate?.label, `${base}.label`, "Period label", issues)) {
        if (names.has(coordinate.label)) pushIssue(issues, "duplicate-id", `${base}.label`, `Duplicate period label or alias ${coordinate.label}`);
        names.add(coordinate.label);
      }
      if (!validateFinite(coordinate?.coordinate, `${base}.coordinate`, "Period coordinate", issues) ||
          !Number.isSafeInteger(coordinate.coordinate)) {
        pushIssue(issues, "invalid-number", `${base}.coordinate`, "Period coordinate must be a safe integer");
      } else if (coordinateValues.has(coordinate.coordinate)) {
        pushIssue(issues, "duplicate-id", `${base}.coordinate`, `Duplicate period coordinate ${coordinate.coordinate}`);
      } else coordinateValues.add(coordinate.coordinate);
      for (const [aliasIndex, alias] of (coordinate?.aliases ?? []).entries()) {
        if (!validateToken(alias, `${base}.aliases[${aliasIndex}]`, "Period alias", issues)) continue;
        if (names.has(alias)) pushIssue(issues, "duplicate-id", `${base}.aliases[${aliasIndex}]`, `Duplicate period label or alias ${alias}`);
        names.add(alias);
      }
    });
  }
}

function validateDefinition(value: unknown): DiagnosticDefinition {
  const issues: DiagnosticValidationIssue[] = [];
  validateJsonValue(value, issues);
  if (!isPlainRecord(value)) {
    pushIssue(issues, "invalid-type", "$", "Diagnostic definition must be a plain object");
    throw new DiagnosticValidationError(issues);
  }
  const definition = value as unknown as DiagnosticDefinition;
  if (definition.diagnosticDefinitionVersion !== "1.0.0") {
    pushIssue(issues, "invalid-type", "$.diagnosticDefinitionVersion", "Diagnostic definition version must be 1.0.0");
  }
  validateToken(definition.id, "$.id", "Definition ID", issues);
  validateToken(definition.version, "$.version", "Definition version", issues);
  if (definition.lossRowGrain !== "claim" && definition.lossRowGrain !== "aggregate") {
    pushIssue(issues, "invalid-type", "$.lossRowGrain", "Loss row grain must be claim or aggregate");
  }

  const measures = requireArray(definition.measures, "$.measures", issues) as readonly DiagnosticMeasureDefinition[];
  const populations = requireArray(definition.countPopulations, "$.countPopulations", issues) as readonly DiagnosticCountPopulationDefinition[];
  const exposureBases = requireArray(definition.exposureBases, "$.exposureBases", issues) as readonly DiagnosticExposureBasisDefinition[];
  const amountBases = requireArray(definition.amountBases, "$.amountBases", issues) as readonly AmountBasisDefinition[];
  const derivations = requireArray(definition.derivedMeasures, "$.derivedMeasures", issues) as readonly DiagnosticDerivedMeasureDefinition[];
  const formulas = requireArray(definition.formulas, "$.formulas", issues) as readonly DiagnosticFormulaTemplate[];
  const instances = requireArray(definition.instances, "$.instances", issues) as readonly DiagnosticMetricInstance[];
  const reviewRules = requireArray(definition.reviewRules, "$.reviewRules", issues) as readonly DiagnosticReviewRule[];

  const measureMap = collectCatalog(measures, "$.measures", issues);
  const populationMap = collectCatalog(populations, "$.countPopulations", issues);
  const exposureBasisMap = collectCatalog(exposureBases, "$.exposureBases", issues);
  const amountBasisMap = collectCatalog(amountBases, "$.amountBases", issues);
  collectCatalog(derivations, "$.derivedMeasures", issues);
  const derivationsByOutput = new Map<string, DiagnosticDerivedMeasureDefinition>();
  for (const derivation of derivations) {
    if (isPlainRecord(derivation) && typeof derivation.outputMeasureId === "string" &&
        !derivationsByOutput.has(derivation.outputMeasureId)) {
      derivationsByOutput.set(derivation.outputMeasureId, derivation);
    }
  }
  const formulaMap = collectCatalog(formulas, "$.formulas", issues);
  collectCatalog(instances, "$.instances", issues);
  const reviewRuleMap = collectCatalog(reviewRules, "$.reviewRules", issues);

  populations.forEach((population, index) => {
    const base = `$.countPopulations[${index}]`;
    validateToken(population.displayName, `${base}.displayName`, "Population display name", issues);
    validateToken(population.description, `${base}.description`, "Population description", issues);
    validateToken(population.unit, `${base}.unit`, "Population unit", issues);
    if (!["claim", "claimant", "policy", "occurrence", "other", "unknown"].includes(population.subject)) {
      pushIssue(issues, "invalid-type", `${base}.subject`, "Unknown count-population subject");
    }
  });

  exposureBases.forEach((basis, index) => {
    const base = `$.exposureBases[${index}]`;
    validateToken(basis.displayName, `${base}.displayName`, "Exposure-basis display name", issues);
    validateToken(basis.description, `${base}.description`, "Exposure-basis description", issues);
    validateToken(basis.unit, `${base}.unit`, "Exposure-basis unit", issues);
    if (basis.sourceDescription !== undefined) validateToken(basis.sourceDescription, `${base}.sourceDescription`, "Exposure source description", issues);
    if (!["earned", "written", "in-force", "other", "unknown"].includes(basis.basis)) {
      pushIssue(issues, "invalid-type", `${base}.basis`, "Unknown exposure basis");
    }
  });

  amountBases.forEach((basis, index) => {
    const base = `$.amountBases[${index}]`;
    validateToken(basis.displayName, `${base}.displayName`, "Amount-basis display name", issues);
    validateToken(basis.currency, `${base}.currency`, "Amount-basis currency", issues);
    if (basis.sourceDescription !== undefined) validateToken(basis.sourceDescription, `${base}.sourceDescription`, "Amount source description", issues);
    if (!["gross", "net", "ceded", "other", "unknown"].includes(basis.perspective)) {
      pushIssue(issues, "invalid-type", `${base}.perspective`, "Unknown amount perspective");
    }
    const components = requireArray(basis.components, `${base}.components`, issues) as readonly AmountBasisComponent[];
    if (components.length === 0) pushIssue(issues, "missing-required", `${base}.components`, "Amount basis requires at least one component");
    const componentIds = collectCatalog(components, `${base}.components`, issues);
    if (componentIds.size > 0 && components.every((component) => component.treatment === "excluded")) {
      pushIssue(issues, "incompatible-semantics", `${base}.components`, "Amount basis cannot exclude every component");
    }
    components.forEach((component, componentIndex) => {
      const componentBase = `${base}.components[${componentIndex}]`;
      if (!isPlainRecord(component)) {
        pushIssue(issues, "invalid-type", componentBase, "Amount-basis component must be an object");
        return;
      }
      if (!["included", "excluded", "unknown"].includes(component.treatment)) {
        pushIssue(issues, "invalid-type", `${componentBase}.treatment`, "Unknown component treatment");
      }
      const limitation = component.limitation;
      if (!isPlainRecord(limitation)) {
        pushIssue(issues, "invalid-type", `${componentBase}.limitation`, "Amount limitation must be an object");
        return;
      }
      if (limitation.kind === "unknown") {
        if (limitation.description !== undefined) validateToken(limitation.description, `${componentBase}.limitation.description`, "Unknown limitation description", issues);
      } else if (limitation.kind === "layer" || limitation.kind === "pre-limited") {
        if (validateFinite(limitation.attachment, `${componentBase}.limitation.attachment`, "Attachment", issues) && limitation.attachment < 0) {
          pushIssue(issues, "invalid-number", `${componentBase}.limitation.attachment`, "Attachment must be nonnegative");
        }
        if (limitation.limit !== null) {
          if (validateFinite(limitation.limit, `${componentBase}.limitation.limit`, "Layer width", issues) && limitation.limit <= 0) {
            pushIssue(issues, "invalid-number", `${componentBase}.limitation.limit`, "Layer width must be positive");
          }
          if (Number.isFinite(limitation.attachment) && Number.isFinite(limitation.limit) && !Number.isFinite(limitation.attachment + limitation.limit)) {
            pushIssue(issues, "invalid-number", `${componentBase}.limitation.limit`, "Attachment plus layer width must be finite");
          }
        }
        if (limitation.derivation?.kind === "sdk") {
          if (limitation.kind !== "layer" || limitation.application !== "claim") {
            pushIssue(issues, "incompatible-semantics", `${componentBase}.limitation.derivation`, "SDK limitations require a claim layer");
          }
        } else if (limitation.derivation?.kind === "external") {
          validateToken(limitation.derivation.transformationRef, `${componentBase}.limitation.derivation.transformationRef`, "Transformation reference", issues);
        } else {
          pushIssue(issues, "invalid-type", `${componentBase}.limitation.derivation`, "Limited basis requires a derivation record");
        }
      } else if (limitation.kind !== "unlimited") {
        pushIssue(issues, "invalid-type", `${componentBase}.limitation.kind`, "Unknown amount limitation kind");
      }
    });
  });

  measures.forEach((measure, index) => {
    const base = `$.measures[${index}]`;
    validateToken(measure.displayName, `${base}.displayName`, "Measure display name", issues);
    validateToken(measure.description, `${base}.description`, "Measure description", issues);
    validateToken(measure.unit, `${base}.unit`, "Measure unit", issues);
    if (measure.aggregation !== "sum") pushIssue(issues, "incompatible-semantics", `${base}.aggregation`, "Only sum aggregation is supported");
    if (measure.missing !== "unknown" && measure.missing !== "zero") pushIssue(issues, "invalid-type", `${base}.missing`, "Unknown missing-value policy");
    if (!["cumulative", "incremental", "point-in-time", "unknown"].includes(measure.developmentSemantics)) {
      pushIssue(issues, "invalid-type", `${base}.developmentSemantics`, "Unknown development semantics");
    }
    if (measure.kind === "amount") {
      const basis = measure.basisId ? amountBasisMap.get(measure.basisId) : undefined;
      if (!basis) pushIssue(issues, "unknown-reference", `${base}.basisId`, "Amount measure requires an existing amount basis");
      else if (measure.unit !== basis.currency) pushIssue(issues, "incompatible-semantics", `${base}.unit`, "Amount measure unit must equal basis currency");
      if (measure.countPopulationId !== undefined || measure.exposureBasisId !== undefined || measure.exposureTiming !== undefined) {
        pushIssue(issues, "incompatible-semantics", base, "Amount measure has inapplicable population or exposure semantics");
      }
    } else if (measure.kind === "count") {
      const population = measure.countPopulationId ? populationMap.get(measure.countPopulationId) : undefined;
      if (!population) pushIssue(issues, "unknown-reference", `${base}.countPopulationId`, "Count measure requires an existing count population");
      else if (measure.unit !== population.unit) pushIssue(issues, "incompatible-semantics", `${base}.unit`, "Count measure unit must equal population unit");
      if (measure.basisId !== undefined || measure.exposureBasisId !== undefined || measure.exposureTiming !== undefined) {
        pushIssue(issues, "incompatible-semantics", base, "Count measure has inapplicable amount or exposure semantics");
      }
    } else if (measure.kind === "exposure") {
      const basis = measure.exposureBasisId ? exposureBasisMap.get(measure.exposureBasisId) : undefined;
      if (!basis) pushIssue(issues, "unknown-reference", `${base}.exposureBasisId`, "Exposure measure requires an existing exposure basis");
      else if (measure.unit !== basis.unit) pushIssue(issues, "incompatible-semantics", `${base}.unit`, "Exposure measure unit must equal exposure-basis unit");
      if (measure.source !== "exposure") pushIssue(issues, "incompatible-semantics", `${base}.source`, "Exposure measure source must be exposure");
      if (measure.exposureTiming !== "origin-static" && measure.exposureTiming !== "valuation-specific") {
        pushIssue(issues, "missing-required", `${base}.exposureTiming`, "Exposure measure requires timing");
      }
      if (measure.missing !== "unknown") pushIssue(issues, "incompatible-semantics", `${base}.missing`, "Exposure missingness must remain unknown");
      if (measure.basisId !== undefined || measure.countPopulationId !== undefined) {
        pushIssue(issues, "incompatible-semantics", base, "Exposure measure has inapplicable amount or population semantics");
      }
    } else {
      pushIssue(issues, "invalid-type", `${base}.kind`, "Unknown measure kind");
    }
    if (measure.kind !== "exposure" && measure.source !== "loss" && measure.source !== "derived") {
      pushIssue(issues, "invalid-type", `${base}.source`, "Non-exposure measure source must be loss or derived");
    }
    if (measure.kind !== "exposure" && measure.source === "exposure") {
      pushIssue(issues, "incompatible-semantics", `${base}.source`, "Only exposure measures may use exposure source");
    }
    if (measure.kind === "amount" && measure.basisId) {
      const basis = amountBasisMap.get(measure.basisId);
      const hasSdkLimitation = basis?.components.some((component) =>
        (component.limitation.kind === "layer" || component.limitation.kind === "pre-limited") &&
        component.limitation.derivation.kind === "sdk",
      ) ?? false;
      if (hasSdkLimitation && measure.source !== "derived") {
        pushIssue(issues, "incompatible-semantics", `${base}.source`, "SDK-limited amount measures must be derived");
      }
    }
  });

  let definitionExpressionNodes = 0;
  const formulaRoleUsage = new Map<string, readonly string[]>();
  formulas.forEach((formula, index) => {
    const base = `$.formulas[${index}]`;
    validateToken(formula.version, `${base}.version`, "Formula version", issues);
    if (formula.denominatorPolicy !== "positive-or-null") {
      pushIssue(issues, "incompatible-semantics", `${base}.denominatorPolicy`, "Unknown denominator policy");
    }
    if (!isPlainRecord(formula.roles)) {
      pushIssue(issues, "invalid-type", `${base}.roles`, "Formula roles must be an object");
      return;
    }
    for (const [roleName, role] of Object.entries(formula.roles)) {
      validateToken(roleName, propertyPath(`${base}.roles`, roleName), "Formula role", issues);
      if (!isPlainRecord(role) || !["count", "amount", "exposure"].includes(role.kind)) {
        pushIssue(issues, "invalid-type", propertyPath(`${base}.roles`, roleName), "Formula role has an invalid kind");
      }
      if (role.compatibilityGroup !== undefined) validateToken(role.compatibilityGroup, `${propertyPath(`${base}.roles`, roleName)}.compatibilityGroup`, "Compatibility group", issues);
    }
    const numerator = walkDiagnosticExpression(formula.numerator, "role", `${base}.numerator`, issues);
    const denominator = walkDiagnosticExpression(formula.denominator, "role", `${base}.denominator`, issues);
    definitionExpressionNodes += numerator.nodeCount + denominator.nodeCount;
    const used = [...new Set([...numerator.dependencies, ...denominator.dependencies])].sort();
    formulaRoleUsage.set(formula.id, used);
    for (const role of used) {
      if (!Object.prototype.hasOwnProperty.call(formula.roles, role)) {
        pushIssue(issues, "unknown-reference", base, `Formula ${formula.id} references unknown role ${role}`);
      }
    }
    for (const role of Object.keys(formula.roles)) {
      if (!used.includes(role)) pushIssue(issues, "incompatible-semantics", propertyPath(`${base}.roles`, role), `Formula role ${role} is unused`);
    }
    for (const [side, walked] of [["numerator", numerator], ["denominator", denominator]] as const) {
      const kinds = new Set(walked.dependencies.map((role) => formula.roles[role]?.kind).filter(Boolean));
      if (kinds.size > 1) pushIssue(issues, "incompatible-semantics", `${base}.${side}`, "Formula arithmetic combines different role kinds");
    }
  });

  const instanceRuleIds = new Set<string>();
  instances.forEach((instance, index) => {
    const base = `$.instances[${index}]`;
    validateToken(instance.version, `${base}.version`, "Instance version", issues);
    validateToken(instance.formulaId, `${base}.formulaId`, "Formula reference", issues);
    const formula = formulaMap.get(instance.formulaId);
    if (!formula) {
      pushIssue(issues, "unknown-reference", `${base}.formulaId`, `Unknown formula ${instance.formulaId}`);
      return;
    }
    if (!isPlainRecord(instance.bindings)) {
      pushIssue(issues, "invalid-type", `${base}.bindings`, "Instance bindings must be an object");
      return;
    }
    const usedRoles = formulaRoleUsage.get(formula.id) ?? [];
    const bindingSemantics = new Map<string, ReturnType<typeof expressionSemantics>>();
    for (const roleName of usedRoles) {
      if (!Object.prototype.hasOwnProperty.call(instance.bindings, roleName)) {
        pushIssue(issues, "missing-required", propertyPath(`${base}.bindings`, roleName), `Missing binding for role ${roleName}`);
        continue;
      }
      const expression = instance.bindings[roleName]!;
      const semantics = expressionSemantics(expression, propertyPath(`${base}.bindings`, roleName), measureMap, issues);
      bindingSemantics.set(roleName, semantics);
      definitionExpressionNodes += walkDiagnosticExpression(expression, "measure", propertyPath(`${base}.bindings`, roleName), []).nodeCount;
      const role = formula.roles[roleName]!;
      const boundMeasures = semantics.measureIds.map((id) => measureMap.get(id)).filter((item): item is DiagnosticMeasureDefinition => item !== undefined);
      if (boundMeasures.some((measure) => measure.kind !== role.kind)) {
        pushIssue(issues, "incompatible-semantics", propertyPath(`${base}.bindings`, roleName), `Binding kind does not match role ${roleName}`);
      }
      if (role.developmentSemantics !== undefined) {
        const leaves = transitiveMeasureIds(semantics.measureIds, derivationsByOutput)
          .map((id) => measureMap.get(id))
          .filter((measure): measure is DiagnosticMeasureDefinition => measure !== undefined);
        if (leaves.some((measure) => measure.developmentSemantics !== role.developmentSemantics)) {
          pushIssue(issues, "incompatible-semantics", propertyPath(`${base}.bindings`, roleName), `Transitive binding development semantics do not match role ${roleName}`);
        }
      }
    }
    for (const [side, roleExpression] of [["numerator", formula.numerator], ["denominator", formula.denominator]] as const) {
      const roleIds = walkDiagnosticExpression(roleExpression, "role", `${base}.${side}`, []).dependencies;
      const signatures = new Set(roleIds.map((roleId) => bindingSemantics.get(roleId)?.signature).filter((signature): signature is string => signature !== null && signature !== undefined));
      if (signatures.size > 1) {
        pushIssue(issues, "incompatible-semantics", `${base}.bindings`, `Bound ${side} arithmetic combines incompatible semantics`);
      }
    }
    for (const binding of Object.keys(instance.bindings)) {
      if (!usedRoles.includes(binding)) {
        pushIssue(issues, "unknown-reference", propertyPath(`${base}.bindings`, binding), `Unexpected binding for role ${binding}`);
      }
    }
    const compatibility = new Map<string, string>();
    for (const roleName of usedRoles) {
      const role = formula.roles[roleName]!;
      const binding = instance.bindings[roleName];
      if (!role.compatibilityGroup || !binding) continue;
      const semantics = expressionSemantics(binding, propertyPath(`${base}.bindings`, roleName), measureMap, []);
      if (semantics.signature === null) continue;
      const previous = compatibility.get(role.compatibilityGroup);
      if (previous !== undefined && previous !== semantics.signature) {
        pushIssue(issues, "incompatible-semantics", propertyPath(`${base}.bindings`, roleName), `Compatibility group ${role.compatibilityGroup} binds different semantics`);
      } else compatibility.set(role.compatibilityGroup, semantics.signature);
    }
    for (const [key, text] of [
      ["displayName", instance.presentation?.displayName],
      ["description", instance.presentation?.description],
      ["displayUnit", instance.presentation?.displayUnit],
      ["numeratorLabel", instance.presentation?.numeratorLabel],
      ["denominatorLabel", instance.presentation?.denominatorLabel],
    ] as const) validateToken(text, `${base}.presentation.${key}`, `Presentation ${key}`, issues);
    if (!validateFinite(instance.presentation?.scale, `${base}.presentation.scale`, "Presentation scale", issues) || instance.presentation.scale <= 0) {
      pushIssue(issues, "invalid-number", `${base}.presentation.scale`, "Presentation scale must be positive");
    }
    requireArray(instance.rules, `${base}.rules`, issues).forEach((rawRule, ruleIndex) => {
      const rule = rawRule as DiagnosticComparisonRule;
      const ruleBase = `${base}.rules[${ruleIndex}]`;
      if (validateToken(rule.id, `${ruleBase}.id`, "Metric rule ID", issues)) {
        if (rule.id.startsWith("diagnostic/structural/")) pushIssue(issues, "incompatible-semantics", `${ruleBase}.id`, "Metric rule ID uses the reserved structural prefix");
        if (instanceRuleIds.has(rule.id) || reviewRuleMap.has(rule.id)) pushIssue(issues, "duplicate-id", `${ruleBase}.id`, `Duplicate rule ID ${rule.id}`);
        instanceRuleIds.add(rule.id);
      }
      validateToken(rule.code, `${ruleBase}.code`, "Metric rule code", issues);
      validateToken(rule.message, `${ruleBase}.message`, "Metric rule message", issues);
      validateTolerance(rule.when?.tolerance, `${ruleBase}.when.tolerance`, issues);
      for (const [side, operand] of [["left", rule.when?.left], ["right", rule.when?.right]] as const) {
        const operandPath = `${ruleBase}.when.${side}`;
        if (operand?.source === "measure") {
          const semantic = expressionSemantics(operand.expression, `${operandPath}.expression`, measureMap, issues);
          definitionExpressionNodes += 1 + walkDiagnosticExpression(operand.expression, "measure", `${operandPath}.expression`, []).nodeCount;
          void semantic;
        } else {
          definitionExpressionNodes += 1;
          if (operand?.source === "constant") validateFinite(operand.value, `${operandPath}.value`, "Rule constant", issues);
        }
      }
    });
  });

  const derivedOutputs = new Map<string, DiagnosticDerivedMeasureDefinition>();
  derivations.forEach((derivation, index) => {
    const base = `$.derivedMeasures[${index}]`;
    validateToken(derivation.outputMeasureId, `${base}.outputMeasureId`, "Derived output measure", issues);
    const output = measureMap.get(derivation.outputMeasureId);
    if (!output) pushIssue(issues, "unknown-reference", `${base}.outputMeasureId`, `Unknown derived output ${derivation.outputMeasureId}`);
    else if (output.source !== "derived") pushIssue(issues, "incompatible-semantics", `${base}.outputMeasureId`, "Derivation output must declare source derived");
    if (derivedOutputs.has(derivation.outputMeasureId)) pushIssue(issues, "duplicate-id", `${base}.outputMeasureId`, `Duplicate derived output ${derivation.outputMeasureId}`);
    derivedOutputs.set(derivation.outputMeasureId, derivation);
    const walked = walkDiagnosticExpression(derivation.expression, "claim", `${base}.expression`, issues);
    definitionExpressionNodes += walked.nodeCount;
    for (const id of walked.dependencies) if (!measureMap.has(id)) pushIssue(issues, "unknown-reference", `${base}.expression`, `Unknown derivation measure ${id}`);
    const transitiveIds = transitiveMeasureIds(walked.dependencies, derivationsByOutput);
    const transitiveInputs = transitiveIds.map((id) => measureMap.get(id)).filter((item): item is DiagnosticMeasureDefinition => item !== undefined);
    if (output && transitiveInputs.some((input) => input.developmentSemantics !== output.developmentSemantics)) {
      pushIssue(issues, "incompatible-semantics", `${base}.expression`, "Derived output and inputs must share development semantics");
    }
    if (definition.lossRowGrain !== "claim") {
      pushIssue(issues, "incompatible-semantics", base, "Derived measures require claim-grain input");
    }
    const expressionStack: unknown[] = [derivation.expression];
    while (expressionStack.length > 0) {
      const current = expressionStack.pop();
      if (!isPlainRecord(current)) continue;
      if (current.op === "claim-layer") {
        const attachment = current.attachment;
        const limit = current.limit;
        const attachmentOk = validateFinite(attachment, `${base}.expression.attachment`, "Claim-layer attachment", issues);
        if (attachmentOk && attachment < 0) pushIssue(issues, "invalid-number", `${base}.expression.attachment`, "Claim-layer attachment must be nonnegative");
        if (limit !== null) {
          const limitOk = validateFinite(limit, `${base}.expression.limit`, "Claim-layer width", issues);
          if (limitOk && limit <= 0) pushIssue(issues, "invalid-number", `${base}.expression.limit`, "Claim-layer width must be positive");
          if (attachmentOk && limitOk && !Number.isFinite(attachment + limit)) {
            pushIssue(issues, "invalid-number", `${base}.expression.limit`, "Attachment plus claim-layer width must be finite");
          }
        }
      } else if (current.op === "add" && Array.isArray(current.terms)) expressionStack.push(...current.terms);
      else if (current.op === "subtract") expressionStack.push(current.left, current.right);
    }
    const projection = projectClaimExpression(derivation.expression, `${base}.expression`, measureMap, amountBasisMap, issues);
    if (output && projection) {
      const expected = output.kind === "amount" && output.basisId
        ? amountBasisMap.get(output.basisId)
        : undefined;
      const matches = output.kind === projection.kind && output.unit === projection.unit &&
        (output.kind === "amount"
          ? expected !== undefined && projectedBasisKey(projectedAmountBasis(expected)) === projectedBasisKey(projection.amountBasis!)
          : semanticReference(output) === projection.reference);
      if (!matches) pushIssue(issues, "incompatible-semantics", `${base}.expression`, "Derived expression does not project the output measure semantics");
    }
  });
  for (const [measureId, measure] of measureMap) {
    if (measure.source === "derived" && !derivedOutputs.has(measureId)) {
      pushIssue(issues, "missing-required", "$.derivedMeasures", `Derived measure ${measureId} requires exactly one derivation`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      pushIssue(issues, "cycle", "$.derivedMeasures", `Derived measure graph contains a cycle at ${id}`);
      return;
    }
    visiting.add(id);
    const derivation = derivedOutputs.get(id);
    if (derivation) {
      const deps = walkDiagnosticExpression(derivation.expression, "claim", "$.derivedMeasures", []).dependencies;
      for (const dependency of deps) if (derivedOutputs.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of derivedOutputs.keys()) visit(id);

  reviewRules.forEach((rule, index) => {
    const base = `$.reviewRules[${index}]`;
    validateToken(rule.code, `${base}.code`, "Review rule code", issues);
    validateToken(rule.description, `${base}.description`, "Review rule description", issues);
    if (rule.id.startsWith("diagnostic/structural/")) pushIssue(issues, "incompatible-semantics", `${base}.id`, "Review rule ID uses the reserved structural prefix");
    validateTolerance(rule.tolerance, `${base}.tolerance`, issues);
    const roots: DiagnosticMeasureExpression[] = [];
    if (rule.kind === "compare") {
      if (rule.when.left.op !== "constant") roots.push(rule.when.left);
      else definitionExpressionNodes++;
      if (rule.when.right.op !== "constant") roots.push(rule.when.right);
      else definitionExpressionNodes++;
    } else if (rule.kind === "reconcile") {
      roots.push(rule.actual);
      if (rule.expected.op !== "constant") roots.push(rule.expected);
      else definitionExpressionNodes++;
    } else if (rule.kind === "monotonic") roots.push(rule.expression);
    else if (rule.kind === "layer-order") roots.push(rule.narrower, rule.broader);
    else if (rule.kind === "control-total") {
      roots.push(rule.expression);
      validateFinite(rule.expected, `${base}.expected`, "Control total", issues);
    } else pushIssue(issues, "invalid-type", `${base}.kind`, "Unknown review-rule kind");
    roots.forEach((root, rootIndex) => {
      expressionSemantics(root, `${base}.expression[${rootIndex}]`, measureMap, issues);
      definitionExpressionNodes += walkDiagnosticExpression(root, "measure", `${base}.expression[${rootIndex}]`, []).nodeCount;
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
    const filter = rule.filter === null
      ? undefined
      : {
          sourceGroups: optionalFromNullable(rule.filter.sourceGroups),
          origins: optionalFromNullable(rule.filter.origins),
          originFrom: optionalFromNullable(rule.filter.originFrom),
          originThrough: optionalFromNullable(rule.filter.originThrough),
          valuations: optionalFromNullable(rule.filter.valuations),
          valuationFrom: optionalFromNullable(rule.filter.valuationFrom),
          valuationThrough: optionalFromNullable(rule.filter.valuationThrough),
          minDevelopmentAge: optionalFromNullable(rule.filter.minDevelopmentAge),
          maxDevelopmentAge: optionalFromNullable(rule.filter.maxDevelopmentAge),
        };
    return { ...rule, tolerance, ...(filter === undefined ? {} : { filter }) };
  }) as readonly DiagnosticReviewRule[];
  return {
    diagnosticDefinitionVersion: definition.diagnosticDefinitionVersion,
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
      aggregation: measure.aggregation,
      missing: measure.missing,
      ...(measure.basisId === null || measure.basisId === undefined ? {} : { basisId: measure.basisId }),
      ...(measure.countPopulationId === null || measure.countPopulationId === undefined
        ? {}
        : { countPopulationId: measure.countPopulationId }),
      ...(measure.exposureBasisId === null || measure.exposureBasisId === undefined
        ? {}
        : { exposureBasisId: measure.exposureBasisId }),
      ...(measure.exposureTiming === null || measure.exposureTiming === undefined
        ? {}
        : { exposureTiming: measure.exposureTiming }),
    })),
    countPopulations: definition.countPopulations.map((population) => ({ ...population })),
    exposureBases: definition.exposureBases.map((basis) => ({
      id: basis.id,
      displayName: basis.displayName,
      basis: basis.basis,
      unit: basis.unit,
      description: basis.description,
      ...(basis.sourceDescription === null || basis.sourceDescription === undefined
        ? {}
        : { sourceDescription: basis.sourceDescription }),
      ...(basis.attributes === undefined ? {} : { attributes: basis.attributes }),
    })),
    amountBases: definition.amountBases.map((basis) => ({
      id: basis.id,
      displayName: basis.displayName,
      currency: basis.currency,
      perspective: basis.perspective,
      components: basis.components.map((component) => ({
        id: component.id,
        treatment: component.treatment,
        limitation: component.limitation.kind === "unknown"
          ? {
              kind: "unknown" as const,
              ...(component.limitation.description === null || component.limitation.description === undefined
                ? {}
                : { description: component.limitation.description }),
            }
          : component.limitation,
      })),
      ...(basis.sourceDescription === null || basis.sourceDescription === undefined
        ? {}
        : { sourceDescription: basis.sourceDescription }),
      ...(basis.attributes === undefined ? {} : { attributes: basis.attributes }),
    })),
    derivedMeasures: definition.derivedMeasures.map((derivation) => ({ ...derivation })),
    formulas: definition.formulas.map((formula) => ({
      id: formula.id,
      version: formula.version,
      roles: Object.fromEntries(Object.entries(formula.roles).map(([name, role]) => [name, {
        kind: role.kind,
        ...(role.compatibilityGroup === null || role.compatibilityGroup === undefined
          ? {}
          : { compatibilityGroup: role.compatibilityGroup }),
        ...(role.developmentSemantics === null || role.developmentSemantics === undefined
          ? {}
          : { developmentSemantics: role.developmentSemantics }),
      }])),
      numerator: formula.numerator,
      denominator: formula.denominator,
      denominatorPolicy: formula.denominatorPolicy,
    })),
    instances: definition.instances.map((instance) => ({
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
  if (boundaryIssues.length > 0) throw new DiagnosticValidationError(boundaryIssues);
  let authored: DiagnosticDefinition;
  try {
    authored = authoredView(value);
  } catch {
    throw new DiagnosticValidationError([{
      domain: "definition",
      code: "invalid-type",
      path: "$",
      message: "Diagnostic definition does not have the required object and array structure",
    }]);
  }
  let definition: DiagnosticDefinition;
  try {
    definition = validateDefinition(authored);
  } catch (error) {
    if (error instanceof DiagnosticValidationError) throw error;
    throw new DiagnosticValidationError([{
      domain: "definition",
      code: "invalid-type",
      path: "$",
      message: "Diagnostic definition contains a malformed nested value",
    }]);
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
    formulasById: new Map(normalized.formulas.map((formula) => [formula.id, formula])),
    measuresById: new Map(definition.measures.map((measure) => [measure.id, measure])),
    calculationScopesByInstanceId: identities.calculationScopesByInstanceId,
    calculationDependenciesByInstanceId: identities.calculationDependenciesByInstanceId,
    evaluationDependenciesByInstanceId: identities.evaluationDependenciesByInstanceId,
    derivationsByOutputMeasureId: new Map(
      definition.derivedMeasures.map((derivation) => [derivation.outputMeasureId, derivation]),
    ),
  });
  return compiled;
}

export function assertCompiledDiagnosticDefinition(
  value: unknown,
): asserts value is CompiledDiagnosticDefinition {
  if ((typeof value !== "object" && typeof value !== "function") || value === null || !authenticCompiledDefinitions.has(value)) {
    throw new DiagnosticValidationError([{
      domain: "definition",
      code: "invalid-input-relationship",
      path: "$",
      message: "Value is not an authentic compiled diagnostic definition",
    }]);
  }
}

/** @internal Shared only by core diagnostic runtime modules; not re-exported. */
export function getCompiledDiagnosticDefinitionInternals(
  value: CompiledDiagnosticDefinition,
): CompiledDiagnosticDefinitionInternals {
  assertCompiledDiagnosticDefinition(value);
  return compiledInternals.get(value)!;
}
