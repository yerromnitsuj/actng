import { z } from "zod";
import sourceManifest from "../source-manifest.json";

const sourceManifestSchema = z
  .object({
    dataset: z.string().min(1),
    doi: z.string().regex(/^10\.57745\/[A-Z0-9]+$/),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    pinnedUrl: z.string().url(),
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    sourceByteLength: z.number().int().positive(),
    sourceUpdatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    license: z.literal("Etalab-2.0"),
  })
  .strict();

/** Single validated source of truth shared by fetch, analysis, and disclosure. */
export const SOURCE = Object.freeze(sourceManifestSchema.parse(sourceManifest));
