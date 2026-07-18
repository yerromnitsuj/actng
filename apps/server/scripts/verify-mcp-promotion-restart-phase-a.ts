/**
 * Cross-restart promotion proof OVER MCP, phase A. The same two-layer
 * persistence the route-path proof exercises (verify-promotion-restart-phase-a.ts),
 * but the study is staged THROUGH the workspace MCP server's stage_study
 * executeTool with simulated bearer auth info (projectId carried in authInfo,
 * the tenant seam requireMcpTenant reads) — not the HTTP route. Seeds a scratch
 * project (both bases selected, so the apply gate's analysis rerun is possible),
 * imports the COMMITTED Jupyter-authored GenIns study fixture, stages it via
 * MCP, lets it suspend at the study-intake gate, and prints the runId. Phase B
 * resumes it from a SEPARATE node process via the MCP advance_promotion
 * executeTool, standing in for a server restart; this proves the MCP surface
 * shares the identical restart-proof persistence as the route path — both
 * delegate to startPromotion/advancePromotion (apps/server/src/mastra/promotionRuns.ts).
 *
 * Usage: ACTNG_DATA_DIR=<scratch> npx tsx scripts/verify-mcp-promotion-restart-phase-a.ts
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { RequestContext } from "@mastra/core/request-context";

if (!process.env.ACTNG_DATA_DIR) {
  throw new Error("Set ACTNG_DATA_DIR to a scratch directory first");
}

const repo = await import("../src/db/repo.js");
const ws = await import("../src/services/workspaceService.js");
const synthetic = await import("../src/seed/synthetic.js");
await import("../src/mastra/index.js"); // registers the Mastra instance
const { workspaceMcp } = await import("../src/mcp/workspaceMcp.js");

/** The execution context an authenticated MCP client's call surfaces (the tenant seam). */
function authCtx(projectId: string): { requestContext: RequestContext } {
  const rc = new RequestContext();
  rc.set("authInfo", { projectId }); // what the bearer middleware sets on req.auth
  return { requestContext: rc };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, "../data/demo/demo-study.json");
const study = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

const project = repo.createProject(
  "mcp-promotion-restart-proof",
  "cross-restart promotion verification over the MCP surface",
);
const { claims, exposures } = synthetic.generateSyntheticLossRun({
  seed: 77,
  nYears: 10,
  startYear: 2016,
  asOfDate: "2025-12-31",
});
repo.insertClaims(project.id, claims);
repo.replaceExposures(project.id, exposures);
const view = ws.getWorkspaceView(project.id);
const allWtd = (basis: "paid" | "incurred") =>
  view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
ws.patchWorkspace(project.id, { selections: { basis: "paid", selected: allWtd("paid") } });
ws.patchWorkspace(project.id, { selections: { basis: "incurred", selected: allWtd("incurred") } });

// Stage the study THROUGH the MCP surface — the tenant comes from authInfo,
// never from the tool args (the study object carries no project id).
const result = (await workspaceMcp.executeTool(
  "stage_study",
  { study },
  authCtx(project.id),
)) as { success: boolean; promotion?: any; error?: { code: string; message: string } };

if (!result.success) {
  throw new Error(`stage_study failed over MCP: ${JSON.stringify(result.error)}`);
}
const state = result.promotion;
if (state.status !== "awaiting-decision" || state.gate !== "study-intake") {
  throw new Error(`Expected suspension at study-intake, got ${JSON.stringify(state)}`);
}
console.log(
  JSON.stringify({ runId: state.runId, projectId: project.id, suspendedAt: state.gate }),
);
process.exit(0);
