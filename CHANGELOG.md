# Changelog

All notable changes to the actuarial-ts SDK. The packages version
together; this file covers them all.

## Unreleased (targeting 0.2.0)

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
