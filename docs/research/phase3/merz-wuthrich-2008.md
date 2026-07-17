# merz-wuthrich-2008 — primary-source transcription (research workflow, 2026-07-17)

## findings

Read the actual CAS E-Forum Fall 2008 PDF cover to cover (pp. 542-568). Key structural facts: (a) the paper gives TWO msep notions — prospective (observable CDR vs 0, the Solvency II / SST one-year risk quantity) and retrospective (true CDR vs observable CDR); (b) single-AY estimators are Results 3.1 (3.9)-(3.10) built from Delta/Phi/Psi/Gamma blocks (3.4)-(3.7); (c) aggregation adds cross terms 2*sum_{k>i} Chat_i Chat_k (Phi_i + Lambda_i) (Result 3.2) and 2*sum_{k>i} Chat_i Chat_k (Xi_i + Lambda_i) (Result 3.3) with Lambda in (3.13) and Xi in (3.14); (d) Result 3.5 gives the compact Mack-comparable forms (3.17)-(3.18) with the famous C_{I-j,j}/S_j^{I+1} scaling of later development periods; (e) everything published, including Table 4, is the linearized (A.1) version of exact product formulas (A.2)-(A.3), and the paper fixes a redundant term in eq. (4.25) of the 2007 Merz-Wuthrich Bulletin SAA paper. The worked example is a 9-AY triangle (i=0..8) with total reserves 2,237,826, aggregate one-year msep^{1/2}(0) = 81,080 vs Mack ultimate msep^{1/2} = 108,401, true-CDR sd 65,412, retrospective msep^{1/2} 33,856, realized aggregate CDR -40,075 (all $1,000).

## formulation

SOURCE: Merz, M. & Wuthrich, M.V. (2008), "Modelling The Claims Development Result For Solvency Purposes", CAS E-Forum Fall 2008, pp. 542-568. PDF: https://www.casact.org/sites/default/files/database/forum_08fforum_21merz_wuetrich.pdf (note the underscore filename: forum_08fforum_21merz_wuetrich.pdf).

NOTATION (Sec. 2): Cumulative payments C_{i,j}, accident years i in {0,...,I}, development years j in {0,...,J}, with I = J assumed. Data at time I: D_I = {C_{i,j}: i+j <= I, i <= I}; one year later D_{I+1} = D_I union {C_{i,I-i+1}: i <= I} (new diagonal). Model Assumptions 2.1 (distribution-free CL, Mack): accident years independent; E[C_{i,j} | C_{i,j-1}] = f_{j-1} C_{i,j-1} (2.6); Var(C_{i,j} | C_{i,j-1}) = sigma^2_{j-1} C_{i,j-1} (2.7).

ESTIMATORS:
(2.9) at time I:   fhat_j^I = ( sum_{i=0}^{I-j-1} C_{i,j+1} ) / S_j^I,   where S_j^I = sum_{i=0}^{I-j-1} C_{i,j}.
(2.10) at time I+1: fhat_j^{I+1} = ( sum_{i=0}^{I-j} C_{i,j+1} ) / S_j^{I+1},  where S_j^{I+1} = sum_{i=0}^{I-j} C_{i,j}.  (Note S_j^{I+1} = S_j^I + C_{I-j,j}.)
(2.11) Chat_{i,J}^I = C_{i,I-i} * fhat_{I-i}^I * ... * fhat_{J-1}^I;  (2.12) Chat_{i,J}^{I+1} = C_{i,I-i+1} * fhat_{I-i+1}^{I+1} * ... * fhat_{J-1}^{I+1}. Empty products = 1.
(3.3) sigmahat_j^2 = (1/(I-j-1)) * sum_{i=0}^{I-j-1} C_{i,j} * ( C_{i,j+1}/C_{i,j} - fhat_j )^2   (unbiased; needs I-j-1 >= 1).

