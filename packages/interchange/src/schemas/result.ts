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

/**
 * How much a consumer may rely on re-running this result.
 *
 * A seed is NOT the same guarantee as reproducibility: it removes one source
 * of variance, but the engine underneath may still be non-deterministic. This
 * field says which promise the document actually carries, so an actuary knows
 * whether they hold a derivation anyone can regenerate or an observation
 * somebody recorded.
 *
 * - `seeded-reproducible` — re-running with this seed reproduces this document
 *   byte-for-byte. @actuarial-ts/core's own stochastic layer is this
 *   (packages/core/test/odpBootstrap.test.ts pins it), because it uses a seeded
 *   PRNG with no ambient randomness.
 * - `witnessed` — the engine is NOT byte-reproducible even under a fixed seed.
 *   The document is a tamper-evident record of what that engine produced on
 *   that run, not something a reviewer can regenerate. Still legitimate ASOP
 *   No. 56 evidence — it just supports an attestation, not a replay.
 *
 * Absent means unstated (documents written before this field existed); treat
 * an absent value as unknown, never as a reproducibility guarantee.
 *
 * Deterministic methods do not carry this field: kind `method-result` already
 * implies reproducibility, and the frozen conformance corpus proves it across
 * three independent shores.
 */
export const reproducibilitySchema = z.enum(["seeded-reproducible", "witnessed"]);

export type Reproducibility = z.infer<typeof reproducibilitySchema>;

/**
 * The engine's own self-check: it ran the identical seeded request more than
 * once and reports whether the runs agreed. This is what lets a
 * non-reproducible engine be HONEST rather than silently unstable — the
 * instability is measured and disclosed on the document instead of surfacing
 * later as a mysteriously failing test.
 */
export const stabilityCheckSchema = z
  .object({
    /** How many independent runs of the identical seeded request were compared (>= 2). */
    repeats: z.number().int().min(2),
    /** True when every repeat produced the identical semantic body. */
    byteIdentical: z.boolean(),
    /**
     * Worst relative deviation observed across repeats on the summary mean,
     * using the cross-shore definition |a-b| / max(|a|,|b|). Null when not
     * computable. Zero with byteIdentical=false means the bodies differed
     * somewhere other than the summary mean.
     */
    maxRelativeDeviation: z.number().finite().nonnegative().nullable(),
  })
  .passthrough();

export type StabilityCheck = z.infer<typeof stabilityCheckSchema>;

export const stochasticResultBodySchema = z
  .object({
    ...resultCommonShape,
    seed: z.number().int().optional(),
    nSims: z.number().int().positive(),
    /** Which reproducibility promise this document carries; see the schema doc. */
    reproducibility: reproducibilitySchema.optional(),
    /** The engine's repeat-run self-check, when it performed one. */
    stability: stabilityCheckSchema.optional(),
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
