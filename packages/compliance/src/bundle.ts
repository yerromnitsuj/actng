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
import type {
  BundleDoc,
  MethodResultDoc,
  SelectionDoc,
  StochasticResultDoc,
  TriangleDoc,
} from "@actuarial-ts/interchange";

export { canonicalJson, fnv1a64 };

/**
 * The wrapped reproducibility bundle: the interchange BundleDoc (spec 3.2),
 * re-exported under a compliance-side name so it cannot be confused with the
 * inner ReproducibilityBundle record. The dependency on
 * `@actuarial-ts/interchange` is TYPE-ONLY (interchange must not import
 * compliance, and it does not; the outer tag is computed here with core's
 * canonicalJson/fnv1a64, matching interchange's semanticBodyOf for
 * kind "bundle" exactly — the wrapped round-trip test parses the emitted doc
 * with the real interchange parser so any drift fails loudly).
 */
export type WrappedBundleDoc = BundleDoc;

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



/**
 * The interchange version the wrapped form is written under. Kept in literal
 * sync with `@actuarial-ts/interchange`'s INTERCHANGE_SPEC_VERSION (the dep
 * is type-only, so the constant cannot be imported); the wrapped round-trip
 * test parses the emitted doc with the real interchange parser, which
 * refuses a wrong-major version — drift fails loudly.
 */
export const WRAPPED_BUNDLE_INTERCHANGE_VERSION = "1.0.0";

/**
 * This package's version, stamped into a wrapped bundle's `generator`
 * envelope field. A sync test asserts it matches package.json so it cannot
 * silently drift (mirroring interchange's INTERCHANGE_PACKAGE_VERSION
 * discipline).
 */
export const COMPLIANCE_PACKAGE_VERSION = "0.3.0";

/**
 * The interchange mirror for a wrapped bundle (spec 3.2): the triangles the
 * analysis consumed, the selections it applied, and the results it produced,
 * each as an interchange document. Results are INCLUDED so a non-TS consumer
 * (`load_bundle`) can honor its contract without ever parsing the TS-native
 * canonical payload.
 */
export interface BundleWrapInput {
  triangles: TriangleDoc[];
  selections: SelectionDoc[];
  results: (MethodResultDoc | StochasticResultDoc)[];
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
  /**
   * Optional interchange mirror (spec 3.2). When provided, the bundle is
   * ALSO emitted as a wrapped BundleDoc whose OUTER integrity tag is defined
   * over `{ bundle, interchange }`. Never enters the inner payload: the
   * unwrapped bundle is byte-identical with or without `wrap`.
   */
  wrap?: BundleWrapInput;
  /**
   * Overrides the wrapped document's `generator` stamp. Defaults to this
   * package at its current version, which is what a real analysis wants.
   *
   * Exists for authoring FROZEN corpora (the cross-engine conformance
   * fixtures), where every byte must reproduce forever and so a stamp that
   * tracks the live build cannot be used — the same reason `createdAt` is
   * caller-supplied rather than read from the clock. Matches the
   * `generator?` option the interchange document builders already accept.
   * Wrapped-mode only; the inner payload never carries it.
   */
  generator?: { name: string; version: string };
}

export interface ReproducibilityBundle {
  /** Canonical JSON of the full bundle body; the reproducibility record itself. */
  payload: string;
  /** fnv1a64(payload) — integrity aid, not a security control. */
  hash: string;
}

/** A ReproducibilityBundle plus its wrapped interchange form (spec 3.2). */
export interface WrappedBundleResult extends ReproducibilityBundle {
  /**
   * The wrapped BundleDoc: `{ bundle: { payload, hash }, interchange }` under
   * an interchange envelope, with the OUTER integrity tag over the two-field
   * semantic body `{ bundle, interchange }`.
   */
  wrapped: WrappedBundleDoc;
}

/**
 * Packages an analysis run into a reproducibility bundle. The payload is
 * canonical, so two runs with structurally equal inputs produce byte-identical
 * payloads (and therefore identical hashes) regardless of key insertion order.
 * `seeds` is included only when provided (undefined would be unrepresentable).
 *
 * With `wrap` (the interchange mirror, spec 3.2) the same inner bundle is
 * ALSO returned as a wrapped BundleDoc; the unwrapped `{ payload, hash }` is
 * byte-identical either way (the v0.1.x compat fixture pins this).
 */
export function createBundle(input: CreateBundleInput & { wrap: BundleWrapInput }): WrappedBundleResult;
export function createBundle(input: CreateBundleInput): ReproducibilityBundle;
export function createBundle(input: CreateBundleInput): ReproducibilityBundle | WrappedBundleResult {
  const body: Record<string, unknown> = {
    createdAt: input.createdAt,
    inputs: input.inputs,
    parameters: input.parameters,
    results: input.results,
    sdkVersions: input.sdkVersions,
  };
  if (input.seeds !== undefined) body["seeds"] = input.seeds;
  const payload = canonicalJson(body);
  const inner: ReproducibilityBundle = { payload, hash: fnv1a64(payload) };
  if (input.wrap === undefined) return inner;

  // The inner record is carried opaquely as the `bundle` segment; the outer
  // tag is fnv1a64(canonicalJson({ bundle, interchange })) — exactly
  // interchange's semanticBodyOf for kind "bundle" (spec 3.2).
  const bundleSegment: Record<string, unknown> = { hash: inner.hash, payload: inner.payload };
  const interchange = {
    triangles: [...input.wrap.triangles],
    selections: [...input.wrap.selections],
    results: [...input.wrap.results],
  };
  const wrapped: WrappedBundleDoc = {
    interchangeVersion: WRAPPED_BUNDLE_INTERCHANGE_VERSION,
    kind: "bundle",
    generator: input.generator
      ? { ...input.generator }
      : { name: "@actuarial-ts/compliance", version: COMPLIANCE_PACKAGE_VERSION },
    createdAt: input.createdAt,
    bundle: bundleSegment,
    interchange,
    integrity: fnv1a64(canonicalJson({ bundle: bundleSegment, interchange })),
  };
  return { ...inner, wrapped };
}

