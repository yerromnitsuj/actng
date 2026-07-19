/**
 * Judgment gates that write the compliance ledger: the generalization of the
 * ActNG server's derive-expected-losses workflow (cap -> restoration ->
 * trends -> ELR) into a factory any host can point at its own gate list.
 *
 * The loop each gate enforces is propose -> justify -> approve -> record:
 * the gate gathers evidence and SUSPENDS with a recommendation; a human
 * decides; the resume payload carries the decision plus a VERBATIM rationale;
 * the gate applies the decision and appends the resulting assumptions to an
 * @actuarial-ts/compliance ledger threaded through the workflow state. A
 * completed chain returns { trail, ledger } - a ledger ready to hand straight
 * to generateDisclosure, so ASOP 41 documentation falls out of running the
 * analysis instead of being reconstructed afterwards.
 *
 * Ground truth (verified against @mastra/core 1.49 dist types and a live
 * suspend/resume probe):
 * - Steps execute as ({ inputData, resumeData, suspend, requestContext });
 *   suspend(payload) pauses the run with the payload surfaced under
 *   result.steps[stepId].suspendPayload; run.resume({ step, resumeData,
 *   requestContext }) re-executes the step with resumeData set.
 * - Resume data is validated against the gate's resumeSchema by Mastra
 *   itself; run.resume REJECTS on schema violations. The chain additionally
 *   rejects blank rationales at runtime (AgentsError MISSING_RATIONALE), so a
 *   host schema of plain z.string() cannot smuggle undocumented judgment.
 * - Suspend/resume requires snapshot storage: hosts register the returned
 *   workflow on their Mastra instance (new Mastra({ workflows: { chain } })),
 *   which provides in-memory storage by default and durable storage when
 *   configured - exactly how the server keeps paused derivations resumable
 *   across restarts.
 *
 * Purity: the package never reads a clock. The host supplies now() and every
 * ledger timestamp comes from it.
 *
 * Tenant seam: the tenant id travels in the workflow requestContext, never in
 * step inputs - the same boundary as every actuarial tool.
 */

import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  createLedger,
  recordAssumption,
  type AssumptionActor,
  type AssumptionEntry,
  type AssumptionLedger,
  type JsonValue,
} from "@actuarial-ts/compliance";
import { AgentsError } from "./errors.js";
import { zodObjectShape } from "./tools.js";

// ---------------------------------------------------------------------------
// Public types

/**
 * The request-context key a host sets (server-side, from its authenticated
 * session — the same trust path as the tenant id) to identify WHO is resuming
 * gates. The resume payload cannot supply it: a payload travels through
 * model-reachable surfaces, and an identity that can be asserted from there
 * is a claim, not a record.
 */
export const ACTOR_IDENTITY_CONTEXT_KEY = "actorIdentity";

/** One decision in the audit trail; skip gates record skipped: true. */
export interface JudgmentTrailEntry {
  stage: string;
  decision: string;
  rationale: string;
  skipped: boolean;
  /** Coarse classification from the resume payload (default | actuary | agent). */
  actor?: AssumptionActor;
  /**
   * The authenticated identity from the request context, when the host set
   * one. Absent means the host supplied none — identity is never invented,
   * and never read from the resume payload.
   */
  actorIdentity?: string;
}

/**
 * What earlier gates decided, keyed by gate id: the validated resume payload
 * for decided gates, or { skipped: true, reason } for self-skipped ones.
 * Available to skipWhen/gatherEvidence/applyDecision so a later gate can
 * self-skip on an earlier decision (the server's ilf gate skips when the cap
 * gate chose to stay unlimited).
 */
export type JudgmentDecisions = Record<string, unknown>;

/** Marker recorded into the decisions map when a gate self-skips. */
export interface JudgmentSkipRecord {
  skipped: true;
  reason: string;
}

/** The context every gate hook receives. */
export interface JudgmentGateContext {
  /** The workflow request context (tenant id lives here, never in inputs). */
  requestContext: { get(key: string): unknown };
  /** Host-injected clock; the source of every ledger timestamp. */
  now: () => string;
  /** Decisions from earlier gates, keyed by gate id. */
  decisions: JudgmentDecisions;
  /** The trail accumulated so far. */
  trail: readonly JudgmentTrailEntry[];
}

/**
 * A ledger entry as a gate's applyDecision returns it: timestamp, actor, and
 * rationale may be omitted - the chain fills timestamp from ctx.now(), actor
 * from the resume payload's optional actor field (default "actuary"), and
 * rationale from the decision's verbatim rationale.
 */
