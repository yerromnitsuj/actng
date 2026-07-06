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
  demoDir: path.join(dataDir, "demo"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  advisorModel: process.env.ADVISOR_MODEL ?? "claude-opus-4-8",
};

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
