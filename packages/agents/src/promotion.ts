/**
 * promoteStudy: notebook study -> governed judgment (interchange spec rev 2.1,
 * Section 6). A four-gate judgment chain built on createJudgmentChain:
 *
 *   Gate 1 "study-intake"  - schema/integrity validation via interchange
 *                            parseDocument, ASOP 23 data review on the study's
 *                            triangles, selection coherence (spec 3.2 rule),
 *                            segment resolution (v1: one selection per
 *                            segment), and the tolerance ceiling.
 *   Gate 2 "replay-verify" - table-exact intents replayed through
 *                            interchange/core; approx/value-only targets
 *                            labeled verified-by-value; supportingResults
 *                            refereed via crosscheck at the effective
 *                            tolerance; a "disagree" verdict HARD-BLOCKS.
 *   Gate 3 "rationale"     - a DRAFT rationale (template-assembled from the
 *                            study narrative; options.draftRationale is the
 *                            injection hook for future agent drafting); resume
 *                            REQUIRES a non-blank rationale AND attestation.
 *   Gate 4 "apply"         - deps.applySelections per selection,
 *                            deps.runAnalysis, ledger entries carrying the
 *                            Gate 3 rationale + attestation verbatim, and
 *                            deps.persistNote with the trail + ledger JSON.
 *
 * Architecture decisions (each is load-bearing):
 *
 * - EAGER, DETERMINISTIC INTAKE. All Gate 1/2 computation (parse, review,
 *   coherence, segment resolution, replay, crosschecks) runs synchronously at
 *   chain-CONSTRUCTION time. Everything is a pure function of the study
 *   document plus deps.resolveSegment, so a host that reconstructs the chain
 *   after a restart (promoteStudy again with the same study) gets IDENTICAL
 *   gates and resume schemas - which is what makes the Gate 2 hard-block
 *   structural: when any referee verdict is "disagree", the replay-verify
 *   resume schema literally only admits { decision: "abort" }. Mastra's own
 *   resume validation rejects an accept; no runtime flag to lose across a
 *   snapshot rehydration, no advisory check an agent could talk its way past.
 *
 * - STUDY-CONTENT FAILURES SURFACE AS GATE FAILURES. A malformed study
 *   (BAD_INTERCHANGE), a tolerance above the host ceiling
 *   (TOLERANCE_CEILING_EXCEEDED), an unresolvable or ambiguous segment
 *   (SEGMENT_UNRESOLVED / SEGMENT_AMBIGUOUS), an incoherent selection under
 *   refuse strictness (INCOHERENT_SELECTION), or an empty study (EMPTY_STUDY)
 *   never throws out of promoteStudy itself: the captured error is thrown
 *   from Gate 1's gatherEvidence, so the run fails AT the study-intake gate
 *   with the named error, where the host's gate UI can render it.
 *   promoteStudy throws synchronously only for programmer errors
 *   (BAD_PROMOTION_OPTIONS: missing deps, non-positive ceiling, ...).
 *
 * - DATA REVIEW CHOICE (documented per plan task B2): where a segment group
 *   contains exactly one paid and one incurred triangle, the full
 *   @actuarial-ts/data reviewTriangles pair review runs (it includes the
 *   per-triangle monotonicity and interior-missing checks). Every other core
 *   loss triangle gets the per-triangle STRUCTURAL subset of those checks
 *   (non-decreasing cumulative rows, interior missing cells), reported in the
 *   same DataReviewReport shape. Non-core measures (earnedPremium, custom:*)
 *   are exposure/reference data, not loss triangles: their review is reported
 *   "not-evaluated" rather than silently passed - unless a selection
 *   references one, which fails intake (BAD_INTERCHANGE from the converter).
 *   Review findings, including fail-status checks, are EVIDENCE for the human
 *   intake decision, not automatic blocks; only the named error classes above
 *   block mechanically. The recommendation says so when checks fail.
 *
 * - PURITY. This module never reads a clock; options.now supplies every
 *   timestamp (envelope createdAt at construction, ledger timestamps at
 *   resume). The tenant seam is untouched: deps close over the host's own
 *   authenticated context, and nothing model-facing exists here at all.
 *
 * FOOTGUN (inherited from createJudgmentChain): the returned workflow exposes
 * .then(step), making it an ACCIDENTAL THENABLE. Never await promoteStudy's
 * return value and never return it from an async function - assign it
 * synchronously and register it on a Mastra instance.
 */

import {
  ReservingError,
  runChainLadder,
  type LdfSelections,
  type Triangle,
} from "@actuarial-ts/core";
import {
  CONVENTION_PROFILES,
  CORE_MEASURES,
  DETERMINISTIC_CL_PROFILE,
  crosscheck,
  docToSelections,
  docToTriangle,
  isValueOnlySelection,
  parseDocument,
  resultToDoc,
  verifyIntegrity,
  type CoherenceCheck,
  type CrosscheckReportDoc,
  type DocToSelectionsResult,
  type MethodResultDoc,
  type SelectionDoc,
  type StudyBody,
  type StudyDoc,
  type TriangleDoc,
} from "@actuarial-ts/interchange";
import {
  reviewTriangles,
  type DataCheck,
  type DataReviewReport,
} from "@actuarial-ts/data";
import type { AssumptionActor } from "@actuarial-ts/compliance";
import { z } from "zod";
import { AgentsError } from "./errors.js";
import {
  createJudgmentChain,
  type JudgmentChainWorkflow,
  type JudgmentGateSpec,
  type JudgmentLedgerEntry,
} from "./judgment.js";

// ---------------------------------------------------------------------------
// Public API surface

/**
 * The host-adapter seam (spec 6 Gate 4; the workbench adapter arrives with
 * plan task B4). resolveSegment is SYNCHRONOUS so promoteStudy can stay
 * synchronous (the accidental-thenable footgun forbids async construction);
 * the mutation hooks may be async - they run inside gate execution.
 */
