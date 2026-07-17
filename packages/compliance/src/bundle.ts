/**
 * Reproducibility bundle: canonical JSON serialization + a tiny integrity
 * hash, so an analysis can state "these results came from exactly these
 * inputs, parameters, and SDK versions" and a re-run can be byte-verified.
 *
 * `canonicalJson` and `fnv1a64` LIVE IN @actuarial-ts/core (src/canonical.ts)
 * since 0.2.0 so the interchange layer can share them without a package
 * cycle; this module re-exports both, unchanged. One deliberate behavior
 * change rode along: invalid canonicalization input now throws core's
 * ReservingError("UNSUPPORTED_VALUE") instead of ComplianceError - same
 * code, same message shape, different class (CHANGELOG 0.2.0).
 *
 * Ground truth (unchanged):
 * - Timestamps are caller-supplied ISO strings; this module never reads a
 *   clock, so identical inputs yield byte-identical bundles.
 * - fnv1a64 is an integrity aid, NOT a security control (see its doc block
 *   in core).
 * - Browser-safe: no node builtins.
 *
 * Error style for the whole package: `ComplianceError` with a registered
 * machine code, mirroring core's `ReservingError` idiom (bundle.ts is the
 * package's dependency-root module, so the class lives here).
 *
 * These utilities are designed to support the actuary's compliance with
 * ASOP No. 41 (documentation and reproducibility of the analysis);
 * responsibility for compliance remains with the credentialed actuary.
 */

import { canonicalJson, fnv1a64 } from "@actuarial-ts/core";

export { canonicalJson, fnv1a64 };

/**
 * Every machine-readable code a ComplianceError can carry, across all modules
 * of this package. Add the code here when introducing a new throw.
 * (UNSUPPORTED_VALUE moved to core's registry with canonicalJson in 0.2.0.)
 */
export const COMPLIANCE_ERROR_CODES = [
  "BAD_BUNDLE",
  "BAD_CDF",
  "MISSING_RATIONALE",
] as const;

export type ComplianceErrorCode = (typeof COMPLIANCE_ERROR_CODES)[number];

/** Thrown for invalid compliance input (bad bundles, judgment without rationale, non-positive CDFs). */
export class ComplianceError extends Error {
  readonly code: ComplianceErrorCode;
  constructor(code: ComplianceErrorCode, message: string) {
    super(message);
    this.name = "ComplianceError";
    this.code = code;
  }
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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
