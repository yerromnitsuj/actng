# actuarial-ts SDK — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve ActNG2's `packages/core` into the published, Apache-2.0, four-package `@actuarial-ts` SDK (core, data, compliance, agents) per `docs/superpowers/specs/2026-07-16-actuarial-ts-sdk-design.md`, with the workbench as flagship consumer.

**Architecture:** Six phases, each independently shippable, each ending with a full regression gate (typecheck + all tests + live workbench verify) and a `/ship` (commit + push). Detailed per-phase plans are written just-in-time in this directory as `2026-07-XX-phaseN-<name>.md` so each absorbs the previous phase's learnings. This master file is the durable index: update the Progress Log after every phase.

**Tech Stack:** TypeScript 5.7 strict (+noUncheckedIndexedAccess), npm workspaces, vitest, tsc-emitted ESM dist with .d.ts, Mastra 1.49 (agents package, peer), zod (peer), Node >= 20.

## Global Constraints

- License: Apache-2.0 everywhere; copyright holder "Justin Morrey". Never claim "ASOP-approved"; the sanctioned phrase is "designed to support the actuary's compliance with ASOP Nos. 43, 23, 41, 56, 25, 36, 20, 21, 38, and 13; responsibility for compliance remains with the credentialed actuary."
- npm scope `@actuarial-ts`; package versions start 0.1.0; P&C only.
- `packages/core` stays ZERO runtime dependencies; pure; no I/O, clock reads, or ambient randomness (stochastic methods take explicit seeds).
- The published-value validation tests are the contract: reserving math changes are wrong until they pass. New methods require published-value or property tests transcribed from primary sources.
- Core domain invariants (from CLAUDE.md): null unobservable cells; never divide by missing/zero/negative denominators (null, never NaN/throw); volume-weighted = sum/sum; CDFs multiply right-to-left, tail last.
- API grammar for all new code: pure functions, typed inputs + options object, results carry `warnings: string[]`, `ReservingError` with a registered machine code for invalid input only.
- Agents security seam: tenant/project id ONLY via RequestContext, never in tool input schemas; tools never throw into the model (`{ success: false, error: { code, message } }`).
- Node 22 via nvm for every command: `PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"`.
- Every phase ends: `npm run typecheck` clean, `npm test` all green, workbench boots (`npm run dev` smoke), commit + push (= /ship).

## Phase Index

| Phase | Plan file | Status |
|---|---|---|
| Spec + master plan | (this file) | in progress |
| 0 — shipping mechanics | 2026-07-16-phase0-shipping-mechanics.md | DONE 2026-07-16 |
| 1 — Friedland shelf + data pkg | 2026-07-16-phase1-friedland-shelf-data.md | DONE 2026-07-17 |
| 2 — compliance pkg | 2026-07-17-phase2-compliance.md | DONE 2026-07-17 |
| 3 — stochastic backbone | docs/research/phase3/ transcriptions + master log | DONE 2026-07-17 |
| 4 — agents pkg + dogfood | write just-in-time | pending |
| 5 — reserve-review completeness | write just-in-time | pending |
| Final — review + ship + publish-readiness | write just-in-time | pending |

## Phase acceptance criteria (summary; detail lives in phase plans)

- **P0:** core renamed `@actuarial-ts/core@0.1.0`, builds real dist (ESM + d.ts, exports map, files whitelist, sideEffects false, prepare script), LICENSE files, `RESERVING_ERROR_CODES` registry + `ReservingErrorCode` union, `AverageKey` union type, dead code gone (util sumDefined/round, ilf unreachable return, trend duplicate OLS), Mack warns on coerced non-positive selections like CL does, SSE client disconnect aborts the advisor stream, core README, GitHub Actions CI green, `npm pack --dry-run` clean.
- **P1:** `runBenktander`, `runFrequencySeverity` (uses reported-count triangles), Cape Cod `decay` option (Gluck), Mack factor-correlation test, standardized development residuals as data; `@actuarial-ts/data` package (RFC4180 CSV loss-run parse, long-format + grid ingestion, control totals, ASOP 23 data review report). Each with published-value/property tests.
- **P2:** `@actuarial-ts/compliance`: EstimateMetadata (required intended measure/purpose/basis/dates), AssumptionLedger (default vs judgment, rationale/source), ASOP 41 disclosure generator (markdown from a typed AnalysisRecord), model cards for every shipped method, reproducibility bundle (serialize → re-run → byte-identical), AvE roll-forward. Golden-file + determinism tests.
- **P3:** incremental triangle + algebra, seeded RNG, StochasticResult; ODP bootstrap (GLM mean == CL exactly; seeded; SE sane vs published), Merz-Wuthrich (published 2008 example), Clark LDF/Cape Cod (published 2003 example).
- **P4:** `@actuarial-ts/agents`: tool factory (tenant seam, envelopes, action/read), judgment-gate workflow factory writing the compliance ledger, advisor factory, eval harness; ActNG2 server consumes it (dogfood), all existing advisor behavior preserved.
- **P5:** Munich CL (Quarg-Mack example), case outstanding development, Fisher-Lange, salvage/subro (optional recovery inputs), ULAE Conger-Nolibos, discounting + payout patterns to new ASOP 20.
- **Final:** whole-SDK adversarial review fixed, root README + CHANGELOG, all packages `npm pack` clean, publish attempted only if founder npm auth + scope exist (else documented manual step), final /ship.

