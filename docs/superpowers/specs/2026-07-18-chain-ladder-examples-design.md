# Three chain-ladder examples — design

**Date:** 2026-07-18 (revised 2026-07-19 against the 0.3.0 remediation release)
**Status:** Design approved; implementation plan not yet written.
**Scope:** Four new workspaces under `examples/`. No changes to the five published
packages. Targets `@actuarial-ts/*@^0.3.0` — the 0.3.0 breaking changes to
`defineActuarialTool` are load-bearing here (see 3.1).

---

## 1. Purpose

Four runnable examples that each compute the same simple chain ladder on the
Taylor & Ashe (1983) triangle, differing **only in where the math executes**:
in-process TypeScript, `chainladder-python` over the HTTP sidecar, and R
`ChainLadder` over an `Rscript` subprocess. A fourth referees the three results
against each other.

**Primary goal:** onboarding documentation.
**Secondary goals, in order:** interop proof; agent-native showcase; end-to-end
validation of the three shores.

**Reader:** a credentialed actuary who knows chain ladder, Mack and BF cold and
is new to TypeScript. Comments explain *the code*, not the actuarial science.
"Volume-weighted all-period LDFs" needs no gloss; `(number | null)[][]` does.

### Why this is worth building

*(Revised for 0.3.0 — the remediation release closed parts of the original
motivation; what follows is what remains true and unproven.)*

1. **`generateDisclosure` fed by a judgment chain's frozen ledger.** 0.3.0's
   `reserve-review` now genuinely exercises the *direct* path
   (`createLedger` → `recordAssumption` → `generateDisclosure`,
   `examples/reserve-review/src/main.ts:152-168`). The **judgment-chain** path —
   `createJudgmentChain`'s suspend/resume gates producing the frozen
   `JudgmentChainOutcome.ledger` (`packages/agents/src/judgment.ts:161`,
   commented "Ready for @actuarial-ts/compliance generateDisclosure") — is
   still exercised by nothing. These examples are the first to drive it.
2. **A TS-orchestrated R computation.** As of 0.3.0 the R shore *does* run in
   CI (`.github/workflows/r-conformance.yml`: JCS vectors + the frozen corpus
   with literature anchors), which settles the old "verified only on the build
   machine" doubt. What still exists nowhere is a TS→R→TS round trip: TS writes
   a triangle document, R computes and writes a result document, TS parses and
   verifies it. Example 3 is the first.
3. **A cross-engine referee verdict from live engines.** 0.3.0 rewrote
   `reserve-review`'s referee into a genuine intent replay — but it is still
   one engine refereeing its own replay. The capstone compares three real
   engines computing independently.

---

## 2. Architecture

Four sibling workspaces, each cloning the `examples/reserve-review` anatomy:

```
examples/chain-ladder-typescript/    math in-process
examples/chain-ladder-python/        math in chainladder-python via HTTP sidecar
examples/chain-ladder-r/             math in R ChainLadder via Rscript subprocess
examples/chain-ladder-crosscheck/    referees all three result documents
```

Each contains exactly four committed files:

```
package.json        @actuarial-ts/example-chain-ladder-<shore>, private: true, no build script
tsconfig.json       extends ../../tsconfig.base.json, noEmit
src/main.ts         one exported no-arg function + a CLI tail
test/example.test.ts
```

The root `workspaces` glob `examples/*` already covers them; no root manifest
change is needed for discovery.

### Duplication is deliberate

The agent scaffolding is triplicated across the three shore examples rather than
factored into a shared module. For a reader new to TypeScript, an example that
imports `buildTheAgentStack()` from a sibling directory is an example they have
to read twice. Self-containment beats DRY in teaching code.

The consequence is a constraint: **the spine must stay modest enough that
triplicating it is cheap.** Section 3 fixes its contents; additions beyond that
list cost three times and require revisiting this decision.

---

## 3. The spine — identical in all three shore examples

Target ~220 lines including comments.

