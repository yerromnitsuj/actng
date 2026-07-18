import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RequestContext } from "@mastra/core/request-context";

/**
 * Interop spec rev 2.1 §13 PHASE D ACCEPTANCE, as a committed test.
 *
 * The spec's acceptance clause, verbatim: "an external MCP client completes a
 * promotion through the gates with its actor recorded as supplied (or the
 * honest default), cannot reach any direct mutation tool, and the no-auth
 * probe fails closed."
 *
 * This file is the ACCEPTANCE tier: one cohesive "external client session"
 * driven PURELY through MCPServer.executeTool (the MCP surface, no live LLM),
 * folding all three ACCEPT clauses into a single narrative plus the honest-
 * default-actor branch. The per-seam UNIT coverage (exact allowlist
 * enumeration, blank-rationale / bad-study envelopes, mount-disabled path)
 * lives in workspaceMcp.test.ts (task D2) and is deliberately NOT duplicated
 * here — this test asserts the end-to-end acceptance criteria, not the seams.
 *
 * The env module resolves paths at import time, so ACTNG_DATA_DIR is set and
 * the MCP token cleared BEFORE any server module is imported (dynamic imports
 * below). Vitest isolates test files, so this file's data dir is its own.
 */

process.env.ACTNG_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "actng-mcp-accept-"));
delete process.env.ACTNG_MCP_TOKEN;
delete process.env.ACTNG_MCP_PROJECT_ID;

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(here, "../data/demo/demo-study.json");

type Repo = typeof import("../src/db/repo.js");
type WorkspaceService = typeof import("../src/services/workspaceService.js");
type Synthetic = typeof import("../src/seed/synthetic.js");
type WorkspaceMcp = typeof import("../src/mcp/workspaceMcp.js");

let repo: Repo;
let ws: WorkspaceService;
let synthetic: Synthetic;
let mcp: WorkspaceMcp;

const loadFixture = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;

/** The execution context an authenticated MCP client's call surfaces (auth info bag). */
function authCtx(projectId: string): { requestContext: RequestContext } {
  const rc = new RequestContext();
  rc.set("authInfo", { projectId });
  return { requestContext: rc };
}

beforeAll(async () => {
  repo = await import("../src/db/repo.js");
  ws = await import("../src/services/workspaceService.js");
  synthetic = await import("../src/seed/synthetic.js");
  // Boot registers the Mastra instance the promotion runs are registered on.
  await import("../src/mastra/index.js");
  mcp = await import("../src/mcp/workspaceMcp.js");
});

/**
 * A ready 10-origin annual workspace (the GenIns study's nine development
 * columns), with all-wtd selections on BOTH bases so the apply gate's
 * full-analysis rerun is possible — the readiness a real workspace has when a
 * notebook study is imported.
 */
function seedProject(name: string): string {
  const project = repo.createProject(name, "");
  const { claims, exposures } = synthetic.generateSyntheticLossRun({
    seed: 77,
    nYears: 10,
    startYear: 2016,
    asOfDate: "2025-12-31",
  });
  repo.insertClaims(project.id, claims);
  repo.replaceExposures(project.id, exposures);
  const view = ws.getWorkspaceView(project.id);
  for (const basis of ["paid", "incurred"] as const) {
    const allWtd = view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
    ws.patchWorkspace(project.id, { selections: { basis, selected: allWtd } });
  }
  return project.id;
}

/**
 * Drives an external client's staged promotion PURELY through executeTool:
 * stage_study, then advance through all four gates to applied. `actor` is
 * threaded through only when supplied (undefined omits it, exercising the
 * honest default). Returns the final applied promotion.
 */
async function externalClientPromotes(
  projectId: string,
  options: { actor?: string; attestation: string; finalRationale: string },
): Promise<{ success: boolean; promotion: any }> {
  const ctx = authCtx(projectId);
  const exec = (tool: string, args: Record<string, unknown>) =>
    mcp.workspaceMcp.executeTool(tool, args, ctx) as Promise<{ success: boolean; promotion: any }>;

  const staged = await exec("stage_study", { study: loadFixture() });
  expect(staged.success).toBe(true);
  expect(staged.promotion).toMatchObject({ status: "awaiting-decision", gate: "study-intake" });
  const runId: string = staged.promotion.runId;

  const intake = await exec("advance_promotion", {
    runId,
    gate: "study-intake",
    decision: "accept",
    rationale: "acceptance: intake evidence is clean",
  });
  expect(intake.promotion.gate).toBe("replay-verify");

  const replay = await exec("advance_promotion", {
    runId,
    gate: "replay-verify",
    decision: "accept",
    rationale: "acceptance: replay and referee agree at tolerance",
  });
  expect(replay.promotion.gate).toBe("rationale");

  const rationale = await exec("advance_promotion", {
    runId,
    gate: "rationale",
    decision: "approve",
    rationale: options.finalRationale,
    attestation: options.attestation,
    ...(options.actor !== undefined ? { actor: options.actor } : {}),
  });
  expect(rationale.promotion.gate).toBe("apply");

  return exec("advance_promotion", {
    runId,
    gate: "apply",
    decision: "apply",
    rationale: "acceptance: apply as approved",
  });
}

