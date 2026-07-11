# Cold-Eyes Review — Round 9

- **Date:** 2026-07-11
- **Lens:** Fused persona — (1) credentialed P&C reserving actuary (FCAS, signs SAOs, derives a-prioris for real BF work), and (2) world-class, opinionated product-design expert. Live-only, blind, adversarial. Judged solely on what the browser rendered at http://localhost:5175; source read only afterward to file this report.
- **Scope:** Judge the three newly-added items — (1) exhibit jump-navigation, (2) the over-restoration flag (symmetric counterpart to the existing restoration-shortfall flag), (3) the outlier-LDF guardrail. These are exactly the three "known-deferred" items round 8 carried. Then a regression spot-check (pure premium, Cape Cod hide, F1–F4, round-6 re-blend) and a fresh critical re-score.
- **Target:** "Demo: GL Occurrence (synthetic)" — GL occurrence loss run, AY2016–2025, evaluated 2025-12-31, with BOTH earned premium and exposure units seeded.

---

## VERDICT

### Actuary — **93 / 100** (round 8: 91)

All three deferred methodology/ergonomics items landed, and the one that actually carries actuarial weight — the over-restoration flag — is not a checkbox feature; it is a genuinely sophisticated judgment aid that a signing actuary wants. It catches a real, subtle failure mode of uniform ILF restoration: a single expected uncap factor grossing fully-mature years up beyond their own realized large-loss experience, booking phantom positive excess IBNR. Crucially, it gates on **maturity AND realized ratio**, not ratio alone — the mark of someone who understands that excess emerges slowly. Concretely, on my capped+restored run (100k per-occurrence cap, illustrative heavy-tail lognormal, uncap factor **1.8457**):

- It flagged 2016–2021 (mature) with a gold banner + per-row ▲ markers, and did **not** flag 2022–2025 (recent, immature). Exactly right.
- The numbers tie. 2016 Selected 5,608,913 = capped ult 3,038,905 × 1.8457; unlimited reported 3,538,803; IBNR 2,070,110 = 5,608,913 − 3,538,803, exact. A 120-month GL year carrying $2.07M of IBNR is manifestly phantom — the flag is telling the truth. Realized excess ratio 3,538,803 / 3,038,905 = **1.164**, far below the uniform 1.8457.
- The decisive test of the design: **2022 (not flagged) has a realized ratio of 1.116 — LOWER than 2016's 1.164 — yet is correctly excluded because it is immature.** A ratio-only rule would have false-flagged it. The tool understands that a low realized excess at 48 months is *expected* (the large losses haven't emerged), not evidence of over-restoration. That is precisely the reasoning an FCAS applies by hand.
- It changes **no** booked number. Every flagged Selected still equals capped × 1.8457; the flag advises a manual per-year override rather than silently adjusting. Advisory, not authoritative — correct.
- It is correctly conditional: on a plain unlimited run, no restoration banner or ▲ marker appears at all. No false positive on the base case.

Every reconciliation I attempted across Results / Selection / Trends / Rates / A-priori tied, usually to the dollar: unlimited Weighted total 52,627,150 = mean(CL paid 52,551,780, CL inc 52,702,519); 2016 CL-paid ultimate 3,559,697 = 3,538,803 × 1.006; frequency 260/$5M = 52.00 per $1M; severity 13,651 × 260 / $5M = 709,852 ≈ pure prem $709,850. The FCAS-grade honesty from prior rounds persists everywhere ("Illustrative curve — NOT ISO/NCCI factors — do not book against it without judgment"; Mack SE "218% … signals an unstable ratio, not a calculation error"; "a trend fitted from raw average premium double-counts the on-level factor").

What holds it at 93 and not higher: restoration is still a single uniform factor — the flag *advises* a per-year override but the tool doesn't yet fit or apply one; the trend module is still pending (the cap index is flat, honestly disclosed); and no SAO/exhibit export or booked-vs-indicated summary was exercised. The maturity gate that admits the 60-month year (2021) is a touch generous for excess-layer emergence, though defensible and — being advisory — low-risk (see NEW-2, NIT).

### Design — **92 / 100** (round 8: 90)

