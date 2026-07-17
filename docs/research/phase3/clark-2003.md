# clark-2003 — primary-source transcription (research workflow, 2026-07-17)

## findings

Research completed against the actual paper: downloaded https://www.casact.org/sites/default/files/database/forum_03fforum_03ff041.pdf (CAS Forum Fall 2003, pp. 41-92) to /private/tmp/claude-501/-Users-justinmorrey-YesChef/83173382-3303-4f02-a34d-10240d3984a5/scratchpad/clark2003.pdf and read all 52 pages, including Appendices A (analytic loglikelihood and G-curve derivatives for both curves), B (Expos/AvgAge adjustments), C (discounted-reserve variance), and Tables 1.1-1.4 and 2.1. The two reserve-variance tables (pp. 65 and 69) were re-rendered at 300dpi to confirm digits; the LDF total parameter SD reads 4,688,826 (a low-res pass suggested 4,668,626, which also fails the sqrt(total^2 - process^2) cross-check that 4,688,826 passes). All other transcribed values are as printed; totals cross-check internally (e.g. reported 34,358,090 + truncated reserves 28,987,633 = 63,345,723 losses at 240 months; ELR 59.78% = 34,358,090/57,477,500). Sources: CAS abstract page https://www.casact.org/abstract/ldf-curve-fitting-and-stochastic-reserving-maximum-likelihood-approach and the PDF above.

## formulation

Clark (2003), "LDF Curve-Fitting and Stochastic Reserving: A Maximum Likelihood Approach" (ironic subtitle: "How to Increase Reserve Variability with Less Data"), CAS Forum Fall 2003, pp. 41-92.

GROWTH CURVES (Section 1). G(x) = 1/LDF_x = expected cumulative percent of ultimate reported (or paid) as of time x. The loss dollars are the random variable (not the report lag, contra Weissner). Two forms, each with scale theta and shape omega ("warp"):
- Loglogistic ("inverse power" LDFs, per Sherman; the benchmark): G(x|omega,theta) = x^omega / (x^omega + theta^omega), equivalently LDF_x = 1 + theta^omega * x^(-omega). theta is the median of the distribution (LDF_theta = 2.000).
- Weibull (lighter tail): G(x|omega,theta) = 1 - exp(-(x/theta)^omega). theta is approx the 63.2%-ile (LDF_theta ~ 1.582).
Expected emergence must move strictly 0% -> 100%; actual points may decrease, but genuinely negative expected development (e.g., heavy salvage) needs a different model.

AGE CONVENTION (body + Appendix B). x is measured in months from the AVERAGE accident date of the origin period to the evaluation date. For a fully-earned accident year evaluated at age t months, AvgAge(t) = t - 6 (t/2 if t <= 12); e.g. age 120 -> x = 114, age 12 -> x = 6. Appendix B generalizes: G_AY or PY(t|omega,theta) = Expos(t) * G*(AvgAge(t)|omega,theta), where for AY Expos(t) = t/12 for t <= 12 else 1, AvgAge(t) = max(t-6, t/2); for PY Expos(t) = (1/2)(t/12)^2 for t <= 12 else 1 - (1/2)max(2 - t/12, 0)^2, AvgAge(t) = t/3 for t <= 12 else [(t-12) + (1/3)(24-t)(1-Expos(t))]/Expos(t). This annualizing adjustment is needed when evaluation ages fall inside a not-yet-fully-earned period.

TWO METHODS FOR EXPECTED EMERGENCE. mu_AY;x,y = expected incremental loss dollars in accident year AY between ages x and y:
- Method #1 "Cape Cod": mu_AY;x,y = Premium_AY * ELR * [G(y|omega,theta) - G(x|omega,theta)]. Three parameters: ELR, omega, theta. Exposure base is usually onlevel premium (any index proportional to expected loss works).
- Method #2 "LDF": mu_AY;x,y = ULT_AY * [G(y|omega,theta) - G(x|omega,theta)]. n+2 parameters (one ULT per AY, plus omega, theta). So the LDF method's per-year ultimates ARE free parameters; it is NOT parameterized via an ELR. For a 10-year triangle: 55 data points, 3 parameters (CC) vs 12 (LDF) -> "real problem with overparameterization" for LDF. Clark generally prefers Method #1.

