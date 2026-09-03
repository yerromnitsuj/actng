import { getCompiledDiagnosticDefinitionInternals, type DiagnosticReviewRule, type DiagnosticSourceLocation } from "./diagnosticDefinitions.js";
import { evaluateDiagnosticMeasureExpression, type FinalizedDiagnosticMeasure } from "./diagnosticFormulas.js";
import { assertPreparedDiagnosticData, type PreparedDiagnosticData } from "./diagnosticPreparation.js";
import { classifyDiagnosticComparison, diagnosticPredicateMatches, type DiagnosticRuleNotEvaluatedReason } from "./diagnosticRules.js";

export interface DiagnosticReviewCoordinate { readonly sourceGroup: string; readonly origin: string; readonly valuation: string; readonly developmentAge: number; readonly ageUnit: string }
export type DiagnosticReviewEvaluationScope =
  | { readonly kind: "cell"; readonly coordinate: DiagnosticReviewCoordinate; readonly sources: readonly DiagnosticSourceLocation[] }
  | { readonly kind: "valuation-pair"; readonly previous: DiagnosticReviewCoordinate; readonly current: DiagnosticReviewCoordinate; readonly sources: readonly DiagnosticSourceLocation[] }
  | { readonly kind: "control-total"; readonly selectedCellCount: number; readonly selectedContributionCount: number; readonly sources: readonly DiagnosticSourceLocation[] };
export interface DiagnosticReviewRuleEvaluation {
  readonly ruleId: string;
  readonly kind: DiagnosticReviewRule["kind"];
  readonly status: "pass" | "triggered" | "not-evaluated";
  readonly severity: "warning" | "fail";
  readonly triggerReason: "predicate" | "missing-input" | null;
  readonly left: number | null;
  readonly right: number | null;
  readonly relation: "less" | "equal" | "greater" | null;
  readonly notEvaluatedReasons: readonly DiagnosticRuleNotEvaluatedReason[];
  readonly expressionOverflows: readonly { readonly expressionPath: string; readonly sources: readonly DiagnosticSourceLocation[] }[];
  readonly reviewScope: DiagnosticReviewEvaluationScope;
}

function states(prepared: PreparedDiagnosticData, components: typeof prepared.cells[number]["components"]): Record<string, FinalizedDiagnosticMeasure> {
  const internals = getCompiledDiagnosticDefinitionInternals(prepared.definition);
  return Object.fromEntries(Object.entries(components).map(([id, stats]) => {
    const measure = internals.measuresById.get(id)!;
    const readiness: DiagnosticRuleNotEvaluatedReason[] = [];
    if (stats.missing) readiness.push(stats.imputedZero ? "imputed" : "missing");
    if (stats.nonFinite) readiness.push("non-finite");
    if (stats.structural) readiness.push("structural-ambiguity");
    if (stats.sum === null && !stats.nonFinite && !stats.structural) readiness.push("aggregation-overflow");
    return [id, { quantity: { kind: measure.kind, unit: measure.unit, value: stats.value }, stats, readiness }];
  }));
}

function coordinate(cell: PreparedDiagnosticData["cells"][number]): DiagnosticReviewCoordinate { return { sourceGroup: cell.sourceGroup, origin: cell.origin, valuation: cell.valuation, developmentAge: cell.developmentAge, ageUnit: cell.ageUnit } }

function evaluation(rule: DiagnosticReviewRule, scope: DiagnosticReviewEvaluationScope, left: number|null, right: number|null, asserted: boolean, reasons: readonly DiagnosticRuleNotEvaluatedReason[] = []): DiagnosticReviewRuleEvaluation {
  if (left === null || right === null || reasons.length) return { ruleId: rule.id, kind: rule.kind, status: rule.missingInput === "finding" ? "triggered" : "not-evaluated", severity: rule.severity, triggerReason: rule.missingInput === "finding" ? "missing-input" : null, left, right, relation: null, notEvaluatedReasons: reasons.length ? reasons : ["missing"], expressionOverflows: [], reviewScope: scope };
  const compared = classifyDiagnosticComparison(left, right, rule.tolerance);
  if (compared.status === "not-evaluated") return { ruleId: rule.id, kind: rule.kind, status: "not-evaluated", severity: rule.severity, triggerReason: null, left, right, relation: null, notEvaluatedReasons: [compared.reason], expressionOverflows: [], reviewScope: scope };
  return { ruleId: rule.id, kind: rule.kind, status: asserted ? "pass" : "triggered", severity: rule.severity, triggerReason: asserted ? null : "predicate", left, right, relation: compared.relation, notEvaluatedReasons: [], expressionOverflows: [], reviewScope: scope };
}

