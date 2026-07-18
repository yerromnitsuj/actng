# Three chain-ladder examples — design

**Date:** 2026-07-18
**Status:** Design approved; implementation plan not yet written.
**Scope:** Four new workspaces under `examples/`. No changes to the five published
packages.

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

Three claims in this repo are currently unproven by any executing code. These
examples prove all three as a side effect of existing:

1. **`generateDisclosure` fed by a judgment chain's frozen ledger.** The SDK's
   central pitch — ASOP 41 documentation falling out of a run — is exercised by
   no test. `examples/reserve-review/src/main.ts:157` returns
   `disclosureIncludesLedger: true` as a hardcoded literal.
2. **The R shore actually running.** `tools/interop/README.md:30-33` claims
   ~1e-15 agreement "on the build machine," while
   `docs/superpowers/plans/2026-07-18-interop-phaseE-r-shore.md:7` records that
   Rscript was not installed. No CI job corroborates either. Example 3 settles it.
3. **A genuine cross-engine referee verdict.** The existing example's referee
   compares a pure function to itself (see the 2026-07-18 review). The capstone
   compares three real engines.

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

| id | kind | body |
|---|---|---|
| `get_triangle` | `read` | returns the `TriangleDoc` built at step 4 |
| `compute_chain_ladder` | `read` | **the only thing that differs across the three examples** |
| `record_selection` | `action` | writes the chosen LDFs into the assumption ledger |

All three are built with `defineActuarialTool` and read their tenant via
`tenantOf`. The `kind` discriminator is set honestly even though the SDK does not
currently use it for authorization.

### 3.2 The three judgment gates

Ordered, each suspending for a human decision supplied as `resumeData`:

1. **Averaging basis** — volume-weighted vs straight vs geometric, all-period vs
   n-period. Resume payload selects `all-wtd`.
2. **LDF selection** — accept the computed averages or override per column.
   Resume payload accepts them unchanged.
3. **Tail factor** — resume payload selects `1.0`.

Each gate records to the ledger with `actor: "actuary"` and a rationale, so the
generated disclosure has three genuine judgment entries in ASOP 41 Section 5.

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
`callRemoteMethod` has no such requirement. Since the example wraps the call in
its own `defineActuarialTool` anyway, it gets the tenant seam either way, and
`callRemoteMethod` reads far better in a teaching context.

---

## 5. New code required (R path only)

### 5.1 `tools/interop/run-mack.R` — new, ~40 lines

CLI entrypoint. Today `ats_extract_mack_result` takes a live fit *object* and
`conformance.R` is a hardcoded three-fixture comparison loop that takes no
arguments and never writes a document.

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

### 5.3 `.github/workflows/r-conformance.yml` — new

`r-lib/actions/setup-r`, install `ChainLadder` + `jsonlite`, run `run-mack.R`
against one fixture and then `tools/interop/conformance.R`. A failing comparison
must fail the job.

### 5.4 A toolchain pin — new

`renv.lock`, or at minimum a version assertion at `source()` time. Today the pin
is a prose line in `tools/interop/README.md:4`.

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
committed fixtures would reproduce exactly the circularity the 2026-07-18 review
identified in `interop/conformance/ts/conformance.test.ts:143-164`.

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
| disclosure contains ASOP 41 Section 5 | true |
| tenant-less call returns a fail-closed envelope | `code === "NO_TENANT_CONTEXT"` |

The published figures reuse the repo's existing Mack (1993) anchor rather than
introducing a new one.

The capstone asserts `verdict === "agree"` across all three engines, and that all
three result documents carry the same `appliesTo.triangleIntegrity`.

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

## 11. Dependencies on in-flight work

A concurrent session is remediating the 2026-07-18 review. Two items intersect:

- **Finding 2.1** rewrites `examples/reserve-review`'s referee. These examples
  should follow whatever pattern that fix establishes rather than copying the
  current no-op.
- **Findings 1.1–1.4** change `runChainLadder`/`runMack` internals. The asserted
  ultimate and unpaid are unaffected (plain chain ladder on a tidy triangle), but
  the implementation plan should be written against post-fix `main`.

---

## 12. Questions resolved during spec review

Verified against the source on 2026-07-18; recorded so the implementation plan
does not re-litigate them.

1. **Does the judgment chain's ledger feed `generateDisclosure` directly?**
   **Yes, no adapter.** `packages/agents/src/judgment.ts:142-146` types
   `JudgmentChainOutcome.ledger` as `AssumptionLedger`, commented "Ready for
   @actuarial-ts/compliance generateDisclosure".
   `packages/compliance/src/disclosure.ts:159` takes a single `DisclosureInput`.
   The seam exists and is deliberate; it has simply never been exercised.
2. **Which sidecar method for the Python example?** `Chainladder`, not
   `MackChainladder`. `interop/sidecar/methods.py:376-391` shows the
   `Chainladder` path authoring through the shared `_author_method_result` with
   `convention_profile="deterministic-cl"` — the same profile the TypeScript
   `runChainLadder` produces. That pairing is what makes the referee comparable.
   `mack1993-vw` is reserved for volume-weighted all-period fits with Mack sigma
   and no exclusions (`methods.py:394-407`), which is a different example.
3. **`triangleFromGrid` exists** at `packages/core/src/triangle.ts:220`.
4. **`callRemoteMethod` signature** is
   `(options: RemoteMethodCallOptions, body: Record<string, unknown>, signal?: AbortSignal)`
   with a 60s default timeout (`packages/agents/src/remote.ts:170-176`).

### Still open

1. Exact `resumeData` shape per gate — to be read off `createJudgmentChain`'s
   types during planning, not guessed.
2. Whether `interop/sidecar/methods.py`'s SE-less Mack note (`methods.py:14-18`)
   has any bearing on a plain `Chainladder` request. It should not, but confirm.
