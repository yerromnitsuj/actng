# munich-chain-ladder-quarg-mack-2004 — primary-source transcription (research workflow, 2026-07-17)

## formulation

NOTATION (Ch. 2, Sec 2.1.1). n accident years, development time T = {1,...,m}, usually m = n. P_{i,t} and I_{i,t} = cumulative paid and incurred losses of accident year i after t development years. c_i := n+1-i is the current development time of accident year i. Conditions: P_i(s) := {P_{i,1},...,P_{i,s}}, I_i(s) := {I_{i,1},...,I_{i,s}}, and B_i(s) := {P_{i,1},...,P_{i,s}, I_{i,1},...,I_{i,s}} (knowledge of BOTH processes to time s). The (P/I) process: Q_i := P_i/I_i, i.e. Q_{i,t} = P_{i,t}/I_{i,t}; the (I/P) ratio is Q^{-1}_{i,s} = I_{i,s}/P_{i,s}.

MACK CHAIN-LADDER ASSUMPTIONS (Sec 2.1.2), for t = s+1:
PE: E(P_{i,t}/P_{i,s} | P_i(s)) = f^P_{s->t}. PV: Var(P_{i,t}/P_{i,s} | P_i(s)) = (sigma^P_{s->t})^2 / P_{i,s}. PU: accident years independent. IE/IV/IU: analogous for incurred with f^I_{s->t}, (sigma^I_{s->t})^2 / I_{i,s}. MCL replaces PU and IU by PIU: independence of accident years across BOTH paid and incurred jointly.

CONDITIONAL RESIDUAL (Sec 2.2): Res(X|C) := (X - E(X|C)) / sigma(X|C), where sigma(X|C) := sqrt(Var(X|C)). By construction E(Res|C)=0, Var(Res|C)=1.

MCL MODEL ASSUMPTIONS (Sec 2.2.1), for t = s+1, all i:
PQ: there exists a constant lambda^P such that E( Res(P_{i,t}/P_{i,s} | P_i(s)) | B_i(s) ) = lambda^P * Res(Q^{-1}_{i,s} | P_i(s)); equivalently
E(P_{i,t}/P_{i,s} | B_i(s)) = f^P_{s->t} + lambda^P * [ sigma(P_{i,t}/P_{i,s} | P_i(s)) / sigma(Q^{-1}_{i,s} | P_i(s)) ] * ( Q^{-1}_{i,s} - E(Q^{-1}_{i,s} | P_i(s)) ).
IQ: there exists a constant lambda^I such that E( Res(I_{i,t}/I_{i,s} | I_i(s)) | B_i(s) ) = lambda^I * Res(Q_{i,s} | I_i(s)); equivalently
E(I_{i,t}/I_{i,s} | B_i(s)) = f^I_{s->t} + lambda^I * [ sigma(I_{i,t}/I_{i,s} | I_i(s)) / sigma(Q_{i,s} | I_i(s)) ] * ( Q_{i,s} - E(Q_{i,s} | I_i(s)) ).
Note the asymmetry (Sec 1.3.1): PAID factors regress on (I/P) residuals (the reciprocal linearizes the hyperbolic dependence of paid factors on P/I); INCURRED factors regress on (P/I) residuals. lambda^P and lambda^I do not depend on s or i, and the paper proves (Sec 2.2.2) Corr(Q^{-1}_{i,s}, P_{i,t}/P_{i,s} | P_i(s)) = lambda^P and Corr(Q_{i,s}, I_{i,t}/I_{i,s} | I_i(s)) = lambda^I, and equally Corr(Res(Q^{-1}_{i,s}|P_i(s)), Res(P_{i,t}/P_{i,s}|P_i(s))) = lambda^P (analogously lambda^I): the lambdas ARE the residual correlation coefficients. Usually lambda^P, lambda^I >= 0. The three factors of the correction term: (1) lambda = correlation parameter; (2) the standard-deviation quotient rescales ratio deviations into factor deviations; (3) the linear term (ratio minus its conditional mean) pushes the factor up for above-average momentary (P/I) (incurred side) and down for below-average, symmetrically for paid via (I/P).

