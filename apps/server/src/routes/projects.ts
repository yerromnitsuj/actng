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
import { parseClaimsUpload, parseExposuresUpload } from "../services/importService.js";
import { HttpError } from "../services/workspaceService.js";

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
  res.json({
    imported: claims.length,
    claimCount: new Set(claims.map((c) => c.claimId)).size,
    replaced: true,
  });
});

projectsRouter.post("/:id/import/exposures", upload.single("file"), async (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) throw new HttpError(404, "NOT_FOUND", "Project not found");
  if (!req.file) throw new HttpError(400, "NO_FILE", "Attach a CSV or Excel file as 'file'");
  const exposures = await parseExposuresUpload(req.file.originalname, req.file.buffer);
  replaceExposures(project.id, exposures);
  res.json({ imported: exposures.length, replaced: true });
});