export interface JudgmentLedgerEntry {
  /** Dotted assumption path, e.g. "layer.cap". */
  field: string;
  value: JsonValue;
  previousValue?: JsonValue;
  source?: string;
  rationale?: string;
  timestamp?: string;
  actor?: AssumptionActor;
}

/** What applyDecision hands back to the chain. */
export interface JudgmentApplication {
  /** Assumptions this decision fixed; appended to the threaded ledger. */
  ledgerEntries?: JudgmentLedgerEntry[];
  /** Human-readable decision text for the trail; derived from the payload when omitted. */
  summary?: string;
}

/**
 * One human judgment gate. TDecision is the validated resume payload shape;
 * its schema MUST declare a rationale key (createJudgmentChain rejects the
 * spec otherwise) and SHOULD make it a non-empty string - either way the
 * chain rejects blank rationales at runtime.
 */
export interface JudgmentGateSpec<TDecision = unknown> {
  /** Step id; also the resume target (run.resume({ step: id, ... })). */
  id: string;
  /** Stage label surfaced in the suspend payload and the trail. */
  stage: string;
  /** Validates the resume payload. Must contain a rationale key. */
  resumeSchema: z.ZodType<TDecision>;
  /**
   * Returns the skip reason when the gate should pass through without a
   * human decision (e.g. a later gate made moot by an earlier decision),
   * null to proceed. A skipped gate records a trail note and never suspends.
   */
  skipWhen?: (ctx: JudgmentGateContext) => string | null;
  /** Gathers the evidence and recommendation the gate suspends with. */
  gatherEvidence: (
    ctx: JudgmentGateContext,
  ) => Promise<{ recommendation: string; evidence: unknown }> | { recommendation: string; evidence: unknown };
  /** Applies the human decision through the host's service layer. */
  applyDecision: (ctx: JudgmentGateContext, decision: TDecision) => Promise<JudgmentApplication>;
}

/** The completed chain's output: the audit trail and the fused compliance ledger. */
export interface JudgmentChainOutcome {
  trail: JudgmentTrailEntry[];
  /** Ready for @actuarial-ts/compliance generateDisclosure. */
  ledger: AssumptionLedger;
}

export interface CreateJudgmentChainOptions {
  /** Workflow id. */
  id: string;
  /** The gates, in order. Must be non-empty with unique ids. */
  gates: readonly JudgmentGateSpec<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any -- heterogeneous decision types; each gate stays internally typed
  /**
   * Host-injected clock for ledger timestamps (purity: this package never
   * reads Date). Return an ISO-8601 string.
   */
  now: () => string;
  /** Runs once after the last gate, before the chain returns its outcome. */
  onComplete?: (
    outcome: JudgmentChainOutcome,
    ctx: JudgmentGateContext,
  ) => Promise<void> | void;
  /** Optional request-context validation (e.g. z.object({ projectId: z.string() })). */
  requestContextSchema?: z.ZodTypeAny;
}

// ---------------------------------------------------------------------------
// Chain state threaded through step outputs

// Declares EVERY JudgmentTrailEntry field: zod strips undeclared keys on the
// step-output parse, so an undeclared field here is silently erased between
// gates (the ledger schema below carries the same warning for the same reason).
const trailEntrySchema = z.object({
  stage: z.string(),
  decision: z.string(),
  rationale: z.string(),
  skipped: z.boolean(),
  actor: z.enum(["default", "actuary", "agent"]).optional(),
  actorIdentity: z.string().optional(),
});

// Declares EVERY AssumptionEntry field: zod strips undeclared keys on parse,
// and losing previousValue/source between steps would corrupt the ledger.
const ledgerEntrySchema = z.object({
  seq: z.number().int().positive(),
  timestamp: z.string(),
  actor: z.enum(["default", "actuary", "agent"]),
  field: z.string(),
  value: z.unknown(),
  previousValue: z.unknown().optional(),
  source: z.string().optional(),
  rationale: z.string().optional(),
});

const chainStateSchema = z.object({
  trail: z.array(trailEntrySchema).default([]),
  ledgerEntries: z.array(ledgerEntrySchema).default([]),
  decisions: z.record(z.unknown()).default({}),
});

const suspendSchema = z.object({
  stage: z.string(),
  recommendation: z.string(),
  evidence: z.unknown(),
});