PARAMETER ESTIMATORS (Sec 3.1, t = s+1). Chain-ladder parameters (3.1.1):
fhat^P_{s->t} := [sum_{i=1}^{n-s} P_{i,t}] / [sum_{i=1}^{n-s} P_{i,s}], fhat^I_{s->t} analogous with I. Mack variance estimators for s = 1,...,n-2:
(sigmahat^P_{s->t})^2 := 1/(n-s-1) * sum_{i=1}^{n-s} P_{i,s} * ( P_{i,t}/P_{i,s} - fhat^P_{s->t} )^2, and (sigmahat^I_{s->t})^2 analogous with I.
MCL parameters (3.1.2). Average ratios, for s = 1,...,n:
qhat_s := [sum_{j=1}^{n-s+1} P_{j,s}] / [sum_{j=1}^{n-s+1} I_{j,s}] (incurred-weighted average of the Q_{j,s}), used as estimator of E(Q_{i,s}|I_i(s)); its reciprocal qhat_s^{-1} = [sum I_{j,s}]/[sum P_{j,s}] estimates E(Q^{-1}_{i,s}|P_i(s)).
Mack-style variance estimators FOR THE RATIO SERIES, for s = 1,...,n-1:
(rhohat^I_s)^2 := 1/(n-s) * sum_{j=1}^{n-s+1} I_{j,s} * ( Q_{j,s} - qhat_s )^2, giving sigma(Q_{i,s}|I_i(s)) estimated by rhohat^I_s / sqrt(I_{i,s});
(rhohat^P_s)^2 := 1/(n-s) * sum_{j=1}^{n-s+1} P_{j,s} * ( Q^{-1}_{j,s} - qhat_s^{-1} )^2, giving sigma(Q^{-1}_{i,s}|P_i(s)) estimated by rhohat^P_s / sqrt(P_{i,s}).
ESTIMATED RESIDUALS (denoted Reshat):
Reshat(P_{i,t}) = [ (P_{i,t}/P_{i,s} - fhat^P_{s->t}) / sigmahat^P_{s->t} ] * sqrt(P_{i,s});
Reshat(I_{i,t}) = [ (I_{i,t}/I_{i,s} - fhat^I_{s->t}) / sigmahat^I_{s->t} ] * sqrt(I_{i,s});
Reshat(Q^{-1}_{i,s}) = [ (Q^{-1}_{i,s} - qhat_s^{-1}) / rhohat^P_s ] * sqrt(P_{i,s});
Reshat(Q_{i,s}) = [ (Q_{i,s} - qhat_s) / rhohat^I_s ] * sqrt(I_{i,s}).
CORRELATION PARAMETERS: slopes of the regression line THROUGH THE ORIGIN in the pooled residual plots (all development years at once, y = factor residual vs x = preceding ratio residual), minimizing average squared vertical (y) distances:
lambdahat^P := [ sum_{i,s} Reshat(Q^{-1}_{i,s}) * Reshat(P_{i,t}) ] / [ sum_{i,s} Reshat(Q^{-1}_{i,s})^2 ];
lambdahat^I := [ sum_{i,s} Reshat(Q_{i,s}) * Reshat(I_{i,t}) ] / [ sum_{i,s} Reshat(Q_{i,s})^2 ].
In these sums s runs 1 to n-2 and i runs 1 to n-s (only cells where both the factor and the preceding-ratio residual exist; the hypotenuse ratios and the last-column parameters are not needed).

PROJECTION RECURSIONS (Sec 3.1.2, from PQ and IQ; the sqrt(P_{i,s}) volume terms cancel in the sd quotient, leaving sigmahat/rhohat):
Phat_{i,t} := Phat_{i,s} * ( fhat^P_{s->t} + lambdahat^P * (sigmahat^P_{s->t} / rhohat^P_s) * ( Ihat_{i,s}/Phat_{i,s} - qhat_s^{-1} ) )
Ihat_{i,t} := Ihat_{i,s} * ( fhat^I_{s->t} + lambdahat^I * (sigmahat^I_{s->t} / rhohat^I_s) * ( Phat_{i,s}/Ihat_{i,s} - qhat_s ) )
for s >= n-i+1, with initial values Phat_{i,s} := P_{i,s} and Ihat_{i,s} := I_{i,s} for s = n-i+1. The paid and incurred projections MUST be run simultaneously, cell by cell left to right, because each step needs the current projected (I/P) or (P/I) ratio of the other quadrangle (the paper illustrates this: the second step for accident year 7 needs Q_{7,2} = 5,659/7,828 = 72.3%). Alternative representation (Sec 3.2.1): Phat_{i,t} = Ihat_{i,s} * lambdahat^P * sigmahat^P/rhohat^P_s + Phat_{i,s} * ( fhat^P - lambdahat^P * (sigmahat^P/rhohat^P_s) * qhat_s^{-1} ), showing paid projections are driven mainly by incurred when current paid is tiny or zero.

MOTIVATING IDENTITY (Sec 1.1.2): for separate chain ladder (SCL) projections, for t > c_i: (P/I)_{i,t} / (P/I)_t = (P/I)_{i,c_i} / (P/I)_{c_i} boxed as the fundamental result: each accident year's ratio of projected (P/I) to the average (P/I) stays constant forever, so above/below-average years never converge to 100 percent; this is the SCL method's (P/I) problem that MCL fixes.

## publishedValues

