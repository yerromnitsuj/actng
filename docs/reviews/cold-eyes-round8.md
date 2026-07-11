# Cold-Eyes Review — Round 8

- **Date:** 2026-07-10
- **Lens:** Fused persona — (1) credentialed P&C reserving actuary (FCAS, signs SAOs, derives a-prioris for real BF work), and (2) world-class, opinionated product-design expert. Live-only, blind, adversarial. Judged solely on what the browser rendered at http://localhost:5175; source read only afterward to file this report.
- **Scope:** Confirm the round-7 MAJOR fix (the Cape Cod cross-check that printed a pure premium as `45431%` in loss-ratio mode) plus the round-7 MINOR (duplicate base columns), re-verify the pure-premium method + F1–F4 + round-6 re-blend as a spot-check, then a fresh critical re-score.
- **Target:** "Demo: GL Occurrence (synthetic)" — GL occurrence loss run, AY2016–2025, evaluated 2025-12-31, with BOTH earned premium and exposure units seeded.

---

## VERDICT

### Actuary — **91 / 100** (round 7: 89)

The round-7 MAJOR is gone, and it is fixed the *right* way — not by patching the format, but by refusing to print a cross-basis number at all. When the live a-priori method differs from the method the run was computed on, the Cape Cod cross-check hides (`- paid / - incurred`), the label tracks the live basis ("pure premium" vs "ELR"), and a precise banner explains why and what to do. After a rerun the correct native value returns. Every reconciliation I attempted this round tied, and usually to the dollar, not "close enough":

- Pure premium = trended selected ultimate / exposure units, exact for all ten origin years (2016 3,549,250/10,000 = $355; 2021 5,803,596/11,041 = $526; 2024 8,528,194/11,717 = $728).
- Expected Claims consumes the selected a-priori exactly: selected pure premium 458.81/unit × Σ exposure units 109,498 = **$50,238,777**, matching the Expected Claims (paid) ultimate to the dollar; BF-paid moved 48,902,333 → 49,810,408 the moment the a-priori was set.
- The weighted blend ties: with BF/BI at weight 0 and both CL columns at weight 1, Weighted total 52,627,150 = mean(CL paid 52,551,780, CL inc 52,702,519). Exact.
- All five a-priori averages reconcile against the per-year pure premiums (straight avg $473, last-5 $597, last-3 $663, ex-hi/lo $459 = 458.81 precise, exposure-weighted $481).
- On-leveling is correctly **inert** under pure premium (OLF column 1.000, and the exhibit states it: "exposure units are not rate-sensitive, so this rate history and parallelogram on-leveling do NOT affect the a-priori").
- The Mack variability panel self-explains a 218% CoV ("incurred reserve 535,833 with standard error 1,165,967 … A standard error above 100% of reserve is expected when the reserve itself is small … signals an unstable ratio, not a calculation error") — FCAS-grade honesty about a number a lesser tool would let a reviewer misread as a bug.

What holds it at 91 rather than higher is the acknowledged-deferred methodology (single-factor restoration over-restores fully-mature years; no outlier-LDF guardrail) plus one genuinely-new, minor consistency gap: the Advisor panel narrates a superseded run in present tense (see NEW-1). No new math error surfaced.

### Design — **90 / 100** (round 7: 88)

Both of round 7's specific design docks are cleanly resolved. The visible `45431.6%` trust-wart is gone, replaced by an explanatory hide that is, if anything, a teaching moment. The redundant twin base-columns are gone — under pure premium the exhibit shows a single "Exposure units" base. What remains is best-in-class explanatory microcopy that is now *consistent* across every staleness surface:

- Method-change hide: "The a-priori method changed to pure premium since this run — rerun to refresh the exhibit (the Cape Cod cross-check, native to the run's loss-ratio basis, is hidden until then)."
- Level-aware layer banner: "You switched to the limited (capped) layer since this run — the method ultimates below are STILL at the unlimited level … Rerun to move them onto the limited (capped) basis."
- Pending-rate cue: "Pending rate edit — press Enter or click away to apply. The on-level factors and ELR exhibit use the committed history below, not this draft."
- Persistent run-error banner that surfaces the backend's structured error verbatim and preserves prior results: "Run failed — nothing changed. No LDFs are selected on the paid basis. Switch to that basis and select factors …"

