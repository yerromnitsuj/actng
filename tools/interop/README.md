# R ChainLadder interchange recipes

Source-able R functions implementing actuarial-interchange wire 1.1 on the R
ChainLadder shore, plus a conformance runner. The release environment is
machine-readable in `r-environment.json`: R 4.4.3, ChainLadder 0.2.21,
jsonlite 2.0.0, and the compatible Deriv 4.2.0 transitive pin. The Deriv pin
prevents a later CRAN release from silently raising the contract's minimum R
version. The installer resolves dependency metadata from each exact source
archive and accepts a dependency only when it can actually be loaded, avoiding
false cache hits from stale or incompatible library entries.

## Setup (once)

```bash
"${ACTUARIAL_TS_RSCRIPT:-Rscript}" tools/interop/test-r-environment.R
"${ACTUARIAL_TS_RSCRIPT:-Rscript}" tools/interop/install-r-environment.R
"${ACTUARIAL_TS_RSCRIPT:-Rscript}" tools/interop/check-r-environment.R
```

## Run

```bash
# the adapter self-tests its JCS serializer against the shared vector suite
"${ACTUARIAL_TS_RSCRIPT:-Rscript}" tools/interop/actuarialInterchange.R

# the cross-engine conformance runner (verdict table)
"${ACTUARIAL_TS_RSCRIPT:-Rscript}" tools/interop/conformance.R

# the CLI entrypoint: triangle document in, Mack fit, method-result document out
Rscript tools/interop/run-mack.R \
  --in <triangle.json> --out <result.json> --created-at <iso8601> \
  [--selection <selection.json>] [--profile <name>]

# the CLI entrypoint for a SUPPLIED-factor projection (no fit object)
Rscript tools/interop/run-cl.R \
  --in <triangle.json> --ldfs <comma-separated-values> --out <result.json> \
  --created-at <iso8601> [--tail <factor>]
```

`run-mack.R`'s `--created-at` is mandatory by design: the assemble/extract
helpers default it to a hardcoded literal, and a document that always claims
the same date breaks byte-determinism for everyone downstream. `--profile`
defaults to `deterministic-cl` (the trilogy's comparison profile — alpha=1,
all periods, no tail IS that chain ladder point estimate); pass
`mack1993-vw` for SE-focused runs.

`--selection` is honored, never merely stamped — the fit is computed UNDER the
selection or the stamp is withheld (Finding #1), matching the Python sidecar's
replay-before-stamp discipline:

- **volume-weighted match** — a selection whose factors equal the alpha=1
  fit's own volume-weighted factors reuses today's exact path; the
  `appliesTo.selectionIntegrity` stamp is now VERIFIED true and the output
  bytes are unchanged (the committed taylor-ashe pipeline is byte-identical).
- **feasible non-VW** — `ats_mack_selection_plan` calls `CLFMdelta` to solve a
  per-period delta, refits `MackChainLadder(alpha = 2 - delta)`, stamps the
  tag, and echoes the per-period alpha vector in `parameters.alpha` (a JSON
  array; a scalar alpha still serializes as a number).
- **not-injectable** — an infeasible selection (`CLFMdelta` finds no delta), or
  one carrying a `tail` factor `MackChainLadder(tail = FALSE)` cannot consume,
  runs the fit WITHOUT the selection: `selectionIntegrity` is null and
  `warnings` say the rows are not-comparable. An explicit `--profile
  mack1993-vw` on an injected non-VW fit likewise downgrades to profile-less
  with a warning rather than overclaiming.
- **wrong triangle** — a selection whose `appliesTo.triangleIntegrity` does not
  match `--in` is a hard error (input-linkage mismatch).

`tools/interop/test-run-mack-selection.R` drives all four outcomes through the
CLI end-to-end (run: `Rscript tools/interop/test-run-mack-selection.R`).

`run-cl.R` projects ultimates from per-column loss development factors an
actuary (or the interactive example app) SUPPLIES directly, rather than
factors `MackChainLadder` derives from the triangle itself — the honest way
for R to serve a caller whose selection is arbitrary. `--ldfs` takes exactly
one comma-separated value per development interval (`ncol(triangle) - 1`);
`--tail` defaults to `1` (no development beyond the triangle's last observed
age). For each origin: `latest` = the last non-null diagonal value; `ultimate
= latest × (product of the supplied LDFs from that origin's latest age
onward) × tail`; `unpaid = ultimate - latest`. The written document's
`method` is `"r:ldf-projection"` (contrast `run-mack.R`'s
`"rcl:MackChainLadder"`) and carries no `standardError` — there is no fit
object to derive one from. Verified against the taylor-ashe fixture: the
committed `selection.json`'s nine `"volume-weighted"` factors with `--tail 1`
reproduce `deterministic-cl.json`'s totals (ultimate 53,038,946 / unpaid
18,680,856) to within float precision.

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
- `ats_selection_to_delta` / `ats_mack_selection_plan` — `CLFMdelta` injection
  with `foundSolution` honesty (a failed injection surfaces as a not-comparable
  warning, never silent). Respects the alpha/delta trap: `MackChainLadder(alpha=1)`
  is volume-weighted; the reported `delta` is never conflated with it.
  `ats_mack_selection_plan` is the triage `run-mack.R` calls to choose
  vw-match / injected / not-injectable for a supplied `--selection`.
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
