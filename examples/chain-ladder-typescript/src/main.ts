/**
 * Chain ladder, computed IN-PROCESS by @actuarial-ts/core.
 *
 * One of three sibling examples that are deliberately line-for-line identical
 * except for the body of the `compute_chain_ladder` tool — see
 * ../chain-ladder-python and ../chain-ladder-r. Diff them: where the math runs
 * is the ONLY difference. examples/chain-ladder-crosscheck referees all three.
 */
import { z } from "zod";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import {
  ACTOR_IDENTITY_CONTEXT_KEY,
  createJudgmentChain,
  defineActuarialTool,
  toolRegistry,
  type JudgmentChainOutcome,
  type JudgmentGateSpec,
  type ToolEnvelopeFailure,
} from "@actuarial-ts/agents";
import { generateDisclosure } from "@actuarial-ts/compliance";
import type { MethodResultDoc } from "@actuarial-ts/interchange";
import {
  computeDevelopmentFactors,
  runChainLadder,
  triangleFromGrid,
  type LdfSelections,
} from "@actuarial-ts/core";
import {
  crosscheck,
  docToSelections,
  resultToDoc,
  selectionsToDoc,
  triangleToDoc,
} from "@actuarial-ts/interchange";

/** Taylor & Ashe (1983), as published in Mack (1993) Table 1. */
const TAYLOR_ASHE: (number | null)[][] = [
  [357848, 1124788, 1735330, 2218270, 2745596, 3319994, 3466336, 3606286, 3833515, 3901463],
  [352118, 1236139, 2170033, 3353322, 3799067, 4120063, 4647867, 4914039, 5339085, null],
  [290507, 1292306, 2218525, 3235179, 3985995, 4132918, 4628910, 4909315, null, null],
  [310608, 1418858, 2195047, 3757447, 4029929, 4381982, 4588268, null, null, null],
  [443160, 1136350, 2128333, 2897821, 3402672, 3873311, null, null, null, null],
  [396132, 1333217, 2180715, 2985752, 3691712, null, null, null, null, null],
  [440832, 1288463, 2419861, 3483130, null, null, null, null, null, null],
  [359480, 1421128, 2864498, null, null, null, null, null, null, null],
  [376686, 1363294, null, null, null, null, null, null, null, null],
  [344014, null, null, null, null, null, null, null, null, null],
];
const ORIGINS = ["2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009", "2010"];
const AGES = [12, 24, 36, 48, 60, 72, 84, 96, 108, 120];

/** Purity rule: no module in the SDK reads a clock; neither does this example. */
const CREATED_AT = "2026-07-19T00:00:00Z";

/**
 * The three judgment gates. Human decisions arrive as resumeData objects —
 * plain code, no model, no API key — which is why this example runs in CI.
 * Every resumeSchema must contain a `rationale` key (createJudgmentChain
 * rejects gates without one), and the ledger requires a rationale for any
 * actor other than "default".
 */
function averagingBasisGate(): JudgmentGateSpec<{ basisKey: "all-wtd" | "all-str"; rationale: string }> {
  return {
    id: "averaging-basis",
    stage: "averaging basis",
    resumeSchema: z.object({ basisKey: z.enum(["all-wtd", "all-str"]), rationale: z.string() }),
    gatherEvidence: () => ({
      recommendation: "Volume-weighted, all periods (all-wtd)",
      evidence: { menu: ["all-wtd", "all-str"] },
    }),
    applyDecision: async (ctx, decision) => ({
      summary: `averaging basis: ${decision.basisKey}`,
      ledgerEntries: [
        { field: "chainLadder.averages", value: decision.basisKey, timestamp: ctx.now() },
      ],
    }),
  };
}

function ldfSelectionGate(ldfs: (number | null)[]): JudgmentGateSpec<{ decision: "accept"; rationale: string }> {
  return {
    id: "ldf-selection",
    stage: "LDF selection",
    resumeSchema: z.object({ decision: z.literal("accept"), rationale: z.string() }),
    gatherEvidence: () => ({
      recommendation: "Accept the computed volume-weighted factors unchanged",
      evidence: { ldfs },
    }),
    applyDecision: async (ctx, _decision) => ({
      summary: "computed factors accepted",
      ledgerEntries: [
        { field: "chainLadder.ldfs", value: ldfs.map((v) => (v === null ? null : v)), timestamp: ctx.now() },
      ],
    }),
  };
}

function tailFactorGate(): JudgmentGateSpec<{ tailFactor: number; rationale: string }> {
  return {
    id: "tail-factor",
    stage: "tail factor",
    resumeSchema: z.object({ tailFactor: z.number().positive(), rationale: z.string() }),
    gatherEvidence: () => ({
      recommendation: "1.0 — the triangle is fully developed at 120 months",
      evidence: { lastAgeMonths: 120 },
    }),
    applyDecision: async (ctx, decision) => ({
      summary: `tail factor ${decision.tailFactor}`,
      ledgerEntries: [
        { field: "chainLadder.tailFactor", value: decision.tailFactor, timestamp: ctx.now() },
      ],
    }),
  };
}

