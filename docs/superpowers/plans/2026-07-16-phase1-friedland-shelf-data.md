# Phase 1: Friedland Shelf + Data Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the deterministic Friedland shelf in `@actuarial-ts/core` (Benktander, frequency-severity, Generalized Cape Cod, factor-correlation test, Mack residuals) and ship `@actuarial-ts/data` (ingestion + ASOP 23 data review), then surface the new methods in the workbench selection matrix at default weight 0 (no numeric change to existing blends).

**Architecture:** New methods follow the existing grammar exactly (pure fn, options object, warnings channel, ReservingError). Benktander composes the validated CL and BF results. GCC is a `decay` option on `runCapeCod` (default 1 = byte-identical standard Cape Cod). The data package copies core's build mechanics; zero deps (in-house RFC 4180 CSV). A parallel research workflow (`phase1-literature-research`) is transcribing Mack 2000 / Mack 1994 correlation / Gluck 1997 for published-value fixtures; identity and property tests land first, published pins added when transcription returns.

**Tech Stack:** same as Phase 0.

## Global Constraints

(Master plan Global Constraints apply. Plus: new SELECTION_METHODS entries get default weight 0 so every existing analysis blend is numerically unchanged.)

---

### Task 1: `runBenktander` (core)

**Files:** Create `packages/core/src/benktander.ts`; modify `src/index.ts`, `src/types.ts`; test `packages/core/test/benktander.test.ts`.

**Interfaces:** `runBenktander(chainLadder: ChainLadderResult, bf: BornhuetterFergusonResult): BenktanderResult` — per BF row: q = 1 − 1/cdf; ultimate U_GB = latestValue + q·U_BF (equivalently (1−q)·U_CL + q·U_BF). Rows = BF's rows (BF already excluded no-premium origins, warn passthrough). Result rows {origin, latestValue, cdf, credibilityZ: 1−q, bfUltimate, clUltimate, ultimate, unpaid}; totals; warnings. Throws SHAPE when a BF origin is missing from CL.

- [ ] Failing tests: identity U_GB = (1−q)·U_CL + q·U_BF per row on the Taylor/Ashe fixture (BF built from synthetic exposures); q→0 (cdf→1, mature) collapses to latest≈CL; Mack 2000 published example pinned once research returns
- [ ] Implement; suite green; commit

### Task 2: `runFrequencySeverity` (core)

**Files:** Create `packages/core/src/freqSev.ts`; modify `src/index.ts`; test `packages/core/test/freqSev.test.ts`.

**Interfaces:**
- `severityTriangle(lossTri: Triangle, countTri: Triangle): Triangle` — cell-wise safeRatio (null-safe), kind preserved from lossTri with a "severity" marker in… keep Triangle.kind untouched (it is a TriangleKind union); severity triangles are plain Triangles built by the caller for factor work.
- `runFrequencySeverity(lossTri, countTri, opts: { countSelected: (number|null)[], countTailFactor?: number, severitySelected: (number|null)[], severityTailFactor?: number }): FrequencySeverityResult` — CL on counts, CL on the derived severity triangle, ultimate_i = ultCounts_i × ultSeverity_i. Rows {origin, latestValue (loss), ultimateCounts, ultimateSeverity, ultimate, unpaid}; warns per CL conventions plus a CWP-mix caveat.

- [ ] Failing tests: constant-severity property (severity S everywhere ⇒ ultimate = S × ultimate counts and equals CL on losses when factors align); null-safety (missing count cells); warning passthrough
- [ ] Implement; suite green; commit

### Task 3: Generalized Cape Cod decay (core)

**Files:** Modify `packages/core/src/elrMethods.ts`; test `packages/core/test/elrMethods.test.ts`.

**Interfaces:** `runCapeCod(rows, opts: { baseIsPurePremium?: boolean; decay?: number })` — decay D ∈ (0, 1]; per-origin ELR_i = Σ_j lossAdj_j·reported_j·D^|i−j| / Σ_j usedUp_j·D^|i−j| (row-index distance); result rows gain `elrAtTargetLevel` per origin when D < 1; `elrAtTargetLevel` (scalar) becomes the D=1 value or premium-weighted summary with a doc note. D=1 path must remain byte-identical (no new floats in the existing loop). Throws BAD_ADJ on D ≤ 0 or > 1.

- [ ] Failing tests: decay=1 exactly equals current runCapeCod on existing fixtures; decay→small ⇒ each origin's ELR → its own reported/usedUp; monotone blend property; Gluck formulation cross-checked when research returns
- [ ] Implement; suite green; commit

### Task 4: Factor-correlation test + Mack residuals (core diagnostics)

**Files:** Modify `packages/core/src/diagnostics.ts`, `src/index.ts`; test `packages/core/test/diagnostics.test.ts` (create if absent).

