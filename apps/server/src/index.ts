import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import { ZodError } from "zod";
import { MulterError } from "multer";
import { ReservingError } from "@actng/core";
import { env } from "./env.js";
import { HttpError } from "./services/workspaceService.js";
import { projectsRouter } from "./routes/projects.js";
import { workspaceRouter } from "./routes/workspace.js";
import { analysesRouter } from "./routes/analyses.js";
import { notesRouter } from "./routes/notes.js";
import { chatRouter } from "./routes/chat.js";

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

app.use((req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route ${req.method} ${req.path}` } });
});

// Central error translation: typed errors become structured responses;
// anything unexpected is logged with context and returned as a 500.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ReservingError) {
    res.status(422).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    res.status(400).json({
      error: {
        code: "VALIDATION",
        message: `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid request"}`,
      },
    });
    return;
  }
  if (err instanceof MulterError) {
    res.status(400).json({ error: { code: err.code, message: err.message } });
    return;
  }
  const anyErr = err as { statusCode?: number; code?: string; message?: string };
  if (typeof anyErr?.statusCode === "number" && anyErr.statusCode < 500) {
    res.status(anyErr.statusCode).json({
      error: { code: anyErr.code ?? "ERROR", message: anyErr.message ?? "Request failed" },
    });
    return;
  }
  console.error(`[server] Unhandled error on ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
});

app.listen(env.port, () => {
  console.log(`[server] ActNG API listening on http://localhost:${env.port}`);
  console.log(`[server] Advisor model: ${env.advisorModel} (key ${env.anthropicApiKey ? "present" : "MISSING"})`);
  console.log(`[server] Data directory: ${env.dataDir}`);
});
