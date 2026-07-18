# actuarial-interchange: cross-ecosystem interop (full design, rev 2.3)

Status: BUILT — Phases A through E implemented and shipped (see the
Progress Log in `docs/superpowers/plans/2026-07-16-actuarial-ts-sdk-master.md`
and CHANGELOG `Unreleased`→0.2.0). This is no longer an unscheduled design:
the TS/Python/R shores, the referee, the governance flows, the sidecar, and
the MCP layer exist. Rev 2.2 adds a post-build **Field lessons** addendum
(Section 15, changelog-style) reconciling the as-built system with this
design; the design body below (rev 2.1) is preserved unchanged. The
interchange wire-format version stays v1.0 (no breaking field change; the
field lessons are corrections and confirmations, not new wire fields). Rev 2
incorporated a 3-lens adversarial review (35 findings: grounding vs the
source-verified research, internal consistency, staff-engineer + actuary
design soundness). Grounding research lives in `docs/research/interop/`.

## 0. The idea in one paragraph

chainladder-python and R ChainLadder are better analysis laboratories;
actuarial-ts is the better governed system of record. Most sophisticated
users would want both: explore in a notebook, decide and document in the
governed workflow. This design makes that combination feel native through
one central artifact — a language-neutral interchange format that carries
**data, intent, results, and governance** — plus thin adapters on each
shore, a cross-implementation "referee" that turns having two engines into
a disclosed verification asset, a promotion workflow that turns notebook
studies into ledgered judgments, and agent/MCP bridges so both humans and
AI assistants can work across the seam. The lab stays the lab; actuarial-ts
is the notary.

## 1. Goals and non-goals

Goals:

- G1: Lossless, semantics-preserving movement of triangles, selections,
  results, and governance artifacts between actuarial-ts,
  chainladder-python, and R ChainLadder.
- G2: Selections travel as INTENT (volume-weighted, 5 periods, these
  exclusions) alongside VALUES, with a specified coherence rule between
  the two, so each ecosystem recomputes natively and verifies rather than
  trusting imported digits.
- G3: Cross-implementation agreement becomes a first-class, disclosed
  verification artifact supporting (never constituting) ASOP 56 model
  validation.
- G4: Notebook → governed promotion and governed → notebook deep-dive are
  each one call.
- G5: Agents participate where judgment support helps (drafting, evidence,
  divergence diagnosis) and NEVER where determinism is the point. Human
  gating is enforced as a gated PATH; accountability for who decided is
  recorded truthfully (see 8: the mechanism cannot verify humanness, so
  the ledger must not overclaim it).

Non-goals:

- N1: No dataframe semantics in TS; the interchange is documents, not a
  pandas port.
- N2: No sample-level stochastic parity across engines (different RNGs);
  parity is distribution-level with stated tolerances.
- N3: No forked method implementations to force agreement; conventions are
  mapped and documented, never silently reconciled.
- N4: Not a general insurance data standard; scope is the reserving
  workflow this SDK serves. Claim-level data is out of scope for v1.
- N5: No dependence on upstream acceptance: adapters work against today's
  published chainladder-python 0.9.x and R ChainLadder APIs.

## 2. Architecture

```
   Jupyter / chainladder-python          R / ChainLadder
        |  actuarial-interchange (pip)        |  actuarialInterchange (R recipes → pkg)
        |                                     |
        +----------------+--------------------+
                         |
              INTERCHANGE DOCUMENTS  (JSON Schema, versioned; Arrow lane for bulk)
              triangles · selections · results · studies · governance
                         |
              @actuarial-ts/interchange
              (schemas · converters · REFEREE/crosscheck)
                         |
  core / data / compliance / agents  ←— disclosure gains a
        |                                cross-implementation verification section
  workbench + any host app
        |
  promotion judgment chain (Mastra)    sidecar (Python HTTP)    MCP server (workspace)
```

Design center: every arrow is a document exchange. No shared runtime, no
RPC coupling between ecosystems except the explicitly-specified sidecar.

## 3. The interchange format (`actuarial-interchange` spec v1)

### 3.1 Principles

- **Canonicalization is RFC 8785 (JCS).** Sorted keys, no insignificant
  whitespace, and — the load-bearing part — JCS number serialization
  (ECMAScript shortest-round-trip), specified BY REFERENCE so Python and R
  implementations have an exact target. The Python adapter vendors a small
  pure-python JCS serializer (its "zero hard deps" posture allows one
  vendored file); the R recipes call a provided serializer function. A
  cross-language test-vector suite (committed under
  `schema/interchange/1.x/jcs-vectors.json`) is part of the spec: every
  adapter must reproduce every vector byte-for-byte.
- **Integrity tags cover the semantic body only.** `integrity` =
  fnv1a64(JCS(semantic body)) where the semantic body is the single
  kind-named object (`triangle`, `selection`, `result`, `study`,
  `bundle`) — NEVER the envelope (`interchangeVersion`, `kind`,
  `generator`, `createdAt`, `extensions`, `integrity` itself). A re-export
  by another adapter changes the envelope, not the tag, so
  `appliesTo`-by-tag linkage survives cross-language hops. Tags detect
  ACCIDENTAL divergence (workflow hygiene); FNV-1a is not collision
  resistant, and both tamper-evidence and tamper-proofing require
  host-side signing or cryptographic hashing (same language as
  `packages/compliance/src/bundle.ts`).
- **Where the primitives live:** `canonicalJson` (upgraded to full JCS
  number behavior — today's implementation already matches for the values
  the SDK emits; the JCS vector suite decides) and `fnv1a64` MOVE to
  `@actuarial-ts/core`'s util layer at the next minor; compliance
  re-exports them unchanged for compatibility. `@actuarial-ts/interchange`
  then depends on core only, and the compliance → interchange dependency
  for bundle wrapping (4.1) creates no cycle.
- **Additive evolution:** minor versions only add optional fields; readers
  MUST ignore unknown fields but MUST round-trip unknown fields inside
  `governance` and `extensions` opaquely (byte-preserved), so a Python hop
  can never strip a ledger.
- **Envelope:** every document carries `{ interchangeVersion, kind,
  generator: { name, version }, createdAt }`. `createdAt` is
  caller-supplied (purity rule).
- **Null means unobserved, everywhere.** Adapters MUST NOT let NaN→0 or
  0→missing conversions leak through (4.2 blocks the chainladder-python
  `to_json` hazard by construction).
- **Money:** JSON numbers (exact integers to 2^53 — sufficient for
  reserving aggregates) with optional `units: { currency?, scale? }`.
  Stored value × scale = amount in MAJOR currency units; scale defaults
  to 1. Round-trip precision pinned at 1e-9 relative by the conformance
  suite.