CDR DEFINITIONS:
(2.15) True CDR_i(I+1) = E[R_i^I | D_I] - (X_{i,I-i+1} + E[R_i^{I+1} | D_{I+1}]) = E[C_{i,J} | D_I] - E[C_{i,J} | D_{I+1}], where X_{i,I-i+1} = C_{i,I-i+1} - C_{i,I-i}. (2.17) E[CDR_i(I+1) | D_I] = 0, so the budget prediction is 0.
(2.19) Observable CDRhat_i(I+1) = Rhat_i^{D_I} - (X_{i,I-i+1} + Rhat_i^{D_{I+1}}) = Chat_{i,J}^I - Chat_{i,J}^{I+1}, with Rhat_i^{D_I} = Chat_{i,J}^I - C_{i,I-i} (2.21), Rhat_i^{D_{I+1}} = Chat_{i,J}^{I+1} - C_{i,I-i+1} (2.22). Aggregate = sum_{i=1}^I CDRhat_i(I+1) (2.20).
(2.18) Variance of the TRUE CDR (known f_j): msep_{CDR_i(I+1)|D_I}(0) = Var(CDR_i(I+1)|D_I) = ( E[C_{i,J}|D_I] )^2 * ( sigma^2_{I-i} / f^2_{I-i} ) / C_{i,I-i}.

BUILDING BLOCKS (Sec. 3.1) — write sjr(j) := sigmahat_j^2 / (fhat_j^I)^2 for brevity (paper writes it out each time):
(3.4) DELTAhat_{i,J}^I = sjr(I-i)/S_{I-i}^I  +  sum_{j=I-i+1}^{J-1} ( C_{I-j,j} / S_j^{I+1} )^2 * sjr(j) / S_j^I        [estimation-error piece]
(3.5) PHIhat_{i,J}^I  = sum_{j=I-i+1}^{J-1} ( C_{I-j,j} / S_j^{I+1} )^2 * sjr(j) / C_{I-j,j}
(3.6) PSIhat_i^I      = sjr(I-i) / C_{i,I-i}                                                                          [pure process piece: next-year diagonal]
(3.7) GAMMAhat_{i,J}^I = PHIhat_{i,J}^I + PSIhat_i^I  >= PHIhat_{i,J}^I
(3.8) Varhat(CDR_i(I+1)|D_I) = ( Chat_{i,J}^I )^2 * PSIhat_i^I   [estimator of the true-CDR variance (2.18)]

RESULT 3.1 (single accident year):
(3.9)  msephat_{CDRhat_i(I+1)|D_I}(0)              = ( Chat_{i,J}^I )^2 * ( GAMMAhat_{i,J}^I + DELTAhat_{i,J}^I )    [PROSPECTIVE / solvency view: observable CDR around 0]
(3.10) msephat_{CDR_i(I+1)|D_I}( CDRhat_i(I+1) )   = ( Chat_{i,J}^I )^2 * ( PHIhat_{i,J}^I + DELTAhat_{i,J}^I )      [RETROSPECTIVE view: true CDR around observable CDR]
(3.11) msephat(0) = msephat(CDRhat) + Varhat(CDR_i(I+1)|D_I)  >=  msephat(CDRhat). (Equality holds only for these estimators, i.e., neglecting higher-order terms.)

RESULT 3.2 (aggregated, part I — true aggregate CDR around aggregate observable CDR):
(3.12) msephat_{sum_i CDR_i(I+1)|D_I}( sum_{i=1}^I CDRhat_i(I+1) ) = sum_{i=1}^I msephat_{CDR_i(I+1)|D_I}(CDRhat_i(I+1)) + 2 * sum_{k>i>0} Chat_{i,J}^I * Chat_{k,J}^I * ( PHIhat_{i,J}^I + LAMBDAhat_{i,J}^I )
where the cross-term index runs over 1 <= i < k <= I and (3.13):
LAMBDAhat_{i,J}^I = ( C_{i,I-i} / S_{I-i}^{I+1} ) * sjr(I-i) / S_{I-i}^I  +  sum_{j=I-i+1}^{J-1} ( C_{I-j,j} / S_j^{I+1} )^2 * sjr(j) / S_j^I.
(Note PHIhat and LAMBDAhat in the cross term carry the index of the EARLIER accident year i, i < k.)

(3.14) XIhat_{i,J}^I = PHIhat_{i,J}^I + sjr(I-i) / S_{I-i}^{I+1}  >=  PHIhat_{i,J}^I.

