/**
 * ASOP No. 56 (Modeling) model cards.
 *
 * ASOP 56 asks an actuary who relies on models designed by others to
 * disclose the extent of reliance and to maintain a basic understanding of
 * the model: its basic operations, dependencies, sensitivities, and known
 * weaknesses. These cards ARE that content for every method the SDK ships —
 * ready to drop into workpapers or the generated disclosure.
 *
 * The cards describe the implementations in @actuarial-ts/core as built and
 * tested (each specification matches the code and its published-value test
 * pins), not idealized textbook variants. They are designed to support the
 * actuary's compliance with ASOP No. 56; responsibility for compliance
 * remains with the credentialed actuary.
 */

export type MethodId =
  | "chainLadder"
  | "mack"
  | "bornhuetterFerguson"
  | "benktander"
  | "capeCod"
  | "expectedClaims"
  | "frequencySeverity"
  | "berquistCaseAdequacy"
  | "berquistSettlement"
  | "tailFitting"
  | "cappingIlf"
  | "trend"
  | "onLevel"
  | "munichChainLadder"
  | "odpBootstrap"
  | "merzWuthrich"
  | "clarkLdf"
  | "clarkCapeCod"
  | "ulae"
  | "discountUnpaid"
  | "caseOutstanding"
  | "fisherLange"
  | "salvageSubro"
  | "netOfRecoveries";

export interface ModelCard {
  method: MethodId;
  title: string;
  intendedUse: string;
  specification: string;
  keyAssumptions: string[];
  weaknesses: string[];
  sensitivities: string[];
  literature: string[];
}