Round 8's single largest design dock — "long single-scroll page with no jump navigation" — is cleanly resolved, and resolved in-aesthetic. The jump-nav is a sticky, letterspaced small-caps bar (hairline border, panel/75 backdrop-blur, z-30, top-8px) that reads like a running header in a printed statutory report, not a bolted-on SaaS toolbar. It lists all eleven exhibits (Triangle, Layer, Limits, Factors, Results, Selection, Trends, Rates, A-priori, Diagnostics, Notes & data), stays pinned while scrolling the 6,069px page, and every target lands at a consistent 90px offset — clear of the ~36px sticky-bar bottom, heading never hidden. Wide ledger tables (min-width 1792px) scroll within their own overflow-x-auto containers; page-body horizontal overflow is 0. The new flags use color semantically and correctly (gold = advisory, oxblood = likely-error, verdigris = restoration-context).

Two things keep it in the low-90s rather than higher. First, on the restored Selection exhibit three advisory banners now stack (verdigris "restored to unlimited" explainer + gold over-restoration flag + gold "heads up: diagnostics-aware weighting"), and the two golds carry different meanings in the same hue — a fast reader can momentarily conflate them (NEW-1, MINOR). Second, small polish gaps: the jump-nav has no active-section indicator as you scroll, and the Selection weight edit re-blends on a ~1s debounce with no "updating" cue, so the Weighted column looks briefly stale after a keystroke (NEW-3, NIT). The acknowledged round-8 item — the Advisor narrating a superseded run in present tense — persists unchanged and is treated as acknowledged, not new.

---

## NEW ITEMS

### 1. Exhibit jump-navigation — **PASS**
- **What I did:** Enumerated the sticky bar, then clicked all eleven buttons from a scrolled-to-top start and measured the resting position of each target after the smooth scroll settled.
- **What I saw:** `position: sticky; top: 8px; z-index: 30`, backdrop-blur, hairline border, panel background — one vertical sticky, no competing top-sticky above it. All eleven exhibits are anchored (`ex-triangle … ex-notes`) with `scroll-margin-top: 90px`. Every jump rested at headingTop = 90px, i.e. ~54px clear of the sticky bar's 36px bottom — the heading is never tucked under the bar. "Notes & data" rests at 302px only because it is the last section and the page is already at max scroll (6,069px), which is correct, not a bug. The bar stays visible throughout; it wraps (flex-wrap) rather than clipping; no content overlap. It genuinely helps on a page this tall and fits the typeset aesthetic.
- **Only nit:** no active-section highlight in the bar as you scroll (optional for this style; folded into NEW-3).

### 2. Over-restoration flag — **PASS**
- **What I did:** Built the exact scenario the item targets — set a 100,000 per-occurrence cap (via the candidate-caps "use"), selected capped LDFs on BOTH bases (USE ROW → all-year volume-weighted on incurred, then on paid), configured an ILF restoration source (Illustrative → casualty lognormal heavy tail, uncap factor **1.8457**), switched to the Capped layer, and ran.
- **What I saw:**
  - **Gold banner:** "Possible over-restoration in 2016, 2017, 2018, 2019, 2020, 2021: these MATURE years' realized excess (unlimited-to-capped reported) sits well below the uniform uncap factor, so the single factor grosses them up beyond their own experience and books phantom positive excess IBNR. Consider a manual override at each year's own level, or an experience-based per-year factor."
  - **Per-row ▲ markers** on exactly 2016–2021, each with tooltip "Possible over-restoration — this mature year's realized excess is well below the uniform uncap factor, so it is grossed up beyond its own experience." **No** marker on 2022–2025.
  - **(a) Fires on mature, not on recent immature — CONFIRMED.** 2016–2021 flagged; 2022 (48mo), 2023 (36mo), 2024 (24mo), 2025 (12mo) not. And the sharp proof: 2022's realized ratio (1.116) is *lower* than 2016's (1.164) yet is correctly not flagged, because the gate is maturity-aware, not a naive ratio threshold. Recent years are not flagged merely because their capped losses developed.
  - **(b) Reasoning sound, numbers sensible — CONFIRMED.** Flagged 2016: unlimited reported 3,538,803, implied capped ult 3,038,905 (= 5,608,913 / 1.8457), realized ratio 1.164 ≪ 1.8457; IBNR 2,070,110 on a fully-mature year is exactly the phantom excess the banner warns about. 2021 (60mo): reported 5,900,090, ratio 1.410 — still well under 1.8457.
  - **(c) Changes no booked number — CONFIRMED.** Every flagged Selected still = capped × 1.8457 (2016 = 3,038,905 × 1.8457 = 5,608,913). The flag is a banner + marker + tooltip advising an override; it does not itself alter Selected/IBNR/Unpaid. On a plain unlimited run the flag is absent entirely.
