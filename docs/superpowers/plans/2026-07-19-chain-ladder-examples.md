# Chain-Ladder Example Trilogy + Capstone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four runnable example workspaces computing the same chain ladder on Taylor & Ashe — math in TypeScript, in chainladder-python (HTTP sidecar), and in R ChainLadder (Rscript subprocess) — plus a capstone that referees all three, each driving the SDK's Mastra agent layer (typed tools, tenant seam, judgment chain, ASOP 41 disclosure).

**Architecture:** Three sibling examples with deliberately identical agent spines differing only in the `compute_chain_ladder` tool body; a fourth workspace computes all three results live and crosschecks them pairwise. New R CLI entrypoint `tools/interop/run-mack.R`; a small subprocess helper lives inside the R example (not in `packages/agents`).

**Tech Stack:** TypeScript (tsx, vitest, workspace-linked `@actuarial-ts/*` 0.3.0), `@mastra/core` ^1.49.0 + `zod` ^3.25.76 (peer deps of agents), FastAPI sidecar in `.venv-interop` (Python 3.12, chainladder 0.9.2), R 4.4+ with ChainLadder + jsonlite.

**Spec:** `docs/superpowers/specs/2026-07-18-chain-ladder-examples-design.md` (read it first; §7 lists the traps encoded below).

## Global Constraints

- Repo: `/Users/justinmorrey/ActNG2`. Node >= 20. Examples are `private: true`, no build step, `tsconfig` = `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": ["node"] }, "include": ["src", "test"] }`.
- Workspace names: `@actuarial-ts/example-chain-ladder-typescript|python|r|crosscheck` in `examples/chain-ladder-<shore>/`. Root workspaces glob `examples/*` already matches — do not edit `workspaces`.
- **Purity rule:** module-scope `const CREATED_AT = "2026-07-19T00:00:00Z";` everywhere; never call `new Date()` / `Date.now()` in example source. (Tests and CI scripts may.)
- **Published anchors (must hold in every shore):** ultimate `53_038_946`, unpaid `18_680_856` (Mack 1993, Taylor & Ashe, volume-weighted all-period, tail 1.0).
- **Thenable trap:** `createJudgmentChain(...)`, `new Mastra(...)`, and `mastra.getWorkflow(...)` are SYNCHRONOUS assignments — awaiting a Mastra Workflow hangs forever (it exposes a `.then(step)` builder). Only `createRun()`, `run.start()`, `run.resume()` are awaited.
- Tool inputs stay simple (plain scalars); never use `allowUninspected` in these examples.
- Origins are year strings `"2001".."2010"`; ages `[12..120]`; valuation date `"2010-12-31"`.
- Root `npm run example` is referenced by the README and MUST NOT change. New scripts are `example:cl-ts`, `example:cl-py`, `example:cl-r`, `example:cl-crosscheck`.
- Test style: call the exported async function ONCE at test-module top level (`const out = await runX();`), one assertion per `it`, prose titles.
- Commit after every task; `git add <explicit paths>` only — another session may share this checkout. Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Environment facts (verified 2026-07-19): `.venv-interop` exists and is fully provisioned (Python 3.12.13, chainladder 0.9.2, fastapi). `Rscript` is NOT installed locally; Task 4 installs it. `brew` available.

---

### Task 1: TypeScript example — math spine, interchange docs, replay referee

**Files:**
- Create: `examples/chain-ladder-typescript/package.json`
- Create: `examples/chain-ladder-typescript/tsconfig.json`
- Create: `examples/chain-ladder-typescript/src/main.ts`
- Test: `examples/chain-ladder-typescript/test/example.test.ts`

**Interfaces:**
- Produces: `runChainLadderTypescript(): Promise<ClExampleOutcome>` where `ClExampleOutcome = { ultimate: number; unpaid: number; triangleIntegrity: string; refereeVerdict: string; ledgerJudgments: number; trailActorIdentity: string | undefined; disclosureHasJudgmentSection: boolean; tenantFailClosedCode: string }`. Task 2 rewrites `main.ts` in place to fill the agent-layer fields; this task stubs them (`ledgerJudgments: 0`, `trailActorIdentity: undefined`, `disclosureHasJudgmentSection: false`, `tenantFailClosedCode: ""`).
- Consumes: `@actuarial-ts/core` (`triangleFromGrid`, `computeDevelopmentFactors`, `runChainLadder`, `LdfSelections`), `@actuarial-ts/interchange` (`triangleToDoc`, `selectionsToDoc`, `docToSelections`, `resultToDoc`, `crosscheck`).

- [ ] **Step 1: Create the workspace manifests**

`examples/chain-ladder-typescript/package.json`:

```json
{
  "name": "@actuarial-ts/example-chain-ladder-typescript",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "description": "Chain ladder computed in-process by @actuarial-ts/core, driven through the Mastra agent layer",
  "scripts": {
    "example": "tsx src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@actuarial-ts/agents": "*",
    "@actuarial-ts/compliance": "*",
    "@actuarial-ts/core": "*",
    "@actuarial-ts/interchange": "*"
  },
  "devDependencies": {
    "@mastra/core": "^1.49.0",
    "@types/node": "^22.10.5",
    "tsx": "^4.19.2",
    "vitest": "^3.2.6",
    "zod": "^3.25.76"
  }
}
```

`examples/chain-ladder-typescript/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src", "test"]
}
```

Run: `npm install` (root). Expected: workspace linked, exit 0.

- [ ] **Step 2: Write the failing test**

`examples/chain-ladder-typescript/test/example.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runChainLadderTypescript } from "../src/main.js";

// Called once; each `it` asserts one fact. Top-level await is fine under vitest ESM.
const out = await runChainLadderTypescript();

describe("chain ladder computed in TypeScript", () => {
  it("reproduces Mack (1993)'s published unpaid for Taylor & Ashe", () => {
    expect(Math.round(out.unpaid)).toBe(18_680_856);
  });

  it("produces the published ultimate", () => {
    expect(Math.round(out.ultimate)).toBe(53_038_946);
  });

  it("stamps an integrity tag on the triangle document", () => {
    expect(out.triangleIntegrity).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gets an `agree` verdict from the referee on an intent replay", () => {
    expect(out.refereeVerdict).toBe("agree");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w @actuarial-ts/example-chain-ladder-typescript`
