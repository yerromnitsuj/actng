import { z } from "zod";
import { envelopeShape, type GeneratorStamp } from "../envelope.js";
import { type TriangleDoc, triangleDocSchema } from "./triangle.js";
import { type SelectionDoc, selectionDocSchema } from "./selection.js";
import {
  type MethodResultDoc,
  type StochasticResultDoc,
  methodResultDocSchema,
  stochasticResultDocSchema,
} from "./result.js";

/**
 * BundleDoc (spec 3.2) — the wrapped reproducibility bundle.
 *
 * - `bundle` is the host's existing canonical payload, carried opaquely
 *   (this package must not depend on @actuarial-ts/compliance; compliance
 *   depends on interchange for the wrapper, not the reverse).
 * - `interchange` mirrors the bundle's triangles, selections, and results
 *   as interchange documents so a non-TS consumer (`load_bundle`) never
 *   parses the TS-native blob.
 * - The OUTER integrity tag is defined over `{ bundle, interchange }`
 *   (spec 3.2), so the mirror cannot drift from the wrapped payload
 *   unnoticed. `verifyBundle`'s wrapped mode (Phase B, in compliance)
 *   checks the inner bundle exactly as today AND this outer tag.
 *
 * Interfaces are written out for the same declaration-emit reason as
 * study.ts; the schema annotations keep them honest.
 */

export interface BundleInterchange {
  triangles: TriangleDoc[];
  selections: SelectionDoc[];
  results: (MethodResultDoc | StochasticResultDoc)[];
  [key: string]: unknown;
}

export interface BundleDoc {
  interchangeVersion: string;
  kind: "bundle";
  generator: GeneratorStamp & { [key: string]: unknown };
  createdAt: string;
  extensions?: Record<string, unknown>;
  integrity: string;
  /** The host's existing canonical bundle payload, opaque at this layer. */
  bundle: Record<string, unknown>;
  interchange: BundleInterchange;
  [key: string]: unknown;
}

export const bundleInterchangeSchema: z.ZodType<BundleInterchange> = z
  .object({
    triangles: z.array(triangleDocSchema),
    selections: z.array(selectionDocSchema),
    results: z.array(z.union([methodResultDocSchema, stochasticResultDocSchema])),
  })
  .passthrough();

export const bundleDocSchema: z.ZodType<BundleDoc> = z
  .object({
    ...envelopeShape("bundle"),
    bundle: z.record(z.unknown()),
    interchange: bundleInterchangeSchema,
  })
  .passthrough();
