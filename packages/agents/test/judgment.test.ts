import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { AgentsError } from "../src/errors.js";
import {
  createJudgmentChain,
  type JudgmentChainOutcome,
  type JudgmentGateSpec,
  type JudgmentSkipRecord,
} from "../src/judgment.js";
import type { JudgmentTrailEntry } from "../src/judgment.js";

/**
 * Programmatic suspend/resume runs, no LLM: the same pattern as the server's
 * derive-expected-losses workflow integration test. The chain is registered
 * on a bare Mastra instance, whose default in-memory storage backs the
 * workflow-run snapshots resume needs.
 */

/** Deterministic host clock: t1, t2, ... (purity: the package never reads Date). */
function tickingNow() {
  let tick = 0;
  return () => `2026-07-17T00:00:0${++tick}Z`;
}

function runContext(projectId: string) {
  // Untyped on purpose: the chain factory erases the request-context generic
  // (dynamic gate lists), so runs take a RequestContext<unknown>.
  const requestContext = new RequestContext();
  requestContext.set("projectId", projectId);
  return requestContext;
}

type SuspendedResult = {
  status: string;
  suspended?: string[][];
  steps?: Record<string, { suspendPayload?: { stage?: string; recommendation?: string; evidence?: unknown } }>;
  result?: JudgmentChainOutcome;
  error?: unknown;
};

function capGate(applied: unknown[]): JudgmentGateSpec<{
  decision: "accept" | "skip";
  cap?: number;
  rationale: string;
  actor?: "actuary" | "agent";
}> {
  return {
    id: "cap-gate",
    stage: "cap",
    resumeSchema: z.object({
      decision: z.enum(["accept", "skip"]),
      cap: z.number().positive().optional(),
      rationale: z.string(),
      actor: z.enum(["actuary", "agent"]).optional(),
    }),
    gatherEvidence: () => ({
      recommendation: "Cap at 150,000 per occurrence",
      evidence: { candidates: [150_000, 250_000] },
    }),
    applyDecision: async (_ctx, decision) => {
      applied.push(decision);
      if (decision.decision === "skip") return { summary: "stay unlimited" };
      return {
        summary: `capped at ${decision.cap}`,
        ledgerEntries: [{ field: "layer.cap", value: decision.cap ?? null, source: "cap gate" }],
      };
    },
  };
}

function elrGate(): JudgmentGateSpec<{ decision: "accept"; selected: number; rationale: string }> {
  return {
    id: "elr-gate",
    stage: "elr",
    resumeSchema: z.object({
      decision: z.literal("accept"),
      selected: z.number().positive(),
      rationale: z.string(),
    }),
    // Echo the prior decisions into the evidence so the test can assert
    // earlier gates' decisions are visible to later gatherEvidence.
    gatherEvidence: (ctx) => ({
      recommendation: "Anchor on the weighted average",
      evidence: { priorDecisions: ctx.decisions },
    }),
    applyDecision: async (_ctx, decision) => ({
      summary: `selected ELR ${decision.selected}`,
      ledgerEntries: [{ field: "elr.selected", value: decision.selected }],
    }),
  };
}

/**
 * Deliberately synchronous: a Mastra Workflow exposes a .then(step) builder
 * method, which makes it an accidental thenable - awaiting one (or returning
 * one from an async function) calls .then(resolve, reject) with the promise
 * resolver as a "step" and never settles. See the createJudgmentChain docs.
 */
function register(chain: ReturnType<typeof createJudgmentChain>) {
  const mastra = new Mastra({ workflows: { chain } });
  return mastra.getWorkflow("chain");
}

