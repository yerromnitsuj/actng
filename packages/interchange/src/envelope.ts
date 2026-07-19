import { ReservingError, canonicalJson, fnv1a64 } from "@actuarial-ts/core";
import { z } from "zod";

/**
 * The interchange document envelope (spec 3.1 / 3.5).
 *
 * Every interchange document is an envelope around exactly one semantic
 * body. The envelope carries `interchangeVersion`, `kind`, `generator`,
 * `createdAt`, `extensions`, and `integrity`; the semantic body is the ONE
 * kind-named object (`triangle`, `selection`, `result`, `study`,
 * `report` — and for `kind: "bundle"`, per spec 3.2, the two-field
 * object `{ bundle, interchange }` the outer tag is defined over).
 *
 * Ground truth:
 * - `integrity` = fnv1a64(canonicalJson(semantic body)) — NEVER the
 *   envelope. Re-exporting a document through another adapter changes the
 *   envelope (generator, createdAt), not the tag, so appliesTo-by-tag
 *   linkage survives cross-language hops. FNV-1a detects ACCIDENTAL
 *   divergence only; tamper evidence requires host-side signing.
 * - `governance` (StudyDoc) sits beside the semantic body: it is neither
 *   envelope nor integrity-covered; adapters round-trip it opaquely.
 * - Version acceptance (spec 3.5): wrong-major documents are refused with
 *   `UNSUPPORTED_VERSION`; same-major unknown minors are accepted, unknown
 *   fields are preserved (schemas are passthrough), and
 *   `governance`/`extensions` round-trip opaquely.
 * - `createdAt` is caller-supplied (purity rule) — this module never reads
 *   a clock.
 */

/** The interchange spec version this package writes. */
export const INTERCHANGE_SPEC_VERSION = "1.0.0";

/** The spec major this package accepts (spec 3.5: readers accept same-major). */
export const INTERCHANGE_SPEC_MAJOR = 1;

/**
 * This package's version, stamped into `generator` by default. A sync test
 * asserts it matches package.json so it cannot silently drift.
 */
export const INTERCHANGE_PACKAGE_VERSION = "0.3.0";

export interface GeneratorStamp {
  name: string;
  version: string;
}

/** Default `generator` stamp for documents authored by this package. */
export const DEFAULT_GENERATOR: GeneratorStamp = {
  name: "@actuarial-ts/interchange",
  version: INTERCHANGE_PACKAGE_VERSION,
};

export const DOCUMENT_KINDS = [
  "triangle",
  "selection",
  "method-result",
  "stochastic-result",
  "study",
  "bundle",
  "crosscheck-report",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * kind → the top-level key(s) holding the semantic body. Single-key kinds
 * hash the named object itself; `bundle` hashes `{ bundle, interchange }`
 * (spec 3.2's outer tag).
 */
const SEMANTIC_BODY_KEYS: Record<DocumentKind, readonly string[]> = {
  triangle: ["triangle"],
  selection: ["selection"],
  "method-result": ["result"],
  "stochastic-result": ["result"],
  study: ["study"],
  bundle: ["bundle", "interchange"],
  "crosscheck-report": ["report"],
};

/** A 16-hex-char fnv1a64 tag. */
export const integritySchema = z.string().regex(/^[0-9a-f]{16}$/);

export const generatorSchema = z
  .object({ name: z.string().min(1), version: z.string().min(1) })
  .passthrough();

/**
 * The shared envelope fields for a document of the given kind. Doc schemas
 * spread this shape and add their semantic body key(s); every object is
 * passthrough so unknown same-major minor fields are preserved, keeping
 * integrity tags stable across a parse → re-serialize hop.
 */
export function envelopeShape<K extends DocumentKind>(kind: K) {
  return {
    interchangeVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    kind: z.literal(kind),
    generator: generatorSchema,
    createdAt: z.string().datetime({ offset: true }),
    extensions: z.record(z.unknown()).optional(),
    integrity: integritySchema,
  };
}

/** Minimal structural view of a document for integrity/version helpers. */
export interface DocumentLike {
  kind: string;
  [key: string]: unknown;
}

function isKnownKind(kind: string): kind is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(kind);
}

/**
 * Extracts the semantic body the integrity tag is defined over. Throws
 * BAD_INTERCHANGE for unknown kinds or a missing body key.
 */
export function semanticBodyOf(doc: DocumentLike): unknown {
  if (!isKnownKind(doc.kind)) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Unknown document kind "${doc.kind}"; this reader understands: ${DOCUMENT_KINDS.join(", ")}`,
    );
  }
  const keys = SEMANTIC_BODY_KEYS[doc.kind];
  for (const key of keys) {
    if (doc[key] === undefined) {
      throw new ReservingError(
        "BAD_INTERCHANGE",
        `Document of kind "${doc.kind}" is missing its semantic body field "${key}"`,
      );
    }
  }
  if (keys.length === 1) return doc[keys[0]!];
  const body: Record<string, unknown> = {};
  for (const key of keys) body[key] = doc[key];
  return body;
}

/** integrity = fnv1a64(canonicalJson(semantic body)) — spec 3.1. */
export function computeIntegrity(doc: DocumentLike): string {
  return fnv1a64(canonicalJson(semanticBodyOf(doc)));
}

/** Returns the document with a freshly computed integrity tag. */
export function stampIntegrity<T extends DocumentLike>(
  doc: DocumentLike & Omit<T, "integrity">,
): T {
  return { ...doc, integrity: computeIntegrity(doc) } as unknown as T;
}

export interface IntegrityCheck {
  ok: boolean;
  /** The tag recomputed from the semantic body. */
  expected: string;
  /** The tag the document claims. */
  actual: string | null;
}

/** Recomputes the tag from the semantic body and compares to the stated one. */
export function verifyIntegrity(doc: DocumentLike): IntegrityCheck {
  const expected = computeIntegrity(doc);
  const actual = typeof doc["integrity"] === "string" ? (doc["integrity"] as string) : null;
  return { ok: actual === expected, expected, actual };
}

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Version acceptance (spec 3.5): parses `interchangeVersion` and refuses
 * wrong-major documents with UNSUPPORTED_VERSION. Unparseable versions are
 * BAD_INTERCHANGE (a malformed document, not a future one).
 */
export function acceptVersion(version: unknown): ParsedVersion {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `interchangeVersion must be a MAJOR.MINOR.PATCH string; got ${JSON.stringify(version)}`,
    );
  }
  const [major, minor, patch] = version.split(".").map(Number) as [number, number, number];
  if (major !== INTERCHANGE_SPEC_MAJOR) {
    throw new ReservingError(
      "UNSUPPORTED_VERSION",
      `Interchange version ${version} has major ${major}; this reader accepts major ${INTERCHANGE_SPEC_MAJOR} only`,
    );
  }
  return { major, minor, patch };
}
