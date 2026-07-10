# Cold-Eyes Round 5 — ActNG Reserving Workbench

**Date:** 2026-07-10
**Reviewer lens:** Fused persona — elite credentialed P&C reserving actuary (FCAS, signs SAOs) + world-class product design expert
**Scope:** Blind, live-only evaluation of the new *expected-losses machinery* — capped development layer, increased-limits restoration, trends, rates & premium on-leveling, expected-loss-ratio exhibit, the three new selection methods (Cape Cod paid/incurred, Expected Claims), and the guided ELR derivation.
**Target:** `http://localhost:5185`, one seeded project "Demo: GL Occurrence (synthetic)". Judged only what the browser rendered. No source read.

---

## VERDICT

### Actuary score: 88 / 100
**Would this expected-losses machinery survive peer review at a real carrier? Would I derive an a-priori for an actual BF with it?** On the unlimited path — yes, today. Every number I checked ties to the dollar: the parallelogram on-level factors reproduce my hand geometry to 3–4 decimals, the trended loss ratios and both ELR averages reconcile exactly, the Expected Claims ultimate is ELR × premium restated per origin year to within rounding, and the restoration shortfall years show the correct negative-IBNR artifact measured against the true unlimited diagonals. The censored-MLE severity fit with a Kaplan-Meier quantile check is real actuarial rigor, and — critically — it *surfaces its own weakness* (the lognormal underfits the p99 tail by nearly half) instead of hiding it. This is not slop; it is a serious tool built by someone who has actually done the work. What holds it out of the 90s is **state/level management around the newest layer transitions**: the ELR-driven BF a-priori and the Expected Claims method silently do not compute on the capped/restored layer, and the selection-of-ultimates provenance banner mislabels an unlimited run as "RESTORED TO A 1,000,000 LIMIT." On a reserving exhibit the *level* is everything, so a wrong basis label is a genuine trust defect, not a cosmetic one. Fix the level-state coherence and this is a 92+.

### Design score: 90 / 100
Best-in-class craft for a data-dense professional instrument — Bloomberg-terminal density executed with editorial restraint. Transitional-serif display type over warm paper, monospaced right-aligned tabular figures, and a coherent *semantic* color system (gold = current/active, green = "stabler," muted-gray = caveat) that a first-time actuary can read without a legend. Every exhibit self-documents with a small-caps subtitle stating its own definition. The caveats read as craft, not clutter. It sits a couple of refinements short of reference-grade: a 4,000px+ single-scroll page with 13 major sections has **no jump navigation**, and the same stale-state bugs that hurt the actuary score are also design/state-communication failures (a swallowed run error, a mislabeled basis banner).

---

## DEEP-DIVE FINDINGS ON THE NEW MACHINERY (with verified numbers)

### 1. Capped development layer — solid, honest labeling
- Setting a 100,000 per-occurrence cap and toggling to **Capped** correctly re-developed the triangle as LIMITED losses: 2016@120mo dropped 3,538,803 → **3,029,510** (509,293 excess, consistent with the handful of claims above the p99 of 132,123 plus the 528,925 largest).
- The layer **correctly refuses to inherit unlimited selections** ("The capped layer has no LDF selections on the paid basis yet… unlimited selections deliberately do not carry over") and requires its own paid *and* incurred factor selections + tail. The reset-on-cap-change behavior is stated and enforced by design.
- After selecting the capped all-year VW factors (2.519, 1.192, …) on both bases + fitted tails, the run produced the run label **"LIMITED LAYER: LOSSES CAPPED AT 100,000 PER OCCURRENCE"** and capped CL-paid ultimate **43,860,134** vs 52,551,780 unlimited (83.5% in-layer, matching the 18.4% excess-dollar share at that cap). LIMITED labeling appears in the run header, the selection-matrix banner, and the diagnostics.
- The **FACTOR STABILITY** panel is the standout evidence exhibit: CV of individual age-to-age factors, Unlimited vs Capped, with green highlights where capping is demonstrably stabler (12–24: 0.149 → 0.088). This is precisely the justification an actuary needs to defend a cap.

