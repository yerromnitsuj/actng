import { canonicalJson } from "./canonical.js";
import type {
  DiagnosticReviewRule,
  DiagnosticSourceLocation,
} from "./diagnosticDefinitions.js";
import type { PreparedDiagnosticDataContent } from "./diagnosticPreparation.js";
import type {
  DiagnosticReviewCoordinate,
  DiagnosticReviewExpressionOverflow,
  DiagnosticReviewRuleEvaluation,
  DiagnosticReviewEvaluationScope,
} from "./diagnosticReview.js";
import type { DiagnosticRuleNotEvaluatedReason } from "./diagnosticRules.js";
import {
  diagnosticJsonPreflight,
  isDiagnosticPlainRecord,
  isDiagnosticToken,
} from "./diagnosticRuntime.js";
import { DiagnosticValidationError } from "./types.js";
import {
  createDiagnosticIdentityArray,
  createDiagnosticIdentityObject,
  createDiagnosticIdentityValue,
  type DiagnosticIdentityDocument,
} from "./diagnosticIdentityStream.js";

export interface DiagnosticReviewStatusCounts {
  readonly pass: number;
  readonly warning: number;
  readonly fail: number;
  readonly notEvaluated: number;
}
export type DiagnosticReviewEffectiveStatus =
  | "pass"
  | "warning"
  | "fail"
  | "not-evaluated";
export interface CompactDiagnosticReviewRuleSummary {
  readonly ruleId: string;
  readonly start: number;
  readonly count: number;
  readonly summary: DiagnosticReviewStatusCounts;
}
declare const compactReviewBrand: unique symbol;
/** Opaque owned storage. No typed-array buffer or mutable dictionary is exposed. */
export interface CompactDiagnosticReviewEvaluations {
  readonly [compactReviewBrand]: true;
  readonly count: number;
  readonly summary: DiagnosticReviewStatusCounts;
  readonly rules: readonly CompactDiagnosticReviewRuleSummary[];
}
export interface DiagnosticReviewEvaluationQuery {
  readonly ruleId?: string;
  readonly effectiveStatus?: DiagnosticReviewEffectiveStatus;
  /** Coordinate filters match either endpoint of a valuation pair; never control-total metadata. */
  readonly sourceGroup?: string;
  readonly origin?: string;
  readonly valuation?: string;
  readonly offset?: number;
  readonly limit?: number;
}
export interface DiagnosticReviewSourceQuery {
  readonly offset?: number;
  readonly limit?: number;
  /** Omit to read scope sources; otherwise read this expression overflow's sources. */
  readonly overflowIndex?: number;
}
export interface DiagnosticReviewPage<T> {
  readonly total: number;
  readonly offset: number;
  readonly items: readonly T[];
  readonly nextOffset: number | null;
}
type ScopeSummary = DiagnosticReviewEvaluationScope extends infer S
  ? S extends DiagnosticReviewEvaluationScope
    ? Omit<S, "sources"> & { readonly sourceCount: number }
    : never
  : never;
export interface DiagnosticReviewEvaluationSummary {
  readonly index: number;
  readonly ruleId: string;
  readonly ruleKind: DiagnosticReviewRule["kind"];
  readonly status: DiagnosticReviewRuleEvaluation["status"];
  readonly effectiveStatus: DiagnosticReviewEffectiveStatus;
  readonly severity: "warning" | "fail";
  readonly left: number | null;
  readonly right: number | null;
  readonly relation: DiagnosticReviewRuleEvaluation["relation"];
  readonly triggerReason: DiagnosticReviewRuleEvaluation["triggerReason"];
  readonly notEvaluatedReasons: readonly DiagnosticRuleNotEvaluatedReason[];
  readonly expressionOverflowCount: number;
  readonly scope: ScopeSummary;
}

const CHUNK_SIZE = 4096;
const reasons: readonly DiagnosticRuleNotEvaluatedReason[] = [
  "missing",
  "imputed",
  "non-finite",
  "structural-ambiguity",
  "aggregation-overflow",
  "expression-overflow",
  "tolerance-overflow",
];
const statuses = ["pass", "triggered", "not-evaluated"] as const;
const relations = [null, "less", "equal", "greater"] as const;
const triggers = [
  null,
  "predicate",
  "missing-input",
  "aggregation-overflow",
  "expression-overflow",
  "tolerance-overflow",
] as const;
type Control = Extract<
  DiagnosticReviewEvaluationScope,
  { kind: "control-total" }
