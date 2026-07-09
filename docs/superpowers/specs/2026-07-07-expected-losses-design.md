# Expected-Losses Workflow — Design Spec

Date: 2026-07-07. Status: APPROVED by founder ("Do it all"), full delegation.
Execution: 5 phases, each phase = build → bug/regression/gap + actuarial-standards
check → fix → /ship (commit + push). Final: cold-eyes expert-actuary review on a
pristine instance.

## Goal

Give ActNG the pricing-grade a-priori machinery a real reserving/ratemaking
template has: cap losses at a reliable layer, develop the stable capped layer,
restore to total limits via ILFs, trend everything to a common cost level,
build frequency/severity exhibits, compile trended on-level loss ratios, and
select an ELR that feeds BF-family methods (BF derived a-priori, Cape Cod,
Expected Claims) — all AI-native through the Mastra advisor.

## Founder decisions (interview 2026-07-07)

1. **Capped layer is a first-class basis.** The whole pipeline (LDF menu, tail
   fits, methods, Mack, diagnostics) runs on the active layer's triangles; the
   reserve is built on the stable layer; ILF restores total limits at the
   ultimate step.
2. **ILF sources: import + fitted + illustrative.** CSV table import
   (limit/factor pairs, log-interpolated), censoring-aware MLE fits (lognormal,
   Pareto) to own claim severities, and a bundled illustrative curve set
   clearly labeled non-ISO (public-literature parameters).
3. **Full on-level machinery.** Rate-change history import (effective date, %),
   parallelogram-method on-level factors, premium trend. ELR = trended
   developed uncapped losses / on-level trended premium.
4. **Methods: BF (derived a-priori, manual override retained) + Cape Cod
   (paid & incurred) + Expected Claims.** Selection matrix grows 6 → 9 method
   columns (frozen outcome columns already handle width).
5. Cap setter permanently has NO whole-column analog anywhere (standing
   founder rule from the weights matrix applies to any future grid).

## Actuarial encodings (the standards to check each phase against)

- **Capping** is claim-level, applied to every snapshot row: capped incurred =
  min(incurred, cap_y); capped paid = min(paid, cap_y). Counts unaffected.
  cap_y is the cap stated at a base cost level and indexed by an annual rate to
  each origin year (indexed default once trend exists; until Phase 3 the index
  rate is a user input defaulting to 0 = flat — never invent a default trend).
  Cap-selection exhibit must SHOW the evidence: claim-size percentiles by year,
  pierce counts/share per candidate cap, % of dollars excess, and capped vs
  unlimited ATA-factor volatility side by side.
- **ILF/uncap**: uncap factor = E[X] / E[X ∧ cap_y] per origin year at that
  year's cost level. Lognormal LEV: E[X∧c] = e^{μ+σ²/2}Φ((ln c − μ − σ²)/σ)
  + c·(1 − Φ((ln c − μ)/σ)). Pareto(θ, α>1) LEV: (θ/(α−1))(1 − (θ/(c+θ))^{α−1}).
  MLE treats open claims as right-censored at reported incurred; closed claims
  are exact. Applied to CAPPED ultimates to produce total-limits ultimates; the
  selection matrix and IBNR/unpaid are at TOTAL LIMITS (IBNR vs unlimited
  reported incurred).
- **Trends**: ln(y) = a + bt regressions on ultimate frequency, severity
  (capped & uncapped), pure premium; menus all-year / 5yr / 3yr / ex-hi-lo;
  R² shown; separate freq and sev selections (product cross-checks fitted PP
  trend); trend runs origin-year midpoint → target-year midpoint.
- **Freq/Sev**: ultimate counts = CL on reported counts (exists). Frequency per
  $1M on-level premium by default; per exposure unit if imported. Severity =
  ultimate losses / ultimate counts, capped and uncapped, plus trended-to-
  target restatements. Averages menu + selection row.
