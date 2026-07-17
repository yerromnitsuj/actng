# Phase 4: @actuarial-ts/agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize ActNG2's proven agent architecture into `@actuarial-ts/agents`: a Mastra toolkit whose judgment workflows write the compliance ledger, so agent-assisted analyses produce ASOP 41 documentation as a side effect of running. Dogfood: the ActNG2 server consumes the package with zero behavior change.

**Architecture:** Peer-depend on `@mastra/core` (>= 1.49) and `zod` (the HOST app owns the Mastra version); regular deps on `@actuarial-ts/core` + `@actuarial-ts/compliance`. Everything testable without an LLM: tool factories exercise via direct `execute` calls; judgment chains run programmatically exactly like the server's existing workflow integration test. Verify every Mastra call shape against the installed `node_modules/@mastra/core` d.ts per house rule.

## Global Constraints

(Master plan Global Constraints apply. Plus: the dogfood refactor must keep ALL existing server tests green with unchanged tool ids, envelopes, and behavior — it is a proof, not a rewrite. The security seam is non-negotiable: tenant ids only via RequestContext, never in input schemas.)

---

### Task 1: Tool factory + registry (`src/tools.ts`)

- `ToolEnvelopeFailure = { success: false; error: { code: string; message: string } }` and `envelopeFailure(err, fallbackCode?)` helper (maps Error-with-code shapes; never throws).
- `tenantOf(context, key = "projectId"): string` — reads requestContext, throws a typed `AgentsError("NO_TENANT_CONTEXT")` when absent (the wrapper converts it to an envelope).
- `defineActuarialTool({ id, description, kind: "read" | "action", inputSchema, execute })` → Mastra `createTool` result whose execute NEVER throws into the model (try/catch → envelope) and never accepts tenant ids in `inputSchema` (runtime assertion: reject schemas containing a `projectId`/`tenantId` shape key — the lint the security seam deserves).
- `toolRegistry(tools)` → `{ tools: Record<string, Tool>, actionToolIds: Set<string> }` (drives client refresh semantics, mirroring ACTION_TOOL_IDS).
- Tests: envelope on throw, tenant read/missing, schema-key rejection, registry classification.

### Task 2: Judgment gates that write the ledger (`src/judgment.ts`)

- `JudgmentGateSpec<TDecision>`: `{ id, stage, resumeSchema (zod, must include rationale: string), gatherEvidence(ctx) → { recommendation: string, evidence: unknown }, applyDecision(ctx, decision) → Promise<{ ledgerEntries?: NewAssumptionEntry[] }>, skipWhen?(ctx) → string | null (skip reason) }` where ctx carries `{ requestContext, now(): string }` — `now` injected by the host for the ledger timestamps (purity).
- `createJudgmentChain({ id, gates, onComplete })` → a committed Mastra workflow (`createWorkflow().then(gate1)...commit()`) where each gate suspends with `{ stage, recommendation, evidence }`, resumes with the decision + verbatim rationale, appends `AssumptionEntry` records (actor from the resume payload: "actuary" by default, host-overridable) into a running ledger threaded through step outputs, and returns `{ trail, ledger }`. The compliance fusion is THE deliverable: a completed chain hands back a ledger ready for `generateDisclosure`.
- Tests: programmatic run of a 2-gate chain (suspend → resume → suspend → resume → success) asserting the ledger entries carry rationale/actor/timestamps and skip gates record a skip note; malformed resume (missing rationale) rejects.

### Task 3: Advisor factory + eval harness (`src/advisor.ts`, `src/evals.ts`)

- `createReservingAdvisor({ id?, name?, model, tools, memory?, domainInstructions?, conductInstructions? })` → Mastra Agent assembled from the hardened base template: professional grounding, "every number from a tool result", read-before-recommend ordering, action-consent semantics, failure-recovery rules, selection-of-ultimates weighting guidance — with host-supplied domain sections spliced in. Export the template pieces (`BASE_INSTRUCTIONS`) so hosts can audit exactly what their agent runs on.
- `runToolSelectionEvals({ agent, cases: { id, prompt, expectTools }[], requestContext, maxSteps?, timeoutMs? })` → per-case pass/fail with tools-actually-called (generalizes apps/server/scripts/eval-advisor.ts). Live-model by design; NOT run in package tests.
- Tests: instruction assembly (sections present, no template literals broken), harness case bookkeeping with a stubbed agent object.

### Task 4: Dogfood — ActNG2 server consumes the package

- `apps/server/src/mastra/tools.ts`: `projectIdOf`/`failure`/ToolFailure replaced by `tenantOf`/`envelopeFailure` imports; each `createTool` call migrates to `defineActuarialTool` with explicit `kind`; ACTION_TOOL_IDS derives from `toolRegistry`. Tool ids, schemas, messages: UNCHANGED.
- `apps/server/src/mastra/advisor.ts`: assembled via `createReservingAdvisor` with the existing instruction content as domain sections (byte-diff the resulting instructions against the current prompt — allowed to differ only in section ordering markers; ideally identical).
- `apps/server/src/mastra/elrWorkflow.ts`: re-expressed through `createJudgmentChain` with its 4 gates and the ilf skip; the completion note now ALSO persists the compliance ledger JSON alongside the trail note.
- importService CSV path delegates to `@actuarial-ts/data` (the Phase 1 deferral lands here).
- Gate: all server tests green (incl. the 4-gate workflow integration test and cross-restart resume proof), eval harness smoke (1 case) against the live model if ANTHROPIC_API_KEY present, else skipped.

### Task 5: Package gate

Scaffold mechanics (mirror compliance; root prepare gains `-w @actuarial-ts/agents` AFTER core/data/compliance), README (security model, propose→justify→approve→record, the ledger fusion, eval harness), cold start, commit, master log, /ship with CI watch.
