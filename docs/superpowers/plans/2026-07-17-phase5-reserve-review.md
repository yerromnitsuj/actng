# Phase 5: Reserve-Review Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The remaining methods a full reserve review reaches for: Munich chain ladder, ULAE (Conger-Nolibos with the classical/Kittel special cases), discounting + payout patterns to the NEW ASOP 20 (effective 2026-06-01), case-outstanding development, Fisher-Lange disposal-rate method, and salvage/subrogation netting.

**Architecture:** All in `@actuarial-ts/core` (pure, zero-dep, house grammar). Primary-source transcriptions are already committed: `docs/research/phase5/munich-chain-ladder-quarg-mack-2004.md` (formulation + the 7-year fire-portfolio example with every parameter table printed) and `docs/research/phase5/ulae-conger-nolibos-2003.md` (the generalized W = M/B framework, the three reserve forms, exact special-case weight triples, worked example). Munich CL and ULAE pin to those; the other four carry hand-computed and property tests (Friedland-conventional methods without compact published exhibits).

## Global Constraints

(Master plan Global Constraints apply. Plus: discounting must be built to the June 2026 ASOP 20 — rate provenance disclosed, nominal and discounted side by side, risk margins explicit-only.)

---

### Task 1: Munich chain ladder (`src/munichChainLadder.ts`) — pins

`runMunichChainLadder(paid: Triangle, incurred: Triangle)`: paid/incurred VW factors + Mack sigmas (reuse mackEstimators), qhat_s (incurred-weighted P/I averages) + rhohat^P/rhohat^I (Mack-style ratio variances), the four residual sets, lambda^P/lambda^I as through-origin regression slopes over pooled residuals, then the SIMULTANEOUS cell-by-cell recursion (paid needs projected I/P, incurred needs projected P/I). Result: per-origin {paidUltimate, incurredUltimate, sclPaidUltimate, sclIncurredUltimate, finalRatio}, the parameters, warnings (small columns, sigma/rho fallbacks — last estimable column conventions per the paper). Pins: the fire-portfolio triangles → printed fhat/sigma/qhat/rho rows, the printed lambdas, MCL ultimates per year, and the paid/incurred gap-closing property (|MCL P/I − 1| < |SCL P/I − 1| for every year).

### Task 2: ULAE (`src/ulae.ts`) — pins

`ulaeRatios(periods: {label, ulaePaid (M), reportedUltimate (R), paid (P), closedUltimate (C)}[], weights {u1,u2,u3})` → per-period W = M/B, B = u1 R + u2 P + u3 C. `ulaeReserve({selectedW, ultimateLosses (L), reportedToDate R(t), paidToDate P(t), closedToDate C(t), ulaePaidToDate M, weights, form: "expected" | "bornhuetterFerguson" | "development"})` with the paper's three forms (BF form = W* x [u1(L−R) + u2(L−P) + u3(L−C)] is the recommended default). `ULAE_WEIGHT_PRESETS`: generalized (caller), kittel {0.5, 0, 0.5}, classicalPaidToPaid {0.5, 0, 0.5 + basis collapses to paid; expose as a preset that sets B = P via the documented steady-state identity}. Pins: the paper's worked example from the research doc; algebraic special-case tests (Kittel reserve = W*(pureIBNR + 0.5 case) identity).

### Task 3: Discounting to the new ASOP 20 (`src/discounting.ts`)

`payoutPatternFromChainLadder(cl: ChainLadderResult, ages)` → expected future incremental payments per origin per future period (from CDF differences applied to unpaid). `discountUnpaid({pattern | explicit cashflows, rates: { kind: "flat", annualRate } | { kind: "curve", spotByYear: number[] }, provenance: { source: string, asOfDate: string }, convention: "mid-period" | "end-period" })` → per-origin and total {nominal, discounted, discountFactorEffective}, side by side, warnings (pattern truncation, negative cashflows). NO implicit risk margins: an explicit `riskMargin?` amount is carried through separately, never blended silently. Deterministic hand-computed tests (flat-rate closed forms; curve case; mid- vs end-period).

### Task 4: Case-outstanding development (`src/caseOutstanding.ts`)

Friedland ch. 12 technique for books where only case reserves are reliable: develop the case-outstanding triangle (case = incurred − paid or given directly), ratio of incremental paid to prior case, project future paid from case run-off. `runCaseOutstanding(paid, caseOutstanding, opts {caseSelections, tail, paidOnCaseSelections})`. Hand-computed 4x4 test + null-safety + the self-consistency property: when case runs off exactly per the selected pattern the reserve ties to the projected paid sum.

### Task 5: Fisher-Lange disposal-rate method (`src/fisherLange.ts`)

Disposal rates d = incremental closed counts / ultimate counts (per age, selected from the diagonal or averages); future closed counts = ultimate counts x selected d for future ages; severities per closure age (incremental paid / incremental closed), trended at a caller severity trend; reserve = sum over future cells of counts x trended severity. `runFisherLange(paidTri, closedCountTri, ultimateCounts, opts {disposalSelections?, severityTrend, targetYear?})`. Hand-computed test (constant severity + trend reproduces closed-form), warnings for sparse cells.

### Task 6: Salvage & subrogation (`src/salvageSubro.ts`)

Recovery triangles develop like losses: `runSalvageSubro(recoveryTri, opts {selected, tail})` → CL on recoveries (warn: recovery development is often slower/lumpier), plus `netOfRecoveries(grossResult, recoveryResult)` → per-origin net ultimates/unpaid via subtraction with origin alignment. Property tests via triangleAlgebra identities.

### Task 7: Phase gate

Exports, registry sync, full core suite + workspace cold start, master log, /ship with CI watch. Workbench integration: NONE this phase (the selection matrix stays at 12 methods; Munich CL and the rest are SDK surface — a workbench exhibit is Final-phase optional work if cheap).
