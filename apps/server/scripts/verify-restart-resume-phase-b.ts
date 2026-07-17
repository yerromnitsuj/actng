/**
 * Cross-restart persistence proof, phase B. Runs in a FRESH process against
 * the same ACTNG_DATA_DIR as phase A: rehydrates the paused run by runId
 * from durable storage and resumes it through the remaining gates.
 *
 * Usage: ACTNG_DATA_DIR=<scratch> npx tsx scripts/verify-restart-resume-phase-b.ts <runId> <projectId>
 */
if (!process.env.ACTNG_DATA_DIR) {
  throw new Error("Set ACTNG_DATA_DIR to the phase-A scratch directory first");
}
const [runId, projectId] = process.argv.slice(2);
if (!runId || !projectId) throw new Error("Usage: ... <runId> <projectId>");

const { RequestContext } = await import("@mastra/core/request-context");
const { mastra } = await import("../src/mastra/index.js");

const rc = new RequestContext<{ projectId: string }>();
rc.set("projectId", projectId);
const wf = mastra.getWorkflow("deriveExpectedLossesWorkflow");
const run = await wf.createRun({ runId });

let result = (await run.resume({
  step: "cap-gate",
  resumeData: { decision: "skip", rationale: "restart proof: stay unlimited" },
  requestContext: rc,
})) as { status: string; suspended?: string[][]; result?: { selectedElr: number | null } };
console.log(`after cap-gate resume: ${result.status} at ${result.suspended?.[0]?.[0]}`);
if (result.status !== "suspended" || result.suspended?.[0]?.[0] !== "trend-gate") {
  throw new Error("Resume after restart did not reach trend-gate");
}

result = (await run.resume({
  step: "trend-gate",
  resumeData: { decision: "accept", frequency: null, severity: 0.05, rationale: "sev 5%" },
  requestContext: rc,
})) as typeof result;
console.log(`after trend-gate resume: ${result.status} at ${result.suspended?.[0]?.[0]}`);

result = (await run.resume({
  step: "elr-gate",
  resumeData: { decision: "accept", selected: 0.68, rationale: "restart proof ELR" },
  requestContext: rc,
})) as typeof result;
console.log(`final: ${result.status}, selectedElr=${result.result?.selectedElr}`);
if (result.status !== "success" || result.result?.selectedElr !== 0.68) {
  throw new Error("Workflow did not complete after cross-process resume");
}
console.log("CROSS-RESTART RESUME: PROVEN");
process.exit(0);
