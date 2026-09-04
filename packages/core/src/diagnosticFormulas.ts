import { safeRatio } from "./util.js";
import type {
  DiagnosticDeepReadonly,
  DiagnosticFormulaTemplate,
  DiagnosticMeasureKind,
  DiagnosticMeasureStats,
  DiagnosticMetricPresentation,
} from "./diagnosticDefinitions.js";
import type {
  DiagnosticMeasureExpression,
  DiagnosticRoleExpression,
} from "./diagnosticExpressions.js";
import type {
  DiagnosticExpressionOverflow,
  DiagnosticRuleNotEvaluatedReason,
} from "./diagnosticRules.js";
import { normalizeDiagnosticSourceLocations } from "./diagnosticSourceOrdering.js";
import { hasDiagnosticOwn } from "./diagnosticRuntime.js";

export const CASUALTY_FORMULA_TEMPLATES = Object.freeze([
  {
    id: "frequency",
    version: "1.0.0",
    roles: { claims: { kind: "count" }, exposure: { kind: "exposure" } },
    numerator: { op: "role", role: "claims" },
    denominator: { op: "role", role: "exposure" },
    denominatorPolicy: "positive-or-null",
  },
  {
    id: "share",
    version: "1.0.0",
    roles: {
      part: { kind: "count", compatibilityGroup: "count-population" },
      whole: { kind: "count", compatibilityGroup: "count-population" },
    },
    numerator: { op: "role", role: "part" },
    denominator: { op: "role", role: "whole" },
    denominatorPolicy: "positive-or-null",
  },
  {
    id: "paid-to-incurred",
    version: "1.0.0",
    roles: {
      paid: {
        kind: "amount",
        compatibilityGroup: "amount-basis",
        developmentSemantics: "cumulative",
      },
      incurred: {
        kind: "amount",
        compatibilityGroup: "amount-basis",
        developmentSemantics: "cumulative",
      },
    },
    numerator: { op: "role", role: "paid" },
    denominator: { op: "role", role: "incurred" },
    denominatorPolicy: "positive-or-null",
  },
  {
    id: "amount-per-exposure",
    version: "1.0.0",
    roles: { amount: { kind: "amount" }, exposure: { kind: "exposure" } },
    numerator: { op: "role", role: "amount" },
    denominator: { op: "role", role: "exposure" },
    denominatorPolicy: "positive-or-null",
  },
  {
    id: "amount-per-claim",
    version: "1.0.0",
    roles: { amount: { kind: "amount" }, claims: { kind: "count" } },
    numerator: { op: "role", role: "amount" },
    denominator: { op: "role", role: "claims" },
    denominatorPolicy: "positive-or-null",
  },
  {
    id: "case-per-open",
    version: "1.0.0",
    roles: {
      incurred: {
        kind: "amount",
        compatibilityGroup: "amount-basis",
        developmentSemantics: "cumulative",
      },
      paid: {
        kind: "amount",
        compatibilityGroup: "amount-basis",
        developmentSemantics: "cumulative",
      },
      open: { kind: "count", developmentSemantics: "point-in-time" },
    },
    numerator: {
      op: "subtract",
      left: { op: "role", role: "incurred" },
      right: { op: "role", role: "paid" },
    },
    denominator: { op: "role", role: "open" },
    denominatorPolicy: "positive-or-null",
  },
] as const satisfies readonly DiagnosticFormulaTemplate[]);

export interface DiagnosticQuantitySemantics {
  readonly kind: DiagnosticMeasureKind;
  readonly unit: string;
  readonly basisId?: string;
  readonly countPopulationId?: string;
  readonly exposureBasisId?: string;
}

export interface DiagnosticQuantity extends DiagnosticQuantitySemantics {
  readonly value: number | null;
}

export interface DiagnosticMetricFinding {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "fail";
  readonly category:
    | "structural"
    | "aggregation"
    | "calculation"
    | "rule"
    | "presentation";
  readonly ruleId?: string;
  readonly measureId?: string;
  readonly instanceId?: string;
  readonly expressionPath?: string;
  readonly offendingKey?: string;
  readonly sourceGroup?: string;
  readonly group?: string;
  readonly origin?: string;
  readonly valuation?: string;
  readonly developmentAge?: number;
  readonly ageUnit?: string;
  readonly recordId?: string;
  readonly claimId?: string;
  readonly exposureKey?: string;
  readonly sources: readonly import("./diagnosticDefinitions.js").DiagnosticSourceLocation[];
}

export interface FinalizedDiagnosticMeasure {
  readonly quantity: DiagnosticQuantity;
  readonly stats: DiagnosticMeasureStats;
  readonly readiness: readonly DiagnosticRuleNotEvaluatedReason[];
  readonly expressionOverflows?: readonly DiagnosticExpressionOverflow[];
  readonly sources?: readonly import("./diagnosticDefinitions.js").DiagnosticSourceLocation[];
}

interface ExpressionResult {
  readonly value: number | null;
  readonly reasons: readonly DiagnosticRuleNotEvaluatedReason[];
  readonly overflows: readonly DiagnosticExpressionOverflow[];
  readonly sources: readonly import("./diagnosticDefinitions.js").DiagnosticSourceLocation[];
}

function neumaier(values: readonly number[]): number | null {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction +=
      Math.abs(sum) >= Math.abs(value)
        ? sum - next + value
        : value - next + sum;
    sum = next;
    if (!Number.isFinite(sum) || !Number.isFinite(correction)) return null;
  }
  const result = sum + correction;
  return Number.isFinite(result) ? (Object.is(result, -0) ? 0 : result) : null;
}