/**
 * Drives the three gates with scripted decisions and returns { trail, ledger }.
 *
 * NOTE: Mastra's default storage is in-memory, so a suspended chain dies with
 * the process. Fine for an example run end-to-end like this one; a host that
 * wants durable gates configures storage on its Mastra instance.
 */
async function runJudgments(ldfs: (number | null)[]): Promise<JudgmentChainOutcome> {
  // FOOTGUN: a Mastra Workflow is an accidental thenable (`.then(step)` is a
  // builder). Assign synchronously; never `await createJudgmentChain(...)`.
  const chain = createJudgmentChain({
    id: "chain-ladder-judgments",
    gates: [averagingBasisGate(), ldfSelectionGate(ldfs), tailFactorGate()],
    now: (() => { let t = 0; return () => `2026-07-19T00:00:0${++t}Z`; })(),
    requestContextSchema: z.object({ projectId: z.string() }),
  });
  const workflow = new Mastra({ workflows: { chain } }).getWorkflow("chain");

  // WHO decided comes from the server-set context, never the resume payload.
  const requestContext = new RequestContext();
  requestContext.set("projectId", "example-project");
  requestContext.set(ACTOR_IDENTITY_CONTEXT_KEY, "jane.actuary@example.com (SSO)");

  const run = await workflow.createRun();
  let state = (await run.start({ inputData: {}, requestContext })) as { status: string; result?: JudgmentChainOutcome };
  state = (await run.resume({
    step: "averaging-basis",
    resumeData: { basisKey: "all-wtd", rationale: "Stable development; volume weighting uses all credible history." },
    requestContext,
  })) as typeof state;
  state = (await run.resume({
    step: "ldf-selection",
    resumeData: { decision: "accept", rationale: "Computed factors show no outliers worth overriding." },
    requestContext,
  })) as typeof state;
  state = (await run.resume({
    step: "tail-factor",
    resumeData: { tailFactor: 1, rationale: "Fully developed at the last observed age; no tail." },
    requestContext,
  })) as typeof state;
  if (state.status !== "success" || state.result === undefined) {
    throw new Error(`judgment chain ended ${state.status}`);
  }
  return state.result;
}

export interface ClExampleOutcome {
  ultimate: number;
  unpaid: number;
  triangleIntegrity: string;
  refereeVerdict: string;
  ledgerJudgments: number;
  trailActorIdentity: string | undefined;
  disclosureHasJudgmentSection: boolean;
  tenantFailClosedCode: string;
}