Expected: FAIL — `Cannot find module '../src/main.js'`.

- [ ] **Step 4: Write `src/main.ts` (spine v1 — math + docs + replay referee, agent fields stubbed)**

```ts
/**
 * Chain ladder, computed IN-PROCESS by @actuarial-ts/core.
 *
 * One of three sibling examples that are deliberately line-for-line identical
 * except for the body of the `compute_chain_ladder` tool — see
 * ../chain-ladder-python and ../chain-ladder-r. Diff them: where the math runs
 * is the ONLY difference. examples/chain-ladder-crosscheck referees all three.
 */
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

  // 3. THE COMPUTE STEP — the only part that differs across the three examples.
  const cl = runChainLadder(triangle, selections);
  const resultDoc = resultToDoc(cl, {
    triangleDoc,
    selectionDoc,
    createdAt: CREATED_AT,
    conventionProfile: "deterministic-cl",
    parameters: { selections: "volume-weighted all-period", tailFactor: 1 },
  });

  // 4. Referee over a genuine intent REPLAY (runChainLadder is pure — calling
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

  return {
    ultimate: cl.totals.ultimate,
    unpaid: cl.totals.unpaid,
    triangleIntegrity: triangleDoc.integrity,
    refereeVerdict: report.report.verdict,
    ledgerJudgments: 0, // Task 2
    trailActorIdentity: undefined, // Task 2
    disclosureHasJudgmentSection: false, // Task 2
    tenantFailClosedCode: "", // Task 2
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @actuarial-ts/example-chain-ladder-typescript`
Expected: 4 passed. Also run `npm run typecheck -w @actuarial-ts/example-chain-ladder-typescript` (expect clean) and `npx tsx examples/chain-ladder-typescript/src/main.ts` (expect the three printed lines with `referee agree`).

- [ ] **Step 6: Commit**

```bash
git add examples/chain-ladder-typescript
git commit -m "feat(examples): chain-ladder-typescript — the in-process spine (task 1)"
```

---

### Task 2: TypeScript example — agent layer (tools, tenant seam, judgment chain, disclosure)

**Files:**
- Modify: `examples/chain-ladder-typescript/src/main.ts` (extend in place)
- Modify: `examples/chain-ladder-typescript/test/example.test.ts` (add assertions)

**Interfaces:**
- Produces: the completed `ClExampleOutcome` (all stub fields real). The gate/tool code added here is the SHARED SPINE — Tasks 3 and 5 copy it verbatim into their examples.
- Consumes (all `@actuarial-ts/agents`): `defineActuarialTool`, `toolRegistry`, `createJudgmentChain`, `ACTOR_IDENTITY_CONTEXT_KEY`, types `JudgmentGateSpec`, `JudgmentChainOutcome`, `ToolEnvelopeFailure`. From `@mastra/core/mastra`: `Mastra`. From `@mastra/core/request-context`: `RequestContext`. From `@actuarial-ts/compliance`: `generateDisclosure`. `zod`.

- [ ] **Step 1: Add the failing tests**

Append inside the `describe` in `test/example.test.ts`:

```ts
  it("records exactly three human judgments in the assumption ledger", () => {
    expect(out.ledgerJudgments).toBe(3);
  });

  it("carries the authenticated actor identity on the judgment trail (0.3.0, finding 3.6)", () => {
    // Identity comes from the RequestContext, never the resume payload.
    expect(out.trailActorIdentity).toBe("jane.actuary@example.com (SSO)");
  });

  it("renders the judgments into ASOP 41 Section 5 of the disclosure", () => {
    expect(out.disclosureHasJudgmentSection).toBe(true);
  });

  it("fails closed when a tool is called without a tenant — the body never runs", () => {
    expect(out.tenantFailClosedCode).toBe("NO_TENANT_CONTEXT");
  });
```

Run: `npm test -w @actuarial-ts/example-chain-ladder-typescript` — expect the 4 new tests FAIL (stub values).

- [ ] **Step 2: Extend `src/main.ts`**

Add imports at the top:

```ts
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
```

Add the three gates ABOVE `runChainLadderTypescript` (module scope, after `CREATED_AT`):

```ts
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
```

Inside `runChainLadderTypescript`, replace step 3 and the return with:

```ts
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
```

(keep the existing replay-referee block, now comparing against `resultDoc`), then before the return:

```ts
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
```

Note the ordering consequence: the `selections`/`selectionDoc` construction from Task 1 stays, but `runChainLadder`'s ultimate/unpaid now come from the tool call. Delete the Task-1 direct `const cl = runChainLadder(...)` line and its `resultDoc` (the tool builds it).

- [ ] **Step 3: Run the tests**

Run: `npm test -w @actuarial-ts/example-chain-ladder-typescript`
Expected: 8 passed. Also `npm run typecheck -w @actuarial-ts/example-chain-ladder-typescript` clean, and `npx tsx examples/chain-ladder-typescript/src/main.ts` prints `referee agree`.

- [ ] **Step 4: Commit**

```bash
git add examples/chain-ladder-typescript
git commit -m "feat(examples): chain-ladder-typescript — tools, tenant seam, judgment chain, disclosure (task 2)"
```

---

### Task 3: Python example + py-conformance CI extension

