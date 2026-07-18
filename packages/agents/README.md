# @actuarial-ts/agents

Mastra agent toolkit for the actuarial-ts SDK: typed actuarial tools with a hard tenant seam, human-gated judgment workflows that write the compliance assumption ledger, a four-gate study-promotion chain (`promoteStudy`), a remote-engine bridge (`defineRemoteMethod`) with a referee divergence explainer, a fail-closed MCP tenant seam, a reserving advisor factory, and a golden-prompt eval harness.

The package generalizes the agent architecture proven in the ActNG reserving workbench. Its core idea: when an agent participates in an actuarial analysis, the documentation ASOP 41 asks for should fall out of RUNNING the analysis, not be reconstructed afterwards. Judgment chains built here write an `@actuarial-ts/compliance` assumption ledger as decisions are made, so a completed chain hands back a ledger ready for `generateDisclosure`.

These utilities are designed to support the actuary's compliance with the ASOPs; responsibility for compliance remains with the credentialed actuary.

## Install

```sh
npm install @actuarial-ts/agents @mastra/core zod
# plus @mastra/mcp if you use the MCP surface:
npm install @mastra/mcp
```

`@mastra/core` (>= 1.49, < 2), `zod` (^3.25), and `@mastra/mcp` (>= 1.14, < 2) are peer dependencies: the HOST application owns the Mastra version. `@mastra/mcp` is only needed if you use the MCP surface. `@actuarial-ts/core`, `@actuarial-ts/interchange`, `@actuarial-ts/data`, and `@actuarial-ts/compliance` are regular dependencies, installed for you.

## Security model

The tenant id (project id) reaches tools ONLY via the server-set request context, never from the model. The package enforces the seam at both ends:

- `tenantOf(context, key = "projectId")` reads the tenant from `context.requestContext`, set server-side from the authenticated request. Missing, non-string, or empty ids throw a typed `AgentsError("NO_TENANT_CONTEXT")`, which the tool wrapper converts to a failure envelope.
- `defineActuarialTool` REJECTS, at definition time, any input schema declaring a tenant-id key (`projectId`, `tenantId`, `project_id`, ... in any casing) with `AgentsError("TENANT_IN_SCHEMA")`. The model must not even be able to express a tenant id.

Tools never throw into the model. Anything the tool body throws becomes:

```ts
{ success: false, error: { code: string, message: string } }
```

Errors carrying a string `code` property (HTTP-style coded errors, `AgentsError`, `ComplianceError`) keep their code so the agent can recover deliberately: retry with adjusted parameters, suggest an alternative, or ask.

```ts
import { defineActuarialTool, tenantOf, toolRegistry } from "@actuarial-ts/agents";
import { z } from "zod";

const getOverview = defineActuarialTool({
  id: "get_workspace_overview",
  description: "Orient yourself in the workspace",
  kind: "read", // or "action" for state-mutating tools
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const projectId = tenantOf(context);
    return { success: true, ...loadOverview(projectId) };
  },
});

const { tools, actionToolIds } = toolRegistry([getOverview /* , ... */]);
// tools     -> Record keyed by id, ready for new Agent({ tools })
// actionToolIds -> the host client refreshes after these run
```

## Judgment chains: propose, justify, approve, record

`createJudgmentChain` turns an ordered list of `JudgmentGateSpec`s into a committed Mastra workflow that pauses at EVERY actuarial judgment:

1. **Propose.** The gate gathers evidence through your service layer and suspends with `{ stage, recommendation, evidence }`.
2. **Justify and approve.** A human decides; the resume payload carries the decision plus a VERBATIM rationale (schemas without a `rationale` key are rejected at definition time; blank rationales fail the gate at runtime).
3. **Record.** `applyDecision` applies the decision through your service layer and returns the assumptions it fixed; the chain appends them to the threaded ledger with the rationale, the actor from the payload's optional `actor` field (default `"actuary"`), and a timestamp from the host-injected `now()` (the package never reads a clock).

A gate may also self-skip (`skipWhen`) based on earlier gates' decisions, recording a skip note in the trail - the shape the ActNG ELR derivation uses when the cap gate chose to stay unlimited and the restoration gate becomes moot.

