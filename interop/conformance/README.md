# Cross-engine conformance suite (interop Phase A)

The executable evidence that the actuarial-interchange format means the same
thing on every shore (spec sections 10 and 13, Phase A). One set of frozen
fixture documents; three independent runners — actuarial-ts (vitest),
chainladder-python (pytest) and R ChainLadder (Rscript) — parse the SAME
files, recompute natively, and are held to the convention profiles'
tolerances. The committed
fixtures plus these tests are the public compatibility statement.

## Layout

```
interop/conformance/
├── generate-fixtures.mts      authors the frozen fixture documents (tsx)
├── ts/
│   ├── fixtures.ts            fixture definitions + the ONE authoring path
│   └── conformance.test.ts    TS runner (vitest suite)
├── py/
│   └── test_conformance.py    Python runner (pytest)
└── fixtures/<name>/           committed, FROZEN
    ├── triangle.json          TriangleDoc
    ├── selection.json         volume-weighted-all SelectionDoc
    ├── deterministic-cl.json  TS runChainLadder MethodResultDoc
    ├── mack1993-vw.json       TS runMack MethodResultDoc
    ├── expectations.json      TS-engine totals + integrity tags + tolerances
    ├── misaligned-mack-loglinear.json   (taylor-ashe only; see below)
    ├── clpy-deterministic-cl.json       (taylor-ashe only; see below)
    └── clpy-mack1993-vw.json            (taylor-ashe only; see below)
```

## The fixtures

Three published triangles, sourced FROM `packages/core`'s test fixtures
(never re-transcribed), authored deterministically (fixed `createdAt`,
no clock reads):

| name | data | origins |
|---|---|---|
| `taylor-ashe` | Mack (1993) Table 1 — Taylor/Ashe (the GenIns triangle) | 2001–2010 (synthetic) |
| `raa` | Mack (1994) — RAA Automatic Facultative GL | 1981–1990 (real) |
| `mortgage` | Mack (1993) Table 4 — Sanders mortgage guarantee | 2001–2009 (synthetic) |

Origin labels are YEARS, not Mack's 1..10 row numbers: chainladder-python
regenerates origin labels from period start dates, so cross-engine origin
identity requires labels every engine derives identically. Taylor/Ashe
uses 2001–2010 — chainladder-python's own labelling of this exact data
(its `genins` sample); the mortgage triangle follows the same rule.

`misaligned-mack-loglinear.json` is authored by the PYTHON runner: a
chainladder-python Mack run on Taylor/Ashe with the DEFAULT
`sigma_interpolation="log-linear"` while deliberately claiming the
`mack1993-vw` profile (which requires `"mack"`). The TS referee must
return verdict `disagree` on it — the cross-language closure of spec 13
Phase A acceptance 3. Central estimates agree (sigma does not touch the
projection); the standard errors betray the misalignment (max per-origin
deviation ≈ 4.9% against the 0.5% profile tolerance).

`clpy-deterministic-cl.json` and `clpy-mack1993-vw.json` are the ALIGNED
mirror, also authored by the PYTHON runner with the same
author-once-then-freeze pattern: the committed selection replayed
natively (`deterministic-cl`) and a Mack run with
`sigma_interpolation="mack"` pinned (`mack1993-vw`), on the same
committed Taylor/Ashe triangle. The TS referee must return verdict
`agree` on each against the TS-authored result of the same profile —
cross-engine agreement demonstrated on committed bytes, not on a transient
run. Evidence rather than proof: the corpus exercises one of the seven
averaging intents across two convention profiles, so it establishes that
these engines agree on these documents, not that they agree in general.

## Running

TS shore (included in the interchange package's vitest run, and therefore
in root `npm test`, via `packages/interchange/test/interopConformance.test.ts`):

```bash
npm test -w @actuarial-ts/interchange
```