All from Chapter 3.3 "Concrete example" (Variance 2:2 pp. 293-298; the data/parameter/result tables are unnumbered inline tables; only Figures are numbered). Portfolio: a FIRE portfolio, 7 accident years, deliberately small. The paper warns results were calculated with more precision than shown, so retracing with the printed rounded values gives minor discrepancies.

PAID TRIANGLE P_{i,t} (Sec 3.3.1; rows = accident year 1-7, columns = development year 1-7):
AY1: 576, 1804, 1970, 2024, 2074, 2102, 2131
AY2: 866, 1948, 2162, 2232, 2284, 2348
AY3: 1412, 3758, 4252, 4416, 4494
AY4: 2286, 5292, 5724, 5850
AY5: 1868, 3778, 4648
AY6: 1442, 4010
AY7: 2044

INCURRED TRIANGLE I_{i,t} (Sec 3.3.1):
AY1: 978, 2104, 2134, 2144, 2174, 2182, 2174
AY2: 1844, 2552, 2466, 2480, 2508, 2454
AY3: 2904, 4354, 4698, 4600, 4644
AY4: 3502, 5958, 6070, 6142
AY5: 2812, 4882, 4852
AY6: 2642, 4406
AY7: 5022

PARAMETERS (Sec 3.3.2). Development factors and sigmas (columns 1->2 ... 6->7):
fhat^P: 2.437, 1.131, 1.029, 1.021, 1.021, 1.014
fhat^I: 1.652, 1.019, 1.000, 1.011, 0.990, 0.996
sigmahat^P: 13.456, 3.666, 0.482, 0.210, 0.479 (only through 5->6; sigma_{6->7} not estimable)
sigmahat^I: 9.727, 2.544, 1.004, 0.120, 0.860
(P/I) pattern and rho parameters (columns s = 1..7):
qhat_s: 53.3%, 84.9%, 92.8%, 94.5%, 94.9%, 96.0%, 98.0%
rhohat^P_s: 14.943, 4.990, 2.167, 1.619, 1.791, 0.236
rhohat^I_s: 5.711, 3.819, 1.918, 1.461, 1.637, 0.222
Four residual triangles are printed in full (paid-factor, incurred-factor, I/P and P/I residuals; e.g. paid residual AY1 1->2 = 1.240, I/P residual AY7 col1 = 1.753, P/I residual AY7 col1 = -1.558).

CORRELATION PARAMETERS: paid residual plot (Figure 14) correlation 62%, regression slope lambdahat^P = 0.64. Incurred residual plot (Figure 15) correlation 44%, lambdahat^I = 0.44. Per-development-year lambda estimates (volatility check): paid 0.52, 0.71, 0.73, 0.55, 0.64; incurred 0.66, 0.64, 0.47, -0.27, 0.64 (the -0.27 rests on only three residual points).

WORKED STEP for newest accident year 7: MCL first paid factor = fhat^P_{1->2} + lambdahat^P * (sigmahat^P_{1->2}/rhohat^P_1) * (Q^{-1}_{7,1} - qhat_1^{-1}) = 2.437 + 0.64 * (13.456/14.943) * (2.457 - 1.878) = 2.768 (vs SCL 2.437). First incurred factor = 1.652 + 0.44 * (9.727/5.711) * (40.7% - 53.3%) = 1.559 (vs SCL 1.652). Hence P_{7,2} = 2044 * 2.768 = 5,659 and I_{7,2} = 5022 * 1.559 = 7,828; the next step needs Q_{7,2} = 5,659/7,828 = 72.3%.

MCL RESULT QUADRANGLES (Sec 3.3.3; projected cells only, per accident year, dev years to 7):
Paid: AY1 (given) ...2131; AY2: 2348 -> 2383; AY3: 4494 -> 4573, 4597; AY4: 5850 -> 5967, 6081, 6119; AY5: 4648 -> 4762, 4848, 4923, 4937; AY6: 4010 -> 4388, 4493, 4574, 4643, 4656; AY7: 2044 -> 5659, 6944, 7177, 7330, 7485, 7549.
Incurred: AY1 ...2174; AY2: 2454 -> 2444; AY3: 4644 -> 4618, 4629; AY4: 6142 -> 6212, 6167, 6176; AY5: 4852 -> 4885, 4944, 4931, 4950; AY6: 4406 -> 4567, 4601, 4657, 4646, 4665; AY7: 5022 -> 7828, 7688, 7644, 7727, 7650, 7650.
So MCL ultimates (paid vs incurred): AY1 2131/2174, AY2 2383/2444, AY3 4597/4629, AY4 6119/6176, AY5 4937/4950, AY6 4656/4665, AY7 7549/7650. For this calculation sigma^P_{6->7} and sigma^I_{6->7} were manually set to 0.100 (the paper says a sounder extrapolation would be used in practice).

