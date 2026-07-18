import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RequestContext } from "@mastra/core/request-context";

/**
 * The workbench MCP server (interop plan task D2, spec rev 2.1 section 8 — the
 * exposure policy is a SECURITY policy). Tests exercise the tools through the
 * real MCPServer.executeTool surface (no live LLM), asserting:
 *
 *  - the exposed tool list EQUALS the policy allowlist (no direct mutation);
 *  - a read tool resolves its tenant from MCP auth info and fails CLOSED
 *    without it (NO_TENANT_CONTEXT);
 *  - stage_study -> advance_promotion walks all four gates, actor recorded
 *    verbatim in the ledger (default "external-mcp-client" and an explicit one);
 *  - direct-mutation tool names are not resolvable;
 *  - the boot self-test passes; MCP is disabled without a token.
 *
 * The env module resolves paths at import time; ACTNG_DATA_DIR is set before
 * any server module is imported (hence the dynamic imports). ACTNG_MCP_TOKEN
 * is deliberately UNSET so the disabled-path assertions hold — the enabled
 * HTTP path is covered by the live boot smoke, not here.
 */

process.env.ACTNG_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "actng-mcp-test-"));
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

/** A RequestContext seeded with the given key/value pairs. */
function requestContext(entries: Record<string, unknown>): RequestContext {
  const rc = new RequestContext();
  for (const [key, value] of Object.entries(entries)) rc.set(key, value);
  return rc;
}

/** The execution context an MCP client's authenticated call surfaces. */
function authCtx(projectId: string): { requestContext: RequestContext } {
  return { requestContext: requestContext({ authInfo: { projectId } }) };
}

beforeAll(async () => {
  repo = await import("../src/db/repo.js");
  ws = await import("../src/services/workspaceService.js");
  synthetic = await import("../src/seed/synthetic.js");
  // Boot registers the Mastra instance promotion runs are registered on.
  await import("../src/mastra/index.js");
  mcp = await import("../src/mcp/workspaceMcp.js");
});