### 3.2 Document kinds

`kind: "triangle" | "selection" | "method-result" | "stochastic-result" |
"study" | "bundle" | "crosscheck-report"` — plus `governance` payloads
embedded in study/bundle documents.

#### TriangleDoc

```jsonc
{
  "interchangeVersion": "1.0.0", "kind": "triangle",
  "generator": { "name": "@actuarial-ts/interchange", "version": "0.1.0" },
  "createdAt": "2026-07-17T00:00:00Z",
  "triangle": {
    "measure": "paid",              // see measure vocabulary below
    "cumulative": true,
    "originLengthMonths": 12,       // 12 | 6 | 3 | 1 (annual/semiannual/quarterly/monthly)
    "origins": [ { "label": "2023", "start": "2023-01-01" }, ... ],
    "agesMonths": [12, 24, 36],
    "values": [[100, 160, 200], [110, 170, null], [120, null, null]],
    "valuationDate": "2025-12-31",
    "basis": { "grossNet": "gross", "laeTreatment": "excluding-lae" },   // optional
    "units": { "currency": "USD", "scale": 1 },                          // optional
    "segment": { "labels": { "lob": "GL" } }                             // optional, opaque strings
  },
  "extensions": {}, "integrity": "a1b2c3d4e5f60718"
}
```

- **Measure vocabulary** (v1, closed + escape hatch): `paid | incurred |
  caseReserve | reportedCount | openCount | closedCount |
  closedWithPayCount | earnedPremium | custom:<label>` — the seven core
  `TriangleKind` values plus premium and a namespaced custom. Adapters map
  unknown external measures to `custom:<label>`.
- **Cadence** is the integer `originLengthMonths` (not an enum), which
  covers chainladder-python's monthly/quarterly/semiannual/annual grains
  and, with `origins[].start`, disambiguates fiscal/trailing calendars.
  actuarial-ts natively computes on 12 and 3; a TS reader receiving 1 or 6
  parses successfully and reports a warning that computation support is
  limited (reader-side capability, not a format error).
- chainladder-python is 4-D (index, columns, origin, development); one
  TriangleDoc = one (index-slice, measure) pair. The Python adapter
  provides `explode(cl_triangle) -> list[TriangleDoc]` and
  `combine(docs) -> cl.Triangle`.
- R triangles are matrices with dimnames; `as.triangle` on a long frame
  SUMS duplicate (origin, dev) records — the R adapter pre-validates
  uniqueness and refuses aggregation rather than silently summing.

#### SelectionDoc — intent + values, with a coherence rule

```jsonc
{
  "kind": "selection",
  "selection": {
    "appliesTo": { "measure": "paid", "triangleIntegrity": "<TriangleDoc tag>" },
    "development": [
      {
        "fromAgeMonths": 12, "toAgeMonths": 24,
        "value": 1.602,
        "intent": {
          "kind": "volume-weighted",     // volume-weighted | simple | regression | geometric | medial | judgmental | external
          "windowOriginPeriods": 5,      // counts ORIGIN PERIODS in the triangle's own cadence; omitted = all
          // excludeHigh/excludeLow (medial trims) are valid ONLY with kind="medial" and must be omitted otherwise
          "exclusions": [ { "origin": "2021", "reason": "one-off large loss" } ],
          "rationale": "..."             // REQUIRED when kind is judgmental or external
        }
      }
    ],
    "tail": {
      "value": 1.05,
      "intent": { "kind": "fitted", "family": "exponential-decay",
                  "fitFromAgeMonths": 24, "params": { "intercept": -1.2, "slope": -0.35 } }
      // or { "kind": "judgmental", "rationale": "..." } — rationale REQUIRED, same rule as development
    }
  }
}
```

**The coherence rule (normative).** For COMPUTABLE intents (everything
except `judgmental`/`external`), `value` MUST equal the intent's
recomputation on the referenced triangle within the spec coherence
tolerance (1e-9 relative). Every conforming importer MUST verify this and,
per a strictness flag, either warn or refuse on divergence. Intent is
authoritative for replay and promotion; values are authoritative only for
`judgmental`/`external` intents (where they ARE the judgment, and the
rationale field carries its justification). This closes the
edited-value-vs-stale-intent hole: a divergent document is detectably
incoherent on every shore, in the same way.

**Intent equivalence map** (v1; normative per Section 11; the
`replay` column states each engine's capability: `exact`,
`approx`, or `value-only`):

| interchange intent | actuarial-ts (replay) | chainladder-python `Development` (replay) | R ChainLadder (replay) |
|---|---|---|---|
| volume-weighted, all | `all-wtd` (exact) | `average="volume", n_periods=-1` (exact) | `MackChainLadder(alpha=1)` / `ata()$vwtd` (exact) |
| volume-weighted, n | `5-wtd`/`3-wtd` for n∈{5,3} on 12-month cadence, else value-only | `average="volume", n_periods=n` (exact) | weights window (approx) |
| simple, all/n | `all-str`/`5-str`/`3-str` (exact, same cadence caveat) | `average="simple"` (exact) | `alpha=0` (simple average) (exact) |
| regression (through origin) | value-only (not in menu) | `average="regression"` (exact) | `alpha=2` (regression of C_{k+1} on C_k) (exact) |
| geometric | `geo-all` (exact) | value-only — SETTLED empirically in Phase A: `average="geometric"` raises KeyError in chainladder 0.9.2; the bridge demotes to value-only with a warning | (manual) (value-only) |
| medial (excludeHigh/Low) | `med-5x1` for {5,1,1} (exact); others value-only | approx via `drop_high/drop_low/n_periods` | (manual) (value-only) |
| judgmental/external values | typed vector (exact) | `DevelopmentConstant(patterns={ageMonths: ldf}, style="ldf")` (exact) | `CLFMdelta(Triangle, selected)` → per-period `delta` (exact WHEN feasible) |
| fitted tail exp-decay | `exponentialDecay` (exact) | `TailCurve(curve="exponential")` (exact) | `tail=TRUE` (log-linear) (approx) |
| fitted tail inverse power | `inversePower` (exact) | `TailCurve(curve="inverse_power")` (exact) | (manual) (value-only) |

R parameterization note (normative, because the research flags it as a
known trap): `MackChainLadder(alpha)` semantics are alpha=1
volume-weighted, alpha=0 simple average, alpha=2 regression; the
lower-level `chainladder(delta)` uses alpha = 2 − delta. Adapters MUST NOT
conflate the two.

