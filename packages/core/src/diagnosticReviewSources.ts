import { canonicalJson } from "./canonical.js";
import type { DiagnosticSourceLocation } from "./diagnosticDefinitions.js";
import {
  compareDiagnosticSourceLocations,
  normalizeDiagnosticSourceLocations,
} from "./diagnosticSourceOrdering.js";

/**
 * Private, invocation-owned evidence interner. Only the authenticated review
 * evaluator registers preparation sources: its preparation is deeply frozen.
 * Neither this pool nor its bookkeeping is retained on the result or a cell.
 */
export function createDiagnosticReviewSourcePool() {
  type SourceEntry = { key: string; value: DiagnosticSourceLocation };
  const preparedSources = new WeakMap<object, SourceEntry>();
  const ownedSources = new WeakMap<object, SourceEntry>();
  const ownedLists = new WeakSet<readonly DiagnosticSourceLocation[]>();
  const sourceEntry = (
    value: DiagnosticSourceLocation,
    fromPrepared: boolean,
  ): SourceEntry => {
    const previous =
      ownedSources.get(value) ??
      (fromPrepared ? preparedSources.get(value) : undefined);
    if (previous) return previous;
    // Preserve the authoritative full-value contract, including extra own
    // data. An artifact/file/sheet/row tuple is not an exact-value substitute.
    const normalized = normalizeDiagnosticSourceLocations([value])[0]!;
    const key = canonicalJson(normalized);
    // Fresh/unrecognized expression evidence takes the value path every time.
    // Its children may be caller-owned even if the outer source was frozen.
    if (!fromPrepared) return { key, value: normalized };
    // Deduplicate by canonical value only inside each ordered union below.
    // Across subsets, equal canonical keys can still have different original
    // representatives (for example -0/+0 in extra own data). Keep the snapshot
    // associated with each prepared source so the first occurrence still wins.
    const entry = { key, value: Object.freeze(normalized) };
    ownedSources.set(entry.value, entry);
    preparedSources.set(value, entry);
    return entry;
  };
  const collection = () => {
    const entries = new Map<string, DiagnosticSourceLocation>();
    let owned = true;
    return {
      /** `fromPrepared` is private evaluator authority, not an input option. */
      add(value: DiagnosticSourceLocation, fromPrepared: boolean): void {
        const entry = sourceEntry(value, fromPrepared);
        owned &&= ownedSources.has(entry.value);
        if (!entries.has(entry.key)) entries.set(entry.key, entry.value);
      },
      finish(): readonly DiagnosticSourceLocation[] {
        const values = Object.freeze(
          [...entries.values()].sort(compareDiagnosticSourceLocations),
        );
        if (owned) ownedLists.add(values);
        return values;
      },
    };
  };
  const union = (
    lists: readonly (readonly DiagnosticSourceLocation[])[],
  ): readonly DiagnosticSourceLocation[] => {
    const target = collection();
    for (const values of lists)
      for (const source of values) target.add(source, false);
    return target.finish();
  };
  const forPreparedSources = (
    values: readonly DiagnosticSourceLocation[],
  ): readonly DiagnosticSourceLocation[] => {
    const target = collection();
    for (const source of values) target.add(source, true);
    return target.finish();
  };
  return {
    collection,
    union,
    forPreparedSources,
    // Ownership means this invocation's snapshots, not Object.isFrozen on an
    // arbitrary caller array/object. The builder uses these only while appending.
    sourceKey: (value: DiagnosticSourceLocation) => ownedSources.get(value)?.key,
    ownsList: (value: readonly DiagnosticSourceLocation[]) => ownedLists.has(value),
  };
}