- **ELR**: parallelogram on-level (annual policies assumption documented; rate
  changes as (effectiveDate, rate%)), premium trend on top. Select ONE ELR at
  target cost level; the engine restates it to each origin year's own cost and
  rate level for the a-priori (de-trend by selected trends, un-on-level by that
  year's factor). Cape Cod mechanical ELR = Σ reported / Σ used-up on-level
  premium displayed beside the selection as cross-check. Expected Claims
  ultimate = restated ELR_y × on-level premium_y (at year-y level).

## Architecture (the one seam)

`layer` joins `basis` as a workspace dial. Layer is resolved AT TRIANGLE BUILD
TIME: `buildProjectTriangles` returns the ACTIVE layer's TriangleSet (claims
are capped before the builder runs when layer = capped). Everything downstream
(methods, Mack, diagnostics, factors, tails) consumes triangles unchanged —
zero method-code changes, which is the don't-break-anything property. The
Layer panel gets a dedicated comparison service (both layers' factors) for the
stability exhibit.

### WorkspaceState additions (with in-place migration, like weightsByOrigin)

```
layer: {
  active: "unlimited" | "capped";
  cap: number | null;          // per-occurrence, stated at baseYear cost level
  indexRate: number;           // annual; 0 = flat cap
  baseYear: number | null;     // null = latest origin year
}
selections: { unlimited: {paid, incurred}, capped: {paid, incurred} }   // migrate flat → unlimited
tail:       { unlimited: {paid, incurred}, capped: {paid, incurred} }   // migrate flat → unlimited
ilf:   { source: "none"|"table"|"fitted"|"illustrative", table?, fitted?, curveId? }
trend: { frequency: sel, severityCapped: sel, severityUncapped: sel, targetYear }
rates: { history: [{effectiveDate, change}], premiumTrend }
elr:   { selected: number | null }   // at target level
```

Analysis inputs gain layer/ilf/trend/rates/elr → existing staleness machinery
covers all of it for free. Analysis results per method carry BOTH capped and
total-limits ultimates when layer = capped.

### New exhibits (Section pattern, workflow order)

Layer → ILF → Trend → Frequency/Severity → Rates & premium → Expected loss
ratio. Two new optional imports (rate history CSV, ILF table CSV) + optional
exposure-units column on exposures import.

### packages/core additions (pure, tested, published-value validated)

capClaims, claimSizeDiagnostics, LEV/severity fits (lognormal, Pareto,
censored MLE), ilf table interpolation, illustrative curves, trendRegression,
freqSev, parallelogram onLevel, capeCod, expectedClaims. Validation fixtures:
Friedland worked examples (Cape Cod, Expected Claims), Werner & Modlin
(parallelogram, trend), LEV closed forms vs numeric integration. Fixture
values independently recomputed by adversarial workflow agents before pinning.

## Mastra AI-native layer

- Tools per exhibit through the same service layer (projectId from
  requestContext only, never in input schemas): analyze_claim_sizes /
  set_loss_cap, fit_severity_curves / set_ilf_source, analyze_trends /
  set_trend_selections, get_freq_sev, set_rate_history / analyze_on_level,
  derive_elr / set_elr.
- **derive-expected-losses Mastra workflow** with suspend/resume human gates at
  every judgment point (cap → ILF → trends → ELR); each step renders the
  exhibit, states recommendation + rationale, waits for confirm/adjust; saves
  the rationale trail as notes. VERIFY workflow API against installed
  @mastra/core 1.49 .d.ts before writing (docs MCP lags; no backticks in the
  advisor INSTRUCTIONS template literal).
- Advisor playbook: cap where layer credibility dies, benchmark trends against
  fitted range, cross-check selected ELR vs Cape Cod mechanical, narrate +
  save_note every judgment.
- Golden-prompt evals per new tool: happy path + ugly edges (no rate history;
  cap above every claim; ILF table not bracketing the cap; α ≤ 1 Pareto).

## Phases

1. **Capped layer end-to-end**: core capClaims + diagnostics, layer state +
   migration, active-layer triangle seam, Layer panel + layer toggle, factor
   comparison, advisor tools, tests.
2. **ILF**: LEV/fits/table/illustrative core, ilf state + import route, uncap
   step in analysis (total-limits ultimates in matrix), ILF panel, tools, tests.
3. **Trend + Freq/Sev**: regression core, exhibits, selections, tools, tests.
4. **Rates/ELR + methods**: parallelogram + premium trend core, rate import,
   ELR exhibit, BF derived a-priori (override retained), Cape Cod ×2, Expected
   Claims, matrix → 9 columns (SelectionMethodKey migration), tools, tests.
5. **Agentic layer**: derive-expected-losses workflow, advisor playbook,
   eval suite, observability.

Per-phase protocol: build → full test suite green (existing 57 + new) → live
verify on dev instance → adversarial review workflow (correctness, actuarial
standards, regression, integration lenses; findings verified before fixing) →
fix → /ship (commit + push origin). Cold-eyes expert-actuary review at the
very end on a pristine instance.
