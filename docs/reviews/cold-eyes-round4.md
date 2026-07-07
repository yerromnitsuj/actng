# ActNG Reserving Workbench — Cold-Eyes Review, Round 4

**Reviewer lens:** fused persona — credentialed P&C reserving actuary (FCAS, 20+ yrs, signs SAOs, veteran of ResQ/Arius/ICRFS) + world-class design expert. Blind first-time evaluation. Judged only the live product at `http://localhost:5185`; no source code read.
**Date:** 2026-07-06. **Project reviewed:** "Demo: GL Occurrence (synthetic)", accident years 2016–2025, evaluated 2025-12-31.
**Model behind the advisor:** claude-opus-4-8 (live).

---

## VERDICT

### ACTUARY — 90 / 100

This is the rare AI-flavored reserving tool that a real reviewing actuary can trust, because every number I hand-checked tied out to the dollar. I independently recomputed age-to-age factors from the paid triangle (2016 12→24 = 2,755,843/979,158 = 2.815 ✓; 2020 = 3.427 ✓; 2024 = 2.127 ✓), reproduced the entire all-year volume-weighted and straight-average LDF vectors to the third decimal, rebuilt the Chain Ladder paid ultimate from scratch (52,243,311 with the volume-weighted default, tail 1.000) and matched the on-screen exhibit origin-by-origin, and confirmed the fundamental identities hold everywhere: Ultimate − latest diagonal = Unpaid on every row, and Latest 43,307,914 + Unpaid 8,935,397 = Ultimate 52,243,311 foots exactly. The selection matrix renormalizes weights within each origin period correctly to the penny (verified across single-method isolation, two-method default, and asymmetric multi-method blends — see deep-dive). Berquist-Sherman is split correctly into case-adequacy and settlement-rate variants; the Mack panel reports SE 1,337,295 = 15.0% CV on the 8,935,397 reserve (arithmetic correct) and honestly labels its "OWN BASIS" so you know it doesn't follow the selected LDFs; the tail panel fits exponential-decay and inverse-power curves with real R² statistics (0.926 vs 0.990) and correctly excludes factors ≤1.000 where ln(f−1) is undefined. The diagnostics detect the seeded settlement speedup and case-reserve strengthening with quantified signals. This is not a chatbot bolted onto a spreadsheet; it is a correct reserving engine.

**Would I use it for a real quarter-end review?** For the analytical work — deriving LDFs, blending methods, documenting selections — yes, with one caveat: I would want the exhibit-export / working-paper output and a persisted audit trail confirmed before I signed anything (I could not exercise export in this pass). **Would I show it to a chief actuary?** Yes — but I would first fix the horizontal-clipping of the Selected/IBNR/Unpaid columns (below), because a CA who has to scroll sideways to see the bottom line will lose confidence in thirty seconds regardless of how right the math is. The 10 points I withhold are for that clipping, the absence of any whole-column weight control (a real ergonomic gap at 30 origin years), a couple of basis-consistency seams (Mack own-basis, flat incurred tail), and export/audit I could not verify.

### DESIGN — 89 / 100

