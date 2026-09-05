import { ReservingError } from "./types.js";
import { createFnvAccumulator } from "./fnvAccumulator.js";

/**
 * Canonical JSON serialization and the FNV-1a integrity hash — the SDK's
 * single equality oracle, relocated here from @actuarial-ts/compliance so
 * the interchange layer can depend on it without a package cycle
 * (compliance re-exports both names unchanged).
 *
 * Ground truth:
 * - Object keys sort recursively (UTF-16 code-unit order), arrays keep
 *   order, no whitespace, numbers render via `String(n)` with -0
 *   normalized to "0", and anything JSON cannot faithfully represent
 *   (undefined, functions, NaN/Infinity, bigint, symbol, non-plain objects
 *   such as Date/Map/Set, circular references) THROWS with the offending
 *   path instead of being silently dropped or coerced the way
 *   JSON.stringify would.
 * - RFC 8785 (JCS) conformance: for the plain-JSON value space this
 *   function accepts, the output IS JCS — ECMAScript `String(n)` is
 *   exactly the shortest-round-trip number serialization RFC 8785
 *   specifies, default `sort()` is the UTF-16 code-unit key order it
 *   requires, and `JSON.stringify` string escaping matches its minimal
 *   escaping rules. The committed vector suite
 *   (schema/interchange/1.0/jcs-vectors.json) pins this claim byte for
 *   byte, and every non-TS interchange adapter must reproduce the same
 *   vectors.
 * - Timestamps are caller-supplied ISO strings; this module never reads a
 *   clock, so identical inputs yield byte-identical output.
 * - Browser-safe: no node builtins (TextEncoder is a web-standard global).
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

interface CanonicalSink {
  write(text: string): void;
  quote(text: string): void;
  startContainer(token: "[" | "{"): void;
  endContainer(token: "]" | "}"): void;
}

/** One traversal owns validation and property access order for both outputs. */
function canonicalize(value: unknown, path: string, seen: Set<object>, sink: CanonicalSink): void {
  if (value === null) {
    sink.write("null");
    return;
  }
  switch (typeof value) {
    case "string":
      sink.quote(value);
      return;
    case "boolean":
      sink.write(value ? "true" : "false");
      return;
    case "number": {
      if (!Number.isFinite(value)) {
        throw new ReservingError(
          "UNSUPPORTED_VALUE",
          `non-finite number (${String(value)}) at ${path}`,
        );
      }
      sink.write(Object.is(value, -0) ? "0" : String(value));
      return;
    }
    case "undefined":
      throw new ReservingError("UNSUPPORTED_VALUE", `undefined at ${path}`);
    case "function":
      throw new ReservingError("UNSUPPORTED_VALUE", `function at ${path}`);
    case "bigint":
    case "symbol":
      throw new ReservingError("UNSUPPORTED_VALUE", `${typeof value} at ${path}`);
    case "object":
      break;
  }
  const obj = value as object;
  if (seen.has(obj)) {
    throw new ReservingError("UNSUPPORTED_VALUE", `circular reference at ${path}`);
  }
  seen.add(obj);
  if (Array.isArray(obj)) {
    sink.startContainer("[");
    for (let i = 0; i < obj.length; i++) {
      if (i > 0) sink.write(",");
      canonicalize(obj[i], `${path}[${i}]`, seen, sink);
    }
    sink.endContainer("]");
  } else if (isPlainObject(obj)) {
    const keys = Object.keys(obj).sort();
    sink.startContainer("{");
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) sink.write(",");
      const key = keys[i]!;
      sink.quote(key);
      sink.write(":");
      canonicalize(obj[key], `${path}.${key}`, seen, sink);
    }
    sink.endContainer("}");
  } else {
    const name = (obj.constructor as { name?: string } | undefined)?.name ?? "unknown";
    throw new ReservingError(
      "UNSUPPORTED_VALUE",
      `non-plain object (${name}) at ${path}; only plain objects, arrays, and JSON primitives are canonicalizable`,
    );
  }
  seen.delete(obj);
}

/**
 * Deterministic JSON serialization: sorted object keys (recursively), arrays
 * in order, no whitespace, -0 normalized to "0". Two structurally equal
 * values always produce the same string regardless of key insertion order.
 * Throws ReservingError("UNSUPPORTED_VALUE") — with the offending path, e.g.
 * "$.rows[2].ultimate" — for any value JSON cannot faithfully represent.
 */