```
 1  Taylor & Ashe cumulative paid grid, as a literal
 2  const CREATED_AT           — module scope
 3  triangleFromGrid("paid", ORIGINS, AGES, GRID)
 4  triangleToDoc(...)         — stamps the integrity tag
 5  three defineActuarialTool instances (see 3.1)
 6  toolRegistry([...])
 7  one deliberate tenant-less call — print the fail-closed envelope
 8  createJudgmentChain with three gates (see 3.2)
 9  drive it with scripted resumeData
10  frozen ledger → generateDisclosure(...)
11  print ultimate / unpaid / verdict / disclosure section count
```

**Step 2 is load-bearing.** No module in the SDK reads a clock; every converter
takes `createdAt` as a required option. Byte-determinism — and therefore stable
integrity tags — depends on the example never calling `new Date()`.

**Step 7 is teaching, not decoration.** The reader sees the tenant seam fail
closed before they see it succeed. Print the `ToolEnvelopeFailure` verbatim.

**Step 9 is what makes this run in CI.** Judgment-chain human decisions are
plain `resumeData` objects written in code. No model, no API key, no network.

### 3.1 The three tools

| id | kind | tenant | body |
|---|---|---|---|
| `get_triangle` | `read` | `"required"` | returns the `TriangleDoc` built at step 4 |
| `compute_chain_ladder` | `read` | `"required"` | **the only thing that differs across the three examples** |
| `record_selection` | `action` | `"required"` | writes the chosen LDFs into the assumption ledger |

All three are built with `defineActuarialTool` **using the 0.3.0 API**: every
tool declares `tenant: "required"` (there is deliberately no default), execute
is `(input, tenant, context)`, and the wrapper resolves the tenant from the
trusted source before the body runs. There is no `tenantOf` call in any tool
body — that is the 0.2.0 idiom, removed in the 0.3.0 breaking change. The
`kind` discriminator is set honestly even though the SDK does not currently
use it for authorization.

Tool **input schemas stay simple** (empty objects or plain scalars). The 0.3.0
tenant lint fails closed on `z.unknown()`, records, and `.passthrough()` unless
the exact path is declared in `allowUninspected` — the examples should never
need that escape hatch, and not needing it is part of the lesson.

### 3.2 The three judgment gates

Ordered, each suspending for a human decision supplied as `resumeData`:

1. **Averaging basis** — volume-weighted vs straight vs geometric, all-period vs
   n-period. Resume payload selects `all-wtd`.
2. **LDF selection** — accept the computed averages or override per column.
   Resume payload accepts them unchanged.
3. **Tail factor** — resume payload selects `1.0`.

Each gate records to the ledger with `actor: "actuary"` and a rationale, so the
generated disclosure has three genuine judgment entries in ASOP 41 Section 5.

**Actor identity (0.3.0).** Since finding 3.6 landed, the authenticated
identity is read from the request context under
`ACTOR_IDENTITY_CONTEXT_KEY` (`"actorIdentity"`,
`packages/agents/src/judgment.ts:61`) — the resume payload supplies only the
coarse `actor` enum and **cannot assert an identity**. The examples set
`actorIdentity` in the run's `RequestContext` (e.g. `"jane.actuary@example.com"`)
and the tests assert the ledger entries carry it. This demonstrates the
security property the 0.3.0 fix introduced, rather than working around it.

---

## 4. What differs — step 5b only

| | body of `compute_chain_ladder` |
|---|---|
| **TypeScript** | `runChainLadder(triangle, selections)` in-process, then `resultToDoc` |
| **Python** | `callRemoteMethod({ sidecarUrl, method: "Chainladder", headers: { authorization } })`, then `parseDocument` |
| **R** | `runRscript("tools/interop/run-mack.R", tmpdir)`, then `parseDocument` |

A reader can diff `chain-ladder-typescript/src/main.ts` against
`chain-ladder-python/src/main.ts` and find exactly one function body changed.
That is the lesson.

### 4.1 Why `callRemoteMethod` and not `defineRemoteMethod`

