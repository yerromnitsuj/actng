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
 * StudyDoc (spec 3.2) — the promotion unit: a notebook study packaged for
 * the governed workflow.
 *
 * - `narrative.summary` must be non-empty (adapters refuse an empty
 *   summary; the Python `save_study` does the same).
 * - `supportingResults` is OPTIONAL: when absent, promotion Gate 2 verifies
 *   coherence + replays with no cross-engine referee step.
 * - `expectations.replayTolerance` is subject to the host ceiling at
 *   promotion time (spec 6) — the schema carries it, the host enforces it.
 * - `governance` sits BESIDE the semantic body: reserved, round-tripped
 *   opaquely by every adapter, not covered by the integrity tag (which
 *   covers the `study` object only, per spec 3.1).
 *
 * The interfaces are written out (rather than z.infer'd) because the
 * composite document types exceed tsc's declaration-emit serialization
 * limit; the schemas are annotated with them, so the two cannot drift
 * without a compile error.
 */

export interface StudyNarrative {
  analyst?: string;
  sourceRef?: string;
  summary: string;
  [key: string]: unknown;
}

export interface StudyExpectations {
  replayTolerance?: number;
  [key: string]: unknown;
}

export interface StudyBody {
  title: string;
  narrative: StudyNarrative;
  triangles: TriangleDoc[];
  selections: SelectionDoc[];
  supportingResults?: (MethodResultDoc | StochasticResultDoc)[];
  expectations?: StudyExpectations;
  [key: string]: unknown;
}

export interface StudyDoc {
  interchangeVersion: string;
  kind: "study";
  generator: GeneratorStamp & { [key: string]: unknown };
  createdAt: string;
  extensions?: Record<string, unknown>;
  integrity: string;
  study: StudyBody;
  /** Reserved; round-tripped opaquely by non-TS adapters. */
  governance?: Record<string, unknown>;
  [key: string]: unknown;
}

export const studyNarrativeSchema: z.ZodType<StudyNarrative> = z
  .object({
    analyst: z.string().optional(),
    sourceRef: z.string().optional(),
    summary: z.string().min(1),
  })
  .passthrough();

export const studyExpectationsSchema: z.ZodType<StudyExpectations> = z
  .object({ replayTolerance: z.number().positive().optional() })
  .passthrough();

export const studyBodySchema: z.ZodType<StudyBody> = z
  .object({
    title: z.string().min(1),
    narrative: studyNarrativeSchema,
    triangles: z.array(triangleDocSchema),
    selections: z.array(selectionDocSchema),
    supportingResults: z
      .array(z.union([methodResultDocSchema, stochasticResultDocSchema]))
      .optional(),
    expectations: studyExpectationsSchema.optional(),
  })
  .passthrough();

export const studyDocSchema: z.ZodType<StudyDoc> = z
  .object({
    ...envelopeShape("study"),
    study: studyBodySchema,
    governance: z.record(z.unknown()).optional(),
  })
  .passthrough();
