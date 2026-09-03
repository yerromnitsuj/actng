import type { DiagnosticComparisonPredicate, DiagnosticSourceLocation } from "./diagnosticDefinitions.js";

export type DiagnosticComparisonClassification =
  | { readonly status: "evaluated"; readonly relation: "less" | "equal" | "greater" }
  | { readonly status: "not-evaluated"; readonly reason: "missing" | "non-finite" | "tolerance-overflow" };

export type DiagnosticRuleNotEvaluatedReason =
  | "missing"
  | "imputed"
  | "non-finite"
  | "structural-ambiguity"
  | "aggregation-overflow"
  | "expression-overflow"
  | "tolerance-overflow";

export interface DiagnosticExpressionOverflow {
  readonly expressionPath: string;
  readonly sources: readonly DiagnosticSourceLocation[];
}

export interface DiagnosticRuleEvaluation {
  readonly ruleId: string;
  readonly status: "pass" | "triggered" | "not-evaluated";
  readonly severity: "warning" | "fail";
  readonly left: number | null;
  readonly right: number | null;
  readonly relation: "less" | "equal" | "greater" | null;
  readonly notEvaluatedReasons: readonly DiagnosticRuleNotEvaluatedReason[];
  readonly expressionOverflows: readonly DiagnosticExpressionOverflow[];
  readonly code: string | null;
  readonly message: string | null;
}

/** Pure, overflow-safe three-way comparison shared by metric and review rules. */
export function classifyDiagnosticComparison(
  left: number | null,
  right: number | null,
  tolerance: { readonly absolute?: number; readonly relative?: number } = {},
): DiagnosticComparisonClassification {
  if (left === null || right === null) return { status: "not-evaluated", reason: "missing" };
  if (!Number.isFinite(left) || !Number.isFinite(right)) return { status: "not-evaluated", reason: "non-finite" };
  const absolute = tolerance.absolute ?? 0;
  const relative = tolerance.relative ?? 0;
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  const relativeTolerance = relative * scale;
  const totalTolerance = absolute + relativeTolerance;
  if (!Number.isFinite(absolute) || absolute < 0 || !Number.isFinite(relative) || relative < 0 ||
      !Number.isFinite(relativeTolerance) || !Number.isFinite(totalTolerance)) {
    return { status: "not-evaluated", reason: "tolerance-overflow" };
  }
  if (left === right) return { status: "evaluated", relation: "equal" };
  const distance = left > right ? left - right : right - left;
  if (Number.isFinite(distance) && distance <= totalTolerance) {
    return { status: "evaluated", relation: "equal" };
  }
  return { status: "evaluated", relation: left < right ? "less" : "greater" };
}

export function diagnosticPredicateMatches(
  predicate: DiagnosticComparisonPredicate["operator"],
  relation: "less" | "equal" | "greater",
): boolean {
  return predicate === "lt" ? relation === "less"
    : predicate === "lte" ? relation !== "greater"
      : predicate === "eq" ? relation === "equal"
        : predicate === "neq" ? relation !== "equal"
          : predicate === "gte" ? relation !== "less"
            : relation === "greater";
}
