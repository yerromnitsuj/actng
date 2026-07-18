import express from "express";
import cors from "cors";
import { env } from "./env.js";
import { errorHandler } from "./errorHandler.js";
import { projectsRouter } from "./routes/projects.js";
import { workspaceRouter } from "./routes/workspace.js";
import { analysesRouter } from "./routes/analyses.js";
import { notesRouter } from "./routes/notes.js";
import { chatRouter } from "./routes/chat.js";
import { studiesRouter } from "./routes/studies.js";

const app = express();
app.use(cors({ origin: env.webOrigin }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    advisorConfigured: Boolean(env.anthropicApiKey),
    advisorModel: env.advisorModel,
  });
});

app.use("/api/projects", projectsRouter);
app.use("/api/projects/:id/workspace", workspaceRouter);
app.use("/api/projects/:id/analyses", analysesRouter);
app.use("/api/projects/:id/notes", notesRouter);
app.use("/api/projects/:id/threads", chatRouter);
app.use("/api/projects/:id/studies", studiesRouter);

app.use((req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route ${req.method} ${req.path}` } });
});

app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`[server] ActNG API listening on http://localhost:${env.port}`);
  console.log(`[server] Advisor model: ${env.advisorModel} (key ${env.anthropicApiKey ? "present" : "MISSING"})`);
  console.log(`[server] Data directory: ${env.dataDir}`);
});