export async function runChainLadderTypescript(): Promise<ClExampleOutcome> {
  // 1. Triangle -> factors. The SDK never selects for you; picking "all-wtd"
  //    (volume-weighted, all periods) is a judgment, recorded as one in Task 2.
  const triangle = triangleFromGrid("paid", ORIGINS, AGES, TAYLOR_ASHE);
  const factors = computeDevelopmentFactors(triangle);
  const allWtd = factors.averages.find((a) => a.spec.key === "all-wtd");
  if (allWtd === undefined) throw new Error("expected an all-wtd average");
  const selections: LdfSelections = { selected: [...allWtd.values], tailFactor: 1 };

  // 2. Interchange documents. The integrity tag travels with the data; the
  //    selection travels as INTENT ("all-wtd"), not just as numbers.
  const triangleDoc = triangleToDoc(triangle, { createdAt: CREATED_AT, valuationDate: "2010-12-31" });
  const selectionDoc = selectionsToDoc(selections, {
    triangleDoc,
    createdAt: CREATED_AT,
    intents: selections.selected.map(() => "all-wtd" as const),
    strictness: "refuse",
  }).doc;

  // 3. The judgment chain: three human gates, driven by scripted resumeData.
  const outcome = await runJudgments(allWtd.values);
  const tailEntry = outcome.ledger.entries.find((e) => e.field === "chainLadder.tailFactor");
  if (tailEntry === undefined || typeof tailEntry.value !== "number") {
    throw new Error("expected the tail-factor judgment in the ledger");
  }

  // 4. The typed tools. tenant: "required" means the wrapper resolves the
  //    tenant from the trusted RequestContext BEFORE the body runs.
  const getTriangle = defineActuarialTool({
    id: "get_triangle",
    description: "Returns the Taylor & Ashe triangle document",
    kind: "read",
    tenant: "required",
    inputSchema: z.object({}),
    execute: async (_input, _tenant) => ({ success: true as const, doc: triangleDoc }),
  });
  // THE COMPUTE TOOL — the only body that differs across the three examples.
  const computeChainLadder = defineActuarialTool({
    id: "compute_chain_ladder",
    description: "Runs the chain ladder on the selected factors, in-process",
    kind: "read",
    tenant: "required",
    inputSchema: z.object({ tailFactor: z.number().positive() }),
    execute: async (input, _tenant) => {
      const run = runChainLadder(triangle, { selected: [...allWtd.values], tailFactor: input.tailFactor });
      const doc = resultToDoc(run, {
        triangleDoc,
        selectionDoc,
        createdAt: CREATED_AT,
        conventionProfile: "deterministic-cl",
        parameters: { selections: "volume-weighted all-period", tailFactor: input.tailFactor },
      });
      return { success: true as const, ultimate: run.totals.ultimate, unpaid: run.totals.unpaid, doc };
    },
  });
  const recordSelection = defineActuarialTool({
    id: "record_selection",
    description: "Acknowledges the ledgered selection for downstream consumers",
    kind: "action",
    tenant: "required",
    inputSchema: z.object({ field: z.string() }),
    execute: async (input, tenant) => ({ success: true as const, tenant, field: input.field }),
  });
  const registry = toolRegistry([getTriangle, computeChainLadder, recordSelection]);
  if (!registry.actionToolIds.has("record_selection")) throw new Error("registry lost the action tool");

  // 5. Teaching moment: an unauthenticated call FAILS CLOSED — the wrapper
  //    resolves the tenant first, so the body never executes.
  const denied = (await computeChainLadder.execute!(
    { tailFactor: 1 },
    { requestContext: undefined } as never,
  )) as ToolEnvelopeFailure;

  // 6. The authenticated call, parameterized by the ledgered tail judgment.
  const authed = new RequestContext();
  authed.set("projectId", "example-project");
  const computed = (await computeChainLadder.execute!(
    { tailFactor: tailEntry.value },
    { requestContext: authed } as never,
  )) as { success: true; ultimate: number; unpaid: number; doc: MethodResultDoc };
  if (computed.success !== true) throw new Error("authenticated compute failed");
  const resultDoc = computed.doc;

  // 6b. Referee over a genuine intent REPLAY (runChainLadder is pure — calling
  //    it twice with the same arguments would prove nothing).
  const replay = docToSelections(selectionDoc, { triangleDoc, strictness: "refuse" });
  const replayedDoc = resultToDoc(runChainLadder(triangle, replay.selections), {
    triangleDoc,
    selectionDoc,
    createdAt: CREATED_AT,
    conventionProfile: "deterministic-cl",
    parameters: { selections: "volume-weighted all-period", tailFactor: 1 },
  });
  const report = crosscheck({ a: resultDoc, b: replayedDoc, selection: selectionDoc, createdAt: CREATED_AT });

  // 7. ASOP 41 disclosure — the ledger the chain produced feeds it directly.
  const disclosure = generateDisclosure({
    title: "Taylor & Ashe — chain ladder (TypeScript engine)",
    metadata: {
      intendedPurpose: "worked example accompanying the actuarial-ts SDK",
      intendedMeasure: { kind: "central-estimate" },
      basis: { grossNet: "gross", laeTreatment: "excluding-lae" },
      accountingDate: "2010-12-31",
      valuationDate: "2010-12-31",
    },
    methods: [
      {
        methodId: "chainLadder",
        basisLabel: "paid",
        parameters: { selections: "all-wtd", tailFactor: tailEntry.value },
        resultSummary: { ultimate: computed.ultimate, unpaid: computed.unpaid },
      },
    ],
    ledger: outcome.ledger,
    sdkVersion: "0.3.0",
    generatedAt: CREATED_AT,
  });

  return {
    ultimate: computed.ultimate,
    unpaid: computed.unpaid,
    triangleIntegrity: triangleDoc.integrity,
    refereeVerdict: report.report.verdict,
    ledgerJudgments: outcome.ledger.entries.filter((e) => e.actor !== "default").length,
    trailActorIdentity: outcome.trail.find((t) => t.actorIdentity !== undefined)?.actorIdentity,
    disclosureHasJudgmentSection:
      disclosure.includes("## 5. Assumptions and judgments") &&
      disclosure.includes("chainLadder.tailFactor"),
    tenantFailClosedCode: denied.success === false ? denied.error.code : "",
  };
}

// CLI tail (c8-fenced like reserve-review).
/* c8 ignore start */
if (process.argv[1]?.endsWith("main.ts")) {
  const out = await runChainLadderTypescript();
  console.log("Taylor & Ashe — chain ladder computed in TypeScript\n");
  console.log(`  ultimate   ${Math.round(out.ultimate).toLocaleString("en-US")}`);
  console.log(`  unpaid     ${Math.round(out.unpaid).toLocaleString("en-US")}`);
  console.log(`  referee    ${out.refereeVerdict}`);
}
/* c8 ignore stop */
