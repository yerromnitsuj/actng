/**
 * Cross-restart persistence proof, phase A. Seeds a scratch project, starts
 * the ELR derivation workflow, lets it suspend at the cap gate, and prints
 * the runId. Phase B resumes it from a SEPARATE node process, standing in
 * for a server restart; without durable Mastra storage the rehydrated run
 * fails to resume ("This workflow run was not suspended").
 *
 * Usage: ACTNG_DATA_DIR=<scratch> npx tsx scripts/verify-restart-resume-phase-a.ts
 */
if (!process.env.ACTNG_DATA_DIR) {
  throw new Error("Set ACTNG_DATA_DIR to a scratch directory first");
}

const repo = await import("../src/db/repo.js");
const ws = await import("../src/services/workspaceService.js");
const synthetic = await import("../src/seed/synthetic.js");
const { RequestContext } = await import("@mastra/core/request-context");
const { mastra } = await import("../src/mastra/index.js");

const project = repo.createProject("restart-proof", "cross-restart resume verification");
const { claims, exposures } = synthetic.generateSyntheticLossRun({
  seed: 101,
  nYears: 6,
  startYear: 2020,
  asOfDate: "2025-12-31",
});
repo.insertClaims(project.id, claims);
repo.replaceExposures(project.id, exposures);
const view = ws.getWorkspaceView(project.id);
const allWtd = (basis: "paid" | "incurred") =>
  view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
ws.patchWorkspace(project.id, { selections: { basis: "paid", selected: allWtd("paid") } });
ws.patchWorkspace(project.id, { selections: { basis: "incurred", selected: allWtd("incurred") } });
ws.runFullAnalysis(project.id, "workflow base");

const rc = new RequestContext<{ projectId: string }>();
rc.set("projectId", project.id);
const wf = mastra.getWorkflow("deriveExpectedLossesWorkflow");
const run = await wf.createRun();
const result = (await run.start({ inputData: {}, requestContext: rc })) as {
  status: string;
  suspended?: string[][];
};
if (result.status !== "suspended" || result.suspended?.[0]?.[0] !== "cap-gate") {
  throw new Error(`Expected suspension at cap-gate, got ${JSON.stringify(result.status)}`);
}
console.log(JSON.stringify({ runId: run.runId, projectId: project.id, suspendedAt: "cap-gate" }));
process.exit(0);
