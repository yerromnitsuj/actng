/**
 * Cross-restart promotion proof OVER MCP, phase B. Runs in a FRESH process
 * against the same ACTNG_DATA_DIR as phase A: the paused run — staged over the
 * MCP surface — is resumed THROUGH the workspace MCP server's advance_promotion
 * executeTool (with simulated bearer auth info), gate by gate, to applied. The
 * chain is reconstructed deterministically from the persisted study document
 * inside advancePromotion (the same path the route uses), so the MCP surface
 * needs no in-process state to survive a restart. Then it proves the workspace
 * selections changed and the ledger note carries the actor AND attestation
 * verbatim — the accountability record travels the MCP path identically.
 *
 * Confirming the run is paused reads getPromotionView (deterministic from the
 * persisted state; there is no promotion-read tool over MCP, by design — the
 * MCP surface stages and advances, it does not expose run internals). The DRIVE
 * is purely through the MCP advance_promotion executeTool.
 *
 * Usage: ACTNG_DATA_DIR=<scratch> npx tsx scripts/verify-mcp-promotion-restart-phase-b.ts <runId> <projectId>
 */
import { RequestContext } from "@mastra/core/request-context";

if (!process.env.ACTNG_DATA_DIR) {
  throw new Error("Set ACTNG_DATA_DIR to the phase-A scratch directory first");
}
const [runId, projectId] = process.argv.slice(2);
if (!runId || !projectId) throw new Error("Usage: ... <runId> <projectId>");

const repo = await import("../src/db/repo.js");
const ws = await import("../src/services/workspaceService.js");
await import("../src/mastra/index.js"); // registers the Mastra instance
const { getPromotionView } = await import("../src/mastra/promotionRuns.js");
const { workspaceMcp } = await import("../src/mcp/workspaceMcp.js");

const ACTOR = "Dr. Katherine Johnson, FCAS (MCP restart proof)";
const ATTESTATION = "Rationale authored and reviewed by Dr. Katherine Johnson, FCAS (MCP restart proof)";

/** The execution context an authenticated MCP client's call surfaces (the tenant seam). */
function authCtx(pid: string): { requestContext: RequestContext } {
  const rc = new RequestContext();
  rc.set("authInfo", { projectId: pid });
  return { requestContext: rc };
}
const ctx = authCtx(projectId);
const advance = async (args: Record<string, unknown>): Promise<any> => {
  const res = (await workspaceMcp.executeTool("advance_promotion", { runId, ...args }, ctx)) as {
    success: boolean;
    promotion?: any;
    error?: { code: string; message: string };
  };
  if (!res.success) throw new Error(`advance_promotion failed over MCP: ${JSON.stringify(res.error)}`);
  return res.promotion;
};

const paused = getPromotionView(projectId, runId);
if (paused.status !== "awaiting-decision" || paused.gate !== "study-intake") {
  throw new Error(`Phase A should have left the run at study-intake; got ${JSON.stringify(paused)}`);
}
console.log(`rehydrated: ${paused.status} at ${paused.gate}`);

let state = await advance({
  gate: "study-intake",
  decision: "accept",
  rationale: "MCP restart proof: intake evidence is clean",
});
console.log(`after study-intake resume: ${state.status} at ${state.status === "awaiting-decision" ? state.gate : "-"}`);
if (state.status !== "awaiting-decision" || state.gate !== "replay-verify") {
  throw new Error("Resume after restart did not reach replay-verify");
}

state = await advance({
  gate: "replay-verify",
  decision: "accept",
  rationale: "MCP restart proof: replay and referee agree at tolerance",
});
console.log(`after replay-verify resume: ${state.status} at ${state.status === "awaiting-decision" ? state.gate : "-"}`);

state = await advance({
  gate: "rationale",
  decision: "approve",
  rationale: "MCP restart proof: adopting the notebook's volume-weighted GenIns factors",
  attestation: ATTESTATION,
  actor: ACTOR,
});
console.log(`after rationale resume: ${state.status} at ${state.status === "awaiting-decision" ? state.gate : "-"}`);

state = await advance({
  gate: "apply",
  decision: "apply",
  rationale: "MCP restart proof: apply as approved",
});
if (state.status !== "complete" || !state.applied) {
  throw new Error(`Promotion did not complete as applied after cross-process MCP resume: ${JSON.stringify(state)}`);
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

// The accountability record travelled the MCP path: actor AND attestation verbatim.
const ledgerNote = repo
  .listNotes(projectId)
  .find((n) => n.text.startsWith("Study promotion assumption ledger:"));
if (!ledgerNote) throw new Error("Ledger note missing");
if (!ledgerNote.text.includes(ATTESTATION)) {
  throw new Error("Ledger note does not carry the attestation verbatim");
}
if (!ledgerNote.text.includes(ACTOR)) {
  throw new Error("Ledger note does not carry the MCP actor verbatim");
}
console.log("ledger note carries the actor and attestation verbatim");
console.log("CROSS-RESTART MCP PROMOTION RESUME: PROVEN");
process.exit(0);
