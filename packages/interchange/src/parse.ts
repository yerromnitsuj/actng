import { ReservingError } from "@actuarial-ts/core";
import type { z } from "zod";
import {
  type DocumentKind,
  DOCUMENT_KINDS,
  acceptVersion,
  verifyIntegrity,
} from "./envelope.js";
import { INTERCHANGE_SCHEMA_MANIFEST } from "./schemas/manifest.js";
import type { TriangleDoc } from "./schemas/triangle.js";
import type { SelectionDoc } from "./schemas/selection.js";
import type { MethodResultDoc, StochasticResultDoc } from "./schemas/result.js";
import type { StudyDoc } from "./schemas/study.js";
import type { BundleDoc } from "./schemas/bundle.js";
import type { CrosscheckReportDoc } from "./schemas/crosscheck.js";

/**
 * `parseDocument` (spec 4.1): version-checked, schema-validated,
 * integrity-verified, warning-channeled entry point for any interchange
 * document.
 *
 * Order of checks:
 * 1. version acceptance (spec 3.5) — wrong major → UNSUPPORTED_VERSION.
 *    Applies to the outer envelope AND, recursively, to every document
 *    embedded in a study or bundle: each embedded document is a complete
 *    envelope in its own right, so a wrong-major embedded document makes
 *    the enclosing document unreadable, matching the Python reference
 *    adapter (which parses every embedded document recursively);
 * 2. kind dispatch — unknown kind → BAD_INTERCHANGE (a new kind is a spec
 *    minor this reader does not know how to interpret; refusing loudly
 *    beats pretending);
 * 3. zod validation (passthrough: unknown same-major minor fields are
 *    preserved, so a parse → re-serialize hop keeps the integrity tag);
 * 4. integrity verification — per `strictness`, a mismatched tag either
 *    refuses (default; accidental divergence is what the tag exists to
 *    catch) or warns.
 *
 * Reader-side capability warnings (spec 3.2): a triangle with
 * originLengthMonths 1 or 6 parses successfully and reports a warning
 * that computation support is limited — a reader capability note, not a
 * format error.
 */

export type InterchangeDocument =
  | TriangleDoc
  | SelectionDoc
  | MethodResultDoc
  | StochasticResultDoc
  | StudyDoc
  | BundleDoc
  | CrosscheckReportDoc;

export interface ParseDocumentOptions {
  /** How to treat a failed integrity check. Default "refuse". */
  strictness?: "warn" | "refuse";
}

export interface ParsedDocument {
  doc: InterchangeDocument;
  warnings: string[];
}

const SCHEMA_BY_KIND: ReadonlyMap<DocumentKind, z.ZodTypeAny> = new Map(
  INTERCHANGE_SCHEMA_MANIFEST.map((entry) => [entry.kind, entry.schema]),
);

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? `$.${issue.path.join(".")}` : "$"}: ${issue.message}`)
    .join("; ");
}

/**
 * Documents embedded inside a study or bundle, as `<path>` -> document.
 *
 * A study carries whole TriangleDocs, SelectionDocs and result documents; a
 * bundle mirrors the same set under `interchange`. Each is a complete document
 * with its OWN integrity tag over its OWN body.
 */
function embeddedDocuments(doc: InterchangeDocument): { path: string; value: unknown }[] {
  const found: { path: string; value: unknown }[] = [];
  const collect = (prefix: string, list: unknown): void => {
    if (!Array.isArray(list)) return;
    list.forEach((value, index) => found.push({ path: `${prefix}[${index}]`, value }));
  };
  if (doc.kind === "study") {
    collect("$.study.triangles", doc.study.triangles);
    collect("$.study.selections", doc.study.selections);
    collect("$.study.supportingResults", doc.study.supportingResults);
  } else if (doc.kind === "bundle") {
    const mirror = (doc as { interchange?: Record<string, unknown> }).interchange;
    if (mirror !== undefined) {
      collect("$.interchange.triangles", mirror["triangles"]);
      collect("$.interchange.selections", mirror["selections"]);
      collect("$.interchange.results", mirror["results"]);
    }
  }
  return found;
}

export function parseDocument(
  value: unknown,
  options: ParseDocumentOptions = {},
): ParsedDocument {
  const strictness = options.strictness ?? "refuse";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      "An interchange document must be a JSON object with interchangeVersion and kind",
    );
  }
  const raw = value as Record<string, unknown>;
  acceptVersion(raw["interchangeVersion"]);

  const kind = raw["kind"];
  const schema = typeof kind === "string" ? SCHEMA_BY_KIND.get(kind as DocumentKind) : undefined;
  if (schema === undefined) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Unknown document kind ${JSON.stringify(kind)}; this reader understands: ${DOCUMENT_KINDS.join(", ")}`,
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Document of kind "${String(kind)}" failed schema validation: ${formatZodError(parsed.error)}`,
    );
  }
  const doc = parsed.data as InterchangeDocument;

  const warnings: string[] = [];
  const integrity = verifyIntegrity(doc);
  if (!integrity.ok) {
    const message =
      `Integrity tag mismatch on kind "${doc.kind}": document states ` +
      `${integrity.actual ?? "(none)"} but the semantic body hashes to ${integrity.expected}. ` +
      "The document diverged from its stated content after it was stamped.";
    if (strictness === "refuse") {
      throw new ReservingError("BAD_INTERCHANGE", message);
    }
    warnings.push(message);
  }

  // Embedded documents carry their own tags, and nothing checked them. That
  // matters because `appliesTo.triangleIntegrity` is the linkage primitive the
  // referee relies on: a result claims to apply to a triangle BY TAG, so a
  // nested triangle whose tag no longer matches its own body makes every such
  // claim point at something other than what is actually there.
  //
  // Spec 3.5 applies PER DOCUMENT: each embedded document is a complete
  // envelope, so a wrong-major embedded document makes the enclosing
  // document unreadable — matching the Python reference adapter, which
  // parses every embedded document recursively. Version acceptance is not
  // strictness-governed (strictness covers integrity only), so this check
  // runs unconditionally, before the nested integrity check.
  for (const { path, value } of embeddedDocuments(doc)) {
    try {
      acceptVersion((value as Record<string, unknown>)["interchangeVersion"]);
    } catch (error) {
      if (error instanceof ReservingError) {
        throw new ReservingError(error.code, `Embedded document at ${path}: ${error.message}`);
      }
      throw error;
    }
    const nested = verifyIntegrity(value as Parameters<typeof verifyIntegrity>[0]);
    if (nested.ok) continue;
    const nestedKind =
      typeof (value as { kind?: unknown })?.kind === "string"
        ? (value as { kind: string }).kind
        : "unknown";
    const message =
      `Integrity tag mismatch on the embedded "${nestedKind}" document at ${path}: it states ` +
      `${nested.actual ?? "(none)"} but its own semantic body hashes to ${nested.expected}. ` +
      "The enclosing document's tag is intact, so this diverged before it was embedded.";
    if (strictness === "refuse") {
      throw new ReservingError("BAD_INTERCHANGE", message);
    }
    warnings.push(message);
  }

  if (doc.kind === "triangle") {
    const cadence = doc.triangle.originLengthMonths;
    if (cadence === 1 || cadence === 6) {
      warnings.push(
        `originLengthMonths ${cadence} (${cadence === 1 ? "monthly" : "semiannual"}) parsed ` +
          "successfully, but actuarial-ts computes natively on 12- and 3-month cadences; " +
          "computation support for this triangle is limited",
      );
    }
  }

  return { doc, warnings };
}
