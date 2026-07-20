# Changelog

All notable changes to the actuarial-ts SDK. The packages version
together; this file covers them all.

## Unreleased

- **fix(data): loss-run row errors now cite the physical file line** —
  interior blank lines and quoted embedded newlines no longer shift
  cell-error row numbers; `CsvParseResult` gains `rowLines` (per-row
  physical start line).
- **fix(interchange): embedded documents inside a study/bundle now fail the
  spec 3.5 wrong-major check** — TS `parseDocument` and the R
  `ats_read_document` recipe previously verified only the outer envelope's
  `interchangeVersion`, accepting e.g. a 2.0.0 TriangleDoc embedded in a
  1.0.0 study that the Python adapter refuses. All three shores now refuse
  identically; refusal is unconditional (not `strictness`-governed).
- **fix(interop): the R adapter's JCS shortest-round-trip oracle mis-rounded
  certain doubles by one ULP on R 4.6.1/arm64** (`as.numeric` vs.
  `jsonlite::fromJSON`). Pinned by two new shared JCS vectors (23→25) that the
  pre-fix adapter fails.
- **feat(examples): the chain-ladder trilogy** (TypeScript /
  chainladder-python sidecar / R ChainLadder) + a cross-engine crosscheck
  capstone, each driving the Mastra agent layer (typed tools, fail-closed
  tenant seam, judgment chain → ASOP 41 disclosure). New root scripts
  `example:cl-*`; opt-in live-advisor tail (`ACTNG_RUN_AGENT=1`) running the
  golden-prompt evals and one tool-calling turn against a real model.
- **feat(examples): three interactive chain-ladder apps** (`npm run app -w
  <example>`, one per shore) — clickable development-factor averages with
  per-column overrides, engine-computed ultimates on every change, an
  assumption ledger that refuses a commit without a rationale, a live ASOP 41
  disclosure that regenerates per commit, and a streaming reserving advisor
  that proposes typed selections for the actuary to apply with one click.
  Plus `tools/interop/run-cl.R`, a chain-ladder-projection CLI (ldfs supplied,
  not derived) with fail-closed input guards that the R app's engine shells
  out to. `npm run app` is the one front door for all three — an interactive
  engine menu (or `npm run app -- <ts|python|r>`) with per-engine preflight;
  the Python app now auto-boots its own chainladder sidecar as a child
  process when none is configured, so picking it needs nothing beyond the
  venv.

## 0.3.0 — 2026-07-19

All five packages version together (see VERSIONING.md for why lockstep is
mandatory on 0.x). Publish order: core, interchange, data, compliance, agents.

The review-remediation release: an external review's 43 findings were
independently verified (32 valid, 10 partial, 1 refuted) and worked through in
six packages — numerics, outward-facing claims, referee integrity, the
security seam, the data layer, and packaging. Entries below are grouped by
what a consumer must know first.

### Breaking

- **`defineActuarialTool` enforces the tenant seam by construction.** execute
  is now `(input, tenant, context)` and every tool declares `tenant:
  "required" | "none"`; the wrapper resolves the tenant from the trusted
  source before the body runs, so an unauthenticated call fails closed without
  the body ever executing. `resolveTenant` unifies the request-context and MCP
  auth readers. Migration: add `tenant: "required"`, take the id from the
  second argument, delete the `tenantOf(context)` line.
- **`parseCsv` returns `{ rows, warnings }`.** One stray quote used to swallow
  the remainder of the file into a single field silently; the structural
  problem is now reported with the line where the quote opened.
- **The tenant-key lint fails closed.** Nine zod containers (tuple,
  intersection, lazy, pipe, set, promise, catch, readonly, brand) used to
  carry a nested tenant id past it; unrecognized shapes now throw, and
  z.any()/z.unknown()/z.map() are refused unless the exact path is declared in
  `allowUninspected`.
- **The disclosure integrity tag covers every disclosed section** (previously
  metadata/methods/ledger only — fabricating the data-review section did not
  move it). All previously generated tags change.

### Numerics (silently wrong numbers, both fixed with published values intact)

