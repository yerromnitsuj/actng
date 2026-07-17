# Phase 2: @actuarial-ts/compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The compliance layer no other actuarial library has: typed estimate metadata, an assumption ledger separating machine defaults from judgment, an ASOP 41 disclosure generator, ASOP 56 model cards for every shipped method, reproducibility bundles, actual-vs-expected roll-forward, and a valuation-over-valuation change report.

**Architecture:** Pure, deterministic, browser-safe (no node builtins, no clock reads — timestamps are caller-supplied inputs). Depends on `@actuarial-ts/core` only; consumes `@actuarial-ts/data`'s review report through a STRUCTURAL interface (no package dependency). Package mechanics identical to data (root prepare gains `-w @actuarial-ts/compliance` after core/data). Everything the generator writes is derived from typed inputs, so identical inputs yield byte-identical markdown (golden-file tested).

**Tech Stack:** same as Phase 1.

## Global Constraints

(Master plan Global Constraints apply. Plus: the generator's boilerplate must use the sanctioned ASOP positioning phrase and NEVER "ASOP-approved"/"ASOP-compliant software". Disclosure templates carry an `asopEditionNote` so future ASOP 41/13 revisions can version the language.)

---

### Task 1: Package scaffold + estimate metadata types (`src/metadata.ts`)

`EstimateMetadata`: intendedPurpose (required string), intendedUsers?, intendedMeasure (required: {kind: "central-estimate"|"high-estimate"|"low-estimate"|"specified-percentile"|"range", percentile?}), basis {grossNet: "gross"|"net-of-reinsurance"|"net-of-salvage-subro"|"net-all", laeTreatment: "excluding-lae"|"including-all-lae"|"dcc-only"|"aao-only"}, accountingDate/valuationDate (required ISO), reviewDate?, scopeNotes?, currency?. `validateMetadata(m)` returns string[] problems (empty = valid) — validation not construction, so partially-known metadata can be built up. Tests: required-field detection, percentile coherence.

### Task 2: Assumption ledger (`src/ledger.ts`)

`AssumptionEntry`: {seq (assigned), timestamp (caller-supplied ISO — purity), actor: "default"|"actuary"|"agent", field (dotted path), value (JSON), previousValue?, source?, rationale? — REQUIRED (validation error) when actor !== "default"}. `createLedger()`, `recordAssumption(ledger, entry)` → NEW ledger (immutability tested), `judgmentEntries(ledger)` (actor !== default), `changedAssumptions(prior, current)` → the ASOP 41 change-disclosure diff (added/removed/value-changed by field, latest entry per field wins). Tests: immutability, rationale enforcement, diff semantics.

### Task 3: Model cards (`src/modelCards.ts`)

`MODEL_CARDS: Record<MethodId, ModelCard>` for: chainLadder, mack, bornhuetterFerguson, benktander, capeCod (incl. the Gluck decay generalization), expectedClaims, frequencySeverity, berquistCaseAdequacy, berquistSettlement, tailFitting, capeCodDecayNote folded into capeCod, capping/ilf, trend, onLevel. Card: {method, title, intendedUse, specification (the math, prose), keyAssumptions[], weaknesses[], sensitivities[], literature[]}. Content transcribed from the core doc-blocks + the primary sources already pinned in tests. Test: a card exists for every method id the disclosure generator recognizes; no empty sections.

### Task 4: Disclosure generator (`src/disclosure.ts`)

`generateDisclosure(input: DisclosureInput): string` (markdown). DisclosureInput: {title?, metadata: EstimateMetadata, preparedBy? (identification), methods: MethodUse[] ({methodId, basisLabel?, parameters (JSON-able), resultSummary? ({ultimate, ibnr?, unpaid?, standardError?})}), ledger?, dataReview? (STRUCTURAL: {checks: {id, description, status, details}[], summary}), priorComparison? (changedAssumptions output + prior/current reserve), reliances? (string[]), limitations? (string[]), sdkVersion, generatedAt (caller-supplied ISO)}. Sections: 1 Identification & intended purpose/users/measure; 2 Scope, dates, basis; 3 Data review (checks performed/found; reliance-on-others statements); 4 Methods & models (per method: card intendedUse + parameters table + result summary); 5 Assumptions & judgments (ledger table: defaults vs judgment with rationale + source); 6 Changes from the prior analysis; 7 Reliances & limitations; 8 Reproducibility statement (sdkVersion + bundle hash when provided); 9 the standards note (sanctioned phrase + "prepared to support disclosures under ASOP Nos. 41, 43, 23, 56"). Deterministic; golden-file snapshot test + determinism test (two calls byte-equal).

### Task 5: Reproducibility bundle (`src/bundle.ts`)

`canonicalJson(value)` (sorted keys, stable arrays, no whitespace variance); `fnv1a64(text)` (tiny non-crypto integrity hash, documented as NOT security); `createBundle({inputs, parameters, results, sdkVersions, seeds?, createdAt})` → {payload (canonical string), hash}; `verifyBundle(bundle, rerunResults)` → {reproduced: boolean, mismatchPath?} comparing canonical results. Tests: key-order independence, round-trip, mismatch path reporting.

### Task 6: Actual-vs-expected roll-forward (`src/ave.ts`)

`aveRollForward(rows: {origin, priorUltimate, priorLatest, currentLatest, expectedPercentAtPrior, expectedPercentAtCurrent}[])` → per-origin {expectedEmergence = priorUltimate x (pctB - pctA), actualEmergence = currentLatest - priorLatest, difference, ratio (null when expected 0)} + totals + warnings (pctB < pctA, percents outside [0, ~1.05]). Helper `percentDevelopedFromCdfs(ages, cdfVector, tail)` → percent developed per age for pattern-based callers. Tests: hand-computed example; zero-expected null ratio; warning triggers.

### Task 7: Package gate

Root prepare gains `-w @actuarial-ts/compliance`; README (positioning + quickstart building a disclosure from a core run); cold-start (rm node_modules + dist, install, full tests); commit; master log; /ship with CI watch.