export interface PromoteStudyDeps {
  /**
   * Maps a selection's triangle segment labels to exactly one host workspace
   * target, or null when nothing matches (v1: no fuzzy matching). A
   * single-segment host returns its only target regardless of labels.
   */
  resolveSegment(labels: Record<string, string>): string | null;
  /**
   * Applies one promoted selection through the host's service layer.
   * `replayedSelections` is the core LdfSelections the replay verified;
   * `segmentTarget` is the resolved workspace target (a two-parameter
   * implementation that closes over its single segment may ignore it).
   */
  applySelections(
    selectionDoc: SelectionDoc,
    replayedSelections: LdfSelections,
    segmentTarget: string,
  ): Promise<void> | void;
  /** Reruns the host analysis after the selections are applied. */
  runAnalysis(label: string): Promise<void> | void;
  /** Persists a completion note (called twice: trail, then ledger JSON). */
  persistNote(text: string, author: string): Promise<void> | void;
}

/** Context handed to the rationale-drafting hook. */
export interface DraftRationaleContext {
  study: StudyBody;
  studyIntegrity: string;
  intake: StudyIntakeEvidence;
  replay: ReplayVerifyEvidence;
}

export interface PromoteStudyOptions {
  /**
   * The host's replay-tolerance ceiling. The EFFECTIVE tolerance is
   * min(study replayTolerance, ceiling); a study STATING a tolerance above
   * the ceiling fails intake (tolerance editing is not an escape hatch).
   */
  toleranceCeiling: number;
  /** Actor recorded when a resume payload names none. Default "actuary". */
  actorDefault?: string;
  /** Host-injected clock (purity: this package never reads Date). */
  now: () => string;
  /**
   * Coherence/integrity strictness for intake. Default "refuse" (promotion
   * is a refuse-mode consumer per spec 3.2); "warn" downgrades divergence
   * to evidence warnings.
   */
  strictness?: "warn" | "refuse";
  /**
   * Injection hook for agent-assisted rationale drafting (spec 9.2 arrives
   * later); the default assembles a template from the study narrative. The
   * human always owns the final text - this drafts, never decides.
   */
  draftRationale?: (ctx: DraftRationaleContext) => Promise<string> | string;
}

// ---------------------------------------------------------------------------
// Evidence shapes (exported so hosts/tests can type gate payloads)

/** Prominent tolerance block (spec 6 Gate 1). */
export interface ReplayToleranceEvidence {
  /** expectations.replayTolerance as stated, or null when the study omits it. */
  stated: number | null;
  /** The convention-profile default the 10x flag is measured against. */
  profileId: string;
  profileDefault: number;
  /** true when the stated tolerance exceeds 10x the profile default. */
  exceedsTenTimesProfileDefault: boolean;
  /** The host ceiling from options. */
  ceiling: number;
  /** min(stated ?? profileDefault, ceiling): what Gate 2 referees at. */
  effective: number;
}

export interface TriangleReviewEvidence {
  /** paired-asop23 = reviewTriangles on a paid/incurred pair; structural =
   * per-triangle checks; not-evaluated = non-core measure. */
  mode: "paired-asop23" | "structural" | "not-evaluated";
  triangles: { integrity: string; measure: string }[];
  report: DataReviewReport;
}

export interface SegmentResolutionEvidence {
  selectionIntegrity: string;
  labels: Record<string, string>;
  target: string;
}

export interface SelectionCoherenceEvidence {
  selectionIntegrity: string;
  triangleIntegrity: string;
  coherence: CoherenceCheck;
}

export interface StudyIntakeEvidence {
  study: {
    title: string;
    analyst: string | null;
    sourceRef: string | null;
    summary: string;
    integrity: string;
  };
  /** FIRST, on purpose: the spec requires prominent display. */
  replayTolerance: ReplayToleranceEvidence;
  dataReview: TriangleReviewEvidence[];
  coherence: SelectionCoherenceEvidence[];
  segments: SegmentResolutionEvidence[];
  warnings: string[];
  /**
   * ALWAYS populated: the verification-scope disclosure. Coherence, replay,
   * and referee all verify the study against its OWN embedded triangle;
   * whether that triangle IS the host workspace's book of business is not
   * machine-verified anywhere in the chain. Stating this in the evidence
   * keeps the gates honest about what they checked - the data-binding
   * judgment belongs to the reviewing actuary, and the UI must say so
   * rather than let "verified" read wider than it is.
   */
  workspaceBindingNote: string;
}

/** Per replay target: how this shore verified it (spec 3.2 capabilities). */
export interface ReplayTargetLabel {
  /** "12-24" for a development interval, or "tail". */
  target: string;
  /** exact = independently recomputed; value-only = applied as stated. */
  capability: "exact" | "value-only";
  /** The disclosure-honest label: replayed-exact or verified-by-value. */
  label: "replayed-exact" | "verified-by-value";
  note?: string;
}

export interface SelectionReplayEvidence {
  selectionIntegrity: string;
  triangleIntegrity: string;
  segmentTarget: string;
  targets: ReplayTargetLabel[];
  /** Every intent judgmental/external: the whole replay is value transport. */
  verifiedByValueOnly: boolean;
  replayTotals: { ultimate: number; unpaid: number };
}

export interface SupportingCrosscheckEvidence {
  resultIntegrity: string;
  engine: { name: string; version: string };
  /** null when the result could not be refereed (see reason). */
  verdict: "agree" | "disagree" | "not-comparable" | "verified-by-value" | null;
  report: CrosscheckReportDoc | null;
  reason?: string;
}

export interface ReplayVerifyEvidence {
  effectiveTolerance: number;
  replays: SelectionReplayEvidence[];
  crosschecks: SupportingCrosscheckEvidence[];
  /** Any crosscheck verdict "disagree": the gate cannot accept (spec 6). */
  hardBlocked: boolean;
  /** States exactly what the verification consisted of - including, when the
   * study carried no supportingResults, that it was coherence + replay only. */
  verification: string;
}