### 2. Increased-limits restoration — genuinely sophisticated
- Fitted severity: **Lognormal** (mu 9.134, sigma 1.462, LL −23271.8) and **Pareto** (theta 14,057, alpha 1.364, LL −23313.7), both on 2152 closed + 315 open claims. 2152 + 315 + 518 excluded (zero/negative) = **2,985 = the exact project claim count.** Censored MLE at the cap's base-year cost level, open claims censored at reported incurred, with the honest case-adequacy caveat.
- **Kaplan-Meier quantile check** (the anti-slop centerpiece of restoration):

  | Pctile | Empirical (KM-adj) | Fitted lognormal |
  |---|---|---|
  | p50 | 8,781 | 9,269 |
  | p75 | 24,409 | 24,846 |
  | p90 | 66,077 | 60,349 |
  | p95 | 106,566 | 102,642 |
  | p99 | 528,925 | 277,967 |

  The KM censoring adjustment is correct and explained ("raw closed-claim quantiles run small because large claims stay open"). The tool **exposes that the lognormal underfits the p99 tail by ~47%** — the real reason to consider the heavier Pareto for an excess restoration. Surfacing the weakness instead of burying it is exactly right.
- Uncap factor **1.2990** to a 1,000,000 limit (E[X∧1M]/E[X∧100K]). Restored CL-paid total 56,973,570 = 43,860,134 × 1.2990 (56,974,314, within 4-dp display rounding).
- **Shortfall handling — verified to the dollar.** Uniform-factor caveat present ("one expected factor restores EVERY year… years with realized large-loss excess violate it"). Flagged years **2021! and 2024!** are precisely the large-loss years (1,276,445 and 1,238,143):
  - 2021: restored 5,417,847 − unlimited reported 5,900,089 = **−482,242** (matches shown IBNR exactly).
  - 2024: 7,263,649 − 8,143,052 = −879,403 vs shown −879,402 (1-dollar rounding).
  - Guidance is textbook: "manual override (reported incurred plus a development provision) or an aggregate excess treatment; their negative IBNR is an artifact, not favorable development."

### 3. Rates / parallelogram on-leveling — exact
Rate history +5% (2023-01-01) and +3% (2024-07-01), current level 1.05 × 1.03 = 1.0815. Tool OLFs vs my hand parallelogram (annual policies, uniform writing):

| Year | Tool | Hand calc |
|---|---|---|
| 2016–2022 | 1.082 | 1.0815 |
| 2023 | 1.055 | 1.0551 |
| 2024 | 1.026 | 1.0262 |
| 2025 | 1.004 | 1.0037 |

The mid-2024 change correctly leaves ~87.5% of CY2024 at the old level. **Exact to 3–4 decimals.**

### 4. ELR exhibit — internally consistent
- 2016 trended LR: 6,094,129 / (5,000,000 × 1.0815 = 5,407,500) = **112.7%** ✓; loss-trend factor 6,094,129/3,936,015 = 1.5483 ≈ 4.98%/yr over 9 yrs (freq 0.5% × sev 4.5%) ✓
- 2023 trended LR: 8,116,180 / 7,423,313 = 109.3% ✓
- **Premium-weighted ELR:** Σ trended losses 68,462,551 / Σ on-level premium 66,816,056 = **102.46% → 102.5%** ✓
- **Straight average** of the 10 ratios = 102.51% → 102.5% ✓
- **Expected Claims** (unlimited, 102.5% anchor): 2025 = 7,976,177 ≈ 102.5% × 7,784,674 (7,978,527); 2016 = 3,578,459 ≈ 102.5% × 5,407,500 × loss-detrend-to-2016 (0.6459) = 3,578,746. ELR × premium *restated per year* is correct ✓

