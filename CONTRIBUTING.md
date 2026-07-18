# Contributing

Thanks for looking at this. The project is Apache-2.0 and contributions are
welcome — bug reports especially, since actuarial correctness is the whole
point.

Please read [The rules that are load-bearing](#the-rules-that-are-load-bearing)
before opening a PR that touches methods, fixtures, or wording about ASOPs.
Those four rules are enforced by tests, and a PR that trips one will fail CI.

## What lives here

One repository, three things:

| Path | What it is |
|------|-----------|
| `packages/*` | The **actuarial-ts SDK** — five npm packages: `core`, `interchange`, `data`, `compliance`, `agents` |
| `interop/`, `tools/interop/`, `schema/interchange/` | The **actuarial-interchange** layer — the spec, its three shores (TypeScript, Python, R), the conformance corpus and the chainladder-python sidecar |
| `examples/` | A runnable, **tested** end-to-end reserve review across all five packages — the SDK's in-repo consumer |

## Setup

Node 20 or newer (the repo is developed on 22; if your shell defaults to an
older Node, prefix `PATH` rather than switching globally). npm workspaces — no
other package manager.

```bash
npm install        # runs the ordered `prepare`, which builds the SDK dist in dependency order
npm run build
npm test           # all workspaces with a test script
npm run typecheck
```

`npm install` must build the SDK packages in dependency order (core →
interchange → data → compliance → agents). That is what the root `prepare`
script is for — npm runs workspace `prepare` scripts unordered on a fresh
install, which broke CI once.

To run the end-to-end example:

```bash
npm run example    # triangle -> CL + Mack -> interchange -> referee -> bundle
```

It is covered by tests, so a change that makes the public API awkward breaks it
before a user hits the problem. If you change an exported signature, run it.

### The Python shore (optional, needed for interop work)

```bash
python3 -m venv .venv-interop
.venv-interop/bin/pip install -e interop/python
.venv-interop/bin/pip install -r interop/sidecar/requirements.txt \
                             -r interop/sidecar/requirements-dev.txt
npm run test:py
```

### The R shore (optional, needed for interop work)

```r
dir.create("~/.R-interop-lib", showWarnings = FALSE)
install.packages(c("ChainLadder", "jsonlite"),
                 lib = "~/.R-interop-lib", repos = "https://cloud.r-project.org")
```

```bash
Rscript tools/interop/actuarialInterchange.R   # self-tests the JCS serializer
Rscript tools/interop/conformance.R            # cross-engine verdict table
```

See [`tools/interop/README.md`](tools/interop/README.md).

## The rules that are load-bearing

These four are not style preferences. Tests enforce them.

**1. Published-value tests are the change contract.** Methods are pinned to
values transcribed from primary sources (Mack 1993/1994/1999/2000, Gluck 1997,
England-Verrall 2002, Merz-Wüthrich 2008, Clark 2003, Quarg-Mack 2004), with
the transcriptions committed under `docs/research/`. If your change moves a
published number, it is wrong until proven otherwise — and if it is genuinely
right, the PR must say which source justifies the new value.

**2. The conformance fixtures are FROZEN.** `interop/conformance/fixtures/` is
the public compatibility statement other implementations are held to. Do not
regenerate casually. The full policy, including the only legitimate triggers,
is in [`interop/conformance/README.md`](interop/conformance/README.md).
Note that the corpus deliberately **pins its authoring provenance**
(`CORPUS_GENERATOR` / `CORPUS_ENGINE`, alongside `CREATED_AT`), so an ordinary
version bump never forces a regeneration.

**3. ASOP positioning.** This software is *designed to support* the actuary's
compliance with the applicable ASOPs. It never claims to be "ASOP-approved",
"ASOP-certified", or to guarantee or constitute compliance — the actuary is
responsible for their own work. A test asserts this wording.

**4. Purity.** No clock reads and no ambient randomness in library code.
Timestamps are caller-supplied; stochastic methods take explicit seeds. This is
what makes reproducibility bundles byte-deterministic.

## Scope

**P&C reserving only.** Life, health and pension methods are out of scope by
deliberate decision, not by omission.

## Pull requests

- Keep `npm test` and `npm run typecheck` green. CI runs two workflows: `CI`
  (build, typecheck, test, pack-check all five packages) and
  `Python interop conformance` (the Python shore plus the live cross-engine
  referee against the sidecar).
- Add or update tests with behavior changes. For a new method, that means a
  published-value pin.
- Explain *why* in the commit message, not just what — especially for anything
  touching the interchange spec, the freeze policy, or a convention profile.
- Cross-shore changes: a change to the interchange spec usually needs all three
  shores updated together, or an explicit note about which shore lags and why.

## Reporting a vulnerability

See [SECURITY.md](SECURITY.md). Please do not open a public issue for a
security problem.