RESULT 3.3 (aggregated, part II — aggregate observable CDR around 0; the solvency quantity):
(3.15) msephat_{sum_i CDRhat_i(I+1)|D_I}(0) = sum_{i=1}^I msephat_{CDRhat_i(I+1)|D_I}(0) + 2 * sum_{k>i>0} Chat_{i,J}^I * Chat_{k,J}^I * ( XIhat_{i,J}^I + LAMBDAhat_{i,J}^I ).
(3.16) rewrite: msephat_agg(0) = msephat_{sumCDR|D_I}(sum CDRhat) + sum_{i=1}^I Varhat(CDR_i(I+1)|D_I) + 2 * sum_{k>i>0} Chat_{i,J}^I Chat_{k,J}^I ( XIhat_{i,J}^I - PHIhat_{i,J}^I )  >=  msephat_{sumCDR|D_I}(sum CDRhat). Same decoupling as single years.

RESULT 3.5 (Mack-interpretable closed forms; algebraically equal to 3.9/3.15 after simplifying with S_j^{I+1} = S_j^I + C_{I-j,j}):
(3.17) single AY:  msephat_{CDRhat_i(I+1)|D_I}(0) = ( Chat_{i,J}^I )^2 * [  sjr(I-i)/C_{i,I-i}  +  sjr(I-i)/S_{I-i}^I  +  sum_{j=I-i+1}^{J-1} ( C_{I-j,j} / S_j^{I+1} ) * sjr(j) / S_j^I  ]
  (note: FIRST power of C_{I-j,j}/S_j^{I+1} in the sum — the PHIhat and DELTAhat tail terms merge exactly since (C/S^{I+1})^2 (1/C + 1/S^I) = (C/S^{I+1})/S^I).
(3.18) aggregated: msephat_{sum CDRhat_i(I+1)|D_I}(0) = sum_{i=1}^I msephat_{CDRhat_i(I+1)|D_I}(0)  +  2 * sum_{k>i>0} Chat_{i,J}^I * Chat_{k,J}^I * [  sjr(I-i)/S_{I-i}^I  +  sum_{j=I-i+1}^{J-1} ( C_{I-j,j} / S_j^{I+1} ) * sjr(j) / S_j^I  ]   (again i < k, index i).
INTERPRETATION vs Mack (Remarks 3.4 & p. 559): relative to Mack's ultimate-view msep, the CDR msep keeps only the FIRST term (j = I-i) of the process variance; for estimation error the next diagonal (j = I-i) is fully considered, and all remaining runoff cells (j >= I-i+1) are scaled down by the factor C_{I-j,j}/S_j^{I+1} <= 1. Mack's quantities are (4.2) msep_Mack(Chat_{i,J}^I) = E[(C_{i,J} - Chat_{i,J}^I)^2 | D_I] and (4.3) for the sum.

IMPLEMENTATION RECIPE: compute fhat_j^I, S_j^I from the time-I triangle; S_j^{I+1} = S_j^I + C_{I-j,j} needs only time-I data (the diagonal element C_{I-j,j} is in D_I) — so ALL prospective msep formulas (3.9), (3.15), (3.17), (3.18) are computable at time I from D_I alone. Use (3.3) for sigmahat_j^2 and extrapolation (4.1) for the last column.

## publishedValues

TABLE 2 (p. 560): run-off triangle, cumulative payments in $1,000, I=8 (9 accident years i=0..8, dev years j=0..8), plus the OBSERVED next diagonal at I+1=9 (boxed in the paper; listed last in each row below in [brackets], i=1..8):
i=0: 2,202,584  3,210,449  3,468,122  3,545,070  3,621,627  3,644,636  3,669,012  3,674,511  3,678,633
i=1: 2,350,650  3,553,023  3,783,846  3,840,067  3,865,187  3,878,744  3,898,281  3,902,425  [3,906,738]
i=2: 2,321,885  3,424,190  3,700,876  3,798,198  3,854,755  3,878,993  3,898,825  [3,902,130]
i=3: 2,171,487  3,165,274  3,395,841  3,466,453  3,515,703  3,548,422  [3,564,470]
i=4: 2,140,328  3,157,079  3,399,262  3,500,520  3,585,812  [3,624,784]
i=5: 2,290,664  3,338,197  3,550,332  3,641,036  [3,679,909]
i=6: 2,148,216  3,219,775  3,428,335  [3,511,860]
i=7: 2,143,728  3,158,581  [3,376,375]
i=8: 2,144,738  [3,218,196]
(For msep-at-time-I calculations only the unbracketed D_I triangle is used; the bracketed diagonal is used only to realize the observable CDR in Table 3.)

