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
 * 1. version acceptance (spec 3.5) — wrong major → UNSUPPORTED_VERSION;
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