describe("createJudgmentChain", () => {
  it("records the AUTHENTICATED actor identity from the request context, not the payload", async () => {
    // The coarse enum (default | actuary | agent) stays payload-supplied — it
    // is a classification, not a claim of identity. WHO decided comes from the
    // same server-set context as the tenant: the resume payload cannot assert
    // it, and a payload that tries changes nothing.
    const chain = createJudgmentChain({
      id: "identity-chain",
      gates: [capGate([])],
      now: tickingNow(),
      requestContextSchema: z.object({ projectId: z.string() }),
    });
    const workflow = register(chain);
    const requestContext = runContext("p-1");
    requestContext.set("actorIdentity", "jane.actuary@example.com (SSO)");
    const run = await workflow.createRun();

    await run.start({ inputData: {}, requestContext });
    const result = (await run.resume({
      step: "cap-gate",
      resumeData: {
        decision: "accept",
        cap: 150_000,
        rationale: "documented",
        actor: "actuary",
        // An identity claim in the MODEL-REACHABLE payload must be ignored.
        actorIdentity: "the.ceo@example.com",
      },
      requestContext,
    })) as SuspendedResult;
    expect(result.status).toBe("success");

    const trail: JudgmentTrailEntry[] = result.result!.trail;
    expect(trail[0]!.actor).toBe("actuary");
    expect(trail[0]!.actorIdentity).toBe("jane.actuary@example.com (SSO)");
  });

  it("omits actorIdentity when the host sets none (identity is never invented)", async () => {
    const chain = createJudgmentChain({
      id: "no-identity-chain",
      gates: [capGate([])],
      now: tickingNow(),
      requestContextSchema: z.object({ projectId: z.string() }),
    });
    const workflow = register(chain);
    const requestContext = runContext("p-1");
    const run = await workflow.createRun();
    await run.start({ inputData: {}, requestContext });
    const result = (await run.resume({
      step: "cap-gate",
      resumeData: { decision: "accept", cap: 150_000, rationale: "documented" },
      requestContext,
    })) as SuspendedResult;
    const trail: JudgmentTrailEntry[] = result.result!.trail;
    expect(trail[0]!.actorIdentity).toBeUndefined();
  });

  it("suspends at each gate, records rationale/actor/timestamp into the ledger, and completes with { trail, ledger }", async () => {
    const applied: unknown[] = [];
    const onComplete = vi.fn();
    const chain = createJudgmentChain({
      id: "elr-derivation",
      gates: [capGate(applied), elrGate()],
      now: tickingNow(),
      onComplete,
      requestContextSchema: z.object({ projectId: z.string() }),
    });
    const workflow = register(chain);
    const requestContext = runContext("p-1");
    const run = await workflow.createRun();

    // Gate 1 suspends with the recommendation and evidence.
    let result = (await run.start({ inputData: {}, requestContext })) as SuspendedResult;
    expect(result.status).toBe("suspended");
    expect(result.suspended![0]![0]).toBe("cap-gate");
    const capPayload = result.steps!["cap-gate"]!.suspendPayload!;
    expect(capPayload.stage).toBe("cap");
    expect(capPayload.recommendation).toContain("150,000");
    expect(capPayload.evidence).toEqual({ candidates: [150_000, 250_000] });

    // Resume gate 1 (agent actor) -> gate 2 suspends and can see gate 1's decision.
    result = (await run.resume({
      step: "cap-gate",
      resumeData: {
        decision: "accept",
        cap: 150_000,
        rationale: "volatile large losses distort development",
        actor: "agent",
      },
      requestContext,
    })) as SuspendedResult;
    expect(result.status).toBe("suspended");
    expect(result.suspended![0]![0]).toBe("elr-gate");
    const elrPayload = result.steps!["elr-gate"]!.suspendPayload!;
    expect(elrPayload.stage).toBe("elr");
    expect(
      (elrPayload.evidence as { priorDecisions: Record<string, { decision?: string }> })
        .priorDecisions["cap-gate"]!.decision,
    ).toBe("accept");

    // Resume gate 2 (default actor) -> success with the fused outcome.
    result = (await run.resume({
      step: "elr-gate",
      resumeData: { decision: "accept", selected: 0.65, rationale: "weighted average" },
      requestContext,
    })) as SuspendedResult;
    expect(result.status).toBe("success");

    const outcome = result.result!;
    expect(outcome.trail).toEqual([
      {
        stage: "cap",
        decision: "capped at 150000",
        rationale: "volatile large losses distort development",
        skipped: false,
        actor: "agent",
      },
      {
        stage: "elr",
        decision: "selected ELR 0.65",
        rationale: "weighted average",
        skipped: false,
        actor: "actuary", // payload named none; the coarse default
      },
    ]);
    expect(outcome.ledger.entries).toHaveLength(2);
    const [capEntry, elrEntry] = outcome.ledger.entries;
    expect(capEntry).toMatchObject({
      seq: 1,
      field: "layer.cap",
      value: 150_000,
      actor: "agent", // from the resume payload's actor field
      rationale: "volatile large losses distort development", // verbatim
      timestamp: "2026-07-17T00:00:01Z", // from the injected now()
      source: "cap gate",
    });
    expect(elrEntry).toMatchObject({
      seq: 2,
      field: "elr.selected",
      value: 0.65,
      actor: "actuary", // default when the payload names no actor
      rationale: "weighted average",
      timestamp: "2026-07-17T00:00:02Z",
    });

    // applyDecision received the validated payload; onComplete saw the outcome.
    expect(applied).toEqual([
      {
        decision: "accept",
        cap: 150_000,
        rationale: "volatile large losses distort development",
        actor: "agent",
      },
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    const [completedOutcome, completedCtx] = onComplete.mock.calls[0]!;
    expect(completedOutcome.trail).toHaveLength(2);
    expect(completedOutcome.ledger.entries).toHaveLength(2);
    expect(completedCtx.requestContext.get("projectId")).toBe("p-1");
  }, 30_000);

  it("self-skips a gate off an earlier gate's decision, recording a skip note (the server's 4-gate ilf shape)", async () => {
    const applied: unknown[] = [];
    const ilfGate: JudgmentGateSpec<{ decision: "accept"; rationale: string }> = {
      id: "ilf-gate",
      stage: "ilf",
      resumeSchema: z.object({ decision: z.literal("accept"), rationale: z.string() }),
      skipWhen: (ctx) =>
        (ctx.decisions["cap-gate"] as { decision?: string } | undefined)?.decision === "skip"
          ? "unlimited layer: nothing to restore"
          : null,
      gatherEvidence: () => ({ recommendation: "Restore via fitted curve", evidence: null }),
      applyDecision: async () => ({ ledgerEntries: [{ field: "ilf.source", value: "fitted" }] }),
    };
    const chain = createJudgmentChain({
      id: "elr-derivation-skip",
      gates: [capGate(applied), ilfGate, elrGate()],
      now: tickingNow(),
    });
    const workflow = register(chain);
    const requestContext = runContext("p-2");
    const run = await workflow.createRun();

    let result = (await run.start({ inputData: {}, requestContext })) as SuspendedResult;
    expect(result.suspended![0]![0]).toBe("cap-gate");

    // Stay unlimited: the ilf gate must pass through WITHOUT suspending.
    result = (await run.resume({
      step: "cap-gate",
      resumeData: { decision: "skip", rationale: "book is stable; stay unlimited" },
      requestContext,
    })) as SuspendedResult;
    expect(result.status).toBe("suspended");
    expect(result.suspended![0]![0]).toBe("elr-gate");

    // The skip is visible to the later gate's evidence as a skip record.
    const skipRecord = (
      result.steps!["elr-gate"]!.suspendPayload!.evidence as {
        priorDecisions: Record<string, JudgmentSkipRecord>;
      }
    ).priorDecisions["ilf-gate"]!;
    expect(skipRecord).toEqual({ skipped: true, reason: "unlimited layer: nothing to restore" });

    result = (await run.resume({
      step: "elr-gate",
      resumeData: { decision: "accept", selected: 0.7, rationale: "premium-weighted average" },
      requestContext,
    })) as SuspendedResult;
    expect(result.status).toBe("success");

    const outcome = result.result!;
    expect(outcome.trail).toHaveLength(3);
    expect(outcome.trail[1]).toEqual({
      stage: "ilf",
      decision: "skipped",
      rationale: "unlimited layer: nothing to restore",
      skipped: true,
    });
    // The skipped gate wrote nothing to the ledger.
    expect(outcome.ledger.entries.map((e) => e.field)).toEqual(["elr.selected"]);
  }, 30_000);

  it("rejects a resume whose rationale is missing (schema) or blank (chain guard)", async () => {
    const applied: unknown[] = [];
    const chain = createJudgmentChain({
      id: "elr-derivation-rationale",
      gates: [capGate(applied)],
      now: tickingNow(),
    });
    const workflow = register(chain);
    const requestContext = runContext("p-3");

    // Missing rationale: Mastra's resumeSchema validation rejects the resume.
    const run1 = await workflow.createRun();
    await run1.start({ inputData: {}, requestContext });
    await expect(
      run1.resume({
        step: "cap-gate",
        resumeData: { decision: "skip" } as never,
        requestContext,
      }),
    ).rejects.toThrow(/rationale/i);

    // Blank rationale passes a plain z.string() schema but the chain's
    // runtime guard fails the step with MISSING_RATIONALE.
    const run2 = await workflow.createRun();
    await run2.start({ inputData: {}, requestContext });
    const result = (await run2.resume({
      step: "cap-gate",
      resumeData: { decision: "skip", rationale: "   " },
      requestContext,
    })) as SuspendedResult;
    expect(result.status).toBe("failed");
    // The step failure surfaces as a serialized { name, code, message } object.
    const failure = result.error as { name?: string; code?: string; message?: string };
    expect(failure.name).toBe("AgentsError");
    expect(failure.code).toBe("MISSING_RATIONALE");
    expect(failure.message).toMatch(/rationale/i);
    expect(applied).toHaveLength(0); // the decision was never applied
  }, 30_000);

  it("rejects bad gate lists at definition time (BAD_GATE)", () => {
    const gate = capGate([]);
    const expectBadGate = (fn: () => unknown) => {
      let thrown: unknown;
      try {
        fn();
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AgentsError);
      expect((thrown as AgentsError).code).toBe("BAD_GATE");
    };

    // Empty chain.
    expectBadGate(() => createJudgmentChain({ id: "empty", gates: [], now: tickingNow() }));

    // Duplicate gate ids.
    expectBadGate(() =>
      createJudgmentChain({ id: "dupes", gates: [gate, capGate([])], now: tickingNow() }),
    );

    // Reserved terminal step id.
    expectBadGate(() =>
      createJudgmentChain({
        id: "reserved",
        gates: [{ ...gate, id: "complete" }],
        now: tickingNow(),
      }),
    );

    // resumeSchema without a rationale key.
    expectBadGate(() =>
      createJudgmentChain({
        id: "no-rationale",
        gates: [
          {
            ...gate,
            resumeSchema: z.object({ decision: z.enum(["accept", "skip"]) }) as never,
          },
        ],
        now: tickingNow(),
      }),
    );

    // resumeSchema that is not a zod object at all.
    expectBadGate(() =>
      createJudgmentChain({
        id: "not-object",
        gates: [{ ...gate, resumeSchema: z.string() as never }],
        now: tickingNow(),
      }),
    );
  });
});
