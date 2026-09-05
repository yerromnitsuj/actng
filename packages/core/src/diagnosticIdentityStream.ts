import { projectDiagnosticIdentity } from "./diagnosticIdentity.js";
import {
  MAX_DIAGNOSTIC_JSON_DEPTH,
  isDiagnosticPlainRecord,
  isDiagnosticToken,
  isWellFormedDiagnosticString,
} from "./diagnosticRuntime.js";
import { createFnvAccumulator } from "./fnvAccumulator.js";
import { DiagnosticValidationError, type DiagnosticValidationIssue } from "./types.js";

declare const documentBrand: unique symbol;
/**
 * A structural serialization descriptor, NOT proof of diagnostic authenticity.
 * Values and sequence callbacks are live views, not snapshots. Re-iteration
 * observes later mutations. Compliance must obtain documents from genuine
 * prepared/review/completed-run owners, never trust an arbitrary document.
 */
export interface DiagnosticIdentityDocument {
  readonly [documentBrand]: true;
}

type Node =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "object"; readonly fields: Fields }
  | {
      readonly kind: "array";
      readonly count: number;
      readonly itemAt: (index: number) => DiagnosticIdentityDocument;
    };
type Mode = { readonly sourceSlot: boolean; readonly freeJson: boolean };
const plainMode: Mode = { sourceSlot: false, freeJson: false };
const sourceMode: Mode = { sourceSlot: true, freeJson: false };
const freeMode: Mode = { sourceSlot: false, freeJson: true };
/** Sorted sibling snapshots; raw children do not need public descriptor brands. */
interface Fields {
  readonly keys: readonly string[];
  readonly values: readonly unknown[];
  readonly documents: boolean;
}
const nodes = new WeakMap<DiagnosticIdentityDocument, Node>();
const CHUNK_UNITS = 16_384;
const QUOTE_UNITS = 4_096;

function fail(
  path: string,
  message: string,
  code: DiagnosticValidationIssue["code"] = "invalid-json-value",
): never {
  throw new DiagnosticValidationError([{ domain: "input", code, path, message }]);
}
function descriptor(node: Node): DiagnosticIdentityDocument {
  const document = Object.freeze({}) as DiagnosticIdentityDocument;
  nodes.set(document, node);
  return document;
}
function readDocument(value: DiagnosticIdentityDocument, path: string): Node {
  if (value === null || typeof value !== "object" || !nodes.has(value))
    fail(path, "Value is not a diagnostic identity serialization descriptor", "invalid-type");
  return nodes.get(value)!;
}

/** A live projected view; construction neither clones nor freezes caller data. */
export function createDiagnosticIdentityValue(value: unknown): DiagnosticIdentityDocument {
  return descriptor({ kind: "value", value });
}

/** Copies the field-to-descriptor map, not the live values behind its children. */
export function createDiagnosticIdentityObject(
  fields: Readonly<Record<string, DiagnosticIdentityDocument>>,
): DiagnosticIdentityDocument {
  if (!isDiagnosticPlainRecord(fields))
    fail("$", "Identity fields must be a plain record", "invalid-type");
  const keys = Object.keys(fields).sort();
  const values: DiagnosticIdentityDocument[] = [];
  for (const key of keys) {
    if (!isWellFormedDiagnosticString(key))
      fail(`$.${key}`, "Object key is not well-formed UTF-16 or contains U+0000");
    const field = Object.getOwnPropertyDescriptor(fields, key);
    if (!field || !("value" in field))
      fail(`$.${key}`, "JSON objects may contain only data properties");
    readDocument(field.value, `$.${key}`);
    values.push(field.value);
  }
  return descriptor({ kind: "object", fields: { keys, values, documents: true } });
}

/**
 * A structural lazy sequence. The callback grants NO review/run authority and
 * is invoked only as iteration reaches an index. It must remain repeatable for
 * deterministic output; only an immutable SDK owner may cache a resulting tag.
 */
