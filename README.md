# actuarial-ts

**An open-source, TypeScript-native P&C actuarial SDK with an agent-native
architecture, and the cross-ecosystem interchange format that lets it trade
work losslessly with R and Python.**

Five Apache-2.0 packages under the `@actuarial-ts` scope:

| Package | What it is |
|---|---|
| [`@actuarial-ts/core`](packages/core) | Pure math: reserving, trends/limits/discounting, seeded stochastic methods, and compiled definition-driven diagnostics with separate formula, calculation, and presentation layers. |
| [`@actuarial-ts/interchange`](packages/interchange) | Wire `1.1.0`: typed triangle/selection/result/study/bundle/crosscheck/diagnostic-definition documents, converters, integrity checks, and the cross-engine referee. |
| [`@actuarial-ts/data`](packages/data) | Ingestion, atomic diagnostic preparation, complete input audit, declarative ASOP No. 23-oriented review, and two-gate execution. |
| [`@actuarial-ts/compliance`](packages/compliance) | Estimate metadata, assumption ledger, disclosures/model cards, verified diagnostic run/artifact provenance, and reproducibility bundles. |
| [`@actuarial-ts/agents`](packages/agents) | Mastra toolkit with a hard tenant seam, exact failure envelopes, human-gated judgment, and a trusted-catalog diagnostic selection tool. |

## Why this exists

Actuarial open source is a Python/R world of calculators. actuarial-ts is
TypeScript-native (runs in Node, browsers, and edge runtimes), **validated
against the published literature** (the test suite reproduces Mack 1993/1999,
Mack 2000, Gluck 1997, Mack 1994's Appendix G/H tests, England 2002,
Merz-Wuthrich 2008, Clark 2003, and Quarg-Mack 2004 from the primary
sources), **agent-native by construction** (every operation is a typed tool;
judgment points are human-gated workflow steps), and **compliance-oriented**:
an agent-assisted analysis produces its ASOP 41 documentation as a side
effect of running.

The honest claim, once: the ASB does not approve software. These packages
are **designed to support the actuary's compliance** with ASOP Nos. 43, 23, 41, 56, 20, and 21;
responsibility for compliance remains with the credentialed actuary. That list
is the set the source actually supports — it was longer, and the extra
standards had no implementation behind them.

## Quick taste

```ts
import { buildTriangles, computeDevelopmentFactors, runChainLadder, runMack, runOdpBootstrap } from "@actuarial-ts/core";
import { reviewClaimData } from "@actuarial-ts/data";
import { createLedger, recordAssumption, generateDisclosure } from "@actuarial-ts/compliance";

const review = reviewClaimData(claims, { asOfDate: "2025-12-31" }); // ASOP 23 checks
const { paid } = buildTriangles(claims, { cadence: "annual", asOfDate: "2025-12-31" });
const selected = computeDevelopmentFactors(paid).averages.find((a) => a.spec.key === "all-wtd")!.values;
const cl = runChainLadder(paid, { selected, tailFactor: 1.02 });
const mack = runMack(paid, { selected, tailFactor: 1.02 });
const dist = runOdpBootstrap(paid, { nSims: 10_000, seed: 42 }); // seeded, reproducible

const markdown = generateDisclosure({ metadata, methods, ledger, dataReview: review, sdkVersion: "0.6.1", generatedAt });
```

## Try it

A complete reserve review — triangle, factor selection, chain ladder, Mack
standard error, interchange documents, a REPLAY of the recorded selection
intent refereed against the original, an ASOP 23 data review, an assumption
ledger, the ASOP 41 disclosure, and a verified reproducibility bundle — runs in
one file:

```bash
npm install
npm run example
```

```
  ultimate        53,038,946
  unpaid          18,680,856
  standard error  2,447,095
  referee         agree
  bundle verified true
```

The unpaid rounds to Mack (1993)'s published 18,681 thousand; 18,680,856 is
the engine result to the dollar, not the paper's printed precision. The
standard error matches R ChainLadder's reported value for Taylor & Ashe.
The referee runs over a genuine
replay: the factors are re-derived from the document's recorded "all-wtd"
intent, not recomputed from the same in-memory values. The source is
[`examples/reserve-review`](examples/reserve-review/src/main.ts), and it is
covered by tests so it cannot quietly rot.

