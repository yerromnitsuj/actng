# actuarial-ts

**An open-source, TypeScript-native P&C actuarial SDK with an agent-native
architecture, and the cross-ecosystem interchange format that lets it trade
work losslessly with R and Python.**

Five Apache-2.0 packages under the `@actuarial-ts` scope:

| Package | What it is |
|---|---|
| [`@actuarial-ts/core`](packages/core) | Pure, zero-dependency reserving engine: triangles, development factors, chain ladder, Mack, Bornhuetter-Ferguson, Benktander, Cape Cod (with Gluck decay), Expected Claims, frequency-severity, Berquist-Sherman, Munich chain ladder, Clark growth curves, tails, capping/ILF, trend and on-leveling, ULAE, discounting, salvage/subro, diagnostics — and a seeded stochastic layer: ODP bootstrap, Merz-Wuthrich one-year risk. |
| [`@actuarial-ts/interchange`](packages/interchange) | The actuarial-interchange spec v1 in TypeScript: envelope + integrity stamping, versioned parsing, triangle/selection/result/study/bundle/crosscheck schemas, core converters, and the cross-engine **referee** (`crosscheck`) with executable convention profiles. |
| [`@actuarial-ts/data`](packages/data) | Ingestion + data quality: loss-run CSV, long-format triangles, and the ASOP No. 23 data review report. |
| [`@actuarial-ts/compliance`](packages/compliance) | The layer no calculator ships: estimate metadata, an assumption ledger separating machine defaults from judgment, ASOP No. 41 disclosure generation, ASOP No. 56 model cards, reproducibility bundles, actual-vs-expected roll-forward. |
| [`@actuarial-ts/agents`](packages/agents) | Mastra agent toolkit: typed actuarial tools with a hard tenant seam, human-gated judgment workflows that write the compliance ledger, a reserving advisor factory, and a golden-prompt eval harness. |

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
are **designed to support the actuary's compliance** with ASOP Nos. 43, 23,
41, 56, 25, 36, 20, 21, 38, and 13; responsibility for compliance remains
with the credentialed actuary.

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

const markdown = generateDisclosure({ metadata, methods, ledger, dataReview: review, sdkVersion: "0.2.0", generatedAt });
```

## Try it

A complete reserve review — triangle, factor selection, chain ladder, Mack
standard error, interchange documents, the referee, and a verified
reproducibility bundle — runs in one file:

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

Those reproduce Mack (1993)'s published unpaid and R ChainLadder's published
standard error for the Taylor & Ashe triangle. The source is
[`examples/reserve-review`](examples/reserve-review/src/main.ts), and it is
covered by tests so it cannot quietly rot.

**ActNG**, the AI-native reserving workbench this SDK grew out of, now lives in
its own repository and consumes the published packages like any other
consumer.

## Repository layout

| Path | What it is |
|---|---|
| `packages/*` | The five published SDK packages (each with its own README). |
| `examples/` | A runnable, tested reserve review across all five packages. |
| `interop/` | The Python shore (`interop/python`), the frozen cross-engine conformance corpus, and the chainladder-python FastAPI compute sidecar (the live second engine). |
| `tools/interop/` | The R shore: ChainLadder interchange recipes and the conformance verdict runner. |
| `schema/interchange/` | Versioned JSON Schema + JCS test vectors that every shore reproduces. |
| `docs/interop/` | Convention map, MCP notebook recipe, and upstream contribution drafts. |
| `docs/research/` | Primary-source transcriptions behind the published-value test fixtures. |
| `docs/superpowers/` | The SDK's spec and phased implementation plans. |

## Development

```bash
npm install        # workspace install; builds SDK dist via the root prepare
npm test           # every package + the example (720 tests)
npm run typecheck  # all workspaces
npm run build      # the SDK packages
npm run example    # the end-to-end reserve review
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

All three independently reproduce Mack (1993)'s published reserve and R
ChainLadder's published standard error of 2,447,095, agreeing at roughly
1e-14 to 1e-16. A chainladder-python FastAPI sidecar runs as a live second
engine, refereed against the TypeScript shore in CI on every push.

The **referee** (`crosscheck`) is the point: it compares two engines' results
under an executable convention profile and returns `agree`, `disagree`,
`not-comparable`, or `verified-by-value` — turning two implementations into a
verification asset rather than an argument. Convention differences are
mapped and documented in [`docs/interop/convention-map.md`](docs/interop/convention-map.md),
never silently reconciled.

## License

Apache-2.0. Copyright 2026 Justin Morrey.