export function createDiagnosticIdentityArray(
  count: number,
  itemAt: (index: number) => DiagnosticIdentityDocument,
): DiagnosticIdentityDocument {
  if (!Number.isSafeInteger(count) || count < 0)
    fail("$.count", "Identity sequence count must be a nonnegative safe integer", "invalid-number");
  if (typeof itemAt !== "function")
    fail("$.itemAt", "Identity sequence reader must be a function", "invalid-type");
  return descriptor({ kind: "array", count, itemAt });
}

function childMode(mode: Mode, key: string): Mode {
  if (mode.freeJson || key === "groupDimensions" || key === "dimensions") return freeMode;
  return key === "source" || key === "sources" ? sourceMode : plainMode;
}
function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}
function scalar(fields: Fields, index: number): unknown {
  if (!fields.documents) return fields.values[index];
  const node = readDocument(fields.values[index] as DiagnosticIdentityDocument, "$");
  // Non-scalar composition has an object value, and cannot be a source token.
  return node.kind === "value" ? node.value : {};
}
function sourceFields(fields: Fields, mode: Mode, path: string): Fields {
  if (mode.freeJson || !mode.sourceSlot) return fields;
  const artifact = fields.keys.indexOf("artifactId");
  if (artifact < 0 || typeof scalar(fields, artifact) !== "string") return fields;
  const source = Object.create(null) as Record<string, unknown>;
  for (let index = 0; index < fields.keys.length; index++)
    source[fields.keys[index]!] = scalar(fields, index);
  try {
    // Reuse the authoritative source-slot normalization/validation, including
    // optional nulls, rather than maintaining a second source schema.
    const normalized = projectDiagnosticIdentity({ source }).source;
    const keys = Object.keys(normalized).sort();
    return {
      keys,
      values: keys.map((key) => normalized[key as keyof typeof normalized]),
      documents: false,
    };
  } catch (error) {
    if (error instanceof DiagnosticValidationError)
      throw new DiagnosticValidationError(
        error.issues.map((issue) => ({
          ...issue,
          path: issue.path.replace(/^\$\.source/, path),
        })),
      );
    throw error;
  }
}

