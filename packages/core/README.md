# @actuarial-ts/core

A pure, zero-dependency P&C loss reserving engine for TypeScript. The
deterministic shelf: triangles, development factors, chain ladder,
Bornhuetter-Ferguson, Benktander, Cape Cod (with the Gluck decay
generalization), Expected Claims, frequency-severity, Berquist-Sherman,
Munich chain ladder, case-outstanding development, Fisher-Lange,
salvage/subrogation, ULAE, tail fitting, large-loss capping and ILF
restoration, trend and premium on-leveling, discounting (built to the June
2026 ASOP No. 20), and assumption diagnostics. The stochastic layer, fully
seeded and reproducible: Mack standard errors, the ODP bootstrap,
Merz-Wuthrich one-year risk, and Clark growth-curve MLE — every method
validated against published actuarial literature where published values
exist.

`@actuarial-ts/core` is the numeric kernel of the actuarial-ts SDK. It is
**designed to support the actuary's compliance with the Actuarial Standards of
Practice** (ASOP Nos. 43, 23, 41, 56, 25, 36, 20, 21, 38, and 13) by making
methods, assumptions, and their diagnostics explicit and reportable.
Responsibility for compliance remains with the credentialed actuary; no
software can be "ASOP-approved" and this one does not claim to be.

## Install

```bash
npm install @actuarial-ts/core
```

ESM, TypeScript-first, zero runtime dependencies, Node >= 20.

## Quick start

```ts
import {
  buildTriangles,
  computeDevelopmentFactors,
  runChainLadder,
  runMack,
  fitAllTails,
} from "@actuarial-ts/core";

// One row per claim per evaluation snapshot (the standard loss-run shape).
const { paid, incurred } = buildTriangles(claimSnapshots, {
  cadence: "annual",
  asOfDate: "2025-12-31",
});

// The averages menu: all-year/n-year straight and volume-weighted, medial,
// geometric. Selection is YOUR judgment; the engine never picks for you.
const factors = computeDevelopmentFactors(paid);
const selected = factors.averages.find((a) => a.spec.key === "all-wtd")!.values;

const tails = fitAllTails(selected);
const tail = tails.exponentialDecay.valid ? tails.exponentialDecay.tailFactor : 1;

const cl = runChainLadder(paid, { selected, tailFactor: tail });
const mack = runMack(paid, { selected, tailFactor: tail });

console.log(cl.totals.unpaid, mack.totals.standardError, cl.warnings);
```

## The contract

Three rules hold everywhere:

1. **Null is a first-class citizen.** Unobservable triangle cells are `null`.
   Division by a missing, zero, or negative denominator yields `null` ("no
   factor") — never an exception, never `NaN`.
2. **Three-tier severity.** Impossible input throws `ReservingError` with a
   machine-readable code from the exported `RESERVING_ERROR_CODES` registry.
   Degraded-but-legal situations compute anyway and explain themselves in the
   result's `warnings: string[]`. Missing data is `null`, not an error.
3. **Judgment belongs to the caller.** The engine computes evidence (factor
   menus, tail fits, diagnostics) and applies *your* selections (LDFs, tails,
   a-prioris, trends, caps). It never silently selects.

## Method inventory

| Module | Methods | Primary literature |
|---|---|---|
| `triangle` | `buildTriangles` (7 triangle kinds from claim-level snapshots, annual/quarterly), `triangleFromGrid` | Friedland, *Estimating Unpaid Claims Using Basic Techniques* |
| `factors` | `computeDevelopmentFactors` (averages menu), `factorVolatility` | Friedland ch. 7; Mack (1993) factor conventions |
| `chainladder` | `runChainLadder` | Friedland ch. 7 |
| `mack` | `runMack` — distribution-free standard errors on the selected basis, with tail | Mack (1993) ASTIN 23(2); Mack (1999) ASTIN 29(2) |
| `bf` | `runBornhuetterFerguson` (per-origin/global/derived a-priori) | Bornhuetter & Ferguson (1972) |
| `elrMethods` | `runCapeCod`, `runExpectedClaims` | Stanard-Buhlmann; Friedland chs. 8, 10 |
| `tail` | `fitTail`, `fitAllTails` (exponential decay, Sherman inverse power, validity gates) | Sherman (1984); Boor (2006) |
| `berquist` | `berquistCaseAdequacy`, `berquistSettlement` | Berquist & Sherman (1977); Friedland ch. 13 |
| `benktander` | `runBenktander` — the iterated BF credibility blend | Mack (2000) ASTIN 30(2); Benktander (1976) |
| `freqSev` | `runFrequencySeverity`, `severityTriangle` | Friedland ch. 11 |
| `munichChainLadder` | `runMunichChainLadder` — closes the paid/incurred gap | Quarg & Mack (2004), Variance 2:2 |
| `caseOutstanding` | `runCaseOutstanding` | Friedland ch. 12 |
| `fisherLange` | `runFisherLange` — disposal-rate frequency-severity | Fisher & Lange (1973); Friedland ch. 11 |
| `salvageSubro` | `runSalvageSubro`, `netOfRecoveries` | Friedland ch. 14 |
| `ulae` | `ulaeRatios`, `ulaeReserve`, `ULAE_WEIGHT_PRESETS` | Conger & Nolibos (2003); Kittel (1981) |
| `discounting` | `payoutPatternFromChainLadder`, `discountUnpaid` | ASOP No. 20 (June 2026 edition) |
| `stochastic` | `createRng` (seeded), `summarizeSample`, `StochasticResult` | — |
| `triangleAlgebra` | `cumulativeToIncremental`, `incrementalToCumulative`, `addTriangles`, `subtractTriangles` | — |
| `odpBootstrap` | `odpFit` (GLM == chain ladder identity), `runOdpBootstrap` | England & Verrall (1999/2002); Shapland, CAS Monograph 4 |
| `merzWuthrich` | `runMerzWuthrich` — one-year CDR MSEP vs Mack's ultimate view | Merz & Wuthrich (2008), CAS E-Forum |
| `clark` | `clarkGrowth`, `runClarkLdf`, `runClarkCapeCod` — MLE + delta-method variances | Clark (2003), CAS Forum |
| `capping` | `capClaims`, `claimSizeDiagnostics` (per-occurrence caps, indexed) | standard large-loss practice |
| `ilf` | censored-MLE severity fits (lognormal, Pareto), Kaplan-Meier checks, ILF table interpolation, uncap factors | Klugman et al., *Loss Models*; standard ILF practice |
| `trend` | `analyzeTrend`, `trendValue` (log-linear, windowed) | Werner & Modlin, *Basic Ratemaking* ch. 6 |
| `onlevel` | `parallelogramOnLevel` (exact piecewise-linear earning geometry) | Werner & Modlin ch. 5 |
| `diagnostics` | `runDiagnostics` (paid/incurred drift, case adequacy, closure rates), `calendarYearTest` | Mack (1994) calendar-year rank test |
| `canonical` | `canonicalJson` (RFC 8785 / JCS canonical serialization), `fnv1a64` (integrity tagging aid — not a security control) | RFC 8785 |

## Validation against published results

The test suite reproduces, from the primary sources (transcriptions under
`docs/research/` in the repository):

- Mack (1993), ASTIN 23(2): Taylor/Ashe and mortgage-guarantee factors,
  reserves, sigma-squared (including the extrapolated column), standard errors.
- Mack (1994), CAS Forum: the RAA triangle's calendar-year test (Appendix H)
  and factor-correlation test (Appendix G), every printed statistic.
- Mack (1999), ASTIN 29(2): ultimates under the published 1.05 tail.
- Mack (2000), ASTIN 30(2): the Benktander numerical example.
- Gluck (1997), PCAS LXXXIV: Generalized Cape Cod Tables 1-4.
- England (2002), IME 31: ODP bootstrap prediction errors and percentiles
  on Taylor/Ashe.
- Merz & Wuthrich (2008): the Table 4 one-year CDR volatilities.
- Clark (2003): both methods' fitted parameters, reserves, and variance
  decompositions (to ~1e-5).
- Quarg & Mack (2004): the fire-portfolio example's every printed parameter
  row and projected cell.

These published-value tests are the package's change contract: math changes
are wrong until they pass.

## License

Apache-2.0. Copyright 2026 Justin Morrey.
