import type { DiagnosticSourceLocation } from "./diagnosticDefinitions.js";

export interface DiagnosticExposureObservation {
  readonly key: string;
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation?: string;
  readonly measureId: string;
  readonly value: number | null;
  readonly complete: boolean;
  readonly source?: DiagnosticSourceLocation;
}

export type DiagnosticAuditedNumericValue =
  | { readonly status: "observed"; readonly value: number }
  | { readonly status: "missing"; readonly value: null }
  | { readonly status: "non-finite"; readonly value: null; readonly nonFiniteKind: "nan" | "positive-infinity" | "negative-infinity" };

export interface DiagnosticExposureAuditObservation {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation?: string;
  readonly value: DiagnosticAuditedNumericValue;
  readonly complete: boolean;
  readonly source?: DiagnosticSourceLocation;
}

export type ReconciledDiagnosticExposure =
  | { readonly measureId: string; readonly key: string; readonly status: "valid"; readonly sourceGroup: string; readonly origin: string; readonly valuation?: string; readonly value: number; readonly deduplicated: number; readonly sources: readonly DiagnosticSourceLocation[] }
  | { readonly measureId: string; readonly key: string; readonly status: "invalid"; readonly issues: readonly ("missing" | "incomplete" | "non-finite" | "duplicate" | "conflict")[]; readonly value: null; readonly observations: readonly DiagnosticExposureAuditObservation[] };

export function auditDiagnosticNumber(value: number | null): DiagnosticAuditedNumericValue {
  if (value === null) return { status: "missing", value: null };
  if (!Number.isFinite(value)) return { status: "non-finite", value: null, nonFiniteKind: Number.isNaN(value) ? "nan" : value > 0 ? "positive-infinity" : "negative-infinity" };
  return { status: "observed", value: Object.is(value, -0) ? 0 : value };
}

function equalAudit(left: DiagnosticExposureAuditObservation, right: DiagnosticExposureAuditObservation): boolean {
  return left.sourceGroup === right.sourceGroup && left.origin === right.origin && left.complete === right.complete &&
    JSON.stringify(left.value) === JSON.stringify(right.value);
}

export function reconcileDiagnosticExposures(
  observations: readonly DiagnosticExposureObservation[],
  timingByMeasure: Readonly<Record<string, "origin-static" | "valuation-specific">>,
): readonly ReconciledDiagnosticExposure[] {
  const cohorts = new Map<string, DiagnosticExposureObservation[]>();
  for (const observation of observations) {
    const timing = timingByMeasure[observation.measureId];
    const identity = timing === "valuation-specific"
      ? `${observation.measureId}\u0000${observation.key}\u0000${observation.valuation ?? ""}`
      : `${observation.measureId}\u0000${observation.key}`;
    const cohort = cohorts.get(identity) ?? [];
    cohort.push(observation);
    cohorts.set(identity, cohort);
  }
  return Object.freeze([...cohorts.values()].map((cohort): ReconciledDiagnosticExposure => {
    const first = cohort[0]!;
    const timing = timingByMeasure[first.measureId];
    const audited = cohort.map((item): DiagnosticExposureAuditObservation => ({
      sourceGroup: item.sourceGroup,
      origin: item.origin,
      ...(item.valuation === undefined ? {} : { valuation: item.valuation }),
      value: auditDiagnosticNumber(item.value),
      complete: item.complete,
      ...(item.source === undefined ? {} : { source: item.source }),
    }));
    const issues: ("missing" | "incomplete" | "non-finite" | "duplicate" | "conflict")[] = [];
    if (audited.some((item) => item.value.status === "missing")) issues.push("missing");
    if (audited.some((item) => !item.complete)) issues.push("incomplete");
    if (audited.some((item) => item.value.status === "non-finite")) issues.push("non-finite");
    if (timing === "valuation-specific" && audited.length > 1) issues.push("duplicate");
    if (audited.slice(1).some((item) => !equalAudit(audited[0]!, item))) issues.push("conflict");
    const validStaticCopies = timing === "origin-static" && issues.length === 0;
    if (issues.length > 0) return Object.freeze({ measureId: first.measureId, key: first.key, status: "invalid", issues: Object.freeze(issues), value: null, observations: Object.freeze(audited) });
    const value = audited[0]!.value;
    if (value.status !== "observed") throw new Error("unreachable invalid exposure state");
    const sources = audited.flatMap((item) => item.source ? [item.source] : []).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return Object.freeze({
      measureId: first.measureId,
      key: first.key,
      status: "valid",
      sourceGroup: first.sourceGroup,
      origin: first.origin,
      ...(timing === "valuation-specific" ? { valuation: first.valuation! } : {}),
      value: value.value,
      deduplicated: validStaticCopies ? audited.length - 1 : 0,
      sources: Object.freeze(sources),
    });
  }).sort((left, right) => `${left.measureId}\u0000${left.key}` < `${right.measureId}\u0000${right.key}` ? -1 : 1));
}
