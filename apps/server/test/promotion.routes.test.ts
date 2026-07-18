import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";

/**
 * Route-level tests for the study promotion surface (interop plan task B4):
 * the spec 13 Phase B walkthrough - import a REAL Jupyter-authored study
 * (the committed GenIns fixture from
 * interop/python/examples/author_demo_study.py) and walk it through all four
 * gates over HTTP, asserting the workspace actually changed through the
 * service layer - plus the named-error rejection surface.
 *
 * The env module resolves paths at import time, so ACTNG_DATA_DIR is set
 * before any server module is imported (hence the dynamic imports).
 */

process.env.ACTNG_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "actng-promo-test-"));

const here = path.dirname(fileURLToPath(import.meta.url));
/** The COMMITTED fixture (not the scratch data dir the env points at). */
const FIXTURE_PATH = path.resolve(here, "../data/demo/demo-study.json");

type Repo = typeof import("../src/db/repo.js");
type WorkspaceService = typeof import("../src/services/workspaceService.js");
type Synthetic = typeof import("../src/seed/synthetic.js");
type Interchange = typeof import("@actuarial-ts/interchange");
type Compliance = typeof import("@actuarial-ts/compliance");

let repo: Repo;
let ws: WorkspaceService;
let synthetic: Synthetic;
let interchange: Interchange;
let compliance: Compliance;
let server: Server;
let base: string;

interface StudyFixture {
  integrity: string;
  study: {
    title: string;
    expectations?: { replayTolerance?: number };
    triangles: Record<string, unknown>[];
    selections: {
      integrity: string;
      selection: { development: { value: number }[]; tail?: { value: number } };
    }[];
    supportingResults?: Record<string, unknown>[];
  };
}

const loadFixture = (): StudyFixture =>
  JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as StudyFixture;

beforeAll(async () => {
  repo = await import("../src/db/repo.js");
  ws = await import("../src/services/workspaceService.js");
  synthetic = await import("../src/seed/synthetic.js");
  interchange = await import("@actuarial-ts/interchange");
  compliance = await import("@actuarial-ts/compliance");
  // Boot registers the Mastra instance the promotion module registers
  // per-run workflows on (same wiring as the running server).
  await import("../src/mastra/index.js");
  const { studiesRouter } = await import("../src/routes/studies.js");
  const { errorHandler } = await import("../src/errorHandler.js");
  const express = (await import("express")).default;

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/projects/:id/studies", studiesRouter);
  app.use(errorHandler);
  server = app.listen(0);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server?.close();
});

/**
 * A 10-origin annual workspace (the GenIns study's nine development columns
 * must match the workspace triangle), with all-wtd selections on both bases
 * so the apply gate's full-analysis rerun is possible - the same readiness
 * a real workspace has when an actuary imports a study into it.
 */
function seedProject(name: string, options: { nYears?: number; select?: boolean } = {}): string {
  const { nYears = 10, select = true } = options;
  const project = repo.createProject(name, "");
  const { claims, exposures } = synthetic.generateSyntheticLossRun({
    seed: 77,
    nYears,
    startYear: 2026 - nYears,
    asOfDate: "2025-12-31",
  });
  repo.insertClaims(project.id, claims);
  repo.replaceExposures(project.id, exposures);
  if (select) {
    const view = ws.getWorkspaceView(project.id);
    for (const basis of ["paid", "incurred"] as const) {
      const allWtd = view.factors[basis].averages.find((a) => a.spec.key === "all-wtd")!.values;
      ws.patchWorkspace(project.id, { selections: { basis, selected: allWtd } });
    }
  }
  return project.id;
}