ODP AND MLE (Section 2). Assume constant variance/mean ratio sigma^2 for the incremental losses. Actual increment c = sigma^2 * (Poisson r.v.), i.e. over-dispersed Poisson: Pr(c) = lambda^(c/sigma^2) e^(-lambda) / (c/sigma^2)!, E[c] = lambda*sigma^2 = mu, Var(c) = lambda*sigma^4 = mu*sigma^2. With sigma^2 treated as known, maximizing the ODP loglikelihood is equivalent to maximizing l = SUM_i [ c_i * ln(mu_i) - mu_i ] over all incremental cells. Set dl/dELR = dl/dtheta = dl/domega = 0. Key closed forms: for Cape Cod, dl/dELR = 0 gives ELR = SUM c_i,t / SUM P_i*[G(x_t) - G(x_t-1)] (the MLE ELR reproduces the Cape Cod ultimate exactly); for LDF, dl/dULT_i = 0 gives ULT_i = SUM_t c_i,t / SUM_t [G(x_t) - G(x_t-1)] (the MLE reproduces the LDF ultimate). So each method reduces to a 2-parameter iterative search over (omega, theta) with ELR/ULTs profiled out. The loglikelihood never takes log of c_i,t, so zero or negative increments are fine.

SCALE PARAMETER: sigma^2 ~ [1/(n-p)] * SUM (c_AY,t - mu_hat_AY,t)^2 / mu_hat_AY,t, a chi-square-type statistic with n = number of data points, p = number of parameters (12 for LDF, 3 for CC in the example). Treating sigma^2 as fixed and known is a quasi-likelihood approximation (McCullagh & Nelder); "we are ignoring the variance on the variance."

VARIANCE DECOMPOSITION (Sections 2.3-2.4). Parameter variance via the delta method / Rao-Cramer: build the information matrix I of second derivatives of l w.r.t. all parameters (3x3 for CC; (n+2)x(n+2) for LDF, block structure with zero cross-terms between ULTs), then covariance matrix SIGMA = -sigma^2 * I^(-1). For a reserve R = SUM Premium_i * ELR * (G(y_i) - G(x_i)) (LDF method: set Premium_i = 1, ELR = ULT_i):
- Process variance of R = sigma^2 * SUM mu_AY;x,y (just sigma^2 times the expected reserve).
- Parameter variance of R: Var(E[R]) = (dR)' * SIGMA * (dR), where dR = gradient <dR/dELR, dR/dtheta, dR/domega> (or <{dR/dULT_i}, dR/dtheta, dR/domega>), with dR/dELR = SUM Prem_i (G(y_i)-G(x_i)), dR/dtheta = SUM Prem_i * ELR * (dG(y_i)/dtheta - dG(x_i)/dtheta), similarly for omega. All first and second derivatives of both curve forms are analytic (Appendix A gives every d2l term and the G derivatives for both curves).
- Total variance = process + parameter (assumed independent). Normalized residual for diagnostics: r = (c - mu_hat) / sqrt(sigma^2 * mu_hat). Appendix C extends to discounted reserves (v^(k-1/2) weights on increments; process var gets v^(2k-1)) and Section 4.3 to prospective-period and next-calendar-year development variances.

## publishedValues

DATA (Section 4.1, p. 59): the 10x10 cumulative reported-loss triangle is "taken from the 1993 Thomas Mack paper," relabeled AY 1991-2000, evaluated 12/31/2000 (this is the well-known Mack GL/reinsurance triangle). Cumulative triangle (ages 12...120):
1991: 357,848 | 1,124,788 | 1,735,330 | 2,182,708 | 2,745,596 | 3,319,994 | 3,466,336 | 3,606,286 | 3,833,515 | 3,901,463
1992: 352,118 | 1,236,139 | 2,170,033 | 3,353,322 | 3,799,067 | 4,120,063 | 4,647,867 | 4,914,039 | 5,339,085
1993: 290,507 | 1,292,306 | 2,218,525 | 3,235,179 | 3,985,995 | 4,132,918 | 4,628,910 | 4,909,315
1994: 310,608 | 1,418,858 | 2,195,047 | 3,757,447 | 4,029,929 | 4,381,982 | 4,588,268
1995: 443,160 | 1,136,350 | 2,128,333 | 2,897,821 | 3,402,672 | 3,873,311
1996: 396,132 | 1,333,217 | 2,180,715 | 2,985,752 | 3,691,712
1997: 440,832 | 1,288,463 | 2,419,861 | 3,483,130
1998: 359,480 | 1,421,128 | 2,864,498
1999: 376,686 | 1,363,294
2000: 344,014
Sum of latest diagonal (reported to date) = 34,358,090. 55 data points.