- **Mack total standard error was row-order dependent**: the cross-covariance
  aggregation used the earlier row's maturity as the summation floor instead
  of the pairwise max. Overstated (never understated) by up to ~65% on ragged
  orderings; provably a no-op on maturity-sorted triangles, so Taylor & Ashe's
  2,447,095 is bit-identical.
- **ODP dispersion phi divided by degrees of freedom it never earned**: cells
  with non-positive fitted means were excluded from the numerator but counted
  in the denominator, understating reserve variability (~1.43x too-small phi
  on a 6x6 with three such cells). The dof guard was inflated the same way and
  now refuses fits with no usable residuals.

### Referee and corpus

- `agree` is unreachable when a profile-scoped metric was never compared on
  any cell; a profile stated on one side now governs (with a warning) instead
  of silently falling back; `absoluteTolerance` provides the missing float
  floor; coverage is recorded on every report.
- The conformance corpus carries a `published` literature anchor (Mack's
  tabled values, cited, at printing precision) asserted by ALL THREE shores —
  previously every expectation was the TS engine's own frozen output, which
  detects drift but can never catch a shared error. RAA's lack of published
  values is declared rather than implicit.
- The TS-vs-TS referee assertion was removed (redundant with the byte-freeze
  and misread as cross-engine evidence). Embedded documents inside studies and
  bundles are now integrity-verified at parse.

### Security and honesty

- MCP boot self-test probes EVERY tool (was: exactly one), with greppable
  exemptions; stale exemptions fail the test.
- verifyBundle recomputes the bundle's own hash first; document-sourced text
  is neutralized before ASOP 41 markdown interpolation; judgment trails record
  the authenticated actor identity from the request context (the resume
  payload cannot assert it); the advisor's instructions state that tool-result
  text is data, never instruction.
- Overclaims corrected across the docs: "tamper-evident" (unkeyed FNV-1a),
  the ten-ASOP list (six have implementation), "proof" language, the
  2,447,095 attribution, the convention map's normativity, and three
  unsupported claims in the unsent chainladder-python draft. The AI-authored
  review files moved to the workbench repo with an explicit disclosure.

### Data layer

- Non-finite values fail the ASOP 23 review (NaN triangles previously scored
  a clean bill of health); currency must be plain decimal (Number() accepted
  hex/binary/octal/scientific); review findings identify claims by
  claimId + evaluation date instead of a fabricated row number; undefined is
  a gap in every check; the leap rule is arithmetic.

### Infrastructure

- The R shore runs in CI (`R interop conformance`), the py-conformance paths
  filter includes packages/compliance, published sourcemaps resolve (src ships
  in the tarballs), tsx is declared where invoked, the interchange spec moved
  to its stable home at docs/spec/actuarial-interchange.md, and the repo gains
  CODE_OF_CONDUCT.md, VERSIONING.md and a docs index.


- **The ActNG reserving workbench moved to its own repository.** It used the SDK
  substantively (34 import sites across all five packages), so this is not a
  removal of dead weight — it is a separation of concerns. A repository that is
  simultaneously a library, a spec and an application reads as three things to
  someone evaluating the library. The dependency was already strictly
  one-directional (nothing in `packages/` or `interop/` referenced `apps/`), so
  the extraction was clean; all 41 commits touching the app were preserved, and
  it now resolves the five packages from npm at `^0.2.0` like any other
  consumer.

- **Fixed: four packages could not be built from a clean checkout.** `core`,
  `interchange`, `compliance` and `agents` use ambient Node/web globals
  (`TextEncoder`, `setTimeout`, `AbortSignal`, `fetch`, `Response`, `process`,
  `URL`) but none declared `@types/node`. They had been silently borrowing it
  from `apps/server`'s devDependencies via workspace hoisting, so the defect was
  invisible while the app lived here — a fresh `git clone && npm install` on a
  machine without a stale tree would have failed to build, which is exactly what
  a new contributor does first. Extracting the app surfaced it. Each package now
  declares the types it actually needs, verified by a clean-room clone-and-build
  rather than against an existing node_modules.

