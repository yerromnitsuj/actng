/**
 * Reproducibility bundle: canonical JSON serialization + a tiny integrity
 * hash, so an analysis can state "these results came from exactly these
 * inputs, parameters, and SDK versions" and a re-run can be byte-verified.
 *
 * Ground truth:
 * - `canonicalJson` is the package's single equality oracle: object keys are
 *   sorted recursively, arrays keep their order, numbers render via
 *   `String(n)` except -0 which normalizes to "0" (so 0 and -0 never differ),
 *   and anything JSON cannot faithfully represent (undefined, functions,
 *   NaN/Infinity, bigint, symbol, non-plain objects such as Date/Map/Set,
 *   circular references) THROWS with the offending path instead of being
 *   silently dropped or coerced the way JSON.stringify would.
 * - `fnv1a64` is an integrity aid, NOT a security control (see its doc block).
 * - Timestamps are caller-supplied ISO strings; this module never reads a
 *   clock, so identical inputs yield byte-identical bundles.
 * - Browser-safe: no node builtins (TextEncoder is a web-standard global).
 *
 * Error style for the whole package: `ComplianceError` with a registered
 * machine code, mirroring core's `ReservingError` idiom. It lives here (not
 * in its own module) because bundle.ts is the package's dependency-root
 * module — ledger.ts already imports `canonicalJson` from it. Core's
 * `RESERVING_ERROR_CODES` registry is a closed contract enforced against
 * core's own source, and compliance failures (missing rationale, unsupported
 * bundle values) are not reserving-input errors, so this package does not
 * reuse `ReservingError`.
 *
 * These utilities are designed to support the actuary's compliance with
 * ASOP No. 41 (documentation and reproducibility of the analysis);
 * responsibility for compliance remains with the credentialed actuary.
 */

/**
 * Every machine-readable code a ComplianceError can carry, across all modules
 * of this package. Add the code here when introducing a new throw.
 */
export const COMPLIANCE_ERROR_CODES = [
  "BAD_BUNDLE",
  "BAD_CDF",
  "MISSING_RATIONALE",
  "UNSUPPORTED_VALUE",
] as const;

export type ComplianceErrorCode = (typeof COMPLIANCE_ERROR_CODES)[number];