/** Evaluates definition-owned semantic review rules over authenticated prepared cells. */
export function evaluateDiagnosticReviewRules(prepared: PreparedDiagnosticData): readonly DiagnosticReviewRuleEvaluation[] {
  assertPreparedDiagnosticData(prepared);
  const results: DiagnosticReviewRuleEvaluation[] = [];
  for (const rule of prepared.definition.definition.reviewRules as readonly DiagnosticReviewRule[]) {
    if (rule.kind === "control-total") {
      const values = prepared.cells.map((cell) => evaluateDiagnosticMeasureExpression(rule.expression, states(prepared, cell.components), "$.reviewRules.control-total").value);
      const left = values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + value!, 0);
      const scope = { kind: "control-total" as const, selectedCellCount: prepared.cells.length, selectedContributionCount: prepared.cells.reduce((sum, cell) => sum + Object.values(cell.contributions).reduce((n, items) => n + items.length, 0), 0), sources: [] };
      const classified = classifyDiagnosticComparison(left, rule.expected, rule.tolerance);
      results.push(evaluation(rule, scope, left, rule.expected, classified.status === "evaluated" && classified.relation === "equal"));
      continue;
    }
    if (rule.kind === "monotonic") {
      const groups = new Map<string, typeof prepared.cells>();
      for (const cell of prepared.cells) { const key=`${cell.sourceGroup}\0${cell.origin}`; groups.set(key,[...(groups.get(key)??[]),cell]); }
      for (const cells of groups.values()) {
        const sorted=[...cells].sort((a,b)=>a.developmentAge-b.developmentAge);
        for(let index=1;index<sorted.length;index++){
          const previous=sorted[index-1]!,current=sorted[index]!;
          const left=evaluateDiagnosticMeasureExpression(rule.expression,states(prepared,previous.components),"$.reviewRules.monotonic").value;
          const right=evaluateDiagnosticMeasureExpression(rule.expression,states(prepared,current.components),"$.reviewRules.monotonic").value;
          results.push(evaluation(rule,{kind:"valuation-pair",previous:coordinate(previous),current:coordinate(current),sources:[]},left,right,rule.direction==="nondecreasing"?left!==null&&right!==null&&left<=right:left!==null&&right!==null&&left>=right));
        }
      }
      continue;
    }
    for (const cell of prepared.cells) {
      const state=states(prepared,cell.components); const scope={kind:"cell" as const,coordinate:coordinate(cell),sources:[]};
      if(rule.kind==="compare"){
        const operand=(item:typeof rule.when.left)=>item.op==="constant"?item.value:evaluateDiagnosticMeasureExpression(item,state,"$.reviewRules.compare").value;
        const left=operand(rule.when.left),right=operand(rule.when.right);const classified=classifyDiagnosticComparison(left,right,rule.tolerance);
        results.push(evaluation(rule,scope,left,right,classified.status==="evaluated"&&!diagnosticPredicateMatches(rule.when.operator,classified.relation)));
      } else if(rule.kind==="reconcile"){
        const left=evaluateDiagnosticMeasureExpression(rule.actual,state,"$.reviewRules.reconcile.actual").value;
        const right=rule.expected.op==="constant"?rule.expected.value:evaluateDiagnosticMeasureExpression(rule.expected,state,"$.reviewRules.reconcile.expected").value;
        const classified=classifyDiagnosticComparison(left,right,rule.tolerance);results.push(evaluation(rule,scope,left,right,classified.status==="evaluated"&&classified.relation==="equal"));
      } else {
        const left=evaluateDiagnosticMeasureExpression(rule.narrower,state,"$.reviewRules.layer.narrower").value;const right=evaluateDiagnosticMeasureExpression(rule.broader,state,"$.reviewRules.layer.broader").value;
        results.push(evaluation(rule,scope,left,right,left!==null&&right!==null&&left<=right));
      }
    }
  }
  return Object.freeze(results.map((item) => Object.freeze(item)));
}
