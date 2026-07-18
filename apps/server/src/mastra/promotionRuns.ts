import { randomUUID } from "node:crypto";
import { RequestContext } from "@mastra/core/request-context";
import {
  promoteStudy,
  type PromoteStudyDeps,
  type JudgmentTrailEntry,
} from "@actuarial-ts/agents";
import type { SelectionDoc } from "@actuarial-ts/interchange";
import type { LdfSelections } from "@actuarial-ts/core";
import { env } from "../env.js";
import {
  claimStudyPromotionAdvance,
  getStudyPromotion,
  insertStudyPromotion,
  insertNote,
  listStudyPromotions,
  releaseStudyPromotionAdvance,
  updateStudyPromotion,
  type StudyPromotionRow,
} from "../db/repo.js";
import {
  HttpError,
  activeSelections,
  getWorkspaceView,
  patchWorkspace,
  runFullAnalysis,
} from "../services/workspaceService.js";
import { getMastra } from "./instanceRegistry.js";

/**
 * Study promotion runs: the workbench host for the @actuarial-ts/agents
 * promoteStudy judgment chain (interchange spec rev 2.1, section 6).
 *
 * PERSISTENCE MODEL. promoteStudy CONSTRUCTS its chain per study (eager
 * intake), so unlike the boot-registered ELR workflow there is no static
 * workflow to register at startup. The model here is two-layered:
 *
 * 1. The STUDY DOCUMENT (plus the ceiling the chain was built with) is
 *    persisted in the `studies` table BEFORE the first gate is answered.
 *    promoteStudy is deterministic given (study, ceiling, resolveSegment) -
 *    the B2 contract: eager intake makes a reconstructed chain IDENTICAL,
 *    gates and resume schemas included (the Gate 2 hard-block is baked into
 *    the resume schema, so it survives reconstruction structurally).
 * 2. The constructed workflow is registered LATE on the boot Mastra
 *    instance (addWorkflow, key "promotion-<runId>"), whose LibSQL storage
 *    persists the run SNAPSHOT. Resume-after-restart therefore rebuilds the
 *    chain from the studies row, re-registers it under the same key, and
 *    lets Mastra rehydrate the paused run by runId - exactly the ELR
 *    workflow's restart mechanics, plus deterministic reconstruction.
 *
 * An in-process registry memoizes constructed runs so one promotion is one
 * chain per process (and so the note ids the adapter persists during the
 * final gate are attributable to the run that produced them).
 *
 * SEGMENT RULE. The workbench is single-segment: one project is one
 * reserving workspace. resolveSegment returns the sole target ("workspace")
 * for ANY labels, including absent ones; the one-selection-per-segment rule
 * (spec 6 Gate 1) then means a workbench promotion carries exactly one
 * selection - a second one fails intake with SEGMENT_AMBIGUOUS.
 */

export const WORKBENCH_SEGMENT_TARGET = "workspace";

export const PROMOTION_GATES = [
  "study-intake",
  "replay-verify",
  "rationale",
  "apply",
] as const;
export type PromotionGateId = (typeof PROMOTION_GATES)[number];

// ---------------------------------------------------------------------------
// The described view (persisted as studies.state_json; served by the routes)

export interface PromotionAwaitingView {
  status: "awaiting-decision";
  runId: string;
  gate: PromotionGateId;
  stage: string;
  recommendation: string;
  evidence: unknown;
}

export interface PromotionCompleteView {
  status: "complete";
  runId: string;
  /** true when the apply gate executed (ledger entries exist). */
  applied: boolean;
  /** The stage an aborted promotion stopped at; null when applied. */
  abortedAt: string | null;
  trail: JudgmentTrailEntry[];
  ledger: { entries: unknown[] };
  /** Notes the adapter persisted (trail note, then ledger note). */
  noteIds: string[];
}

export interface PromotionFailedView {
  status: "failed";
  runId: string;
  error: { code: string; message: string };
}

