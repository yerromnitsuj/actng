import { Router } from "express";
import { z } from "zod";
import { getProject, insertNote, listNotes } from "../db/repo.js";
import { HttpError } from "../services/workspaceService.js";

export const notesRouter = Router({ mergeParams: true });

notesRouter.get("/", (req, res) => {
  const projectId = (req.params as { id: string }).id;
  if (!getProject(projectId)) throw new HttpError(404, "NOT_FOUND", "Project not found");
  res.json({ notes: listNotes(projectId) });
});

notesRouter.post("/", (req, res) => {
  const projectId = (req.params as { id: string }).id;
  if (!getProject(projectId)) throw new HttpError(404, "NOT_FOUND", "Project not found");
  const body = z.object({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
  res.status(201).json({ note: insertNote(projectId, "user", body.text) });
});
