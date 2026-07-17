import { describe, expect, it } from "vitest";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { runChainLadder, triangleFromGrid, type LdfSelections } from "@actuarial-ts/core";
import {
  INTERCHANGE_SPEC_VERSION,
  docToTriangle,
  resultToDoc,
  selectionsToDoc,
  stampIntegrity,
  triangleToDoc,
  type DevelopmentIntentInput,
  type MethodResultDoc,
  type MethodResultBody,
  type SelectionDoc,
  type StudyBody,
  type StudyDoc,
  type TriangleDoc,
} from "@actuarial-ts/interchange";
import { AgentsError } from "../src/errors.js";
import {
  promoteStudy,
  type ApplyEvidence,
  type PromoteStudyDeps,
  type RationaleEvidence,
  type ReplayVerifyEvidence,
  type StudyIntakeEvidence,
} from "../src/promotion.js";
import type { JudgmentChainOutcome } from "../src/judgment.js";

/**
 * Contract tests for the promoteStudy judgment chain (spec 9.6: the
 * promotion path is driven by hosts/external clients, not selected by an
 * agent, so it gets deterministic contract tests, NO golden prompts).
 * Programmatic suspend/resume via a bare Mastra instance, exactly like the
 * judgment-chain tests and the server's ELR workflow integration test.
 */

const NOW = "2026-07-18T00:00:00Z";
const now = () => NOW;

// ---------------------------------------------------------------------------
// Fixtures: a hand-authored coherent study over a 3x3 paid triangle whose
// volume-weighted factors are exactly 1.6 and 1.25.

const PAID_GRID = [
  [100, 160, 200],
  [110, 176, null],
  [120, null, null],
];
const INCURRED_GRID = [
  [120, 180, 200],
  [130, 190, null],
  [150, null, null],
];
const ORIGINS = ["2021", "2022", "2023"];
const AGES = [12, 24, 36];

function paidTriangleDoc(): TriangleDoc {
  return triangleToDoc(triangleFromGrid("paid", ORIGINS, AGES, PAID_GRID), {
    createdAt: NOW,
    valuationDate: "2023-12-31",
    segment: { labels: { lob: "GL" } },
  });
}

function incurredTriangleDoc(): TriangleDoc {
  return triangleToDoc(triangleFromGrid("incurred", ORIGINS, AGES, INCURRED_GRID), {
    createdAt: NOW,
    valuationDate: "2023-12-31",
    segment: { labels: { lob: "GL" } },
  });
}

function selectionDocFor(
  triangleDoc: TriangleDoc,
  selections: LdfSelections,
  intents: DevelopmentIntentInput[],
): SelectionDoc {
  return selectionsToDoc(selections, { triangleDoc, createdAt: NOW, intents }).doc;
}

const VW_SELECTIONS: LdfSelections = { selected: [1.6, 1.25], tailFactor: 1 };

function studyDocOf(overrides: Partial<StudyBody> & Pick<StudyBody, "triangles" | "selections">): StudyDoc {
  const study: StudyBody = {
    title: "GL occurrence Q3 factor study",
    narrative: {
      analyst: "Sam Doe",
      sourceRef: "nb/q3-study.ipynb",
      summary: "VW all-period anchors; no tail.",
    },
    expectations: { replayTolerance: 0.0005 },
    ...overrides,
  };
  // Canonical JSON refuses undefined values; an undefined override means "omit".
  for (const key of Object.keys(study)) {
    if (study[key] === undefined) delete study[key];
  }
  return stampIntegrity<StudyDoc>({
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind: "study",
    generator: { name: "promotion-test", version: "0" },
    createdAt: NOW,
    extensions: {},
    study,
  });
}

/** A supporting result from "another engine" that replays the selection. */
function supportingResultFor(
  triangleDoc: TriangleDoc,
  selectionDoc: SelectionDoc,
  selections: LdfSelections,
): MethodResultDoc {
  const replay = runChainLadder(docToTriangle(triangleDoc).triangle, selections);
  return resultToDoc(replay, {
    triangleDoc,
    selectionDoc,
    createdAt: NOW,
    engine: { name: "chainladder-python", version: "0.9.2" },
    parameters: { average: "volume", n_periods: -1 },
  });
}

