import { Router } from "express";
import { z } from "zod";
import { getProject, getExposures } from "../db/repo.js";
import {
  getWorkspaceView,
  patchWorkspace,
  HttpError,
} from "../services/workspaceService.js";

export const workspaceRouter = Router({ mergeParams: true });

function requireProject(id: string) {
  const project = getProject(id);
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  return project;
}

workspaceRouter.get("/", (req, res) => {
  const project = requireProject((req.params as { id: string }).id);
  const view = getWorkspaceView(project.id);
  res.json({ ...view, exposures: getExposures(project.id) });
});

const weightRecordSchema = z.object({
  clPaid: z.number().min(0).optional(),
  clIncurred: z.number().min(0).optional(),
  bfPaid: z.number().min(0).optional(),
  bfIncurred: z.number().min(0).optional(),
  bsCase: z.number().min(0).optional(),
  bsSettlement: z.number().min(0).optional(),
  ccPaid: z.number().min(0).optional(),
  ccIncurred: z.number().min(0).optional(),
  expectedClaims: z.number().min(0).optional(),
});

/** Exported for schema-contract tests: a weight key zod silently strips can never be set. */
export const patchSchema = z.object({
  cadence: z.enum(["annual", "quarterly"]).optional(),
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  basis: z.enum(["paid", "incurred"]).optional(),
  layer: z
    .object({
      active: z.enum(["unlimited", "capped"]).optional(),
      cap: z.number().positive().nullable().optional(),
      indexRate: z.number().gt(-1).optional(),
      baseYear: z.number().int().min(1900).max(2200).nullable().optional(),
    })
    .optional(),
  rates: z
    .object({
      history: z
        .array(
          z.object({
            effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            change: z.number().gt(-1),
          }),
        )
        .optional(),
      premiumTrend: z.number().gt(-1).nullable().optional(),
    })
    .optional(),
  elr: z
    .object({
      method: z.enum(["loss-ratio", "pure-premium"]).optional(),
      selected: z.number().positive().nullable().optional(),
    })
    .optional(),
  trend: z
    .object({
      frequency: z
        .object({
          source: z.enum(["all", "last5", "last3", "exhilo", "manual"]),
          value: z.number().gt(-1).nullable(),
        })
        .optional(),
      severity: z
        .object({
          layer: z.enum(["unlimited", "capped"]),
          source: z.enum(["all", "last5", "last3", "exhilo", "manual"]),
          value: z.number().gt(-1).nullable(),
        })
        .optional(),
      targetYear: z.number().int().min(1900).max(2200).nullable().optional(),
    })
    .optional(),
  ilf: z
    .object({
      source: z.enum(["none", "fitted", "table", "illustrative"]).optional(),
      fittedKind: z.enum(["lognormal", "pareto"]).optional(),
      curveId: z.string().nullable().optional(),
      targetLimit: z.number().positive().nullable().optional(),
      table: z
        .array(z.object({ limit: z.number().positive(), factor: z.number().positive() }))
        .min(2)
        .nullable()
        .optional(),
    })
    .optional(),
  selections: z
    .object({
      basis: z.enum(["paid", "incurred"]),
      selected: z.array(z.number().positive().nullable()),
    })
    .optional(),
  tail: z
    .object({
      basis: z.enum(["paid", "incurred"]),
      source: z.enum(["manual", "exponentialDecay", "inversePower"]),
      value: z.number().positive().optional(),
    })
    .optional(),
  bf: z.object({ aprioriLossRatio: z.number().positive().nullable() }).optional(),
  berquist: z
    .object({
      severityTrend: z.number().gt(-1).nullable().optional(),
      interpolation: z.enum(["exponential", "linear"]).optional(),
    })
    .optional(),
  ultimateSelection: z
    .object({
      weights: weightRecordSchema.optional(),
      weightsByOrigin: z.record(z.string(), weightRecordSchema).optional(),
      overrides: z.record(z.string(), z.number().positive().nullable()).optional(),
    })
    .optional(),
});

workspaceRouter.patch("/", (req, res) => {
  const project = requireProject((req.params as { id: string }).id);
  const patch = patchSchema.parse(req.body);
  const view = patchWorkspace(project.id, patch);
  res.json({ ...view, exposures: getExposures(project.id) });
});
