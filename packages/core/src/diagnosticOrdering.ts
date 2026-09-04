import { canonicalJson } from "./canonical.js";
import type {
  DiagnosticMeasureContribution,
  DiagnosticStructuralBlocker,
} from "./diagnosticAggregation.js";
import type { DiagnosticMetricFinding } from "./diagnosticFormulas.js";
import { compareDiagnosticSourceLocations } from "./diagnosticSourceOrdering.js";
import type { DiagnosticSourceLocation } from "./diagnosticDefinitions.js";

/** Section 15 total order, for values already validated by a public boundary. */
export function compareDiagnosticIdentityValues(
  left: unknown,
  right: unknown,
): number {
  if (left === right) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  if (typeof left === "boolean" && typeof right === "boolean")
    return Number(left) - Number(right);
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const comparison = compareDiagnosticIdentityValues(left[i], right[i]);
      if (comparison !== 0) return comparison;
    }
    return left.length - right.length;
  }
  const a = typeof left === "string" ? left : canonicalJson(left);
  const b = typeof right === "string" ? right : canonicalJson(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareSources(
  left: readonly DiagnosticSourceLocation[],
  right: readonly DiagnosticSourceLocation[],
): number {
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const comparison = compareDiagnosticSourceLocations(left[i]!, right[i]!);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

export function compareDiagnosticFindings(
  left: DiagnosticMetricFinding,
  right: DiagnosticMetricFinding,
): number {
  const fields = [
    "category",
    "severity",
    "code",
    "ruleId",
    "instanceId",
    "measureId",
    "expressionPath",
    "sourceGroup",
    "group",
    "origin",
    "valuation",
    "developmentAge",
    "ageUnit",
    "recordId",
    "claimId",
    "exposureKey",
    "message",
  ] as const;
  return (
    compareDiagnosticIdentityValues(
      fields.map((key) => left[key]),
      fields.map((key) => right[key]),
    ) ||
    compareDiagnosticIdentityValues(left.offendingKey, right.offendingKey) ||
    compareSources(left.sources, right.sources)
  );
}

export function compareDiagnosticContributions(
  left: DiagnosticMeasureContribution,
  right: DiagnosticMeasureContribution,
): number {
  return (
    compareDiagnosticIdentityValues(
      [left.sourceId, left.status, left.deduplicated],
      [right.sourceId, right.status, right.deduplicated],
    ) ||
    compareSources(left.sources, right.sources) ||
    compareDiagnosticIdentityValues(left, right)
  );
}

export function compareDiagnosticBlockers(
  left: DiagnosticStructuralBlocker,
  right: DiagnosticStructuralBlocker,
): number {
  return (
    compareDiagnosticIdentityValues(
      [left.code, left.message, left.sourceIds],
      [right.code, right.message, right.sourceIds],
    ) ||
    compareSources(left.sources, right.sources) ||
    compareDiagnosticIdentityValues(left.finding, right.finding)
  );
}