The two things keeping design in the low 90s rather than higher: the long single-scroll page with no jump navigation (acknowledged-deferred, still a real ergonomic cost), and the one inconsistency in an otherwise-fanatical staleness discipline — the Advisor panel confidently states numbers from a run that no longer matches the workbench, with no "reflects an earlier run" marker (NEW-1).

---

## ROUND-7 MAJOR FIX — the Cape Cod cross-check

**Verdict: RESOLVED.** Verified in both directions with a rerun in between. Exact strings observed at each step:

**Step 1 — pure-premium run.** Method = Pure premium, Run analysis. Cape Cod cross-check:
> `Cape Cod mechanical pure premium (cross-check): $454 paid / $479 incurred` — no warning banner.

Dollars-per-unit, native to the run. All ten exhibit rows reconciled (pure premium = round(trended selected ultimate / exposure units)).

**Step 2 — toggle to LOSS RATIO without rerunning.** Cape Cod cross-check:
> `Cape Cod mechanical ELR (cross-check): - paid / - incurred` (hidden)

Banner: "… The a-priori method changed to loss ratio since this run — rerun to refresh the exhibit (the Cape Cod cross-check, native to the run's pure-premium basis, is hidden until then)." **No `45431%`, no nonsense percent anywhere on the page** (the only ≥130% figure on screen was the legitimate, self-explained Mack CoV of 218%). The label correctly flipped from "pure premium" to "ELR".

**Step 3 — rerun in loss ratio.** Cape Cod cross-check:
> `Cape Cod mechanical ELR (cross-check): 80.3% paid / 83.5% incurred` — no warning banner.

A sensible loss ratio in the ~80% range, exactly where round 7 said an honest ELR should land (premium-weighted avg 83.7%).

**Step 4 — symmetric case (loss-ratio run → toggle to pure premium without rerun → rerun).**
- Toggle to Pure premium without rerunning: `Cape Cod mechanical pure premium (cross-check): - paid / - incurred` (hidden), banner "… method changed to pure premium since this run — rerun … native to the run's loss-ratio basis, is hidden until then." **No mislabeled value.**
- Rerun in pure premium: `Cape Cod mechanical pure premium (cross-check): $454 paid / $479 incurred` — no warning.

The old failure mode (a pure premium reinterpreted as a loss ratio → `45431%`) is structurally impossible now: the cross-check refuses to render across a method mismatch and only shows its own native basis after a matching run.

### ROUND-7 MINOR — duplicate base columns under pure premium — **RESOLVED.**
Pure-premium exhibit header is now `Year | Exposure units | Selected ultimate | Trended @2025 | Pure premium` — a single base column, no "Units" twin of "Exposure units". (The separate frequency/severity table carries "Exposure units" and "Ult counts" side by side, but those are distinct quantities — exposure vs ultimate claim counts — not redundant.)

---

## PART B — pure-premium reconciliation + F1–F4 + round-6 re-blend (spot-check)