function rawFields(raw: object, path: string): Fields {
  const keys = Object.keys(raw).sort();
  const values: unknown[] = [];
  // Read every sibling descriptor before traversing a child, exactly as in the
  // legacy streaming projection. Accessors fail without ever being invoked.
  for (const key of keys) {
    const location = childPath(path, key);
    if (!isWellFormedDiagnosticString(key))
      fail(location, "Object key is not well-formed UTF-16 or contains U+0000");
    const field = Object.getOwnPropertyDescriptor(raw, key);
    if (!field || !("value" in field))
      fail(location, "JSON objects may contain only data properties");
    values.push(field.value);
  }
  return { keys, values, documents: false };
}
function safeEnd(text: string, start: number, count: number): number {
  let end = Math.min(start + count, text.length);
  const before = text.charCodeAt(end - 1),
    after = text.charCodeAt(end);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--;
  return end;
}
function* quote(text: string): Generator<string> {
  yield '"';
  for (let start = 0; start < text.length; ) {
    const end = safeEnd(text, start, QUOTE_UNITS);
    yield JSON.stringify(text.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}

interface Location {
  readonly mode: Mode;
  readonly path: string;
  readonly depth: number;
}
type Frame =
  | (Location & { readonly kind: "document"; readonly document: DiagnosticIdentityDocument })
  | (Location & { readonly kind: "value"; readonly value: unknown })
  | (Location & {
      readonly kind: "object";
      readonly fields: Fields;
      index: number;
      phase: "separator" | "key" | "colon" | "child";
    })
  | (Location & { readonly kind: "array"; readonly values: unknown[]; index: number })
  | (Location & {
      readonly kind: "sequence";
      readonly node: Extract<Node, { kind: "array" }>;
      index: number;
      phase: "separator" | "child";
    })
  | { readonly kind: "quote"; readonly text: string; start: number; opened: boolean }
  | { readonly kind: "leave-document"; readonly document: DiagnosticIdentityDocument }
  | { readonly kind: "leave-value"; readonly value: object };

function checkDepth(path: string, depth: number): void {
  if (depth > MAX_DIAGNOSTIC_JSON_DEPTH)
    fail(path, `JSON depth exceeds ${MAX_DIAGNOSTIC_JSON_DEPTH}`, "expression-limit");
}

/**
 * Exact legacy diagnostic projection, emitted in bounded canonical chunks.
 * Arrays are visited in order; object key lists and paths still scale with
 * object width/depth. No full identity graph or escaped string atom is made.
 * One explicit traversal stack feeds the bounded sink directly: raw fields
 * never allocate public descriptors, and tokens do not bounce through nested
 * generators. Diagnostic validation still rejects accessors without invoking
 * them, and each iteration reads the live descriptor values afresh.
 */
export function* iterateDiagnosticIdentityJson(
  document: DiagnosticIdentityDocument,
): Generator<string> {
  readDocument(document, "$");
  const activeDocuments = new Set<DiagnosticIdentityDocument>();
  const activeValues = new Set<object>();
  const stack: Frame[] = [{ kind: "document", document, mode: plainMode, path: "$", depth: 1 }];
  let buffered = "";
  let token = "";
  let tokenStart = 0;
  try {
    while (stack.length || tokenStart < token.length) {
      // Drain one bounded token before visiting anything else. Keeping the
      // token/chunk boundaries also preserves when lazy callbacks are read.
      if (tokenStart < token.length) {
        const end = safeEnd(token, tokenStart, CHUNK_UNITS - buffered.length);
        if (end === tokenStart) {
          yield buffered;
          buffered = "";
          continue;
        }
        buffered += token.slice(tokenStart, end);
        tokenStart = end;
        if (buffered.length >= CHUNK_UNITS - 1) {
          yield buffered;
          buffered = "";
        }
        continue;
      }
      token = "";
      tokenStart = 0;
      const frame = stack[stack.length - 1]!;
      switch (frame.kind) {
        case "leave-document":
          activeDocuments.delete(frame.document);
          stack.pop();
          break;
        case "leave-value":
          activeValues.delete(frame.value);
          stack.pop();
          break;
        case "quote": {
          if (!frame.opened) {
            frame.opened = true;
            token = '"';
          } else if (frame.start < frame.text.length) {
            const end = safeEnd(frame.text, frame.start, QUOTE_UNITS);
            token = JSON.stringify(frame.text.slice(frame.start, end)).slice(1, -1);
            frame.start = end;
          } else {
            token = '"';
            stack.pop();
          }
          break;
        }
        case "document": {
          const { document: current, mode, path, depth } = frame;
          const node = readDocument(current, path);
          checkDepth(path, depth);
          if (activeDocuments.has(current))
            fail(path, "Identity document contains a cycle", "cycle");
          activeDocuments.add(current);
          stack[stack.length - 1] = { kind: "leave-document", document: current };
          if (node.kind === "value")
            stack.push({ kind: "value", value: node.value, mode, path, depth });
          else if (node.kind === "object") {
            const fields = sourceFields(node.fields, mode, path);
            stack.push({ kind: "object", fields, mode, path, depth, index: 0, phase: "separator" });
            token = "{";
          } else {
            stack.push({ kind: "sequence", node, mode, path, depth, index: 0, phase: "separator" });
            token = "[";
          }
          break;
        }
        case "value": {
          const { value: raw, mode, path, depth } = frame;
          checkDepth(path, depth);
          stack.pop();
          if (raw === null) token = "null";
          else if (typeof raw === "boolean") token = String(raw);
          else if (typeof raw === "number") {
            if (!Number.isFinite(raw)) fail(path, "JSON numeric value must be finite");
            token = Object.is(raw, -0) ? "0" : String(raw);
          } else if (typeof raw === "string") {
            if (!isWellFormedDiagnosticString(raw))
              fail(path, "String is not well-formed UTF-16 or contains U+0000");
            stack.push({ kind: "quote", text: raw, start: 0, opened: false });
          } else {
            if (typeof raw !== "object") fail(path, "Value is not plain JSON data");
            const array = Array.isArray(raw);
            if (
              array ? Object.getPrototypeOf(raw) !== Array.prototype : !isDiagnosticPlainRecord(raw)
            )
              fail(path, "Value must use a plain object or array prototype");
            if (activeValues.has(raw)) fail(path, "JSON value contains a cycle", "cycle");
            activeValues.add(raw);
            stack.push({ kind: "leave-value", value: raw });
            if (array) {
              const values = raw as unknown[];
              for (const key of Reflect.ownKeys(values)) {
                if (key === "length") continue;
                const index = typeof key === "string" ? Number(key) : NaN;
                if (
                  !Number.isInteger(index) ||
                  index < 0 ||
                  index >= values.length ||
                  String(index) !== key
                )
                  fail(
                    typeof key === "symbol" ? path : childPath(path, key),
                    "JSON arrays may contain only indexed data properties",
                  );
              }
              stack.push({ kind: "array", values, mode, path, depth, index: 0 });
              token = "[";
            } else {
              const fields = sourceFields(rawFields(raw, path), mode, path);
              stack.push({
                kind: "object",
                fields,
                mode,
                path,
                depth,
                index: 0,
                phase: "separator",
              });
              token = "{";
            }
          }
          break;
        }
        case "object": {
          const { fields, index, mode, path, depth } = frame;
          if (index === fields.keys.length) {
            token = "}";
            stack.pop();
            break;
          }
          const key = fields.keys[index]!;
          if (frame.phase === "separator") {
            frame.phase = "key";
            if (index) token = ",";
          } else if (frame.phase === "key") {
            frame.phase = "colon";
            stack.push({ kind: "quote", text: key, start: 0, opened: false });
          } else if (frame.phase === "colon") {
            frame.phase = "child";
            token = ":";
          } else {
            const child = fields.values[index];
            const location = {
              mode: childMode(mode, key),
              path: childPath(path, key),
              depth: depth + 1,
            };
            stack.push(
              fields.documents
                ? { kind: "document", document: child as DiagnosticIdentityDocument, ...location }
                : { kind: "value", value: child, ...location },
            );
            frame.index++;
            frame.phase = "separator";
          }
          break;
        }
        case "array": {
          const { values, index, mode, path, depth } = frame;
          if (index >= values.length) {
            token = "]";
            stack.pop();
            break;
          }
          const field = Object.getOwnPropertyDescriptor(values, String(index));
          if (!field || !("value" in field))
            fail(`${path}[${index}]`, "JSON arrays may contain only indexed data properties");
          stack.push({
            kind: "value",
            value: field.value,
            mode,
            path: `${path}[${index}]`,
            depth: depth + 1,
          });
          frame.index++;
          if (index) token = ",";
          break;
        }
        case "sequence": {
          const { node, index, mode, path, depth } = frame;
          if (index === node.count) {
            token = "]";
            stack.pop();
          } else if (frame.phase === "separator") {
            frame.phase = "child";
            if (index) token = ",";
          } else {
            const child = node.itemAt(index);
            stack.push({
              kind: "document",
              document: child,
              mode,
              path: `${path}[${index}]`,
              depth: depth + 1,
            });
            frame.index++;
            frame.phase = "separator";
          }
          break;
        }
      }
    }
    if (buffered) yield buffered;
  } finally {
    // Cancellation must release live views without traversing later children.
    stack.length = 0;
    activeDocuments.clear();
    activeValues.clear();
  }
}

/** Full legacy FNV tag; structure alone is not proof of a completed SDK run. */
export function fingerprintDiagnosticIdentity(
  document: DiagnosticIdentityDocument,
  envelope: { readonly kind: string; readonly property: string },
): string {
  if (
    !isDiagnosticToken(envelope?.kind) ||
    !isDiagnosticToken(envelope?.property) ||
    ["kind", "identityVersion"].includes(envelope.property)
  )
    fail(
      "$.envelope",
      "Identity envelope requires distinct nonempty kind/property tokens",
      "invalid-string",
    );
  readDocument(document, "$");
  function* envelopeTokens(): Generator<string> {
    yield "{";
    let index = 0;
    for (const key of ["identityVersion", "kind", envelope.property].sort()) {
      if (index++) yield ",";
      yield* quote(key);
      yield ":";
      if (key === "identityVersion") yield "1";
      else if (key === "kind") yield* quote(envelope.kind);
      // The body is already an identity projection. The envelope must not
      // change its source context or consume an extra diagnostic depth level.
      else yield* iterateDiagnosticIdentityJson(document);
    }
    yield "}";
  }
  const hash = createFnvAccumulator();
  const encoder = new TextEncoder();
  const bytes = new Uint8Array(CHUNK_UNITS * 3);
  for (const text of envelopeTokens()) {
    for (let start = 0; start < text.length; ) {
      const end = safeEnd(text, start, CHUNK_UNITS);
      const { written } = encoder.encodeInto(text.slice(start, end), bytes);
      hash.update(bytes.subarray(0, written));
      start = end;
    }
  }
  return `fnv1a64-jcs-v1:${hash.digest()}`;
}

export type DiagnosticIdentityComparison =
  | { readonly equal: true }
  | { readonly equal: false; readonly codeUnitOffset: number };

/**
 * Exact canonical text comparison, independent of chunk boundaries; never hash
 * equality. A mismatch stops iteration and reports its UTF-16 offset, without
 * building a giant candidate just to recover a nested JSON path.
 */
export function compareDiagnosticIdentityDocuments(
  left: DiagnosticIdentityDocument,
  right: DiagnosticIdentityDocument,
): DiagnosticIdentityComparison {
  return compareDiagnosticIdentityJsonChunks(
    iterateDiagnosticIdentityJson(left),
    iterateDiagnosticIdentityJson(right),
  );
}

/**
 * Exact UTF-16 text comparison only: this does NOT validate JSON, normalize
 * input, or authenticate evidence. Candidate decoders must validate their own
 * format, and diagnostic verification must independently authenticate SDK
 * owners. Empty chunks and split surrogate pairs do not affect equality.
 */
export function compareDiagnosticIdentityJsonChunks(
  left: Iterable<string>,
  right: Iterable<string>,
): DiagnosticIdentityComparison {
  const a = left[Symbol.iterator]();
  let b: Iterator<string> | undefined;
  const next = (iterator: Iterator<string>): IteratorResult<string> => {
    for (;;) {
      const item = iterator.next();
      if (item.done) return item;
      if (typeof item.value !== "string")
        fail("$", "Canonical text chunks must be strings", "invalid-type");
      if (item.value.length) return item;
    }
  };
  try {
    b = right[Symbol.iterator]();
    let x = next(a),
      y = next(b),
      xi = 0,
      yi = 0,
      offset = 0;
    while (!x.done && !y.done) {
      const count = Math.min(x.value.length - xi, y.value.length - yi);
      for (let index = 0; index < count; index++)
        if (x.value.charCodeAt(xi + index) !== y.value.charCodeAt(yi + index))
          return { equal: false, codeUnitOffset: offset + index };
      offset += count;
      xi += count;
      yi += count;
      if (xi === x.value.length) {
        x = next(a);
        xi = 0;
      }
      if (yi === y.value.length) {
        y = next(b);
        yi = 0;
      }
    }
    return x.done && y.done ? { equal: true } : { equal: false, codeUnitOffset: offset };
  } finally {
    a.return?.();
    b?.return?.();
  }
}