/**
 * A 10-origin annual workspace (the GenIns study's nine development columns),
 * all-wtd selections on both bases so the apply gate's full-analysis rerun is
 * possible — the readiness a real workspace has when a study is imported.
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

describe("workspace MCP exposure policy (spec 8)", () => {
  it("exposes EXACTLY the policy allowlist — no direct-mutation tools", async () => {
    const list = await mcp.workspaceMcp.getToolListInfo();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toEqual([...mcp.EXPECTED_MCP_TOOL_NAMES].sort());

    // The staged-write guarantee: no direct mutation surface leaked.
    for (const name of names) {
      expect(name.startsWith("set_")).toBe(false);
      expect(name.includes("patch")).toBe(false);
      expect(name.startsWith("apply_")).toBe(false);
      expect(name.includes("run_analysis")).toBe(false);
    }
    // The read-only advisor is exposed as ask_advisor; the two gated writes are present.
    expect(names).toContain("ask_advisor");
    expect(names).toContain("stage_study");
    expect(names).toContain("advance_promotion");
  });

  it("does not resolve direct-mutation tool names (not found)", async () => {
    for (const forbidden of ["patchWorkspace", "apply_ldf_selections", "run_analysis", "set_tail_factor", "save_note"]) {
      await expect(mcp.workspaceMcp.executeTool(forbidden, {}, authCtx("p-any"))).rejects.toThrow(
        /Unknown tool|not found/i,
      );
    }
  });
});

describe("MCP read tools: tenant seam", () => {
  it("resolves the tenant from auth info and returns the workspace overview", async () => {
    const projectId = seedProject("MCP read with auth");
    const result = (await mcp.workspaceMcp.executeTool(
      "get_workspace_overview",
      {},
      authCtx(projectId),
    )) as { success: boolean; origins?: string[] };
    expect(result.success).toBe(true);
    expect(result.origins).toEqual([
      "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025",
    ]);
  });

  it("FAILS CLOSED without auth info: NO_TENANT_CONTEXT envelope", async () => {
    const result = (await mcp.workspaceMcp.executeTool("get_workspace_overview", {}, {})) as {
      success: boolean;
      error?: { code: string };
    };
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NO_TENANT_CONTEXT");
  });

  it("the boot self-test passes because BOTH a read and a write probe fail closed", async () => {
    await expect(mcp.runMcpBootSelfTest()).resolves.toBeUndefined();
  });

  it("assertMcpProjectExists throws loudly when the configured project is missing", () => {
    // env.mcpProjectId is unset in the test env, so the guard is a no-op;
    // drive it directly against a nonexistent id to prove it fails loud.
    // (The real boot path calls it in index.ts start() before listening.)
    const existing = seedProject("project-existence guard");
    expect(mcp.assertMcpProjectExistsFor(existing)).toBeUndefined();
    expect(() => mcp.assertMcpProjectExistsFor("does-not-exist-999")).toThrowError(
      /names no existing project/,
    );
  });
});

describe("MCP staged-write path: stage_study -> advance_promotion", () => {
  /** Stages the fixture study and walks all four gates via executeTool. */
  async function walk(
    projectId: string,
    options: { actor?: string; attestation: string; finalRationale: string },
  ): Promise<{ success: boolean; promotion: any }> {
    const ctx = authCtx(projectId);
    const staged = (await mcp.workspaceMcp.executeTool(
      "stage_study",
      { study: loadFixture() },
      ctx,
    )) as { success: boolean; promotion: any };
    expect(staged.success).toBe(true);
    expect(staged.promotion).toMatchObject({ status: "awaiting-decision", gate: "study-intake" });
    const runId: string = staged.promotion.runId;

    const intake = (await mcp.workspaceMcp.executeTool(
      "advance_promotion",
      { runId, gate: "study-intake", decision: "accept", rationale: "intake evidence is clean" },
      ctx,
    )) as { success: boolean; promotion: any };
    expect(intake.promotion.gate).toBe("replay-verify");

    const replay = (await mcp.workspaceMcp.executeTool(
      "advance_promotion",
      { runId, gate: "replay-verify", decision: "accept", rationale: "replay and referee agree" },
      ctx,
    )) as { success: boolean; promotion: any };
    expect(replay.promotion.gate).toBe("rationale");

    const rationale = (await mcp.workspaceMcp.executeTool(
      "advance_promotion",
      {
        runId,
        gate: "rationale",
        decision: "approve",
        rationale: options.finalRationale,
        attestation: options.attestation,
        ...(options.actor !== undefined ? { actor: options.actor } : {}),
      },
      ctx,
    )) as { success: boolean; promotion: any };
    expect(rationale.promotion.gate).toBe("apply");

    const applied = (await mcp.workspaceMcp.executeTool(
      "advance_promotion",
      { runId, gate: "apply", decision: "apply", rationale: "apply as approved" },
      ctx,
    )) as { success: boolean; promotion: any };
    return applied;
  }

  it("defaults the actor to external-mcp-client, recorded verbatim in the ledger", async () => {
    const projectId = seedProject("MCP promotion default actor");
    const attestation = "Reviewed by the notebook client operator";
    const finalRationale = "Adopting the notebook's volume-weighted GenIns factors";
    const applied = await walk(projectId, { attestation, finalRationale });

    expect(applied.success).toBe(true);
    expect(applied.promotion).toMatchObject({ status: "complete", applied: true, abortedAt: null });
    expect(applied.promotion.trail.map((t: { stage: string }) => t.stage)).toEqual([
      "study-intake",
      "replay-verify",
      "rationale",
      "apply",
    ]);

    const entries = applied.promotion.ledger.entries as {
      field: string;
      value: unknown;
      rationale?: string;
    }[];
    const attestationEntry = entries.find((e) => e.field === "promotion.attestation")!;
    expect(attestationEntry).toBeDefined();
    // The RAW actor identity lands verbatim: default "external-mcp-client".
    expect(attestationEntry.value).toEqual({ attestation, actor: "external-mcp-client" });
    expect(attestationEntry.rationale).toBe(finalRationale);

    // Verbatim in the persisted ledger NOTE too.
    const ledgerNote = repo
      .listNotes(projectId)
      .find((n) => n.text.startsWith("Study promotion assumption ledger:"))!;
    expect(ledgerNote).toBeDefined();
    expect(ledgerNote.text).toContain("external-mcp-client");

    // The workspace actually changed through the service layer.
    const expected = (loadFixture() as any).study.selections[0].selection.development.map(
      (d: { value: number }) => d.value,
    );
    const state = ws.ensureWorkspaceState(projectId);
    const activePaid = ws.activeSelections(state).paid;
    for (let i = 0; i < expected.length; i++) {
      expect(activePaid[i]).toBeCloseTo(expected[i], 8);
    }
  }, 60_000);

  it("records an explicit actor with the MCP transport marker (disclosure-true)", async () => {
    const projectId = seedProject("MCP promotion explicit actor");
    const actor = "Dr. Ada Lovelace, FCAS";
    const attestation = "Rationale authored and reviewed by Dr. Ada Lovelace, FCAS";
    const finalRationale = "Explicit-actor GenIns promotion over MCP";
    const applied = await walk(projectId, { actor, attestation, finalRationale });

    expect(applied.success).toBe(true);
    const entries = applied.promotion.ledger.entries as { field: string; value: unknown }[];
    const attestationEntry = entries.find((e) => e.field === "promotion.attestation")!;
    // The transport marker means a client-supplied "actuary" could never be
    // mistaken for an in-workbench human; the raw identity survives inside it.
    expect(attestationEntry.value).toEqual({ attestation, actor: `${actor} (via MCP)` });

    const ledgerNote = repo
      .listNotes(projectId)
      .find((n) => n.text.startsWith("Study promotion assumption ledger:"))!;
    expect(ledgerNote.text).toContain(`${actor} (via MCP)`);
  }, 60_000);

  it("requires a non-blank rationale (RATIONALE_REQUIRED envelope)", async () => {
    const projectId = seedProject("MCP promotion blank rationale");
    const staged = (await mcp.workspaceMcp.executeTool(
      "stage_study",
      { study: loadFixture() },
      authCtx(projectId),
    )) as { promotion: any };
    const blank = (await mcp.workspaceMcp.executeTool(
      "advance_promotion",
      { runId: staged.promotion.runId, gate: "study-intake", decision: "accept", rationale: "   " },
      authCtx(projectId),
    )) as { success: boolean; error?: { code: string } };
    expect(blank.success).toBe(false);
    expect(blank.error?.code).toBe("RATIONALE_REQUIRED");
  }, 60_000);

  it("rejects a bare (non-object) study with a BAD_INTERCHANGE envelope", async () => {
    const projectId = seedProject("MCP promotion bad study");
    const result = (await mcp.workspaceMcp.executeTool(
      "stage_study",
      { study: "not-a-study" },
      authCtx(projectId),
    )) as { success: boolean; error?: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("BAD_INTERCHANGE");
  });
});

describe("MCP disabled without a token", () => {
  it("mountWorkspaceMcp returns false and /mcp is not routed", async () => {
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json());
    const enabled = mcp.mountWorkspaceMcp(app);
    expect(enabled).toBe(false);
    app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND" } }));

    const server = app.listen(0);
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      const res = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(res.status).toBe(404);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("NOT_FOUND");
    } finally {
      server.close();
    }
  });
});

afterAll(() => {
  // no shared server to tear down; per-test express apps close themselves.
});