>;
interface EncodedOverflow {
  path: string;
  coordinate: number | null;
  sources: number;
}
interface Columns {
  left: Float64Array;
  right: Float64Array;
  rule: Uint32Array;
  first: Uint32Array;
  second: Uint32Array;
  sources: Uint32Array;
  flags: Uint16Array;
  reasons: Uint8Array;
}
interface State {
  count: number;
  chunks: Columns[];
  rules: PreparedDiagnosticDataContent["definition"]["definition"]["reviewRules"];
  coordinates: readonly DiagnosticReviewCoordinate[];
  sourceLocations: readonly DiagnosticSourceLocation[];
  sourceLists: readonly Uint32Array[];
  overflows: ReadonlyMap<number, readonly EncodedOverflow[]>;
  controls: ReadonlyMap<number, Omit<Control, "sources">>;
}
const states = new WeakMap<object, State>();
/** Private index guard: reject capacity overflow before any Uint32 assignment. */
export function assertCompactReviewCapacity(count: number, addition = 1): void {
  if (
    !Number.isSafeInteger(count) ||
    !Number.isSafeInteger(addition) ||
    count < 0 ||
    addition < 0 ||
    count + addition > 0xffff_ffff
  ) {
    throw new DiagnosticValidationError([
      {
        domain: "input",
        code: "expression-limit",
        path: "$",
        message: "Compact review index capacity exceeded",
      },
    ]);
  }
}
const zeroCounts = () => ({ pass: 0, warning: 0, fail: 0, notEvaluated: 0 });
function invalid(message: string, path = "$"): never {
  throw new DiagnosticValidationError([
    { domain: "input", code: "invalid-input-relationship", path, message },
  ]);
}
function stateOf(value: CompactDiagnosticReviewEvaluations): State {
  if (value === null || typeof value !== "object" || !states.has(value))
    invalid("Value is not an authentic compact diagnostic review store");
  return states.get(value)!;
}
export function assertCompactDiagnosticReviewEvaluations(
  value: unknown,
): asserts value is CompactDiagnosticReviewEvaluations {
  stateOf(value as CompactDiagnosticReviewEvaluations);
}
function checkedIndex(state: State, index: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= state.count)
    invalid("Evaluation index is outside this review", "$.index");
}
function emptyChunk(): Columns {
  return {
    left: new Float64Array(CHUNK_SIZE),
    right: new Float64Array(CHUNK_SIZE),
    rule: new Uint32Array(CHUNK_SIZE),
    first: new Uint32Array(CHUNK_SIZE),
    second: new Uint32Array(CHUNK_SIZE),
    sources: new Uint32Array(CHUNK_SIZE),
    flags: new Uint16Array(CHUNK_SIZE),
    reasons: new Uint8Array(CHUNK_SIZE),
  };
}
function effective(
  status: DiagnosticReviewRuleEvaluation["status"],
  severity: "warning" | "fail",
  overflowCount: number,
): DiagnosticReviewEffectiveStatus {
  return overflowCount > 0
    ? "fail"
    : status === "triggered"
      ? severity
      : status;
}
function increment(
  counts: ReturnType<typeof zeroCounts>,
  status: DiagnosticReviewEffectiveStatus,
): void {
  counts[status === "not-evaluated" ? "notEvaluated" : status]++;
}