Printed parameter rows under Table 2 (j = 0..7):
fhat_j^I     : 1.4759  1.0719  1.0232  1.0161  1.0063  1.0056  1.0013  1.0011
fhat_j^{I+1} : 1.4786  1.0715  1.0233  1.0152  1.0072  1.0053  1.0011  1.0011
sigmahat_j^2 : 911.43  189.82  97.81  178.75  20.64  3.23  0.36  0.04   (units consistent with C in $1,000)
Last-column variance by Mack extrapolation (4.1): sigmahat_7^2 = min{ sigmahat_6^4 / sigmahat_5^2, sigmahat_5^2, sigmahat_6^2 } (paper prints min{sigmahat_6^2, sigmahat_5^2, sigmahat_6^4/sigmahat_5^2}) = 0.04.

TABLE 3 (p. 561): realization of the observable CDR at t = I+1, in $1,000. Columns: i | Rhat_i^{D_I} | X_{i,I-i+1} + Rhat_i^{D_{I+1}} | CDRhat_i(I+1):
i=0:      0 |      0 |      0
i=1:  4,378 |  4,313 |     65
i=2:  9,348 |  7,649 |  1,698
i=3: 28,392 | 24,046 |  4,347
i=4: 51,444 | 66,494 | -15,050
i=5: 111,811 | 93,451 | 18,360
i=6: 187,084 | 189,851 | -2,767
i=7: 411,864 | 401,134 | 10,731
i=8: 1,433,505 | 1,490,962 | -57,458
Total: 2,237,826 | 2,277,900 | -40,075
(Digits as printed; a few rows differ by 1 from the column difference due to rounding to $1,000. The -40,075 total is the "position c) loss experience prior accident years about $ -40,000" tying back to Table 1's income statement.)

TABLE 4 (p. 562): "Volatilities of the estimates in $1,000". Columns: i | Rhat_i^{D_I} | Varhat^{1/2} (std dev of TRUE CDR, cf. 3.8) | msephat_{CDR|D_I}(CDRhat)^{1/2} (true vs observable CDR, cf. 3.10 & 3.12) | msephat_{CDRhat|D_I}(0)^{1/2} (prediction std dev of 0 vs observable CDR, cf. 3.9 & 3.15 — the SOLVENCY column) | msep_Mack^{1/2} (ultimate-claim msep, Mack [7] & 4.3):
i=1:      4,378 |    395 |    407 |    567 |    567
i=2:      9,348 |  1,185 |    900 |  1,488 |  1,566
i=3:     28,392 |  3,395 |  1,966 |  3,923 |  4,157
i=4:     51,444 |  8,673 |  4,395 |  9,723 | 10,536
i=5:    111,811 | 25,877 | 11,804 | 28,443 | 30,319
i=6:    187,084 | 18,875 |  9,100 | 20,954 | 35,967
i=7:    411,864 | 25,822 | 11,131 | 28,119 | 45,090
i=8:  1,433,505 | 49,978 | 18,581 | 53,320 | 69,552
Row "cov^{1/2}" (square-rooted cross-covariance contribution): Var column 0 | 20,754 | 39,746 | 50,361
Total: 2,237,826 | 65,412 | 33,856 | 81,080 | 108,401
(i=0 row is printed with reserve 0 and blank volatility cells. Note the aggregate totals are NOT sums of the column entries: Total^2 = sum of squares of the AY entries + (cov^{1/2})^2.)

Headline numbers quoted in the text (pp. 562-564): std dev of true aggregate CDR = $65,412; msep^{1/2} between true and observable aggregate CDR = $33,856; prediction uncertainty of 0 for the observable aggregate CDR = $81,080 ("the solvency capital/risk margin for the CDR should directly be related to this value of $81,080"); Mack full run-off total = $108,401. One-year uncertainty 81,080 vs total 108,401 reflects a SHORT-tailed line; for long-tailed lines one-year risk is about 2/3 of full run-off risk (AISAM-ACME field study).

## caveats

1) APPROXIMATION STATUS: Results 3.1-3.3 and 3.5 — and therefore ALL numbers in Table 4 — are LINEAR APPROXIMATIONS of the exact product-form formulas from Wuthrich-Merz-Lysenko [10]. Appendix A uses (A.1): prod_{j}(1 + a_j) - 1 ~ sum_j a_j for 1 >> a_j > 0, where the sum is a LOWER BOUND for the product. The exact forms are:
   PHIhat exact (A.2): [1 + sjr(I-i)/C_{i,I-i}] * ( prod_{j=I-i+1}^{J-1} [ 1 + (sjr(j)/C_{I-j,j}) * (C_{I-j,j}/S_j^{I+1})^2 ] - 1 )
   GAMMAhat exact (A.3): [1 + sjr(I-i)/C_{i,I-i}] * prod_{j=I-i+1}^{J-1} [ 1 + (sjr(j)/C_{I-j,j}) * (C_{I-j,j}/S_j^{I+1})^2 ] - 1
   with sjr(j) = sigmahat_j^2/(fhat_j^I)^2. The approximations are accurate because sjr(I-i)/C_{i,I-i} << 1 for typical claims reserving data. The Mack-style interpretation (scaling of later diagonals by C_{I-j,j}/S_j^{I+1}) "only holds true for linear approximations (A.1), otherwise the picture is more involved" (p. 559). The equality decoupling msep(0) = msep(CDRhat) + Var(true CDR) in (3.11)/(3.16) likewise holds exactly only for these estimators (higher-order terms neglected).