const chainInputSchema = z.object({});
const chainResultSchema = z.object({
  trail: z.array(trailEntrySchema),
  ledger: z.custom<AssumptionLedger>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      Array.isArray((value as { entries?: unknown }).entries),
  ),
});

interface ChainState {
  trail: JudgmentTrailEntry[];
  ledgerEntries: AssumptionEntry[];
  decisions: JudgmentDecisions;
}

/**
 * The first gate receives the workflow input ({}), and snapshot storage may
 * round-trip state through JSON, so normalize defensively instead of trusting
 * zod defaults to have been applied.
 */
function normalizeState(input: unknown): ChainState {
  const raw = (input ?? {}) as Partial<ChainState>;
  return {
    trail: Array.isArray(raw.trail) ? raw.trail : [],
    ledgerEntries: Array.isArray(raw.ledgerEntries) ? raw.ledgerEntries : [],
    decisions:
      typeof raw.decisions === "object" && raw.decisions !== null ? raw.decisions : {},
  };
}

/** Trail text for a decision when applyDecision returns no summary. */
function describeDecision(decision: unknown): string {
  if (typeof decision === "object" && decision !== null) {
    const named = (decision as { decision?: unknown }).decision;
    if (typeof named === "string" && named.length > 0) return named;
    const { rationale: _rationale, actor: _actor, ...rest } = decision as Record<string, unknown>;
    if (Object.keys(rest).length > 0) return JSON.stringify(rest);
  }
  return "decided";
}

function actorOf(decision: unknown): AssumptionActor {
  const actor = (decision as { actor?: unknown } | null | undefined)?.actor;
  return actor === "agent" || actor === "default" || actor === "actuary" ? actor : "actuary";
}

// ---------------------------------------------------------------------------
// Factory

/** Reserved id of the terminal step that assembles { trail, ledger }. */
const COMPLETE_STEP_ID = "complete";

/**
 * The committed workflow type hosts receive: register it on a Mastra instance
 * for snapshot storage, then createRun/start/resume exactly like any Mastra
 * workflow. (Instantiation expression pins the concrete schema generics; the
 * step list is dynamic, so the per-step chain typing is erased - see the cast
 * at the bottom of createJudgmentChain.)
 */
export type JudgmentChainWorkflow = ReturnType<
  typeof createWorkflow<string, typeof chainInputSchema, typeof chainResultSchema>
>;

/**
 * Builds a committed Mastra workflow from an ordered gate list. Each gate:
 * skipWhen? -> pass through with a trail note; else gatherEvidence ->
 * suspend({ stage, recommendation, evidence }); on resume -> validate the
 * decision (schema + non-blank rationale), applyDecision, append the
 * resulting assumptions to the threaded ledger. The terminal step rebuilds
 * the frozen ledger, invokes onComplete, and returns { trail, ledger }.
 *
 * FOOTGUN (learned the hard way): a Mastra Workflow exposes a .then(step)
 * builder method, which makes it an ACCIDENTAL THENABLE. Never await the
 * returned workflow and never return it from an async function - JS will
 * call .then(resolve, reject) with the promise resolver as a "step" and the
 * promise never settles. Assign it synchronously and register it on your
 * Mastra instance.
 */