`defineRemoteMethod` produces a Mastra tool whose input schema is
required-but-nullable on every field, so a hand-scripted call must pass explicit
`null` for `secondary`, `selection`, `exposure`, `parameters` and `seed`.
`callRemoteMethod` has no such requirement (verified unchanged at 0.3.0). Since
the example wraps the call in its own `defineActuarialTool` anyway, it gets the
tenant seam either way, and `callRemoteMethod` reads far better in a teaching
context.

The contrast is itself instructive: 0.3.0's `defineRemoteMethod` declares
`tenant: "none"` with a documented reason (the sidecar is stateless; the wire
body carries no tenant surface), while the example's own `compute_chain_ladder`
wrapper declares `tenant: "required"`. The example's comments should point this
out — it is the `tenant: "none"` audit trail working as designed.

---

## 5. New code required (R path only)

### 5.1 `tools/interop/run-mack.R` — new, ~40 lines

CLI entrypoint. Verified still absent at 0.3.0: `ats_extract_mack_result` takes
a live fit *object*, and `conformance.R` — though it now also asserts the
literature anchors — remains a comparison loop that takes no arguments and
never writes a document.

```
Rscript tools/interop/run-mack.R --in <triangle.json> --out <result.json> --created-at <iso8601>
```

Steps: parse args → `ats_read_document(in)` → matrix conversion →
`MackChainLadder(tri, est.sigma = "Mack")` → `ats_extract_mack_result(fit, ...)`
→ `ats_write_document(out)`.

Two non-negotiables:

- **`--created-at` must be a required argument.** The R helper defaults
  `created_at` to a hardcoded literal; without this every R-produced document
  claims the same date and determinism is lost.
- **`est.sigma = "Mack"` must be explicit.** R's silent log-linear fallback makes
  `effectiveParameters` disagree with `parameters`, producing a confusing
  comparability downgrade on first read.

### 5.2 A TypeScript subprocess helper — new, ~60 lines

Repo-wide grep for `child_process`, `execFile` and `spawn(` across `packages/`,
`interop/` and `examples/` returns **zero hits**. This primitive does not exist.

Needs: PATH probe for `Rscript`, `execFile` with a timeout, exit-code→envelope
mapping, temp-directory lifecycle with cleanup.

**It lives inside `examples/chain-ladder-r/src/`, not in `packages/agents`.**
Rationale: the SDK is mid-remediation against the 2026-07-18 review, and growing
its public surface during that is a bad trade. It can graduate to the package
later if a second consumer appears.

### 5.3 Extend `.github/workflows/r-conformance.yml` — **exists since 0.3.0**

The workflow the original spec proposed was created by the remediation
(finding 4.4): `r-lib/actions/setup-r@v2` pinned to R 4.4, RSPM binary
packages, a package cache, the 23 JCS vectors, and `conformance.R` over the
frozen corpus. **Do not create a second workflow.** Extend the existing one:

- add a step invoking `run-mack.R` against a fixture triangle and verifying the
  written result document (the CLI smoke test);
- add a step running the `chain-ladder-r` example's test suite;
- add `examples/chain-ladder-r/**` to the workflow's `paths:` filters (both
  `push` and `pull_request`) — today they cover only `tools/interop/**` and the
  fixtures, so example regressions would never trigger it.

### 5.4 Toolchain pinning — partially resolved; decide the remainder

0.3.0 pinned the R version (4.4) in CI but installs the latest CRAN
`ChainLadder`/`jsonlite` (with a cache whose key does not include versions).
There is still no `renv.lock`. The implementation plan should either accept the
floating-CRAN posture the workflow chose — it is a defensible "tripwire"
stance, matching how `py-conformance.yml` treats its matrix — or add a version
assertion at `source()` time. Do not silently introduce a third posture.

---

## 6. Setup friction and the CI story

| example | runs offline | when the shore is absent |
|---|---|---|
| `chain-ladder-typescript` | yes | n/a |
| `chain-ladder-python` | no | exit non-zero, print the exact boot command |
| `chain-ladder-r` | no | exit non-zero, print the exact install command |
| `chain-ladder-crosscheck` | no | requires all three |

This follows the posture `interop/conformance/crosscheck-ci.mts` already takes:
exit with instructions rather than pretending.