**Files:**
- Create: `examples/chain-ladder-python/package.json` (copy Task 1's, name `...-python`, description "Chain ladder computed by chainladder-python via the HTTP sidecar, orchestrated from TypeScript")
- Create: `examples/chain-ladder-python/tsconfig.json` (identical to Task 1's)
- Create: `examples/chain-ladder-python/src/main.ts`
- Test: `examples/chain-ladder-python/test/example.test.ts`
- Modify: `.github/workflows/py-conformance.yml`

**Interfaces:**
- Produces: `runChainLadderPython(): Promise<ClExampleOutcome>` (same shape as Task 2, minus `refereeVerdict` — replace it with `resultIntegrityVerified: boolean`; the cross-engine referee is the capstone's job).
- Consumes: everything Task 2 consumes, plus `callRemoteMethod` from `@actuarial-ts/agents`.
- Env contract: `SIDECAR_URL` + `SIDECAR_TOKEN`. Missing → CLI exits 2 printing the exact boot command; tests skip with a printed reason.

- [ ] **Step 1: Write the failing test**

`examples/chain-ladder-python/test/example.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runChainLadderPython } from "../src/main.js";

const haveSidecar = Boolean(process.env.SIDECAR_URL && process.env.SIDECAR_TOKEN);
if (!haveSidecar) {
  // Local machines without the sidecar skip LOUDLY; CI always provides one,
  // so a real regression still goes red there.
  console.log(
    "SKIP chain-ladder-python: no sidecar. Boot one with:\n" +
      "  PYTHONPATH=interop SIDECAR_TOKEN=dev-secret .venv-interop/bin/python -m sidecar\n" +
      "then: SIDECAR_URL=http://127.0.0.1:8091 SIDECAR_TOKEN=dev-secret npm test -w @actuarial-ts/example-chain-ladder-python",
  );
}

const out = haveSidecar ? await runChainLadderPython() : undefined;

describe.skipIf(!haveSidecar)("chain ladder computed by chainladder-python", () => {
  it("reproduces Mack (1993)'s published unpaid for Taylor & Ashe", () => {
    expect(Math.round(out!.unpaid)).toBe(18_680_856);
  });
  it("produces the published ultimate", () => {
    expect(Math.round(out!.ultimate)).toBe(53_038_946);
  });
  it("integrity-verifies the document the sidecar returned", () => {
    expect(out!.resultIntegrityVerified).toBe(true);
  });
  it("records exactly three human judgments in the assumption ledger", () => {
    expect(out!.ledgerJudgments).toBe(3);
  });
  it("carries the authenticated actor identity on the judgment trail", () => {
    expect(out!.trailActorIdentity).toBe("jane.actuary@example.com (SSO)");
  });
  it("renders the judgments into ASOP 41 Section 5 of the disclosure", () => {
    expect(out!.disclosureHasJudgmentSection).toBe(true);
  });
  it("fails closed when a tool is called without a tenant", () => {
    expect(out!.tenantFailClosedCode).toBe("NO_TENANT_CONTEXT");
  });
});
```

Run without a sidecar: `npm test -w @actuarial-ts/example-chain-ladder-python` — expect the SKIP message, 0 failures. Then boot a sidecar and run with env set — expect FAIL (`Cannot find module '../src/main.js'`).

- [ ] **Step 2: Write `src/main.ts`**

Copy `examples/chain-ladder-typescript/src/main.ts` from Task 2 EXACTLY, then make ONLY these changes (this discipline is the product — a `diff` between the two files must show nothing else):

1. Header comment: swap the first line for `Chain ladder, computed by CHAINLADDER-PYTHON over the HTTP sidecar.` and swap the sibling references accordingly.
2. Remove the `runChainLadder` import from `@actuarial-ts/core` (keep `computeDevelopmentFactors`, `triangleFromGrid`, `LdfSelections`); remove `docToSelections`/`crosscheck` imports; add `import { callRemoteMethod } from "@actuarial-ts/agents";` and `import { parseDocument } from "@actuarial-ts/interchange";`.
3. Rename the exported function `runChainLadderPython`; outcome interface field `refereeVerdict: string` becomes `resultIntegrityVerified: boolean`.
4. Add the preflight right at the top of the function:

```ts
  const sidecarUrl = process.env.SIDECAR_URL;
  const sidecarToken = process.env.SIDECAR_TOKEN;
  if (!sidecarUrl || !sidecarToken) {
    // Same posture as interop/conformance/crosscheck-ci.mts: exit with the
    // exact boot command rather than pretending.
    console.error(
      "chain-ladder-python needs a live sidecar: set SIDECAR_URL and SIDECAR_TOKEN\n" +
        "  PYTHONPATH=interop SIDECAR_TOKEN=dev-secret .venv-interop/bin/python -m sidecar",
    );
    process.exit(2);
  }
```

5. Replace the `compute_chain_ladder` tool body (THE ONLY SEMANTIC DIFFERENCE):

```ts
  // THE COMPUTE TOOL — here the math runs in chainladder-python. The wire body
  // embeds the full triangle and selection DOCUMENTS; the sidecar re-verifies
  // both integrity tags, replays the "all-wtd" intent, and returns a
  // method-result document that callRemoteMethod parse-verifies on the way in.
  // Contrast: the SDK's own defineRemoteMethod declares tenant: "none" (the
  // sidecar is stateless); this wrapper declares tenant: "required" because it
  // represents a tenant-scoped analysis step.
  const computeChainLadder = defineActuarialTool({
    id: "compute_chain_ladder",
    description: "Runs the chain ladder in chainladder-python via the sidecar",
    kind: "read",
    tenant: "required",
    inputSchema: z.object({ tailFactor: z.number().positive() }),
    execute: async (input, _tenant) => {
      if (input.tailFactor !== 1) throw new Error("the sidecar Chainladder path runs without a tail");
      const remote = await callRemoteMethod(
        { sidecarUrl, method: "Chainladder", headers: { authorization: `Bearer ${sidecarToken}` }, timeoutMs: 120_000 },
        { triangles: { primary: triangleDoc }, selection: selectionDoc },
      );
      if (!remote.success) throw new Error(`${remote.error.code}: ${remote.error.message}`);
      const doc = remote.doc as MethodResultDoc;
      const totals = (doc as { result: { totals?: { ultimate?: number; unpaid?: number } } }).result.totals;
      if (typeof totals?.ultimate !== "number" || typeof totals?.unpaid !== "number") {
        throw new Error("sidecar result carried no totals");
      }
      return { success: true as const, ultimate: totals.ultimate, unpaid: totals.unpaid, doc };
    },
  });
```

6. Replace the replay-referee block with an explicit re-verification (the capstone owns the cross-engine referee):

```ts
  // The sidecar's document, re-parsed at refuse strictness: a broken or
  // tampered integrity tag would throw here.
  const reparsed = parseDocument(JSON.parse(JSON.stringify(resultDoc)), { strictness: "refuse" });
  const resultIntegrityVerified = reparsed.warnings.length === 0;
```

7. Return `resultIntegrityVerified` instead of `refereeVerdict`; CLI tail prints `engine     clpy:Chainladder` instead of the referee line.

- [ ] **Step 3: Verify live**

```bash
(PYTHONPATH=interop SIDECAR_TOKEN=dev-secret nohup .venv-interop/bin/python -m sidecar > /tmp/sidecar.log 2>&1 & echo $! > /tmp/sidecar.pid)
until curl -sf http://127.0.0.1:8091/v1/health; do sleep 0.5; done
SIDECAR_URL=http://127.0.0.1:8091 SIDECAR_TOKEN=dev-secret npm test -w @actuarial-ts/example-chain-ladder-python
SIDECAR_URL=http://127.0.0.1:8091 SIDECAR_TOKEN=dev-secret npx tsx examples/chain-ladder-python/src/main.ts
kill "$(cat /tmp/sidecar.pid)"
```

Expected: 7 passed; CLI prints the published numbers. Also run `npm test -w @actuarial-ts/example-chain-ladder-python` WITHOUT env — expect skip message, exit 0. Typecheck clean.

- [ ] **Step 4: Extend `.github/workflows/py-conformance.yml`**

In the `paths:` lists (both `push` and `pull_request` if present), add:

```yaml
      - "examples/chain-ladder-python/**"
```

After the existing crosscheck step (the one exporting `SIDECAR_URL`/`SIDECAR_TOKEN` against the booted sidecar), add:

```yaml
      - name: Chain-ladder Python example (live sidecar)
        run: npm test -w @actuarial-ts/example-chain-ladder-python
        env:
          SIDECAR_URL: http://127.0.0.1:8091
          SIDECAR_TOKEN: ci-secret
```

BEFORE committing: read the workflow's existing sidecar-boot step and use the
SAME literal token it boots with (replacing `ci-secret` above if it differs) —
one token convention per workflow, not two.

- [ ] **Step 5: Commit**

```bash
git add examples/chain-ladder-python .github/workflows/py-conformance.yml
git commit -m "feat(examples): chain-ladder-python — the sidecar spine + CI leg (task 3)"
```

---

### Task 4: Install R locally + `tools/interop/run-mack.R` (the CLI entrypoint)

**Files:**
- Create: `tools/interop/run-mack.R`
- Modify: `tools/interop/README.md` (document the new entrypoint)

**Interfaces:**
- Produces: `Rscript tools/interop/run-mack.R --in <triangle.json> --out <result.json> --created-at <iso8601> [--selection <selection.json>] [--profile <name>]` — writes a MethodResultDoc with a fresh integrity tag; exit 0 on success, nonzero with a stderr message otherwise. Default `--profile` is `deterministic-cl` (NOT the extractor's `mack1993-vw` default — this trilogy compares against TS/Python deterministic-cl documents).
- Consumes: `ats_read_document`, `ats_triangle_to_matrix`, `ats_extract_mack_result(fit, triangle_doc, selection_doc, convention_profile, created_at)`, `ats_write_document` from `tools/interop/actuarialInterchange.R`; `ChainLadder::MackChainLadder`.

- [ ] **Step 1: Install the R toolchain (local machine, one-time)**

```bash
brew install r
Rscript --version           # expect: Rscript (R) version 4.x
Rscript -e 'dir.create("~/.R-interop-lib", showWarnings = FALSE);
  install.packages(c("ChainLadder", "jsonlite"), lib = "~/.R-interop-lib", repos = "https://cloud.r-project.org")'
Rscript -e 'source("tools/interop/actuarialInterchange.R"); ats_test_jcs()'   # expect 23/23
```

(The adapter auto-prepends `~/.R-interop-lib` to `.libPaths()`. macOS CRAN ships binaries; this takes minutes, not tens.) Then run the existing corpus to confirm the shore works here: `Rscript tools/interop/conformance.R` — expect the verdict table and exit 0.

- [ ] **Step 2: Write a failing smoke check**

```bash
Rscript tools/interop/run-mack.R \
  --in interop/conformance/fixtures/taylor-ashe/triangle.json \
  --out /tmp/r-result.json --created-at 2026-07-19T00:00:00Z
```

Expected: FAIL — file does not exist.

- [ ] **Step 3: Write `tools/interop/run-mack.R`**

```r
#!/usr/bin/env Rscript
# CLI entrypoint: triangle document in, Mack fit, method-result document out.
#
#   Rscript tools/interop/run-mack.R --in <triangle.json> --out <result.json> \
#     --created-at <iso8601> [--selection <selection.json>] [--profile <name>]
#
# --created-at is REQUIRED: the adapter's assemble/extract helpers default it
# to a hardcoded literal, and a document that always claims the same date
# breaks byte-determinism for everyone downstream.
#
# --profile defaults to "deterministic-cl": MackChainLadder(alpha = 1, all
# periods, no tail) IS the volume-weighted all-period chain ladder point
# estimate, so its central results are exactly what that profile compares.
# (The extractor's own default, "mack1993-vw", is for SE-focused runs.)

local({
  lib <- path.expand("~/.R-interop-lib")
  if (dir.exists(lib)) .libPaths(c(lib, .libPaths()))
})
.this_file <- local({
  args <- commandArgs(trailingOnly = FALSE)
  fa <- sub("^--file=", "", args[grep("^--file=", args)])
  if (length(fa) == 1L && nzchar(fa)) normalizePath(fa) else normalizePath("tools/interop/run-mack.R")
})
source(file.path(dirname(.this_file), "actuarialInterchange.R"))
suppressPackageStartupMessages(library(ChainLadder))

parse_args <- function(argv) {
  out <- list(`in` = NULL, out = NULL, `created-at` = NULL, selection = NULL, profile = "deterministic-cl")
  i <- 1L
  while (i <= length(argv)) {
    key <- sub("^--", "", argv[[i]])
    if (!key %in% names(out)) stop(sprintf("unknown argument --%s", key))
    if (i + 1L > length(argv)) stop(sprintf("--%s needs a value", key))
    out[[key]] <- argv[[i + 1L]]
    i <- i + 2L
  }
  for (req in c("in", "out", "created-at")) {
    if (is.null(out[[req]])) stop(sprintf("--%s is required", req))
  }
  out
}

args <- parse_args(commandArgs(trailingOnly = TRUE))

tri_doc <- ats_read_document(args$`in`)          # verifies the integrity tag
selection_doc <- if (!is.null(args$selection)) ats_read_document(args$selection) else NULL

m <- ats_triangle_to_matrix(tri_doc)
fit <- MackChainLadder(as.triangle(m), alpha = 1, est.sigma = "Mack")
# est.sigma is EXPLICIT: R's silent log-linear fallback would make
# effectiveParameters disagree with parameters and confuse the referee.

result_doc <- ats_extract_mack_result(
  fit, tri_doc, selection_doc,
  convention_profile = args$profile,
  created_at = args$`created-at`
)
ats_write_document(result_doc, args$out)         # re-stamps the tag on write
cat(sprintf("wrote %s (%s)\n", args$out, args$profile))
```

- [ ] **Step 4: Run the smoke checks**

```bash
Rscript tools/interop/run-mack.R \
  --in interop/conformance/fixtures/taylor-ashe/triangle.json \
  --selection interop/conformance/fixtures/taylor-ashe/selection.json \
  --out /tmp/r-result.json --created-at 2026-07-19T00:00:00Z
Rscript -e '
  source("tools/interop/actuarialInterchange.R")
  doc <- ats_read_document("/tmp/r-result.json")   # integrity re-verified
  stopifnot(doc$kind == "method-result")
  stopifnot(abs(doc$result$totals$unpaid - 18680856) <= 1)   # Mack (1993), printed precision
  stopifnot(doc$createdAt == "2026-07-19T00:00:00Z")
  cat("run-mack.R smoke: OK\n")'
```

Expected: `wrote /tmp/r-result.json (deterministic-cl)` then `run-mack.R smoke: OK`. Also verify the missing-arg path: `Rscript tools/interop/run-mack.R --in x` → nonzero exit, message `--out is required`.

- [ ] **Step 5: Document it and commit**

Add to `tools/interop/README.md` under "Run" a block naming the entrypoint, its arguments, and that `--created-at` is mandatory-by-design. Then:

```bash
git add tools/interop/run-mack.R tools/interop/README.md
git commit -m "feat(interop): run-mack.R — the R shore's CLI entrypoint (task 4)"
```

---

### Task 5: R example + r-conformance CI extension

**Files:**
- Create: `examples/chain-ladder-r/package.json` (copy Task 1's; name `...-r`; description "Chain ladder computed by R ChainLadder via Rscript, orchestrated from TypeScript"; drop the `@mastra/core`-unrelated changes — dependencies identical to Task 1's)
- Create: `examples/chain-ladder-r/tsconfig.json` (identical to Task 1's)
- Create: `examples/chain-ladder-r/src/rscript.ts` (the subprocess helper — deliberately local to this example, NOT in `packages/agents`)
- Create: `examples/chain-ladder-r/src/main.ts`
- Test: `examples/chain-ladder-r/test/example.test.ts`
- Modify: `.github/workflows/r-conformance.yml`

**Interfaces:**
- Produces: `runChainLadderR(): Promise<ClExampleOutcome>` (Python's shape: `resultIntegrityVerified`, no `refereeVerdict`). Also `runRscript(scriptPath: string, args: string[], timeoutMs?: number): Promise<{ ok: true; stdout: string } | { ok: false; code: string; message: string }>` and `rscriptAvailable(): boolean` from `src/rscript.ts` — Task 6 copies this helper file verbatim.
- Consumes: Task 2's spine; `tools/interop/run-mack.R` from Task 4; `node:child_process`, `node:fs`, `node:os`, `node:path`.

- [ ] **Step 1: Write `src/rscript.ts`**

```ts
/**
 * Minimal Rscript subprocess helper. Lives INSIDE this example on purpose:
 * the SDK packages ship no subprocess machinery, and an example should not
 * grow their public surface. (examples/chain-ladder-crosscheck carries an
 * identical copy — self-containment beats DRY in teaching code.)
 */
import { execFile, spawnSync } from "node:child_process";

export function rscriptAvailable(): boolean {
  return spawnSync("Rscript", ["--version"], { stdio: "ignore" }).status === 0;
}

export function runRscript(
  scriptPath: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<{ ok: true; stdout: string } | { ok: false; code: string; message: string }> {
  return new Promise((resolve) => {
    execFile("Rscript", [scriptPath, ...args], { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ ok: true, stdout });
        return;
      }
      const code = error.killed ? "RSCRIPT_TIMEOUT" : "RSCRIPT_FAILED";
      resolve({ ok: false, code, message: (stderr || error.message).trim() });
    });
  });
}
```

- [ ] **Step 2: Write the failing test**

`examples/chain-ladder-r/test/example.test.ts` — copy Task 3's test file, changing: import + function name to `runChainLadderR`; the gating from env vars to the toolchain probe; and the skip message.

```ts
import { describe, expect, it } from "vitest";
import { rscriptAvailable } from "../src/rscript.js";
import { runChainLadderR } from "../src/main.js";

const haveR = rscriptAvailable();
if (!haveR) {
  console.log(
    "SKIP chain-ladder-r: Rscript not on PATH. Install with:\n" +
      "  brew install r   # then see tools/interop/README.md for ChainLadder + jsonlite",
  );
}

const out = haveR ? await runChainLadderR() : undefined;

describe.skipIf(!haveR)("chain ladder computed by R ChainLadder", () => {
  it("reproduces Mack (1993)'s published unpaid for Taylor & Ashe", () => {
    expect(Math.round(out!.unpaid)).toBe(18_680_856);
  });
  it("produces the published ultimate", () => {
    expect(Math.round(out!.ultimate)).toBe(53_038_946);
  });
  it("integrity-verifies the document R wrote", () => {
    expect(out!.resultIntegrityVerified).toBe(true);
  });
  it("records exactly three human judgments in the assumption ledger", () => {
    expect(out!.ledgerJudgments).toBe(3);
  });
  it("carries the authenticated actor identity on the judgment trail", () => {
    expect(out!.trailActorIdentity).toBe("jane.actuary@example.com (SSO)");
  });
  it("renders the judgments into ASOP 41 Section 5 of the disclosure", () => {
    expect(out!.disclosureHasJudgmentSection).toBe(true);
  });
  it("fails closed when a tool is called without a tenant", () => {
    expect(out!.tenantFailClosedCode).toBe("NO_TENANT_CONTEXT");
  });
});
```

Run: `npm test -w @actuarial-ts/example-chain-ladder-r` — expect FAIL on the missing `../src/main.js`.

- [ ] **Step 3: Write `src/main.ts`**

Copy `examples/chain-ladder-python/src/main.ts` from Task 3 EXACTLY, then make ONLY these changes:

1. Header comment first line: `Chain ladder, computed by R CHAINLADDER via an Rscript subprocess.`; sibling references updated.
2. Remove `callRemoteMethod` import; add:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rscriptAvailable, runRscript } from "./rscript.js";
```

3. Function name `runChainLadderR`. Preflight becomes:

```ts
  if (!rscriptAvailable()) {
    console.error(
      "chain-ladder-r needs Rscript on PATH.\n" +
        "  brew install r    # then: see tools/interop/README.md (ChainLadder + jsonlite)",
    );
    process.exit(2);
  }
```

4. Add above the function (module scope):

```ts
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUN_MACK = join(REPO_ROOT, "tools", "interop", "run-mack.R");
```

5. The compute tool body (THE ONLY SEMANTIC DIFFERENCE):

```ts
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
```

6. CLI tail prints `engine     rcl:MackChainLadder (alpha=1 == volume-weighted chain ladder)`.

- [ ] **Step 4: Verify live**

Run: `npm test -w @actuarial-ts/example-chain-ladder-r` — expect 7 passed (R was installed in Task 4). `npx tsx examples/chain-ladder-r/src/main.ts` — expect the published numbers. Typecheck clean. Note the R totals will differ from 18,680,856 by well under a dollar (`Math.round` absorbs float-level engine differences).

- [ ] **Step 5: Extend `.github/workflows/r-conformance.yml`**

Add to BOTH `paths:` lists:

```yaml
      - "examples/chain-ladder-r/**"
      - "packages/**"
      - "package-lock.json"
```

Append steps to the `r-conformance` job (after the conformance step):

```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - name: npm ci (workspace + SDK build via prepare)
        run: npm ci
      - name: run-mack.R CLI smoke (literature anchor)
        run: |
          Rscript tools/interop/run-mack.R \
            --in interop/conformance/fixtures/taylor-ashe/triangle.json \
            --selection interop/conformance/fixtures/taylor-ashe/selection.json \
            --out /tmp/r-result.json --created-at 2026-07-19T00:00:00Z
          Rscript -e 'source("tools/interop/actuarialInterchange.R");
            doc <- ats_read_document("/tmp/r-result.json");
            stopifnot(abs(doc$result$totals$unpaid - 18680856) <= 1)'
      - name: Chain-ladder R example (live Rscript)
        run: npm test -w @actuarial-ts/example-chain-ladder-r
```

- [ ] **Step 6: Commit**

```bash
git add examples/chain-ladder-r .github/workflows/r-conformance.yml
git commit -m "feat(examples): chain-ladder-r — Rscript spine + CI leg (task 5)"
```

---

### Task 6: The capstone — three live engines, one referee

**Files:**
- Create: `examples/chain-ladder-crosscheck/package.json` (Task 1's shape; name `...-crosscheck`; description "The interop proof: the same triangle through TypeScript, chainladder-python, and R ChainLadder, refereed pairwise"; dependencies `@actuarial-ts/agents`, `@actuarial-ts/core`, `@actuarial-ts/interchange` — no compliance; devDependencies as Task 1 minus `@mastra/core`, since no judgment chain runs here, but keep `zod` off too — neither is imported)
- Create: `examples/chain-ladder-crosscheck/tsconfig.json` (identical to Task 1's)
- Create: `examples/chain-ladder-crosscheck/src/rscript.ts` — byte-identical copy of Task 5's `src/rscript.ts` (self-containment; the header comment already says so)
- Create: `examples/chain-ladder-crosscheck/src/main.ts`
- Test: `examples/chain-ladder-crosscheck/test/example.test.ts`
- Modify: `.github/workflows/r-conformance.yml` (add the capstone job)

**Interfaces:**
- Produces: `runCapstone(): Promise<CapstoneOutcome>` with

```ts
export interface PairVerdict {
  pair: "ts-vs-python" | "ts-vs-r" | "python-vs-r";
  verdict: string;
  centralComparedCells: number;
}
export interface CapstoneOutcome {
  triangleIntegrity: string;
  sameAppliesTo: boolean;
  pairs: PairVerdict[];
}
```

- Consumes: `callRemoteMethod` (`@actuarial-ts/agents`); `crosscheck`, `parseDocument`, `resultToDoc`, `selectionsToDoc`, `triangleToDoc` (`@actuarial-ts/interchange`); core math; Task 5's helper copy; `run-mack.R`.
- Env contract: needs `SIDECAR_URL` + `SIDECAR_TOKEN` **and** Rscript. Anything missing → exit 2 with both remedies; tests skip loudly unless both are present.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { rscriptAvailable } from "../src/rscript.js";
import { runCapstone } from "../src/main.js";

const ready = rscriptAvailable() && Boolean(process.env.SIDECAR_URL && process.env.SIDECAR_TOKEN);
if (!ready) {
  console.log(
    "SKIP chain-ladder-crosscheck: needs BOTH a live sidecar (SIDECAR_URL/SIDECAR_TOKEN) and Rscript on PATH.\n" +
      "This capstone deliberately computes all three results live — reading committed fixtures would be" +
      " the self-comparison the 2026-07-18 review had removed.",
  );
}

const out = ready ? await runCapstone() : undefined;

describe.skipIf(!ready)("the cross-engine referee over three live engines", () => {
  it("runs all three pairings", () => {
    expect(out!.pairs.map((p) => p.pair).sort()).toEqual(["python-vs-r", "ts-vs-python", "ts-vs-r"]);
  });

  it("every pairing agrees", () => {
    for (const p of out!.pairs) expect(p.verdict, p.pair).toBe("agree");
  });

  it("every agreement actually compared central cells (0.3.0 coverage block)", () => {
    // Without this, `agree` could mean "nothing the profile asked about was
    // examined" — the exact weakness the review found in the old referee.
    for (const p of out!.pairs) expect(p.centralComparedCells, p.pair).toBeGreaterThan(0);
  });

  it("all three documents claim the same triangle", () => {
    expect(out!.sameAppliesTo).toBe(true);
  });
});
```

Run (with both toolchains ready): expect FAIL on missing `../src/main.js`. Without them: SKIP message, exit 0.

- [ ] **Step 2: Write `src/main.ts`**

```ts
/**
 * The interop proof: ONE triangle document, THREE engines computing live —
 * @actuarial-ts/core in-process, chainladder-python over the sidecar, and R
 * ChainLadder via Rscript — then the referee, pairwise. All three results
 * must carry the same appliesTo tags and agree under deterministic-cl.
 *
 * Nothing here reads a committed result fixture: a capstone that compared
 * fixtures would be comparing this repo to itself.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeDevelopmentFactors,
  runChainLadder,
  triangleFromGrid,
  type LdfSelections,
} from "@actuarial-ts/core";
import {
  crosscheck,
  parseDocument,
  resultToDoc,
  selectionsToDoc,
  triangleToDoc,
  type MethodResultDoc,
} from "@actuarial-ts/interchange";
import { callRemoteMethod } from "@actuarial-ts/agents";
import { rscriptAvailable, runRscript } from "./rscript.js";

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

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUN_MACK = join(REPO_ROOT, "tools", "interop", "run-mack.R");

export interface PairVerdict {
  pair: "ts-vs-python" | "ts-vs-r" | "python-vs-r";
  verdict: string;
  centralComparedCells: number;
}
export interface CapstoneOutcome {
  triangleIntegrity: string;
  sameAppliesTo: boolean;
  pairs: PairVerdict[];
}

export async function runCapstone(): Promise<CapstoneOutcome> {
  const sidecarUrl = process.env.SIDECAR_URL;
  const sidecarToken = process.env.SIDECAR_TOKEN;
  if (!sidecarUrl || !sidecarToken || !rscriptAvailable()) {
    console.error(
      "chain-ladder-crosscheck needs a live sidecar AND Rscript:\n" +
        "  PYTHONPATH=interop SIDECAR_TOKEN=dev-secret .venv-interop/bin/python -m sidecar\n" +
        "  brew install r    # then tools/interop/README.md",
    );
    process.exit(2);
  }

  const triangle = triangleFromGrid("paid", ORIGINS, AGES, TAYLOR_ASHE);
  const factors = computeDevelopmentFactors(triangle);
  const allWtd = factors.averages.find((a) => a.spec.key === "all-wtd");
  if (allWtd === undefined) throw new Error("expected an all-wtd average");
  const selections: LdfSelections = { selected: [...allWtd.values], tailFactor: 1 };
  const triangleDoc = triangleToDoc(triangle, { createdAt: CREATED_AT, valuationDate: "2010-12-31" });
  const selectionDoc = selectionsToDoc(selections, {
    triangleDoc,
    createdAt: CREATED_AT,
    intents: selections.selected.map(() => "all-wtd" as const),
    strictness: "refuse",
  }).doc;

  // Engine 1 — TypeScript, in-process.
  const tsDoc = resultToDoc(runChainLadder(triangle, selections), {
    triangleDoc,
    selectionDoc,
    createdAt: CREATED_AT,
    conventionProfile: "deterministic-cl",
    parameters: { selections: "volume-weighted all-period", tailFactor: 1 },
  });

  // Engine 2 — chainladder-python, over the sidecar (replays the intent).
  const remote = await callRemoteMethod(
    { sidecarUrl, method: "Chainladder", headers: { authorization: `Bearer ${sidecarToken}` }, timeoutMs: 120_000 },
    { triangles: { primary: triangleDoc }, selection: selectionDoc },
  );
  if (!remote.success) throw new Error(`sidecar: ${remote.error.code}: ${remote.error.message}`);
  const pyDoc = remote.doc as MethodResultDoc;

  // Engine 3 — R ChainLadder, via Rscript (recomputes the same intent natively).
  const dir = mkdtempSync(join(tmpdir(), "cl-capstone-"));
  let rDoc: MethodResultDoc;
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
    if (!ran.ok) throw new Error(`Rscript: ${ran.code}: ${ran.message}`);
    rDoc = parseDocument(JSON.parse(readFileSync(join(dir, "result.json"), "utf8")), {
      strictness: "refuse",
    }).doc as MethodResultDoc;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // The referee, pairwise. `coverage` is a passthrough field on the report
  // body (not in the typed schema at 0.3.0), hence the structural cast.
  const referee = (pair: PairVerdict["pair"], a: MethodResultDoc, b: MethodResultDoc): PairVerdict => {
    const report = crosscheck({ a, b, selection: selectionDoc, createdAt: CREATED_AT });
    const coverage = (report.report as unknown as {
      coverage?: { central?: { comparedCells?: number } };
    }).coverage;
    return {
      pair,
      verdict: report.report.verdict,
      centralComparedCells: coverage?.central?.comparedCells ?? 0,
    };
  };
  const pairs = [
    referee("ts-vs-python", tsDoc, pyDoc),
    referee("ts-vs-r", tsDoc, rDoc),
    referee("python-vs-r", pyDoc, rDoc),
  ];

  // Compare the two tags field-wise, not via JSON.stringify: R and Python may
  // serialize appliesTo's keys in a different order than TypeScript does.
  const tagOf = (d: MethodResultDoc) => {
    const to = (d as unknown as {
      result: { appliesTo: { triangleIntegrity: string; selectionIntegrity: string | null } };
    }).result.appliesTo;
    return `${to.triangleIntegrity}/${to.selectionIntegrity ?? "-"}`;
  };
  const sameAppliesTo = tagOf(tsDoc) === tagOf(pyDoc) && tagOf(pyDoc) === tagOf(rDoc);

  return { triangleIntegrity: triangleDoc.integrity, sameAppliesTo, pairs };
}

/* c8 ignore start */
if (process.argv[1]?.endsWith("main.ts")) {
  const out = await runCapstone();
  console.log("Taylor & Ashe — one triangle, three engines, one referee\n");
  for (const p of out.pairs) {
    console.log(`  ${p.pair.padEnd(14)} ${p.verdict}  (central cells compared: ${p.centralComparedCells})`);
  }
  console.log(`  same appliesTo ${out.sameAppliesTo}`);
}
/* c8 ignore stop */
```

- [ ] **Step 3: Verify live**

Boot the sidecar (Task 3 Step 3's commands), then:

```bash
SIDECAR_URL=http://127.0.0.1:8091 SIDECAR_TOKEN=dev-secret npm test -w @actuarial-ts/example-chain-ladder-crosscheck
SIDECAR_URL=http://127.0.0.1:8091 SIDECAR_TOKEN=dev-secret npx tsx examples/chain-ladder-crosscheck/src/main.ts
```

Expected: 4 passed; CLI prints three `agree` lines with nonzero compared-cell counts. **If any pairing is not `agree`, STOP and report the full report JSON — do not widen tolerances to get to green.** (Likely causes worth checking first: a profile left at the extractor default, or a selection-integrity mismatch from forgetting `--selection`.)

- [ ] **Step 4: Add the capstone CI job**

Append a second job to `.github/workflows/r-conformance.yml`:

```yaml
  examples-capstone:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: r-lib/actions/setup-r@v2
        with:
          r-version: "4.4"
          use-public-rspm: true
      - name: Cache R packages
        uses: actions/cache@v4
        with:
          path: ${{ env.R_LIBS_USER }}
          key: r-libs-${{ runner.os }}-chainladder-jsonlite-v1
      - name: Install ChainLadder + jsonlite
        run: |
          Rscript -e 'installed <- rownames(installed.packages());
            need <- setdiff(c("ChainLadder", "jsonlite"), installed);
            if (length(need) > 0) install.packages(need, repos = "https://packagemanager.posit.co/cran/__linux__/jammy/latest")'
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Provision + boot the sidecar
        run: |
          python3 -m venv .venv-interop
          .venv-interop/bin/pip install -e interop/python -r interop/sidecar/requirements.txt
          PYTHONPATH=interop SIDECAR_TOKEN=ci-secret nohup .venv-interop/bin/python -m sidecar > sidecar.log 2>&1 &
          echo $! > sidecar.pid
          for i in $(seq 1 60); do
            curl -sf http://127.0.0.1:8091/v1/health && break
            sleep 1
          done
      - name: Capstone — three engines, one referee
        run: npm test -w @actuarial-ts/example-chain-ladder-crosscheck
        env:
          SIDECAR_URL: http://127.0.0.1:8091
          SIDECAR_TOKEN: ci-secret
      - name: Sidecar log on failure
        if: failure()
        run: cat sidecar.log || true
      - name: Teardown
        if: always()
        run: kill "$(cat sidecar.pid)" 2>/dev/null || true
```

Also add `examples/chain-ladder-crosscheck/**` to both `paths:` lists. Before committing, compare the sidecar-boot block against the one in `py-conformance.yml` and align any drift (pip flags, poll loop) toward the existing convention.

- [ ] **Step 5: Commit**

```bash
git add examples/chain-ladder-crosscheck .github/workflows/r-conformance.yml
git commit -m "feat(examples): chain-ladder-crosscheck — three live engines, one referee (task 6)"
```

---

### Task 7: Root scripts + full verification

**Files:**
- Modify: `package.json` (root — scripts only)

- [ ] **Step 1: Add the four scripts**

In root `package.json` `scripts`, after the existing `"example"` line (which MUST NOT change):

```json
    "example:cl-ts": "npm run example -w @actuarial-ts/example-chain-ladder-typescript",
    "example:cl-py": "npm run example -w @actuarial-ts/example-chain-ladder-python",
    "example:cl-r": "npm run example -w @actuarial-ts/example-chain-ladder-r",
    "example:cl-crosscheck": "npm run example -w @actuarial-ts/example-chain-ladder-crosscheck",
```

- [ ] **Step 2: Full verification sweep**

```bash
npm run typecheck                 # every workspace clean
npm test                          # all suites; py/r/capstone example suites SKIP (no env) but their files load
npm run example                   # UNCHANGED reserve-review output (README contract)
npm run example:cl-ts             # published numbers, referee agree
# with sidecar booted + env set:
npm run example:cl-py
npm run example:cl-r
npm run example:cl-crosscheck     # three agree lines
```

Every command must exit 0 with the described output. If `npm test`'s total count changed for the pre-existing suites, something regressed — stop and report.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(examples): root scripts for the chain-ladder trilogy + capstone (task 7)"
```

---

## Self-Review Notes (already applied)

- Spec §8's "ledger entries carry the context-set actorIdentity" is implemented against the **trail** (`outcome.trail[].actorIdentity`) — at 0.3.0 `AssumptionEntry` has no identity field; the spec is being corrected in the same commit as this plan.
- Spec §5.1's `run-mack.R` gained a `--profile` argument (default `deterministic-cl`): R has only a Mack extractor, whose profile default (`mack1993-vw`) would make the capstone's pairings not-comparable. `MackChainLadder(alpha = 1)` central results ARE the volume-weighted chain ladder, so the profile claim is honest; SEs in the R document are simply out of deterministic-cl's scope.
- The R example passes `--selection` so all three documents carry the same `appliesTo.selectionIntegrity`. R records the tag without replaying values — the comments in Task 5/6 state this explicitly.
- `coverage` is a `.passthrough()` field, not part of the typed `CrosscheckBody` — both consumers access it through a structural cast with a comment saying why.
- No `absoluteTolerance` is set: Taylor & Ashe's fully-developed origin has exactly-zero unpaid on all three engines (the both-zero guard applies), and `crosscheck-ci.mts` has run this comparison green without a floor.
- Spec §5.4's pinning decision, resolved: this plan ACCEPTS the floating-CRAN posture the 0.3.0 workflow chose (R pinned to 4.4, ChainLadder/jsonlite latest with a cache) and reuses the identical install step in the capstone job — one posture, not a third.
