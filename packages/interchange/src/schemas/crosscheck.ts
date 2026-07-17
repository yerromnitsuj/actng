import { z } from "zod";
import { envelopeShape } from "../envelope.js";
import { engineStampSchema, resultAppliesToSchema } from "./result.js";

/**
 * CrosscheckReportDoc (spec 3.2 / 5) — the referee's output: engines
 * compared (with versions and profiles), the appliesTo tags matched,
 * requested and effective parameter sets, per-origin and total relative
 * deviations, the tolerance applied, and the verdict.
 *
 * Verdicts:
 * - `agree` / `disagree`: independent recomputations inside/outside the
 *   tolerance.
 * - `not-comparable`: the inputs do not describe the same computation
 *   (mismatched appliesTo tags, differing convention profiles, differing
 *   origin sets, or a failed injection on either shore).
 * - `verified-by-value`: the results match but the selection was
 *   value-only, so no independent recomputation occurred — disclosure
 *   renders it distinctly so nothing overstates what was checked.
 */

export const CROSSCHECK_VERDICTS = [
  "agree",
  "disagree",
  "not-comparable",
  "verified-by-value",
] as const;

export type CrosscheckVerdict = (typeof CROSSCHECK_VERDICTS)[number];

/** Relative deviations per metric; null = not compared (metric absent on a side). */
export const deviationCellSchema = z
  .object({
    ultimate: z.number().nullable(),
    unpaid: z.number().nullable(),
    standardError: z.number().nullable(),
  })
  .passthrough();

export const originDeviationSchema = deviationCellSchema
  .extend({ origin: z.string().min(1) })
  .passthrough();

const parameterSetSchema = z
  .object({
    requested: z.record(z.unknown()),
    effective: z.record(z.unknown()).nullable(),
  })
  .passthrough();

export const crosscheckBodySchema = z
  .object({
    engines: z.object({ a: engineStampSchema, b: engineStampSchema }).passthrough(),
    /** The matched tags; null when the inputs' tags did not match. */
    appliesTo: resultAppliesToSchema.nullable(),
    parameters: z.object({ a: parameterSetSchema, b: parameterSetSchema }).passthrough(),
    tolerance: z
      .object({
        central: z.number().positive(),
        standardError: z.number().positive().nullable(),
      })
      .passthrough(),
    deviations: z
      .object({
        perOrigin: z.array(originDeviationSchema),
        totals: deviationCellSchema,
      })
      .passthrough(),
    verdict: z.enum(CROSSCHECK_VERDICTS),
    warnings: z.array(z.string()),
  })
  .passthrough();

export type CrosscheckBody = z.infer<typeof crosscheckBodySchema>;

export const crosscheckReportDocSchema = z
  .object({
    ...envelopeShape("crosscheck-report"),
    /** Semantic body key per spec rev 2.1: `report` (the head-noun rule). */
    report: crosscheckBodySchema,
  })
  .passthrough();

export type CrosscheckReportDoc = z.infer<typeof crosscheckReportDocSchema>;
