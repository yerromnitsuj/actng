import {
  assertCompiledDiagnosticDefinition,
  getCompiledDiagnosticDefinitionInternals,
  type CompiledDiagnosticDefinition,
} from "./diagnosticDefinitions.js";
import type { DiagnosticClaimExpression } from "./diagnosticExpressions.js";
import { DiagnosticValidationError, type DiagnosticValidationIssue } from "./types.js";

export type DiagnosticMeasureValues = Readonly<Record<string, number | null>>;

export type DiagnosticRowWithDerivedMeasures<TRow extends { measures: DiagnosticMeasureValues }> =
  Omit<TRow, "measures"> & { readonly measures: DiagnosticMeasureValues };

function evaluateClaimExpression(
  expression: DiagnosticClaimExpression,
  measures: Readonly<Record<string, number | null>>,
): number | null {
  if (expression.op === "measure") {
    const value = measures[expression.measureId];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  if (expression.op === "claim-layer") {
    const value = measures[expression.measureId];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const excess = Math.max(value - expression.attachment, 0);
    const result = expression.limit === null ? excess : Math.min(excess, expression.limit);
    return Number.isFinite(result) ? (Object.is(result, -0) ? 0 : result) : null;
  }
  if (expression.op === "subtract") {
    const left = evaluateClaimExpression(expression.left, measures);
    const right = evaluateClaimExpression(expression.right, measures);
    if (left === null || right === null) return null;
    const result = left - right;
    return Number.isFinite(result) ? (Object.is(result, -0) ? 0 : result) : null;
  }
  let sum = 0;
  let correction = 0;
  for (const term of expression.terms) {
    const value = evaluateClaimExpression(term, measures);
    if (value === null) return null;
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
    if (!Number.isFinite(sum) || !Number.isFinite(correction)) return null;
  }
  const result = sum + correction;
  return Number.isFinite(result) ? (Object.is(result, -0) ? 0 : result) : null;
}

/** Materializes compiler-approved claim-level measures without mutating caller rows. */
export function deriveDiagnosticClaimMeasures<TRow extends { measures: DiagnosticMeasureValues }>(
  rows: readonly TRow[],
  definition: CompiledDiagnosticDefinition,
): readonly DiagnosticRowWithDerivedMeasures<TRow>[] {
  assertCompiledDiagnosticDefinition(definition);
  const internals = getCompiledDiagnosticDefinitionInternals(definition);
  const issues: DiagnosticValidationIssue[] = [];
  if (definition.definition.lossRowGrain !== "claim") {
    issues.push({ domain: "input", code: "invalid-input-relationship", path: "$.definition.lossRowGrain", message: "Claim derivation requires a claim-grain definition" });
  }
  if (!Array.isArray(rows)) {
    issues.push({ domain: "input", code: "invalid-type", path: "$.rows", message: "Claim rows must be an array" });
  } else {
    rows.forEach((row, rowIndex) => {
      const measures = row?.measures;
      if (measures === null || typeof measures !== "object" || Array.isArray(measures)) {
        issues.push({ domain: "input", code: "invalid-type", path: `$.rows[${rowIndex}].measures`, message: "Row measures must be a plain record" });
        return;
      }
      for (const [measureId, value] of Object.entries(measures)) {
        const measure = internals.measuresById.get(measureId);
        const path = `$.rows[${rowIndex}].measures[${JSON.stringify(measureId)}]`;
        if (!measure) issues.push({ domain: "input", code: "unknown-reference", path, message: `Unknown measure ${measureId}` });
        else if (measure.source !== "loss") issues.push({ domain: "input", code: "invalid-input-relationship", path, message: `Caller rows cannot supply ${measure.source} measure ${measureId}` });
        if (value !== null && typeof value !== "number") issues.push({ domain: "input", code: "invalid-type", path, message: "Measure value must be a number or null" });
      }
    });
  }
  if (issues.length > 0) throw new DiagnosticValidationError(issues);

  const plan = [...internals.derivationsByOutputMeasureId.values()];
  return Object.freeze(rows.map((row) => {
    const measures: Record<string, number | null> = { ...row.measures };
    for (const derivation of plan) {
      measures[derivation.outputMeasureId] = evaluateClaimExpression(derivation.expression, measures);
    }
    return Object.freeze({ ...row, measures: Object.freeze(measures) }) as DiagnosticRowWithDerivedMeasures<TRow>;
  }));
}