- **`examples/reserve-review` replaces it as the SDK's in-repo consumer.** A
  runnable, TESTED end-to-end review — triangle, factor selection, chain ladder,
  Mack standard error, interchange documents, the referee, and a verified
  reproducibility bundle — that reproduces Mack (1993)'s published unpaid
  (18,680,856) and R ChainLadder's published standard error (2,447,095), with a
  triangle integrity tag matching the frozen conformance corpus. It is covered
  by tests specifically so it cannot rot into teaching a stale API, and it
  earned that immediately by catching three API mistakes while being written.
  `npm run example`.


- **A stochastic referee (`crosscheckStochastic`), closing a real gap.** A study
  may carry a `stochastic-result` (`study.ts`), but the referee had no path for
  one at all — so such a study could enter `promoteStudy` and never be
  cross-checked. `crosscheck` now refuses a stochastic document with a message
  naming the right entry point instead of a schema dump.

  The new referee compares distributions, and its tolerance is DERIVED from
  sampling theory rather than declared: at n simulations the relative Monte
  Carlo standard error is `CV/sqrt(n)` on the mean and `1/sqrt(2n)` on the sd,
  two independent runs differ by `sqrt(2)` times those, and the bound is 4 sigma
  of that by default. Strictness therefore scales with n automatically. It also
  adapts to the reproducibility class: two results that both claim
  `seeded-reproducible` at the SAME seed are asserting byte-reproducibility, so
  the Monte Carlo allowance is WITHHELD and they must agree exactly. No schema
  change — the report reuses `deviations.unpaid` for the distribution mean and
  `deviations.standardError` for its sd (the bootstrap sd IS the estimated
  prediction error), plus a passthrough `comparison` block.

  Three defects in the first cut of this referee were caught by adversarial
  review and fixed before landing: point estimates carried beside the
  distribution (`rows`/`totals`) were not compared at all, so two results whose
  ultimates differed 10x still returned `agree`; `holdToExact` keyed only on
  (both seeded-reproducible + same seed) and so held a 1,000-sim and a
  10,000-sim run at seed 42 to float noise, though those are legitimately
  different draws; and a non-positive `exactTolerance` produced an invalid
  report with an internal schema dump instead of naming the bad option. A
  fourth was caught before review: each origin is judged against ITS OWN
  derived bound, because a single origin is roughly 3x more volatile than the
  diversified total and a single global bound manufactured disagreements.

- **Witnessed results are disclosed at the promotion rationale gate.**
  `promoteStudy` now lists every `witnessed` supporting result, with its
  stability self-check, in the rationale gate's evidence and recommendation.
  Promotion is not blocked — a witnessed result can be adequate support — but
  the actuary is told before their attestation is written to the assumption
  ledger, so it is informed rather than nominal.

- **Corrected a claim in spec rev 2.3.** The first draft of section 16 said
  `verified-by-value` was the verdict fitting a witnessed comparison. It is
  not: that verdict means the engines replayed the same values instead of
  independently recomputing, which understates two engines that each ran their
  own bootstrap. Agreement between witnessed results is an ordinary `agree`
  carrying an explicit non-reproducibility warning. Spec section 17 documents
  the stochastic referee.

- **Upstream bug report drafted** for `casact/chainladder-python`
  (`docs/interop/upstream/chainladder-python-bootstrap-determinism.md`),
  including the reproduction, the hypotheses already ruled out, and the
  identity-hashing lead. Not sent — founder review, per the convention for
  outgoing drafts.


- **Reproducibility classes (interchange spec rev 2.3).** Stochastic result
  documents now carry an optional `reproducibility` of `seeded-reproducible`
  or `witnessed`, plus an optional `stability` self-check
  (`repeats`/`byteIdentical`/`maxRelativeDeviation`). Deterministic
  `method-result` documents are unchanged — the kind already implies
  reproducibility. Both fields are optional and additive, so
  `interchangeVersion` stays `1.0.0`, existing documents and readers are
  unaffected, and the frozen conformance corpus is untouched.

  This exists because a seed turned out not to be a guarantee: chainladder
  0.9.2's `BootstrapODPSample` returns different samples for identical seeded
  calls in one process (measured; not dependency drift, machine variance, BLAS
  threads, or the array backend — see `docs/interop/reproducibility.md`).
  `@actuarial-ts/core`'s own stochastic layer is unaffected and remains
  genuinely seeded-reproducible.

