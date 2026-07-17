# Interop Phase B: Governance Flows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The governed seams: wrapped reproducibility bundles openable in Python, notebook studies promotable into ledgered judgments through a Mastra judgment chain, and cross-implementation verification rendered in ASOP 41 disclosures. Spec authority: docs/superpowers/specs/2026-07-17-actuarial-interchange-design.md rev 2.1 sections 3.2 (BundleDoc, StudyDoc, CrosscheckReportDoc), 4.2 (load_bundle/save_study), 5 (disclosure integration), 6 (the promotion chain, entire), 9.6 (contract-test split), 13 Phase B acceptance.

**Sequencing:** B1 (compliance/interchange TS) ∥ B2 (agents promoteStudy). Then B3 (Python load_bundle; consumes B1's fixtures) ∥ B4 (workbench Import Study; consumes B2). Then review + gates + /ship.

## Global Constraints
(Master plan constraints; spec rev 2.1 normative; existing suites stay green; readability-first layout; no LLM needed for any test.)

### Task B1: wrapped bundles + disclosure Section 4b (compliance + interchange)
- interchange: bundle schema already models { bundle, interchange: { triangles, selections, results } } with the outer tag — verify against spec 3.2 (results INCLUDED) and extend if the Phase A schema stubbed it.
- compliance: `createBundle` gains `wrap: { triangles, selections, results }` option emitting the wrapped BundleDoc (outer integrity over { bundle, interchange }); `verifyBundle` wrapped mode checks inner exactly as today AND the outer tag. v0.1.x compat fixture untouched.
- compliance: `generateDisclosure` gains optional `crossImplementation: CrosscheckReportDoc[]` rendering "Section 4b — Cross-implementation verification" with the REQUIRED boilerplate (spec 5 verbatim: supports, does not constitute, ASOP 56 model validation; model appropriateness a separate judgment) and verified-by-value verdicts rendered as exactly that. Golden snapshot updated once, diff inspected.
- Tests: wrapped round-trip + outer-tag tamper detection + wrapped-mode verify; disclosure 4b golden + determinism + boilerplate-presence + never-ASOP-approved.

### Task B2: promoteStudy judgment chain (agents)
Per spec section 6 EXACTLY: gates study-intake (schema validate via interchange parseDocument; ASOP 23 review via @actuarial-ts/data on each study triangle; coherence verification; segment resolution one-selection-per-segment with named-error blocks; tolerance ceiling: effective = min(study, host); prominent evidence display incl. >10x-profile-default flag), replay-verify (table-exact intents replayed via interchange docToSelections/core; approx/value-only labeled verified-by-value; referee vs supportingResults when present at effective tolerance; disagree HARD-BLOCKS via gate logic — resume cannot accept; absent supportingResults documented in evidence), rationale (draft assembled from narrative — template path only in this phase, agent-drafting hook left as an injection point; resume REQUIRES non-empty trimmed rationale + attestation field), apply (host-adapter interface: { applySelections, runAnalysis, persistNote } — the workbench adapter arrives in B4; ledger entries carry source = sourceRef + integrity + effective tolerance).
API: `promoteStudy(deps, studyDoc, { toleranceCeiling, actorDefault, now })` returning the started chain per createJudgmentChain conventions. New module packages/agents/src/promotion.ts + tests (contract tests per spec 9.6: schema round-trip, gate-sequence enforcement, Gate-2 hard-block on a seeded disagree, ceiling intake failure, verified-by-value labeling, ledger contents incl. attestation verbatim). deps: @actuarial-ts/interchange + data added to agents package.json.

### Task B3: Python load_bundle (+ save_study round-trip proof)
`load_bundle(path_or_dict)` verifying the outer tag, returning triangles as cl.Triangle (via existing bridge), selections, and results as DataFrames; refuses tag mismatch. Fixture: a B1-authored wrapped bundle committed under interop/python/tests/fixtures/. save_study already exists — add a study→promotion-shaped round-trip test (parse on TS side happens in B4's e2e).

### Task B4: workbench Import Study + e2e
Server: POST /api/projects/:id/studies/import (multipart JSON) starting promoteStudy with the workbench adapter (patchWorkspace/runFullAnalysis/insertNote; segment rule: single-segment workspace = the only target); gates surface through the EXISTING advisor-gate SSE/UI mechanics (reuse derive-elr patterns; tools stage_study/advance_promotion NOT exposed to the model in this phase — the UI drives). Web: Import Study panel (upload → gate cards → rationale editor with attestation checkbox → done state showing ledger note). Extend the cross-restart proof scripts with a paused-promotion phase. E2E acceptance: the spec 13 Phase B walkthrough against a REAL Jupyter-exported study (author one via the Python package in a scratch notebook-format script; commit as a demo fixture).

### Task B5: review + gates + /ship
3-lens adversarial review (spec-acceptance incl. the walkthrough, governance-integrity — can promotion be gamed?, code quality), fixes, cold start + both CI workflows, master log, /ship.