/**
 * A supporting result the study carries that is NOT reproducible (spec 16).
 *
 * A `witnessed` result attests what an engine produced on one run; re-running
 * it does not reproduce the number. That is legitimate evidence, but it is a
 * materially different thing from a replayable derivation, and the actuary
 * whose attestation goes on the ledger has to know which one they are relying
 * on. Surfacing it here is what makes the attestation informed rather than
 * nominal — the promotion is not blocked, it is disclosed.
 */
export interface WitnessedResultNotice {
  method: string;
  engine: string;
  seed: number | null;
  /** The engine's own repeat-run self-check, when it performed one. */
  stability: {
    repeats: number;
    byteIdentical: boolean;
    maxRelativeDeviation: number | null;
  } | null;
}

export interface RationaleEvidence {
  draftRationale: string;
  attestationRequired: true;
  study: { title: string; sourceRef: string | null; analyst: string | null };
  /**
   * Non-reproducible supporting results, empty when every result is
   * deterministic or seeded-reproducible.
   */
  witnessedResults: WitnessedResultNotice[];
}

/** Collects the study's `witnessed` supporting results (spec 16). */
function witnessedResultsOf(study: StudyBody): WitnessedResultNotice[] {
  const notices: WitnessedResultNotice[] = [];
  for (const doc of study.supportingResults ?? []) {
    const result = doc.result as Record<string, unknown>;
    if (result["reproducibility"] !== "witnessed") continue;
    const rawStability = result["stability"];
    const stability =
      rawStability !== null && typeof rawStability === "object"
        ? (rawStability as Record<string, unknown>)
        : null;
    notices.push({
      method: String(result["method"] ?? "(unnamed method)"),
      engine: `${doc.result.engine.name}@${doc.result.engine.version}`,
      seed: typeof result["seed"] === "number" ? result["seed"] : null,
      stability:
        stability === null
          ? null
          : {
              repeats: Number(stability["repeats"] ?? 0),
              byteIdentical: stability["byteIdentical"] === true,
              maxRelativeDeviation:
                typeof stability["maxRelativeDeviation"] === "number"
                  ? stability["maxRelativeDeviation"]
                  : null,
            },
    });
  }
  return notices;
}

export interface ApplyEvidence {
  applications: {
    segmentTarget: string;
    selectionIntegrity: string;
    developmentCount: number;
    tailFactor: number;
  }[];
  analysisLabel: string;
  ledgerSource: string;
}

/** The workflow id promoteStudy builds its chain with. */
export const PROMOTION_CHAIN_ID = "promote-study";

// ---------------------------------------------------------------------------
// Intake computation (pure; runs once, at construction)

interface SelectionUnit {
  selectionDoc: SelectionDoc;
  triangleDoc: TriangleDoc;
  labels: Record<string, string>;
  target: string;
  replayed: DocToSelectionsResult;
  replayDoc: MethodResultDoc;
  replayTotals: { ultimate: number; unpaid: number };
  targets: ReplayTargetLabel[];
  verifiedByValueOnly: boolean;
}

interface PromotionContext {
  study: StudyBody;
  studyIntegrity: string;
  tolerance: ReplayToleranceEvidence;
  dataReview: TriangleReviewEvidence[];
  units: SelectionUnit[];
  crosschecks: SupportingCrosscheckEvidence[];
  hardBlocked: boolean;
  warnings: string[];
}

type IntakeOutcome =
  | { ok: true; ctx: PromotionContext }
  | { ok: false; error: Error };

const MAX_STRUCTURAL_DETAILS = 20;

function capDetails(items: string[]): string[] {
  return items.length <= MAX_STRUCTURAL_DETAILS
    ? items
    : [...items.slice(0, MAX_STRUCTURAL_DETAILS), `+${items.length - MAX_STRUCTURAL_DETAILS} more`];
}

function structuralCheck(
  id: string,
  description: string,
  findings: string[],
): DataCheck {
  return {
    id,
    description,
    status: findings.length > 0 ? "warning" : "pass",
    details: capDetails(findings),
  };
}

/**
 * The per-triangle STRUCTURAL subset of the data package's triangle review
 * (the pair-wise checks need a paid/incurred pair; these do not).
 */
function structuralReview(tri: Triangle): DataReviewReport {
  const nonDecreasing: string[] = [];
  const interiorMissing: string[] = [];
  for (let i = 0; i < tri.values.length; i++) {
    const row = tri.values[i]!;
    let prev: number | null = null;
    let prevAge: number | null = null;
    for (let j = 0; j < row.length; j++) {
      const v = row[j];
      if (v === null || v === undefined) continue;
      const age = tri.ages[j]!;
      if (prev !== null && v < prev) {
        nonDecreasing.push(
          `${tri.kind} ${tri.origins[i]} age ${prevAge} -> ${age}: ${prev} -> ${v}`,
        );
      }
      prev = v;
      prevAge = age;
    }
    const observed = row.map((v) => v !== null && v !== undefined);
    const first = observed.indexOf(true);
    const last = observed.lastIndexOf(true);
    if (first === -1) continue;
    for (let j = first + 1; j < last; j++) {
      if (!observed[j]) {
        interiorMissing.push(`${tri.kind} ${tri.origins[i]} age ${tri.ages[j]}: interior cell missing`);
      }
    }
  }
  const checks: DataCheck[] = [
    structuralCheck(
      "negative-incremental",
      "Cumulative values are non-decreasing along each origin row (salvage/case takedowns can legitimately violate this)",
      nonDecreasing,
    ),
    structuralCheck(
      "interior-missing",
      "No row has a missing cell between observed cells",
      interiorMissing,
    ),
  ];
  const summary = { pass: 0, warning: 0, fail: 0, notEvaluated: 0 };
  for (const c of checks) {
    if (c.status === "pass") summary.pass++;
    else if (c.status === "warning") summary.warning++;
  }
  return { checks, summary };
}

