import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  listThreads,
  replaceClaims,
  replaceExposures,
} from "../db/repo.js";
import { advisorMemory } from "../mastra/advisor.js";
import {
  parseClaimsUpload,
  parseExposuresUpload,
  parseIlfTableUpload,
  parseRateHistoryUpload,
} from "../services/importService.js";
import { autoFitTailsFromData, HttpError, patchWorkspace } from "../services/workspaceService.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export const projectsRouter = Router();

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().default(""),
});

projectsRouter.get("/", (_req, res) => {
  res.json({ projects: listProjects() });
});

projectsRouter.post("/", (req, res) => {
  const body = createProjectSchema.parse(req.body);
  const project = createProject(body.name, body.description);
  res.status(201).json({ project });
});

projectsRouter.get("/:id", (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  res.json({ project });
});

projectsRouter.delete("/:id", async (req, res) => {
  const projectId = String(req.params.id);
  // Collect thread ids first so the advisor's Mastra memory (a separate
  // store) is cleaned up along with the app-side cascade.
  const threads = listThreads(projectId);
  const removed = deleteProject(projectId);
  if (!removed) throw new HttpError(404, "NOT_FOUND", "Project not found");
  for (const thread of threads) {
    try {
      await advisorMemory.deleteThread(thread.id);
    } catch (err) {
      console.warn(`[projects] failed to delete advisor memory thread ${thread.id}:`, err);
    }
  }
  res.status(204).end();
});

/**
 * Loss-run import. A loss run is a point-in-time extract, so importing
 * REPLACES the project's claim data (idempotent re-imports, no double counts).
 */
projectsRouter.post("/:id/import/claims", upload.single("file"), async (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  if (!req.file) throw new HttpError(400, "NO_FILE", "Attach a CSV or Excel file as 'file'");
  const claims = await parseClaimsUpload(req.file.originalname, req.file.buffer);
  replaceClaims(project.id, claims);
  // A new extract gets fresh default tails fitted from its own development.
  const tails = autoFitTailsFromData(project.id);
  res.json({
    imported: claims.length,
    claimCount: new Set(claims.map((c) => c.claimId)).size,
    replaced: true,
    tails: tails.applied,
    warnings: tails.warnings,
  });
});

projectsRouter.post("/:id/import/ilf-table", upload.single("file"), async (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  if (!req.file) throw new HttpError(400, "NO_FILE", "Attach a CSV or Excel file as 'file'");
  const table = await parseIlfTableUpload(req.file.originalname, req.file.buffer);
  // Import = data load only. Switching the restoration source (and setting a
  // finite target, which tables require) stays an explicit user act - an
  // upload must never silently reroute or break the next run's restoration.
  const view = patchWorkspace(project.id, { ilf: { table } });
  res.json({
    imported: table.length,
    replaced: true,
    ilf: view.state.ilf,
    note: "Table loaded. To restore with it, select the table source and set a finite target limit in the Increased limits exhibit.",
  });
});

projectsRouter.post("/:id/import/rate-history", upload.single("file"), async (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  if (!req.file) throw new HttpError(400, "NO_FILE", "Attach a CSV or Excel file as 'file'");
  const history = await parseRateHistoryUpload(req.file.originalname, req.file.buffer);
  const view = patchWorkspace(project.id, { rates: { history } });
  res.json({ imported: history.length, replaced: true, rates: view.state.rates });
});

projectsRouter.post("/:id/import/exposures", upload.single("file"), async (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  if (!req.file) throw new HttpError(400, "NO_FILE", "Attach a CSV or Excel file as 'file'");
  const exposures = await parseExposuresUpload(req.file.originalname, req.file.buffer);
  replaceExposures(project.id, exposures);
  res.json({ imported: exposures.length, replaced: true });
});