/** Private constructor, used only by the authenticated core evaluator. */
export function createCompactReviewBuilder(
  rules: PreparedDiagnosticDataContent["definition"]["definition"]["reviewRules"],
  sourceOwnership?: {
    sourceKey(value: DiagnosticSourceLocation): string | undefined;
    ownsList(value: readonly DiagnosticSourceLocation[]): boolean;
  },
) {
  const chunks: Columns[] = [];
  const coordinates: DiagnosticReviewCoordinate[] = [];
  const sourceLocations: DiagnosticSourceLocation[] = [];
  const sourceLists: Uint32Array[] = [];
  const coordinateIds = new Map<string, number>();
  const sourceIds = new Map<string, number>();
  // Only this evaluator invocation's snapshots may skip canonicalization.
  // Merely freezing a caller array/object does not prove deep snapshot ownership.
  const ownedSourceIds = new WeakMap<object, number>();
  const ownedListIds = new WeakMap<readonly DiagnosticSourceLocation[], number>();
  const listIds = new Map<string, number>();
  const overflows = new Map<number, readonly EncodedOverflow[]>();
  const controls = new Map<number, Omit<Control, "sources">>();
  const ruleIds = new Map(rules.map((rule, index) => [rule.id, index]));
  const ruleCounts = rules.map(() => zeroCounts());
  const counts = zeroCounts();
  let count = 0;
  let finished = false;
  const coordinateId = (value: DiagnosticReviewCoordinate): number => {
    const key = JSON.stringify([
      value.sourceGroup,
      value.origin,
      value.valuation,
      Object.is(value.developmentAge, -0) ? "-0" : value.developmentAge,
      value.ageUnit,
    ]);
    let id = coordinateIds.get(key);
    if (id === undefined) {
      assertCompactReviewCapacity(coordinates.length);
      id = coordinates.length;
      coordinateIds.set(key, id);
      coordinates.push(Object.freeze({ ...value }));
    }
    return id;
  };
  const sourceListId = (
    values: readonly DiagnosticSourceLocation[],
  ): number => {
    assertCompactReviewCapacity(values.length, 0);
    const ownedList = sourceOwnership?.ownsList(values) ?? false;
    const knownList = ownedList ? ownedListIds.get(values) : undefined;
    if (knownList !== undefined) return knownList;
    const ids = values.map((value) => {
      const ownedKey = sourceOwnership?.sourceKey(value);
      const owned = ownedKey !== undefined;
      const known = owned ? ownedSourceIds.get(value) : undefined;
      if (known !== undefined) return known;
      const key = ownedKey ?? canonicalJson(value);
      let id = sourceIds.get(key);
      if (id === undefined) {
        assertCompactReviewCapacity(sourceLocations.length);
        id = sourceLocations.length;
        sourceIds.set(key, id);
        sourceLocations.push(Object.freeze({ ...value }));
      }
      if (owned) ownedSourceIds.set(value, id);
      return id;
    });
    // Do not construct a giant signature for high-fanout control-total evidence.
    const key = ids.length <= 64 ? ids.join(",") : undefined;
    let id = key === undefined ? undefined : listIds.get(key);
    if (id === undefined) {
      assertCompactReviewCapacity(sourceLists.length);
      id = sourceLists.length;
      if (key !== undefined) listIds.set(key, id);
      sourceLists.push(Uint32Array.from(ids));
    }
    if (ownedList) ownedListIds.set(values, id);
    return id;
  };
  return {
    append(value: DiagnosticReviewRuleEvaluation): void {
      if (finished) throw new Error("Compact review construction has finished");
      assertCompactReviewCapacity(count);
      const row = count % CHUNK_SIZE;
      if (row === 0) chunks.push(emptyChunk());
      const chunk = chunks[chunks.length - 1]!;
      const rule = ruleIds.get(value.ruleId)!;
      chunk.rule[row] = rule;
      chunk.left[row] = value.left ?? 0;
      chunk.right[row] = value.right ?? 0;
      chunk.flags[row] =
        statuses.indexOf(value.status) |
        (relations.indexOf(value.relation) << 2) |
        (triggers.indexOf(value.triggerReason) << 4) |
        (value.left === null ? 128 : 0) |
        (value.right === null ? 256 : 0);
      chunk.reasons[row] = value.notEvaluatedReasons.reduce(
        (mask, reason) => mask | (1 << reasons.indexOf(reason)),
        0,
      );
      chunk.sources[row] = sourceListId(value.scope.sources);
      if (value.scope.kind === "cell")
        chunk.first[row] = coordinateId(value.scope.cell);
      else if (value.scope.kind === "valuation-pair") {
        chunk.first[row] = coordinateId(value.scope.previous);
        chunk.second[row] = coordinateId(value.scope.current);
      } else {
        const { sources: _sources, ...control } = value.scope;
        controls.set(count, Object.freeze(control));
      }
      if (value.expressionOverflows.length)
        overflows.set(
          count,
          value.expressionOverflows.map((item) => ({
            path: item.expressionPath,
            coordinate:
              item.coordinate === null ? null : coordinateId(item.coordinate),
            sources: sourceListId(item.sources),
          })),
        );
      const status = effective(
        value.status,
        value.severity,
        value.expressionOverflows.length,
      );
      increment(counts, status);
      increment(ruleCounts[rule]!, status);
      count++;
    },
    finish(): CompactDiagnosticReviewEvaluations {
      if (finished) throw new Error("Compact review construction has finished");
      finished = true;
      let start = 0;
      const summaries = rules.map((rule, index) => {
        const summary = Object.freeze(ruleCounts[index]!);
        const length =
          summary.pass + summary.warning + summary.fail + summary.notEvaluated;
        const result = Object.freeze({
          ruleId: rule.id,
          start,
          count: length,
          summary,
        });
        start += length;
        return result;
      });
      const handle = Object.freeze({
        count,
        summary: Object.freeze(counts),
        rules: Object.freeze(summaries),
      }) as unknown as CompactDiagnosticReviewEvaluations;
      states.set(handle, {
        count,
        chunks,
        rules,
        coordinates,
        sourceLocations,
        sourceLists,
        overflows,
        controls,
      });
      return handle;
    },
  };
}