**Tests behave differently from the CLI.** The Python and R suites *skip with a
printed reason* when their toolchain is absent locally, but CI provides both, so
a genuine regression still goes red. A test that fails red for every contributor
without R installed is worse than no test; a test that silently skips everywhere
is worse in the other direction. Skipping locally while running in CI is the only
configuration that is not worse than no test.

**The capstone deliberately requires full setup.** It is the interop proof, so it
computes all three results live rather than reading committed fixtures. Reading
committed fixtures would reproduce the self-comparison circularity the
2026-07-18 review identified in the TS conformance suite — an assertion 0.3.0
removed for exactly that reason. The capstone must not reintroduce it.

### 6.1 Root scripts

`npm run example` is referenced in the README's documented output block
(`README.md:59-67`) and is **left unchanged**. Add alongside it:

```
example:cl-ts          example:cl-py          example:cl-r          example:cl-crosscheck
```

---

## 7. Known traps, to be encoded as comments at each site

- **`createJudgmentChain` returns an accidental thenable.** `Workflow.then` is a
  step builder, so `await createJudgmentChain(...)` hangs forever with no error
  and no timeout. Assign synchronously. Comment at every construction site.
- `selectionsToDoc(...)` returns a wrapper — the document is `.doc`. `intents` is
  required and must have length `ages.length - 1`.
- **`docToResult` does not exist** (zero repo-wide hits). Reading a result
  document back is `parseDocument(raw)`, cast to `MethodResultDoc`, read
  `.result.totals`.
- `noUncheckedIndexedAccess` is enabled, so the
  `.averages.find(a => a.spec.key === "all-wtd")` pick needs an undefined guard.
- **Origin labels must be year strings in both directions.** `triangleToDoc`
  throws `BAD_INTERCHANGE` on labels that are neither annual nor quarterly, and
  chainladder-python regenerates origin labels from period start dates, so
  `"1".."10"` would not survive the Python hop.
- Canonical JSON treats an `undefined` value as present. Delete the key; do not
  assign `undefined`.
- `@mastra/core` and `zod` are **peer** dependencies of `@actuarial-ts/agents`.
  Each example adds them to its own `devDependencies`. No example has ever
  depended on the agents package — this is first-of-its-kind wiring.
- Mastra's default storage is in-memory, so a suspended chain dies with the
  process. State this in each example's docblock rather than letting a reader
  assume durability.

---

## 8. Testing

Mirrors `examples/reserve-review/test/example.test.ts`: the exported no-arg
function is called **once** above the `it` blocks, one assertion per `it`, prose
titles.

Each shore example asserts:

| assertion | value |
|---|---|
| ultimate, to the dollar | `53_038_946` |
| unpaid, to the dollar | `18_680_856` |
| ledger judgment entries | `3` |
| ledger entries carry the context-set `actorIdentity` | true |
| disclosure contains ASOP 41 Section 5 | true |
| tenant-less call returns a fail-closed envelope | fail-closed error code, body never ran |

The published figures reuse the repo's existing Mack (1993) anchor rather than
introducing a new one.

The capstone asserts, per pairing:

- `verdict === "agree"`;
- all three result documents carry the same `appliesTo.triangleIntegrity`;
- **`coverage.central.comparedCells > 0`** — the 0.3.0 report records what was
  actually examined precisely so that "agreed on everything the profile asked
  about" is distinguishable from "agreed on what happened to be present." An
  `agree` assertion without a coverage assertion would repeat the weakness the
  review found in the pre-0.3.0 referee.

---

## 9. Explicit exclusions

- **The divergence explainer.** It requires a genuine `disagree` verdict, which
  for a plain chain ladder means hand-perturbing a result document —
  manufacturing a fake disagreement to demonstrate a real feature. In a set whose
  value proposition is verifiability, that reads badly.
- **MCP.** `packages/agents/src/mcp.ts` is exported but was not scouted, and the
  2026-07-18 review found its boot self-test covers only a single tool
  (`mcp.ts:203-219`). Not a foundation for onboarding material until fixed.
