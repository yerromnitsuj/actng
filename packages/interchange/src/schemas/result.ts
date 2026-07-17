import { z } from "zod";
import { envelopeShape, generatorSchema, integritySchema } from "../envelope.js";

/**
 * MethodResultDoc / StochasticResultDoc (spec 3.2).
 *
 * - `appliesTo` links results to their inputs by integrity tag;
 *   `selectionIntegrity` is null for runs with no selection document.
 * - Method namespaces: actuarial-ts discriminants unprefixed, `clpy:` for
 *   chainladder-python, `rcl:` for R ChainLadder.
 * - `effectiveParameters` records what the engine ACTUALLY did when it
 *   deviated from what was requested (R's est.sigma auto-fallback);
 *   absent = as requested. The referee downgrades requested≠effective
 *   comparisons with a comparability warning.
 * - StochasticResultDoc adds seed/nSims/summary/byOrigin; samples travel
 *   only via `samplesRef` in the bulk lane. Cross-engine stochastic
 *   comparison is distribution-level only.
 */

export const resultAppliesToSchema = z
  .object({
    triangleIntegrity: integritySchema,
    selectionIntegrity: integritySchema.nullable(),
  })
  .passthrough();

export type ResultAppliesTo = z.infer<typeof resultAppliesToSchema>;

export const engineStampSchema = generatorSchema
  .extend({ conventionProfile: z.string().optional() })
  .passthrough();

export type EngineStamp = z.infer<typeof engineStampSchema>;

export const methodResultRowSchema = z
  .object({
    origin: z.string().min(1),
    ultimate: z.number().finite(),
    unpaid: z.number().finite(),
    standardError: z.number().finite().optional(),
  })
  .passthrough();

export type MethodResultRow = z.infer<typeof methodResultRowSchema>;

export const methodResultTotalsSchema = z
  .object({
    ultimate: z.number().finite(),
    unpaid: z.number().finite(),
    standardError: z.number().finite().optional(),
  })
  .passthrough();

export type MethodResultTotals = z.infer<typeof methodResultTotalsSchema>;

const resultCommonShape = {
  appliesTo: resultAppliesToSchema,
  engine: engineStampSchema,
  method: z.string().min(1),
  parameters: z.record(z.unknown()),
  effectiveParameters: z.record(z.unknown()).optional(),
  warnings: z.array(z.string()).optional(),
};

export const methodResultBodySchema = z
  .object({
    ...resultCommonShape,
    rows: z.array(methodResultRowSchema),
    totals: methodResultTotalsSchema,
  })
  .passthrough();

export type MethodResultBody = z.infer<typeof methodResultBodySchema>;

export const methodResultDocSchema = z
  .object({
    ...envelopeShape("method-result"),
    result: methodResultBodySchema,
  })
  .passthrough();

export type MethodResultDoc = z.infer<typeof methodResultDocSchema>;

/** Bulk-lane reference for raw simulation output (spec 3.3). */
export const samplesRefSchema = z
  .object({ format: z.literal("arrow"), path: z.string().min(1), sha256: z.string().min(1) })
  .passthrough();

export const stochasticSummarySchema = z
  .object({
    mean: z.number().finite(),
    sd: z.number().finite(),
    cv: z.number().finite().nullable(),
    /** e.g. { "75": ..., "95": ... } — percentile label → value. */
    percentiles: z.record(z.number().finite()),
  })
  .passthrough();

export const stochasticResultBodySchema = z
  .object({
    ...resultCommonShape,
    seed: z.number().int().optional(),
    nSims: z.number().int().positive(),
    summary: stochasticSummarySchema,
    byOrigin: z.array(z.object({ origin: z.string().min(1) }).passthrough()),
    samplesRef: samplesRefSchema.optional(),
    /** Point-estimate rows/totals may accompany the distribution summary. */
    rows: z.array(methodResultRowSchema).optional(),
    totals: methodResultTotalsSchema.optional(),
  })
  .passthrough();

export type StochasticResultBody = z.infer<typeof stochasticResultBodySchema>;

export const stochasticResultDocSchema = z
  .object({
    ...envelopeShape("stochastic-result"),
    result: stochasticResultBodySchema,
  })
  .passthrough();

export type StochasticResultDoc = z.infer<typeof stochasticResultDocSchema>;
