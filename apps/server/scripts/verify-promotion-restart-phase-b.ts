/**
 * Cross-restart promotion proof, phase B. Runs in a FRESH process against
 * the same ACTNG_DATA_DIR as phase A: reconstructs the promotion chain
 * deterministically from the persisted study document (eager intake makes
 * the rebuilt chain identical, resume schemas included), re-registers it on
 * the Mastra instance, rehydrates the paused run by runId from durable
 * storage, and resumes it through ALL remaining gates to applied - then
 * proves the workspace selections changed and the ledger note carries the
 * attestation verbatim.
 *
 * Usage: ACTNG_DATA_DIR=<scratch> npx tsx scripts/verify-promotion-restart-phase-b.ts <runId> <projectId>
 */
if (!process.env.ACTNG_DATA_DIR) {
  throw new Error("Set ACTNG_DATA_DIR to the phase-A scratch directory first");
}
const [runId, projectId] = process.argv.slice(2);
if (!runId || !projectId) throw new Error("Usage: ... <runId> <projectId>");

const repo = await import("../src/db/repo.js");
const ws = await import("../src/services/workspaceService.js");
await import("../src/mastra/index.js"); // registers the Mastra instance
const { advancePromotion, getPromotionView } = await import("../src/mastra/promotionRuns.js");

const now = () => new Date().toISOString();
const ATTESTATION = "Rationale authored and reviewed by Jane Actuary, FCAS (restart proof)";

const paused = getPromotionView(projectId, runId);
if (paused.status !== "awaiting-decision" || paused.gate !== "study-intake") {
  throw new Error(`Phase A should have left the run at study-intake; got ${JSON.stringify(paused)}`);
}
console.log(`rehydrated: ${paused.status} at ${paused.gate}`);

let state = await advancePromotion(projectId, runId, "study-intake", {
  decision: "accept",
  rationale: "restart proof: intake evidence is clean",
}, now);
console.log(`after study-intake resume: ${state.status} at ${state.status === "awaiting-decision" ? state.gate : "-"}`);
if (state.status !== "awaiting-decision" || state.gate !== "replay-verify") {
  throw new Error("Resume after restart did not reach replay-verify");
}

state = await advancePromotion(projectId, runId, "replay-verify", {
  decision: "accept",
  rationale: "restart proof: replay and referee agree at tolerance",
}, now);
console.log(`after replay-verify resume: ${state.status} at ${state.status === "awaiting-decision" ? state.gate : "-"}`);

state = await advancePromotion(projectId, runId, "rationale", {
  decision: "approve",
  rationale: "restart proof: adopting the notebook's volume-weighted GenIns factors",
  attestation: ATTESTATION,
}, now);
console.log(`after rationale resume: ${state.status} at ${state.status === "awaiting-decision" ? state.gate : "-"}`);

state = await advancePromotion(projectId, runId, "apply", {
  decision: "apply",
  rationale: "restart proof: apply as approved",
}, now);
if (state.status !== "complete" || !state.applied) {
  throw new Error(`Promotion did not complete as applied after cross-process resume: ${JSON.stringify(state)}`);
}
console.log(`final: ${state.status}, applied=${state.applied}, notes=${state.noteIds.length}, ledger entries=${state.ledger.entries.length}`);

// The selections actually landed: compare the workspace against the study.
const row = repo.getStudyPromotion(runId)!;
const study = JSON.parse(row.studyJson) as {
  study: { selections: { selection: { development: { value: number }[] } }[] };
};
const expected = study.study.selections[0]!.selection.development.map((d) => d.value);
const applied = ws.activeSelections(ws.ensureWorkspaceState(projectId)).paid;
for (let i = 0; i < expected.length; i++) {
  if (applied[i] === null || Math.abs(applied[i]! - expected[i]!) > 1e-9) {
    throw new Error(`Workspace paid selections do not match the study (col ${i}: ${applied[i]} vs ${expected[i]})`);
  }
}
console.log(`workspace paid selections now match the study's ${expected.length} factors`);

const ledgerNote = repo
  .listNotes(projectId)
  .find((n) => n.text.startsWith("Study promotion assumption ledger:"));
if (!ledgerNote || !ledgerNote.text.includes(ATTESTATION)) {
  throw new Error("Ledger note missing or does not carry the attestation verbatim");
}
console.log("ledger note carries the attestation verbatim");
console.log("CROSS-RESTART PROMOTION RESUME: PROVEN");
process.exit(0);