export function createJudgmentChain(options: CreateJudgmentChainOptions): JudgmentChainWorkflow {
  const { id, gates, now, onComplete, requestContextSchema } = options;

  if (gates.length === 0) {
    throw new AgentsError("BAD_GATE", `Judgment chain "${id}" needs at least one gate`);
  }
  const seen = new Set<string>();
  for (const gate of gates) {
    if (gate.id === COMPLETE_STEP_ID) {
      throw new AgentsError(
        "BAD_GATE",
        `Gate id "${COMPLETE_STEP_ID}" is reserved for the chain's terminal step`,
      );
    }
    if (seen.has(gate.id)) {
      throw new AgentsError("BAD_GATE", `Duplicate gate id "${gate.id}" in chain "${id}"`);
    }
    seen.add(gate.id);
    const shape = zodObjectShape(gate.resumeSchema);
    if (!shape || !("rationale" in shape)) {
      throw new AgentsError(
        "BAD_GATE",
        `Gate "${gate.id}" resumeSchema must be a zod object containing a "rationale" key: every human decision enters the audit trail with its verbatim rationale`,
      );
    }
  }

  const gateSteps = gates.map((gate) =>
    createStep({
      id: gate.id,
      inputSchema: chainStateSchema,
      outputSchema: chainStateSchema,
      suspendSchema,
      resumeSchema: gate.resumeSchema,
      execute: async ({ inputData, resumeData, suspend, requestContext }) => {
        const state = normalizeState(inputData);
        const ctx: JudgmentGateContext = {
          requestContext,
          now,
          decisions: state.decisions,
          trail: state.trail,
        };

        const skipReason = gate.skipWhen?.(ctx) ?? null;
        if (skipReason !== null) {
          const skip: JudgmentSkipRecord = { skipped: true, reason: skipReason };
          return {
            trail: [
              ...state.trail,
              { stage: gate.stage, decision: "skipped", rationale: skipReason, skipped: true },
            ],
            ledgerEntries: state.ledgerEntries,
            decisions: { ...state.decisions, [gate.id]: skip },
          };
        }

        if (resumeData === undefined) {
          const { recommendation, evidence } = await gate.gatherEvidence(ctx);
          await suspend({ stage: gate.stage, recommendation, evidence });
          return state; // unreachable after suspend; satisfies the output type
        }

        const decision = resumeData;
        const rationale = (decision as { rationale?: unknown } | null)?.rationale;
        if (typeof rationale !== "string" || rationale.trim() === "") {
          throw new AgentsError(
            "MISSING_RATIONALE",
            `Gate "${gate.id}" (${gate.stage}) resumed without a rationale; undocumented judgment is exactly what the ledger exists to prevent`,
          );
        }
        const actor = actorOf(decision);
        // WHO decided comes from the server-set context, never the payload:
        // the payload's job is the decision and its coarse classification.
        const rawIdentity = requestContext?.get(ACTOR_IDENTITY_CONTEXT_KEY);
        const actorIdentity =
          typeof rawIdentity === "string" && rawIdentity.length > 0 ? rawIdentity : undefined;

        const applied = await gate.applyDecision(ctx, decision);

        // recordAssumption is the single validator/freezer: replay the
        // threaded entries into a ledger, append, and thread the plain
        // entries array (snapshot storage may JSON round-trip state).
        let ledger: AssumptionLedger = { entries: state.ledgerEntries };
        for (const entry of applied.ledgerEntries ?? []) {
          ledger = recordAssumption(ledger, {
            field: entry.field,
            value: entry.value,
            ...(entry.previousValue !== undefined ? { previousValue: entry.previousValue } : {}),
            ...(entry.source !== undefined ? { source: entry.source } : {}),
            timestamp: entry.timestamp ?? now(),
            actor: entry.actor ?? actor,
            rationale: entry.rationale ?? rationale,
          });
        }

        return {
          trail: [
            ...state.trail,
            {
              actor,
              ...(actorIdentity !== undefined ? { actorIdentity } : {}),
              stage: gate.stage,
              decision: applied.summary ?? describeDecision(decision),
              rationale,
              skipped: false,
            },
          ],
          ledgerEntries: [...ledger.entries],
          decisions: { ...state.decisions, [gate.id]: decision },
        };
      },
    }),
  );

  const completeStep = createStep({
    id: COMPLETE_STEP_ID,
    inputSchema: chainStateSchema,
    outputSchema: chainResultSchema,
    execute: async ({ inputData, requestContext }) => {
      const state = normalizeState(inputData);
      // Rebuild through recordAssumption so the returned ledger is frozen and
      // seq-consistent even after a JSON round-trip through snapshot storage.
      let ledger = createLedger();
      for (const entry of state.ledgerEntries) {
        const { seq: _seq, ...fresh } = entry;
        ledger = recordAssumption(ledger, fresh);
      }
      const outcome: JudgmentChainOutcome = { trail: state.trail, ledger };
      await onComplete?.(outcome, {
        requestContext,
        now,
        decisions: state.decisions,
        trail: state.trail,
      });
      return outcome;
    },
  });

  // The gate list is dynamic, so the step-by-step generic threading
  // createWorkflow's .then() performs cannot be expressed statically; every
  // gate shares the chain-state schema, so runtime shapes stay checked and
  // the cast is confined to this builder.
  interface ChainBuilder {
    then(step: unknown): ChainBuilder;
    commit(): unknown;
  }
  let builder = createWorkflow({
    id,
    inputSchema: chainInputSchema,
    outputSchema: chainResultSchema,
    ...(requestContextSchema ? { requestContextSchema } : {}),
  }) as unknown as ChainBuilder;
  for (const step of gateSteps) builder = builder.then(step);
  return builder.then(completeStep).commit() as JudgmentChainWorkflow;
}