export type PromotionView =
  | PromotionAwaitingView
  | PromotionCompleteView
  | PromotionFailedView;

// ---------------------------------------------------------------------------
// Workbench adapter (spec 6 Gate 4 host seam)

function workbenchDeps(projectId: string, noteIds: string[]): PromoteStudyDeps {
  return {
    resolveSegment: () => WORKBENCH_SEGMENT_TARGET,
    applySelections: (
      selectionDoc: SelectionDoc,
      replayed: LdfSelections,
      _segmentTarget: string,
    ) => {
      const measure = selectionDoc.selection.appliesTo.measure;
      if (measure !== "paid" && measure !== "incurred") {
        throw new HttpError(
          422,
          "UNSUPPORTED_MEASURE",
          `The workbench applies selections to the paid or incurred basis; the study's selection ` +
            `applies to measure "${measure}"`,
        );
      }
      // The promoted judgment is development + tail as a unit: leaving the
      // workspace's prior tail active would contradict the replay evidence
      // the gates just verified, so the tail is applied even when it is 1.
      patchWorkspace(projectId, {
        selections: { basis: measure, selected: replayed.selected },
      });
      patchWorkspace(projectId, {
        tail: { basis: measure, source: "manual", value: replayed.tailFactor },
      });
    },
    runAnalysis: (label: string) => {
      runFullAnalysis(projectId, label);
    },
    // The notes table's author column only admits user|advisor, so every
    // promotion note is stored as "advisor". Actor identity lives in the
    // ledger JSON inside the note text: each entry's `actor` is the COARSE
    // compliance enum (default|actuary|agent), and the attestation entry's
    // value additionally carries the RAW actor string verbatim (see
    // promoteStudy's toAssumptionActor doc in @actuarial-ts/agents).
    persistNote: (text: string, _author: string) => {
      noteIds.push(insertNote(projectId, "advisor", text).id);
    },
  };
}

// ---------------------------------------------------------------------------
// Run construction + the in-process registry

/** Structural view of the registered workflow (same idiom as tools.ts). */
interface PromotionWorkflowInstance {
  createRun(options?: { runId?: string }): Promise<PromotionRun>;
}
interface PromotionRun {
  runId: string;
  start(params: {
    inputData: Record<string, never>;
    requestContext: RequestContext;
  }): Promise<unknown>;
  resume(params: {
    step: string;
    resumeData: Record<string, unknown>;
    requestContext: RequestContext;
  }): Promise<unknown>;
}

interface PromotionHandle {
  runId: string;
  projectId: string;
  workflow: PromotionWorkflowInstance;
  noteIds: string[];
}

const registry = new Map<string, PromotionHandle>();

const workflowKeyOf = (runId: string): string => `promotion-${runId}`;

/**
 * Constructs the chain for a study and registers it on the boot Mastra
 * instance under the run-scoped key. NEVER await the promoteStudy return
 * value (accidental thenable); it is assigned and registered synchronously.
 */
function buildHandle(
  runId: string,
  projectId: string,
  studyDoc: unknown,
  toleranceCeiling: number,
  now: () => string,
): PromotionHandle {
  const noteIds: string[] = [];
  const chain = promoteStudy(workbenchDeps(projectId, noteIds), studyDoc, {
    toleranceCeiling,
    actorDefault: "actuary",
    now,
  });
  const mastra = getMastra();
  mastra.addWorkflow(chain, workflowKeyOf(runId));
  const workflow = mastra.getWorkflow(workflowKeyOf(runId)) as PromotionWorkflowInstance;
  const handle: PromotionHandle = { runId, projectId, workflow, noteIds };
  registry.set(runId, handle);
  return handle;
}

