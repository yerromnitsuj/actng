/**
 * Cross-restart promotion proof, phase A. Seeds a scratch project (both
 * bases selected, so the apply gate's analysis rerun is possible), imports
 * the COMMITTED Jupyter-authored GenIns study fixture, starts the promotion
 * chain, lets it suspend at the study-intake gate, and prints the runId.
 * Phase B resumes it from a SEPARATE node process, standing in for a server
 * restart; this validates the two-layer persistence model (study document
 * in the studies table -> deterministic chain reconstruction; Mastra
 * LibSQL snapshot -> run rehydration by runId).
 *
 * Usage: ACTNG_DATA_DIR=<scratch> npx tsx scripts/verify-promotion-restart-phase-a.ts
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

if (!process.env.ACTNG_DATA_DIR) {
  throw new Error("Set ACTNG_DATA_DIR to a scratch directory first");
}

const repo = await import("../src/db/repo.js");
const ws = await import("../src/services/workspaceService.js");
const synthetic = await import("../src/seed/synthetic.js");
await import("../src/mastra/index.js"); // registers the Mastra instance
const { startPromotion } = await import("../src/mastra/promotionRuns.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, "../data/demo/demo-study.json");
const study = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

const project = repo.createProject("promotion-restart-proof", "cross-restart promotion verification");
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

const state = await startPromotion(project.id, study, () => new Date().toISOString());
if (state.status !== "awaiting-decision" || state.gate !== "study-intake") {
  throw new Error(`Expected suspension at study-intake, got ${JSON.stringify(state)}`);
}
console.log(
  JSON.stringify({ runId: state.runId, projectId: project.id, suspendedAt: state.gate }),
);
process.exit(0);