async function post(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function get(url: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${url}`);
  return { status: res.status, json: await res.json() };
}

async function advance(
  projectId: string,
  runId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  return post(`/api/projects/${projectId}/studies/${runId}/advance`, body);
}

/** Restamps a modified document (envelope integrity over the semantic body). */
function restamp<T extends Record<string, unknown>>(doc: T): T {
  return interchange.stampIntegrity(doc as never) as unknown as T;
}

const ATTESTATION = "Rationale authored and reviewed by Jane Actuary, FCAS";

describe("study promotion routes: the Phase B walkthrough", () => {
  it("imports the committed Jupyter-authored GenIns study and promotes it through all four gates", async () => {
    const projectId = seedProject("Promotion walkthrough");
    const study = loadFixture();

    // Import: the promotion starts and pauses at study-intake.
    const started = await post(`/api/projects/${projectId}/studies`, study);
    expect(started.status).toBe(201);
    const runId: string = started.json.promotion.runId;
    expect(started.json.promotion).toMatchObject({
      status: "awaiting-decision",
      gate: "study-intake",
      stage: "study-intake",
    });

    // Gate 1 evidence: tolerance PROMINENT (first block), ceiling from env
    // default 0.005, effective = min(stated, ceiling), no 10x flag at 1e-6.
    const intake = started.json.promotion.evidence;
    expect(intake.replayTolerance).toEqual({
      stated: 1e-6,
      profileId: "deterministic-cl",
      profileDefault: 1e-6,
      exceedsTenTimesProfileDefault: false,
      ceiling: 0.005,
      effective: 1e-6,
    });
    expect(started.json.promotion.recommendation).toContain("stated 0.000001");
    expect(started.json.promotion.recommendation).toContain("host ceiling 0.005");
    expect(intake.study).toMatchObject({
      title: "GenIns paid development study",
      sourceRef: "nb/genins-study.ipynb",
      integrity: study.integrity,
    });
    // Single-segment workbench: any labels resolve to the sole target.
    expect(intake.segments).toEqual([
      {
        selectionIntegrity: study.study.selections[0]!.integrity,
        labels: { dataset: "GenIns" },
        target: "workspace",
      },
    ]);

    // The GET view serves the same described state (persisted, not ad hoc).
    const fetched = await get(`/api/projects/${projectId}/studies/${runId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.json.promotion).toEqual(started.json.promotion);
    const listed = await get(`/api/projects/${projectId}/studies`);
    expect(listed.json.promotions).toHaveLength(1);
    expect(listed.json.promotions[0].view.runId).toBe(runId);

    // Gate 1 -> 2: replay verification with an agree referee verdict.
    let step = await advance(projectId, runId, {
      gate: "study-intake",
      decision: "accept",
      rationale: "intake evidence is clean",
    });
    expect(step.status).toBe(200);
    expect(step.json.promotion.gate).toBe("replay-verify");
    const replay = step.json.promotion.evidence;
    expect(replay.hardBlocked).toBe(false);
    expect(replay.effectiveTolerance).toBe(1e-6);
    expect(replay.replays).toHaveLength(1);
    // Volume-weighted intents replay exactly; the labels say so.
    expect(replay.replays[0].verifiedByValueOnly).toBe(false);
    for (const target of replay.replays[0].targets) {
      expect(target.label).toBe("replayed-exact");
    }
    expect(replay.crosschecks).toHaveLength(1);
    expect(replay.crosschecks[0].verdict).toBe("agree");
    expect(replay.crosschecks[0].engine.name).toBe("chainladder-python");

    // The acceptance hop closes with COMMITTED evidence: the exact referee
    // report docs the gate showed the human feed the ASOP 41 disclosure
    // generator, which renders them as Section 4b with the mandated
    // supports-not-constitutes boilerplate (interchange spec 5).
    const crosscheckReports = replay.crosschecks
      .map((c: { report: unknown }) => c.report)
      .filter((r: unknown) => r !== null);
    expect(crosscheckReports).toHaveLength(1);
    const disclosure = compliance.generateDisclosure({
      title: "Promotion walkthrough disclosure",
      metadata: {
        intendedPurpose:
          "Route-level acceptance: promotion gate evidence rendered as an ASOP 41 disclosure",
        intendedMeasure: { kind: "central-estimate" },
        basis: { grossNet: "gross", laeTreatment: "excluding-lae" },
        accountingDate: "2025-12-31",
        valuationDate: "2025-12-31",
      },
      methods: [{ methodId: "chainLadder", basisLabel: "paid" }],
      crossImplementation: crosscheckReports,
      sdkVersion: "0.1.0",
      generatedAt: "2026-07-18T00:00:00Z",
    });
    expect(disclosure).toContain("## 4b. Cross-implementation verification");
    expect(disclosure).toContain("chainladder-python");
    expect(disclosure).toContain("| agree |"); // the gate's verdict, in the 4b table
    expect(disclosure).toContain(
      "Agreement between independent implementations supports, but does not by itself " +
        "constitute, the model validation contemplated by ASOP No. 56; model appropriateness " +
        "to the book remains a separate professional judgment.",
    );

    // Gate 2 -> 3: the draft rationale is assembled from the narrative.
    step = await advance(projectId, runId, {
      gate: "replay-verify",
      decision: "accept",
      rationale: "replay and referee agree at tolerance",
    });
    expect(step.json.promotion.gate).toBe("rationale");
    const rationale = step.json.promotion.evidence;
    expect(rationale.attestationRequired).toBe(true);
    expect(rationale.draftRationale).toContain("GenIns paid development study");
    expect(rationale.draftRationale).toContain("nb/genins-study.ipynb");
    expect(rationale.draftRationale).toContain("chainladder-python agree");

    // Gate 3 -> 4: approve with the attestation.
    const finalRationale = "Adopting the notebook's volume-weighted GenIns factors";
    step = await advance(projectId, runId, {
      gate: "rationale",
      decision: "approve",
      rationale: finalRationale,
      attestation: ATTESTATION,
    });
    expect(step.json.promotion.gate).toBe("apply");
    expect(step.json.promotion.evidence.applications).toEqual([
      {
        segmentTarget: "workspace",
        selectionIntegrity: study.study.selections[0]!.integrity,
        developmentCount: 9,
        tailFactor: 1,
      },
    ]);

    // Gate 4: apply. The chain mutates the workspace through the service
    // layer, reruns the analysis, and persists trail + ledger notes.
    const beforePaid = JSON.stringify(
      ws.activeSelections(ws.ensureWorkspaceState(projectId)).paid,
    );
    step = await advance(projectId, runId, {
      gate: "apply",
      decision: "apply",
      rationale: "apply as approved",
    });
    expect(step.status).toBe(200);
    expect(step.json.promotion).toMatchObject({
      status: "complete",
      applied: true,
      abortedAt: null,
    });
    expect(step.json.promotion.trail.map((t: { stage: string }) => t.stage)).toEqual([
      "study-intake",
      "replay-verify",
      "rationale",
      "apply",
    ]);
    expect(step.json.promotion.noteIds).toHaveLength(2);
    expect(step.json.promotion.ledger.entries).toHaveLength(2);

    // The workspace selections ACTUALLY changed, via the service layer:
    // the seeded all-wtd factors are gone, the study's factors are live.
    const state = ws.ensureWorkspaceState(projectId);
    const expected = study.study.selections[0]!.selection.development.map((d) => d.value);
    const applied = ws.activeSelections(state).paid;
    expect(JSON.stringify(applied)).not.toBe(beforePaid);
    expect(applied).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(applied[i]).toBeCloseTo(expected[i]!, 10);
    }
    expect(ws.activeTail(state).paid).toEqual({ source: "manual", value: 1 });

    // The analysis reran under the promotion label.
    const latest = repo.latestAnalysis(projectId);
    expect(latest?.label).toBe("Study promotion - GenIns paid development study");

    // The ledger note carries the attestation VERBATIM; source names the
    // study ref + integrity + effective tolerance (spec 6 Gate 4).
    const notes = repo.listNotes(projectId);
    const trailNote = notes.find((n) => n.text.startsWith("Study promotion trail:"));
    expect(trailNote).toBeDefined();
    expect(trailNote!.author).toBe("advisor");
    const ledgerNote = notes.find((n) =>
      n.text.startsWith("Study promotion assumption ledger:"),
    );
    expect(ledgerNote).toBeDefined();
    expect(step.json.promotion.noteIds).toContain(ledgerNote!.id);
    const ledger = JSON.parse(
      ledgerNote!.text.slice("Study promotion assumption ledger:\n".length),
    ) as { entries: { field: string; value: unknown; source: string; rationale?: string }[] };
    const attestationEntry = ledger.entries.find((e) => e.field === "promotion.attestation");
    expect(attestationEntry).toBeDefined();
    // The value carries the attestation AND the raw actor identity verbatim
    // (the workbench builds its chain with actorDefault "actuary").
    expect(attestationEntry!.value).toEqual({ attestation: ATTESTATION, actor: "actuary" });
    expect(attestationEntry!.rationale).toBe(finalRationale);
    expect(attestationEntry!.source).toBe(
      `nb/genins-study.ipynb (study ${study.integrity}, tolerance 0.000001)`,
    );

    // Completion is persisted: the GET view survives, further advances 409.
    const done = await get(`/api/projects/${projectId}/studies/${runId}`);
    expect(done.json.promotion.status).toBe("complete");
    const again = await advance(projectId, runId, {
      gate: "apply",
      decision: "apply",
      rationale: "again",
    });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("PROMOTION_SETTLED");
  }, 60_000);

  it("HARD-BLOCKS replay-verify on a disagreeing supporting result: accept is structurally rejected, abort applies nothing", async () => {
    const projectId = seedProject("Promotion hard block");
    const study = loadFixture();

    // Perturb one origin's ultimate ~1% past the 1e-6 tolerance, restamping
    // the embedded result and then the study envelope (intake verifies both).
    const supporting = study.study.supportingResults![0] as {
      result: { rows: { origin: string; ultimate: number; unpaid: number }[] };
    };
    supporting.result.rows = supporting.result.rows.map((r) =>
      r.origin === "2010"
        ? { ...r, ultimate: r.ultimate * 1.01, unpaid: r.unpaid + r.ultimate * 0.01 }
        : r,
    );
    study.study.supportingResults![0] = restamp(
      study.study.supportingResults![0] as Record<string, unknown>,
    );
    const tampered = restamp(study as unknown as Record<string, unknown>);

    const started = await post(`/api/projects/${projectId}/studies`, tampered);
    expect(started.status).toBe(201);
    const runId: string = started.json.promotion.runId;

    const step = await advance(projectId, runId, {
      gate: "study-intake",
      decision: "accept",
      rationale: "intake evidence is clean",
    });
    const replay = step.json.promotion.evidence;
    expect(replay.hardBlocked).toBe(true);
    expect(replay.crosschecks[0].verdict).toBe("disagree");
    expect(step.json.promotion.recommendation).toContain("UNACCEPTABLE");

    // The hard block is STRUCTURAL: the resume schema only admits abort.
    const before = JSON.stringify(ws.ensureWorkspaceState(projectId).selections);
    const accept = await advance(projectId, runId, {
      gate: "replay-verify",
      decision: "accept",
      rationale: "close enough",
    });
    expect(accept.status).toBe(422);
    expect(accept.json.error.code).toBe("DECISION_REJECTED");

    const abort = await advance(projectId, runId, {
      gate: "replay-verify",
      decision: "abort",
      rationale: "cross-engine disagreement; fixing the study upstream",
    });
    expect(abort.status).toBe(200);
    expect(abort.json.promotion).toMatchObject({
      status: "complete",
      applied: false,
      abortedAt: "replay-verify",
    });
    expect(abort.json.promotion.ledger.entries).toHaveLength(0);
    // Nothing touched the workspace.
    expect(JSON.stringify(ws.ensureWorkspaceState(projectId).selections)).toBe(before);
    expect(
      repo.listNotes(projectId).filter((n) => n.text.startsWith("Study promotion")),
    ).toHaveLength(0);
  }, 60_000);
});