/** Asserts the study's paid selection vector actually landed in the workspace via the service layer. */
function assertWorkspaceChanged(projectId: string): void {
  const expected = (loadFixture() as any).study.selections[0].selection.development.map(
    (d: { value: number }) => d.value,
  );
  const activePaid = ws.activeSelections(ws.ensureWorkspaceState(projectId)).paid;
  expect(activePaid.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(activePaid[i]).toBeCloseTo(expected[i], 8);
  }
}

/** The persisted ledger note for the project (the audit artifact a reviewer reads). */
function ledgerNoteText(projectId: string): string {
  const note = repo
    .listNotes(projectId)
    .find((n) => n.text.startsWith("Study promotion assumption ledger:"));
  expect(note, "a persisted assumption-ledger note").toBeDefined();
  return note!.text;
}

describe("interop spec rev 2.1 §13 Phase D acceptance: external MCP client", () => {
  it(
    "completes a promotion (actor as supplied), cannot reach a direct-mutation tool, and fails closed without auth",
    async () => {
      const projectId = seedProject("Phase D acceptance — supplied actor");
      const ctx = authCtx(projectId);
      const actor = "Dr. Grace Hopper, FCAS";
      const attestation = "Rationale authored and reviewed by Dr. Grace Hopper, FCAS (Phase D acceptance)";
      const finalRationale = "Acceptance: adopting the notebook's volume-weighted GenIns factors";

      // Preamble: the client establishes READ access before it writes (the
      // read tools resolve their tenant from the same auth info).
      const overview = (await mcp.workspaceMcp.executeTool("get_workspace_overview", {}, ctx)) as {
        success: boolean;
        origins?: string[];
      };
      expect(overview.success).toBe(true);
      expect(overview.origins?.length).toBeGreaterThan(0);

      // ACCEPT clause 1 — completes a promotion through the gates, actor as supplied.
      const applied = await externalClientPromotes(projectId, { actor, attestation, finalRationale });
      expect(applied.success).toBe(true);
      expect(applied.promotion).toMatchObject({ status: "complete", applied: true, abortedAt: null });
      expect(applied.promotion.trail.map((t: { stage: string }) => t.stage)).toEqual([
        "study-intake",
        "replay-verify",
        "rationale",
        "apply",
      ]);

      // The workspace actually changed — through the service layer, not a stub.
      assertWorkspaceChanged(projectId);

      // The supplied actor is recorded with the MCP transport marker so the
      // ledger is disclosure-true: an external client's decision can never be
      // mistaken for an in-workbench human's. The raw identity survives inside
      // the marked string.
      const entries = applied.promotion.ledger.entries as { field: string; value: unknown }[];
      const attestationEntry = entries.find((e) => e.field === "promotion.attestation")!;
      expect(attestationEntry.value).toEqual({ attestation, actor: `${actor} (via MCP)` });
      expect(ledgerNoteText(projectId)).toContain(`${actor} (via MCP)`);
      // The coarse ledger enum on the decision entries is a NON-human value
      // (the transport-marked string is not the reserved word "actuary").
      const decisionActors = entries
        .filter((e) => e.field.startsWith("selections."))
        .map((e) => (e as { actor?: string }).actor);
      expect(decisionActors.every((a) => a !== "actuary")).toBe(true);

      // ACCEPT clause 2 — cannot reach ANY direct mutation tool. The write-shaped
      // surface is only the two gated promotion tools; a direct mutation name is
      // not even resolvable, WITH valid auth (so this is exposure, not authz).
      await expect(mcp.workspaceMcp.executeTool("patchWorkspace", {}, ctx)).rejects.toThrow(
        /Unknown tool|not found/i,
      );

      // ACCEPT clause 3 — the no-auth probe FAILS CLOSED (no auth info at all).
      const noAuth = (await mcp.workspaceMcp.executeTool("get_workspace_overview", {}, {})) as {
        success: boolean;
        error?: { code: string };
      };
      expect(noAuth.success).toBe(false);
      expect(noAuth.error?.code).toBe("NO_TENANT_CONTEXT");
    },
    60_000,
  );

  it(
    "records the honest default actor (external-mcp-client) when the client names none",
    async () => {
      // ACCEPT clause 1, the "or the honest default" branch: an unattended client
      // that omits `actor` is recorded as external-mcp-client, not a human.
      const projectId = seedProject("Phase D acceptance — default actor");
      const attestation = "Reviewed by the notebook client operator";
      const finalRationale = "Acceptance: default-actor GenIns promotion over MCP";

      const applied = await externalClientPromotes(projectId, { attestation, finalRationale });
      expect(applied.success).toBe(true);
      expect(applied.promotion).toMatchObject({ status: "complete", applied: true });

      const entries = applied.promotion.ledger.entries as { field: string; value: unknown }[];
      const attestationEntry = entries.find((e) => e.field === "promotion.attestation")!;
      expect(attestationEntry.value).toEqual({ attestation, actor: "external-mcp-client" });
      expect(ledgerNoteText(projectId)).toContain("external-mcp-client");
    },
    60_000,
  );
});
