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

const patchSchema = z.object({
  cadence: z.enum(["annual", "quarterly"]).optional(),
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  basis: z.enum(["paid", "incurred"]).optional(),
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
      weights: z
        .object({
          clPaid: z.number().min(0).optional(),
          clIncurred: z.number().min(0).optional(),
          bfPaid: z.number().min(0).optional(),
          bfIncurred: z.number().min(0).optional(),
          bsCase: z.number().min(0).optional(),
          bsSettlement: z.number().min(0).optional(),
        })
        .optional(),
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