**Interfaces:**
- `factorCorrelationTest(tri: Triangle): { statistic: number|null, variance: number|null, bounds50: [number, number]|null, correlated: boolean|null, pairs: number, warnings: string[] }` — Mack's Spearman T over adjacent factor columns, weights per the paper (research confirms exact weighting), 50% normal interval decision.
- `mackResiduals(tri: Triangle): { byCell: { origin: string, age: number, residual: number|null }[], byCalendar: Record<string, number[]>, warnings: string[] }` — r_{ik} = (F_{ik} − f_k)·√C_{ik}/σ_k around volume-weighted factors, reusing mack.ts σ² estimation (export a shared helper rather than duplicating).

- [ ] Failing tests: deterministic multiplicative triangle ⇒ residuals ≈ 0 and correlation test null-safe; published Mack worked example pinned when research returns; synthetic correlated triangle flagged
- [ ] Implement (share σ² helper with mack.ts, no duplication); suite green; commit

### Task 5: `@actuarial-ts/data` package

**Files:** Create `packages/data/package.json` (mirror core's shape, name `@actuarial-ts/data`, dependency `@actuarial-ts/core": "0.1.0"` via workspace `*`), `tsconfig.json`, `tsconfig.build.json`, `LICENSE`, `NOTICE`, `README.md`, `src/index.ts`, `src/csv.ts`, `src/lossRun.ts`, `src/longFormat.ts`, `src/review.ts`; tests under `packages/data/test/`.

**Interfaces:**
- `parseCsv(text: string): string[][]` — RFC 4180 subset: quoted fields, escaped quotes, CRLF/LF, BOM strip. No streaming (loss runs fit memory).
- `parseLossRunCsv(text: string): { claims: ClaimSnapshot[], errors: RowError[] }` — same column contract as the workbench (`claim_id, accident_date, report_date, evaluation_date, paid_to_date, case_reserve, status`), row-numbered errors, cross-field date checks; collects errors instead of throwing (the caller decides).
- `triangleFromLongFormat(rows: { origin: string, age: number, value: number|null }[], opts: { kind: TriangleKind }): Triangle` — validates rectangularity, sorts origins/ages, fills unobserved with null.
- `reviewClaimData(claims: ClaimSnapshot[], opts?: { asOfDate?: string }): DataReviewReport` and `reviewTriangles(paid: Triangle, incurred: Triangle): DataReviewReport` — ASOP 23-oriented checks (negative paid/case, cumulative paid decreasing per claim, date-order violations, duplicate claim+evaluation rows, paid>incurred cells, negative incrementals, interior missing cells, calendar-diagonal outliers), each check → { id, description, status: "pass"|"warning"|"fail", details: string[] }; report carries `checksPerformed`, `issues`, `summary` for the Phase 2 disclosure generator.
- Root package.json workspaces already covers `packages/*`; add root scripts inclusion (test script covers workspaces? update root test to `--workspaces --if-present` style).

- [ ] Failing tests first (CSV edge cases incl. quotes/BOM/CRLF; loss-run row errors with row numbers; long-format round-trip vs triangleFromGrid; review checks fire on seeded-bad fixtures and pass on clean data)
- [ ] Implement; suite green; commit

### Task 6: Workbench integration (methods at weight 0) + dogfood data package

**Files:** Modify `apps/server/src/db/repo.ts` (SelectionMethodKey union += "gbPaid" | "gbIncurred" | "freqSev"), `apps/server/src/services/workspaceService.ts` (SELECTION_METHODS labels; runFullAnalysis computes GB paid/incurred from existing CL+BF and freq-sev with documented vw-count/vw-severity convention + warning; ultimates wired into the selection entry; default weights for new keys = 0), `apps/server/src/routes/workspace.ts` patch schema if method keys are enumerated, `apps/server/src/mastra/advisor.ts` (one line in the selection-of-ultimates guidance naming the new methods), `apps/server/src/services/importService.ts` (CSV path delegates to `@actuarial-ts/data` parseLossRunCsv; xlsx stays local), `apps/server/package.json` (+`@actuarial-ts/data`).

- [ ] Verify legacy analyses tolerate missing keys (`entry.ultimates[m.key] ?? null` path) — add server test: stored pre-phase analysis record renders matrix with nulls for new methods and identical blended totals (weight 0)
- [ ] Implement; server suite green; live smoke (run analysis on seed project, matrix shows 12 methods, blend unchanged when new weights 0)
- [ ] Commit

**DEVIATION (recorded 2026-07-17):** importService CSV delegation to `@actuarial-ts/data` is deferred to Phase 4's dogfood pass. Reason: importService's throw-with-all-row-problems contract is pinned by server tests and shared with the xlsx path; rewiring it mid-phase risks a stable surface for zero user-visible gain. The data package's `parseLossRunCsv` mirrors the semantics under its own tests.

### Task 7: Published-value pins + phase gate

- [ ] Fold research-workflow results into fixtures (Mack 2000 Benktander example, Mack 1994 correlation worked example, Gluck formulation check); adjust implementations if transcription contradicts them
- [ ] Full regression: root typecheck + all tests + workbench boot smoke + eval-advisor NOT run (cost; unchanged advisor surface is covered by server tests)
- [ ] Update master progress log; /ship