- **The sidecar now self-witnesses.** `BootstrapODPSample` still REQUIRES a
  seed (an unseeded run is not attributable), but no longer implies the seed
  buys a replay. It runs the identical seeded request twice by default,
  compares, and records the outcome on the document; set
  `parameters.stability_repeats = 1` to opt out. Instability is measured and
  disclosed at run time instead of surfacing later as an irreproducible number.

- **Fixed a test that asserted a false contract.** The sidecar's
  `test_identical_seeded_calls_are_byte_identical` demanded byte-identity from
  an engine that does not provide it, and flaked roughly 4 runs in 5. It now
  asserts what actually holds — distributional agreement within tolerance, and
  the `witnessed` class stated on the document — plus new coverage for the
  stability disclosure and the opt-out.

## 0.2.0 — 2026-07-18

All five packages version together. **@actuarial-ts/interchange is new in this
release**, and @actuarial-ts/core gained `canonicalJson`/`fnv1a64` — so
interchange REQUIRES core >= 0.2.0 and will not work against core 0.1.0.
Publish order: core, interchange, data, compliance, agents.

@actuarial-ts/data has no source changes in this release; it is republished at
0.2.0 only to keep the packages in lockstep, because its `^0.1.0` core range
would otherwise refuse core 0.2.0 and pull a duplicate copy of core into a
consumer's tree (two core instances break `instanceof` on the shared error
classes).

- **`canonicalJson`/`fnv1a64` moved to @actuarial-ts/core** (`src/canonical.ts`)
  so the interchange layer can share them without a package cycle;
  @actuarial-ts/compliance re-exports both unchanged. One behavior change
  rode along: invalid canonicalization input now throws core's
  `ReservingError("UNSUPPORTED_VALUE")` instead of `ComplianceError` -
  same code, same message shape, different class.
- **New package: @actuarial-ts/interchange** - the actuarial-interchange
  spec v1 in TypeScript: envelope + integrity stamping, versioned parsing,
  triangle/selection/result/study/bundle/crosscheck schemas, core
  converters, and the cross-engine referee (`crosscheck`) with convention
  profiles.
- **Interop Phase A (conformance spine):** shared JSON Schema + JCS test
  vectors under `schema/interchange/1.0/`, with TS and Python conformance
  suites pinned to the same fixtures.
- **Interop Phase B (governance flows):** wrapped reproducibility bundles
  (outer integrity over `{ bundle, interchange }`) with wrapped-mode
  verification; disclosure Section 4b "Cross-implementation verification"
  rendered from `CrosscheckReportDoc`s with the mandated
  supports-not-constitutes boilerplate; `promoteStudy` in
  @actuarial-ts/agents (the four-gate study-promotion judgment chain);
  the workbench Import Study surface (routes + panel, restart-proof);
  Python `load_bundle`/`save_study` in `interop/python`.
- **Interop Phase C (second engine live):** the chainladder-python compute
  sidecar (`interop/sidecar`, FastAPI, spec-7 wire, bearer auth, stateless);
  `defineRemoteMethod` and the workbench `crosscheck_with_python` evidence
  tool; `createDivergenceExplainer` (invoked only on a disagreeing referee
  verdict); the `crosscheck:ci` live cross-engine referee wired into CI.
- **Interop Phase D (MCP layer):** the workspace exposed over MCP
  (`@mastra/mcp` MCPServer) with a staged-write exposure allowlist — seven
  read tools plus `stage_study`/`advance_promotion`, no direct mutation;
  a read-only `ask_advisor`; a fail-closed tenant seam
  (`requireMcpTenant`) with a boot self-test that aborts startup if it fails
  open; the notebook connection recipe (`docs/interop/mcp-notebook-recipe.md`).