/** Thrown for invalid compliance input (unrepresentable bundle payloads, judgment without rationale, non-positive CDFs). */
export class ComplianceError extends Error {
  readonly code: ComplianceErrorCode;
  constructor(code: ComplianceErrorCode, message: string) {
    super(message);
    this.name = "ComplianceError";
    this.code = code;
  }
}

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
        throw new ComplianceError("UNSUPPORTED_VALUE", `non-finite number (${String(value)}) at ${path}`);
      }
      return Object.is(value, -0) ? "0" : String(value);
    }
    case "undefined":
      throw new ComplianceError("UNSUPPORTED_VALUE", `undefined at ${path}`);
    case "function":
      throw new ComplianceError("UNSUPPORTED_VALUE", `function at ${path}`);
    case "bigint":
    case "symbol":
      throw new ComplianceError("UNSUPPORTED_VALUE", `${typeof value} at ${path}`);
    case "object":
      break;
  }
  const obj = value as object;
  if (seen.has(obj)) {
    throw new ComplianceError("UNSUPPORTED_VALUE", `circular reference at ${path}`);
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
    throw new ComplianceError(
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
 * Throws ComplianceError("UNSUPPORTED_VALUE") — with the offending path, e.g.
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
 * bundle and a re-run. It is NOT a security control: FNV-1a is not collision
 * resistant and offers no protection against deliberate tampering. Anyone
 * needing tamper evidence must sign or cryptographically hash the payload
 * (which is exactly why the full canonical payload — not just the hash — is
 * stored on the bundle).
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

export interface CreateBundleInput {
  /** The data the analysis consumed (triangles, claims, exposures — anything canonicalizable). */
  inputs: unknown;
  /** The parameters/selections the analysis used (LDF selections, a-prioris, trends…). */
  parameters: unknown;
  /** The results the analysis produced; this is the segment verifyBundle re-checks. */
  results: unknown;
  /** Package versions the run used, e.g. { "@actuarial-ts/core": "0.1.0" }. */
  sdkVersions: Record<string, string>;
  /** Explicit seeds for any stochastic method (purity: no ambient randomness). */
  seeds?: unknown;
  /** Caller-supplied ISO timestamp (purity: no clock reads). */
  createdAt: string;
}

export interface ReproducibilityBundle {
  /** Canonical JSON of the full bundle body; the reproducibility record itself. */
  payload: string;
  /** fnv1a64(payload) — integrity aid, not a security control. */
  hash: string;
}

/**
 * Packages an analysis run into a reproducibility bundle. The payload is
 * canonical, so two runs with structurally equal inputs produce byte-identical
 * payloads (and therefore identical hashes) regardless of key insertion order.
 * `seeds` is included only when provided (undefined would be unrepresentable).
 */
export function createBundle(input: CreateBundleInput): ReproducibilityBundle {
  const body: Record<string, unknown> = {
    createdAt: input.createdAt,
    inputs: input.inputs,
    parameters: input.parameters,
    results: input.results,
    sdkVersions: input.sdkVersions,
  };
  if (input.seeds !== undefined) body["seeds"] = input.seeds;
  const payload = canonicalJson(body);
  return { payload, hash: fnv1a64(payload) };
}

export interface VerifyBundleResult {
  reproduced: boolean;
  /**
   * First differing path (deterministic depth-first walk, object keys in
   * sorted order), e.g. "$.rows[1].ultimate". Present only when not
   * reproduced. A missing/extra object key reports the key's path; an array
   * length mismatch reports the first index past the shared prefix; a type
   * mismatch reports the node itself.
   */
  mismatchPath?: string;
}

/** First differing path between two canonicalizable structures, or null when equal. */
function firstDifference(stored: unknown, rerun: unknown, path: string): string | null {
  if (isPlainObject(stored) && isPlainObject(rerun)) {
    const keys = [...new Set([...Object.keys(stored), ...Object.keys(rerun)])].sort();
    for (const key of keys) {
      const keyPath = `${path}.${key}`;
      if (!(key in stored) || !(key in rerun)) return keyPath;
      const diff = firstDifference(stored[key], rerun[key], keyPath);
      if (diff !== null) return diff;
    }
    return null;
  }
  if (Array.isArray(stored) && Array.isArray(rerun)) {
    const shared = Math.min(stored.length, rerun.length);
    for (let i = 0; i < shared; i++) {
      const diff = firstDifference(stored[i], rerun[i], `${path}[${i}]`);
      if (diff !== null) return diff;
    }
    return stored.length === rerun.length ? null : `${path}[${shared}]`;
  }
  return canonicalJson(stored) === canonicalJson(rerun) ? null : path;
}

/**
 * Verifies a re-run against a bundle: canonicalizes `rerunResults` and
 * byte-compares it with the bundle's stored `results` segment. On mismatch,
 * reports the FIRST differing path (see VerifyBundleResult.mismatchPath).
 *
 * Throws ComplianceError("BAD_BUNDLE") when the payload is not a valid bundle
 * body, and propagates ComplianceError("UNSUPPORTED_VALUE") when
 * `rerunResults` itself is not canonicalizable — a result that cannot be
 * serialized cannot be verified.
 */
export function verifyBundle(bundle: ReproducibilityBundle, rerunResults: unknown): VerifyBundleResult {
  let stored: unknown;
  try {
    stored = JSON.parse(bundle.payload);
  } catch {
    throw new ComplianceError("BAD_BUNDLE", "bundle payload is not valid JSON");
  }
  if (!isPlainObject(stored) || !("results" in stored)) {
    throw new ComplianceError("BAD_BUNDLE", 'bundle payload has no "results" segment');
  }
  const storedResults = stored["results"];
  const rerunCanonical = canonicalJson(rerunResults);
  const storedCanonical = canonicalJson(storedResults);
  if (rerunCanonical === storedCanonical) return { reproduced: true };
  return { reproduced: false, mismatchPath: firstDifference(storedResults, rerunResults, "$") ?? "$" };
}