SCL COMPARISON (Figure 16, shown as ultimate (P/I)-ratio bars rather than a printed ultimate table): under SCL the paid projection exceeds the incurred projection by up to 10% (accident year 6) and falls short of it by up to 27% (accident year 7), while the MCL paid and incurred results are "practically the same" (MCL ultimate P/I about 97-100% in all years; the AY7 SCL bar is about 73%).

OTHER PRINTED FIGURES FROM CHAPTER 1: Asian MTPL portfolio (15 AYs): SCL ultimate (P/I) ratios fluctuate between 61% and 148%; under MCL all accident years lie between 99% and 101% except AY9 at 97% (Figure 10). Marine portfolio: paid 1->2 factors vs preceding (P/I) correlate -60% (-89% excluding outlier AYs 6 and 9); incurred factors vs (P/I) correlate +46% (+51% ex outliers) (Figures 3-4). European GL portfolio pooled residual plots: paid correlation 45% with origin-regression slope 0.48; incurred correlation 29% with slope 0.31 (Figures 8-9); SCL ultimates vary 92%-102% of incurred while MCL gives about 96% for all 14 accident years (Figure 12). European MTPL (Figure 13): weak residual correlation, MCL improves on SCL but does not produce a uniform ultimate P/I.

## caveats

1) DATA-SIZE / INDEX-RANGE CONDITIONS. sigma estimators exist only for s = 1,...,n-2 (need n-s >= 2 observations, denominator n-s-1); rho estimators for s = 1,...,n-1; the lambda sums run s = 1..n-2, i = 1..n-s. The final-step sigmas are NOT estimable from the triangle: in the example sigma^P_{6->7} and sigma^I_{6->7} were simply set to 0.100 manually, with the explicit note that in practice a sounder extrapolation method should be used. If run-off finishes in fewer than n development years, restrict the index range to the end of run-off.

2) RESIDUAL-REGRESSION GUIDANCE. (a) Fit ONE regression through the ORIGIN over ALL development years pooled; per-development-year lambda estimates are volatile and can even have the wrong sign (their example: incurred lambda for 4->5 is -0.27, based on just three points), which is itself the argument for pooling. (b) The regression minimizes vertical distances; the fitted line will often LOOK too flat because the eye wants orthogonal-distance fitting. Do not steepen it. (c) The lambdas equal the residual correlation coefficients, which is a built-in safety mechanism: weak correlation gives lambda near 0 and MCL collapses gracefully to SCL, so implausibly strong corrections from steep slopes over uncorrelated scatter (problem 3 of Sec 1.2.2) cannot occur. (d) Small printed discrepancies between scatter correlation and origin-slope (62% vs 0.64) are expected since they are different statistics.

3) ESTIMATOR INCONSISTENCY CAVEAT (Sec 3.1.2). Assuming BOTH E(Q_{i,s}|I_i(s)) and E(Q^{-1}_{i,s}|P_i(s)) are constant would force Q_{i,s} itself to be constant, contradicting reality. The raw qhat_s / qhat_s^{-1} estimators are kept for simplicity and are justified only insofar as those conditional expectations vary little over the region of normal, non-extreme paid/incurred values; with sufficient data one should use refined, condition-dependent estimators (averaging over accident years with similar I_i(s), omitting clearly different ones), though that is very data-dependent and feasible only for early development years of large triangles.

4) WHEN MCL MISBEHAVES OR UNDERDELIVERS. (a) Weak or slowly-compensating (P/I) correlations (their European MTPL example): MCL will not force convergence to a uniform ultimate P/I, by design, since it only uses correlations to the extent they occurred in the past. (b) Unfinished run-off: the latest development years have few data points estimating many parameters (factors, P/I pattern, variances), and standard all-years-equal tail factors may not reconcile paid and incurred; remedy is regression smoothing and extrapolation of ALL MCL parameters (f, q, sigma, rho) beyond the known development years, exploiting that the (P/I) pattern generally grows monotonically toward 1 and sigma and rho generally decrease loglinearly. (c) After MCL (unlike SCL) it makes sense to apply one paid and one incurred tail factor, each identical across accident years, so the projections stay matched. (d) Vanishing or minuscule current paid losses: SCL paid gives useless (even zero) ultimates; MCL remains sensible because the paid projection is then driven mainly by current incurred, provided incurred and lambda^P are of normal magnitude. (e) Applicability boundary: MCL yields more reliable results for practically all portfolios WHERE chain ladder is appropriate for both the paid and the incurred triangle; it is not a fix for data where chain ladder itself is inappropriate. (f) MCL is neither systematically higher nor lower than SCL; the direction of correction varies by accident year. (g) The paper gives no prediction-error formula; that was deferred to a separate paper.

Source: Variance 2:2 (2008) 266-299 reprint of Blatter der DGVFM 26(4) 2004, 597-630, fetched from https://www.casact.org/sites/default/files/2021-07/Munich-Chain-Ladder-Quarg-Mack.pdf

