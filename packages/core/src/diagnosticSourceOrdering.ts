import { canonicalJson } from "./canonical.js";
import type { DiagnosticSourceLocation } from "./diagnosticDefinitions.js";
import { normalizeDiagnosticNumber } from "./diagnosticRuntime.js";

function codeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function optional<T>(
  left: T | undefined,
  right: T | undefined,
  compare: (a: T, b: T) => number,
): number {
  if (left === undefined) return right === undefined ? 0 : -1;
  if (right === undefined) return 1;
  return compare(left, right);
}

/** Contract comparator for source provenance; source rows compare numerically. */
export function compareDiagnosticSourceLocations(
  left: DiagnosticSourceLocation,
  right: DiagnosticSourceLocation,
): number {
  return (
    codeUnit(left.artifactId, right.artifactId) ||
    optional(left.sourceFile, right.sourceFile, codeUnit) ||
    optional(left.sourceSheet, right.sourceSheet, codeUnit) ||
    optional(left.sourceRow, right.sourceRow, (a, b) => a - b) ||
    optional(left.sourceCell, right.sourceCell, codeUnit)
  );
}

/** Exact-deduplicates, snapshots, and contract-sorts source provenance. */
export function normalizeDiagnosticSourceLocations(
  values: readonly (DiagnosticSourceLocation | null | undefined)[],
): DiagnosticSourceLocation[] {
  const unique = new Map<string, DiagnosticSourceLocation>();
  for (const value of values)
    if (value !== null && value !== undefined) {
      const normalized = {
        ...value,
        ...(value.sourceRow === undefined
          ? {}
          : { sourceRow: normalizeDiagnosticNumber(value.sourceRow) }),
      };
      const key = canonicalJson(normalized);
      if (!unique.has(key)) unique.set(key, normalized);
    }
  return [...unique.values()].sort(compareDiagnosticSourceLocations);
}