### 5. Guided ELR derivation — reference-grade anti-slop
This is the best thing in the product. Asked to "walk me through deriving an expected loss ratio end to end," the advisor:
- **Oriented from live state** and caught nuance a human would miss: "a cap of 100k is configured but the active layer is unlimited… so the cap isn't doing anything yet." It detected the seeded distortions (settlement speedup ~9%, case strengthening ~11.4%/period).
- **Checked for circularity**: "still 100% CL paid + CL incurred — no BF/Cape Cod/Expected Claims weight — so these loss ratios are genuinely development-driven, not a reflection of an assumed ELR."
- **Paused at each judgment gate** ("Gate 1 of 4 — Loss cap," etc.) with a recommendation + the on-screen evidence table + genuine reasoning, then waited for my decision, stating "your words go into the audit trail verbatim."
- **Adapted the workflow to my decisions**: when I skipped the cap, it *skipped the restoration gate* ("the ILF/restoration gate was skipped since there's no cap") and re-fitted trends at the unlimited level (severity 6.4% vs the 4.5% capped level).
- **Prose reconciles to the live table exactly** (my #1 anti-slop test): its severity menu 6.4%/0.69, 7.1%/0.41, 14.1%/0.74, 5.5%/0.64 matched the rendered exhibit 6.4%/0.694, 7.1%/0.413, 14.1%/0.741, 5.5%/0.644 to the decimal. It reads exhibits; it does not hallucinate.
- **Surfaced a real tool guard** I'd have missed: a stale-level ELR warning ("the selected ELR was chosen at the restored level but this exhibit is at the unlimited level").
- **Decisions actually landed**: the Selected-ELR field was set to 100.0, the analysis reran, and a **persistent, timestamped, attributed audit-trail note** was written to the Notes section capturing my verbatim rationale at all three gates ("ELR derivation trail: - cap: stay unlimited - [my words]… ADVISOR - 7/10/2026, 1:16:56 PM"). That is an SAO-grade workpaper.
- **Stayed honest**: it warned that the headline selected ultimate hasn't moved because the selection is still 100% CL (BF/Expected Claims carry zero weight), and that incomplete rate history would bias every on-level factor.

The human owns every judgment. This is how AI-native reserving *should* feel.

---

## RANKED FINDINGS

1. **[MAJOR] Stale/wrong basis provenance banner after a layer switch.** On a confirmed *unlimited* run (unlimited toggle pressed, run label carries no cap), the Selection-of-ultimates banner still read **"RESTORED TO A 1,000,000 LIMIT: capped ultimates × 1.2990 via fitted lognormal."** On a reserving exhibit the level is the single most load-bearing label; mislabeling unlimited ultimates as restored-to-1M could push a wrong basis into a workpaper. Owner: ux-quality (exhibit provenance re-derives from the actual run state, not the last-armed restoration settings).

2. **[MAJOR] ELR machinery silently inert on the capped/restored layer.** With ELR = 102.5% committed and two reruns on the restored layer, the **Expected Claims column stayed "-" for every year and the BF a-priori never moved** (2025 BF-paid frozen at 7,286,597). Switching to unlimited + one rerun populated Expected Claims (52.4M total) and updated BF. Either the restored-level ELR should drive Expected Claims/BF at that level, or the tool must state *why it can't* — a silent blank in the 9-method matrix, exactly where an actuary wants the a-priori cross-check on the total-limits basis, erodes trust. Owner: ux-quality.

3. **[MAJOR] One-step-stale on-level display after entering a second rate change.** After I entered *both* rate changes, the OLF/ELR exhibit showed the **+5%-only answer** (1.050/1.024/1.000/1.000) and only corrected to the true both-changes answer (1.082/1.055/1.026/1.004) after a full rerun. On-leveling correctness is central; a display that silently lags the newest input by one change, with no per-exhibit staleness cue, can be read as final. Owner: ux-quality (recompute reactively on rate-history commit, or gate the exhibit behind an explicit "stale — rerun" state).

4. **[MAJOR] Run failures are swallowed by the UI.** Running the capped layer with no incurred-basis selections returned HTTP 422 with an *excellent, actionable* backend message (`NO_SELECTIONS`: "No LDFs are selected on the incurred basis. Switch to that basis and select factors… before running"). The frontend showed **no error banner or toast** — only the pre-existing passive "inputs have changed" staleness note. A user can click Run, see unchanged numbers, and never learn why. Surface the backend error verbatim. Owner: ux-quality.

5. **[MINOR] Cape Cod cross-check basis is confusing on the restored path.** On the capped+restored run the CC cross-check read 84.1%/85.9% while the trended rows averaged 102.5% (~17-pt gap), reconciled only for limit basis (×1.2990), not trend basis. On the clean unlimited path CC (98.9%/99.7%) sits right at the rows (99.9%), so this is a restored-path presentation issue, not a universal flaw — but a "cross-check" that sits 17 points off with no trend-basis note undermines its own purpose there.

6. **[MINOR] No section navigation on a very long single-scroll page.** 13 major exhibits on a 4,000px+ page with no sticky TOC / jump-nav / "back to top." For a working actuary moving between the triangle, the selection matrix, and the ELR repeatedly, this is real friction. Owner: design.

7. **[NIT] Restoration curve "use" vs preview ambiguity.** The uncap-factor summary line ("Uncap factor 1.2990… Applies on the next capped analysis run") appears once Fitted mode + target are set, *before* a curve is committed via its "use" button — a run in that state stayed LIMITED until I explicitly clicked "use." The preview line reads as already-applied.

8. **[NIT] Factor-stability green highlight lacks a legend.** The green "stabler" cells are explained only by the subtitle ("lower is stabler"); a one-line key would remove any doubt.

---

## WHAT GENUINELY IMPRESSED ME

- **The math is correct to the dollar, everywhere I checked** — parallelogram OLFs, trended loss ratios, both ELR averages, Expected Claims, and the restoration shortfall negative-IBNR all reconcile. That is rare and it is the whole ballgame for this persona.
- **The restoration exhibit shows its own weakness** (lognormal p99 underfit vs the KM-adjusted empirical) rather than hiding it. Intellectual honesty baked into the UI.
- **Shortfall years flagged by name with the negative-IBNR-as-artifact framing** and correct remediation guidance — this is the kind of nuance that separates a real reserving tool from a spreadsheet with a chatbot bolted on.
- **The guided derivation is reference-grade**: genuine human-decision gates, live-read evidence that reconciles to the tables, workflow that reshapes itself around your decisions, and a persistent verbatim audit trail. If the rest of the product matched this, it would be a 95.
- **The design system is coherent and disciplined** — semantic color, self-documenting exhibits, monospaced tabular figures, caveats-as-craft — density handled with taste.

---

## EVIDENCE INDEX
Screenshots (Playwright output dir `/Users/justinmorrey/YesChef/`) — safe to delete after review:
- `actng-r5-01-top.png` — landing: triangle, layer toggles, advisor
- `actng-r5-02-capped-top.png` — LIMITED layer active, capped triangle + reset banner
- `actng-r5-03-restoration.png` — (heading-only, low value)
- `actng-r5-04-elr.png` — ELR exhibit + averages + Cape Cod cross-check + diagnostics + advisor markdown
- `actng-r5-05-devlayer.png` — claim sizes, candidate caps (100k CURRENT), factor-stability CV comparison

**State left behind:** Demo project modified — cap 100,000 configured, restoration Fitted/lognormal to 1,000,000 armed, rate history +5% (2023-01-01) / +3% (2024-07-01), trends selected (sev 6.4%, freq 0%, target 2025), Selected ELR 100.0%, layer left on **Unlimited**. One ELR-derivation audit-trail note written to the Notes section. Only two console errors all session, both the benign 422 `NO_SELECTIONS` validations from my own incomplete inputs. Browser closed cleanly.
