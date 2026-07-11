# Cold-Eyes Review — Round 7

- **Date:** 2026-07-10
- **Lens:** Fused persona — (1) credentialed P&C reserving actuary (FCAS, signs SAOs, derives a-prioris for real BF work), and (2) world-class, opinionated product-design expert. Live-only, blind, adversarial. Judged solely on what the browser rendered at http://localhost:5175; source read only afterward to file this report.
- **Scope:** Headline feature — the NEW pure-premium method toggle on the a-priori exhibit (loss-ratio vs pure-premium). Full 7-point pure-premium verification, Part-B regression of the round-5/6 fixes (F1–F4 + round-6 re-blend), and a fresh critical re-score.
- **Target:** "Demo: GL Occurrence (synthetic)" — GL occurrence loss run, AY2016–2025, evaluated 2025-12-31, with BOTH earned premium and exposure units seeded.

---

## VERDICT

### Actuary — **89 / 100** (round 6: 90)

The pure-premium method is, on the math, close to flawless. Every reconciliation I attempted tied — usually to the dollar, not "close enough":

- Loss ratios = trended selected ultimate / on-level trended premium (2016 = 3,549,250/5,000,000 = 71.0%; 2024 = 8,528,194/7,387,277 = 115.4%).
- Pure premiums = trended selected ultimate / exposure units (2016 = 3,549,250/10,000 = $355; 2024 = 8,528,194/11,717 = $728).
- On-leveling is a correct **parallelogram** on annual policies: a +25% rate change effective 2021-01-01 gives 2016–2020 OLF 1.250 and 2021 OLF **1.111** = 1.25/1.125 — i.e. AY2021 earned premium split 50/50 between old and new rate. That is the textbook answer, and it is rare to see it implemented correctly.
- The a-priori restates correctly across cost levels: with a 5% severity trend, Expected Claims 2016 = 578/1.05⁹ × 10,000 = $3,725,840 (exact), 2025 = 578 × 11,951 = $6,907,678 (exact), total $51,722,097 — and BF consumes the same de-restated a-priori.
- All five averages tie (exposure-weighted $481, premium-weighted 83.7%, ex-hi/lo $459 / 80.0%), and the Cape Cod pure-premium cross-check ($454 paid) reconciles by hand: Σlatest-paid 43,307,914 / Σ(units × %reported) 95,326 = $454.32.
- The level-coherence guard, the restoration disclosures (fitted lognormal μ 9.13 σ 1.46, factor ×1.1137, censored MLE, flat-cap caveat, shortfall years 2021/2024), and the Mack SELECTED-basis wording are all FCAS-grade honesty. The advisor is peer-review quality and reports the a-priori in the correct units.

What holds the score at 89 rather than pushing past 90 is a single **MAJOR** but narrow defect: in loss-ratio mode the **Cape Cod mechanical ELR cross-check prints a pure premium as a percent — `45431.6% paid / 47890.7% incurred`** where an ELR should read ~80%. Those figures are exactly 100× the pure-premium dollar values ($454.32 / $478.91): the cross-check never re-computes for the method toggle, it just relabels/reformats the pure premium. It does not corrupt any reserve (BF and Expected Claims use the *selected* a-priori, not this cross-check), so it is a display/units bug, not a math bug — but it sits on the a-priori exhibit, and any reviewing actuary who sees "45431.6%" on their ELR benchmark stops trusting the panel until it's fixed. On an exhibit whose entire job is to anchor an a-priori, a wrong-by-100× number is a real dock.

### Design — **88 / 100** (round 6: 86)

The pure-premium UX is a genuine step up. The toggle is clean; dollars-vs-percent formatting is correct on the happy path ($/unit under pure premium, % under loss-ratio); and the *explanatory* surface is best-in-class for a reserving tool:

- The level-coherence explanation on the selection matrix ("Exp Clms is blank … the selected pure premium was chosen at the unlimited level but this run is restored … Re-select the pure premium on the current restored exhibit, then rerun") tells the user exactly what happened and what to do.
- The stale-run banner is **level-aware** ("You switched to the unlimited layer since this run — the method ultimates below are STILL at the restored (total-limits) level … Rerun to move them onto the unlimited basis").
- The pending-rate cue, the persistent run-error banner ("Run failed — nothing changed …"), and the no-units empty-state ("Run an analysis with exposure units data first … Import exposure_units in the Data panel") are all specific, actionable, non-slop.

Two things keep design shy of the low 90s: the same visible `45431.6%` trust-wart, and a redundant twin-column in the pure-premium table (**"Exposure units" and "Units" show the identical 10,000 side by side**). Otherwise the copy discipline and empty-state craft are clearly ahead of round 6.

---

## PURE-PREMIUM METHOD — 7-point verification

### 1. Loss-ratio path unchanged / still correct — **PASS (with MAJOR cross-check bug)**
Configured a +25% rate change (eff. 2021-01-01) and read the loss-ratio table:

| Year | Earned prem | OLF | On-level | Sel. ult (trended) | Loss ratio |
|---|---|---|---|---|---|
| 2016 | 5,000,000 | 1.250 | 6,250,000 | 3,549,250 | **56.8%** (3,549,250/6,250,000 ✓) |
| 2021 | 6,381,408 | **1.111** | 7,090,453 | 5,803,596 | **81.9%** ✓ |
| 2024 | 7,387,277 | 1.000 | 7,387,277 | 8,528,194 | **115.4%** ✓ |

Pre-rate-change loss ratios (all OLF 1.000) reconciled identically (2016 71.0%, premium-weighted 83.7% = 52,627,148/62,889,462). Averages all tie. **However**, the Cape Cod cross-check line reads `45431.6% paid / 47890.7% incurred` (see MAJOR-1). Main table and averages: correct. Cape Cod cross-check: broken.

### 2. Toggle to pure-premium and reconcile — **PASS**
- Base column switched to **Exposure units**; the **OLF column disappeared** (units aren't rate-sensitive). ✓
- Each pure premium = trended sel. ult / units (2016 $355, 2018 $337, 2021 $526, 2024 $728) — all to the dollar. ✓
- Rate insensitivity: with the +25% rate change live, every pure premium was **identical** to the no-rate-change state ($355/$526/$728). The Rates panel shows the correct note ("exposure units are not rate-sensitive, so this rate history … do NOT affect the a-priori"). ✓
- Averages exposure-weighted ($481 = 52,627,148/109,498) and Cape Cod cross-check in **$/unit** ($454 paid / $479 incurred). Values read as dollars (hundreds), never percent. ✓

### 3. A-priori feeds BF + Expected Claims — **PASS**
Selected $600 (no trend), reran:
- Expected Claims = $600 × units, exact for every year (2016 6,000,000; 2024 7,030,200; total 65,698,800 = 600 × 109,498). ✓
- BF took the pure-premium a-priori (BF Paid 2024 moved 7,901,657 → 8,522,703 = 6,707,334 + 7,030,200 × 0.348/1.348). ✓
- Re-tested with a 5% severity trend: Expected Claims **de-restates** per origin year (2016 = 600/1.05⁹ × 10,000 = 3,867,653 exact; 2024 = 600/1.05 × 11,717 = 6,695,429 exact), and BF consumes the de-restated a-priori. Later confirmed independently with the advisor's $578 selection (Expected Claims total $51,722,097). ✓

### 4. Method-switch coherence — **PASS**
With $600 PP selected, toggling to loss-ratio left the **Selected ELR field empty** (a stale 600 would have shown as 600%). Toggling back PP→LR→PP the pure-premium field was **still empty** — the clear is permanent, not a display flip. A loss ratio is never carried over as a pure premium or vice-versa. ✓

### 5. Level coherence under pure premium — **PASS**
Set cap $250K + Fitted restoration (restore to total limits), switched to the Capped layer, selected capped paid+incurred LDFs, reran:
- Exhibit re-based to **RESTORED total-limits**; restored pure premiums = restored ult / units (2016 $364, 2024 $625). ✓
- The $500 PP chosen at the unlimited level was **skipped** — Exp Clms shows "—" and the selection matrix carries the on-matrix explanation ("… the selected pure premium was chosen at the unlimited level but this run is restored, so Expected Claims and the pure premium-derived BF a-priori were skipped … Re-select …"). BF correctly fell back to its derived a-priori, not the stale $500. Same guard as loss-ratio. ✓
- Restoration disclosures correct (×1.1137, fitted lognormal, shortfall years 2021/2024 flagged — consistent with the known-deferred "only shortfall years flagged" behavior). ✓

### 6. Import + empty-state — **PASS**
- Import copy: "origin, then earned_premium (loss-ratio method) and/or exposure_units (pure-premium method); at least one. Required for Bornhuetter-Ferguson." — names both bases. ✓
- Built a throwaway project with a premium-only exposure file (no units), ran, toggled to pure premium: the table is replaced by a clear empty-state — **"Run an analysis with exposure units data first — The pure-premium exhibit compiles trended selected ultimates over exposure units from the latest run. Import exposure_units in the Data panel."** Names the exact column and where to put it. ✓ (Project deleted afterward.)

### 7. Advisor — **PASS**
Asked it to switch to pure-premium and recommend + select an a-priori. It:
- Reported the a-priori in **$/unit**, never a percent ("units are dollars per exposure unit"; "Exposure-weighted all-years: 593→578"; "Cape Cod … paid 563, incurred 576"). No `47500%`-style bug.
- **Landed its action**: selected $578 (exposure-weighted all-years, trended) — the field committed to "578" and the run label updated to "PURE-PREMIUM A-PRIORI $578 (UNLIMITED LEVEL, 2025)". The number ties: Σ(trended ultimates) 63,252,574 / 109,498 units = $577.66 → $578. ✓
- Proactively flagged the level-coherence caveat and the stale prior $500 selection.

---

## PART B — regression of the round-5/6 fixes

- **F1 — level-aware stale basis-provenance banner on layer switch — PASS.** After switching unlimited↔capped without rerunning: "You switched to the unlimited layer since this run — the method ultimates below are STILL at the restored (total-limits) level … Rerun to move them onto the unlimited basis."
- **F2 — blank Expected Claims explained on selection matrix on a-priori level mismatch — PASS.** Full on-matrix explanation present, and it now works for the pure-premium a-priori (see check 5).
- **F3 — pending rate-edit cue + Enter-commit — PASS.** Editing a rate cell shows "Pending rate edit — press Enter or click away to apply. The on-level factors and ELR exhibit use the committed history below, not this draft." Enter commits; the OLF/loss-ratio table updates only on commit.
- **F4 — persistent run-error banner — PASS.** A capped run with no capped LDFs surfaced "Run failed — nothing changed. No LDFs are selected on the paid basis …" plus an inline helper on the factors exhibit. Nothing silently mutated.
- **Round-6 re-blend (Selection/ELR/Trend re-blend the NEW run) — PASS.** After every Run (and after the advisor's run), the Selection-of-ultimates subtitle re-pointed to the newest run ("BLENDS THE RUN '…'"), never staying on the load-time run.

---

## RANKED NEW FINDINGS

### MAJOR-1 — Cape Cod ELR cross-check prints a pure premium as a percent (loss-ratio mode)
- **Where:** a-priori exhibit → Expected loss ratio (loss-ratio method) → "Cape Cod mechanical ELR (cross-check)" line.
- **Symptom:** reads `45431.6% paid / 47890.7% incurred`. An ELR for this book (per-year 60–115%, premium-weighted 83.7%) must land ~80%. The correct Cape Cod paid ELR ≈ 43,307,914 / Σ(premium × %dev ≈ 53.9M) ≈ **80.4%**.
- **Root cause (from behavior, not source):** `45431.6% = 100 × 454.316` and `47890.7% = 100 × 478.907`, which are exactly the pure-premium cross-check dollars ($454 / $479) shown in pure-premium mode. The cross-check computes a pure premium regardless of method, then the loss-ratio view slaps a `%` on it. It also did not respond when I added a rate change (a real ELR would move with on-leveling), confirming it's the rate-insensitive pure premium.
- **Reproduction:** demo → a-priori exhibit → "Loss ratio" toggle → read the Cape Cod cross-check line. Compare to the "Pure premium" toggle's Cape Cod line ($454/$479).
- **Impact:** cosmetic to the reserve (BF/Expected Claims use the *selected* a-priori, not this line) but a visibly wrong number on the headline a-priori exhibit — a trust-killer for the exact audience this tool courts. The fix is to divide reported losses by used-up **on-level premium** (not units) when the method is loss-ratio, or, if it's meant to stay a pure premium, don't label it "ELR" or format it as `%`.

### MINOR-1 — Redundant twin base-columns under pure premium
- **Where:** pure-premium a-priori table header — "Exposure units" and "Units" columns, both showing the identical value (e.g. 10,000 / 10,000) for every row.
- **Why:** the table keeps structural parity with loss-ratio mode (base → adjusted base → sel ult → trended → ratio). Under loss-ratio the two columns are "Earned premium" and "On-level trended" (meaningfully different once OLF ≠ 1). Under pure premium the adjusted base equals the base (units aren't rate-adjusted), so the second column is pure duplication.
- **Fix:** collapse to a single "Exposure units" column under pure premium, or relabel the second column to something that earns its place.

### NIT-1 — "No trend selections" context line describes the last run, not the pending edit
- **Where:** Results section, near the Cape Cod/BF detail, after a trend is selected but before rerunning.
- **Observation:** reads "No trend selections: losses are NOT trended (factor 1)" while the a-priori exhibit already shows trended values. On inspection this is *correct* — it describes the displayed (superseded) run, and the stale-run banner already covers it — so it is not a defect. Filed only as a wording-tightening candidate (e.g. "The displayed run used no trend"), since a fast scan across both panels can read as a contradiction.

### Known-deferred items (commented, treated as acknowledged)
- No jump-navigation on the long single-scroll page — still absent; still a real ergonomic cost on a page this tall, but acknowledged.
- Single-factor restoration over-restores fully-mature years; only shortfall years flagged — observed exactly this (2021/2024 shortfall flagged; mature years silently over-restored). As acknowledged.
- No guardrail on grossly-outlier LDF selections — not exercised this round; unchanged.

---

## Bottom line
The pure-premium method is a large, correctly-executed addition: the math reconciles end-to-end (loss ratio, pure premium, parallelogram on-leveling, trend restatement, Expected Claims de-restatement, BF a-priori, level-coherence guard, advisor), and the UX around it — level-aware banners, on-matrix skip explanations, pending cues, empty-states — is a clear notch above round 6. One visible units bug (the Cape Cod ELR cross-check printing a pure premium as `45431.6%`) is the single blemish on an otherwise peer-review-grade exhibit, and it is the first thing to fix. **Actuary 89 / Design 88.** No round-5/6 fix regressed.
