import { config } from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const repoRoot = path.resolve(serverRoot, "../..");

// Load the repo-root .env (single source of truth), then any server-local one.
config({ path: path.join(repoRoot, ".env") });
config({ path: path.join(serverRoot, ".env") });

const dataDir = process.env.ACTNG_DATA_DIR ?? path.join(serverRoot, "data");
fs.mkdirSync(dataDir, { recursive: true });

export const env = {
  port: Number(process.env.PORT ?? 4600),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5175",
  dataDir,
  dbPath: path.join(dataDir, "actng.db"),
  memoryDbPath: path.join(dataDir, "advisor-memory.db"),
  workflowDbPath: path.join(dataDir, "workflow-runs.db"),
  demoDir: path.join(dataDir, "demo"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  advisorModel: process.env.ADVISOR_MODEL ?? "claude-opus-4-8",
  anthropicBaseUrl: normalizeAnthropicBaseUrl(process.env.ANTHROPIC_BASE_URL),
  /**
   * The host's replay-tolerance ceiling for study promotion (spec rev 2.1
   * section 6, Gate 1): a study STATING a looser replayTolerance than this
   * fails intake, and the effective referee tolerance is min(study, ceiling).
   */
  promotionToleranceCeiling: readPromotionCeiling(),
  /**
   * MCP exposure (spec rev 2.1 section 8). The bearer token that gates the
   * /mcp endpoint; ABSENT => MCP is disabled entirely. When set, a single
   * token grants the one project named in ACTNG_MCP_PROJECT_ID (v1
   * single-tenant simplification — one token, one workspace), which the
   * bearer middleware places on req.auth so the MCP tools read it via
   * requireMcpTenant. Never comes from the model.
   */
  ...readMcpConfig(),
};

/**
 * Reads the MCP exposure config (spec rev 2.1 section 8). ACTNG_MCP_TOKEN
 * absent => MCP disabled (both fields undefined). When the token IS set,
 * ACTNG_MCP_PROJECT_ID is REQUIRED and validated here — a bearer token with
 * no project to grant is a misconfiguration, not a silent single-tenant hole.
 */
function readMcpConfig(): { mcpToken?: string; mcpProjectId?: string } {
  const token = process.env.ACTNG_MCP_TOKEN?.trim();
  if (!token) return {};
  const projectId = process.env.ACTNG_MCP_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error(
      "ACTNG_MCP_PROJECT_ID is required when ACTNG_MCP_TOKEN is set: the v1 single-tenant MCP grants the bearer token exactly one project. Set ACTNG_MCP_PROJECT_ID or unset ACTNG_MCP_TOKEN to disable MCP.",
    );
  }
  return { mcpToken: token, mcpProjectId: projectId };
}

function readPromotionCeiling(): number {
  const raw = process.env.ACTNG_PROMOTION_TOLERANCE_CEILING;
  if (raw === undefined || raw === "") return 0.005;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `ACTNG_PROMOTION_TOLERANCE_CEILING must be a positive number; got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

/**
 * The official Anthropic SDK convention sets ANTHROPIC_BASE_URL without /v1
 * (the SDK appends it), while @ai-sdk/anthropic expects the base URL WITH
 * /v1. Normalize so either convention works, and default to the public API.
 */
function normalizeAnthropicBaseUrl(raw: string | undefined): string {
  if (!raw) return "https://api.anthropic.com/v1";
  const trimmed = raw.replace(/\/+$/, "");
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function assertAdvisorConfigured(): void {
  if (!env.anthropicApiKey) {
    throw Object.assign(
      new Error(
        "ANTHROPIC_API_KEY is not set. The advisor requires it; add it to the repo-root .env file.",
      ),
      { statusCode: 503, code: "ADVISOR_NOT_CONFIGURED" },
    );
  }
}