This is reference-adjacent work with a genuine point of view. The type system alone earns most of the score: `Newsreader` (transitional serif) for editorial headings with tight −0.43px tracking, `Public Sans` for neutral UI, and — critically — `Spline Sans Mono` with `font-variant-numeric: lining-nums tabular-nums` for every figure. True tabular monospaced numerals are the single most important typographic decision for a reserving instrument and they nailed it: every column aligns, magnitude scans vertically, nothing shifts. The palette is a restrained ledger scheme — warm paper (~#F7F5F0), deep desaturated ink (#1A2332, not pure black), a single steel-navy for actions, and a gold/amber accent used with discipline (latest-diagonal highlighting, override flags, selected-factor provenance). Zero AI-slop tells: no gradient hero, no shadow abuse, no emoji, no rounded-everything, no purple. The factor-selection UX is quietly brilliant — per-interval LDF picks with visual provenance showing which average row each factor came from. The reason this is 89 and not 95+: the selection matrix overflows its container and hides its own output columns behind a horizontal scrollbar at a standard laptop width, which is a compositional failure on the most important exhibit; the weight-input boxes read slightly ambiguously as badges vs. editable fields; and the Selected-override input shows raw unformatted digits ("9000000") while every other cell is beautifully comma-grouped, breaking the tabular discipline the rest of the product upholds.

---

## SELECTION-OF-ULTIMATES MATRIX — DEEP DIVE

**Layout.** Per-period matrix: `Origin | CL Paid /wt | CL Inc /wt | BF Paid /wt | BF Inc /wt | B-S Case /wt | B-S Settle /wt | Weighted | Selected | IBNR | Unpaid`. Each method cell shows the indicated ultimate with a 34px weight box immediately to its right; the Selected override is a 105px box. Weight-zero method cells recede to light grey while weighted cells stay dark ink — a smart encoding that lets you scan at a glance which methods are "live" for each origin. Every input carries a precise `aria-label` ("Weight for Berquist-Sherman settlement rate - paid in 2016", "Selected ultimate override for 2024") — accessibility is genuinely well done.

**Scannable or noisy?** At 6 methods × 10 origin years it is scannable, not noisy — the tabular alignment plus the dim/dark weight encoding carry the eye down columns fine. But see the horizontal-clipping finding: the value+box pairing widens the table to 1360px, and inside the content column (clientWidth ~1009px with the advisor panel open) **the Weighted, Selected, IBNR, and Unpaid columns — the actual deliverable — are pushed behind a horizontal scrollbar.** You cannot see the bottom line without scrolling sideways. That is the headline problem with this exhibit.

**Math verification (all to the dollar):**

| Test | Weights set | Expected blend | Displayed | Result |
|---|---|---|---|---|
| 2020 (control, default) | CL Paid=1, CL Inc=1 | (3,627,005+3,636,911)/2 = 3,631,958.0 | 3,631,958 | ✓ exact |
| 2021 (asymmetric 2-method) | CL Paid=1, BF Inc=2 | (5,692,112 + 2·5,883,161)/3 = 5,819,478.0 | 5,819,478 | ✓ exact |
| 2023 (single-method isolation) | B-S Case=1 only | must equal B-S Case ult 5,825,446 | 5,825,446 | ✓ exact |
| 2024 (asymmetric 2-method) | CL Paid=1, B-S Settle=3 | (8,989,191 + 3·8,100,900)/4 = 8,322,972.75 | 8,322,973 | ✓ exact |

Renormalization within each origin period is correct, including the critical invariant: **a period with weight on only one method equals that method's ultimate exactly** (2023 = 5,825,446). The Total row re-foots: after my edits, sum of the per-row Weighted column = 51,906,841 = displayed Total Weighted ✓; Total IBNR/Unpaid tie (the app sums unrounded values, so my sum of rounded rows drifts ≤1 dollar — correct behavior).

**Selected override.** Typed 2024 Selected = 9,000,000 → IBNR recomputed to 856,948 (= 9,000,000 − reported incurred 8,143,052 ✓) and Unpaid to 2,292,666 (= 9,000,000 − paid 6,707,334 ✓); Total Selected jumped to 52,583,868 (= weighted total − old 2024 weighted + override, ✓). The overridden cell is flagged in gold. Clearing the override reverts 2024 to IBNR 179,921 / Unpaid 1,615,638 and the Total back to 51,906,841 — clean round-trip. Overrides correctly win over the weighted blend, per period only.

**Do I miss a whole-method-column setter?** Yes. Per-cell-only weighting is *acceptable* at 10 origin years but tedious — setting a coherent scheme took ~15 individual commits. **At 30 origin years it would be genuinely painful** and error-prone (imagine down-weighting raw CL on the last 8 green years across a 30-row triangle, one cell at a time). The deliberate removal of an all-periods setter row went too far. Recommendation: add a compact column-header affordance to "apply this weight to all periods" (or to the green/mature subsets), while keeping per-cell override as the precision layer. This is the one design decision I would push back on hardest.

---

## RANKED FINDINGS

1. **[MAJOR] Selection matrix hides its own output columns behind a horizontal scrollbar.** At a 1512px viewport with the advisor panel open, the container `clientWidth` is ~1009px but the table is 1360px, so Weighted / Selected / IBNR / Unpaid — the columns the whole exhibit exists to produce — require sideways scrolling. A reviewing actuary should never have to scroll to see the reserve. Fix: let the matrix use full page width (collapse/float the advisor over it), sticky the Origin column and the Selected/IBNR/Unpaid columns, or offer a compact/wide density toggle. *Owner: front-end/layout.*

2. **[MAJOR] No whole-method-column (or all-periods) weight control.** Per-cell-only weighting does not scale. Fine at 10 years, painful and error-prone at 30. Reintroduce a column-level "apply to all periods" affordance without losing per-cell override. *Owner: product/front-end.*

3. **[MINOR] Mack panel silently uses a different basis than the selected LDFs.** After I switched to 5-year volume-weighted LDFs (CL paid unpaid 8,603,370), the Mack reserve stayed 8,935,397 because it computes on its "OWN BASIS: all-year volume-weighted, no tail." This is theoretically defensible (Mack's variance formula is defined on the volume-weighted link-ratio estimator) and it *is* labeled — but the headline reserve and the Mack reserve no longer agree, and only the fine-print label reconciles them. A chief actuary will ask about it. Consider computing Mack on the selected basis, or surfacing the discrepancy more prominently. *Owner: methods/UX.*

4. **[MINOR] Selected-override input renders raw unformatted digits.** While typed/committed it shows "9000000" rather than "9,000,000", breaking the tabular comma-grouping that every other cell in the product upholds. Format on commit. *Owner: front-end.*

5. **[MINOR] Diagnostics narrative tension not reconciled.** The diagnostics warn of a settlement speedup (a calendar-year phenomenon) while the Mack calendar-year test reports "Z = 16.0 vs expected 13.3, 95% range 9.4–17.2 — no significant diagnostic effects." Not contradictory (the Mack CY test detects adjacent-factor rank correlation, not a monotonic settlement trend), but the two live in the same section and a careful reader will notice. One sentence acknowledging the distinction would close it. *Owner: content/methods.*

6. **[MINOR] Incurred tail is flat 1.0 while the paid side gets a fitted tail.** The advisor itself flagged this. If the paid triangle warrants a 1.0062 inverse-power tail, the incurred triangle probably warrants one too; leaving it at 1.0 quietly biases the incurred methods. Offer/prompt a tail fit on the incurred basis. *Owner: methods.*

7. **[NIT] Weight boxes read slightly as badges, not editable fields.** The thin-bordered 34px boxes are inferable as inputs but a first-timer may not immediately register them as editable (I confirmed via aria-label that they are). A subtle affordance (caret on focus, faint fill, or a one-time hint) would remove the ambiguity.

8. **[NIT] Instance was not pristine on load, contra the brief.** The task described a freshly-seeded, nothing-run-yet instance, but the project opened with a full computed run already present (Chain Ladder / BF / B-S / Mack / the selection matrix all populated, run label "SEED BASELINE (ALL-YEAR VOLUME-WEIGHTED, NO TAIL)"). Either the seed auto-runs a baseline or prior state persisted. Not a defect per se — a baseline-on-seed is arguably a nice touch — but worth confirming it is intentional, because it changes the empty→working first-run story.

---

## AI ADVISOR — THE ANTI-SLOP TRUST TEST (passed)

I asked the advisor to review the triangle and diagnostics and to actually set diagnostics-aware per-period selection weights, then report the resulting total ultimate and IBNR "so I can check it against the exhibit."

**It acted on the workspace.** The tool trace showed real actions: Read workspace → Assessed data quality → Analyzed development factors → Read analysis results → Read diagnostic detail (×2) → **`set_ultimate_selection`**. Not talk — it mutated the exhibit.

**Its prose numbers tied to the rendered exhibit to the dollar.** It reported "Total selected ultimate: 50,627,041 / IBNR: −1,539,645 / unpaid: 7,319,128." I then read the live selection-matrix Total row: Selected **50,627,041**, IBNR **−1,539,645**, Unpaid **7,319,128**. Exact match on all three. This is the behavior that separates a trustworthy AI-native actuarial tool from slop, and it worked.

**The weighting scheme it set would survive peer review.** It put heavy CL weight on the mature clean years (2016–2020: CL 2,2 with light B-S 1,1) and *flipped* on the distorted green years — 2023/2024 dropped both raw CL methods to zero and loaded the Berquist-Sherman adjustments (2,2) plus BF, and 2025 leaned on BF. That is precisely the correct actuarial response to a settlement speedup plus case-reserve strengthening: down-weight the distorted raw chain ladder on recent origins, up-weight the adjustments that correct for the distortion.

**Its reasoning is genuinely sophisticated.** It quoted specific diagnostic figures (24-month closure rates 0.818/0.831/0.832 for 2022–2024; average case severity 22.9K/27.5K/31.0K for 2023–2025 — all pulled from the grids, not invented), it caught that the total IBNR had gone materially negative and correctly flagged **negative IBNR on a green accident year (2025, −1.02M) as a red flag**, and it made a subtle, correct distinction that many analysts miss: the +11.4%/period case signal *could be genuine severity trend rather than adequacy change*, in which case the B-S case adjustment over-corrects incurred downward. That is a peer-review-grade caveat. It also correctly noted the incurred tail is flat 1.0 (finding #6). It then offered to persist the rationale as a note or address the 2025 issue — closing the loop.

This is the strongest part of the product.

---

## WHAT GENUINELY IMPRESSED ME

- **The math is right, everywhere I checked, to the dollar** — factors, averages, CDFs, chain ladder, per-period weighted renormalization, override recomputation, Mack CV, tail R² fits, totals footing. For a tool claiming production-readiness, this is the whole ballgame and it holds.
- **The advisor's numbers tie to the exhibit and its actions change the workspace.** No hallucinated figures. This is the anti-slop bar and it clears it cleanly.
- **Per-interval LDF selection with visual provenance** — each selected age-to-age factor highlights its source average row, and the composed "Selected LDF" row carries full precision. That is more thoughtful than most commercial packages.
- **Tail fitting done honestly** — two curve forms with real R² (0.926 exponential vs 0.990 inverse-power), correct exclusion of factors ≤1.000 where ln(f−1) is undefined, plus a manual override. This is how it should work.
- **Stale-results discipline** — changing an LDF/tail/basis triggers clear, well-worded banners ("Inputs have changed since this run. The numbers below do not reflect the current selections, tail, or assumptions") on both the results and the selection matrix, with a "Rerun now" affordance and timestamped, *named* run labels ("RUN 7/6/2026, 7:09:37 PM - ANALYSIS AS OF 2025-12-31") plus a run-history selector. That is audit-grade provenance.
- **The type/number system** — tabular monospaced figures, a disciplined three-typeface stack, a restrained ledger palette. Best-in-class craft with a clear point of view and zero AI-slop tells.
- **Zero console errors** across the entire session, including the live opus advisor round-trip.

---

## EVIDENCE INDEX

Screenshots (Playwright MCP wrote these to `/Users/justinmorrey/YesChef/` — clean up from there):
- `actng-r4-01-landing.png` — project list / landing.
- `actng-r4-02-project.png` — project view: paid triangle + development factors + advisor.
- `actng-r4-03-selection-matrix.png` — selection-of-ultimates matrix (shows right-edge clipping).
- `actng-r4-04-override.png` — matrix body with 2024 Selected override = 9,000,000 (gold flag; raw digits) + diagnostics warnings.
- `actng-r4-05-stale.png` — averages exhibit, per-interval LDF provenance highlighting, Selected LDF composite row.
- `actng-r4-06-tail.png` — tail-fitting panel (exponential 1.0004 R²0.926 / inverse-power 1.0062 R²0.990 / judgmental) + run label.
- `actng-r4-07-advisor.png` — advisor response rendered in panel.

**State left behind:** Project "Demo: GL Occurrence (synthetic)" is modified from its seed baseline. Current run uses 5-year volume-weighted LDFs with a 1.0062 fitted inverse-power tail. The selection matrix carries the advisor-set diagnostics-aware weights (mature years CL-heavy, green years B-S/BF-heavy); no Selected overrides remain (the 2024 test override was cleared). Browser closed cleanly. No storage wipe performed — per standing project convention the recipyapp clean-room wipe does not apply to this local ActNG instance, and wiping would have destroyed run state the founder may want to inspect.
