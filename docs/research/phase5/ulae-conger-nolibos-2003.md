# ulae-conger-nolibos-2003 — primary-source transcription (research workflow, 2026-07-17)

## formulation

SOURCE (primary, fetched and read in full): Conger, R.F. & Nolibos, A., "Estimating ULAE Liabilities: Rediscovering and Expanding Kittel's Approach," CAS Forum, Fall 2003, pp. 93-139 (corrected v2 PDF at https://www.casact.org/sites/default/files/old/forum_03fforum_03ff093v2.pdf; includes Sept 2008 errata page). Friedland's textbook treatment of the same material is Chapter 17 ("Estimating Unpaid Unallocated Claim Adjustment Expenses," pp. 386-417 of the 2010 CAS text, freely accessible at https://www.casact.org/sites/default/files/database/studynotes_friedland_estimating.pdf), not Chapter 16.

TERMINOLOGY: throughout, "losses" means losses + ALAE.

== THE GENERALIZED (CONGER-NOLIBOS / "GENERALIZED KITTEL") FRAMEWORK ==

Weights (p. 109): Let U1 + U2 + U3 = 100%, where
- U1 = percentage of ultimate ULAE spent OPENING claims,
- U2 = percentage of ultimate ULAE spent MAINTAINING claims,
- U3 = percentage of ultimate ULAE spent CLOSING claims.

Loss measures for a time period T (p. 109):
- R = the ULTIMATE cost of claims REPORTED during period T (reported amounts plus all future development on those known claims),
- P = the losses PAID during period T,
- C = the ULTIMATE cost of claims CLOSED during period T (final cost including any payments made after closing — reopenings assumed costless; see caveats).
NOTE THE ORDERING in their basis: the weights attach as U1↔R (opening ∝ ultimate cost of claims reported), U2↔P (maintaining ∝ payments made), U3↔C (closing ∝ ultimate cost of claims closed). The user's prompt phrased B = U1*R + U2*P + U3*C — that matches the paper exactly, but note U2 is the MAINTAINING weight on Paid, and U3 the CLOSING weight on Closed-ultimate.

Core identity (p. 111): M = (R × U1 × W) + (P × U2 × W) + (C × U3 × W), where W = ratio of ultimate ULAE to ultimate losses (L), and M = total ULAE paid during period T.

Loss basis (p. 111): B = (U1 × R) + (U2 × P) + (U3 × C).
Hence M = B × W and the observed calendar-period ULAE ratio is W = M / B. The actuary computes W by calendar year, then judgmentally selects W* for projection.

Ultimate ULAE (p. 112): U = W* × L, with L = independently estimated ultimate losses for the accident-year group.

== THREE RESERVE FORMULAS (pp. 113-115), analogous to expected-loss / Bornhuetter-Ferguson / development loss reserving ==
Let R(t) = ultimate cost of claims known (reported) as of time t, C(t) = ultimate cost of claims closed as of t, P(t) = total paid as of t, all for the accident-year group with ultimate L.

(1) "Expected loss" form: Unpaid ULAE = (W* × L) − M   [M = ULAE paid to date; NOT their preferred form — shares expected-loss-ratio distortions]

(2) "Bornhuetter-Ferguson" form (THEIR PREFERRED): 
Unpaid ULAE = W* × { U1×[L − R(t)] + U2×[L − P(t)] + U3×[L − C(t)] } = W* × {L − B} 
(where B here = U1×R(t) + U2×P(t) + U3×C(t) evaluated cumulatively to date). The three terms are exactly the pure-IBNR vs case-development vs unsettled split:
- U1×[L − R(t)] = provision for OPENING claims not yet reported (L − R(t) = pure IBNR, i.e., 100% of future opening activity sits on unreported claims);
- U2×[L − P(t)] = provision for MAINTAINING/paying: payments on currently active claims AND on claims to be reported in the future (L − P(t) = total unpaid losses);
- U3×[L − C(t)] = provision for CLOSING all "unclosed" claims: those open at t plus those to be reported/opened in the future.

(3) "Development" form: Unpaid ULAE = M × (L/B − 1)   [implies ULAE liability proportional to ULAE paid to date; overly responsive to random ULAE emergence, "warrants further investigation"]

Appendix (pp. 137-139) derivation: M(t) = W × [U1×R(t) + U2×P(t) + U3×C(t)]; for a calendar period between s and t, W = [M(t) − M(s)] / { U1×[R(t)−R(s)] + U2×[P(t)−P(s)] + U3×[C(t)−C(s)] }, i.e., W = M/B with M = M(t)−M(s), R = R(t)−R(s), P = P(t)−P(s), C = C(t)−C(s). Procedure not restricted to accident years (works for accident quarters or inception-to-date).

== SPECIAL CASES ==

KITTEL REFINED METHOD (pp. 126-127, Table 1 "Equivalence of Kittel's refined method and generalized approach"): Kittel's implicit assumptions are (a) no partial payments or reopened claims, so P = C = paid losses; (b) no future case development, so IBNR = pure IBNR and R = reported losses; (c) 50% of ULAE spent opening, 50% spent closing. Weight triple: U1 = 50%, U2 = 0%, U3 = 50%. Then:
W = M/B = M/(R×U1 + P×U2 + C×U3) = M/[50%×(R+C)] = paid ULAE / [50% × (paid loss + reported loss)]  — exactly Kittel's ratio of CY paid ULAE to the average of CY paid and CY reported losses.
Unpaid ULAE = W*×(L − B) = W*×[L − 50%×(R+C)] = W*×[L − R + 50%×(R − C)] = W*×[IBNR + 50% × case reserves].

CLASSICAL PAID-TO-PAID METHOD (pp. 98-99): same 50/50 ULAE-lifecycle assumption as Kittel — "half of ULAE is incurred when new claims are set up, and the remaining half is spent closing them" (footnote 3: more accurately "half the ULAE is spent with the PAYMENT of claims," since descriptions conflate closing and paying) — so in generalized notation the classical method is ALSO U1 = 50%, U2 = 0%, U3 = 50%, but with the ADDITIONAL steady-state simplification that paid losses ≈ reported losses (R ≈ P ≈ C), collapsing the basis to B ≈ paid losses. So: W = CY paid ULAE / CY paid losses, and reserve = selected ratio × [IBNR + 50% × case reserves]. (Per footnote 4, a more correct application is full ratio × pure IBNR (IBNYR) + half ratio × (case reserves + IBNER), since booked "IBNR" usually includes IBNER.)

KITTEL'S OWN GENERALIZATION (p. 100): Kittel's paper briefly outlined ULAE = incurred losses × "opening factor" + paid losses × "closing factor" + mean loss reserves × "open factor"; with opening = 50%, closing = 50%, open = 0% it reduces to the familiar Kittel formula. C-N's method fixes its incorrect equating of paid losses with closed claims and incurred losses with ultimate cost of reported claims.

JOHNSON / COUNT-BASED SPECIAL CASE (pp. 116-117): count analogue b = (v1 × r) + (v2 × o) + (v3 × c) with r = reported claim counts, o = open claim counts, c = closed claim counts; w = M/b; Unpaid ULAE = Σ_i w*_i × [(v1 × r_i) + (v2 × o_i) + (v3 × c_i)] over future calendar years i until all claims close (a claim open several years is counted each year). Wendy Johnson's method = the case v1 = 2, v2 = 1, v3 = 0.

SIMPLIFICATION when R and C are hard to estimate (pp. 119-121, with Sept 2008 errata): if no extra effort to close (U3 = 0, so U1 + U2 = 1), approximate B̂ = (U1 × A) + (U2 × P) where A = ultimate losses for the CORRESPONDING ACCIDENT year (proxy for ultimate cost of claims reported in the calendar year; errata: CY amount = AY ultimate + pure IBNR at BEGINNING of year − pure IBNR at END of year). Reserve: Unpaid ULAE = W* × {L − [(U1 × R) + (U2 × P)]} = W* × [U1×(L − R) + U2×(L − P)], with L − R = estimated pure IBNR and L − P = total unpaid losses.

## publishedValues

WORKED EXAMPLE — "XYZ INSURANCE COMPANY, REVIEW OF ULAE RESERVES AS OF 12/31/2002" ($000's), a workers-compensation writer that began operations in 1997 (rapid growth). All figures transcribed exactly from Exhibits A.1-F (pp. 128-134 of the Forum PDF) and independently re-verified arithmetically.

EXHIBIT A.1 — INPUT PARAMETERS by Calendar Year: columns (2) CY Paid ULAE [= M], (3) CY Paid Loss & ALAE [= P], (4) CY Reported Loss & ALAE, (5) Est. Ultimate Loss & ALAE on Claims Reported in Cal. Year [= R]:
1997: M=1,978; P=4,590; Rep=19,534; R=27,200
1998: M=4,820; P=14,600; Rep=57,125; R=76,700
1999: M=8,558; P=38,390; Rep=85,521; R=106,900
2000: M=12,039; P=58,297; Rep=128,672; R=154,300
2001: M=13,143; P=86,074; Rep=145,070; R=163,100
2002: M=15,286; P=105,466; Rep=163,626; R=176,400
Total: M=55,824; P=307,417; Rep=599,547; R=704,600

EXHIBIT A.2 — by Accident Year: (2) Ultimate Loss & ALAE, (3) IBNR at 12/31/2002, (4) Reported at 12/31/2002:
1997: 28,600 / 257 / 28,343
1998: 79,200 / 1,742 / 77,458
1999: 108,400 / 5,095 / 103,305
2000: 156,700 / 16,140 / 140,560
2001: 163,400 / 34,477 / 128,923
2002: 177,100 / 56,141 / 120,959
Total: L=713,400 / IBNR=113,853 / Reported=599,547. Case reserve (Exhibits B/C line) = 292,130 [= 599,547 − 307,417].

EXHIBIT B — TRADITIONAL (classical paid-to-paid): ratios (2)/(3) by year: 1997 0.431; 1998 0.330; 1999 0.223; 2000 0.207; 2001 0.153; 2002 0.145; all-year 0.182. (5) Selected ULAE ratio = 0.160. (6) Case reserve 292,130; (7) IBNR 113,853. (8) Indicated ULAE Reserve = (5) × [(7) + 50% × (6)] = 0.160 × 259,918 = $41,587.

EXHIBIT C — KITTEL: ratio (5) = (2)/{50% × [(3)+(4)]}: 1997 0.164; 1998 0.134; 1999 0.138; 2000 0.129; 2001 0.114; 2002 0.114; all-year 0.123. (6) Selected = 0.115. (9) Indicated ULAE Reserve = (6) × [(8) + 50% × (7)] = 0.115 × 259,918 = $29,891.

EXHIBIT D — GENERALIZED METHOD, 60/40 ASSUMPTION (U1=60%, U2=40%, U3=0): Loss Basis (5) = 60%×(3) + 40%×(4) [col (3)=R, col (4)=P]; ULAE Ratio (6) = (2)/(5):
1997: B=18,156, W=0.109; 1998: B=51,860, W=0.093; 1999: B=79,496, W=0.108; 2000: B=115,899, W=0.104; 2001: B=132,290, W=0.099; 2002: B=148,026, W=0.103; Total B=545,727, W=0.102.
(7) Selected W* = 0.100. (8) Ultimate loss and LAE = 713,400. (9) Indicated ULAE Reserve: (a) "expected loss" = (7)×(8) − Total(2) = 0.10×713,400 − 55,824 = $15,516; (b) "Bornhuetter-Ferguson" = (7)×{(8) − Total(5)} = 0.10×(713,400 − 545,727) = $16,767; (c) "development" = {(8)/Total(5) − 1.0} × Total(2) = $17,152.

EXHIBIT E — GENERALIZED, 70/30 ASSUMPTION (U1=70%, U2=30%, U3=0): Basis: 1997 20,417 (W 0.097); 1998 58,070 (0.083); 1999 86,347 (0.099); 2000 125,499 (0.096); 2001 139,992 (0.094); 2002 155,120 (0.099); Total 585,445 (0.095). Selected W* = 0.100. Reserves: (a) expected loss $15,516; (b) B-F $12,795; (c) development $12,201.

EXHIBIT F — SIMPLIFIED GENERALIZED, 60/40 (basis uses Acc. Year Ultimate A in place of R): B = 60%×A + 40%×P: 1997 18,996 (0.104); 1998 53,360 (0.090); 1999 80,396 (0.106); 2000 117,339 (0.103); 2001 132,470 (0.099); 2002 148,446 (0.103); Total 551,007 (0.101). Selected W* = 0.100. (9) Est. pure IBNR: (a) 4% of latest AY ultimate = $7,084; (b) 6% = $10,626. (10) Indicated ULAE Reserve = (7) × {60% × 9(x) + 40% × [(8) − Total(4)]} [note (8) − Total(4) = 713,400 − 307,417 = 405,983 = total unpaid loss & ALAE]: (a) $16,664; (b) $16,877.

Narrative anchors (pp. 122-123): paid ULAE averaged 18% of paid losses over 6 years; traditional method might select 16%; claims-department interviews suggested ~60-70% of work at claim reporting, 30-40% over remaining life, no extra closing effort (U3=0); generalized observed ratios range 8-11%; selected 10%. "The reader will note the significant difference between this ratio [10%] and the ratios indicated by the traditional [16%] and Kittel [11.5%] methods." Reserve comparison for a fixture: Traditional $41,587 vs Kittel $29,891 vs Generalized B-F $16,767 (60/40) / $12,795 (70/30).

SMALLEST SELF-CONTAINED FIXTURE SLICE (one year, Exhibit D 1997 row + totals): U=(0.6,0.4,0.0); M=1,978, R=27,200, P=4,590 → B = 0.6×27,200 + 0.4×4,590 = 18,156; W = 1,978/18,156 = 0.109. Full-fixture check: totals M=55,824, B=545,727 → W=0.102; with W*=0.10, L=713,400: reserves 15,516 / 16,767 / 17,152 (expected-loss / B-F / development).

## caveats

WHEN PAID-TO-PAID MISLEADS (pp. 98-99): "the Classical Paid-to-Paid Ratio Method can lead to inaccurate results whenever the volume of losses is growing — since the paid-to-paid ratios will be overstated due to the mismatch between ULAE and losses paid." A growing book reports (and spends opening ULAE on) many claims whose loss payments haven't emerged yet, so the numerator leads the denominator; mechanical application materially OVERSTATED ULAE reserves for the paper's rapidly-expanding WC insurer (18% paid-to-paid vs ~10% generalized). Symmetrically a shrinking book understates the ratio. Kittel notes inflation also distorts the classical method (footnote 5, and p. 125: loss inflation can materially distort projected ULAE; the authors did NOT measure the generalized method's relative accuracy in an inflationary environment).

STEADY-STATE ASSUMPTIONS of the classical method (pp. 98-99): (a) the company's ULAE-to-loss relationship has reached steady state, so paid-to-paid approximates ultimate-ULAE-to-ultimate-loss; (b) future claims-management activity on not-yet-reported and reported-but-unclosed claims is proportional to IBNR and case reserve dollars respectively. The classical method also implicitly equates paid losses with reported losses (fine only at steady state) — Kittel's refinement removes exactly that; the C-N generalization additionally removes the 50/50 lifecycle assumption. Footnote 4: booked "IBNR" typically includes IBNER, not just unreported claims; strictly the full ratio belongs on IBNYR only, half-ratio on case + IBNER.

DOLLAR-PROPORTIONALITY ASSUMPTION (pp. 110, dollar-based methods generally): ULAE spent opening ∝ ultimate cost of claims reported; maintaining ∝ payments made; closing ∝ ultimate cost of claims closed — i.e., a $1,000 claim takes 10x the ULAE of a $100 claim. Count-based methods assume the opposite (per-transaction cost independent of size). The methods only need to be right for the AVERAGE claim in the period, but the assumption's appropriateness "warrants further analysis" per application.

CHOOSING U1/U2/U3 (pp. 118, 109): "there is no convenient handbook providing the values of U1, U2 and U3" — they vary significantly by carrier and coverage (litigation-intense liability books concentrate activity near settlement; workers compensation has large front-end cost). The authors found it feasible to develop RANGES by interviewing claims personnel, then (a) test consistency of resulting ULAE ratios (year-to-year stability of observed W is supporting evidence for the selected weights — the paper's 60/40-70/30 ratios were far more regular than paid-to-paid) and (b) run sensitivity of the reserve across the range (Exhibits D vs E: B-F reserve 16,767 vs 12,795). Spalla-style work-measurement studies can give an empirical basis. Benchmark U-values by line/segment flagged as an open research project. U3=0 is reasonable where no distinct closing effort exists (their WC example) but "may be inappropriate" e.g. employment practices liability, where settlement carries much of the cost.

OTHER LIMITATIONS: reopenings assumed costless (footnote 7, pp. 124-125) — an alternative sets C-hat = amounts paid to date on closed claims (prices "reclosing" but still not reopening work; if reopenings are material, add a separately-estimated provision). Estimating R and C (ultimate cost of reported/closed claims) is non-trivial (p. 119); the simplification substitutes accident-year ultimates and needs U3=0. The 1998 statutory LAE reclassification (ULAE → "Other Adjusting Expenses") can break historical consistency of M (footnote 8, p. 124). The development-form reserve (M × (L/B − 1)) is overly responsive to random ULAE emergence. The Sept 2008 errata corrects only a p. 119 sentence (pure IBNR at beginning vs end of year in the CY-amount identity), no exhibit numbers.

SOURCING CAVEATS: everything above is transcribed from the primary PDF (casact.org, forum_03fforum_03ff093v2.pdf) and every exhibit figure was independently recomputed and matched. The Friedland chapter covering this material is Chapter 17 (pp. 386-417, 2010 edition, freely available at casact.org/sites/default/files/database/studynotes_friedland_estimating.pdf), NOT chapter 16 as the task stated; it presents the same classical/Kittel/Conger-Nolibos progression but I did not transcribe it separately — the primary paper governs. Friedland and exam study aids sometimes relabel W as the "ULAE ratio" applied with slightly different notation; use the paper's notation above as canonical.

