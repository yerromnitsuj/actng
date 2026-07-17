import { z } from "zod";
import { envelopeShape } from "../envelope.js";

/**
 * TriangleDoc (spec 3.2).
 *
 * - Measure vocabulary is closed with an escape hatch: the seven core
 *   TriangleKind values plus `earnedPremium` plus `custom:<label>`.
 * - Cadence is the integer `originLengthMonths` (12 | 6 | 3 | 1), not an
 *   enum; `origins[].start` disambiguates fiscal/trailing calendars.
 * - Null means unobserved, everywhere. Adapters must never let NaN→0 or
 *   0→missing conversions leak through.
 * - `valuesRef` is the bulk lane (spec 3.3): v1 defines the field; every
 *   v1 conformance fixture uses inline JSON, and this TS reader's
 *   converters require inline values in Phase A.
 */

export const CORE_MEASURES = [
  "paid",
  "incurred",
  "caseReserve",
  "reportedCount",
  "openCount",
  "closedCount",
  "closedWithPayCount",
] as const;

export type CoreMeasure = (typeof CORE_MEASURES)[number];

export const measureSchema = z.union([
  z.enum([...CORE_MEASURES, "earnedPremium"]),
  z.string().regex(/^custom:.+$/, 'custom measures must be namespaced as "custom:<label>"'),
]);

export type Measure = z.infer<typeof measureSchema>;

export const originLengthMonthsSchema = z.union([
  z.literal(12),
  z.literal(6),
  z.literal(3),
  z.literal(1),
]);

export type OriginLengthMonths = z.infer<typeof originLengthMonthsSchema>;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO yyyy-mm-dd date");

export const triangleOriginSchema = z
  .object({ label: z.string().min(1), start: isoDateSchema })
  .passthrough();

/** Bulk-lane reference (spec 3.3). */
export const valuesRefSchema = z
  .object({ format: z.literal("arrow"), path: z.string().min(1), sha256: z.string().min(1) })
  .passthrough();

export const triangleBodySchema = z
  .object({
    measure: measureSchema,
    cumulative: z.boolean(),
    originLengthMonths: originLengthMonthsSchema,
    origins: z.array(triangleOriginSchema).min(1),
    agesMonths: z.array(z.number().int().positive()).min(1),
    /** values[originIndex][ageIndex]; null = not yet observable / missing. */
    values: z.array(z.array(z.number().finite().nullable())).optional(),
    valuesRef: valuesRefSchema.optional(),
    valuationDate: isoDateSchema,
    basis: z
      .object({
        grossNet: z.enum(["gross", "net"]).optional(),
        laeTreatment: z.string().optional(),
      })
      .passthrough()
      .optional(),
    units: z
      .object({ currency: z.string().optional(), scale: z.number().positive().optional() })
      .passthrough()
      .optional(),
    segment: z.object({ labels: z.record(z.string()) }).passthrough().optional(),
  })
  .passthrough()
  .superRefine((body, ctx) => {
    if (body.values === undefined && body.valuesRef === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a triangle needs inline `values` or a bulk-lane `valuesRef`",
      });
    }
    if (body.values !== undefined) {
      if (body.values.length !== body.origins.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `values has ${body.values.length} row(s) but origins has ${body.origins.length}`,
          path: ["values"],
        });
      }
      body.values.forEach((row, i) => {
        if (row.length !== body.agesMonths.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `values[${i}] has ${row.length} column(s) but agesMonths has ${body.agesMonths.length}`,
            path: ["values", i],
          });
        }
      });
    }
    for (let j = 1; j < body.agesMonths.length; j++) {
      if (body.agesMonths[j]! <= body.agesMonths[j - 1]!) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "agesMonths must be strictly ascending",
          path: ["agesMonths", j],
        });
        break;
      }
    }
    for (let i = 1; i < body.origins.length; i++) {
      if (body.origins[i]!.start <= body.origins[i - 1]!.start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "origins must have strictly ascending start dates",
          path: ["origins", i],
        });
        break;
      }
    }
  });

export type TriangleBody = z.infer<typeof triangleBodySchema>;

export const triangleDocSchema = z
  .object({
    ...envelopeShape("triangle"),
    triangle: triangleBodySchema,
  })
  .passthrough();

export type TriangleDoc = z.infer<typeof triangleDocSchema>;