/** Outer-tag verification detail (wrapped mode only; spec 3.2). */
export interface OuterIntegrityCheck {
  ok: boolean;
  /** The tag recomputed from the `{ bundle, interchange }` semantic body. */
  expected: string;
  /** The tag the wrapped document claims. */
  actual: string | null;
}

export interface VerifyBundleResult {
  reproduced: boolean;
  /**
   * First differing path (deterministic depth-first walk, object keys in
   * sorted order), e.g. "$.rows[1].ultimate". Present only when not
   * reproduced. A missing/extra object key reports the key's path; an array
   * length mismatch reports the first index past the shared prefix; a type
   * mismatch reports the node itself. In wrapped mode, an outer-tag failure
   * reports "$.integrity" (the divergent tag itself; see `outerIntegrity`
   * for the expected/actual values).
   */
  mismatchPath?: string;
  /** Present in wrapped mode only: the outer-tag check (spec 3.2). */
  outerIntegrity?: OuterIntegrityCheck;
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

/** Inner verification — the pre-wrapped behavior, unchanged byte for byte. */
function verifyUnwrapped(bundle: ReproducibilityBundle, rerunResults: unknown): VerifyBundleResult {
  // The bundle's own hash first. Without this, the attestation ("these results
  // came from exactly these inputs, parameters, and SDK versions") checked the
  // results segment only — a bundle with rewritten inputs and hash "deadbeef"
  // verified. The wrapped path always recomputed its tag; the unwrapped one
  // must too.
  if (fnv1a64(bundle.payload) !== bundle.hash) {
    return { reproduced: false, mismatchPath: "$.hash" };
  }
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

function isWrappedBundleDoc(value: ReproducibilityBundle | WrappedBundleDoc): value is WrappedBundleDoc {
  return (value as { kind?: unknown }).kind === "bundle";
}

/** Wrapped mode: the outer tag (spec 3.2) AND the inner bundle exactly as today. */
function verifyWrapped(doc: WrappedBundleDoc, rerunResults: unknown): VerifyBundleResult {
  const innerRaw: unknown = doc.bundle;
  if (
    !isPlainObject(innerRaw) ||
    typeof innerRaw["payload"] !== "string" ||
    typeof innerRaw["hash"] !== "string"
  ) {
    throw new ComplianceError(
      "BAD_BUNDLE",
      'wrapped bundle\'s "bundle" segment must carry the inner { payload, hash } record',
    );
  }
  if (doc.interchange === undefined || doc.interchange === null) {
    throw new ComplianceError("BAD_BUNDLE", 'wrapped bundle is missing its "interchange" mirror');
  }
  // OUTER tag over the two-field semantic body { bundle, interchange } —
  // exactly interchange's semanticBodyOf for kind "bundle" (spec 3.2).
  const expected = fnv1a64(canonicalJson({ bundle: doc.bundle, interchange: doc.interchange }));
  const actual = typeof doc.integrity === "string" ? doc.integrity : null;
  const outerIntegrity: OuterIntegrityCheck = { ok: expected === actual, expected, actual };
  if (!outerIntegrity.ok) {
    return { reproduced: false, mismatchPath: "$.integrity", outerIntegrity };
  }
  const inner: ReproducibilityBundle = { payload: innerRaw["payload"], hash: innerRaw["hash"] };
  return { ...verifyUnwrapped(inner, rerunResults), outerIntegrity };
}

/**
 * Verifies a re-run against a bundle: canonicalizes `rerunResults` and
 * byte-compares it with the bundle's stored `results` segment. On mismatch,
 * reports the FIRST differing path (see VerifyBundleResult.mismatchPath).
 *
 * Wrapped mode (a BundleDoc with `kind: "bundle"`, spec 3.2): additionally
 * recomputes the OUTER integrity tag over `{ bundle, interchange }` and
 * refuses on divergence BEFORE the inner check — a drifted interchange
 * mirror fails verification with mismatchPath "$.integrity" and the
 * expected/actual tags in `outerIntegrity`, even when the inner bundle is
 * untouched. When the outer tag holds, the inner bundle is verified exactly
 * as in unwrapped mode.
 *
 * Throws ComplianceError("BAD_BUNDLE") when the payload is not a valid bundle
 * body, and propagates ReservingError("UNSUPPORTED_VALUE") when
 * `rerunResults` itself is not canonicalizable — a result that cannot be
 * serialized cannot be verified.
 */
export function verifyBundle(
  bundle: ReproducibilityBundle | WrappedBundleDoc,
  rerunResults: unknown,
): VerifyBundleResult {
  return isWrappedBundleDoc(bundle) ? verifyWrapped(bundle, rerunResults) : verifyUnwrapped(bundle, rerunResults);
}