/** Perturbs one origin's ultimate ~1% beyond the 0.0005 tolerance and restamps. */
function perturb(doc: MethodResultDoc): MethodResultDoc {
  const body = JSON.parse(JSON.stringify(doc.result)) as MethodResultBody;
  body.rows = body.rows.map((r) =>
    r.origin === "2023" ? { ...r, ultimate: r.ultimate * 1.01, unpaid: r.unpaid + r.ultimate * 0.01 } : r,
  );
  return stampIntegrity<MethodResultDoc>({ ...doc, result: body });
}

// ---------------------------------------------------------------------------
// Fake host adapter recording every call (the workbench adapter arrives in B4).

interface RecordedCalls {
  applied: { selectionIntegrity: string; replayed: LdfSelections; target: string }[];
  analyses: string[];
  notes: { text: string; author: string }[];
}

function fakeDeps(overrides: Partial<PromoteStudyDeps> = {}): { deps: PromoteStudyDeps; calls: RecordedCalls } {
  const calls: RecordedCalls = { applied: [], analyses: [], notes: [] };
  const deps: PromoteStudyDeps = {
    resolveSegment: (labels) => labels["lob"] ?? "default",
    applySelections: (selectionDoc, replayed, target) => {
      calls.applied.push({ selectionIntegrity: selectionDoc.integrity, replayed, target });
    },
    runAnalysis: (label) => {
      calls.analyses.push(label);
    },
    persistNote: (text, author) => {
      calls.notes.push({ text, author });
    },
    ...overrides,
  };
  return { deps, calls };
}

const OPTIONS = { toleranceCeiling: 0.01, now };

// ---------------------------------------------------------------------------
// Harness (same pattern as judgment.test.ts; the workflow is an accidental
// thenable, so it is registered synchronously and never awaited).

type RunResult = {
  status: string;
  suspended?: string[][];
  steps?: Record<string, { suspendPayload?: { stage?: string; recommendation?: string; evidence?: unknown } }>;
  result?: JudgmentChainOutcome;
  error?: unknown;
};

function register(chain: ReturnType<typeof promoteStudy>) {
  const mastra = new Mastra({ workflows: { chain } });
  return mastra.getWorkflow("chain");
}

type ChainRun = Awaited<ReturnType<ReturnType<typeof register>["createRun"]>>;

function runContext() {
  const requestContext = new RequestContext();
  requestContext.set("projectId", "p-1");
  return requestContext;
}

async function startRun(chain: ReturnType<typeof promoteStudy>) {
  const workflow = register(chain);
  const requestContext = runContext();
  const run = await workflow.createRun();
  const result = (await run.start({ inputData: {}, requestContext })) as RunResult;
  return { run, requestContext, result };
}

async function resume(
  run: ChainRun,
  requestContext: RequestContext,
  step: string,
  resumeData: Record<string, unknown>,
): Promise<RunResult> {
  return (await run.resume({ step, resumeData, requestContext })) as RunResult;
}

function suspendedAt(result: RunResult): string {
  expect(result.status).toBe("suspended");
  return result.suspended![0]![0]!;
}

function evidenceOf<T>(result: RunResult, step: string): T {
  return result.steps![step]!.suspendPayload!.evidence as T;
}

function failureOf(result: RunResult): { name?: string; code?: string; message?: string } {
  expect(result.status).toBe("failed");
  return result.error as { name?: string; code?: string; message?: string };
}

// ---------------------------------------------------------------------------