export function canonicalJson(value: unknown): string {
  // Join finished subtrees as before, rather than retaining a flat token array
  // for the entire input graph alongside the final serialized string.
  const frames: string[][] = [[]];
  const write = (text: string) => {
    frames[frames.length - 1]!.push(text);
  };
  canonicalize(value, "$", new Set(), {
    write,
    quote(text) {
      write(JSON.stringify(text));
    },
    startContainer(token) {
      frames.push([token]);
    },
    endContainer(token) {
      const parts = frames.pop()!;
      parts.push(token);
      write(parts.join(""));
    },
  });
  return frames[0]!.join("");
}

const UTF8_CHUNK_CODE_UNITS = 16_384;
const QUOTED_CHUNK_CODE_UNITS = 4_096;

/** A valid surrogate pair must reach native escaping/encoding together. */
function chunkEnd(text: string, start: number, limit: number): number {
  let end = Math.min(start + limit, text.length);
  const before = text.charCodeAt(end - 1);
  const after = text.charCodeAt(end);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end -= 1;
  return end;
}

/** Reuse at most 48 KiB for long strings instead of duplicating all UTF-8 bytes. */
function* utf8Chunks(text: string): Generator<Uint8Array> {
  const encoder = new TextEncoder();
  // Retain TextEncoder's runtime coercion for untyped JavaScript callers.
  if (typeof text !== "string" || text.length <= UTF8_CHUNK_CODE_UNITS) {
    yield encoder.encode(text);
    return;
  }
  // A UTF-16 code unit needs at most three UTF-8 bytes (a surrogate pair
  // needs four bytes for two code units), so encodeInto always consumes a chunk.
  const buffer = new Uint8Array(UTF8_CHUNK_CODE_UNITS * 3);
  for (let start = 0; start < text.length; ) {
    const end = chunkEnd(text, start, UTF8_CHUNK_CODE_UNITS);
    const { written } = encoder.encodeInto(text.slice(start, end), buffer);
    yield buffer.subarray(0, written);
    start = end;
  }
}

/**
 * FNV-1a 64-bit hash over the UTF-8 bytes of `text`, returned as a 16-hex-char
 * string.
 *
 * This is an INTEGRITY AID for detecting accidental divergence between a
 * payload and a re-run. It is NOT a security control: FNV-1a is not collision
 * resistant and offers no protection against deliberate tampering. Anyone
 * needing tamper evidence must sign or cryptographically hash the payload.
 */
export function fnv1a64(text: string): string {
  const hash = createFnvAccumulator();
  for (const bytes of utf8Chunks(text)) hash.update(bytes);
  return hash.digest();
}

/**
 * The exact integrity tag `fnv1a64(canonicalJson(value))`, without constructing
 * the complete canonical string or UTF-8 byte array. Validation, key ordering,
 * escaping and unsupported-value error paths match `canonicalJson`.
 *
 * Text and byte buffers are bounded, including for a single large string/key;
 * object-key sorting, ancestor tracking and paths still scale with input shape.
 * The caller's input remains in memory. This is not a constant-memory dataset
 * pipeline, a collision-resistant hash, or a substitute for exact equality.
 */
export function canonicalFnv1a64(value: unknown): string {
  const hash = createFnvAccumulator();
  const encoder = new TextEncoder();
  const bytes = new Uint8Array(UTF8_CHUNK_CODE_UNITS * 3);
  let buffered = "";
  const flush = () => {
    if (!buffered.length) return;
    // Three bytes per UTF-16 code unit always fit; pairs need only four for two.
    const { written } = encoder.encodeInto(buffered, bytes);
    hash.update(bytes.subarray(0, written));
    buffered = "";
  };
  const write = (text: string) => {
    for (let start = 0; start < text.length; ) {
      const end = chunkEnd(text, start, UTF8_CHUNK_CODE_UNITS - buffered.length);
      if (end === start) {
        flush();
        continue;
      }
      buffered += text.slice(start, end);
      start = end;
      if (buffered.length >= UTF8_CHUNK_CODE_UNITS - 1) flush();
    }
  };
  canonicalize(value, "$", new Set(), {
    write,
    startContainer: write,
    endContainer: write,
    quote(text) {
      write('"');
      for (let start = 0; start < text.length; ) {
        const end = chunkEnd(text, start, QUOTED_CHUNK_CODE_UNITS);
        // Bounded native escaping retains minimal JSON escape spelling and lone
        // surrogate escapes without allocating one full escaped string atom.
        write(JSON.stringify(text.slice(start, end)).slice(1, -1));
        start = end;
      }
      write('"');
    },
  });
  flush();
  return hash.digest();
}