```ts
import { createJudgmentChain } from "@actuarial-ts/agents";
import { generateDisclosure } from "@actuarial-ts/compliance";
import { Mastra } from "@mastra/core/mastra";

const chain = createJudgmentChain({
  id: "derive-expected-losses",
  gates: [capGate, ilfGate, trendGate, elrGate],
  now: () => new Date().toISOString(), // the host owns the clock
  onComplete: async ({ trail, ledger }, ctx) => {
    persistTrailNote(tenantOf(ctx), trail, ledger);
  },
});

// Register for snapshot storage (suspend/resume state lives there; durable
// storage keeps paused chains resumable across restarts).
const mastra = new Mastra({ workflows: { chain }, storage });

const run = await mastra.getWorkflow("chain").createRun();
let state = await run.start({ inputData: {}, requestContext }); // suspended at gate 1
state = await run.resume({
  step: "cap-gate",
  resumeData: { decision: "accept", cap: 150_000, rationale: "volatile large losses distort development" },
  requestContext,
});
// ... resume each gate; the final result is { trail, ledger }
```

### The ledger fusion

The completed chain's `ledger` is a real `@actuarial-ts/compliance` `AssumptionLedger`: every human decision is an `AssumptionEntry` with actor, verbatim rationale, and caller-supplied timestamp. Feed it straight into the disclosure pipeline:

```ts
const { trail, ledger } = finalResult;
const disclosure = generateDisclosure({
  metadata,   // EstimateMetadata for the analysis
  methods,    // MethodUse[]
  ledger,     // the chain's fused ledger, judgments and rationales included
  sdkVersion,
  generatedAt: now(),
});
```

ASOP 41 assumptions-and-judgments documentation as a side effect of running the analysis.

### Footgun: workflows are accidental thenables

A Mastra `Workflow` exposes a `.then(step)` builder method, so `await chain` (or returning a workflow from an `async` function) makes JavaScript treat it as a thenable and the promise NEVER settles. Assign the chain synchronously and register it on your Mastra instance.

## Reserving advisor factory

`createReservingAdvisor` assembles an `@mastra/core` Agent on a hardened base instruction template: professional grounding, every-number-from-a-tool-result, read-before-recommend ordering, action consent, failure recovery, and selection-of-ultimates weighting guidance. Host domain sections splice in between the base analytics and the conduct section.

The template is auditable by construction: `BASE_INSTRUCTIONS` exports the named sections and `assembleInstructions` is a pure deterministic string function, so hosts can byte-inspect (and snapshot-test) the exact prompt their agent runs on.

```ts
import { createReservingAdvisor, assembleInstructions } from "@actuarial-ts/agents";

const advisor = createReservingAdvisor({
  model: anthropic("claude-sonnet-4-5"),
  tools,
  memory,
  domainInstructions: [ldfSelectionGuide, cappingGuide, tailGuide],
});

// What is this agent actually running on? Byte-inspect it:
const prompt = assembleInstructions({ domainInstructions: [ldfSelectionGuide, cappingGuide, tailGuide] });
```

## Eval harness

`runToolSelectionEvals` asserts tool SELECTION, not prose: each golden case lists the tools that must appear among the turn's calls. Running against a real agent costs live API tokens, so keep it opt-in (an env flag in a script, never in package tests).

```ts
import { runToolSelectionEvals } from "@actuarial-ts/agents";

const report = await runToolSelectionEvals({
  agent: advisor,
  requestContext,
  cases: [
    { id: "cap-evidence", prompt: "Should we cap this book? Check the claim-size evidence first.", expectTools: ["analyze_claim_sizes"] },
    { id: "elr-select", prompt: "Select an expected loss ratio of 65%.", expectTools: ["set_elr"] },
  ],
  timeoutMs: 180_000, // a stalled stream fails the case, not the suite
});
// report.results: per-case { id, pass, called, missing, error? }
// report.summary: { total, passed, failed }
```

The `agent` parameter is typed structurally (anything with a `stream()` yielding a `fullStream`), so the harness itself is testable with a stubbed agent and canned chunks - no LLM, no network.

## License

Apache-2.0. See LICENSE and NOTICE.