export const MODEL_CARDS: Record<MethodId, ModelCard> = {
  chainLadder: {
    method: "chainLadder",
    title: "Chain ladder (loss development method)",
    intendedUse:
      "Deterministic ultimate and unpaid estimates from a cumulative development triangle when historical development patterns are expected to persist. The default anchor method for mature origin periods.",
    specification:
      "CDFs multiply the caller's selected age-to-age factors right to left, tail last: cdf_j = ldf_j x cdf_{j+1}, cdf_last = tail. Ultimate_i = latest diagonal value x CDF at its age; unpaid = ultimate - latest. Missing or non-positive selections are treated as 1.000 with a per-column warning; all-missing selections are rejected. Factor selection is the caller's judgment: the engine supplies an averages menu (all-year/n-year straight and volume-weighted, medial, geometric) where volume-weighted means sum(numerators)/sum(denominators) over rows where both cells exist, never the mean of ratios, and n-year windows cover the latest n origin PERIODS.",
    keyAssumptions: [
      "Development to date is proportional to development to come (each origin period behaves like the others at the same age).",
      "The historical factor experience is relevant to the unpaid tail (no un-adjusted changes in mix, case adequacy, settlement practice, or environment).",
      "Selections and tail describe the SAME data basis being projected.",
    ],
    weaknesses: [
      "Immature periods multiply a small diagonal by a large CDF: leveraged and volatile.",
      "Calendar-year effects (inflation shifts, court decisions, process changes) violate the row-independence the method presumes.",
      "A distorted diagonal propagates into every average that includes it.",
    ],
    sensitivities: [
      "Selected factors in the earliest development columns (largest CDFs).",
      "The tail factor, especially for long-tailed lines.",
      "Treatment of outlier factors in small columns.",
    ],
    literature: [
      "Friedland, Estimating Unpaid Claims Using Basic Techniques, ch. 7",
      "Mack (1993), ASTIN Bulletin 23(2) — the estimator the validation suite pins",
    ],
  },
  mack: {
    method: "mack",
    title: "Mack distribution-free standard errors",
    intendedUse:
      "Standard errors (process + estimation) around chain ladder reserves without a distributional assumption; the basis for ranges and RMAD discussions on development-based estimates.",
    specification:
      "Mack (1993) with alpha = 1 (volume-weighted) estimators: f_k = sum(C_{i,k+1})/sum(C_{i,k}); sigma^2_k = (1/(n_k-1)) sum C_{i,k}(F_{ik} - f_k)^2, last column extrapolated by min(s^4_{K-2}/s^2_{K-3}, min(s^2_{K-3}, s^2_{K-2})). Per-origin mse per Mack's recursion; the total adds the cross-origin covariance term. When the caller projects on SELECTED factors, sigma^2 stays estimated around the volume-weighted factors and the pairing is disclosed (Mack 1999); a multiplicative tail extends the sum one column with sigma^2 extrapolated once more and the final column's volume reused — an acknowledged approximation, flagged in warnings.",
    keyAssumptions: [
      "E[C_{i,k+1} | past] = f_k C_{i,k} (the chain ladder mean structure).",
      "Var[C_{i,k+1} | past] = sigma^2_k C_{i,k} (variance proportional to volume).",
      "Accident years are independent (no calendar-year effects).",
    ],
    weaknesses: [
      "The three assumptions are testable and often violated; the package ships the calendar-year test, the factor-correlation test, and residuals for exactly that.",
      "Tail-step variance is an approximation (extrapolated sigma^2, reused final volume).",
      "Standard errors understate when sigma^2 columns are inestimable and default to 0 (warned).",
    ],
    sensitivities: [
      "sigma^2 in the late columns (few factors, extrapolation rule).",
      "The tail factor and its approximation.",
      "Outlier factors inflating a column's sigma^2.",
    ],
    literature: [
      "Mack (1993), ASTIN Bulletin 23(2) — Taylor/Ashe and mortgage tables pinned in tests",
      "Mack (1999), ASTIN Bulletin 29(2) — selected factors and tail",
      "Mack (1994), CAS Forum Spring 1994 — assumption tests",
    ],
  },
  bornhuetterFerguson: {
    method: "bornhuetterFerguson",
    title: "Bornhuetter-Ferguson",
    intendedUse:
      "Ultimates for immature or volatile origin periods where an a-priori expectation is more credible than leveraged development of thin emerged experience.",
    specification:
      "U_BF = actual to date + expected ultimate x (1 - 1/CDF), expected ultimate = a-priori loss ratio x earned premium (or pure premium x exposure units). The a-priori derives by default from the premium-weighted chain ladder loss ratio of mature periods (percent developed >= 0.9, falling back to all periods with a warning), and can be overridden globally or per origin. Origins without usable premium are excluded with a warning.",
    keyAssumptions: [
      "The a-priori expectation is unbiased for the unreported portion.",
      "The development pattern (CDF) correctly measures expected emergence to date.",
      "Actual emergence to date carries no information about the unreported remainder (the defining BF assumption).",
    ],
    weaknesses: [
      "Wholly dependent on the a-priori for green years: a biased prior is a biased reserve.",
      "Ignores favorable/adverse emergence signal that credibility methods (Benktander) partially use.",
      "CDFs below 1 (incurred redundancy) turn the provision into an expected take-down; interpretation needs care.",
    ],
    sensitivities: [
      "The a-priori loss ratio (one-for-one in the unreported piece).",
      "The development pattern's percent-unreported (1 - 1/CDF).",
      "Premium on-level and trend adjustments feeding a derived a-priori.",
    ],
    literature: [
      "Bornhuetter & Ferguson (1972), The Actuary and IBNR, PCAS LIX",
      "Friedland, ch. 9",
    ],
  },
  benktander: {
    method: "benktander",
    title: "Benktander-Hovinen (iterated Bornhuetter-Ferguson)",
    intendedUse:
      "The standard credibility compromise between chain ladder and Bornhuetter-Ferguson for middle-maturity periods: more responsive than BF, more stable than CL.",
    specification:
      "U_GB = C + q x U_BF with q = 1 - 1/CDF — Bornhuetter-Ferguson applied once more with the BF ultimate as the a-priori. Equivalently the credibility mixture (1-q) U_CL + q U_BF, or (1-q^2) U_CL + q^2 U_0 against the original prior. Computed from the same run's CL and BF results; origins BF excluded stay excluded. CDFs below 1 make q negative (extrapolation past CL), which is warned.",
    keyAssumptions: [
      "Everything BF assumes, plus: the prior U_0 is independent of emergence to date with E[U_0] = E[U] (the Mack 2000 optimality frame).",
      "The payout/reporting pattern is correctly measured.",
    ],
    weaknesses: [
      "Inherits a-priori bias at reduced (q^2) weight.",
      "Loses its MSE advantage in extreme volatility regimes (very stable books: use CL; very volatile: use BF — Mack 2000's t-criterion).",
    ],
    sensitivities: [
      "The percent developed (drives the credibility split).",
      "The BF a-priori (at q^2 weight).",
    ],
    literature: [
      "Mack (2000), Credible Claims Reserves: The Benktander Method, ASTIN 30(2) — Section 4 example pinned in tests",
      "Benktander (1976); Hovinen (1981)",
    ],
  },
  capeCod: {
    method: "capeCod",
    title: "Cape Cod / Stanard-Buhlmann (with Gluck decay generalization)",
    intendedUse:
      "Expected-loss method whose a-priori is derived mechanically from the data: trended, developed experience over used-up premium. The decay generalization balances all-year pooling against per-year responsiveness.",
    specification:
      "Pooled ELR* = sum(reported x lossAdj) / sum(premium x premiumAdj / CDF); ultimate_i = reported_i + ELR-at-origin-level x premium_i x (1 - 1/CDF_i). With decay D in [0,1] (Gluck 1997 eq. 6.1) each origin gets its own target-level ELR as the usedUp x D^|i-j| weighted average: D = 1 is standard Cape Cod (single pooled ELR, byte-identical code path), D = 0 reproduces the pure development ultimate. Adjustment factors restate losses and premium to a common target level and back.",
    keyAssumptions: [
      "After trend/on-level adjustment, expected loss ratios are comparable across the pooled origins (fully comparable at D = 1; comparable within the decay horizon at D < 1).",
      "The development pattern correctly measures used-up exposure (the Cape Cod variance assumption: estimate variance proportional to CDF).",
      "Loss and premium adjustments are on consistent levels.",
    ],
    weaknesses: [
      "Incurred CDFs near/below 1 break the used-up variance logic (Gluck's Section 7 variance factors are the remedy; not implemented).",
      "The mechanical ELR inherits every data distortion the diagnostics flag.",
      "Partially circular when its output feeds an ELR selection that feeds it back (the workbench warns).",
    ],
    sensitivities: [
      "Trend and on-level adjustment factors (numerator and denominator restatements).",
      "The decay factor: Gluck's practical range 0.50-1.00, customary default 0.75.",
      "Development pattern maturity for the youngest years.",
    ],
    literature: [
      "Stanard (1985); Buhlmann; Friedland ch. 10",
      "Gluck (1997), Balancing Development and Trend in Loss Reserve Analysis, PCAS LXXXIV — Tables 1-4 pinned in tests",
    ],
  },
  expectedClaims: {
    method: "expectedClaims",
    title: "Expected claims method",
    intendedUse:
      "Pure a-priori ultimates (selected ELR or pure premium x exposure base) independent of emerged losses; the anchor when experience carries no credible signal (new lines, green years, disrupted data).",
    specification:
      "Ultimate_i = selected a-priori (at a target cost level) restated to origin i's own level x exposure base_i. No dependence on emerged losses by construction. The selected a-priori is level-stamped so a run at a different dollar level skips the method rather than misapplying it.",
    keyAssumptions: [
      "The selected a-priori is unbiased at the target level.",
      "The restatement (trend, on-level) between target and origin levels is correct.",
    ],
    weaknesses: [
      "Ignores all emergence information, favorable or adverse.",
      "Wrong a-priori = wrong answer with no self-correction.",
    ],
    sensitivities: ["The selected ELR/pure premium.", "Trend and rate-level restatements."],
    literature: ["Friedland, ch. 8"],
  },
  frequencySeverity: {
    method: "frequencySeverity",
    title: "Frequency-severity (development technique on counts and average values)",
    intendedUse:
      "An ultimate built from separately developed claim counts and average severities; a cross-check on dollar development that decomposes movement into frequency vs severity.",
    specification:
      "Ultimate_i = ultimate counts_i x ultimate severity_i. Counts: chain ladder on the reported-count triangle with caller selections. Severity: chain ladder on the cell-wise average-severity triangle (losses/counts, null-safe) with caller selections. Unpaid ties to the LOSS triangle's latest diagonal.",
    keyAssumptions: [
      "Count development and severity development are each stable and independent enough to project separately.",
      "The claim-count definition is consistent across the triangle (no reporting-threshold or CWP-mix changes).",
    ],
    weaknesses: [
      "Severity per reported claim includes closed-without-payment claims: a drifting CWP share masquerades as severity development.",
      "Average severities on thin counts are volatile.",
    ],
    sensitivities: [
      "Count LDF selections (counts usually mature fast; tails matter little).",
      "Severity selections in late columns where open-claim severity drives the average.",
    ],
    literature: ["Friedland, ch. 11"],
  },
  berquistCaseAdequacy: {
    method: "berquistCaseAdequacy",
    title: "Berquist-Sherman case-reserve adequacy adjustment",
    intendedUse:
      "Restates the incurred triangle when case-reserve adequacy has shifted, so incurred development reflects a consistent adequacy level.",
    specification:
      "Average case reserves are restated by de-trending the latest diagonal's average open-case severity backward at an annual severity trend (fitted from the data by default, overridable); adjusted incurred = paid + restated average case x open counts. The adjusted triangle is re-developed with fresh volume-weighted factors, since user selections describe the unadjusted data.",
    keyAssumptions: [
      "The latest diagonal's case adequacy is the 'right' level to restate history to.",
      "The severity trend used to de-trend is the true drift in case severity.",
      "Open-count data is reliable.",
    ],
    weaknesses: [
      "A genuine severity trend is indistinguishable from an adequacy change in this frame: adjusting for the wrong one over-corrects incurred downward (flagged by the workbench's diagnostics).",
    ],
    sensitivities: ["The severity trend (fitted or judgmental).", "Open-count accuracy."],
    literature: ["Berquist & Sherman (1977), PCAS LXIV", "Friedland, ch. 13"],
  },
  berquistSettlement: {
    method: "berquistSettlement",
    title: "Berquist-Sherman settlement-rate adjustment",
    intendedUse:
      "Restates the paid triangle when settlement rates have shifted, so paid development reflects a consistent disposal pattern.",
    specification:
      "Disposal rates are computed against selected ultimate counts (chain ladder on reported counts); historical closed counts are restated to the latest diagonal's disposal pattern; paid is interpolated at the restated counts within each origin row — exponential through the bracketing points per Friedland, linear fallback where a zero paid value makes the exponential undefined, loud warnings when extrapolating beyond the observed range. The adjusted triangle re-develops with fresh volume-weighted factors.",
    keyAssumptions: [
      "The latest diagonal's disposal pattern is the go-forward pattern.",
      "Paid amounts relate to closed counts smoothly enough for interpolation.",
      "Ultimate count estimates are reliable.",
    ],
    weaknesses: [
      "Interpolation outside the observed paid/closed range is extrapolation (warned).",
      "A mix change in claim size can mimic a settlement-rate change.",
    ],
    sensitivities: ["Ultimate counts.", "The interpolation form in sparse rows."],
    literature: ["Berquist & Sherman (1977), PCAS LXIV", "Friedland, ch. 13"],
  },
  tailFitting: {
    method: "tailFitting",
    title: "Tail factor curve fitting",
    intendedUse:
      "Extends development beyond the observed triangle with a fitted decay curve, replacing an unsupported judgmental tail where the fit is valid.",
    specification:
      "Exponential decay and Sherman inverse-power curves fitted to the selected age-to-age factors (log-linear regression on ldf - 1), each with R-squared, validity gates, and divergence detection; the tail is the fitted product beyond the last observed age, capped, with warnings when the curve diverges or the fit is poor.",
    keyAssumptions: [
      "Development decay follows the fitted family beyond the data.",
      "The factors being fitted are themselves well-selected.",
    ],
    weaknesses: [
      "Different valid families can imply materially different tails (inverse power is heavier).",
      "A tail is an extrapolation by definition; no fit statistic proves the unobserved region.",
    ],
    sensitivities: ["Curve family choice.", "Which factor columns enter the fit."],
    literature: ["Sherman (1984), PCAS LXXI", "Boor (2006), Estimation of the Tail Factor, CAS Forum"],
  },
  cappingIlf: {
    method: "cappingIlf",
    title: "Large-loss capping and ILF restoration",
    intendedUse:
      "Develops a capped (per-occurrence) layer for stability on volatile books, then restores total limits with an increased-limits factor from fitted severity curves, an imported table, or illustrative curves.",
    specification:
      "Claims are capped at an accident-year-indexed per-occurrence limit; capped triangles rebuild from capped snapshots. Restoration applies ONE expected uncap factor (ILF(target)/ILF(cap)) to every origin: censored-MLE lognormal/Pareto fits to own-book severities (open claims right-censored at reported incurred) with Kaplan-Meier quantile checks, log-log table interpolation with strict no-extrapolation, and refusal gates (censoring-dominated fits, implausible parameters, factors above 10x).",
    keyAssumptions: [
      "Each origin year's excess share equals the book average (the single-factor restoration assumption).",
      "Censoring open claims at reported incurred approximates their severity (a case-adequacy assumption).",
      "The fitted family (or table) describes the unobserved excess layer.",
    ],
    weaknesses: [
      "Years with realized excess above the factor show artifact negative IBNR (flagged as restoration shortfall); mature years can be over-restored (flagged).",
      "Lognormal fits can underfit heavy tails (the KM quantile check exposes this).",
    ],
    sensitivities: ["Cap level and indexation.", "Severity family choice.", "The restoration target limit."],
    literature: ["Klugman, Panjer & Willmot, Loss Models", "standard ILF practice (ISO-style factor tables)"],
  },
  trend: {
    method: "trend",
    title: "Log-linear trend analysis",
    intendedUse:
      "Frequency, severity, and pure-premium trend selection evidence for restating experience to a common cost level (feeds Cape Cod, Expected Claims, and derived BF a-prioris).",
    specification:
      "Ordinary least squares on log(value) against time over standard windows (all years, last 5, last 3, ex-hi/lo), points at origin-period midpoints, windows sized in points-per-year so quarterly series span true years; annual rate = exp(slope) - 1 with R-squared and volatility warnings. Non-positive values are excluded (a log fit cannot see them) with a warning.",
    keyAssumptions: [
      "Exponential (constant-rate) trend within the fitted window.",
      "The series' dollar level is consistent (severity trend is layer-specific: a capped layer compresses toward the index rate).",
    ],
    weaknesses: [
      "Short windows are volatile; regime changes make all windows wrong.",
      "Ultimate-based series inherit the reserving method's errors.",
    ],
    sensitivities: ["Window choice.", "Outlier years (the ex-hi/lo window exists for this)."],
    literature: ["Werner & Modlin, Basic Ratemaking, ch. 6", "ASOP No. 13 (Trending Procedures)"],
  },
  onLevel: {
    method: "onLevel",
    title: "Parallelogram premium on-leveling",
    intendedUse:
      "Restates historical earned premium to current rate level so loss ratios are comparable across origin years (feeds Cape Cod and ELR selection).",
    specification:
      "Exact piecewise-linear earning geometry under an annual-policy assumption: each rate change carves the earning parallelogram, with leap-year-aware date fractions and quarterly-origin support. On-level factor_i = current rate level / average rate level earned in period i.",
    keyAssumptions: [
      "Annual policy terms, written evenly (the parallelogram assumption).",
      "The rate-change history is complete and correctly dated.",
    ],
    weaknesses: [
      "A missing rate change biases every factor after it.",
      "Non-annual terms or lumpy writings violate the geometry.",
    ],
    sensitivities: ["Rate-change dates and magnitudes.", "The premium trend (must be NET of rate action or it double-counts)."],
    literature: ["Werner & Modlin, Basic Ratemaking, ch. 5"],
  },
  munichChainLadder: {
    method: "munichChainLadder",
    title: "Munich chain ladder",
    intendedUse:
      "Joint paid/incurred projection that closes the persistent gap between separate paid and incurred chain ladders by conditioning each side's factors on the current (P/I) position.",
    specification:
      "Quarg-Mack (2004): volume-weighted paid and incurred factors with Mack sigmas; incurred-weighted average (P/I) ratios q_s with Mack-style ratio variances rho; correlation parameters lambda^P and lambda^I estimated as through-origin regression slopes of factor residuals on the preceding (I/P) resp. (P/I) ratio residuals; then a SIMULTANEOUS cell-by-cell recursion where each projected paid factor is adjusted by lambda^P (sigma/rho) times the current I/P deviation from average, and symmetrically for incurred. Implemented in the multiplied-out form so zero-paid rows stay projectable; the last inestimable sigma column follows Mack extrapolation or a caller-supplied value.",
    keyAssumptions: [
      "The Mack assumptions on both triangles, with joint (not per-triangle) independence across accident years.",
      "Factor residuals depend linearly on the preceding ratio residuals with constants lambda^P, lambda^I across all ages and origins.",
    ],
    weaknesses: [
      "Small portfolios make the residual regressions noisy; the paper's own example has a year where separate chain ladders were already nearly converged and MCL crosses slightly past parity.",
      "Zero ratio variance collapses the correction to the separate chain ladder (warned).",
    ],
    sensitivities: [
      "The estimated lambdas.",
      "The ratio-variance estimates rho in sparse late columns.",
    ],
    literature: ["Quarg & Mack (2004), Variance 2:2 — the fire-portfolio example is pinned in tests"],
  },
  odpBootstrap: {
    method: "odpBootstrap",
    title: "ODP bootstrap of the chain ladder",
    intendedUse:
      "A full predictive distribution of unpaid claims (percentiles, ranges, skewness) around the chain ladder central estimate — the standard simulation basis for ranges and risk margins.",
    specification:
      "England-Verrall/Shapland: the cross-classified over-dispersed Poisson GLM whose fitted values reproduce the volume-weighted chain ladder exactly (verified to 1e-6 in the result's fit block); unscaled Pearson residuals on incrementals; phi = sum r^2/(n - p) with p = 2I - 1; residuals inflated by sqrt(n/(n-p)) and resampled with replacement onto the fitted past; each pseudo triangle is refit and projected; process variance added per future cell from a Gamma with mean m and variance phi m. Seeded mulberry32 RNG: identical seed and inputs reproduce the distribution bit for bit.",
    keyAssumptions: [
      "Incremental claims are independent ODP with variance proportional to mean (no negative column sums).",
      "Residuals are exchangeable across the triangle (resampling pools them).",
    ],
    weaknesses: [
      "A small upward mean bias is inherent to refitting ratio estimators on resampled data (the result carries the chain ladder reserves alongside for the bias check England-Verrall themselves prescribe).",
      "Non-positive fitted incrementals fall outside the residual definition and are excluded (warned).",
    ],
    sensitivities: [
      "The residual pool in small triangles.",
      "The degrees-of-freedom correction convention (p = 2I - 1 documented against Shapland's printed alternative).",
    ],
    literature: [
      "England & Verrall (1999, 2002) — England (2002) Tables 1-3 pinned in tests",
      "Shapland, CAS Monograph No. 4 (2016)",
    ],
  },
  merzWuthrich: {
    method: "merzWuthrich",
    title: "Merz-Wuthrich one-year claims development result MSEP",
    intendedUse:
      "The one-year (solvency) view of reserve risk: the prediction uncertainty of next year's claims development result, alongside Mack's full-runoff view. Feeds Solvency-style capital and RMAD discussions.",
    specification:
      "Merz-Wuthrich (2008) closed forms: per accident year, msep of the observable CDR around zero per eq. 3.17 (the process term keeps only the next diagonal; later runoff estimation terms scale down by C/S ratios), aggregated with the eq. 3.18 cross terms. Estimators are exactly Mack's (shared code with runMack, including the last-column sigma^2 extrapolation), computed from the current triangle alone. The result reports the one-year and Mack ultimate-view roots side by side with their ratio.",
    keyAssumptions: [
      "Mack's three chain-ladder assumptions.",
      "A regular time-I snapshot (square triangle, full diagonal); irregular inputs are rejected rather than approximated.",
    ],
    weaknesses: [
      "Linear-approximation closed forms (the paper's own presentation); no tail beyond the triangle.",
      "One-year risk near the full-runoff figure signals a short-tailed book, not an error — interpret the ratio, not just the level.",
    ],
    sensitivities: ["sigma^2 in late columns.", "The current diagonal's leverage on next year's factors."],
    literature: ["Merz & Wuthrich (2008), CAS E-Forum Fall 2008 — Table 4 pinned in tests"],
  },
  clarkLdf: {
    method: "clarkLdf",
    title: "Clark growth-curve LDF method",
    intendedUse:
      "Parametric development: a two-parameter growth curve (loglogistic or Weibull) fitted by maximum likelihood, with per-origin ultimates as free parameters and delta-method process/parameter standard deviations. Useful when factor-by-factor selection over-fits sparse data, and for extrapolation with an explicit truncation age.",
    specification:
      "Clark (2003): expected incremental emergence mu = ULT_i x (G(y) - G(x)) with G the loglogistic x^w/(x^w + theta^w) or Weibull 1 - exp(-(x/theta)^w), ages measured to the origin period's AVERAGE accident date (x = max(t-6, t/2) for annual periods); over-dispersed Poisson quasi-likelihood maximized over (omega, theta) with the per-origin ultimates profiled out in closed form; sigma^2 = (1/(n-p)) sum (c - mu)^2/mu; process variance sigma^2 x reserve, parameter variance via the delta method on the numerically-inverted observed information; optional truncation of the curve at a caller age.",
    keyAssumptions: [
      "Emergence follows the chosen two-parameter family through all ages.",
      "ODP variance structure (variance proportional to mean) on incrementals.",
    ],
    weaknesses: [
      "n + 2 parameters over-parameterize small triangles (Clark's own caution; the Cape Cod variant exists for exactly that).",
      "Untruncated loglogistic tails are heavy; Clark recommends truncation, and untruncated runs warn.",
    ],
    sensitivities: ["The truncation age.", "Curve family (Weibull tails are materially lighter)."],
    literature: ["Clark (2003), CAS Forum Fall 2003 — the worked example is pinned to ~1e-5 in tests"],
  },
  clarkCapeCod: {
    method: "clarkCapeCod",
    title: "Clark growth-curve Cape Cod method",
    intendedUse:
      "Clark's preferred variant: the growth curve with a SINGLE expected loss ratio against an exposure base instead of per-origin ultimates — three parameters total, materially tighter parameter variance on immature years.",
    specification:
      "As the LDF method, but expected emergence mu = Premium_i x ELR x (G(y) - G(x)) with the ELR profiled out in closed form (the MLE ELR reproduces the Cape Cod ultimate identity). Same sigma^2, truncation, and delta-method variance machinery over the 3x3 information matrix.",
    keyAssumptions: [
      "The LDF-method assumptions, plus: a common expected loss ratio across origins after the exposure base's own adjustments.",
    ],
    weaknesses: [
      "A biased exposure base (unadjusted premium through a rate cycle) biases every origin's reserve.",
    ],
    sensitivities: ["The exposure base's on-level quality.", "Truncation age and curve family."],
    literature: ["Clark (2003), CAS Forum Fall 2003 — Cape Cod pins including the 59.78% ELR in tests"],
  },
  ulae: {
    method: "ulae",
    title: "ULAE: Conger-Nolibos generalized paid-to-paid",
    intendedUse:
      "Unallocated loss adjustment expense reserves from calendar-period ULAE ratios against a claims-activity basis, with the classical paid-to-paid and Kittel methods as special cases.",
    specification:
      "Conger-Nolibos (2003): W = M / B with basis B = U1 R + U2 P + U3 C (weights on the ultimate cost of claims reported, paid losses, and the ultimate cost of claims closed in the period); reserve forms: expected (W* L - M), the recommended Bornhuetter-Ferguson form W* x [U1(L - R) + U2(L - P) + U3(L - C)], and development (M x (L/B - 1)). Presets: Kittel {0.5, 0, 0.5}; classical paid-to-paid additionally collapses the basis to paid under its steady-state identity.",
    keyAssumptions: [
      "ULAE spend attaches to claim activity in the chosen weights, stable across periods.",
      "The weight triple reflects the claim department's actual effort profile (opening/maintaining/closing).",
    ],
    weaknesses: [
      "Classical paid-to-paid misleads on growing or shrinking books (its steady-state assumption fails exactly then).",
      "The development form is over-responsive to random ULAE emergence (paper's own caution).",
    ],
    sensitivities: ["The selected W*.", "The weight triple.", "Ultimate-loss inputs L, R, C."],
    literature: ["Conger & Nolibos (2003), CAS Forum — the worked example is pinned in tests", "Kittel (1981)"],
  },
  discountUnpaid: {
    method: "discountUnpaid",
    title: "Discounting of unpaid claim estimates",
    intendedUse:
      "Present-value view of unpaid claims from a payout pattern, built to the June 2026 edition of ASOP No. 20: nominal and discounted side by side, disclosed rate provenance, explicit-only risk margins.",
    specification:
      "Expected payments per development interval derive from chain ladder percent-developed differences (tail cash compressed into one final interval, warned); discount factors (1 + rate)^-t, annual effective, under a flat rate or spot curve with the payment's year selecting the rate; mid-period or end-period timing conventions; rate provenance ({source, asOfDate}) is REQUIRED input; a risk margin passes through as its own field and is never blended into any total. Off-diagonal (stale) origins are detected and warned: their timing assumes their latest cell sits at the valuation date.",
    keyAssumptions: [
      "The payout pattern (development-interval timing) is unbiased for cash flow timing and amount.",
      "All origins sit on one valuation diagonal (warned when not).",
    ],
    weaknesses: [
      "Pattern-based timing is coarse next to a genuine cash flow model; long tails compressed into one interval understate duration (warned).",
    ],
    sensitivities: ["The discount rates and their as-of date.", "The timing convention.", "Tail treatment."],
    literature: ["ASOP No. 20 (revised edition effective June 1, 2026)"],
  },
  caseOutstanding: {
    method: "caseOutstanding",
    title: "Case-outstanding development technique",
    intendedUse:
      "Ultimates for books where case reserves are the reliable signal (e.g. reinsurance with lagged paid data): future paid emerges from the run-off of carried case.",
    specification:
      "Friedland ch. 12: caller-selected case run-off ratios roll the current case outstanding forward age by age; caller-selected paid-on-prior-case ratios convert each period's opening case into expected paid; terminal case pays out at a tail ratio (default 1, warned when defaulted with material case). Reserve = sum of projected future paid. Negative seeds or projections warn and carry their sign — never silently zeroed.",
    keyAssumptions: [
      "Case adequacy is stable across origins at the same age (the ratios are transferable).",
      "The selected run-off and paid-on-case patterns describe the future.",
    ],
    weaknesses: [
      "Wholly dependent on case-reserving practice stability; a strengthening or weakening breaks both ratio families at once.",
    ],
    sensitivities: ["The tail paid-on-case ratio.", "Early-age case run-off selections."],
    literature: ["Friedland, ch. 12"],
  },
  fisherLange: {
    method: "fisherLange",
    title: "Fisher-Lange disposal-rate method",
    intendedUse:
      "A claim-count-driven reserve: future closed counts from disposal rates against ultimate counts, priced at trended severities by settlement age. A structural cross-check on dollar development when settlement patterns shift.",
    specification:
      "Disposal rates = incremental closed counts / ultimate counts per age (selected from observed diagonals or averages); future closed counts = ultimate counts x selected rates for future ages; severities per settlement age from incremental paid over incremental closed, trended along calendar distance at the caller's severity trend ((1+t)^(months/12)); reserve = sum over future cells of counts x trended severity. Non-consecutive numeric origin labels are detected and warned (they would silently compress trend distances).",
    keyAssumptions: [
      "Disposal patterns against ultimate counts are stable.",
      "Severity varies by settlement age and calendar trend only (no mix shifts within an age).",
    ],
    weaknesses: [
      "Needs credible ultimate count estimates as INPUT; count-development errors propagate.",
      "Sparse closure cells make age severities volatile (warned).",
    ],
    sensitivities: ["The severity trend.", "Ultimate counts.", "Disposal-rate selections."],
    literature: ["Fisher & Lange (1973), PCAS LX", "Friedland, ch. 11"],
  },
  salvageSubro: {
    method: "salvageSubro",
    title: "Salvage and subrogation development",
    intendedUse:
      "Recovery ultimates developed on their own triangle, for netting against gross results — recoveries develop on their own (usually slower, lumpier) pattern and deserve their own analysis.",
    specification:
      "Chain ladder on the cumulative recovery triangle with caller selections and tail; every run warns that recovery development is typically slower and less smooth than loss development; negative cumulative recovery cells are warned. Results carry ultimate recoveries and future recoveries per origin.",
    keyAssumptions: ["Recovery development patterns are stable across origins."],
    weaknesses: ["Recovery triangles are thin and lumpy; single large recoveries distort factors."],
    sensitivities: ["Late-age recovery factors and the tail."],
    literature: ["Friedland, ch. 14"],
  },
  netOfRecoveries: {
    method: "netOfRecoveries",
    title: "Net-of-recoveries combination",
    intendedUse:
      "Combines a gross projection and a recovery projection into net ultimates and net unpaid, origin by origin.",
    specification:
      "Net ultimate = gross ultimate - ultimate recoveries; net unpaid = gross unpaid - future recoveries; origins aligned by label, one-sided origins excluded with a warning (never zero-filled), mismatched valuation ages warned, negative nets flagged for review.",
    keyAssumptions: ["The gross and recovery projections describe the same book at the same valuation date."],
    weaknesses: ["A netting is only as good as its two inputs; it adds no information of its own."],
    sensitivities: ["Both input projections."],
    literature: ["Friedland, ch. 14"],
  },
};

/** Every method id the disclosure generator recognizes. */
export const MODEL_CARD_IDS = Object.keys(MODEL_CARDS) as MethodId[];