LDF METHOD, LOGLOGISTIC (pp. 61-63): fitted omega = 1.434294, theta = 48.6249 (months). sigma^2 = 65,029 with 43 dof (55 - 12). Untruncated reserve table (AY | Reported | age | avg age x | G(x) | fitted LDF | Ultimate | Reserve):
1991: 3,901,463 | 120 | 114 | 77.24% | 1.2946 | 5,050,867 | 1,149,404
1992: 5,339,085 | 108 | 102 | 74.32% | 1.3456 | 7,184,079 | 1,844,994
1993: 4,909,315 | 96 | 90 | 70.75% | 1.4135 | 6,939,399 | 2,030,084
1994: 4,588,268 | 84 | 78 | 66.32% | 1.5077 | 6,917,862 | 2,329,594
1995: 3,873,311 | 72 | 66 | 60.78% | 1.6452 | 6,372,348 | 2,499,037
1996: 3,691,712 | 60 | 54 | 53.75% | 1.8604 | 6,867,980 | 3,176,268
1997: 3,483,130 | 48 | 42 | 44.77% | 2.2338 | 7,780,515 | 4,297,385
1998: 2,864,498 | 36 | 30 | 33.34% | 2.9991 | 8,590,793 | 5,726,295
1999: 1,363,294 | 24 | 18 | 19.38% | 5.1593 | 7,033,659 | 5,670,365
2000: 344,014 | 12 | 6 | 4.74% | 21.1073 | 7,261,205 | 6,917,191
Total ultimate 69,998,708; total reserve 35,640,618. Only 77.24% of ultimate emerged at 10 years.

TRUNCATED AT 240 MONTHS (p. 64): G(avg age 234) = 90.50%, tail truncated LDF at 240 = 1.1050. Truncated table (truncated LDF | losses at 240 mo | reserve):
1991: 1.1716 | 4,570,810 | 669,347
1992: 1.2177 | 6,501,273 | 1,162,188
1993: 1.2792 | 6,279,848 | 1,370,533
1994: 1.3644 | 6,260,358 | 1,672,090
1995: 1.4888 | 5,766,692 | 1,893,381
1996: 1.6836 | 6,215,217 | 2,523,505
1997: 2.0215 | 7,041,021 | 3,557,891
1998: 2.7140 | 7,774,286 | 4,909,788
1999: 4.6689 | 6,365,149 | 5,001,855
2000: 19.1012 | 6,571,068 | 6,227,054
Total losses at 240 mo 63,345,723; total truncated reserve 28,987,633. Process SD = sqrt(65,029 * 28,987,633) = 1,372,966, CV ~ 4.7%.

WEIBULL LDF FIT (pp. 64-65): theta = 48.88453, omega = 1.296906; tail LDF at 120 (avg 114) = 1.0525 vs 1.2946 loglogistic. Table (G(x) | Weibull LDF | Ultimate | Reserve): 1991: 95.01% | 1.0525 | 4,106,189 | 204,726; 1992: 92.54% | 1.0806 | 5,769,409 | 430,324; 1993: 89.00% | 1.1237 | 5,516,376 | 607,061; 1994: 84.01% | 1.1904 | 5,461,745 | 873,477; 1995: 77.14% | 1.2963 | 5,020,847 | 1,147,536; 1996: 67.95% | 1.4717 | 5,433,242 | 1,741,530; 1997: 56.01% | 1.7853 | 6,218,284 | 2,735,154; 1998: 41.19% | 2.4277 | 6,954,204 | 4,089,706; 1999: 23.94% | 4.1764 | 5,693,693 | 4,330,399; 2000: 6.37% | 15.6937 | 5,398,863 | 5,054,849. Totals: ultimate 55,572,851, reserve 21,214,761.

