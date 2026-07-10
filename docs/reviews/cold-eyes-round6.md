# Cold-Eyes Round 6 — ActNG Reserving Workbench

**Date:** 2026-07-10
**Reviewer lens:** Fused persona — elite credentialed P&C reserving actuary (FCAS, signs SAOs, derives a-prioris for real BF analyses) + world-class product-design expert.
**Scope:** Blind, live-only. Configured every scenario by hand (caps, restoration, rates, ELR, LDFs, runs) exactly as a working actuary would. Exercised the full expected-losses machinery end to end — capped development layer, increased-limits restoration (fitted severity + Kaplan-Meier check), trends, rate/parallelogram on-leveling, the ELR exhibit + averages + Cape Cod cross-check, the 9-method selection-of-ultimates matrix with per-period weights, and the guided advisor. Plus the four Round-5 level-coherence regressions (F1–F4).
**Target:** `http://localhost:5175`, seeded project "Demo: GL Occurrence (synthetic)". Judged only what the browser rendered.

---

## VERDICT

### Actuary score: 90 / 100
Would I derive an a-priori for a real BF with this, or lean on it for an SAO? On the numbers — yes, without reservation. Everything I checked reconciles: the corrected paid chain ladder (52,559,152, IBNR 392,466 = ultimate − reported-incurred to the dollar), both ELR averages, the two-change parallelogram (OLF 1.320 / 1.257 / 1.200 / 1.091 / 1.000 — exact to the fourth decimal, including the change-year 50/50 blends and the compounding of two rate actions), the increased-limits uncap factor (1.3196 = E[X]/E[X∧100k] on the fitted lognormal, my hand value 1.3193), and the restored-layer IBNR/unpaid measured against the *unlimited* diagonals (total IBNR 5,044,837, unpaid 13,903,610, both tie). The censored-MLE severity fit with a Kaplan-Meier quantile check still surfaces its own weakness (lognormal p99 277,967 vs empirical 528,925), the restoration-shortfall years (2021, 2024) are flagged by name with the negative-IBNR-as-artifact framing, and the advisor reads live state and reconciles to the exhibit to the dollar (it independently re-derived the restored premium-weighted ELR at 75.9%, which I verified as 57,211,523 / 75,350,375). All four Round-5 level-coherence defects are genuinely fixed. What holds it out of the mid-90s is one new integrity risk: the **selection-of-ultimates exhibit does not re-blend after a Run analysis or a run switch** — it silently keeps the load-time run's ultimates until a full page reload — so during a live session you can be looking at fresh Results up top and stale *booked* ultimates below, with no warning. On a reserving exhibit that is exactly the kind of stale-basis trap that ends up in a workpaper. Two smaller actuarial gaps: no guardrail warns when a selected LDF is a gross outlier vs the observed factors (the shipped "clean" baseline carried a 96→108 selection of **1.100** against an observed ~1.003, inflating paid CL by ~$4.36M), and the single-factor restoration silently over-restores fully-mature years (books positive phantom IBNR on 6–10-year-developed years) while only the downward violators are flagged.

### Design score: 86 / 100
The banner and error craft here is genuinely best-in-class. The four Round-5 coherence failures are not just patched — they are answered with a stacked, color-differentiated, self-referential banner system that a first-time actuary reads without a legend: green "RESTORED TO UNLIMITED …" provenance, amber "you switched to the unlimited layer since this run — the ultimates below are STILL at the restored level," blue "Exp Clms is blank … the selected ELR was chosen at the unlimited level but this run is restored … re-select," and red per-year restoration-shortfall. They stack coherently and even cross-reference ("the banner above describes that superseded run"). The pending-rate-edit cue is clean, the 422 run-failures now surface as a persistent, dismissable, actionable error banner, and the advisor remains a standout. What pulls design down from where that craft alone would put it is the same defect that hurts the actuary score: the primary action of the entire tool — **Run analysis** — does not refresh the selection-of-ultimates / Trends / ELR exhibits, and the only recovery I found is an undocumented full-page reload, with nothing warning you the two halves of the page disagree. For a professional instrument that is a real trust break. The long single-scroll page still has no jump navigation (carried over from R5).

---

## PART B — Round-5 regressions re-verified

### F1 — Basis-provenance banner after a layer switch → **RESOLVED**
**Did:** Configured cap 100,000 + restoration Fitted (uncap 1.3196), selected capped paid & incurred LDFs, ran a RESTORED run (active run 3:58:14). Reloaded so the selection matrix reflected it, then pressed the **Unlimited** layer toggle **without rerunning**.
**Rendered:** A new amber banner appeared on the selection-of-ultimates exhibit: *"You switched to the unlimited layer since this run — the method ultimates below are STILL at the restored (total-limits) level (the banner above describes that superseded run). Rerun to move them onto the unlimited basis."* The level change is unmistakable and explicitly named. (Evidence: `r6-09-f1-stale-layer-banner.png`.)

