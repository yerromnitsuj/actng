import type { DiagnosticMeasureStats, DiagnosticMissingPolicy, DiagnosticSourceLocation } from "./diagnosticDefinitions.js";

export interface DiagnosticStructuralBlocker {
  readonly code: string;
  readonly message: string;
  readonly sourceIds: readonly string[];
  readonly sources: readonly DiagnosticSourceLocation[];
}

export interface DiagnosticMeasureContributionBase {
  readonly sourceId: string;
  readonly sources: readonly DiagnosticSourceLocation[];
  readonly deduplicated: number;
}

export type DiagnosticMeasureContribution =
  | (DiagnosticMeasureContributionBase & { readonly status: "observed"; readonly value: number })
  | (DiagnosticMeasureContributionBase & { readonly status: "imputed-zero"; readonly value: 0 })
  | (DiagnosticMeasureContributionBase & { readonly status: "missing"; readonly value: null })
  | (DiagnosticMeasureContributionBase & { readonly status: "non-finite"; readonly value: null; readonly nonFiniteKind: "nan" | "positive-infinity" | "negative-infinity" });

export function auditedDiagnosticContribution(
  sourceId: string,
  value: number | null | undefined,
  missing: DiagnosticMissingPolicy,
  sources: readonly DiagnosticSourceLocation[] = [],
  deduplicated = 0,
): DiagnosticMeasureContribution {
  const base = { sourceId, sources: Object.freeze([...sources]), deduplicated } as const;
  if (value === null || value === undefined) return missing === "zero"
    ? Object.freeze({ ...base, status: "imputed-zero" as const, value: 0 as const })
    : Object.freeze({ ...base, status: "missing" as const, value: null });
  if (!Number.isFinite(value)) return Object.freeze({
    ...base,
    status: "non-finite" as const,
    value: null,
    nonFiniteKind: Number.isNaN(value) ? "nan" as const : value > 0 ? "positive-infinity" as const : "negative-infinity" as const,
  });
  return Object.freeze({ ...base, status: "observed" as const, value: Object.is(value, -0) ? 0 : value });
}

function neumaier(values: readonly number[]): number | null {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
    if (!Number.isFinite(sum) || !Number.isFinite(correction)) return null;
  }
  const result = sum + correction;
  return Number.isFinite(result) ? (Object.is(result, -0) ? 0 : result) : null;
}

export function finalizeDiagnosticContributions(
  contributions: readonly DiagnosticMeasureContribution[],
  missingPolicy: DiagnosticMissingPolicy,
  blockers: readonly DiagnosticStructuralBlocker[] = [],
): DiagnosticMeasureStats {
  const ordered = [...contributions].sort((left, right) => left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0);
  const observed = ordered.filter((item) => item.status === "observed");
  const imputed = ordered.filter((item) => item.status === "imputed-zero");
  const missing = ordered.filter((item) => item.status === "missing").length + imputed.length;
  const nonFinite = ordered.filter((item) => item.status === "non-finite").length;
  const finiteSum = neumaier([...observed.map((item) => item.value), ...imputed.map(() => 0)]);
  const blocked = blockers.length > 0;
  const sum = nonFinite > 0 || blocked || finiteSum === null ? null : finiteSum;
  const value = sum === null || (missingPolicy === "unknown" && missing > 0) ? null : sum;
  return Object.freeze({
    value,
    sum,
    observed: observed.length,
    missing,
    nonFinite,
    imputedZero: imputed.length,
    deduplicated: ordered.reduce((total, item) => total + item.deduplicated, 0),
    structural: blockers.length,
  });
}