describe("study promotion routes: named rejections", () => {
  it("rejects a malformed study with 422 BAD_INTERCHANGE (and a wrong-kind document names the kind)", async () => {
    const projectId = seedProject("Promotion bad study");
    const garbage = await post(`/api/projects/${projectId}/studies`, {
      interchangeVersion: "1.0.0",
      kind: "study",
    });
    expect(garbage.status).toBe(422);
    expect(garbage.json.error.code).toBe("BAD_INTERCHANGE");

    const triangleDoc = loadFixture().study.triangles[0]!;
    const wrongKind = await post(`/api/projects/${projectId}/studies`, triangleDoc);
    expect(wrongKind.status).toBe(422);
    expect(wrongKind.json.error.code).toBe("BAD_INTERCHANGE");
    expect(wrongKind.json.error.message).toContain('kind "triangle"');

    // A failed import never persists a run.
    const listed = await get(`/api/projects/${projectId}/studies`);
    expect(listed.json.promotions).toHaveLength(0);
  });

  it("fails intake with 422 TOLERANCE_CEILING_EXCEEDED when the study states a tolerance above the host ceiling", async () => {
    const projectId = seedProject("Promotion ceiling");
    const study = loadFixture();
    study.study.expectations = { replayTolerance: 0.5 }; // above the 0.005 ceiling
    const loosened = restamp(study as unknown as Record<string, unknown>);
    const res = await post(`/api/projects/${projectId}/studies`, loosened);
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("TOLERANCE_CEILING_EXCEEDED");
    expect(res.json.error.message).toContain("0.5");
    expect(res.json.error.message).toContain("0.005");
  });

  it("answers 409 GATE_MISMATCH for an out-of-order advance and 404 for unknown runs", async () => {
    const projectId = seedProject("Promotion order");
    const started = await post(`/api/projects/${projectId}/studies`, loadFixture());
    const runId: string = started.json.promotion.runId;

    for (const gate of ["replay-verify", "apply"]) {
      const res = await advance(projectId, runId, {
        gate,
        decision: gate === "apply" ? "apply" : "accept",
        rationale: "out of order",
      });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe("GATE_MISMATCH");
      expect(res.json.error.message).toContain("study-intake");
    }

    const missing = await get(`/api/projects/${projectId}/studies/no-such-run`);
    expect(missing.status).toBe(404);
    const missingAdvance = await advance(projectId, "no-such-run", {
      gate: "study-intake",
      decision: "accept",
      rationale: "x",
    });
    expect(missingAdvance.status).toBe(404);
  });

  it("requires a non-blank rationale (422) at every gate and an attestation (422) at the rationale gate", async () => {
    const projectId = seedProject("Promotion attestation");
    const started = await post(`/api/projects/${projectId}/studies`, loadFixture());
    const runId: string = started.json.promotion.runId;

    const blank = await advance(projectId, runId, {
      gate: "study-intake",
      decision: "accept",
      rationale: "   ",
    });
    expect(blank.status).toBe(422);
    expect(blank.json.error.code).toBe("RATIONALE_REQUIRED");

    await advance(projectId, runId, {
      gate: "study-intake",
      decision: "accept",
      rationale: "ok",
    });
    await advance(projectId, runId, {
      gate: "replay-verify",
      decision: "accept",
      rationale: "ok",
    });

    const noAttestation = await advance(projectId, runId, {
      gate: "rationale",
      decision: "approve",
      rationale: "adopt the study factors",
    });
    expect(noAttestation.status).toBe(422);
    expect(noAttestation.json.error.code).toBe("ATTESTATION_REQUIRED");

    const blankAttestation = await advance(projectId, runId, {
      gate: "rationale",
      decision: "approve",
      rationale: "adopt the study factors",
      attestation: "   ",
    });
    expect(blankAttestation.status).toBe(422);
    expect(blankAttestation.json.error.code).toBe("ATTESTATION_REQUIRED");

    // A complete payload still proceeds (the checks reject, never corrupt).
    const ok = await advance(projectId, runId, {
      gate: "rationale",
      decision: "approve",
      rationale: "adopt the study factors",
      attestation: ATTESTATION,
    });
    expect(ok.status).toBe(200);
    expect(ok.json.promotion.gate).toBe("apply");
  }, 60_000);

  it("refuses at the door (422 WORKSPACE_NOT_READY) when the apply gate's analysis rerun would be doomed", async () => {
    // No selections on either basis: the study covers paid, incurred is bare.
    const projectId = seedProject("Promotion unready", { select: false });
    const res = await post(`/api/projects/${projectId}/studies`, loadFixture());
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("WORKSPACE_NOT_READY");
    expect(res.json.error.message).toContain("incurred");
  });

  it("refuses at the door (422 UNSUPPORTED_MEASURE) when a selection applies to a measure the workbench cannot host", async () => {
    const projectId = seedProject("Promotion measure");
    const study = loadFixture();
    // Retarget the selection at a non-core measure and restamp both tags
    // (the embedded selection doc first, then the study envelope).
    const selection = study.study.selections[0]! as unknown as {
      selection: { appliesTo: { measure: string } };
    };
    selection.selection.appliesTo.measure = "custom:reported-count";
    study.study.selections[0] = restamp(
      study.study.selections[0] as unknown as Record<string, unknown>,
    ) as unknown as StudyFixture["study"]["selections"][number];
    const retargeted = restamp(study as unknown as Record<string, unknown>);

    const res = await post(`/api/projects/${projectId}/studies`, retargeted);
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("UNSUPPORTED_MEASURE");
    expect(res.json.error.message).toContain('measure "custom:reported-count"');

    // A door rejection never persists a run.
    const listed = await get(`/api/projects/${projectId}/studies`);
    expect(listed.json.promotions).toHaveLength(0);
  });

  it("refuses a study whose factor vector does not fit the workspace triangle (422 SELECTION_SHAPE)", async () => {
    // A 6-origin workspace has 5 development intervals; GenIns carries 9.
    const projectId = seedProject("Promotion shape", { nYears: 6 });
    const res = await post(`/api/projects/${projectId}/studies`, loadFixture());
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("SELECTION_SHAPE");
    expect(res.json.error.message).toContain("9");
    expect(res.json.error.message).toContain("5");
  });

  it("answers 409 PROMOTION_BUSY while another advance holds the CAS claim, and proceeds once it is released", async () => {
    const projectId = seedProject("Promotion busy");
    const started = await post(`/api/projects/${projectId}/studies`, loadFixture());
    const runId: string = started.json.promotion.runId;

    // Simulate an in-flight advance: take the claim exactly as a winning
    // racer would ('awaiting-decision' -> 'advancing'); the CAS admits one.
    expect(repo.claimStudyPromotionAdvance(runId)).toBe(true);
    expect(repo.claimStudyPromotionAdvance(runId)).toBe(false);

    const blocked = await advance(projectId, runId, {
      gate: "study-intake",
      decision: "accept",
      rationale: "second racer",
    });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe("PROMOTION_BUSY");

    // Releasing the claim (what a rejected decision does) unblocks the gate.
    repo.releaseStudyPromotionAdvance(runId);
    const ok = await advance(projectId, runId, {
      gate: "study-intake",
      decision: "accept",
      rationale: "intake evidence is clean",
    });
    expect(ok.status).toBe(200);
    expect(ok.json.promotion.gate).toBe("replay-verify");
  }, 60_000);

  it("rejects an unknown gate or decision with 400 VALIDATION (zod)", async () => {
    const projectId = seedProject("Promotion zod");
    const started = await post(`/api/projects/${projectId}/studies`, loadFixture());
    const runId: string = started.json.promotion.runId;
    const badGate = await advance(projectId, runId, {
      gate: "yolo",
      decision: "accept",
      rationale: "x",
    });
    expect(badGate.status).toBe(400);
    expect(badGate.json.error.code).toBe("VALIDATION");
    const badDecision = await advance(projectId, runId, {
      gate: "study-intake",
      decision: "approve",
      rationale: "x",
    });
    expect(badDecision.status).toBe(400);
  });
});