/** Registry hit, or deterministic reconstruction from the persisted row. */
function ensureHandle(row: StudyPromotionRow, now: () => string): PromotionHandle {
  const existing = registry.get(row.runId);
  if (existing) return existing;
  return buildHandle(
    row.runId,
    row.projectId,
    JSON.parse(row.studyJson),
    row.toleranceCeiling,
    now,
  );
}

function requestContextFor(projectId: string): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set("projectId", projectId);
  return requestContext;
}

// ---------------------------------------------------------------------------
// Run-state description (the promotion analogue of tools.ts describeRunState)

interface WorkflowRunResult {
  status: string;
  suspended?: string[][];
  steps?: Record<
    string,
    { suspendPayload?: { stage?: string; recommendation?: string; evidence?: unknown } }
  >;
  result?: { trail?: JudgmentTrailEntry[]; ledger?: { entries?: unknown[] } };
  error?: unknown;
}

function runErrorOf(result: WorkflowRunResult): { code: string; message: string } {
  const err = result.error as { code?: unknown; message?: unknown } | string | undefined;
  if (typeof err === "object" && err !== null) {
    return {
      code: typeof err.code === "string" ? err.code : "WORKFLOW_ERROR",
      message: typeof err.message === "string" ? err.message : JSON.stringify(err),
    };
  }
  return { code: "WORKFLOW_ERROR", message: String(err ?? "workflow did not suspend or complete") };
}

function describeRun(
  runId: string,
  result: WorkflowRunResult,
  noteIds: string[],
): PromotionView {
  if (result.status === "suspended" && result.suspended?.length) {
    const path = result.suspended[0]!;
    const stepId = path[path.length - 1]!;
    const payload = result.steps?.[stepId]?.suspendPayload;
    return {
      status: "awaiting-decision",
      runId,
      gate: stepId as PromotionGateId,
      stage: payload?.stage ?? stepId,
      recommendation: payload?.recommendation ?? "",
      evidence: payload?.evidence ?? null,
    };
  }
  if (result.status === "success") {
    const trail = result.result?.trail ?? [];
    const entries = result.result?.ledger?.entries ?? [];
    const aborted = trail.find(
      (t) => !t.skipped && t.decision.startsWith("promotion aborted"),
    );
    return {
      status: "complete",
      runId,
      applied: entries.length > 0,
      abortedAt: aborted?.stage ?? null,
      trail,
      ledger: { entries },
      noteIds: [...noteIds],
    };
  }
  return { status: "failed", runId, error: runErrorOf(result) };
}

// ---------------------------------------------------------------------------
// Workspace-readiness guard

/**
 * Best-effort structural peek at a study's selections. Returns null when the
 * document does not even have the StudyDoc shape - the guard then stands
 * aside and lets promoteStudy's intake fail with its own named error.
 */
function peekSelections(
  studyDoc: unknown,
): { measure: unknown; developmentCount: number }[] | null {
  const selections = (
    studyDoc as { study?: { selections?: unknown } } | null
  )?.study?.selections;
  if (!Array.isArray(selections)) return null;
  const peeked: { measure: unknown; developmentCount: number }[] = [];
  for (const doc of selections) {
    const selection = (doc as { selection?: { appliesTo?: { measure?: unknown }; development?: unknown } } | null)
      ?.selection;
    if (!selection || !Array.isArray(selection.development)) return null;
    peeked.push({
      measure: selection.appliesTo?.measure,
      developmentCount: selection.development.length,
    });
  }
  return peeked;
}

/**
 * Fails an import EARLY, with the reason stated, when the apply gate would
 * be doomed: the promotion's final gate reruns the FULL analysis (both
 * bases), so the workspace must already carry selections on every basis the
 * study does not itself supply, and the study's factor vector must match
 * the workspace's development columns. Discovering either at gate 4 would
 * kill the run irrecoverably after three human decisions; the workbench
 * refuses at the door instead. Studies too malformed to peek at skip this
 * guard - intake fails them with the proper interchange error.
 */