- **`promoteStudy`.** Building a valid `StudyDoc` requires four interchange
  helpers in exact order with matching integrity tags; one wrong tag fails at
  Gate 1 with `BAD_INTERCHANGE`. Too much ceremony for a simple chain ladder, and
  it would triplicate.
- **A live LLM on the default path.** `createReservingAdvisor` is not constructed.
  Deferred to a possible follow-up; see section 10.

---

## 10. Deferred

- An env-gated (`RUN_AGENT=1`) tail constructing `createReservingAdvisor` and
  running one real `.stream()` turn plus `runToolSelectionEvals`. Considered and
  deferred to keep the spine modest; the structural seams (`ToolStreamingAgent`
  is a bare `stream` method) mean this can be added later without redesign.
- Graduating the subprocess helper from the example into `packages/agents`.

---

## 11. The 0.3.0 remediation — landed; what this spec inherits

The remediation this section originally tracked has shipped as 0.3.0
(43 findings triaged: 32 valid, 10 partial, 1 refuted). What matters here:

- **The referee pattern to imitate exists now.** `reserve-review`'s referee is
  a genuine intent replay via `docToSelections(..., { strictness: "refuse" })`
  — copy that pattern, not the pre-0.3.0 no-op.
- **The math fixes landed with the anchors intact.** Mack's cross-covariance is
  pairwise, ODP φ counts only contributing cells, and Taylor & Ashe's
  2,447,095 is bit-identical — the §8 assertions hold on 0.3.0.
- **The interchange package restructured internally** (`src/referee/`,
  `src/convert/`, `src/schemas/`). Public exports are unchanged; examples
  import from the package root and are unaffected.
- **Finding 2.4 (the integrity tag does not cover `kind`) was NOT changed** —
  `SEMANTIC_BODY_KEYS` still maps both result kinds to `["result"]`, verified
  at 0.3.0. This does not affect these examples (every document here is a
  `method-result`), but the capstone must not be sold as proving anything the
  tag does not cover.
- **`parseCsv` now returns `{ rows, warnings }`** (breaking). Irrelevant here —
  the examples use a grid literal, not CSV — noted so nobody "helpfully" adds
  CSV ingestion against the old shape.

---

## 12. Questions resolved during spec review

Verified against the source on 2026-07-18 and re-verified against 0.3.0 on
2026-07-19; recorded so the implementation plan does not re-litigate them.

1. **Does the judgment chain's ledger feed `generateDisclosure` directly?**
   **Yes, no adapter.** `packages/agents/src/judgment.ts:161` types
   `JudgmentChainOutcome.ledger` as `AssumptionLedger`, commented "Ready for
   @actuarial-ts/compliance generateDisclosure".
   `generateDisclosure` takes a single `DisclosureInput`.
   The seam exists and is deliberate; it has simply never been exercised.
2. **Which sidecar method for the Python example?** `Chainladder`, not
   `MackChainladder`. `interop/sidecar/methods.py:376-391` shows the
   `Chainladder` path authoring through the shared `_author_method_result` with
   `convention_profile="deterministic-cl"` — the same profile the TypeScript
   `runChainLadder` produces. That pairing is what makes the referee comparable.
   `mack1993-vw` is reserved for volume-weighted all-period fits with Mack sigma
   and no exclusions (`methods.py:394-407`), which is a different example.
   (`methods.py` is untouched by 0.3.0; line references remain valid.)
3. **`triangleFromGrid` exists** at `packages/core/src/triangle.ts:220`.
4. **`callRemoteMethod` signature** is
   `(options: RemoteMethodCallOptions, body: Record<string, unknown>, signal?: AbortSignal)`
   with a 60s default timeout (`packages/agents/src/remote.ts:170-176`).

### Still open

1. Exact `resumeData` shape per gate — to be read off `createJudgmentChain`'s
   types during planning, not guessed.
2. Whether `interop/sidecar/methods.py`'s SE-less Mack note (`methods.py:14-18`)
   has any bearing on a plain `Chainladder` request. It should not, but confirm.