function sourceValues(
  state: State,
  id: number,
): readonly DiagnosticSourceLocation[] {
  return Object.freeze(
    Array.from(
      state.sourceLists[id]!,
      (index) => state.sourceLocations[index]!,
    ),
  );
}
function summaryAt(
  state: State,
  index: number,
): DiagnosticReviewEvaluationSummary {
  const chunk = state.chunks[Math.floor(index / CHUNK_SIZE)]!;
  const row = index % CHUNK_SIZE;
  const rule = state.rules[chunk.rule[row]!]!;
  const flags = chunk.flags[row]!;
  const status = statuses[flags & 3]!;
  const overflowCount = state.overflows.get(index)?.length ?? 0;
  const sourceCount = state.sourceLists[chunk.sources[row]!]!.length;
  const scope: ScopeSummary =
    rule.kind === "monotonic"
      ? {
          kind: "valuation-pair",
          previous: state.coordinates[chunk.first[row]!]!,
          current: state.coordinates[chunk.second[row]!]!,
          sourceCount,
        }
      : rule.kind === "control-total"
        ? { ...state.controls.get(index)!, sourceCount }
        : {
            kind: "cell",
            cell: state.coordinates[chunk.first[row]!]!,
            sourceCount,
          };
  return Object.freeze({
    index,
    ruleId: rule.id,
    ruleKind: rule.kind,
    status,
    severity: rule.severity,
    effectiveStatus: effective(status, rule.severity, overflowCount),
    left: flags & 128 ? null : chunk.left[row]!,
    right: flags & 256 ? null : chunk.right[row]!,
    relation: relations[(flags >> 2) & 3]!,
    triggerReason: triggers[(flags >> 4) & 7]!,
    notEvaluatedReasons: Object.freeze(
      reasons.filter((_, bit) => (chunk.reasons[row]! & (1 << bit)) !== 0),
    ),
    expressionOverflowCount: overflowCount,
    scope: Object.freeze(scope),
  });
}
export function getDiagnosticReviewEvaluationSummary(
  store: CompactDiagnosticReviewEvaluations,
  index: number,
): DiagnosticReviewEvaluationSummary {
  const state = stateOf(store);
  checkedIndex(state, index);
  return summaryAt(state, index);
}
/** Explicitly materializes one complete legacy-shaped evaluation, including all sources. */
export function getDiagnosticReviewEvaluation(
  store: CompactDiagnosticReviewEvaluations,
  index: number,
): DiagnosticReviewRuleEvaluation {
  const state = stateOf(store);
  checkedIndex(state, index);
  const {
    index: _index,
    effectiveStatus: _effective,
    expressionOverflowCount: _count,
    scope,
    ...base
  } = summaryAt(state, index);
  const { sourceCount: _sourceCount, ...coordinateScope } = scope;
  const chunk = state.chunks[Math.floor(index / CHUNK_SIZE)]!;
  const row = index % CHUNK_SIZE;
  const rule = state.rules[chunk.rule[row]!]!;
  const expressionOverflows: readonly DiagnosticReviewExpressionOverflow[] =
    Object.freeze(
      (state.overflows.get(index) ?? []).map((item) =>
        Object.freeze({
          expressionPath: item.path,
          coordinate:
            item.coordinate === null
              ? null
              : state.coordinates[item.coordinate]!,
          sources: sourceValues(state, item.sources),
        }),
      ),
    );
  return Object.freeze({
    ...base,
    scope: Object.freeze({
      ...coordinateScope,
      sources: sourceValues(state, chunk.sources[row]!),
    }),
    expressionOverflows,
    ...(rule.kind === "layer-order"
      ? { comparability: rule.comparability }
      : {}),
  }) as DiagnosticReviewRuleEvaluation;
}
/** Repeatable, complete, rule-major order. Retains at most the currently yielded DTO. */
export function iterateDiagnosticReviewEvaluations(
  store: CompactDiagnosticReviewEvaluations,
): IterableIterator<DiagnosticReviewRuleEvaluation> {
  const state = stateOf(store);
  return (function* () {
    for (let index = 0; index < state.count; index++)
      yield getDiagnosticReviewEvaluation(store, index);
  })();
}

