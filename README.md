# actuarial-ts

**An open-source, TypeScript-native P&C actuarial SDK with an agent-native
architecture — plus ActNG, the AI-native reserving workbench built on it.**

Four Apache-2.0 packages under the `@actuarial-ts` scope:

| Package | What it is |
|---|---|
| [`@actuarial-ts/core`](packages/core) | Pure, zero-dependency reserving engine: triangles, development factors, chain ladder, Mack, Bornhuetter-Ferguson, Benktander, Cape Cod (with Gluck decay), Expected Claims, frequency-severity, Berquist-Sherman, Munich chain ladder, Clark growth curves, tails, capping/ILF, trend and on-leveling, ULAE, discounting, salvage/subro, diagnostics — and a seeded stochastic layer: ODP bootstrap, Merz-Wuthrich one-year risk. |
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

const markdown = generateDisclosure({ metadata, methods, ledger, dataReview: review, sdkVersion: "0.1.0", generatedAt });
```

## ActNG: the reference workbench

This repo also ships **ActNG**, a complete AI-native reserving workbench
built on all four packages — import claim-level loss runs, build triangles,
select factors interactively, run the full method suite with Mack standard
errors and diagnostics, blend a 12-method selection-of-ultimates exhibit,
and work alongside an embedded advisor agent that analyzes the data and can
change the workspace through the exact same service layer as the UI.

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env   # advisor (everything else works without it)
npm install && npm run dev                    # seeds demo data; API :4600, web :5175
```

See [docs/workbench.md](docs/workbench.md) for the full walkthrough, design
decisions, loss-run format, and validation notes.

## Repository layout

| Path | What it is |
|---|---|
| `packages/*` | The four published SDK packages (each with its own README). |
| `apps/server` | ActNG API: Express 5, SQLite, the Mastra advisor (consumes all four packages). |
| `apps/web` | ActNG UI: Vite + React 19 + Tailwind v4. |
| `docs/research/` | Primary-source transcriptions behind the published-value test fixtures. |
| `docs/superpowers/` | The SDK's spec and phased implementation plans. |

## Development

```bash
npm install        # workspace install; builds SDK dist via the root prepare
npm test           # every package + the server (450+ tests)
npm run typecheck  # all workspaces
npm run build      # SDK packages + the web app
```

The published-value validation tests are the contract: reserving math
changes are wrong until they pass.

## License

Apache-2.0. Copyright 2026 Justin Morrey.