LDF METHOD VARIANCE TABLE (p. 65, loglogistic, truncated at 240; verified at 300dpi) (AY | Reserve | Process SD (CV) | Parameter SD (CV) | Total SD (CV)):
1991: 669,347 | 208,631 (31.2%) | 158,088 (23.6%) | 261,761 (39.1%)
1992: 1,162,188 | 274,911 (23.7%) | 257,205 (22.1%) | 376,471 (32.4%)
1993: 1,370,533 | 298,537 (21.8%) | 298,628 (21.8%) | 422,260 (30.8%)
1994: 1,672,090 | 329,749 (19.7%) | 356,827 (21.3%) | 485,860 (29.1%)
1995: 1,893,381 | 350,891 (18.5%) | 401,416 (21.2%) | 533,160 (28.2%)
1996: 2,523,505 | 405,094 (16.1%) | 518,226 (20.5%) | 657,768 (26.1%)
1997: 3,557,891 | 481,005 (13.5%) | 704,523 (19.8%) | 853,064 (24.0%)
1998: 4,909,788 | 565,047 (11.5%) | 968,806 (19.7%) | 1,121,545 (22.8%)
1999: 5,001,855 | 570,321 (11.4%) | 1,227,880 (24.5%) | 1,353,867 (27.1%)
2000: 6,227,054 | 636,348 (10.2%) | 2,838,890 (45.6%) | 2,909,336 (46.7%)
Total: 28,987,633 | 1,372,966 (4.7%) | 4,688,826 (16.2%) | 4,885,707 (16.9%). (Note: parameter SD total is 4,688,826; low-res renders can misread it as 4,668,626.)

CAPE COD METHOD (Section 4.2, pp. 66-69): Mack supplied no exposure base, so Clark assumes onlevel premium = 10,000,000 for 1991, increasing 400,000 per year to 13,600,000 in 2000 (total 118,000,000). Fitted loglogistic: omega = 1.447634, theta = 48.0205. ELR = 59.78% (= 34,358,090 / 57,477,500 of premium x growth function). sigma^2 = 61,577 with 52 dof (55 - 3). Ultimate loss ratios by year (used to eyeball the constant-ELR assumption): 50.17%, 68.59%, 63.77%, 61.27%, 54.46%, 56.72%, 62.19%, 66.60%, 53.08%, 53.89%. Truncation again at 240 months: G(234) = 90.83%. Reserve table (AY | Onlevel Premium | G(x) | 90.83% minus G | Premium x ELR | Reserve):
1991: 10,000,000 | 77.76% | 13.07% | 5,977,659 | 781,218
1992: 10,400,000 | 74.85% | 15.98% | 6,216,766 | 993,281
1993: 10,800,000 | 71.29% | 19.54% | 6,455,872 | 1,261,416
1994: 11,200,000 | 66.87% | 23.96% | 6,694,978 | 1,604,006
1995: 11,600,000 | 61.31% | 29.52% | 6,934,085 | 2,046,646
1996: 12,000,000 | 54.24% | 36.59% | 7,173,191 | 2,624,620
1997: 12,400,000 | 45.17% | 45.66% | 7,412,297 | 3,384,400
1998: 12,800,000 | 33.60% | 57.22% | 7,651,404 | 4,378,344
1999: 13,200,000 | 18.46% | 71.37% | 7,890,510 | 5,631,298
2000: 13,600,000 | 4.69% | 86.13% | 8,129,616 | 7,002,255
Total reserve 29,707,484 (ultimate at 240 mo 70,536,377... printed as premium x ELR total; reported + reserves). Covariance matrix (ELR, omega, theta): Var(ELR)=0.002421, Cov(ELR,omega)=-0.002997, Cov(ELR,theta)=0.242396, Var(omega)=0.007853, Cov(omega,theta)=-0.401000, Var(theta)=33.021994.

CAPE COD VARIANCE TABLE (p. 69; verified at 300dpi) (AY | Reserve | Process SD (CV) | Parameter SD (CV) | Total SD (CV)):
1991: 781,218 | 219,329 (28.1%) | 158,913 (20.3%) | 270,848 (34.7%)
1992: 993,281 | 247,312 (24.9%) | 192,103 (19.3%) | 313,156 (31.5%)
1993: 1,261,416 | 278,701 (22.1%) | 229,523 (18.2%) | 361,047 (28.6%)
1994: 1,604,006 | 314,277 (19.6%) | 270,790 (16.9%) | 414,846 (25.9%)
1995: 2,046,646 | 355,002 (17.3%) | 314,629 (15.4%) | 474,360 (23.2%)
1996: 2,624,620 | 402,015 (15.3%) | 358,200 (13.6%) | 538,445 (20.5%)
1997: 3,384,400 | 456,510 (13.5%) | 396,353 (11.7%) | 604,563 (17.9%)
1998: 4,378,344 | 519,235 (11.9%) | 421,934 (9.6%) | 669,054 (15.3%)
1999: 5,631,298 | 588,862 (10.5%) | 430,873 (7.7%) | 729,664 (13.0%)
2000: 7,002,255 | 656,641 (9.4%) | 439,441 (6.3%) | 790,118 (11.3%)
Total: 29,707,484 | 1,352,515 (4.6%) | 3,143,967 (10.6%) | 3,422,547 (11.5%).
Headline comparison: overall reserve SD falls from 4,885,707 (LDF) to 3,422,547 (Cape Cod); "the overall variance in reserves is cut in half."