- **Interop Phase E (R shore + upstream):** the R ChainLadder recipes
  (`tools/interop/actuarialInterchange.R`) — a third conformant shore of the
  interchange spec (JCS serializer + FNV-1a integrity reproducing every
  committed vector, triangle/selection/result converters honoring the
  alpha/delta trap, envelope + version handling) plus `tools/interop/conformance.R`,
  the cross-engine verdict runner that reproduced every fixture at ~1e-15
  relative deviation (float identity) against the committed profiles;
  upstream contribution drafts for R ChainLadder and chainladder-python; and
  interchange spec rev 2.2 (Section 15 field lessons). The three shores
  (TypeScript, Python, R) now all reproduce Mack 1993's published reserve and
  R ChainLadder's published standard error.

## 0.1.0 — 2026-07-17 (initial release)

The first release of actuarial-ts: an open-source, TypeScript-native P&C
actuarial SDK, evolved from (and dogfooded by) the ActNG reserving
workbench in this repository.

### @actuarial-ts/core

- Triangle construction from claim-level snapshots (7 triangle kinds,
  annual/quarterly) and direct grids; triangle algebra (cumulative <->
  incremental, add/subtract).
- Development factors with the standard averages menu; typed average keys.
- Deterministic methods: chain ladder, Bornhuetter-Ferguson,
  Benktander-Hovinen (Mack 2000), Cape Cod with the Gluck (1997) decay
  generalization, Expected Claims, frequency-severity (Friedland ch. 11),
  Berquist-Sherman (both adjustments), Munich chain ladder (Quarg-Mack
  2004), case-outstanding development, Fisher-Lange disposal rates,
  salvage/subrogation netting, ULAE (Conger-Nolibos 2003 with classical
  and Kittel presets).
- Stochastic layer, fully seeded and reproducible: Mack (1993/1999)
  standard errors, ODP bootstrap (England-Verrall/Shapland),
  Merz-Wuthrich (2008) one-year CDR MSEP, Clark (2003) growth-curve LDF
  and Cape Cod with delta-method variances.
- Tail fitting (exponential decay, Sherman inverse power), large-loss
  capping and ILF restoration with censored MLE severity fits, log-linear
  trend, parallelogram on-leveling, discounting with payout patterns built
  to the June 2026 edition of ASOP No. 20.
- Diagnostics: Mack's calendar-year test and factor-correlation test
  (both pinned to the published 1994 worked examples), standardized
  residuals, paid/incurred and closure diagnostics.
- Validation posture: the test suite reproduces published values from
  Mack (1993, 1994, 1999, 2000), Gluck (1997), England (2002),
  Merz-Wuthrich (2008), Clark (2003), and Quarg-Mack (2004), transcribed
  from the primary sources (see docs/research/).

### @actuarial-ts/data

- Zero-dependency RFC 4180 CSV parsing, loss-run parsing with row-level
  error collection, long-format triangle ingestion.
- ASOP No. 23 data review reports for claim data and triangle pairs —
  every check performed is reported, including explicit "not evaluated"
  entries.

### @actuarial-ts/compliance

- Estimate metadata (intended purpose/measure, gross/net basis, LAE
  treatment, accounting/valuation/review dates) with validation.
- Immutable assumption ledger separating machine defaults from human and
  agent judgment; judgment entries require rationale.
- ASOP No. 41 disclosure generator: a deterministic, byte-reproducible
  methods-assumptions-and-data appendix rendered from the analysis itself.
- ASOP No. 56 model cards for every shipped method.
- Reproducibility bundles (canonical JSON, integrity tag, first-mismatch
  verification) and actual-vs-expected roll-forward.

### @actuarial-ts/agents

- Mastra agent toolkit (Mastra and zod as peer dependencies):
  `defineActuarialTool` (never-throw envelopes; tenant keys rejected from
  input schemas at definition time), `tenantOf` (RequestContext-only
  tenant seam), `toolRegistry` (action/read classification).
- `createJudgmentChain`: human-gated suspend/resume workflows whose
  accepted decisions write the compliance assumption ledger — agent
  analyses produce their ASOP 41 documentation as a side effect.
- `createReservingAdvisor` with auditable, deterministic instruction
  assembly, and a golden-prompt tool-selection eval harness.

### Positioning

Designed to support the actuary's compliance with ASOP Nos. 43, 23, 41,
56, 25, 36, 20, 21, 38, and 13. The ASB does not approve software;
responsibility for compliance remains with the credentialed actuary.
