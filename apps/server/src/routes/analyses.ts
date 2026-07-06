import { Router } from "express";
import { z } from "zod";
import { getAnalysis, getProject, listAnalyses } from "../db/repo.js";
import {
  HttpError,
  runFullAnalysis,
  runSensitivity,
} from "../services/workspaceService.js";

export const analysesRouter = Router({ mergeParams: true });

function requireProject(id: string) {
  const project = getProject(id);
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  return project;
}

analysesRouter.get("/", (req, res) => {
  const project = requireProject((req.params as { id: string }).id);
  res.json({ analyses: listAnalyses(project.id) });
});

analysesRouter.post("/", (req, res) => {
  const project = requireProject((req.params as { id: string }).id);
  const body = z.object({ label: z.string().trim().max(200).optional() }).parse(req.body ?? {});
  const record = runFullAnalysis(project.id, body.label);
  res.status(201).json({ analysis: record });
});

const sensitivitySchema = z.object({
  basis: z.enum(["paid", "incurred"]),
  selections: z.array(z.number().positive().nullable()).optional(),
  tailFactor: z.number().positive().optional(),
});

analysesRouter.post("/sensitivity", (req, res) => {
  const project = requireProject((req.params as { id: string }).id);
  const body = sensitivitySchema.parse(req.body);
  res.json(runSensitivity(project.id, body));
});

analysesRouter.get("/:analysisId", (req, res) => {
  const params = req.params as unknown as { id: string; analysisId: string };
  const project = requireProject(params.id);
  const record = getAnalysis(params.analysisId);
  if (!record || record.projectId !== project.id) {
    throw new HttpError(404, "NOT_FOUND", "Analysis not found");
  }
  res.json({ analysis: record });
});
