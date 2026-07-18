import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The crosscheck_with_python workbench tool (interop C3).
 *
 * - The not-configured path runs ALWAYS: without SIDECAR_URL/SIDECAR_TOKEN
 *   the tool returns a clear envelope and touches nothing.
 * - The live path is env-gated on SIDECAR_URL + SIDECAR_TOKEN being set
 *   (this suite boots nothing itself): it seeds a synthetic book, applies
 *   volume-weighted selections, and expects the deterministic referee to
 *   call agreement between the workbench engine and chainladder-python.
 *
 * Env-flip note: the tool reads SIDECAR_URL/SIDECAR_TOKEN from process.env
 * at CALL time (deployment config, not boot config), so each test sets the
 * environment it needs and restores it after.
 */

process.env.ACTNG_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "actng-crosscheck-test-"));

const LIVE_URL = process.env.SIDECAR_URL;
const LIVE_TOKEN = process.env.SIDECAR_TOKEN;
const live = Boolean(LIVE_URL && LIVE_TOKEN);

type Tools = typeof import("../src/mastra/tools.js");
type Repo = typeof import("../src/db/repo.js");
type WorkspaceService = typeof import("../src/services/workspaceService.js");
type Synthetic = typeof import("../src/seed/synthetic.js");
type RequestContextModule = typeof import("@mastra/core/request-context");

let tools: Tools;
let repo: Repo;
let ws: WorkspaceService;
let synthetic: Synthetic;
let RequestContext: RequestContextModule["RequestContext"];
let projectId: string;

beforeAll(async () => {
  tools = await import("../src/mastra/tools.js");
  repo = await import("../src/db/repo.js");
  ws = await import("../src/services/workspaceService.js");
  synthetic = await import("../src/seed/synthetic.js");
  ({ RequestContext } = await import("@mastra/core/request-context"));

  const project = repo.createProject("Crosscheck book", "");
  projectId = project.id;
  const { claims, exposures } = synthetic.generateSyntheticLossRun({
    seed: 7,
    nYears: 6,
    startYear: 2020,
    asOfDate: "2025-12-31",
  });
  repo.insertClaims(projectId, claims);
  repo.replaceExposures(projectId, exposures);
});

function contextFor(id: string) {
  const requestContext = new RequestContext();
  requestContext.set("projectId", id);
  return { requestContext } as never;
}

/** Applies the full volume-weighted all-period vector on both bases. */
function applyAllWtdSelections(): void {
  const view = ws.getWorkspaceView(projectId);
  for (const basis of ["paid", "incurred"] as const) {
    const allWtd = view.factors[basis].averages.find((a) => a.spec.key === "all-wtd");
    expect(allWtd).toBeDefined();
    ws.patchWorkspace(projectId, {
      selections: { basis, selected: [...allWtd!.values] },
    });
  }
}

async function executeCrosscheck(): Promise<Record<string, unknown>> {
  return (await tools.crosscheckWithPython.execute!(
    {},
    contextFor(projectId),
  )) as Record<string, unknown>;
}

/** Runs fn with SIDECAR_URL/SIDECAR_TOKEN forced to the given values (unset
 * when undefined), restoring the caller's environment afterwards. */
async function withSidecarEnv<T>(
  url: string | undefined,
  token: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = { url: process.env.SIDECAR_URL, token: process.env.SIDECAR_TOKEN };
  if (url === undefined) delete process.env.SIDECAR_URL;
  else process.env.SIDECAR_URL = url;
  if (token === undefined) delete process.env.SIDECAR_TOKEN;
  else process.env.SIDECAR_TOKEN = token;
  try {
    return await fn();
  } finally {
    if (saved.url === undefined) delete process.env.SIDECAR_URL;
    else process.env.SIDECAR_URL = saved.url;
    if (saved.token === undefined) delete process.env.SIDECAR_TOKEN;
    else process.env.SIDECAR_TOKEN = saved.token;
  }
}

describe("crosscheck_with_python: configuration gate", () => {
  it("is registered as a read tool (never flags a client refresh)", () => {
    expect(tools.advisorTools["crosscheck_with_python"]).toBeDefined();
    expect(tools.ACTION_TOOL_IDS.has("crosscheck_with_python")).toBe(false);
  });

  it("returns a clear SIDECAR_NOT_CONFIGURED envelope when the env is absent", async () => {
    const result = await withSidecarEnv(undefined, undefined, executeCrosscheck);
    expect(result).toMatchObject({
      success: false,
      error: { code: "SIDECAR_NOT_CONFIGURED" },
    });
    expect(String((result as { error: { message: string } }).error.message)).toContain("SIDECAR_URL");
  });

  it("also refuses when only one of the two variables is set", async () => {
    const result = await withSidecarEnv("http://127.0.0.1:1", undefined, executeCrosscheck);
    expect(result).toMatchObject({ success: false, error: { code: "SIDECAR_NOT_CONFIGURED" } });
  });

  it("refuses to compare a partially-selected workspace (before any network I/O)", async () => {
    // Sidecar "configured" with a dead endpoint: the selections guard must
    // fire first, so this never attempts a connection.
    const result = await withSidecarEnv("http://127.0.0.1:1", "dead", executeCrosscheck);
    expect(result).toMatchObject({ success: false, error: { code: "INCOMPLETE_SELECTIONS" } });
  });
});

(live ? describe : describe.skip)("crosscheck_with_python: live sidecar (env-gated)", () => {
  it(
    "referees the workbench vs chainladder-python to agreement on both profiles",
    { timeout: 120_000 },
    async () => {
      applyAllWtdSelections();
      const result = await executeCrosscheck();
      expect(result["success"]).toBe(true);

      const summary = result["summary"] as {
        verdict: string;
        maxCentral: number;
        maxStandardError: number | null;
        engineVersions: { a: string; b: string };
        warnings: string[];
      };
      expect(summary.engineVersions.a).toMatch(/^actuarial-ts@/);
      expect(summary.engineVersions.b).toMatch(/^chainladder-python@/);

      const crosschecks = result["crosschecks"] as Record<string, Record<string, unknown>>;
      const cl = crosschecks["deterministic-cl"]!;
      expect(cl["verdict"]).toBe("agree");
      expect(cl["maxCentral"]).toBeLessThanOrEqual(1e-6);

      const mack = crosschecks["mack1993-vw"]!;
      expect(mack["skipped"]).toBeUndefined();
      expect(mack["verdict"]).toBe("agree");

      expect(summary.verdict).toBe("agree");
    },
  );
});