function notEvaluatedReview(reason: string): DataReviewReport {
  return {
    checks: [
      {
        id: "loss-triangle-review",
        description: "ASOP 23-oriented triangle review",
        status: "not-evaluated",
        details: [`not evaluated: ${reason}`],
      },
    ],
    summary: { pass: 0, warning: 0, fail: 0, notEvaluated: 1 },
  };
}

function segmentKeyOf(labels: Record<string, string>): string {
  return JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
}

function labelsOf(triangleDoc: TriangleDoc): Record<string, string> {
  return triangleDoc.triangle.segment?.labels ?? {};
}

/**
 * ASOP 23 review over the study's triangles: paired reviewTriangles wherever
 * a segment group holds exactly one paid and one incurred core triangle;
 * structural checks for every other core loss triangle; not-evaluated for
 * non-core measures (see the module doc for the rationale).
 */
function reviewStudyTriangles(
  triangles: readonly TriangleDoc[],
  warnings: string[],
): TriangleReviewEvidence[] {
  const isCore = (doc: TriangleDoc): boolean =>
    (CORE_MEASURES as readonly string[]).includes(doc.triangle.measure);

  const bySegment = new Map<string, TriangleDoc[]>();
  for (const doc of triangles) {
    if (!isCore(doc)) continue;
    const key = segmentKeyOf(labelsOf(doc));
    const list = bySegment.get(key);
    if (list) list.push(doc);
    else bySegment.set(key, [doc]);
  }

  const paired = new Set<TriangleDoc>();
  const evidence: TriangleReviewEvidence[] = [];
  for (const group of bySegment.values()) {
    const paidDocs = group.filter((d) => d.triangle.measure === "paid");
    const incurredDocs = group.filter((d) => d.triangle.measure === "incurred");
    if (paidDocs.length === 1 && incurredDocs.length === 1) {
      const paidDoc = paidDocs[0]!;
      const incurredDoc = incurredDocs[0]!;
      const paidConv = docToTriangle(paidDoc);
      const incurredConv = docToTriangle(incurredDoc);
      warnings.push(...paidConv.warnings, ...incurredConv.warnings);
      evidence.push({
        mode: "paired-asop23",
        triangles: [
          { integrity: paidDoc.integrity, measure: "paid" },
          { integrity: incurredDoc.integrity, measure: "incurred" },
        ],
        report: reviewTriangles(paidConv.triangle, incurredConv.triangle),
      });
      paired.add(paidDoc);
      paired.add(incurredDoc);
    }
  }

  for (const doc of triangles) {
    if (paired.has(doc)) continue;
    if (!isCore(doc)) {
      evidence.push({
        mode: "not-evaluated",
        triangles: [{ integrity: doc.integrity, measure: doc.triangle.measure }],
        report: notEvaluatedReview(
          `measure "${doc.triangle.measure}" is exposure/reference data, not a core loss triangle`,
        ),
      });
      continue;
    }
    const conv = docToTriangle(doc);
    warnings.push(...conv.warnings);
    evidence.push({
      mode: "structural",
      triangles: [{ integrity: doc.integrity, measure: doc.triangle.measure }],
      report: structuralReview(conv.triangle),
    });
  }
  return evidence;
}

/** The shared conventionProfile the 10x flag is measured against. */
function referenceProfileId(supportingResults: StudyBody["supportingResults"]): string {
  const profiles = new Set<string>();
  for (const doc of supportingResults ?? []) {
    const profile = doc.result.engine.conventionProfile;
    if (typeof profile === "string" && profile in CONVENTION_PROFILES) profiles.add(profile);
  }
  return profiles.size === 1 ? [...profiles][0]! : DETERMINISTIC_CL_PROFILE.id;
}

function targetLabelsOf(coherence: CoherenceCheck): ReplayTargetLabel[] {
  return coherence.findings.map((finding) => {
    const target =
      finding.target === "tail"
        ? "tail"
        : `${finding.target.fromAgeMonths}-${finding.target.toAgeMonths}`;
    const exact = finding.capability === "exact";
    const label: ReplayTargetLabel = {
      target,
      capability: finding.capability,
      label: exact ? "replayed-exact" : "verified-by-value",
    };
    if (finding.note !== undefined) label.note = finding.note;
    return label;
  });
}