function uniqueReasons(
  values: readonly DiagnosticRuleNotEvaluatedReason[],
): readonly DiagnosticRuleNotEvaluatedReason[] {
  const order: readonly DiagnosticRuleNotEvaluatedReason[] = [
    "missing",
    "imputed",
    "non-finite",
    "structural-ambiguity",
    "aggregation-overflow",
    "expression-overflow",
    "tolerance-overflow",
  ];
  return order.filter((reason) => values.includes(reason));
}

function pointer(path: string, segment: string | number): string {
  const escaped = String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
  return `${path}/${escaped}`;
}

export function evaluateDiagnosticMeasureExpression(
  expression: DiagnosticDeepReadonly<DiagnosticMeasureExpression>,
  measures: Readonly<Record<string, FinalizedDiagnosticMeasure>>,
  path: string,
): ExpressionResult {
  if (expression.op === "measure") {
    const value = hasDiagnosticOwn(measures, expression.measureId)
      ? measures[expression.measureId]
      : undefined;
    return value
      ? {
          value: value.quantity.value,
          reasons: value.readiness,
          overflows: value.expressionOverflows ?? [],
          sources: value.sources ?? [],
        }
      : { value: null, reasons: ["missing"], overflows: [], sources: [] };
  }
  const children =
    expression.op === "add"
      ? expression.terms.map((term, index) =>
          evaluateDiagnosticMeasureExpression(
            term,
            measures,
            pointer(pointer(path, "terms"), index),
          ),
        )
      : [
          evaluateDiagnosticMeasureExpression(
            expression.left,
            measures,
            pointer(path, "left"),
          ),
          evaluateDiagnosticMeasureExpression(
            expression.right,
            measures,
            pointer(path, "right"),
          ),
        ];
  const reasons = uniqueReasons(children.flatMap((child) => child.reasons));
  const overflows = children.flatMap((child) => child.overflows);
  const sources = normalizeDiagnosticSourceLocations(
    children.flatMap((child) => child.sources),
  );
  if (children.some((child) => child.value === null))
    return { value: null, reasons, overflows, sources };
  const value =
    expression.op === "add"
      ? neumaier(children.map((child) => child.value!))
      : children[0]!.value! - children[1]!.value!;
  if (value === null || !Number.isFinite(value)) {
    return {
      value: null,
      reasons: uniqueReasons([...reasons, "expression-overflow"]),
      overflows: [...overflows, { expressionPath: path, sources }],
      sources,
    };
  }
  return {
    value: Object.is(value, -0) ? 0 : value,
    reasons,
    overflows,
    sources,
  };
}

export function evaluateDiagnosticRoleExpression(
  expression: DiagnosticDeepReadonly<DiagnosticRoleExpression>,
  bindings: Readonly<Record<string, ExpressionResult>>,
  path: string,
): ExpressionResult {
  if (expression.op === "role")
    return hasDiagnosticOwn(bindings, expression.role)
      ? bindings[expression.role]!
      : { value: null, reasons: ["missing"], overflows: [], sources: [] };
  const children =
    expression.op === "add"
      ? expression.terms.map((term, index) =>
          evaluateDiagnosticRoleExpression(
            term,
            bindings,
            pointer(pointer(path, "terms"), index),
          ),
        )
      : [
          evaluateDiagnosticRoleExpression(
            expression.left,
            bindings,
            pointer(path, "left"),
          ),
          evaluateDiagnosticRoleExpression(
            expression.right,
            bindings,
            pointer(path, "right"),
          ),
        ];
  const reasons = uniqueReasons(children.flatMap((child) => child.reasons));
  const overflows = children.flatMap((child) => child.overflows);
  const sources = normalizeDiagnosticSourceLocations(
    children.flatMap((child) => child.sources),
  );
  if (children.some((child) => child.value === null))
    return { value: null, reasons, overflows, sources };
  const value =
    expression.op === "add"
      ? neumaier(children.map((child) => child.value!))
      : children[0]!.value! - children[1]!.value!;
  if (value === null || !Number.isFinite(value))
    return {
      value: null,
      reasons: uniqueReasons([...reasons, "expression-overflow"]),
      overflows: [...overflows, { expressionPath: path, sources }],
      sources,
    };
  return {
    value: Object.is(value, -0) ? 0 : value,
    reasons,
    overflows,
    sources,
  };
}

export function diagnosticRawRatio(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (
    numerator === null ||
    denominator === null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  )
    return null;
  const ratio = safeRatio(numerator, denominator);
  return ratio !== null && Number.isFinite(ratio) ? ratio : null;
}

export function applyDiagnosticPresentation(
  rawValue: number | null,
  presentation: DiagnosticDeepReadonly<DiagnosticMetricPresentation>,
): {
  readonly value: number | null;
  readonly finding: DiagnosticMetricFinding | null;
} {
  if (rawValue === null) return { value: null, finding: null };
  const value = rawValue * presentation.scale;
  return Number.isFinite(value)
    ? { value: Object.is(value, -0) ? 0 : value, finding: null }
    : {
        value: null,
        finding: {
          code: "diagnostic-presentation-overflow",
          message: "Diagnostic presentation scaling overflowed",
          severity: "fail",
          category: "presentation",
          sources: [],
        },
      };
}