Injection honesty rules:

- chainladder-python: `DevelopmentConstant` is exact and always feasible,
  BUT (research-verified) it carries no `sigma_`/`std_err_`, so
  `MackChainladder` cannot produce standard errors on top of it. Adapters
  therefore replay COMPUTABLE intents natively via `Development(...)` per
  the table (which yields sigmas) and reserve `DevelopmentConstant` for
  `judgmental`/`external` value-only selections; a Mack request on a
  value-only selection is answered SE-less with an explicit warning (or
  refused, per a strictness flag) — never silently approximated.
- R: `CLFMdelta` returns a per-element `foundSolution` flag and infeasible
  selections exist. The R adapter surfaces failures as warnings in the
  resulting document, and the referee treats a failed injection as
  `not-comparable`, never as agreement.

#### MethodResultDoc / StochasticResultDoc

```jsonc
{
  "kind": "method-result",
  "result": {
    "appliesTo": { "triangleIntegrity": "<tag>", "selectionIntegrity": "<tag or null>" },
    "engine": { "name": "chainladder-python", "version": "0.9.2",
                "conventionProfile": "mack1993-vw" },
    "method": "clpy:MackChainladder",
    "parameters": { "average": "volume", "n_periods": -1 },
    "effectiveParameters": { "est.sigma": "Mack" },   // when the engine deviated from requested (R's est.sigma auto-fallback); absent = as requested
    "rows": [ { "origin": "2023", "ultimate": 1234.5, "unpaid": 234.5, "standardError": 81.1 } ],
    "totals": { "ultimate": 9999.9, "unpaid": 2222.2, "standardError": 310.0 },
    "warnings": ["..."]
  }
}
```

- Method namespaces (reserved by this spec): actuarial-ts discriminants
  unprefixed; `clpy:` chainladder-python; `rcl:` R ChainLadder. New
  engines register a prefix via spec minor.
- `effectiveParameters` exists because R's `MackChainLadder` silently
  falls back from `est.sigma="log-linear"` to `"Mack"` on poor regression
  fit (research-verified); the R adapter records the EFFECTIVE method, and
  the referee downgrades requested≠effective comparisons with a
  comparability warning.
- StochasticResultDoc adds `{ seed?, nSims, summary: { mean, sd, cv,
  percentiles }, byOrigin[] }`; samples only via `samplesRef` in the bulk
  lane. Cross-engine stochastic comparison is distribution-level only.
- Sigma vectors do NOT travel in SelectionDocs; each engine recomputes
  sigma per the convention profile (`extract_selections` reads `ldf_`
  and tail state only — the earlier sigma mention is dropped).

#### StudyDoc — the promotion unit

```jsonc
{
  "kind": "study",
  "study": {
    "title": "GL occurrence Q3 factor study",
    "narrative": { "analyst": "Sam Doe", "sourceRef": "nb/q3-study.ipynb",
                   "summary": "VW 5-year anchors; 2021 excluded; exp-decay tail." },
    "triangles": [ TriangleDoc, ... ],
    "selections": [ SelectionDoc, ... ],
    "supportingResults": [ MethodResultDoc, ... ],   // OPTIONAL; when absent, Gate 2 verifies coherence + replays, with no cross-engine referee step
    "expectations": { "replayTolerance": 0.0005 }     // subject to the host ceiling (Section 6)
  },
  "governance": { }    // reserved; round-tripped opaquely by non-TS adapters
}
```

#### BundleDoc

The wrapped reproducibility bundle: `{ kind: "bundle", bundle: <existing
canonical payload>, interchange: { triangles: [...], selections: [...],
results: [MethodResultDoc | StochasticResultDoc, ...] } }` — results are
INCLUDED so `load_bundle` can honor its contract without parsing the
TS-native blob. The wrapped form carries an OUTER integrity tag over
`{ bundle, interchange }`, and `verifyBundle` gains a wrapped mode that
checks the inner bundle exactly as today AND the outer tag, so the mirror
(the only part non-TS consumers read) cannot drift unnoticed.

#### CrosscheckReportDoc

Semantic body key: `report` (the head-noun rule made explicit; settled
during Phase A implementation). Referee output: engines compared (with versions and profiles), the
`appliesTo` tags matched, requested and effective parameter sets,
per-origin and total relative deviations, tolerance applied, and verdict
`agree | disagree | not-comparable | verified-by-value` (the last for
value-only replays where no independent recomputation occurred — the
disclosure renders it distinctly so nothing overstates what was checked).

### 3.3 Bulk lane

`"valuesRef": { "format": "arrow", "path": "values.arrow", "sha256":
"..." }` beside the JSON manifest for payloads beyond reserving-triangle
scale (guideline > 200k cells). v1 defines the field; all v1 conformance
fixtures use inline JSON.

### 3.4 Schema publication

Single source of truth: zod schemas in `@actuarial-ts/interchange`,
mechanically emitted to JSON Schema under `schema/interchange/1.x/`
(committed, URL-referenced by the Python/R validators) alongside the JCS
test vectors. A CI check regenerates and diffs; drift fails the build.

### 3.5 Version handling (all adapters)