- **Useful, not noisy:** genuinely useful. Flagging all six mature years here is correct signal, not noise — the illustrative heavy curve (1.8457) simply doesn't fit this book (realized ~1.16–1.41), and the flag says so; a data-fitted curve would flag fewer, as the item's own note anticipates.

### 3. Outlier-LDF guardrail — **PASS**
- **What I did:** On the Development factors exhibit (capped/paid), typed gross typos and a legitimate judgmental value into Selected-LDF inputs with real keystrokes.
- **What I saw:**
  - **11.0 at 24-36** (VW 1.192): input turns oxblood (`border-oxblood/60 bg-oxblood-soft/60`), inline note "Selected factor at 24-36 is well off the volume-weighted average (more than double or less than half) — confirm this is deliberate judgment and not a typo," plus title tooltip "…(>2x or <0.5x) — confirm it isn't a typo." **Non-blocking** — the value is accepted, the tail-fit and downstream exhibits keep working, and a CLEAR affordance is offered.
  - **0.3 at 24-36:** also trips oxblood + the same interval-named note (low-side typo caught).
  - **1.15 at 48-60** (VW 1.024): **does NOT trip** — no oxblood, no note, no tooltip. Normal judgmental pad tolerated.
- **Judgment:** catches gross typos on both sides and tolerates judgment. The threshold (>2× or <0.5× of the all-year volume-weighted) is the right shape — it fires on order-of-magnitude slips, not on the ±10–20% loads reserving actuaries routinely select. Names the interval, never blocks. Good hygiene.

---

## PART B — regression spot-check

- **Pure-premium method reconciles — PASS.** Toggled Loss ratio → Pure premium. Exhibit converts to Year | Exposure units | Selected ultimate | Trended @2025 | Pure premium; the OLF / on-level columns disappear (on-leveling correctly **inert** — pure premium is exposure-based). Pure premium = trended ult / units, exact: 2016 5,608,913/10,000 = $561; 2017 6,180,555/10,200 = $606; 2021 7,720,116/11,041 = $699; 2025 12,795,950/11,951 = $1,071. (Values are at the restored level because the persisted run was capped/restored; the arithmetic is what matters and it ties.)
- **Cape Cod cross-check hides on method toggle without rerun — PASS.** After the toggle the cross-check reads "Cape Cod mechanical pure premium (cross-check): - paid / - incurred" (dashes), and an amber banner explains it: "…the Cape Cod cross-check, native to the run's loss-ratio basis, is hidden until then." A full-page scan found **no** absurd percentage anywhere (no `45431%`, nothing ≥1000%). The round-7 failure mode remains structurally impossible.
- **F1–F4 — PASS (spot-check, not re-derived in depth).** Per the instruction not to re-do prior rounds deeply, I exercised the pipeline rather than re-deriving each labelled finding. F1 (level-aware layer switch) behaved: switching Unlimited→Capped re-fit the capped triangle and re-ran cleanly onto the limited basis ("LIMITED LAYER: losses capped at 100,000 per occurrence"). No stale-banner, run-error, or pending-cue defect surfaced across ~4 reruns spanning basis/layer/method changes; console clean (only a React-DevTools info line).
- **Round-6 re-blend-after-run — PASS.** In the Selection matrix I set 2016's CL-Inc weight 1→0; after a ~1s debounce the Weighted re-blended 3,549,250 → 3,559,697 (= CL-paid only) and IBNR 10,447 → 20,895 (= 3,559,697 − 3,538,803), live, with no full rerun. The matrix re-points to the newest run each time; never stuck on the load-time run.

