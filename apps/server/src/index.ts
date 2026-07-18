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
import { assertMcpProjectExists, mountWorkspaceMcp, runMcpBootSelfTest } from "./mcp/workspaceMcp.js";

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

// Governed workspace over MCP (spec rev 2.1 section 8): mounted only when
// ACTNG_MCP_TOKEN is set, before the 404 catch-all. Absent token = disabled.
const mcpEnabled = mountWorkspaceMcp(app);

app.use((req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route ${req.method} ${req.path}` } });
});

app.use(errorHandler);

async function start(): Promise<void> {
  if (mcpEnabled) {
    // Prove the MCP tenant seam fails closed BEFORE accepting any client. A
    // missed wire-up would fail open; assertFailClosed throws and startup
    // aborts if the probe read tool does not reject an unauthenticated call.
    assertMcpProjectExists();
    await runMcpBootSelfTest();
    console.log(
      `[server] MCP enabled at /mcp (project ${env.mcpProjectId}); boot self-test passed (read + write probes failed closed without auth)`,
    );
  } else {
    console.log("[server] MCP disabled (ACTNG_MCP_TOKEN not set)");
  }

  app.listen(env.port, () => {
    console.log(`[server] ActNG API listening on http://localhost:${env.port}`);
    console.log(`[server] Advisor model: ${env.advisorModel} (key ${env.anthropicApiKey ? "present" : "MISSING"})`);
    console.log(`[server] Data directory: ${env.dataDir}`);
  });
}

start().catch((err) => {
  console.error("[server] startup aborted:", err);
  process.exit(1);
});