Wrong-major documents: TS `parseDocument` throws
`ReservingError("UNSUPPORTED_VERSION")`; Python raises
`UnsupportedVersionError` (subclass of the package's `InterchangeError`);
R recipes `stop()` with a `condition` class `interchange_version_error`.
Same-major unknown minors: accept, ignore unknown fields, round-trip
`governance`/`extensions` opaquely.

## 4. Packages and adapters

### 4.1 `@actuarial-ts/interchange` (TS; new package)

- Depends on core only (types + the relocated canonicalJson/fnv1a64 per
  3.1). Compliance depends on interchange for the bundle wrapper; no
  cycle.
- Exports: zod schemas + types for every kind; `triangleToDoc/
  docToTriangle`; `selectionsToDoc/docToSelections` (intent ↔ averages
  menu / typed vectors, with the coherence check); `resultToDoc` for every
  core method result (stamping `appliesTo`); `parseDocument`
  (version-checked, warning-channeled); `crosscheck` (Section 5);
  `emitJsonSchema` (build-time). New `RESERVING_ERROR_CODES`:
  `BAD_INTERCHANGE`, `UNSUPPORTED_VERSION`, `INCOHERENT_SELECTION`.

### 4.2 `actuarial-interchange` (Python; new, PyPI)

- Pure-python core (json + dataclasses; one vendored JCS serializer) with
  `pip install actuarial-interchange[chainladder]`.
- Triangle bridge: builds `cl.Triangle` from TriangleDoc via a long
  DataFrame with explicit `cumulative=`; converts back via
  `to_frame(keepdims=True, origin_as_datetime=True)`. DELIBERATE: never
  uses `Triangle.to_json()` as the wire format — source-verified to emit
  incremental values in valuation layout with `fillna(0)`, destroying the
  null-vs-zero distinction (fine for cl↔cl persistence; not the
  interchange). SECOND hazard found empirically in Phase A: the
  long-frame CONSTRUCTOR passes through a sparse intermediate that
  converts explicit 0.0 cells to NaN (a silent zero→missing corruption);
  the bridge restores observed zeros post-construction, tested both
  directions.
- Selection bridge OUT: `extract_selections(fitted_dev, fitted_tail)`
  reads `ldf_` and estimator `get_params()` to emit intent + values.
  Selection bridge IN: computable intents → native `Development(...)`
  estimators per the equivalence table (sigmas available downstream);
  value-only intents → `DevelopmentConstant` (+ `TailConstant`), with the
  Mack-SE-less rule from 3.2 enforced here.
- Result bridge: `extract_result(fitted estimator)` → MethodResultDoc with
  engine stamp, `appliesTo` tags, parameter echo.
- Bundle/study: `load_bundle(path)` → triangles as `cl.Triangle`,
  selections, and results as DataFrames (all from the interchange block;
  outer tag verified on load); `save_study(...)` → StudyDoc (refuses an
  empty narrative summary).

### 4.3 R adapter (recipes first, package later)

Phase E ships `tools/interop/actuarialInterchange.R`: jsonlite + provided
JCS serializer; TriangleDoc ↔ matrix with explicit starts; `ata()`-based
selection export; `MackChainLadder` component extraction (`f`, `sigma`,
`Mack.S.E`, `Total.Mack.S.E`) with `effectiveParameters` recording the
est.sigma auto-fallback; `CLFMdelta` injection with `foundSolution`
honesty. CRAN packaging only if usage warrants.

## 5. The referee (`crosscheck` in `@actuarial-ts/interchange`)

- `crosscheck({ a, b, tolerance? })` validates comparability via
  `appliesTo` tags (same triangle; same selection or both null) and
  convention profiles, computes per-origin/total relative deviations,
  applies requested≠effective downgrades, and returns a
  CrosscheckReportDoc. Deterministic; NOT an agent (G5).
- Convention profiles (normative alignment requirements, executable by
  the conformance suite):
  - `deterministic-cl`: factor + projection point estimates; all three
    engines ~1e-9 under identical selections. Tolerance 1e-6 relative.
  - `mack1993-vw`: volume-weighted all-period factors, Mack sigma with
    Mack's last-column extrapolation. Requires chainladder-python
    `Development(average="volume", n_periods=-1,
    sigma_interpolation="mack")` (its DEFAULT log-linear does not match)
    and R `MackChainLadder(alpha=1, est.sigma="Mack")` (its DEFAULT
    log-linear does not match; the auto-fallback makes
    `effectiveParameters` load-bearing). Central 1e-6; SEs 0.5% relative.
  - `odp-bootstrap-distribution` (phase C): distribution-level bands on
    mean/SE/percentiles with a documented expected delta from
    chainladder-python's Shapland hat-matrix adjustment.
- Disclosure integration: `generateDisclosure` gains optional
  `crossImplementation: CrosscheckReportDoc[]` rendering **"Section 4b —
  Cross-implementation verification"** with REQUIRED boilerplate:
  agreement between independent implementations supports, but does not by
  itself constitute, the model validation contemplated by ASOP No. 56;
  model appropriateness to the book remains a separate professional
  judgment. `verified-by-value` verdicts render as exactly that.
- CI mode: `crosscheck-ci` script runs TS + sidecar on committed fixtures
  and exits non-zero on `disagree`.

## 6. Promotion: notebook study → governed judgment

A Mastra judgment chain via the existing `createJudgmentChain` (verified:
its gate/suspend/resume/ledger shape matches this design without
modification):

- **Gate 1 `study-intake`** (auto-evidence): schema-validate; run the
  ASOP 23 review on the study's triangles; verify selection coherence
  (3.2 rule); resolve segments — each SelectionDoc's triangle
  `segment.labels` must match exactly one host workspace target, v1 rule
  one-selection-per-segment; no-match or ambiguous-match BLOCKS with a
  named error (no fuzzy matching in v1). Evidence prominently displays
  `expectations.replayTolerance`, flagged when it exceeds 10x the
  profile default; the EFFECTIVE tolerance is min(study, host ceiling) —
  the host configures a ceiling in `promoteStudy` options, and a study
  exceeding it fails intake with the reason stated.
- **Gate 2 `replay-verify`** (auto-evidence): replay each selection's
  INTENT in the TS engine where the equivalence table says `exact`;
  `approx`/`value-only` intents apply values directly and are labeled
  `verified-by-value` in the evidence and the eventual disclosure (no
  overstatement). Where `supportingResults` exist, referee them against
  the replay at the effective tolerance; `disagree` HARD-BLOCKS (the gate
  cannot accept it — fix the study upstream; the ceiling above is why
  tolerance editing is not an escape hatch). Absent `supportingResults`,
  the gate proceeds on coherence + replay evidence alone and says so.
- **Gate 3 `rationale`** (human judgment): presents a DRAFT rationale
  (agent-drafted when a model is configured — Section 9 — else
  template-assembled from the narrative). Resume REQUIRES non-empty
  rationale plus an `attestation` field (Section 8); the verbatim final
  text is what the ledger records.
- **Gate 4 `apply`**: selections through the host service layer; ledger
  entries with `source` = study `sourceRef` + integrity tag AND the
  effective replay tolerance; analysis rerun; completion note + ledger
  persisted like the ELR chain today.

Surfaces: headless `promoteStudy(chainDeps, studyDoc, { toleranceCeiling,
actorDefault })` in the agents package; an "Import study" workbench panel
reusing the advisor-gate UI. Reverse flow: wrapped `createBundle` +
Python `load_bundle` (no new machinery).

## 7. The sidecar (Python compute service)

- Plain HTTP + JSON (FastAPI), NOT MCP; the interchange spec is the wire
  contract.
- `POST /v1/run/{method}` with named triangle slots and typed inputs:

```jsonc
{
  "triangles": { "primary": TriangleDoc, "secondary": TriangleDoc? },  // secondary: MunichAdjustment's incurred (primary = paid)
  "selection": SelectionDoc?,
  "exposure": { "origins": ["2023", ...], "values": [10000, ...], "kind": "earnedPremium" }?,   // BF/Benktander/CapeCod apriori base
  "parameters": { ... },                                              // method-specific, schema'd per method
  "seed": 42?
}
```

  → `MethodResultDoc | StochasticResultDoc`. Plus `GET /v1/engine`
  (name/version/profiles) and `GET /v1/health`.
- Methods v1: `MackChainladder`, `Chainladder`, `BornhuetterFerguson`,
  `Benktander`, `CapeCod`, `ClarkLDF`, `BootstrapODPSample` (seeded),
  `MunichAdjustment` (requires both slots; refused otherwise). Mack on a
  value-only selection follows the SE-less rule (3.2).
- Statelessness is a privacy feature: no persistence, no tenant ids in
  the wire contract (opaque `engagementRef` permitted), bearer auth,
  size limits, image pinned to exact chainladder/pandas versions (the
  conformance suite runs against the image; the image IS the version
  contract).
- TS client: `defineRemoteMethod({ id, sidecarUrl, method, kind: "read",
  timeoutMs, headers })` in `@actuarial-ts/agents` — wraps the call in
  `defineActuarialTool` (envelope; tenant seam untouched — the tenant id
  never enters the sidecar payload), maps transport errors to envelopes,
  forwards AbortSignal.

## 8. MCP layer (workspace as MCP server)

Grounded in the verified @mastra/mcp facts:

- Built on `MCPServer` from `@mastra/mcp` — a NEW dependency for this
  repo (the research verified 1.8-line types from a sibling install; an
  ActNG2 build adds the then-current line, ~1.14+, fresh). The design
  requires neither `mapAuthInfoToUser` nor FGA; the middleware + helper
  pattern below works on every line since 1.8.
- Exposure policy: READ tools (overview, factors, diagnostics, results,
  crosscheck reports) plus exactly two write-shaped tools — `stage_study`
  (starts the promotion chain) and `advance_promotion` (gate + decision +
  rationale + attestation + actor). No direct mutation tools over MCP:
  external clients get the same GATED PATH as everyone else. The
  mechanism cannot verify that the decider is human — so it records who
  decided instead of pretending: `actor` is REQUIRED on judgment gates,
  defaults to `"external-mcp-client"` when the caller omits it, and the
  `attestation` free-text ("rationale authored/reviewed by <name>") lands
  verbatim in the ledger. The accountability boundary is disclosure-true:
  a ledger can show that an unattended client promoted a study, which is
  precisely what a reviewing actuary needs to be able to see.
- Tenant seam (closing the research's fail-open caveat): HTTP middleware
  validates the bearer token and sets `req.auth = { projectId }`; every
  exposed tool resolves tenant EXCLUSIVELY via `requireMcpTenant(context)`
  reading `context.mcp.extra.authInfo`, throwing (enveloped) when absent;
  plus a boot-time self-test that calls a probe tool without auth and
  asserts failure. A missed wire-up cannot fail open silently.
- `ask_advisor` exposes the reserving advisor (description required by
  the API). The Python sidecar is NOT an MCP server in v1; a notebook-side
  MCP client recipe ships as docs in phase D.

## 9. The Mastra/agents utilization pass (deliberate, both directions)

Where agents/Mastra ARE used:

1. **Promotion chain = `createJudgmentChain`** (Section 6) — the proven
   evidence → suspend → human decision → ledger shape, reused verbatim;
   the compliance fusion comes free.
2. **Rationale drafting** (Gate 3): a drafting-only advisor (no action
   tools) turns narrative + evidence into a DRAFT; the human owns the
   final text. Judgment is never delegated — drafting is.
3. **Divergence explainer**: `createDivergenceExplainer({ model })` —
   invoked ONLY on a `disagree` verdict; read-only over both result docs,
   the convention map, and the profile; output is a structured hypothesis
   ("R ran est.sigma=log-linear; profile requires Mack; expected
   signature: late-column SE deviations — observed"). Deterministic
   fixture tests: a known-misaligned pair must yield a hypothesis naming
   the misaligned flag.
4. **Advisor evidence via `defineRemoteMethod`** (Section 7): the advisor
   gains second-engine evidence tools; golden-prompt evals cover THESE
   (the advisor genuinely selects them, so tool-selection evals apply).
5. **MCP exposure via Mastra's own MCPServer** (Section 8), including
   `ask_advisor`.
6. **Testing split, corrected per review**: golden prompts only for
   advisor-SELECTED tools (the remote evidence tools); the MCP-exposed
   `stage_study`/`advance_promotion` are called by external clients, not
   selected by our agent, so they get deterministic contract tests
   instead — schema round-trips, gate-sequence enforcement, the Gate-2
   hard-block, tolerance-ceiling intake failure, and the fail-closed
   tenant probe.

Where agents are deliberately NOT used (and must not creep in): the
referee's comparisons and verdicts; interchange serialization/validation;
the conformance suite; Gate 2's hard-block (policy, not persuasion — no
agent can talk a failed replay into acceptance).

Net assessment against "are we fully utilizing Mastra?": the promotion
chain, drafting, divergence explainer, remote-evidence tools, and
MCPServer adoption earn their places; agent networks, autonomous
cross-engine arbitration, or agentic serialization would be over-indexing
and are explicitly out.

## 10. Conformance suite

- Fixtures: Taylor/Ashe, RAA, Mack mortgage (the three Phase A fixtures),
  plus Merz-Wuthrich Table 2 and the Quarg-Mack fire portfolio (later
  phases), plus chainladder-python's bundled GenIns/ABC for their-side
  familiarity.
- Matrix: per (fixture × profile × engine): expected factors, ultimates,
  reserves, SEs at profile tolerances; round-trip tests asserting
  SEMANTIC-BODY equality under JCS (envelope fields legitimately differ
  per hop; the integrity tag must be IDENTICAL across TS → Python → TS);
  explicit null-preservation assertions against the NaN→0 hazard; the JCS
  vector suite for every adapter.
- Where it runs: TS side in repo CI always; Python side in a separate
  pinned-matrix workflow (plus the sidecar image build); R side scripted
  (`tools/interop/conformance.R`) and manual until phase E. Upstream
  drift is caught by the pinned matrix growing a column, never silently.
- The committed conformance results table IS the public compatibility
  statement.

## 11. Versioning and compatibility policy

- Spec semver, independent of package versions. Readers accept same-major;
  unknown minor fields ignored (round-tripped where 3.1 requires).
  Writers stamp exact versions. Breaking changes: major bump + dual-read
  window in all first-party adapters for one cycle.
- The equivalence table (3.2), the R parameterization note, and the
  convention profiles (5) are PART OF THE SPEC: adding a profile or an
  intent is minor; changing existing alignment requirements or replay
  capabilities is major.
- Deprecation via `deprecatedIn` schema annotations; removal only at a
  major.

## 12. Security and privacy

- No tenant identifiers in interchange documents (opaque `engagementRef`
  only); the tenant seam stays host-side in RequestContext/authInfo.
- Triangles are aggregates; StudyDocs reference claim-level sources by
  ref only in v1 (claim-level interchange is a future major with its own
  privacy treatment).
- Sidecar: stateless, no persistence, bearer auth, size limits, pinned
  image. MCP: fail-closed tenant helper + boot self-test + truthful actor
  recording (Section 8).
- Integrity tags detect accidental divergence only (3.1); tamper-evidence
  and tamper-proofing require host-side signing/cryptographic hashing.

## 13. Phases, acceptance criteria, effort

- **Phase A — the spine**: spec v1 frozen (this document, post-review) +
  canonicalJson/fnv1a64 relocation to core + `@actuarial-ts/interchange`
  (schemas, converters, referee with `deterministic-cl` +
  `mack1993-vw`, JSON Schema + JCS vector emission, CI drift check) +
  `actuarial-interchange` Python package with the chainladder extra +
  conformance over Taylor/Ashe, RAA, and Mack mortgage × both profiles ×
  both engines + the convention map doc. ACCEPT: (1) a Taylor/Ashe
  SelectionDoc authored in TS replays in chainladder-python to 1e-6 on
  `deterministic-cl`, with every null preserved through the round trip
  and the integrity tag byte-identical across TS → Python → TS; (2)
  `mack1993-vw` SEs agree within 0.5% with `sigma_interpolation="mack"`
  pinned; (3) `crosscheck` returns a schema-valid CrosscheckReportDoc
  with verdict `agree` on aligned fixtures and `disagree` on a
  deliberately misaligned run (log-linear vs mack sigma); (4) every
  adapter reproduces every JCS vector byte-for-byte; (5) the geometric
  intent's chainladder-python cell is either conformance-proven or
  demoted to value-only before freeze. Size: one to two focused sessions.
- **Phase B — governance flows**: wrapped bundles (outer tag +
  verifyBundle wrapped mode) + `load_bundle` + StudyDoc + `promoteStudy`
  chain (ceiling, segment resolution, verified-by-value labeling) +
  workbench "Import study" panel + disclosure Section 4b with the
  required boilerplate + contract tests from 9.6. ACCEPT: the
  notebook → import → replay-verify → rationale → ledger → disclosure
  walkthrough runs end-to-end against a real Jupyter export; a
  tolerance-ceiling violation fails intake with the stated reason; the
  cross-restart resume proof extends to a paused promotion.
- **Phase C — the second engine live**: sidecar v1 (named slots, typed
  exposure, SE-less rule, pinned image conformance) + `defineRemoteMethod`
  + advisor evidence + `createDivergenceExplainer` (fixture-tested) +
  `crosscheck-ci`. ACCEPT: TS-vs-sidecar referee runs on every
  conformance fixture in CI; a deliberately misaligned profile produces a
  divergence report naming the misaligned flag; MunichAdjustment without
  a secondary slot is refused with a schema'd error.
- **Phase D — MCP**: workspace MCPServer (read + staged-write policy,
  actor/attestation recording, fail-closed tenant helper + boot
  self-test) + `ask_advisor` + notebook client recipe docs. ACCEPT: an
  external MCP client completes a promotion through the gates with its
  actor recorded as supplied (or the honest default), cannot reach any
  direct mutation tool, and the no-auth probe fails closed.
- **Phase E — the R shore + upstream**: R recipes (JCS serializer,
  CLFMdelta honesty, effective-parameters recording) + R conformance
  script + upstream overtures (chainladder-python native interchange
  read/write proposal; their to_json/read_json precedent and dataframe-
  interchange appetite suggest receptivity) + spec 1.1 from field
  lessons. ACCEPT: R recipes reproduce `mack1993-vw` on the fixtures with
  `est.sigma="Mack"` pinned and record the fallback when it fires.

Sequencing: A blocks everything; B and C are independent after A; D
follows B (needs the promotion chain; `ask_advisor` evidence is richer
after C but not gated on it); E is independent after A.

## 14. Risks and open questions

- R injection infeasibility (`CLFMdelta`): mitigated by the honesty
  channel and by treating R primarily as an export/verification shore.
- Upstream drift: chainladder-python is pre-1.0 and moving; the pinned
  conformance matrix is the tripwire, and the adapter supports a narrow
  version range on purpose.
- Convention swamp depth: profiles beyond the shipped ones (Benktander
  apriori handling, Cape Cod decay vs their CapeCod, bootstrap variants)
  each need Mack-grade care; the spec makes an unbacked profile
  impossible to claim.
- JCS in R: jsonlite does not emit JCS numbers natively; the provided
  serializer is small but is real work — budgeted in phase E, and the
  vector suite is the referee.
- Adoption asymmetry: the Python adapter serves TS-side users from day
  one even if no pure-Python user adopts the format; success does not
  depend on ecosystem goodwill.
- Open: whether medial/geometric deserve upstream chainladder-python PRs
  rather than approximation mappings; whether the wrapped bundle becomes
  `createBundle`'s default at the next SDK minor; whether `engagementRef`
  wants a registry convention.

## 15. Field lessons (post-build, rev 2.2)

Changelog-style, not a rewrite. The rev 2.1 design body above is preserved
verbatim; this section records what building Phases A–E actually taught and
reconciles the as-built system with the design. It flags where build
reality **confirmed**, **tightened**, or **corrected** a design decision.
Build evidence: the Progress Log in
`docs/superpowers/plans/2026-07-16-actuarial-ts-sdk-master.md` and CHANGELOG
`Unreleased`→0.2.0.

### 15.1 Empirical findings already folded into the body (confirmed consistent)

These were discovered during the build and written back into the design
body above; re-verified consistent at rev 2.2 with no further change needed:

- **Geometric intent is value-only on chainladder-python.**
  `Development(average="geometric")` raises `KeyError` in chainladder 0.9.2
  (verified in Phase A); the Python bridge demotes it to value-only with a
  warning. Body: Section 3.2 equivalence table + the `custom`/value-only
  note. Consistent.
- **Zero-vs-sparse constructor hazard.** The chainladder-python long-frame
  constructor passes through a sparse intermediate that converts explicit
  `0.0` cells to NaN (a silent zero→missing corruption); the bridge
  restores observed zeros post-construction, tested both directions. Body:
  Section 4.2. Consistent. (This is the mirror of the `to_json` NaN→0
  hazard, which Section 4.2 also documents.)
- **CrosscheckReportDoc semantic body key = `report`.** The head-noun rule
  made explicit; settled during Phase A implementation. Body: Section 3.2
  CrosscheckReportDoc. Consistent.
- **`est.sigma` auto-fallback recorded as `effectiveParameters`.** R's
  `MackChainLadder` silently falls back from `est.sigma="log-linear"` to
  `"Mack"` on poor regression fit; the adapter records the effective
  method. Body: Section 3.2 MethodResultDoc `effectiveParameters` + the
  note beneath it, and Section 5 (`mack1993-vw`). Confirmed: the existing
  `effectiveParameters` field covers this with **no schema change** — the
  fallback is a first-class result field, exactly as designed, not a new
  wire field.

### 15.2 What changed from design to build (the corrections list)

- **@mastra/mcp `authInfo` access path (CORRECTION).** Section 8 specifies
  the tenant helper resolves tenant via `context.mcp.extra.authInfo`. The
  installed `@mastra/mcp` 1.14 line actually exposes it at
  `requestContext.get('authInfo')`; the as-built `requireMcpTenant` tries
  three auth-context shapes and resolves via that path. The research doc
  (`docs/research/interop/mastra-mcp-capabilities.md`) was corrected.
  Section 8's design-time prose is left as written for historical fidelity
  — **this entry is the load-bearing correction**: the real 1.14 path is
  `requestContext.get('authInfo')`, not `mcp.extra`.
- **MCP disclosure-true actor stamping (TIGHTENING).** Beyond Section 8's
  "actor defaults to `external-mcp-client`", the build stamps every
  MCP-supplied actor `(via MCP)` in the ledger, so an unattended external
  client can never masquerade as an in-workbench human. The accountability
  boundary Section 8 describes is made visible on every entry, not just on
  the default.
- **Gate-2 hard block made STRUCTURAL (TIGHTENING).** Section 6 Gate 2 says
  a `disagree` verdict HARD-BLOCKS. The build makes it structural rather
  than procedural: after a `disagree`, the resume schema admits only
  `abort` — tolerance editing cannot reopen the gate (restart-proof, proven
  cross-process). Policy, not persuasion, enforced at the schema.
- **`canonicalJson`/`fnv1a64` relocation behavior change.** Section 3.1
  anticipated moving these to `@actuarial-ts/core` "at the next minor" —
  done. One rider not called out in the design: invalid canonicalization
  input now throws core's `ReservingError("UNSUPPORTED_VALUE")` instead of
  `ComplianceError` (same code, same message shape, different class);
  compliance re-exports both primitives unchanged.
- **Error codes the design named only in prose became machine codes.** The
  build registered the door/gate guards: `WORKSPACE_NOT_READY`,
  `SELECTION_SHAPE`, `UNSUPPORTED_MEASURE`, `PROMOTION_BUSY` (the
  `advance` compare-and-set), plus `MACK_LEG_FAILED` (Section 3.2 SE-less
  rule made operational: an SE that is legitimately uncomputable is
  skipped; an *unexpected* Mack-leg failure is surfaced, never swallowed)
  and `STORAGE_ERROR` (`SQLITE_*` normalized so no DB schema leaks over
  MCP). These join the Section 4.1 codes (`BAD_INTERCHANGE`,
  `UNSUPPORTED_VERSION`, `INCOHERENT_SELECTION`).
- **`save_study` overstatement caught (Phase B).** The Python `save_study`
  is now proven to refuse an empty narrative summary (the Section 4.2
  rule) — a rule the first cut asserted but hadn't actually enforced.
- **Divergence explainer determinism (Phase C).** Section 9.3 requires the
  explainer to "name the misaligned flag"; the build makes it a
  deterministic fixture assertion — the `sigma_interpolation` violation is
  pinned as `finding[0]` on the misaligned pair.

### 15.3 Conformance evidence (the public compatibility statement)

The design promised cross-engine agreement; the build measured it. Three
fixtures (Taylor/Ashe / GenIns, RAA, Mack's mortgage-guarantee triangle) ×
two profiles (`deterministic-cl`, `mack1993-vw`), actuarial-ts vs
chainladder-python:

- central estimates and totals agree at **1e-14..1e-16 relative** (live
  `crosscheck:ci`, Phase C), well inside the 1e-6 profile tolerance;
- Taylor/Ashe totals tie to Mack's published unpaid **18,680,855.61** and a
  Mack standard error of **2,447,094.86** (also the R ChainLadder SE);
- integrity tags survive TS→Python→TS **byte-identically**;
- the referee closes both directions: `agree` on the aligned
  Python-authored docs, `disagree` on the deliberately misaligned
  `log-linear` run (max per-origin SE deviation **4.90%** vs the 0.5%
  tolerance).

Evidence lives at `interop/conformance/` (frozen fixtures +
`interop/conformance/README.md`) and in the master Progress Log.

### 15.4 R shore (Phase E) field notes

- **jsonlite does not emit JCS numbers.** Confirmed the Section 14 risk:
  jsonlite gets JSON *structure* but not the ECMAScript `Number::toString`
  layout — so the provided serializer (shortest round-trip via
  `format(x, digits=17)` then the ES layout rules, UTF-16 key sort,
  `-0`→`"0"`, the `1e21`/`1e-7` exponent boundaries) is real, load-bearing
  work; the committed JCS vector suite
  (`schema/interchange/1.0/jcs-vectors.json`) is its referee.
- **R alpha/delta trap respected.** `MackChainLadder(alpha)` is `alpha=1`
  volume-weighted, `alpha=0` simple, `alpha=2` regression — NOT
  `chainladder(delta)` (which is `alpha = 2 − delta`). Body: Section 3.2 R
  parameterization note; `docs/interop/convention-map.md`. The recipes
  stamp `alpha`, never `delta`.
- **`est.sigma` fallback recorded, `CLFMdelta` feasibility surfaced.** The
  R recipes record `MackChainLadder`'s log-linear→Mack auto-fallback (fires
  on regression p > 0.05) as `effectiveParameters`, and surface
  `CLFMdelta`'s per-element `foundSolution` failures as `not-comparable`
  warnings — the exact honesty channels Sections 3.2 and 5 require. The
  R shore was VERIFIED for real (R 4.6.1, ChainLadder 0.2.21):
  `MackChainLadder(alpha=1, est.sigma="Mack")` reproduces the committed
  `mack1993-vw` fixtures for all three triangles at ~1e-15 relative
  deviation — float identity, not merely inside tolerance — with
  Taylor/Ashe's Total.Mack.S.E = 2,447,094.86 matching the published
  2,447,095; all 23 JCS vectors reproduce byte-for-byte in R (the
  lone-surrogate vector via raw WTF-8 byte handling, since R strings
  cannot hold a lone surrogate), and every committed integrity tag
  recomputes identically despite R having no unsigned 64-bit int (FNV-1a
  via a four-16-bit-limb multiply). The p>0.05 auto-fallback does not
  fire on these well-behaved triangles, confirming the est.sigma trap is
  real (log-linear yields a different sigma and does NOT self-correct) —
  the detection machinery is present and the pin is load-bearing.

### 15.5 Net

Nothing in the build invalidated a rev 2.1 design decision. The format
contract held across all three shores; the corrections above are
access-path and enforcement-strength refinements, not design reversals.
Because no wire field changed, the interchange **spec version stays v1.0**
— this is a rev 2.2 *document* revision recording build learnings, not a
format minor bump.
```


## 16. Reproducibility classes (rev 2.3)

Rev 2.2 and earlier carried an unstated assumption: that a seeded stochastic
result is a reproducible one. Measurement disproved it (see
`docs/interop/reproducibility.md`). chainladder 0.9.2's `BootstrapODPSample`
returns different samples for identical seeded calls **in a single process** —
sporadically, with exactly two distinct outcomes, and not attributable to
dependency drift, machine variance, BLAS thread count, or the array backend.

The format therefore stops making one promise for three different things.

**The classes.** Stochastic result bodies carry an optional
`reproducibility`:

- `seeded-reproducible` — re-running at this seed reproduces the document
  byte-for-byte. `@actuarial-ts/core`'s own stochastic layer qualifies; its
  purity rule (no clock reads, no ambient randomness, explicit seeds) is what
  earns it, and `packages/core/test/odpBootstrap.test.ts` pins it.
- `witnessed` — the engine is not byte-reproducible even under a fixed seed.
  The document is a tamper-evident record of what that engine produced on that
  run.

Deterministic methods do not carry the field: kind `method-result` already
implies reproducibility, and the frozen corpus proves it across three shores.
Absent means unstated — never read absence as a guarantee.

**Self-witnessing.** A `witnessed` producer SHOULD run the identical seeded
request more than once and record the outcome in `result.stability`
(`repeats`, `byteIdentical`, `maxRelativeDeviation`). This is the substantive
move: instability becomes measured evidence on the document at run time,
rather than a latent surprise for whoever later fails to reproduce a number.
The sidecar does this by default (`parameters.stability_repeats`, default 2,
set to 1 to opt out).

**Comparison.** A witnessed result must be compared distributionally, never
byte-wise. `crosscheckStochastic` (rev 2.3, below) is the referee for this;
`crosscheck` refuses a stochastic document and names it.

CORRECTION to the first draft of this section, which said `verified-by-value`
was the verdict that fits. It is not. `verified-by-value` means the engines
replayed the same VALUES rather than independently recomputing, so agreement
verifies value transport and not methodology. Two engines that each ran their
own bootstrap DID independently recompute; labelling that `verified-by-value`
understates what happened. Agreement between witnessed results is an ordinary
`agree`, carrying a warning that the comparison was distributional, that at
least one input is not reproducible, and that re-running will not reproduce
the numbers.

**Why this is NOT a wire-version bump.** Both fields are optional and appear
only on `stochastic-result`. No existing document changes, and no existing
reader breaks: Section 11's policy is that unknown minor fields are ignored,
and every document schema is `.passthrough()`, so a 1.0 reader encountering
`reproducibility` simply carries it through. Nothing a 1.0 document must
contain, or must be read as, has changed — so `interchangeVersion` stays
`1.0.0` and the frozen conformance corpus is untouched.

The alternative reading — that any added field is a spec minor and so warrants
`1.1` plus a corpus regeneration (an explicitly legitimate trigger under
`interop/conformance/README.md`) — is defensible. It was declined here to
avoid regenerating the public compatibility statement for a purely additive
change; if a 1.1 becomes warranted for an independent reason, fold this in and
regenerate once.

**Positioning consequence.** Claims that seeding or version pinning deliver
reproducibility are wrong for foreign engines and have been corrected
(`interop/sidecar/requirements.txt`, the sidecar's `MISSING_SEED` message).
The sidecar still REQUIRES a seed — an unseeded run is not attributable — but
no longer implies the seed buys a replay.


## 17. The stochastic referee (rev 2.3)

`crosscheck` compares derivations. `crosscheckStochastic` compares draws. They
are separate entry points because the question differs: a deterministic
comparison treats any deviation beyond float noise as disagreement, while two
Monte Carlo samples are EXPECTED to differ, by an amount sampling theory
predicts. Applying a deterministic tolerance to two samples manufactures
`disagree` verdicts out of ordinary noise.

**The tolerance is derived, not declared.** For n simulations at coefficient of
variation CV:

    relative MC standard error of the mean     ~= CV / sqrt(n)
    relative MC standard error of a sample sd  ~= 1 / sqrt(2n)

Two independent runs differ by sqrt(2) times those; the bound is `sigmas` of
that (default 4). Strictness therefore scales with n automatically — more
simulations, tighter bound — instead of being a constant somebody guessed.

**Strictness adapts to the reproducibility class.** If BOTH inputs declare
`seeded-reproducible` at the SAME seed they are asserting byte-reproducibility,
so the Monte Carlo allowance is WITHHELD and they are held to `exactTolerance`
(default 1e-9). The allowance is for genuinely independent draws, not a blanket
loosening. An unstated class is treated as unknown and granted the allowance,
with a warning — absence is never read as a guarantee.

**Mapping onto the existing report.** No schema change: `deviations.unpaid`
carries the deviation of the distribution mean (the central estimate of the
reserve) and `deviations.standardError` the deviation of its sd (the
bootstrap's sd IS the estimated prediction error). `ultimate` has no
distributional analogue and is null. A passthrough `comparison` block records
`nSims`, `seed`, `reproducibility` and whether the allowance was granted, so a
reader can interpret the verdict.

**Governance.** `promoteStudy` surfaces every `witnessed` supporting result at
the rationale gate, with its stability self-check, before the actuary's
attestation is written to the ledger. Promotion is not blocked — a witnessed
result can be perfectly adequate support — but the attestation must be
informed rather than nominal.
