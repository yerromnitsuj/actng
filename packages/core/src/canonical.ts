import { ReservingError } from "./types.js";

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

function canonicalize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new ReservingError("UNSUPPORTED_VALUE", `non-finite number (${String(value)}) at ${path}`);
      }
      return Object.is(value, -0) ? "0" : String(value);
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
  let out: string;
  if (Array.isArray(obj)) {
    const parts: string[] = [];
    for (let i = 0; i < obj.length; i++) {
      parts.push(canonicalize(obj[i], `${path}[${i}]`, seen));
    }
    out = `[${parts.join(",")}]`;
  } else if (isPlainObject(obj)) {
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of keys) {
      parts.push(`${JSON.stringify(key)}:${canonicalize(obj[key], `${path}.${key}`, seen)}`);
    }
    out = `{${parts.join(",")}}`;
  } else {
    const name = (obj.constructor as { name?: string } | undefined)?.name ?? "unknown";
    throw new ReservingError(
      "UNSUPPORTED_VALUE",
      `non-plain object (${name}) at ${path}; only plain objects, arrays, and JSON primitives are canonicalizable`,
    );
  }
  seen.delete(obj);
  return out;
}

/**
 * Deterministic JSON serialization: sorted object keys (recursively), arrays
 * in order, no whitespace, -0 normalized to "0". Two structurally equal
 * values always produce the same string regardless of key insertion order.
 * Throws ReservingError("UNSUPPORTED_VALUE") — with the offending path, e.g.
 * "$.rows[2].ultimate" — for any value JSON cannot faithfully represent.
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, "$", new Set());
}

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

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
  const bytes = new TextEncoder().encode(text);
  let hash = FNV_OFFSET_BASIS;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}