- **Pure-premium reconciliation — PASS.** All ten rows exact: pp = round(trended selected ultimate / exposure units). Trended @2025 = Selected ultimate because there are no trend selections (trend factor 1, banner-confirmed). On-leveling inert (OLF 1.000; exhibit states units aren't rate-sensitive).
- **Expected Claims / BF consume the selected pure premium — PASS.** Selected 458.81/unit (via the ex-hi/lo "use" button) → Expected Claims (paid) ultimate 50,238,777 = 458.81 × 109,498, exact; BF-paid shifted 48,902,333 → 49,810,408. With no a-priori selected, the Expected Claims row is correctly **absent** from the cross-method summary (not a blank/broken row).
- **F1 — level-aware stale banner on layer switch — PASS.** Set a 250,000 per-occurrence cap, switched Unlimited→Capped without rerunning: global "Inputs have changed since this run. The numbers below do not reflect the current selections, tail, or assumptions." + "Rerun now", plus the level-aware "You switched to the limited (capped) layer since this run — the method ultimates below are STILL at the unlimited level … Rerun to move them onto the limited (capped) basis." The capped triangle correctly re-fit (2016 caps at 3,259,877 vs 3,538,803 unlimited).
- **F2 — blank Expected Claims explained — PASS.** With no a-priori, Expected Claims doesn't compute; the a-priori exhibit note explains the wiring ("… on the next run it becomes BF's per-year a-priori … and drives the Expected Claims method. Clear it to revert BF to its derived default."). Selecting an a-priori makes the method appear and reconcile (above).
- **F3 — pending rate cue + Enter commit — PASS.** Adding a rate change and typing a value surfaced "Pending rate edit — press Enter or click away to apply. The on-level factors and ELR exhibit use the committed history below, not this draft."
- **F4 — persistent run-error banner — PASS.** A capped/paid-basis run with no capped LDFs returned a well-formed 422 (`NO_SELECTIONS`); the UI showed a persistent red banner surfacing the backend message verbatim — "Run failed — nothing changed. No LDFs are selected on the paid basis. Switch to that basis and select factors (or ask the advisor to apply them) before running the full analysis." + a dismiss control. Prior results were preserved; nothing silently mutated. (The 422 is correct validation, induced by my own basis switch — not a defect.)
- **Round-6 re-blend — PASS.** Across ~6 reruns spanning method/basis/layer/a-priori changes, the Selection-of-ultimates matrix, cross-method summary, and a-priori exhibit all re-blended onto the newest run; the run timestamp ("RUN 7/10/2026, 11:41:03 PM …") and matrix subtitle ("BLENDS THE RUN '…'") re-pointed each time, never stuck on the load-time run.

---

## RANKED NEW FINDINGS

### NEW-1 (MINOR, design) — Advisor panel narrates a superseded run in present tense
- **Where:** right-hand Advisor panel, the "What moved in the run" paragraph.
- **Symptom:** it states "the a-priori now feeds Expected Claims (ultimate ~$51.72M, unpaid ~$8.41M) and BF-paid (ultimate ~$51.20M …)" and references a "$578 selection", while the live workbench has **Selected pure premium: none**, **no Expected Claims row** in the cross-method summary, and a Cape Cod cross-check that is currently hidden pending a rerun. A first-time reviewer reading the Advisor would believe the current analysis contains a $578 a-priori and $51.72M of Expected Claims — contradicting the exhibits directly below-left.
- **Why it matters:** this app is otherwise fanatical about staleness signaling — run banner, level-aware layer banner, method-change cross-check hide, pending-rate cue all shout "this is stale, rerun." The Advisor is the single surface that confidently narrates old numbers with no timestamp or "reflects an earlier run" marker adjacent to the claim.
- **Reproduction:** load the demo; read the Advisor "What moved in the run" paragraph against the Expected loss ratio exhibit (Selected pure premium: none) and Results (no Expected Claims row).
- **Caveat / why MINOR not MAJOR:** the Advisor is a chat transcript, and chat is inherently point-in-time; the numbers were true when written. But the phrasing is present-tense ("now feeds") and unanchored. Cheapest fix: a subtle "reflects the run as of <ts>" affordance on advisor messages that assert run outputs, or a muted "superseded" tag when the message's run is no longer the active one. No math is wrong.

### Known-deferred items (commented, treated as acknowledged — NOT new)
- No jump-navigation on the long single-scroll page — still absent; still a real ergonomic cost on a page this tall.
- Single-factor restoration over-restores fully-mature years; only shortfall years flagged — unchanged.
- No guardrail on grossly-outlier LDF selections — not exercised this round; unchanged.

---

## Bottom line
The round-7 MAJOR is **RESOLVED** and resolved well — the Cape Cod cross-check now hides across a method mismatch, labels itself to the live basis, and only prints its native value ($454/$479 in pure premium, 80.3%/83.5% in loss ratio) after a matching rerun; the old `45431%` failure mode is structurally impossible. The round-7 MINOR (duplicate base columns) is **RESOLVED**. Nothing regressed: pure-premium reconciliation is exact, Expected Claims/BF consume the selected a-priori to the dollar (50,238,777 = 458.81 × 109,498), and F1–F4 + the round-6 re-blend all pass. One new, genuinely-minor consistency gap (the Advisor narrating a superseded run) is the only fresh finding and does not touch the math. **Actuary 91 / Design 90.**
