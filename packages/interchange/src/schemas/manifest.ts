import type { z } from "zod";
import type { DocumentKind } from "../envelope.js";
import { triangleDocSchema } from "./triangle.js";
import { selectionDocSchema } from "./selection.js";
import { methodResultDocSchema, stochasticResultDocSchema } from "./result.js";
import { studyDocSchema } from "./study.js";
import { bundleDocSchema } from "./bundle.js";
import { crosscheckReportDocSchema } from "./crosscheck.js";

/**
 * Schema publication manifest (spec 3.4). The zod schemas here are the
 * single source of truth; they are mechanically emitted to JSON Schema
 * under `schema/interchange/1.0/` (committed, URL-referenced by the
 * Python/R validators). A vitest regenerates and diffs — drift fails the
 * build; `scripts/emit-schema.ts` rewrites the committed files.
 *
 * `emitJsonSchema` takes the zod→JSON-Schema converter as an argument so
 * `zod-to-json-schema` stays a devDependency (emission is build-time
 * only; the published package depends on core + zod, nothing else).
 *
 * The emitted schemas are the STRUCTURAL contract. TS-side refinements
 * (rationale-required-for-judgmental, medial-trim scoping, grid shape)
 * are enforced by the zod schemas and restated in the spec; non-TS
 * validators implement them as semantic checks beside the JSON Schema.
 */

export interface SchemaManifestEntry {
  kind: DocumentKind;
  fileName: string;
  schema: z.ZodTypeAny;
}

export const INTERCHANGE_SCHEMA_MANIFEST: readonly SchemaManifestEntry[] = [
  { kind: "triangle", fileName: "triangle.schema.json", schema: triangleDocSchema },
  { kind: "selection", fileName: "selection.schema.json", schema: selectionDocSchema },
  { kind: "method-result", fileName: "method-result.schema.json", schema: methodResultDocSchema },
  {
    kind: "stochastic-result",
    fileName: "stochastic-result.schema.json",
    schema: stochasticResultDocSchema,
  },
  { kind: "study", fileName: "study.schema.json", schema: studyDocSchema },
  { kind: "bundle", fileName: "bundle.schema.json", schema: bundleDocSchema },
  {
    kind: "crosscheck-report",
    fileName: "crosscheck-report.schema.json",
    schema: crosscheckReportDocSchema,
  },
];

/** Options both the emit script and the drift test must pass to the converter. */
export function emitOptionsFor(kind: DocumentKind): { name: string; [key: string]: unknown } {
  return { name: kind, target: "jsonSchema7", $refStrategy: "none" };
}

export interface EmittedSchema {
  kind: DocumentKind;
  fileName: string;
  /** The serialized file content, byte-exact (2-space indent + trailing newline). */
  content: string;
}

/**
 * Emits every document kind's JSON Schema through the supplied converter
 * (pass `zod-to-json-schema`'s default export). Build-time only.
 */
export function emitJsonSchema(
  convert: (schema: z.ZodTypeAny, options: { name: string }) => unknown,
): EmittedSchema[] {
  return INTERCHANGE_SCHEMA_MANIFEST.map(({ kind, fileName, schema }) => ({
    kind,
    fileName,
    content: `${JSON.stringify(convert(schema, emitOptionsFor(kind)), null, 2)}\n`,
  }));
}