### F2 — ELR methods silently blank on a level mismatch → **RESOLVED**
**Did:** Selected an ELR at the UNLIMITED level (premium-weighted 72.5%, confirmed the input carried 72.5 and that it drove BF — BF paid moved 52,415,499 → 50,032,777 on the unlimited run). Then configured cap + restoration, switched to Capped, and reran (restored level).
**Rendered:** The Expected Claims column is blank ("-") for every year, and the selection matrix carries a blue banner naming the mismatch: *"Exp Clms is blank (and BF carries its derived a-priori, not the selected ELR): The selected ELR was chosen at the unlimited level but this run is restored, so Expected Claims and the ELR-derived BF a-priori were skipped (the levels must match, or the a-priori would sit at the wrong dollar level). Re-select the ELR on the current restored exhibit, then rerun."* The blank is fully explained, and the advisor independently surfaced the same caveat. (Evidence: `r6-08-f2-elr-mismatch-banner.png`.)

### F3 — On-level exhibit lagging an uncommitted rate change → **RESOLVED**
**Did:** Added a first rate change (+20% eff 2023-01-01); the moment the row existed, a banner read *"Pending rate edit — press Enter or click away to apply. The on-level factors and ELR exhibit use the committed history below, not this draft."* Pressed Enter → banner cleared and OLF updated to 1.200 (2016–2022) / **1.091 (change-year 2023)** / 1.000 (2024–25), matching the parallelogram to the fourth decimal. Then added a SECOND change (+10% eff 2021-01-01) and did NOT commit.
**Rendered:** The pending cue reappeared (`pending: true`) while the OLF column held the committed +20%-only answer (the uncommitted +10% was correctly excluded — OLF unchanged). Pressing Enter committed it and OLF recomputed to 1.320 / **1.257 (change-year 2021)** / 1.200 / 1.091 / 1.000 — the exact two-change compounded parallelogram. The pending edit is now clearly signalled and the exhibit never silently consumes an uncommitted draft. (Evidence: `r6-03-ratechange-added.png`.)

### F4 — Swallowed run errors → **RESOLVED**
**Did:** Switched to the Capped layer with no LDF selections on the paid basis and pressed Run analysis (a 422).
**Rendered:** A prominent, red-bordered, persistent banner at the top of the work area: *"Run failed — nothing changed. No LDFs are selected on the paid basis. Switch to that basis and select factors (or ask the advisor to apply them) before running the full analysis."* with a working **dismiss** control. Selecting paid factors and rerunning produced the same quality of message for the incurred basis, i.e. the guard is sequenced and specific. The failure is now unmissable and carries the backend's actionable text verbatim. (Evidence: `r6-07-f4-error-banner.png`.)

---

## RANKED NEW FINDINGS

1. **[MAJOR] The selection-of-ultimates / Trends / ELR exhibits do not re-blend after a Run analysis or run switch — stale until a full page reload, with no warning.**
   Repro (clean, reproduced from the very first Run analysis of the session): load the project; correct any input (I fixed the 96→108 LDF from 1.100 to 1.003); click **Run analysis**. The Results section (cross-method summary, per-origin detail, Mack) updates to the new run (CL paid 52,559,152); the **Selection of ultimates below still blends the load-time run** (CL paid 56,918,634, 2018 = 3,856,367 vs the new 3,516,305, EXP CLMS blank), and its label still names the old run. Switching the Results run dropdown to the new run updates Results only — the Selection stays on the old blend. Only a full-page reload re-syncs it (after reload the Selection correctly blended the new run and named it). Blast radius: this is the exhibit that produces the *booked* selected ultimates, IBNR, and unpaid, and it feeds the Trends and ELR exhibits — so during a working session all three silently lag the run the actuary just executed. Owner: frontend (the Selection/Trends/ELR must subscribe to the active analysis result, not compute once at mount; at minimum, warn when the blended run ≠ the active run). Evidence: `r6-04-selection-matrix.png` (stale) vs `r6-05-results.png` (fresh Results on the same screen).

2. **[MINOR] No guardrail on grossly-outlier LDF selections, and the shipped baseline carried one.** The reset "clean" baseline had a **selected 96→108 factor of 1.100** against observed age-to-age factors of ~1.003 (2016 = 1.001, 2017 = 1.004). That single fat-finger inflated the paid CL ultimate for 8 of 10 years by ~10% (56,918,634 vs the defensible 52,559,152, a $4.36M swing) and pushed the age-96 CDF to 1.107 while age-108 sat at 1.006 — an implausible 10% jump between adjacent mature maturities. Nothing in the UI flags a manual selection that far outside its column's observed range. A "selection is N× the observed factors" warning would catch this class of error. Owner: frontend/validation (+ scrub the seed).