describe("promoteStudy", () => {
  it("walks all four gates suspend/resume to success on a coherent study: paired ASOP 23 review, agree referee verdict, applied selections, ledger, and notes", async () => {
    const paidDoc = paidTriangleDoc();
    const selDoc = selectionDocFor(paidDoc, VW_SELECTIONS, ["all-wtd", "all-wtd"]);
    const study = studyDocOf({
      triangles: [paidDoc, incurredTriangleDoc()],
      selections: [selDoc],
      supportingResults: [supportingResultFor(paidDoc, selDoc, VW_SELECTIONS)],
    });
    const { deps, calls } = fakeDeps();
    const chain = promoteStudy(deps, study, OPTIONS);
    const { run, requestContext, result: started } = await startRun(chain);

    // Gate 1: study-intake, tolerance PROMINENT (first evidence block).
    expect(suspendedAt(started)).toBe("study-intake");
    const intake = evidenceOf<StudyIntakeEvidence>(started, "study-intake");
    expect(intake.replayTolerance).toEqual({
      stated: 0.0005,
      profileId: "deterministic-cl",
      profileDefault: 1e-6,
      exceedsTenTimesProfileDefault: true, // 0.0005 > 10 x 1e-6
      ceiling: 0.01,
      effective: 0.0005, // min(study, ceiling)
    });
    const recommendation = started.steps!["study-intake"]!.suspendPayload!.recommendation!;
    expect(recommendation).toContain("effective 0.0005");
    expect(recommendation).toContain("10x the deterministic-cl profile default");
    expect(intake.study).toMatchObject({ sourceRef: "nb/q3-study.ipynb", integrity: study.integrity });
    // Paired paid/incurred review ran (all checks pass on this clean pair).
    expect(intake.dataReview).toHaveLength(1);
    expect(intake.dataReview[0]!.mode).toBe("paired-asop23");
    expect(intake.dataReview[0]!.report.summary).toMatchObject({ fail: 0, warning: 0 });
    expect(intake.coherence[0]!.coherence.coherent).toBe(true);
    expect(intake.segments).toEqual([
      { selectionIntegrity: selDoc.integrity, labels: { lob: "GL" }, target: "GL" },
    ]);

    // Gate 2: replay-verify with an "agree" referee verdict.
    let result = await resume(run, requestContext, "study-intake", {
      decision: "accept",
      rationale: "intake evidence is clean",
    });
    expect(suspendedAt(result)).toBe("replay-verify");
    const replay = evidenceOf<ReplayVerifyEvidence>(result, "replay-verify");
    expect(replay.hardBlocked).toBe(false);
    expect(replay.effectiveTolerance).toBe(0.0005);
    expect(replay.replays[0]!.targets.map((t) => t.label)).toEqual(["replayed-exact", "replayed-exact"]);
    expect(replay.replays[0]!.verifiedByValueOnly).toBe(false);
    expect(replay.replays[0]!.replayTotals).toEqual({ ultimate: 660, unpaid: 164 });
    expect(replay.crosschecks).toHaveLength(1);
    expect(replay.crosschecks[0]!.verdict).toBe("agree");
    expect(replay.crosschecks[0]!.engine).toEqual({ name: "chainladder-python", version: "0.9.2" });

    // Gate 3: rationale draft assembled from the narrative (template path).
    result = await resume(run, requestContext, "replay-verify", {
      decision: "accept",
      rationale: "replay and referee agree at tolerance",
    });
    expect(suspendedAt(result)).toBe("rationale");
    const rationale = evidenceOf<RationaleEvidence>(result, "rationale");
    expect(rationale.attestationRequired).toBe(true);
    expect(rationale.draftRationale).toContain("GL occurrence Q3 factor study");
    expect(rationale.draftRationale).toContain("nb/q3-study.ipynb");
    expect(rationale.draftRationale).toContain("VW all-period anchors; no tail.");
    expect(rationale.draftRationale).toContain("chainladder-python agree");

    // Gate 4: apply preview, then execution.
    result = await resume(run, requestContext, "rationale", {
      decision: "approve",
      rationale: "Adopt the study's volume-weighted factors for GL",
      attestation: "Rationale authored and reviewed by Jane Actuary, FCAS",
    });
    expect(suspendedAt(result)).toBe("apply");
    const apply = evidenceOf<ApplyEvidence>(result, "apply");
    expect(apply.applications).toEqual([
      {
        segmentTarget: "GL",
        selectionIntegrity: selDoc.integrity,
        developmentCount: 2,
        tailFactor: 1,
      },
    ]);

    result = await resume(run, requestContext, "apply", {
      decision: "apply",
      rationale: "apply as approved",
    });
    expect(result.status).toBe("success");

    // Outcome: trail + fused ledger per createJudgmentChain conventions.
    const outcome = result.result!;
    expect(outcome.trail.map((t) => [t.stage, t.skipped])).toEqual([
      ["study-intake", false],
      ["replay-verify", false],
      ["rationale", false],
      ["apply", false],
    ]);

    // Ledger contents: actor, mandated source string, rationale + attestation verbatim.
    const expectedSource = `nb/q3-study.ipynb (study ${study.integrity}, tolerance 0.0005)`;
    expect(outcome.ledger.entries).toHaveLength(2);
    expect(outcome.ledger.entries[0]).toMatchObject({
      field: "selections.GL",
      actor: "actuary", // no actor in the payload, no actorDefault -> "actuary"
      source: expectedSource,
      rationale: "Adopt the study's volume-weighted factors for GL",
      value: {
        development: [
          { fromAgeMonths: 12, toAgeMonths: 24, value: 1.6 },
          { fromAgeMonths: 24, toAgeMonths: 36, value: 1.25 },
        ],
        tailFactor: 1,
      },
    });
    expect(outcome.ledger.entries[1]).toMatchObject({
      field: "promotion.attestation",
      actor: "actuary",
      source: expectedSource,
      value: "Rationale authored and reviewed by Jane Actuary, FCAS", // verbatim
      rationale: "Adopt the study's volume-weighted factors for GL",
    });

    // Host adapter calls: selections applied, analysis rerun, both notes persisted.
    expect(calls.applied).toEqual([
      {
        selectionIntegrity: selDoc.integrity,
        replayed: { selected: [1.6, 1.25], tailFactor: 1 },
        target: "GL",
      },
    ]);
    expect(calls.analyses).toEqual(["Study promotion - GL occurrence Q3 factor study"]);
    expect(calls.notes).toHaveLength(2);
    expect(calls.notes[0]!.author).toBe("actuary");
    expect(calls.notes[0]!.text).toContain("Study promotion trail:");
    expect(calls.notes[0]!.text).toContain("study-intake: study accepted for promotion");
    expect(calls.notes[1]!.text).toContain("Study promotion assumption ledger:");
    expect(calls.notes[1]!.text).toContain('"promotion.attestation"');
    expect(calls.notes[1]!.text).toContain("Rationale authored and reviewed by Jane Actuary, FCAS");
  }, 30_000);

  it("does not raise the >10x flag when the stated tolerance sits at the profile default", async () => {
    const paidDoc = paidTriangleDoc();
    const study = studyDocOf({
      triangles: [paidDoc],
      selections: [selectionDocFor(paidDoc, VW_SELECTIONS, ["all-wtd", "all-wtd"])],
      expectations: { replayTolerance: 1e-6 },
    });
    const { deps } = fakeDeps();
    const { result } = await startRun(promoteStudy(deps, study, OPTIONS));
    expect(suspendedAt(result)).toBe("study-intake");
    const intake = evidenceOf<StudyIntakeEvidence>(result, "study-intake");
    expect(intake.replayTolerance).toMatchObject({
      stated: 1e-6,
      exceedsTenTimesProfileDefault: false,
      effective: 1e-6,
    });
  }, 30_000);

  it("with no expectations and no supportingResults: effective = min(profile default, ceiling), and the evidence states verification was coherence + replay only", async () => {
    const paidDoc = paidTriangleDoc();
    const study = studyDocOf({
      triangles: [paidDoc],
      selections: [selectionDocFor(paidDoc, VW_SELECTIONS, ["all-wtd", "all-wtd"])],
      expectations: undefined,
    });
    const { deps } = fakeDeps();
    const chain = promoteStudy(deps, study, { toleranceCeiling: 1e-7, now });
    const { run, requestContext, result: started } = await startRun(chain);
    const intake = evidenceOf<StudyIntakeEvidence>(started, "study-intake");
    // Ceiling below the profile default: min picks the ceiling; no intake
    // failure because the STUDY stated nothing above it.
    expect(intake.replayTolerance).toMatchObject({ stated: null, effective: 1e-7 });

    const result = await resume(run, requestContext, "study-intake", {
      decision: "accept",
      rationale: "clean intake",
    });
    const replay = evidenceOf<ReplayVerifyEvidence>(result, "replay-verify");
    expect(replay.crosschecks).toEqual([]);
    expect(replay.verification).toContain("coherence plus replay only");
    expect(replay.verification).toContain("no supportingResults");
  }, 30_000);

  it("enforces the gate sequence: resuming a later gate before it suspended is rejected", async () => {
    const paidDoc = paidTriangleDoc();
    const study = studyDocOf({
      triangles: [paidDoc],
      selections: [selectionDocFor(paidDoc, VW_SELECTIONS, ["all-wtd", "all-wtd"])],
    });
    const { deps, calls } = fakeDeps();
    const { run, requestContext, result } = await startRun(promoteStudy(deps, study, OPTIONS));
    expect(suspendedAt(result)).toBe("study-intake");

    for (const step of ["replay-verify", "rationale", "apply"]) {
      await expect(
        resume(run, requestContext, step, {
          decision: "apply",
          rationale: "out of order",
          attestation: "x",
        }),
      ).rejects.toThrow();
    }
    expect(calls.applied).toHaveLength(0);
  }, 30_000);

  it("surfaces a malformed study as a study-intake gate failure (BAD_INTERCHANGE), never a construction throw", async () => {
    const { deps } = fakeDeps();
    // Construction NEVER throws on study-content problems.
    const chain = promoteStudy(deps, { interchangeVersion: "1.0.0", kind: "study" }, OPTIONS);
    const { result } = await startRun(chain);
    expect(failureOf(result).code).toBe("BAD_INTERCHANGE");

    // A valid document of the WRONG KIND fails the same way.
    const wrongKind = promoteStudy(deps, paidTriangleDoc(), OPTIONS);
    const { result: kindResult } = await startRun(wrongKind);
    const failure = failureOf(kindResult);
    expect(failure.code).toBe("BAD_INTERCHANGE");
    expect(failure.message).toContain('kind "triangle"');
  }, 30_000);

  it("fails intake when the study's stated replayTolerance exceeds the host ceiling, with the reason", async () => {
    const paidDoc = paidTriangleDoc();
    const study = studyDocOf({
      triangles: [paidDoc],
      selections: [selectionDocFor(paidDoc, VW_SELECTIONS, ["all-wtd", "all-wtd"])],
      expectations: { replayTolerance: 0.0005 },
    });
    const { deps } = fakeDeps();
    const { result } = await startRun(promoteStudy(deps, study, { toleranceCeiling: 0.0001, now }));
    const failure = failureOf(result);
    expect(failure.code).toBe("TOLERANCE_CEILING_EXCEEDED");
    expect(failure.message).toContain("0.0005");
    expect(failure.message).toContain("0.0001");
  }, 30_000);

  it("blocks intake with SEGMENT_UNRESOLVED when no workspace target matches the segment labels", async () => {
    const paidDoc = paidTriangleDoc();
    const study = studyDocOf({
      triangles: [paidDoc],
      selections: [selectionDocFor(paidDoc, VW_SELECTIONS, ["all-wtd", "all-wtd"])],
    });
    const { deps } = fakeDeps({ resolveSegment: () => null });
    const { result } = await startRun(promoteStudy(deps, study, OPTIONS));
    const failure = failureOf(result);
    expect(failure.code).toBe("SEGMENT_UNRESOLVED");
    expect(failure.message).toContain('{"lob":"GL"}');
  }, 30_000);

  it("blocks intake with SEGMENT_AMBIGUOUS when two selections resolve to the same target (v1: one selection per segment)", async () => {
    const paidDoc = paidTriangleDoc();
    const study = studyDocOf({
      triangles: [paidDoc],
      selections: [
        selectionDocFor(paidDoc, VW_SELECTIONS, ["all-wtd", "all-wtd"]),
        selectionDocFor(paidDoc, VW_SELECTIONS, ["all-str", "all-str"]),
      ],
    });
    const { deps } = fakeDeps();
    const { result } = await startRun(promoteStudy(deps, study, OPTIONS));
    const failure = failureOf(result);
    expect(failure.code).toBe("SEGMENT_AMBIGUOUS");
    expect(failure.message).toContain('"GL"');
  }, 30_000);

  it("HARD-BLOCKS Gate 2 on a seeded disagree: the resume schema only admits abort, and the aborted chain applies nothing", async () => {
    const paidDoc = paidTriangleDoc();
    const selDoc = selectionDocFor(paidDoc, VW_SELECTIONS, ["all-wtd", "all-wtd"]);
    const study = studyDocOf({
      triangles: [paidDoc],
      selections: [selDoc],
      supportingResults: [perturb(supportingResultFor(paidDoc, selDoc, VW_SELECTIONS))],
    });
    const { deps, calls } = fakeDeps();
    const { run, requestContext, result: started } = await startRun(promoteStudy(deps, study, OPTIONS));

    let result = await resume(run, requestContext, "study-intake", {
      decision: "accept",
      rationale: "intake evidence is clean",
    });
    expect(suspendedAt(result)).toBe("replay-verify");
    const replay = evidenceOf<ReplayVerifyEvidence>(result, "replay-verify");
    expect(replay.hardBlocked).toBe(true);
    expect(replay.crosschecks[0]!.verdict).toBe("disagree");
    expect(result.steps!["replay-verify"]!.suspendPayload!.recommendation).toContain("UNACCEPTABLE");

    // The hard-block is STRUCTURAL: accept fails Mastra's resume validation.
    await expect(
      resume(run, requestContext, "replay-verify", {
        decision: "accept",
        rationale: "close enough",
      }),
    ).rejects.toThrow(/abort/);

    // Abort is the only path; later gates self-skip and nothing is applied.
    result = await resume(run, requestContext, "replay-verify", {
      decision: "abort",
      rationale: "cross-engine disagreement; fixing the study upstream",
    });
    expect(result.status).toBe("success");
    const outcome = result.result!;
    expect(outcome.trail.map((t) => [t.stage, t.decision, t.skipped])).toEqual([
      ["study-intake", "study accepted for promotion", false],
      ["replay-verify", "promotion aborted at replay verification", false],
      ["rationale", "skipped", true],
      ["apply", "skipped", true],
    ]);
    expect(outcome.ledger.entries).toHaveLength(0);
    expect(calls.applied).toHaveLength(0);
    expect(calls.analyses).toHaveLength(0);
    expect(calls.notes).toHaveLength(0); // aborted promotions persist nothing
    expect(started.status).toBe("suspended");
  }, 30_000);

  it("labels a value-only (external-intent) selection verified-by-value, end to end: replay labels, referee verdict, and structural (unpaired) data review", async () => {
    const paidDoc = paidTriangleDoc();
    const externalSelections: LdfSelections = { selected: [1.7, 1.3], tailFactor: 1 };
    const externalIntent: DevelopmentIntentInput = {
      kind: "external",
      rationale: "factors adopted from the prior external review",
    };
    const selDoc = selectionDocFor(paidDoc, externalSelections, [externalIntent, externalIntent]);
    const study = studyDocOf({
      triangles: [paidDoc],
      selections: [selDoc],
      supportingResults: [supportingResultFor(paidDoc, selDoc, externalSelections)],
    });
    const { deps } = fakeDeps();
    const { run, requestContext, result: started } = await startRun(promoteStudy(deps, study, OPTIONS));

    // Unpaired triangle: the per-triangle structural review mode ran.
    const intake = evidenceOf<StudyIntakeEvidence>(started, "study-intake");
    expect(intake.dataReview[0]!.mode).toBe("structural");

    const result = await resume(run, requestContext, "study-intake", {
      decision: "accept",
      rationale: "intake evidence is clean",
    });
    const replay = evidenceOf<ReplayVerifyEvidence>(result, "replay-verify");
    expect(replay.replays[0]!.verifiedByValueOnly).toBe(true);
    expect(replay.replays[0]!.targets.map((t) => t.label)).toEqual([
      "verified-by-value",
      "verified-by-value",
    ]);
    // The referee says exactly that: value transport, not methodology.
    expect(replay.crosschecks[0]!.verdict).toBe("verified-by-value");
    expect(replay.hardBlocked).toBe(false);
    expect(result.steps!["replay-verify"]!.suspendPayload!.recommendation).toContain(
      "verified by value only",
    );
  }, 30_000);

  it("rejects rationale-gate resumes with a blank or missing rationale or attestation", async () => {
    const paidDoc = paidTriangleDoc();
    const study = studyDocOf({
      triangles: [paidDoc],
      selections: [selectionDocFor(paidDoc, VW_SELECTIONS, ["all-wtd", "all-wtd"])],
    });
    const { deps } = fakeDeps();
    const { run, requestContext } = await startRun(promoteStudy(deps, study, OPTIONS));
    await resume(run, requestContext, "study-intake", { decision: "accept", rationale: "ok" });
    const atRationale = await resume(run, requestContext, "replay-verify", {
      decision: "accept",
      rationale: "ok",
    });
    expect(suspendedAt(atRationale)).toBe("rationale");

    // Blank rationale.
    await expect(
      resume(run, requestContext, "rationale", {
        decision: "approve",
        rationale: "   ",
        attestation: "Authored by Jane Actuary",
      }),
    ).rejects.toThrow(/blank/i);
    // Missing attestation.
    await expect(
      resume(run, requestContext, "rationale", { decision: "approve", rationale: "adopt" }),
    ).rejects.toThrow();
    // Blank attestation.
    await expect(
      resume(run, requestContext, "rationale", {
        decision: "approve",
        rationale: "adopt",
        attestation: "   ",
      }),
    ).rejects.toThrow(/blank/i);

    // A complete payload proceeds to the apply gate.
    const result = await resume(run, requestContext, "rationale", {
      decision: "approve",
      rationale: "adopt the study factors",
      attestation: "Authored by Jane Actuary",
    });
    expect(suspendedAt(result)).toBe("apply");
  }, 30_000);

  it("rejects malformed deps/options at call time with BAD_PROMOTION_OPTIONS", () => {
    const paidDoc = paidTriangleDoc();
    const study = studyDocOf({
      triangles: [paidDoc],
      selections: [selectionDocFor(paidDoc, VW_SELECTIONS, ["all-wtd", "all-wtd"])],
    });
    const { deps } = fakeDeps();
    const expectBadOptions = (fn: () => unknown) => {
      let thrown: unknown;
      try {
        fn();
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AgentsError);
      expect((thrown as AgentsError).code).toBe("BAD_PROMOTION_OPTIONS");
    };
    expectBadOptions(() => promoteStudy(deps, study, { toleranceCeiling: 0, now }));
    expectBadOptions(() => promoteStudy(deps, study, { toleranceCeiling: Number.NaN, now }));
    expectBadOptions(() =>
      promoteStudy({ ...deps, resolveSegment: undefined as never }, study, OPTIONS),
    );
    expectBadOptions(() =>
      promoteStudy(deps, study, { toleranceCeiling: 0.01, now: undefined as never }),
    );
  });
});