2) CORRECTION OF EARLIER WORK: the paper corrects a redundant term in formula (4.25) of Merz-Wuthrich [6] (Bulletin SAA 2007) via (A.4); De Felice-Moriconi's bootstrap aggregates had come out below [6]'s analytic values, which flagged the error. Implement THIS paper's LAMBDAhat (3.13), not [6]'s aggregation.
3) LAST-COLUMN SIGMA: with I = J, sigma_{J-1}^2 cannot be estimated from (3.3) (needs I-j-1 >= 1, i.e. at least 2 observed factors per column); the paper uses Mack's extrapolation (4.1) sigmahat_7^2 = min{sigmahat_6^4/sigmahat_5^2, sigmahat_5^2, sigmahat_6^2}.
4) DATA CONDITIONS: cumulative claims C_{i,j} must be positive for the variance assumption (2.7) to be meaningful; model assumes Markov chain-ladder (stronger than Mack's original two-moment assumptions — the time-series framework of [10] used for the estimation-error derivation imposes stronger assumptions); I = J assumed for simplicity but results generalize to I > J.
5) WHICH msep IS WHICH: the solvency/prospective quantity (risk capital) is msep of the OBSERVABLE CDR around 0, eq. (3.9)/(3.15)/(3.17)/(3.18) — Table 4 column 4 ($81,080 total). The retrospective quantity (true vs observable CDR) is (3.10)/(3.12) — column 3 ($33,856). Do not confuse them.
6) MINOR TRANSCRIPTION NOTES: Table 3/4 entries are rounded to $1,000 so some printed rows differ by 1 from recomputed differences (e.g. CDR i=2 printed 1,698 vs 9,348-7,649=1,699; total printed -40,075). Table 4's aggregate row combines in quadrature via the printed cov^{1/2} row, not by column addition. Also note the two S sums differ: S_j^I excludes the diagonal element C_{I-j,j}, S_j^{I+1} includes it, and both are computable from D_I.
Sources: paper PDF at https://www.casact.org/sites/default/files/database/forum_08fforum_21merz_wuetrich.pdf (local copy read in full: /Users/justinmorrey/.claude/projects/-Users-justinmorrey-YesChef/83173382-3303-4f02-a34d-10240d3984a5/tool-results/webfetch-1784269354034-igkmzd.pdf).

