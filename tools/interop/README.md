# R ChainLadder interchange recipes

Source-able R functions implementing the actuarial-interchange spec v1 on
the R ChainLadder shore, plus a conformance runner. Verified against
R 4.6.1 + ChainLadder 0.2.21 + jsonlite 2.0.0.

## Setup (once)

```r
# a local library keeps this off the system R install
dir.create("~/.R-interop-lib", showWarnings = FALSE)
install.packages(c("ChainLadder", "jsonlite"),
                 lib = "~/.R-interop-lib",
                 repos = "https://cloud.r-project.org")
```

## Run

```bash
# the adapter self-tests its JCS serializer against the shared vector suite
Rscript tools/interop/actuarialInterchange.R    # sources clean; ats_test_jcs() = 25/25

# the cross-engine conformance runner (verdict table)
Rscript tools/interop/conformance.R

# the CLI entrypoint: triangle document in, Mack fit, method-result document out
Rscript tools/interop/run-mack.R \
  --in <triangle.json> --out <result.json> --created-at <iso8601> \
  [--selection <selection.json>] [--profile <name>]
```

`run-mack.R`'s `--created-at` is mandatory by design: the assemble/extract
helpers default it to a hardcoded literal, and a document that always claims
the same date breaks byte-determinism for everyone downstream. `--profile`
defaults to `deterministic-cl` (the trilogy's comparison profile — alpha=1,
all periods, no tail IS that chain ladder point estimate); pass
`mack1993-vw` for SE-focused runs.

`conformance.R` reads the committed fixtures under
`interop/conformance/fixtures/`, runs `MackChainLadder(alpha=1,
est.sigma="Mack")`, and compares against the committed `mack1993-vw.json`
at the profile tolerances (central 1e-6, SE 0.5% relative). On the build
machine it reproduced every fixture at **~1e-15 relative deviation — float
identity**, with Taylor/Ashe's Total.Mack.S.E = 2,447,094.86 matching the
published 2,447,095.

## What the adapter provides

- `ats_canonical_json`, `ats_fnv1a64` — the RFC 8785 JCS serializer + the
  integrity hash, reproducing every committed `jcs-vectors.json` vector
  byte-for-byte. Two hard parts solved: the lone-surrogate vector via raw
  WTF-8 byte handling (R strings cannot hold a lone surrogate), and FNV-1a
  via a four-16-bit-limb multiply (R has no unsigned 64-bit int).
- `ats_triangle_to_matrix` / `ats_matrix_to_triangle_doc` — NA (null)
  preservation both ways.
- `ats_selection_to_delta` — `CLFMdelta` injection with `foundSolution`
  honesty (a failed injection surfaces as a not-comparable warning, never
  silent). Respects the alpha/delta trap: `MackChainLadder(alpha=1)` is
  volume-weighted; the reported `delta` is never conflated with it.
- `ats_extract_mack_result` — MethodResultDoc with `effectiveParameters`
  recording the est.sigma actually used (the log-linear->Mack auto-fallback
  is detected and recorded; it does not fire on the well-behaved committed
  triangles, confirming the est.sigma pin is load-bearing).
- `ats_read_document` / `ats_write_document` — envelope + version handling
  (a wrong-major document stops with condition class
  `interchange_version_error`).

## CRAN packaging

Deferred: the recipes are the contract. Package only if usage warrants
(spec 4.3).