3. **[MINOR] Single-factor restoration silently over-restores fully-mature years.** The book-average uncap factor (1.3196) is applied uniformly to every origin year, including ones that are 72–120 months developed. For 2016 (fully mature, actual unlimited reported incurred 3,538,803) it restores the capped ultimate to 4,022,595 and books **+471,372 IBNR on a closed year** (2017 +506k, 2018 +977k, 2019 +782k, 2020 +955k). The exhibit flags the *downward* violators (2021, 2024 restoration shortfall, red banner, negative IBNR) but not the symmetric *upward* over-restoration on mature years, whose phantom positive IBNR reads as legitimate reserve. The green banner discloses the assumption generically, so this is minor — but a "restored materially exceeds reported incurred on a near-mature year" flag (or preferring own-year experience for mature years) would close the loop. Owner: actuarial/frontend.

4. **[NIT] No section navigation on the long single-scroll page (carried over from R5 #6).** ~20 major exhibits on one long scroll with no sticky TOC / jump-nav / back-to-top; real friction for an actuary moving repeatedly between the triangle, the selection matrix, and the ELR.

---

## PART A — machinery reconciled (selected checks)

- **Chain ladder / cross-method internal consistency (unlimited, corrected):** IBNR = ultimate − reported-incurred and unpaid = ultimate − paid tie exactly across CL paid/incurred, BF paid/incurred, and Cape Cod (e.g. CL paid IBNR 392,466 = 52,559,152 − 52,166,686; BF paid IBNR earlier 248,813). Reported-incurred base 52,166,686 built by hand from the claim-sizes table.
- **ELR averages (with rate history):** premium-weighted 72.5% = 54,595,374 / 75,350,375 (Σ premium × OLF), verified to the tenth; straight/last-5/last-3/ex-hi-lo all reconcile against the rendered per-year loss ratios; Cape Cod mechanical ELR shown as a cross-check.
- **Parallelogram on-leveling:** exact to 4 decimals for one and two compounding changes, including change-year 50/50 blends (see F3).
- **Increased limits:** uncap 1.3196 = E[X]/E[X∧100k] for lognormal(9.134, 1.462); K-M quantile check correctly shows the lognormal underfitting the far tail; 2152 closed + 315 open + 518 excluded = 2,985 claims.
- **Restored layer:** total selected 57,211,523; IBNR 5,044,837 and unpaid 13,903,610 both tie against the unlimited diagonals; 2016 restored 4,022,595 = 3,029,510 × 1.006 × 1.3196; 2021 IBNR −380,479 = 5,519,611 − 5,900,089 (shortfall year).
- **Advisor (guided):** live, tool-grounded, actuarially sharp — judged 72.5% too low, cited restored-level benchmarks (premium-weighted 75.9% — verified exactly, Cape Cod 72.9%/75.3%, last-5 91.4%, last-3 103.5%), and independently flagged the ELR level mismatch.

---

## WHAT IMPRESSED

- **The level-coherence banner system is reference-grade.** Four differentiated, stacked, self-referential banners that turn every former silent-blank/mislabel into an explicit, actionable statement of *why*. This is exactly how a reserving exhibit should communicate basis.
- **The math is correct to the dollar / fourth decimal everywhere I checked**, including the two-change parallelogram, the severity-based uncap factor, and restored IBNR against unlimited diagonals.
- **The tool shows its own weaknesses** — lognormal p99 tail underfit, restoration-shortfall years by name with negative-IBNR-as-artifact framing, and the ELR self-confirmation caveat.
- **The advisor reads live state and reconciles to the exhibit** (premium-weighted restored ELR 75.9% matched my hand calc), and it caught the same level-mismatch the banner did — internal consistency between two independent surfaces.
- **Error handling is now unmissable and actionable**, sequenced across the paid then incurred basis.

## EVIDENCE INDEX
Screenshots (Playwright output dir `/Users/justinmorrey/YesChef/`) — safe to delete after review:
- `r6-01-project-top.png` — landing: paid triangle, toggles, advisor
- `r6-02-rates.png` / `r6-03-ratechange-added.png` — rates panel + pending-rate-edit cue (F3)
- `r6-04-selection-matrix.png` vs `r6-05-results.png` — **stale Selection blend vs fresh Results on one screen (MAJOR #1)**
- `r6-06-increased-limits.png` — restoration: fitted severity, K-M quantile check, uncap 1.3196
- `r6-07-f4-error-banner.png` — persistent 422 error banner (F4)
- `r6-08-f2-elr-mismatch-banner.png` — restored selection matrix, three stacked banners (F1 provenance / F2 ELR mismatch / restoration shortfall)
- `r6-09-f1-stale-layer-banner.png` — four stacked banners incl. the "you switched to the unlimited layer" note (F1)

**State left behind:** Demo project modified — cap 100,000 configured, restoration Fitted/lognormal to unlimited armed (uncap 1.3196), rate history +10% (2021-01-01) / +20% (2023-01-01), 96→108 unlimited LDF corrected to 1.003, capped paid & incurred LDFs selected (all-year VW), Selected ELR 72.5% (chosen at unlimited), several new runs in history, layer left on **Unlimited** showing the F1 stale-level banner. Console errors were only the benign 422 validations from my own deliberately-incomplete capped runs. Browser closed cleanly.