A second tested example runs over 1,012,839 annual claim valuations from a
real French motor insurer, paired with insurance-year exposure. It retains
duplicate identifiers, paid reversals, negative inferred case, recovery-basis
selection, and annual date precision as review findings and disclosures:

```bash
npm run example:real-world
```

The routine path is offline and reads compact derivatives. The full pinned
source can be checksum-verified and regenerated with the opt-in instructions in
[`examples/real-world-loss-run`](examples/real-world-loss-run/README.md).

Its generalized diagnostic vertical slice uses six reusable formulas, 22
gross/net instances, atomic data review, portable definition documents, and
verified run provenance. See the generated [formula catalog](docs/reference/diagnostic-formulas.md)
and the [0.6 migration guide](docs/migrations/0.6-generalized-diagnostics.md).

**ActNG**, the AI-native reserving workbench this SDK grew out of, now lives in
its own repository and consumes the published packages like any other
consumer.

## Repository layout

| Path | What it is |
|---|---|
| `packages/*` | The five published SDK packages (each with its own README). |
| `examples/` | `reserve-review` is the tested deterministic four-package reserving consumer (agent tools require host context); `real-world-loss-run` is the four-package diagnostic vertical slice. Agents is covered by its trusted-catalog suite and the packed all-five consumer. The chain-ladder trilogy and cross-engine capstone remain tested. |
| `interop/` | The Python shore (`interop/python`), the frozen cross-engine conformance corpus, and the chainladder-python FastAPI compute sidecar (the live second engine). |
| `tools/interop/` | The R shore: ChainLadder interchange recipes and the conformance verdict runner. |
| `schema/interchange/` | Versioned JSON Schema + JCS test vectors that every shore reproduces. |
| `docs/interop/` | Convention map, MCP notebook recipe, and upstream contribution drafts. |
| `docs/research/` | Research transcriptions for five of the primary sources; the rest are documented in their fixture files. |
| `docs/superpowers/` | The SDK's spec and phased implementation plans. |

## Development

```bash
npm install        # workspace install; builds SDK dist via the root prepare
npm test           # every package + the examples
npm run typecheck  # all workspaces
npm run build      # the SDK packages
npm run example    # the end-to-end reserve review
npm run example:determinism # two-process real-world diagnostic byte check
```

The published-value validation tests are the contract: reserving math
changes are wrong until they pass.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full setup (including the
optional Python and R shores) and the four rules that are load-bearing.
Security issues: [SECURITY.md](SECURITY.md) — please report privately.

## Interoperability: use the best tool for each job

R's ChainLadder and chainladder-python are better analysis laboratories.
This SDK is better at governance — disclosure, an assumption ledger, gated
promotion of exploratory work into ledgered judgments. Most serious users
want both, so the repo ships **actuarial-interchange**: a language-neutral
document format that moves triangles, factor selections (as *intent*, not
just values), method results, and governance artifacts between ecosystems
without silent re-typing or re-rounding.

Three independent shores implement the spec and are held to the same frozen
fixture corpus:

| Shore | Where | Runner |
|---|---|---|
| TypeScript | [`packages/interchange`](packages/interchange) | vitest |
| Python | [`interop/python`](interop/python) | pytest |
| R | [`tools/interop`](tools/interop) | Rscript |

All three independently reproduce Mack (1993)'s published reserve and the
standard error of 2,447,095 — Mack (1993) Table 3 prints 2,447 thousands and R
ChainLadder reports the full figure — agreeing at roughly 1e-14 to 1e-16.
Each shore runs in its own CI workflow (`CI`, `Python interop conformance`,
`R interop conformance`), and a chainladder-python FastAPI sidecar runs as a
live second engine, refereed against the TypeScript shore on every push.

The **referee** (`crosscheck`) is the point: it compares two engines' results
under an executable convention profile and returns `agree`, `disagree`,
`not-comparable`, or `verified-by-value` — turning two implementations into a
verification asset rather than an argument. Convention differences are
mapped and documented in [`docs/interop/convention-map.md`](docs/interop/convention-map.md),
never silently reconciled.

## License

Apache-2.0. Copyright 2026 Justin Morrey.