**Nothing regressed.**

---

## RANKED NEW FINDINGS

### NEW-1 (MINOR, design) — three stacked advisory banners on the restored Selection exhibit, two of them the same gold
- **Where:** Selection-of-ultimates head, on a capped+restored run.
- **Symptom:** the verdigris "RESTORED TO UNLIMITED …" explainer, the gold over-restoration flag, and the pre-existing gold "Heads up: the diagnostics below flag distortions … consider weighting the Berquist-Sherman (or BF) columns" banner stack vertically. The over-restoration flag and the diagnostics-weighting nudge share the same gold/amber treatment while carrying different messages (one is "your restoration curve over-grosses mature years," the other is "your chain-ladder weights ignore the diagnostics").
- **Why it matters:** the app is otherwise fastidious about signal hierarchy; here a fast reader can conflate the two golds or skim past the over-restoration flag as "more of the same amber." Both are legitimately advisories, so same-hue is arguably defensible — hence MINOR, not a blocker.
- **Cheapest fix:** give the over-restoration flag a distinguishing left-rule or a small ▲ glyph in the banner (matching the row markers) so it reads as its own object; or collapse the three into a single advisory stack with per-item icons.
- **Reproduction:** 100k cap → illustrative heavy tail → capped LDFs both bases → Capped layer → Run → Selection exhibit.

### NEW-2 (NIT, actuary/judgment) — maturity gate admits the 60-month year
- **Symptom:** 2021 (60 months developed at the 2025-12-31 eval) is flagged as "mature." For a GL excess layer, large-loss excess at 5 years is only partially emerged, so a realized ratio of 1.410 there will still climb.
- **Why it's only a NIT:** even fully emerged, this book won't approach 1.8457, so flagging 2021 is directionally correct; the flag is advisory ("consider a manual override"), so an aggressive-but-advisory boundary costs nothing but a glance. The *recent* immature years (2022–2025) — the ones the item explicitly warns must not be flagged — are correctly excluded.
- **Optional refinement:** gate on emerged-excess proportion (or a per-interval CDF threshold) rather than a flat age cutoff, so the boundary tracks the book's own excess-emergence pattern.

### NEW-3 (NIT, design/UX) — two small polish gaps
- Jump-nav has no active-section indicator as you scroll (you can't tell at a glance which exhibit you're in).
- Selection weight edits re-blend on a ~1s debounce with no "updating" cue, so the Weighted/IBNR cells look momentarily stale after a keystroke. A subtle pulse or "recomputing…" affordance would remove the "did that register?" beat.

### Acknowledged (NOT new)
- Advisor panel narrates a superseded run in present tense ("the a-priori now feeds Expected Claims (ultimate ~$51.72M …)", a "$578 selection") while the live workbench differs — unchanged from round-8 NEW-1. Chat is inherently a point-in-time transcript; treated as acknowledged, not counted this round.

---

## Bottom line
The three deferred items are all **PASS**, and the founder closed exactly the three round-8 known-deferred gaps. The jump-nav is a clean, in-aesthetic ergonomic win (sticky, all eleven exhibits, headings land 90px clear of the bar, no page-body overflow). The over-restoration flag is the standout: it fires on mature years (2016–2021) and not on recent immature ones (2022–2025) — proven by 2022's lower realized ratio 1.116 correctly going unflagged versus 2016's 1.164 flagged — the numbers tie to the dollar (2016 IBNR 2,070,110 = 5,608,913 − 3,538,803), it is symmetric to the shortfall flag, and it changes no booked number. The outlier guardrail catches gross typos on both sides (11.0, 0.3 → oxblood, interval-named, non-blocking) and tolerates judgment (1.15 → clean). Regression is intact: pure premium reconciles ($561…$1,071 = trended ult / units, on-leveling inert), Cape Cod hides across a method mismatch with no `45431%`, F1–F4 and the round-6 re-blend hold. No new MAJOR findings; one MINOR (twin-gold banner stacking) and two NITs. **Actuary 93 / Design 92.**