## Progress Log

- 2026-07-16: Spec approved (founder: ActNG2 home, @actuarial-ts scope, Apache-2.0 all-OSS, P&C only). Master plan created. Pre-work already landed: workflow-snapshot persistence fix + tool envelope normalization (commit 5d8223c).
- 2026-07-17: **Phase 3 DONE.** Stochastic backbone in core: seeded RNG (mulberry32 + Box-Muller + Marsaglia-Tsang gamma), StochasticResult/summaries, triangle algebra (cum<->incr, add/subtract). ODP bootstrap (odpFit GLM==CL identity pinned to 1e-6; England 2002 Tables 1-3 pins: total PE ~16%, per-origin pattern, skewed percentiles; refit Jensen mean-bias documented, bounded 2%). Merz-Wuthrich CDR (eq. 3.17/3.18; Table 4 pins to the paper's $1,000 rounding: 81,080 solvency total vs Mack 108,401; shared extrapolateSigma2). Clark 2003 LDF+Cape Cod (both curves, profiled MLE, delta-method variances; ALL pins ~1e-5 incl. CC ELR 59.78%; Clark's digit-transposed 1991@48 cell documented). Primary-source transcriptions committed under docs/research/phase3/. Core 177 tests; workspace cold-start 384 tests / 4 packages.
- 2026-07-17: **Phase 2 DONE.** @actuarial-ts/compliance shipped: validated EstimateMetadata, immutable AssumptionLedger (judgment requires rationale; ChangedAssumptions diff), 13 ASOP 56 model cards, deterministic ASOP 41 disclosure generator (golden-snapshot + determinism tests, sanctioned positioning enforced by test), reproducibility bundles (canonicalJson + fnv1a64 + mismatchPath), aveRollForward. 84 tests; cold-start = 326 tests / 4 packages. ComplianceError registry local to the package (deliberate: core's registry is closed).
- 2026-07-17: **Phase 1 DONE.** Core: runBenktander (pinned to Mack 2000's published example + identities), Generalized Cape Cod decay (pinned to Gluck 1997 Tables 1-4: 1.9621 pooled PP, D=0.75 per-year vector, 38,208 ultimate total; D=0 collapses to development), runFrequencySeverity + severityTriangle (constant-severity identity), factorCorrelationTest (pinned to Mack 1994 Appendix G on the transcribed RAA fixture) and mackResiduals (VW identity pinned), calendarYearTest additionally pinned to Appendix H. @actuarial-ts/data shipped (CSV, loss-run, long-format, ASOP 23 review; 57 tests). Workbench: Benktander paid/incurred + freq-sev join the 12-method selection matrix at weight 0 (blend numerically unchanged, proven by untouched prior tests + live smoke). DEVIATION: importService CSV delegation deferred to Phase 4 dogfood (pinned surface). Root .gitignore data/ anchoring fix. 242 tests, 3 packages.
- 2026-07-16: **Phase 0 DONE.** @actuarial-ts/core@0.1.0 (Apache-2.0, dist build via prepare, exports map, pack-clean), RESERVING_ERROR_CODES + AverageKey typed surface with self-enforcing registry test, dead code pruned, trend→util.ols consolidation, Mack warning parity, SSE disconnect aborts the advisor stream (proven live), core README, CLAUDE/AGENTS refresh, GitHub Actions CI. Cold-start proof: rm -rf node_modules+dist → npm install → 94 core + 65 server tests green, typecheck clean.