function computeIntake(
  deps: PromoteStudyDeps,
  studyInput: unknown,
  options: PromoteStudyOptions,
): IntakeOutcome {
  const strictness = options.strictness ?? "refuse";
  const warnings: string[] = [];
  try {
    // 1. Schema + envelope-integrity validation via the interchange parser.
    const parsed = parseDocument(studyInput, { strictness });
    warnings.push(...parsed.warnings);
    if (parsed.doc.kind !== "study") {
      throw new ReservingError(
        "BAD_INTERCHANGE",
        `promoteStudy needs a document of kind "study"; got kind "${parsed.doc.kind}"`,
      );
    }
    const doc = parsed.doc as StudyDoc;
    const study = doc.study;
    if (study.selections.length === 0) {
      throw new AgentsError(
        "EMPTY_STUDY",
        `Study "${study.title}" contains no selections; the promotion unit must carry at least one`,
      );
    }

    // 2. Nested-document integrity (the study envelope's tag covers the study
    //    body, not the embedded documents' own claims).
    const nested: { kind: string; doc: { integrity: string; kind: string } }[] = [
      ...study.triangles.map((t) => ({ kind: "triangle", doc: t })),
      ...study.selections.map((s) => ({ kind: "selection", doc: s })),
      ...(study.supportingResults ?? []).map((r) => ({ kind: r.kind, doc: r })),
    ];
    for (const { kind, doc: embedded } of nested) {
      const check = verifyIntegrity(embedded as never);
      if (!check.ok) {
        const message =
          `Embedded ${kind} document states integrity ${check.actual ?? "(none)"} but its semantic ` +
          `body hashes to ${check.expected}`;
        if (strictness === "refuse") throw new ReservingError("BAD_INTERCHANGE", message);
        warnings.push(message);
      }
    }

    // 3. Tolerance ceiling + the 10x-profile-default flag (spec 6 Gate 1).
    const stated = study.expectations?.replayTolerance ?? null;
    const ceiling = options.toleranceCeiling;
    if (stated !== null && stated > ceiling) {
      throw new AgentsError(
        "TOLERANCE_CEILING_EXCEEDED",
        `Study replayTolerance ${stated} exceeds the host ceiling ${ceiling}; the host cannot ` +
          "verify at the study's stated tolerance, so the study fails intake (loosen nothing here - " +
          "fix the study upstream or raise the host ceiling deliberately)",
      );
    }
    const profileId = referenceProfileId(study.supportingResults);
    const profileDefault = CONVENTION_PROFILES[profileId]!.tolerance.central;
    const tolerance: ReplayToleranceEvidence = {
      stated,
      profileId,
      profileDefault,
      exceedsTenTimesProfileDefault: stated !== null && stated > 10 * profileDefault,
      ceiling,
      effective: Math.min(stated ?? profileDefault, ceiling),
    };

    // 4. ASOP 23 data review.
    const dataReview = reviewStudyTriangles(study.triangles, warnings);

    // 5. Per selection: triangle linkage, coherence, segment, replay.
    const trianglesByTag = new Map(study.triangles.map((t) => [t.integrity, t]));
    const targetsSeen = new Map<string, string>(); // target -> selection integrity
    const units: SelectionUnit[] = [];
    for (const selectionDoc of study.selections) {
      const tag = selectionDoc.selection.appliesTo.triangleIntegrity;
      const triangleDoc = trianglesByTag.get(tag);
      if (triangleDoc === undefined) {
        throw new ReservingError(
          "BAD_INTERCHANGE",
          `Selection ${selectionDoc.integrity} applies to triangle ${tag}, which the study does not carry`,
        );
      }
      const replayed = docToSelections(selectionDoc, { triangleDoc, strictness });
      warnings.push(...replayed.warnings);

      const labels = labelsOf(triangleDoc);
      const target = deps.resolveSegment(labels);
      if (target === null) {
        throw new AgentsError(
          "SEGMENT_UNRESOLVED",
          `No workspace target matches segment labels ${JSON.stringify(labels)} for selection ` +
            `${selectionDoc.integrity} (v1 resolves exact matches only; no fuzzy matching)`,
        );
      }
      const priorSelection = targetsSeen.get(target);
      if (priorSelection !== undefined) {
        throw new AgentsError(
          "SEGMENT_AMBIGUOUS",
          `Selections ${priorSelection} and ${selectionDoc.integrity} both resolve to workspace ` +
            `target "${target}"; v1 promotes exactly one selection per segment`,
        );
      }
      targetsSeen.set(target, selectionDoc.integrity);

      const replayResult = runChainLadder(
        docToTriangle(triangleDoc).triangle,
        replayed.selections,
      );
      warnings.push(...replayResult.warnings);
      const replayDoc = resultToDoc(replayResult, {
        triangleDoc,
        selectionDoc,
        createdAt: options.now(),
        parameters: { replayOf: selectionDoc.integrity, source: "promotion replay-verify" },
      });
      units.push({
        selectionDoc,
        triangleDoc,
        labels,
        target,
        replayed,
        replayDoc,
        replayTotals: {
          ultimate: replayResult.totals.ultimate,
          unpaid: replayResult.totals.unpaid,
        },
        targets: targetLabelsOf(replayed.coherence),
        verifiedByValueOnly: isValueOnlySelection(selectionDoc.selection),
      });
    }

    // 6. Referee each supporting result against its replay (spec 6 Gate 2).
    const crosschecks: SupportingCrosscheckEvidence[] = [];
    for (const supporting of study.supportingResults ?? []) {
      const engine = {
        name: supporting.result.engine.name,
        version: supporting.result.engine.version,
      };
      if (supporting.kind !== "method-result") {
        crosschecks.push({
          resultIntegrity: supporting.integrity,
          engine,
          verdict: null,
          report: null,
          reason:
            "stochastic results compare at distribution level only (spec 3.2); not refereed in this phase",
        });
        continue;
      }
      const unit = units.find(
        (u) =>
          u.selectionDoc.integrity === supporting.result.appliesTo.selectionIntegrity &&
          u.triangleDoc.integrity === supporting.result.appliesTo.triangleIntegrity,
      );
      if (unit === undefined) {
        crosschecks.push({
          resultIntegrity: supporting.integrity,
          engine,
          verdict: null,
          report: null,
          reason:
            "appliesTo tags match no (triangle, selection) pair in the study; nothing to referee against",
        });
        continue;
      }
      const report = crosscheck({
        a: supporting,
        b: unit.replayDoc,
        tolerance: tolerance.effective,
        selection: unit.selectionDoc,
        createdAt: options.now(),
      });
      crosschecks.push({
        resultIntegrity: supporting.integrity,
        engine,
        verdict: report.report.verdict,
        report,
      });
    }

    return {
      ok: true,
      ctx: {
        study,
        studyIntegrity: doc.integrity,
        tolerance,
        dataReview,
        units,
        crosschecks,
        hardBlocked: crosschecks.some((c) => c.verdict === "disagree"),
        warnings,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ---------------------------------------------------------------------------
// Evidence assembly

function reviewSummaryText(dataReview: TriangleReviewEvidence[]): string {
  const totals = { pass: 0, warning: 0, fail: 0, notEvaluated: 0 };
  for (const entry of dataReview) {
    totals.pass += entry.report.summary.pass;
    totals.warning += entry.report.summary.warning;
    totals.fail += entry.report.summary.fail;
    totals.notEvaluated += entry.report.summary.notEvaluated;
  }
  return `${totals.pass} pass, ${totals.warning} warning, ${totals.fail} fail, ${totals.notEvaluated} not evaluated`;
}

/** See StudyIntakeEvidence.workspaceBindingNote; one constant so every
 * intake states the same scope, verbatim. */
export const WORKSPACE_BINDING_NOTE =
  "Scope of verification: coherence, replay, and referee checks verify the study against " +
  "its OWN embedded triangle. Whether that triangle is this workspace's book of business " +
  "is not machine-verified; that binding remains the reviewing actuary's judgment.";

function intakeEvidenceOf(ctx: PromotionContext): StudyIntakeEvidence {
  return {
    study: {
      title: ctx.study.title,
      analyst: ctx.study.narrative.analyst ?? null,
      sourceRef: ctx.study.narrative.sourceRef ?? null,
      summary: ctx.study.narrative.summary,
      integrity: ctx.studyIntegrity,
    },
    replayTolerance: ctx.tolerance,
    dataReview: ctx.dataReview,
    coherence: ctx.units.map((u) => ({
      selectionIntegrity: u.selectionDoc.integrity,
      triangleIntegrity: u.triangleDoc.integrity,
      coherence: u.replayed.coherence,
    })),
    segments: ctx.units.map((u) => ({
      selectionIntegrity: u.selectionDoc.integrity,
      labels: u.labels,
      target: u.target,
    })),
    warnings: ctx.warnings,
    workspaceBindingNote: WORKSPACE_BINDING_NOTE,
  };
}

function replayEvidenceOf(ctx: PromotionContext): ReplayVerifyEvidence {
  const refereed = ctx.crosschecks.filter((c) => c.verdict !== null);
  const verification =
    (ctx.study.supportingResults ?? []).length === 0
      ? "Verification was selection coherence plus replay only: the study carried no " +
        "supportingResults, so no cross-engine referee step ran (spec 6 Gate 2)."
      : `Verification was coherence, replay, and referee: ${refereed.length} supporting ` +
        `result(s) crosschecked against the replay at effective tolerance ${ctx.tolerance.effective}` +
        (refereed.length < ctx.crosschecks.length
          ? `; ${ctx.crosschecks.length - refereed.length} could not be refereed (see reasons)`
          : "") +
        ".";
  return {
    effectiveTolerance: ctx.tolerance.effective,
    replays: ctx.units.map((u) => ({
      selectionIntegrity: u.selectionDoc.integrity,
      triangleIntegrity: u.triangleDoc.integrity,
      segmentTarget: u.target,
      targets: u.targets,
      verifiedByValueOnly: u.verifiedByValueOnly,
      replayTotals: u.replayTotals,
    })),
    crosschecks: ctx.crosschecks,
    hardBlocked: ctx.hardBlocked,
    verification,
  };
}

function defaultDraftRationale(ctx: DraftRationaleContext): string {
  const { study, replay } = ctx;
  const source = study.narrative.sourceRef ?? study.title;
  const analyst = study.narrative.analyst !== undefined ? ` by ${study.narrative.analyst}` : "";
  const verdicts = replay.crosschecks
    .filter((c) => c.verdict !== null)
    .map((c) => `${c.engine.name} ${c.verdict}`)
    .join(", ");
  return (
    `Adopting the selections of study "${study.title}" (${source})${analyst}. ` +
    `Study summary: ${study.narrative.summary} ` +
    `Replay verification: ${replay.replays.length} selection(s) verified at effective tolerance ` +
    `${replay.effectiveTolerance}${verdicts.length > 0 ? `; referee verdicts: ${verdicts}` : ""}. ` +
    replay.verification
  );
}

// ---------------------------------------------------------------------------
// Resume-schema building blocks

const nonBlankString = z
  .string()
  .refine((s) => s.trim() !== "", { message: "must not be blank" });

const actorField = z.string().min(1).optional();

/** Maps a free-form actor string onto the compliance ledger's closed enum:
 * exact enum values pass through; anything else (an unattended MCP client,
 * a named service) records as "agent" - disclosure-true for a non-human
 * decider. What is recorded where: every ledger entry's `actor` carries
 * this COARSE enum; the RAW actor string is preserved verbatim inside the
 * attestation entry's value (`value.actor`), so the precise identity
 * survives the enum mapping. */
function toAssumptionActor(actor: string): AssumptionActor {
  return actor === "default" || actor === "actuary" || actor === "agent" ? actor : "agent";
}

interface AcceptAbortDecision {
  decision: "accept" | "abort";
  rationale: string;
  actor?: string;
}

interface RationaleDecision {
  decision: "approve" | "abort";
  rationale: string;
  attestation: string;
  actor?: string;
}

interface ApplyDecision {
  decision: "apply" | "abort";
  rationale: string;
  actor?: string;
}

/** The gate a promotion was aborted at, or null when it is still live. */
function abortedStage(decisions: Record<string, unknown>): string | null {
  for (const gateId of ["study-intake", "replay-verify", "rationale"]) {
    const decision = decisions[gateId] as { decision?: unknown } | undefined;
    if (decision?.decision === "abort") return gateId;
  }
  return null;
}

const skipWhenAborted = (ctx: { decisions: Record<string, unknown> }): string | null => {
  const stage = abortedStage(ctx.decisions);
  return stage === null ? null : `promotion aborted at the ${stage} gate`;
};

// ---------------------------------------------------------------------------
// The chain factory

function validateOptions(deps: PromoteStudyDeps, options: PromoteStudyOptions): void {
  const badOption = (detail: string): never => {
    throw new AgentsError("BAD_PROMOTION_OPTIONS", `promoteStudy: ${detail}`);
  };
  if (typeof deps !== "object" || deps === null) badOption("deps must be an object");
  for (const key of ["resolveSegment", "applySelections", "runAnalysis", "persistNote"] as const) {
    if (typeof deps[key] !== "function") badOption(`deps.${key} must be a function`);
  }
  if (!Number.isFinite(options.toleranceCeiling) || options.toleranceCeiling <= 0) {
    badOption(`toleranceCeiling must be a positive finite number; got ${options.toleranceCeiling}`);
  }
  if (typeof options.now !== "function") badOption("now must be a function returning an ISO timestamp");
  if (options.strictness !== undefined && options.strictness !== "warn" && options.strictness !== "refuse") {
    badOption(`strictness must be "warn" or "refuse"; got ${JSON.stringify(options.strictness)}`);
  }
}

/**
 * Builds the promotion judgment chain for one study. SYNCHRONOUS by design
 * (see the accidental-thenable footgun in the module doc): assign the return
 * value and register it on a Mastra instance, exactly like any
 * createJudgmentChain workflow; then createRun/start/resume drive the gates.
 *
 * Reconstruction contract: promoteStudy(deps, studyDoc, options) is
 * deterministic given the study document and deps.resolveSegment, so a host
 * resuming a snapshot after a restart rebuilds the identical chain.
 */
export function promoteStudy(
  deps: PromoteStudyDeps,
  studyDoc: unknown,
  options: PromoteStudyOptions,
): JudgmentChainWorkflow {
  validateOptions(deps, options);
  const intake = computeIntake(deps, studyDoc, options);
  const ctx = intake.ok ? intake.ctx : null;

  /** Gates 2-4 run only after Gate 1 succeeded, which requires intake.ok. */
  const requireCtx = (): PromotionContext => {
    if (ctx === null) {
      throw intake.ok ? new Error("unreachable") : intake.error;
    }
    return ctx;
  };

  const intakeGate: JudgmentGateSpec<AcceptAbortDecision> = {
    id: "study-intake",
    stage: "study-intake",
    resumeSchema: z.object({
      decision: z.enum(["accept", "abort"]),
      rationale: nonBlankString,
      actor: actorField,
    }),
    gatherEvidence: () => {
      const context = requireCtx(); // intake failures surface HERE, as a gate failure
      const evidence = intakeEvidenceOf(context);
      const tolerance = context.tolerance;
      const flag = tolerance.exceedsTenTimesProfileDefault
        ? ` WARNING: the stated tolerance exceeds 10x the ${tolerance.profileId} profile default (${tolerance.profileDefault}).`
        : "";
      const review = reviewSummaryText(context.dataReview);
      const hasFailures = context.dataReview.some((entry) => entry.report.summary.fail > 0);
      return {
        recommendation:
          `Replay tolerance: stated ${tolerance.stated ?? "(none)"}, host ceiling ${tolerance.ceiling}, ` +
          `effective ${tolerance.effective}.${flag} Data review: ${review}. ` +
          `${context.units.length} selection(s) resolved to segment target(s) ` +
          `[${context.units.map((u) => u.target).join(", ")}]. ` +
          (hasFailures
            ? "The data review found failing checks; recommend abort unless the findings are explainable."
            : "Intake checks passed; accept to proceed to replay verification."),
        evidence,
      };
    },
    applyDecision: async (_gateCtx, decision) => ({
      summary:
        decision.decision === "abort"
          ? "promotion aborted at study intake"
          : "study accepted for promotion",
    }),
  };

  // The Gate 2 hard-block is STRUCTURAL: on any "disagree" referee verdict
  // the resume schema admits only { decision: "abort" } - Mastra's own
  // resume validation rejects an accept, and because intake is recomputed
  // deterministically on reconstruction, the block survives restarts.
  const replayDecisionSchema = ctx?.hardBlocked
    ? z.literal("abort")
    : z.enum(["accept", "abort"]);
  const replayGate: JudgmentGateSpec<AcceptAbortDecision> = {
    id: "replay-verify",
    stage: "replay-verify",
    resumeSchema: z.object({
      decision: replayDecisionSchema,
      rationale: nonBlankString,
      actor: actorField,
    }) as z.ZodType<AcceptAbortDecision>,
    skipWhen: skipWhenAborted,
    gatherEvidence: () => {
      const context = requireCtx();
      const evidence = replayEvidenceOf(context);
      const valueOnlyCount = evidence.replays.filter((r) => r.verifiedByValueOnly).length;
      return {
        recommendation: evidence.hardBlocked
          ? "UNACCEPTABLE: a supporting result DISAGREES with the replay at the effective " +
            `tolerance ${evidence.effectiveTolerance}. The gate cannot accept this study; abort ` +
            "and fix it upstream (spec 6: tolerance editing is not an escape hatch)."
          : `${evidence.replays.length} selection(s) verified at tolerance ${evidence.effectiveTolerance}` +
            (valueOnlyCount > 0
              ? `; ${valueOnlyCount} verified by value only (no independent recomputation)`
              : "") +
            `. ${evidence.verification} Accept to proceed to the rationale gate.`,
        evidence,
      };
    },
    applyDecision: async (_gateCtx, decision) => ({
      summary:
        decision.decision === "abort"
          ? "promotion aborted at replay verification"
          : `replay verification accepted (${requireCtx().units.length} selection(s), tolerance ${
              requireCtx().tolerance.effective
            })`,
    }),
  };

  const rationaleGate: JudgmentGateSpec<RationaleDecision> = {
    id: "rationale",
    stage: "rationale",
    resumeSchema: z.object({
      decision: z.enum(["approve", "abort"]),
      rationale: nonBlankString,
      attestation: nonBlankString,
      actor: actorField,
    }),
    skipWhen: skipWhenAborted,
    gatherEvidence: async () => {
      const context = requireCtx();
      const draftCtx: DraftRationaleContext = {
        study: context.study,
        studyIntegrity: context.studyIntegrity,
        intake: intakeEvidenceOf(context),
        replay: replayEvidenceOf(context),
      };
      const draft = await (options.draftRationale ?? defaultDraftRationale)(draftCtx);
      const witnessedResults = witnessedResultsOf(context.study);
      const evidence: RationaleEvidence = {
        draftRationale: draft,
        attestationRequired: true,
        study: {
          title: context.study.title,
          sourceRef: context.study.narrative.sourceRef ?? null,
          analyst: context.study.narrative.analyst ?? null,
        },
        witnessedResults,
      };
      // Disclosed, never silently blocked: the actuary decides whether a
      // non-reproducible result is acceptable support, but they must be told
      // it is one before their attestation is written to the ledger.
      const witnessedNotice =
        witnessedResults.length === 0
          ? ""
          : ` ATTENTION: ${witnessedResults.length} supporting result(s) are WITNESSED, not ` +
            `reproducible — ${witnessedResults
              .map((w) => {
                const drift =
                  w.stability === null
                    ? "no stability check was run"
                    : w.stability.byteIdentical
                      ? `${w.stability.repeats} repeat runs agreed exactly`
                      : `repeat runs DIFFERED (max relative deviation ${w.stability.maxRelativeDeviation ?? "unreported"})`;
                return `${w.method} on ${w.engine} (${drift})`;
              })
              .join("; ")}. Re-running these will not reproduce the numbers this study relies on. ` +
            "Your attestation covers relying on them (spec 16).";
      return {
        recommendation:
          "Review and edit the draft rationale; the final text you resume with is recorded " +
          "verbatim in the assumption ledger. An attestation (who authored/reviewed the " +
          "rationale) is required." +
          witnessedNotice,
        evidence,
      };
    },
    applyDecision: async (_gateCtx, decision) => ({
      summary:
        decision.decision === "abort"
          ? "promotion aborted at the rationale gate"
          : "rationale approved (attestation on file)",
    }),
  };

  const analysisLabelOf = (context: PromotionContext): string =>
    `Study promotion - ${context.study.title}`;
  const ledgerSourceOf = (context: PromotionContext): string =>
    `${context.study.narrative.sourceRef ?? context.study.title} ` +
    `(study ${context.studyIntegrity}, tolerance ${context.tolerance.effective})`;

  const applyGate: JudgmentGateSpec<ApplyDecision> = {
    id: "apply",
    stage: "apply",
    resumeSchema: z.object({
      decision: z.enum(["apply", "abort"]),
      rationale: nonBlankString,
      actor: actorField,
    }),
    skipWhen: skipWhenAborted,
    gatherEvidence: () => {
      const context = requireCtx();
      const evidence: ApplyEvidence = {
        applications: context.units.map((u) => ({
          segmentTarget: u.target,
          selectionIntegrity: u.selectionDoc.integrity,
          developmentCount: u.selectionDoc.selection.development.length,
          tailFactor: u.selectionDoc.selection.tail?.value ?? 1,
        })),
        analysisLabel: analysisLabelOf(context),
        ledgerSource: ledgerSourceOf(context),
      };
      return {
        recommendation:
          `Apply ${evidence.applications.length} selection(s) to ` +
          `[${evidence.applications.map((a) => a.segmentTarget).join(", ")}], rerun the analysis, ` +
          "and record the ledger entries. This mutates host state.",
        evidence,
      };
    },
    applyDecision: async (gateCtx, decision) => {
      if (decision.decision === "abort") {
        return { summary: "promotion aborted at the apply gate" };
      }
      const context = requireCtx();
      const approval = gateCtx.decisions["rationale"] as RationaleDecision | undefined;
      if (approval === undefined || approval.decision !== "approve") {
        throw new AgentsError(
          "MISSING_RATIONALE",
          "The apply gate ran without an approved rationale gate decision; the ledger records " +
            "the rationale-gate text verbatim and cannot proceed without it",
        );
      }
      const actor = approval.actor ?? options.actorDefault ?? "actuary";
      const ledgerActor = toAssumptionActor(actor);
      const source = ledgerSourceOf(context);

      for (const unit of context.units) {
        await deps.applySelections(unit.selectionDoc, unit.replayed.selections, unit.target);
      }
      await deps.runAnalysis(analysisLabelOf(context));

      const ledgerEntries: JudgmentLedgerEntry[] = context.units.map((unit) => ({
        field: `selections.${unit.target}`,
        value: {
          development: unit.selectionDoc.selection.development.map((d) => ({
            fromAgeMonths: d.fromAgeMonths,
            toAgeMonths: d.toAgeMonths,
            value: d.value,
          })),
          tailFactor: unit.selectionDoc.selection.tail?.value ?? 1,
        },
        source,
        rationale: approval.rationale, // Gate 3's final text, verbatim
        actor: ledgerActor,
      }));
      // The attestation entry's value carries BOTH strings verbatim: the
      // attestation itself (spec 8: lands in the ledger) and the RAW actor
      // identity, which the entry-level `actor` collapses to the coarse
      // compliance enum (see toAssumptionActor).
      ledgerEntries.push({
        field: "promotion.attestation",
        value: { attestation: approval.attestation, actor },
        source,
        rationale: approval.rationale,
        actor: ledgerActor,
      });
      return {
        summary: `applied ${context.units.length} selection(s) to [${context.units
          .map((u) => u.target)
          .join(", ")}]`,
        ledgerEntries,
      };
    },
  };

  return createJudgmentChain({
    id: PROMOTION_CHAIN_ID,
    gates: [intakeGate, replayGate, rationaleGate, applyGate],
    now: options.now,
    onComplete: async (outcome, chainCtx) => {
      // Persist the trail + ledger JSON exactly like the server's ELR chain,
      // but only when the promotion actually applied (aborted chains complete
      // with their trail and an empty ledger; nothing to persist).
      const applied = chainCtx.decisions["apply"] as ApplyDecision | undefined;
      if (applied?.decision !== "apply") return;
      const approval = chainCtx.decisions["rationale"] as RationaleDecision | undefined;
      const author = approval?.actor ?? options.actorDefault ?? "actuary";
      await deps.persistNote(
        `Study promotion trail:\n${outcome.trail
          .map((t) => `- ${t.stage}: ${t.decision}${t.rationale ? ` - ${t.rationale}` : ""}`)
          .join("\n")}`,
        author,
      );
      await deps.persistNote(
        `Study promotion assumption ledger:\n${JSON.stringify(
          { entries: outcome.ledger.entries },
          null,
          2,
        )}`,
        author,
      );
    },
  });
}
