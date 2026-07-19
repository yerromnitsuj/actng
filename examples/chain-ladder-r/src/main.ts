/**
 * Chain ladder, computed by R CHAINLADDER via an Rscript subprocess.
 *
 * One of three sibling examples that are deliberately identical except where
 * the engine forces a difference: the compute tool body, its preflight, and
 * how the result is verified — see ../chain-ladder-typescript and
 * ../chain-ladder-python. examples/chain-ladder-crosscheck referees all three.
 */
import { z } from "zod";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import {
  ACTOR_IDENTITY_CONTEXT_KEY,
  createJudgmentChain,
  createReservingAdvisor,
  defineActuarialTool,
  runToolSelectionEvals,
  toolRegistry,
  type JudgmentChainOutcome,
  type JudgmentGateSpec,
  type ToolEnvelopeFailure,
  type ToolSelectionEvalCase,
  type ToolStreamingAgent,
} from "@actuarial-ts/agents";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rscriptAvailable, runRscript } from "./rscript.js";
import { generateDisclosure } from "@actuarial-ts/compliance";
import type { MethodResultDoc } from "@actuarial-ts/interchange";
import { parseDocument } from "@actuarial-ts/interchange";
import {
  computeDevelopmentFactors,
  triangleFromGrid,
  type LdfSelections,
} from "@actuarial-ts/core";
import {
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
 * Golden-prompt eval cases for the three tools. The default path runs them
 * against a canned stub: that proves the HARNESS contract offline — case
 * shape, chunk shapes, pass/fail accounting — and deliberately proves nothing
 * about a model. The live check is one flag away: ACTNG_RUN_AGENT=1 reruns
 * the same cases against the real advisor (costs tokens; see step 9).
 */
const EVAL_CASES: ToolSelectionEvalCase[] = [
  { id: "triangle-fetch", prompt: "Show me the triangle we are working from", expectTools: ["get_triangle"] },
  { id: "compute", prompt: "Run the chain ladder on the selected factors", expectTools: ["compute_chain_ladder"] },
  { id: "record", prompt: "Record the selection for the workpaper", expectTools: ["record_selection"] },
];

/** A canned agent whose stream "calls" exactly the expected tools per case. */
function cannedEvalAgent(): ToolStreamingAgent {
  const byPrompt = new Map(EVAL_CASES.map((c) => [c.prompt, c.expectTools]));
  return {
    async stream(messages) {
      const tools = byPrompt.get(messages[0]?.content ?? "") ?? [];
      return {
        fullStream: (async function* () {
          for (const toolName of tools) yield { type: "tool-call", payload: { toolName } };
        })(),
      };
    },
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
  resultIntegrityVerified: boolean;
  ledgerJudgments: number;
  trailActorIdentity: string | undefined;
  disclosureHasJudgmentSection: boolean;
  disclosureSections: number;
  evalsTotal: number;
  evalsPassed: number;
  /** Only set under ACTNG_RUN_AGENT=1 (live model; never asserted in tests). */
  liveEvalsPassed?: number;
  advisorReply?: string;
  tenantFailClosedCode: string;
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUN_MACK = join(REPO_ROOT, "tools", "interop", "run-mack.R");

export async function runChainLadderR(): Promise<ClExampleOutcome> {
  if (!rscriptAvailable()) {
    console.error(
      "chain-ladder-r needs Rscript on PATH.\n" +
        "  brew install r    # then: see tools/interop/README.md (ChainLadder + jsonlite)",
    );
    process.exit(2);
  }

  // 1. Triangle -> factors. The SDK never selects for you; picking "all-wtd"
  //    (volume-weighted, all periods) is a judgment, recorded as one at step 3 (the judgment chain).
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
  // THE COMPUTE TOOL — here the math runs in R. Transport is files in a temp
  // dir: TS writes the triangle and selection DOCUMENTS, run-mack.R re-verifies
  // their integrity tags, fits MackChainLadder(alpha = 1, est.sigma = "Mack")
  // — which IS the volume-weighted all-period chain ladder — and writes a
  // result document that we re-parse at refuse strictness on the way back.
  // R does not replay stored values; it recomputes the same "all-wtd" intent
  // natively. That independence is exactly what makes the capstone's referee
  // verdict meaningful.
  const computeChainLadder = defineActuarialTool({
    id: "compute_chain_ladder",
    description: "Runs the chain ladder in R ChainLadder via Rscript",
    kind: "read",
    tenant: "required",
    inputSchema: z.object({ tailFactor: z.number().positive() }),
    execute: async (input, _tenant) => {
      if (input.tailFactor !== 1) throw new Error("run-mack.R runs without a tail");
      const dir = mkdtempSync(join(tmpdir(), "cl-r-"));
      try {
        writeFileSync(join(dir, "triangle.json"), JSON.stringify(triangleDoc));
        writeFileSync(join(dir, "selection.json"), JSON.stringify(selectionDoc));
        const ran = await runRscript(RUN_MACK, [
          "--in", join(dir, "triangle.json"),
          "--selection", join(dir, "selection.json"),
          "--out", join(dir, "result.json"),
          "--created-at", CREATED_AT,
          "--profile", "deterministic-cl",
        ]);
        if (!ran.ok) throw new Error(`${ran.code}: ${ran.message}`);
        const raw: unknown = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
        const doc = parseDocument(raw, { strictness: "refuse" }).doc as MethodResultDoc;
        const totals = (doc as { result: { totals?: { ultimate?: number; unpaid?: number } } }).result.totals;
        if (typeof totals?.ultimate !== "number" || typeof totals?.unpaid !== "number") {
          throw new Error("R result carried no totals");
        }
        return { success: true as const, ultimate: totals.ultimate, unpaid: totals.unpaid, doc };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
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

  // The document R wrote, re-parsed at refuse strictness: a broken or
  // tampered integrity tag would throw here.
  const reparsed = parseDocument(JSON.parse(JSON.stringify(resultDoc)), { strictness: "refuse" });
  const resultIntegrityVerified = reparsed.warnings.length === 0;

  // 7. ASOP 41 disclosure — the ledger the chain produced feeds it directly.
  const disclosure = generateDisclosure({
    title: "Taylor & Ashe — chain ladder (R ChainLadder engine)",
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

  // 8. The eval harness, offline. The stub satisfies the SDK's structural
  //    ToolStreamingAgent seam — that seam is typed loosely ON PURPOSE so
  //    examples and tests can drive the harness without a model or a key.
  const evalReport = await runToolSelectionEvals({ agent: cannedEvalAgent(), cases: EVAL_CASES });

  // 9. OPT-IN LIVE TURN. Constructing the advisor is free and offline (a
  //    model-router string is inert config); only generate/stream calls the
  //    provider, which reads ANTHROPIC_API_KEY from the environment. The
  //    same registry that served the scripted path now serves a real model —
  //    including the tenant seam: the RequestContext travels into every tool
  //    call the model makes.
  let liveEvalsPassed: number | undefined;
  let advisorReply: string | undefined;
  if (process.env.ACTNG_RUN_AGENT === "1") {
    const advisor = createReservingAdvisor({
      model: process.env.ACTNG_EVAL_MODEL ?? "anthropic/claude-sonnet-4-5",
      tools: registry.tools,
    });
    const live = await runToolSelectionEvals({
      agent: advisor,
      cases: EVAL_CASES,
      requestContext: authed,
      maxSteps: 8,
    });
    liveEvalsPassed = live.summary.passed;
    const turn = await advisor.generate(
      [{ role: "user", content: "Use your tools: fetch the triangle document and report how many origin years it has." }],
      { requestContext: authed, maxSteps: 4 },
    );
    advisorReply = turn.text;
  }

  return {
    ultimate: computed.ultimate,
    unpaid: computed.unpaid,
    triangleIntegrity: triangleDoc.integrity,
    resultIntegrityVerified,
    ledgerJudgments: outcome.ledger.entries.filter((e) => e.actor !== "default").length,
    trailActorIdentity: outcome.trail.find((t) => t.actorIdentity !== undefined)?.actorIdentity,
    disclosureHasJudgmentSection:
      disclosure.includes("## 5. Assumptions and judgments") &&
      disclosure.includes("chainLadder.tailFactor"),
    disclosureSections: (disclosure.match(/^## /gm) ?? []).length,
    evalsTotal: evalReport.summary.total,
    evalsPassed: evalReport.summary.passed,
    ...(liveEvalsPassed !== undefined ? { liveEvalsPassed } : {}),
    ...(advisorReply !== undefined ? { advisorReply } : {}),
    tenantFailClosedCode: denied.success === false ? denied.error.code : "",
  };
}

// CLI tail (c8-fenced like reserve-review).
/* c8 ignore start */
if (process.argv[1]?.endsWith("main.ts")) {
  const out = await runChainLadderR();
  console.log("Taylor & Ashe — chain ladder computed by R ChainLadder\n");
  console.log(`  ultimate   ${Math.round(out.ultimate).toLocaleString("en-US")}`);
  console.log(`  unpaid     ${Math.round(out.unpaid).toLocaleString("en-US")}`);
  console.log(`  engine     rcl:MackChainLadder (alpha=1 == volume-weighted chain ladder)`);
  console.log(`  tenant gate  ${out.tenantFailClosedCode} (fail-closed, body never ran)`);
  console.log(`  disclosure   ${out.disclosureSections} sections (ASOP 41)`);
  console.log(`  evals (stub) ${out.evalsPassed}/${out.evalsTotal} tool-selection cases`);
  if (out.liveEvalsPassed !== undefined) {
    console.log(`  evals (live) ${out.liveEvalsPassed}/${out.evalsTotal}`);
  }
  if (out.advisorReply !== undefined) {
    console.log(`\n  advisor: ${out.advisorReply}`);
  } else {
    console.log(`  advisor      opt-in: ACTNG_RUN_AGENT=1 (model via ACTNG_EVAL_MODEL)`);
  }
}
/* c8 ignore stop */