function assertWorkspaceReady(projectId: string, studyDoc: unknown): void {
  const peeked = peekSelections(studyDoc);
  if (peeked === null || peeked.length === 0) return;
  // Door-level measure gate: the apply-gate adapter can only patch the paid
  // or incurred basis (its applySelections throws the same error), so a
  // selection targeting any other measure is doomed - reject it before the
  // chain ever starts, not after three human decisions.
  for (const { measure } of peeked) {
    if (measure !== "paid" && measure !== "incurred") {
      throw new HttpError(
        422,
        "UNSUPPORTED_MEASURE",
        `The workbench applies selections to the paid or incurred basis; the study's selection ` +
          `applies to measure "${String(measure)}"`,
      );
    }
  }
  const view = getWorkspaceView(projectId); // throws NO_CLAIMS on an empty project
  const nCols = Math.max(0, view.triangles.paid.ages.length - 1);
  for (const { developmentCount } of peeked) {
    if (developmentCount !== nCols) {
      throw new HttpError(
        422,
        "SELECTION_SHAPE",
        `The study's selection carries ${developmentCount} development factor(s) but this ` +
          `workspace's triangle has ${nCols} development interval(s); the study cannot apply here`,
      );
    }
  }
  const covered = new Set(peeked.map((p) => p.measure));
  for (const basis of ["paid", "incurred"] as const) {
    if (covered.has(basis)) continue;
    const hasSelections = activeSelections(view.state)[basis].some((v) => v !== null);
    if (!hasSelections) {
      throw new HttpError(
        422,
        "WORKSPACE_NOT_READY",
        `The ${basis} basis has no selected LDFs and the study does not supply it; the ` +
          `promotion's apply gate reruns the full analysis, which needs selections on both ` +
          `bases. Select ${basis} factors first, then import the study`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public surface (routes call these; `now` crosses the boundary from the
// route, which is where the application reads its clock)

/**
 * Starts a promotion for a study document. Study-content failures (bad
 * interchange, ceiling exceeded, unresolved segment, ...) surface as the
 * intake gate failing with a NAMED error - translated here to a 422 so the
 * import responds with the reason; nothing is persisted for a study that
 * never became a paused run.
 */
export async function startPromotion(
  projectId: string,
  studyDoc: unknown,
  now: () => string,
): Promise<PromotionView> {
  assertWorkspaceReady(projectId, studyDoc);
  const runId = randomUUID();
  const handle = buildHandle(
    runId,
    projectId,
    studyDoc,
    env.promotionToleranceCeiling,
    now,
  );
  const run = await handle.workflow.createRun({ runId });
  const result = (await run.start({
    inputData: {},
    requestContext: requestContextFor(projectId),
  })) as WorkflowRunResult;
  const view = describeRun(runId, result, handle.noteIds);
  if (view.status === "failed") {
    registry.delete(runId);
    throw new HttpError(422, view.error.code, view.error.message);
  }
  if (view.status !== "awaiting-decision") {
    throw new Error(`promotion run ${runId} neither suspended nor failed: ${result.status}`);
  }
  insertStudyPromotion({
    runId,
    projectId,
    studyJson: JSON.stringify(studyDoc),
    toleranceCeiling: env.promotionToleranceCeiling,
    status: "awaiting-decision",
    stateJson: JSON.stringify(view),
  });
  return view;
}

export function getPromotionView(projectId: string, runId: string): PromotionView {
  const row = getStudyPromotion(runId);
  if (!row || row.projectId !== projectId) {
    throw new HttpError(404, "NOT_FOUND", "Promotion run not found");
  }
  return JSON.parse(row.stateJson) as PromotionView;
}

export function listPromotionViews(
  projectId: string,
): { view: PromotionView; createdAt: string; updatedAt: string }[] {
  return listStudyPromotions(projectId).map((row) => ({
    view: JSON.parse(row.stateJson) as PromotionView,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/**
 * Resumes the paused run with a validated gate decision. Gate-order safety
 * is double-walled: the route rejects a mismatched gate with a 409 HERE
 * (deterministic, from the persisted state), and Mastra's own resume
 * validation backs it (a hard-blocked replay-verify gate structurally
 * refuses an accept - that rejection surfaces as DECISION_REJECTED).
 *
 * CONCURRENCY. Two racers resuming the same paused run must not both reach
 * Mastra: the second resume would interleave with (or replay) the first's
 * gate execution. The claim is a DB compare-and-swap - one UPDATE moving
 * studies.status 'awaiting-decision' -> 'advancing' with the guard in the
 * WHERE clause, judged by affected-row count - so exactly one request per
 * pause wins. The loser answers 409 PROMOTION_BUSY without touching the
 * run. Settlement is the same row: completion writes the described view's
 * status ('awaiting-decision' for the next gate, 'complete', 'failed'), and
 * a rejected decision releases the claim back to 'awaiting-decision'.
 * Stranded claims (process death mid-advance) are swept back to
 * 'awaiting-decision' at boot by the db client - claims are process-local.
 */
export async function advancePromotion(
  projectId: string,
  runId: string,
  gate: PromotionGateId,
  resumeData: Record<string, unknown>,
  now: () => string,
): Promise<PromotionView> {
  const row = getStudyPromotion(runId);
  if (!row || row.projectId !== projectId) {
    throw new HttpError(404, "NOT_FOUND", "Promotion run not found");
  }
  if (row.status === "advancing") {
    throw new HttpError(
      409,
      "PROMOTION_BUSY",
      `Promotion run ${runId} is already being advanced by another request; retry once it settles`,
    );
  }
  if (row.status !== "awaiting-decision") {
    throw new HttpError(
      409,
      "PROMOTION_SETTLED",
      `Promotion run ${runId} is already ${row.status}; nothing to advance`,
    );
  }
  const current = JSON.parse(row.stateJson) as PromotionView;
  if (current.status !== "awaiting-decision" || current.gate !== gate) {
    const at = current.status === "awaiting-decision" ? current.gate : current.status;
    throw new HttpError(
      409,
      "GATE_MISMATCH",
      `Promotion run ${runId} is at the "${at}" gate; got a decision for "${gate}"`,
    );
  }

  // The CAS claim: only one request per pause proceeds past this line.
  if (!claimStudyPromotionAdvance(runId)) {
    throw new HttpError(
      409,
      "PROMOTION_BUSY",
      `Promotion run ${runId} is already being advanced by another request; retry once it settles`,
    );
  }

  const handle = ensureHandle(row, now);
  const run = await handle.workflow.createRun({ runId });
  let result: WorkflowRunResult;
  try {
    result = (await run.resume({
      step: gate,
      resumeData,
      requestContext: requestContextFor(projectId),
    })) as WorkflowRunResult;
  } catch (err) {
    // The decision was rejected and the run stays paused: release the claim
    // so the next (corrected) decision can take it.
    releaseStudyPromotionAdvance(runId);
    const message = err instanceof Error ? err.message : String(err);
    if (/not suspended/i.test(message)) {
      throw new HttpError(409, "PROMOTION_NOT_SUSPENDED", message);
    }
    // Mastra validates resumeData against the gate's resume schema; a
    // rejection here includes the structural Gate 2 hard-block refusing an
    // accept decision. The decision was rejected, the run stays paused.
    throw new HttpError(422, "DECISION_REJECTED", message);
  }

  // Settle the claim: the described status is 'awaiting-decision' (next
  // gate), 'complete', or 'failed' - never 'advancing'.
  const view = describeRun(runId, result, handle.noteIds);
  updateStudyPromotion(runId, view.status, JSON.stringify(view));
  if (view.status === "failed") {
    throw new HttpError(422, view.error.code, view.error.message);
  }
  return view;
}
