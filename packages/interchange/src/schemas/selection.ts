import { z } from "zod";
import { envelopeShape, integritySchema } from "../envelope.js";
import { measureSchema } from "./triangle.js";

/**
 * SelectionDoc (spec 3.2): intent + values, with the coherence rule.
 *
 * - Intent is authoritative for replay and promotion; values are
 *   authoritative only for `judgmental`/`external` intents, whose
 *   `rationale` is REQUIRED (it carries the judgment's justification).
 * - `windowOriginPeriods` counts ORIGIN PERIODS in the triangle's own
 *   cadence; omitted = all periods.
 * - `excludeHigh`/`excludeLow` are medial trims and are valid ONLY with
 *   `kind: "medial"` (the spec's normative comment; its illustrative
 *   example showing zeros on a volume-weighted intent is not).
 * - The coherence rule itself (recompute computable intents within 1e-9
 *   relative, warn|refuse on divergence) is enforced by
 *   `convert/selection.ts`, not by this structural schema.
 */

export const DEVELOPMENT_INTENT_KINDS = [
  "volume-weighted",
  "simple",
  "regression",
  "geometric",
  "medial",
  "judgmental",
  "external",
] as const;

export type DevelopmentIntentKind = (typeof DEVELOPMENT_INTENT_KINDS)[number];

/** Intent kinds whose `value` is the judgment itself (never recomputed). */
export const VALUE_AUTHORITATIVE_KINDS = ["judgmental", "external"] as const;

export const exclusionSchema = z
  .object({ origin: z.string().min(1), reason: z.string().optional() })
  .passthrough();

function requireRationale(
  intent: { kind: string; rationale?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (
    (VALUE_AUTHORITATIVE_KINDS as readonly string[]).includes(intent.kind) &&
    (intent.rationale === undefined || intent.rationale.trim() === "")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `rationale is required when intent kind is "${intent.kind}"`,
      path: ["rationale"],
    });
  }
}

export const developmentIntentSchema = z
  .object({
    kind: z.enum(DEVELOPMENT_INTENT_KINDS),
    windowOriginPeriods: z.number().int().positive().optional(),
    excludeHigh: z.number().int().nonnegative().optional(),
    excludeLow: z.number().int().nonnegative().optional(),
    exclusions: z.array(exclusionSchema).optional(),
    rationale: z.string().optional(),
  })
  .passthrough()
  .superRefine((intent, ctx) => {
    requireRationale(intent, ctx);
    if (intent.kind !== "medial") {
      for (const field of ["excludeHigh", "excludeLow"] as const) {
        if (intent[field] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${field} is a medial trim; it is valid only with kind "medial"`,
            path: [field],
          });
        }
      }
    }
  });

export type DevelopmentIntent = z.infer<typeof developmentIntentSchema>;

export const developmentSelectionSchema = z
  .object({
    fromAgeMonths: z.number().int().positive(),
    toAgeMonths: z.number().int().positive(),
    value: z.number().finite(),
    intent: developmentIntentSchema,
  })
  .passthrough()
  .superRefine((entry, ctx) => {
    if (entry.toAgeMonths <= entry.fromAgeMonths) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "toAgeMonths must be greater than fromAgeMonths",
        path: ["toAgeMonths"],
      });
    }
  });

export type DevelopmentSelection = z.infer<typeof developmentSelectionSchema>;

export const TAIL_FAMILIES = ["exponential-decay", "inverse-power"] as const;

export type TailFamily = (typeof TAIL_FAMILIES)[number];

export const tailIntentSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("fitted"),
        family: z.enum(TAIL_FAMILIES),
        /** First development age (months) included in the fit; omitted = all. */
        fitFromAgeMonths: z.number().int().positive().optional(),
        /** Informative fit coefficients; the coherence check refits from data. */
        params: z
          .object({ intercept: z.number(), slope: z.number() })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    z
      .object({ kind: z.literal("judgmental"), rationale: z.string().optional() })
      .passthrough(),
    z
      .object({ kind: z.literal("external"), rationale: z.string().optional() })
      .passthrough(),
  ])
  .superRefine((intent, ctx) => {
    requireRationale(intent, ctx);
  });

export type TailIntent = z.infer<typeof tailIntentSchema>;

export const tailSelectionSchema = z
  .object({ value: z.number().finite(), intent: tailIntentSchema })
  .passthrough();

export type TailSelection = z.infer<typeof tailSelectionSchema>;

export const selectionAppliesToSchema = z
  .object({ measure: measureSchema, triangleIntegrity: integritySchema })
  .passthrough();

export const selectionBodySchema = z
  .object({
    appliesTo: selectionAppliesToSchema,
    development: z.array(developmentSelectionSchema),
    tail: tailSelectionSchema.optional(),
  })
  .passthrough();

export type SelectionBody = z.infer<typeof selectionBodySchema>;

export const selectionDocSchema = z
  .object({
    ...envelopeShape("selection"),
    selection: selectionBodySchema,
  })
  .passthrough();

export type SelectionDoc = z.infer<typeof selectionDocSchema>;

/** True when every intent in the selection is judgmental/external — i.e., a
 * replay applies values directly and no independent recomputation occurs
 * (the referee's `verified-by-value` case). */
export function isValueOnlySelection(body: SelectionBody): boolean {
  const devValueOnly = body.development.every((d) =>
    (VALUE_AUTHORITATIVE_KINDS as readonly string[]).includes(d.intent.kind),
  );
  const tailValueOnly =
    body.tail === undefined ||
    (VALUE_AUTHORITATIVE_KINDS as readonly string[]).includes(body.tail.intent.kind);
  return devValueOnly && tailValueOnly;
}