/** Owner-backed complete identity; neither evaluations nor source arrays are expanded. */
export function getCompactDiagnosticReviewEvaluationsIdentityDocument(
  store: CompactDiagnosticReviewEvaluations,
): DiagnosticIdentityDocument {
  const state = stateOf(store);
  const sources = (id: number) => {
    const values = state.sourceLists[id]!;
    return createDiagnosticIdentityArray(values.length, (index) =>
      createDiagnosticIdentityValue(state.sourceLocations[values[index]!]!),
    );
  };
  return createDiagnosticIdentityArray(state.count, (index) => {
    const {
      index: _index,
      effectiveStatus: _effective,
      expressionOverflowCount: _count,
      scope,
      ...base
    } = summaryAt(state, index);
    const { sourceCount: _sources, ...scopeValues } = scope;
    const chunk = state.chunks[Math.floor(index / CHUNK_SIZE)]!;
    const row = index % CHUNK_SIZE;
    const rule = state.rules[chunk.rule[row]!]!;
    const overflow = state.overflows.get(index) ?? [];
    return createDiagnosticIdentityObject({
      ...Object.fromEntries(
        Object.entries(base).map(([key, value]) => [
          key,
          createDiagnosticIdentityValue(value),
        ]),
      ),
      scope: createDiagnosticIdentityObject({
        ...Object.fromEntries(
          Object.entries(scopeValues).map(([key, value]) => [
            key,
            createDiagnosticIdentityValue(value),
          ]),
        ),
        sources: sources(chunk.sources[row]!),
      }),
      expressionOverflows: createDiagnosticIdentityArray(
        overflow.length,
        (overflowIndex) => {
          const item = overflow[overflowIndex]!;
          return createDiagnosticIdentityObject({
            expressionPath: createDiagnosticIdentityValue(item.path),
            coordinate: createDiagnosticIdentityValue(
              item.coordinate === null
                ? null
                : state.coordinates[item.coordinate]!,
            ),
            sources: sources(item.sources),
          });
        },
      ),
      ...(rule.kind === "layer-order"
        ? { comparability: createDiagnosticIdentityValue(rule.comparability) }
        : {}),
    });
  });
}
function checkedQuery<T extends object>(
  query: T,
  allowed: readonly string[],
): T & { offset: number; limit: number } {
  const issues = diagnosticJsonPreflight(query, "input");
  if (issues.length) throw new DiagnosticValidationError(issues);
  if (
    !isDiagnosticPlainRecord(query) ||
    Object.keys(query).some((key) => !allowed.includes(key))
  )
    invalid("Invalid review page query");
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 100;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)
    invalid("Offset must be a nonnegative safe integer", "$.offset");
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    invalid("Page size must be between 1 and 1000", "$.limit");
  return { ...query, offset, limit };
}
function page<T>(
  items: T[],
  total: number,
  offset: number,
): DiagnosticReviewPage<T> {
  return Object.freeze({
    total,
    offset,
    items: Object.freeze(items),
    nextOffset: offset + items.length < total ? offset + items.length : null,
  });
}
export function pageDiagnosticReviewEvaluations(
  store: CompactDiagnosticReviewEvaluations,
  query: DiagnosticReviewEvaluationQuery = {},
): DiagnosticReviewPage<DiagnosticReviewEvaluationSummary> {
  const state = stateOf(store);
  const checked = checkedQuery(query, [
    "ruleId",
    "effectiveStatus",
    "sourceGroup",
    "origin",
    "valuation",
    "offset",
    "limit",
  ]);
  for (const key of ["ruleId", "sourceGroup", "origin", "valuation"] as const)
    if (checked[key] !== undefined && !isDiagnosticToken(checked[key]))
      invalid(`Invalid ${key} filter`, `$.${key}`);
  if (
    checked.effectiveStatus !== undefined &&
    !["pass", "warning", "fail", "not-evaluated"].includes(
      checked.effectiveStatus,
    )
  )
    invalid("Invalid effective status", "$.effectiveStatus");
  let total = 0;
  const items: DiagnosticReviewEvaluationSummary[] = [];
  const range =
    checked.ruleId === undefined
      ? { start: 0, count: state.count }
      : store.rules.find((rule) => rule.ruleId === checked.ruleId);
  if (!range) return page(items, 0, checked.offset);
  const coordinateFilter =
    checked.sourceGroup !== undefined ||
    checked.origin !== undefined ||
    checked.valuation !== undefined;
  const matches = (coordinate: DiagnosticReviewCoordinate) =>
    (checked.sourceGroup === undefined ||
      coordinate.sourceGroup === checked.sourceGroup) &&
    (checked.origin === undefined || coordinate.origin === checked.origin) &&
    (checked.valuation === undefined ||
      coordinate.valuation === checked.valuation);
  for (let index = range.start; index < range.start + range.count; index++) {
    const chunk = state.chunks[Math.floor(index / CHUNK_SIZE)]!;
    const row = index % CHUNK_SIZE;
    const rule = state.rules[chunk.rule[row]!]!;
    if (
      checked.effectiveStatus !== undefined &&
      checked.effectiveStatus !==
        effective(
          statuses[chunk.flags[row]! & 3]!,
          rule.severity,
          state.overflows.get(index)?.length ?? 0,
        )
    )
      continue;
    if (
      coordinateFilter &&
      (rule.kind === "control-total" ||
        (!matches(state.coordinates[chunk.first[row]!]!) &&
          (rule.kind !== "monotonic" ||
            !matches(state.coordinates[chunk.second[row]!]!))))
    )
      continue;
    if (total >= checked.offset && items.length < checked.limit)
      items.push(summaryAt(state, index));
    total++;
  }
  return page(items, total, checked.offset);
}
export function pageDiagnosticReviewEvaluationSources(
  store: CompactDiagnosticReviewEvaluations,
  index: number,
  query: DiagnosticReviewSourceQuery = {},
): DiagnosticReviewPage<DiagnosticSourceLocation> {
  const state = stateOf(store);
  checkedIndex(state, index);
  const checked = checkedQuery(query, ["offset", "limit", "overflowIndex"]);
  const overflowIndex = checked.overflowIndex;
  if (
    overflowIndex !== undefined &&
    (!Number.isSafeInteger(overflowIndex) ||
      overflowIndex < 0 ||
      overflowIndex >= (state.overflows.get(index)?.length ?? 0))
  )
    invalid("Overflow index is outside this evaluation", "$.overflowIndex");
  const chunk = state.chunks[Math.floor(index / CHUNK_SIZE)]!;
  const sourceList =
    overflowIndex === undefined
      ? chunk.sources[index % CHUNK_SIZE]!
      : state.overflows.get(index)![overflowIndex]!.sources;
  const ids = state.sourceLists[sourceList]!;
  return page(
    Array.from(
      ids.subarray(checked.offset, checked.offset + checked.limit),
      (id) => state.sourceLocations[id]!,
    ),
    ids.length,
    checked.offset,
  );
}