OTHER PUBLISHED RESULTS (Section 4.3): (a) Prospective period with 14,000,000 premium: expected loss 8,369,200 at ELR 59.78%; process CV 8.6% (via sigma^2 = 61,577); ELR SD = sqrt(0.002421) = 4.92% points; total CV 11.9%. (b) Next-12-month calendar development (LDF method, untruncated ultimates): expected 5,448,182 with process SD 595,223 (10.9%), parameter SD 635,609 (11.7%), total SD 870,798 (16.0%); per-AY rows printed on p. 71 (e.g. 2000: 1,063,384 development, total SD 548,068, 51.5%). (c) Discounted reserves (Cape Cod, 240-month truncation, 6.0% rate): discounted reserve 23,454,641 vs full-value 29,707,484; process SD 1,089,311 (4.6%), parameter SD 2,198,224 (9.4%), total SD 2,453,322 (10.5% CV vs 11.5% full-value; tail has greatest parameter variance and deepest discount).

## caveats

TRUNCATION / TAIL EXTRAPOLATION: the loglogistic can extrapolate a very thick tail (only 77.24% emerged at 10 years in the example; untruncated reserve 35.6M vs 29.0M truncated). Clark: "Extrapolation should always be used cautiously. For practical purposes, we may want to rely on the extrapolation only out to some finite point - an additional ten years say," hence truncation at 240 months in both methods, computing truncated LDFs as G(truncation age)/G(x). The alternative is a lighter-tailed curve (Weibull), whose 1.0525 tail "may be more in line with the actuary's expectation for casualty business"; the loglogistic/Weibull gap (reserves 35.6M vs 21.2M untruncated) "highlights the danger in relying on a purely mechanical extrapolation formula." Truncation reduces reliance on extrapolation when the thicker-tailed loglogistic is used.

RESIDUAL DIAGNOSTICS: normalized residuals r = (c - mu_hat)/sqrt(sigma^2 * mu_hat) are plotted (1) against increment age - should scatter randomly around zero with roughly constant spread; in the example "the curve form is perhaps not perfect for the early 12 and 24 points, but the pattern is not enough to reject the model outright"; (2) against expected incremental loss (fitted value) - a check on the constant variance/mean assumption (non-constant ratio would show residuals hugging zero at one end); (3) can also be plotted against accident year and calendar year (to test diagonal effects); any noticeable pattern or autocorrelation indicates model assumptions are wrong.

WHY CAPE COD VARIANCE IS SMALLER: the LDF method fits 12 parameters to 55 points (overparameterized; Clark cites Zehnwirth 1994 p. 512f) while Cape Cod fits 3, supplementing the triangle with onlevel premium. Cape Cod "may have somewhat higher process variance" (in fact sigma^2 = 61,577 vs 65,029 mostly reflects dividing by 52 vs 43 dof) "but will usually produce a significantly smaller estimation error" - the parameter variance, which dominates (LDF total: parameter SD 4,688,826 vs process 1,372,966). Total SD drops 4,885,707 -> 3,422,547, variance roughly halved. Moral: "the more information that we can give to the model, the smaller the reserve variability due to estimation error." Also: LDF treats each AY ultimate as independent of the others, so it fits to noise in year-to-year differences - a concern applying to the chain-ladder generally.

OTHER STATED LIMITATIONS: increments assumed iid (same emergence pattern for all AYs; tenuous, tested by residuals); sigma^2 treated as fixed/known (quasi-likelihood; ignores "variance on the variance"; Student-T/Kreps discussion for widening); variance estimates are Rao-Cramer LOWER bounds using the observed (not expected) information matrix, so true variability can exceed model output; the SD "goes with the mean" (strictly it is the SD around the MLE estimate, not around an arbitrarily selected carried reserve); mix-of-business/claim-settlement changes are "model variance" outside the model. Practical notes: the model needs only consistent tabular (origin, from-age, to-age, increment) data, not a triangle ("Abandon your triangles!"), and handles irregular diagonals (e.g. 9-month latest diagonal via Diag Age) and last-three-diagonals-only data; Appendix B annualizing (Expos(t) x G*(AvgAge(t))) is required when evaluation ages fall inside an unearned period.