Python shore (needs the `.venv-interop` environment — Python 3.12 with
`chainladder==0.9.2` pinned and `actuarial-interchange` installed
editable; CI runs this shore on every push touching `interop/**` via the "Python interop conformance" workflow (`.github/workflows/py-conformance.yml`)):

```bash
npm run test:py
# equivalently: .venv-interop/bin/pytest interop/python/tests interop/conformance/py interop/sidecar/tests -q
```

## What each runner proves

TS (`ts/conformance.test.ts`), per fixture:

- every committed document parses with an intact integrity tag;
- the committed bytes equal a fresh authoring run (the freeze check);
- `docToTriangle` round-trips null-for-null against the core fixture and
  re-authoring reproduces the committed tag;
- the selection intent replays coherently (`all-wtd`, strict) and the
  chain ladder recomputed from the REPLAYED selections reproduces the
  committed result document exactly;
- the referee returns `agree` on TS-vs-TS for both profiles, and
  `disagree` against the committed misaligned Python run.

Python (`py/test_conformance.py`), per fixture:

- parse → re-serialize preserves the committed integrity tag (the
  TS → Python → TS tag-stability acceptance), and the full chainladder
  bridge round trip (doc → `cl.Triangle` → doc) reproduces the tag with
  every null preserved;
- the selection replays natively as `Development(average="volume")` and
  passes the coherence rule strictly;
- `Chainladder` totals and per-origin estimates match the TS engine
  within 1e-6 relative (`deterministic-cl`);
- `MackChainladder` with `sigma_interpolation="mack"` pinned matches TS
  standard errors within 0.5% relative and central estimates within 1e-6
  (`mack1993-vw`); a fully developed origin's SE is `null`-vs-`0` by
  documented convention (chainladder omits, actuarial-ts reports 0);
- the misaligned document is reproducible and genuinely misaligned on
  this engine before the TS referee ever sees it;
- the aligned Python-authored documents (`clpy-*.json`) are reproducible
  (semantic freeze at 1e-9) and carry the committed appliesTo tags and
  convention profiles the TS referee needs to return `agree`.

## Update policy: the fixtures are FROZEN

The committed fixture documents are frozen expectations — the compatibility
statement other parties can hold us to. Do NOT regenerate them casually.

Regeneration (`npx tsx interop/conformance/generate-fixtures.mts`, plus a
pytest run to re-author the Python-authored documents — misaligned and
`clpy-*` — if their inputs changed) is
legitimate ONLY when a spec or convention change alters what the documents
must contain — a new spec minor, a profile change (spec MAJOR), or a
deliberate authoring-convention change — and the commit message must say
why. The TS runner enforces this: it fails whenever the committed bytes
stop matching a fresh authoring run, so silent drift (in either the
fixtures or the authoring code) cannot pass CI.

### Authoring provenance is PINNED, not tracked

`CREATED_AT`, `CORPUS_GENERATOR`, `CORPUS_ENGINE` and
`WRAPPED_BUNDLE_SDK_VERSIONS` (all in `ts/fixtures.ts`) state **what
authored this corpus**. They are deliberately NOT re-derived from the
packages' current versions — the same rule that makes `createdAt`
caller-supplied instead of a clock read.

This matters more than it looks. The engine stamp sits INSIDE the
integrity-hashed body, so if these tracked the live build, every npm
release would move every integrity tag, the wrapped bundle's inner payload
and its outer hash — breaking the freeze on a routine version bump, for a
reason that says nothing whatsoever about conformance.

**A package version bump is therefore NEVER grounds for regeneration.**
If you are reading stamps that say an older version than the published
packages, that is the policy working correctly, not drift. Do not
"fix" it.

Live SDK runs are unaffected and still carry truthful provenance:
`resultToDoc` / `triangleToDoc` / `selectionsToDoc` (and `createBundle`,
via its optional `generator` override) stamp the real current version by
default. Only this historical corpus is pinned.

Bump these constants only as part of a deliberate, documented regeneration
under the triggers above.
