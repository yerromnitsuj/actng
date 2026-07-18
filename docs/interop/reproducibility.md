# Reproducibility classes

A seed is not a guarantee. This document explains what the interchange format
promises for each kind of result, why the distinction exists, and the measured
evidence behind it.

## The three classes

| Class | Promise | Where |
|---|---|---|
| **deterministic** | Same inputs produce the same bytes, forever, on any machine. | Every `method-result` document. Implied by the kind — the field is not written. |
| **seeded-reproducible** | Stochastic, but re-running with the same seed reproduces the document byte-for-byte. | `@actuarial-ts/core`'s own stochastic layer. |
| **witnessed** | The engine is **not** byte-reproducible even under a fixed seed. The document is a tamper-evident record of what that engine produced on that run. | Foreign-engine stochastic results, e.g. `clpy:BootstrapODPSample`. |

Stochastic documents carry the class in `result.reproducibility`. An absent
value means unstated (a document written before the field existed) — treat it
as unknown, never as a guarantee.

## Why this exists

`@actuarial-ts/core` obeys a purity rule: no clock reads, no ambient
randomness, stochastic methods take an explicit seed. That makes its own
results genuinely reproducible, and `packages/core/test/odpBootstrap.test.ts`
pins it — two runs at the same seed are asserted equal on mean, standard
deviation, **and the full sample array**.

We cannot extend that guarantee to an engine we do not control, and it turns
out we must not: chainladder-python's bootstrap does not honour it.

## The measurement

`chainladder==0.9.2`, `BootstrapODPSample(n_sims=250, random_state=42)`, on
one machine, in one process, Python 3.12 / numpy 2.4.6 / scipy 1.18.0 /
scikit-learn 1.9.0, AMD EPYC 7763:

- **Identical seeded calls return different samples.** Repeating the same
  request through the sidecar produced exactly **two** distinct outcomes,
  appearing sporadically — a binary fork, not continuous floating-point noise.
- The corresponding assertion (`test_identical_seeded_calls_are_byte_identical`)
  failed roughly 4 times in 5 at default settings.

Hypotheses tested and **refuted**:

| Hypothesis | Result |
|---|---|
| Dependency drift | Refuted — green and red CI runs installed byte-identical versions. |
| Runner image change | Refuted — identical image provisioner version. |
| Cross-machine CPU/SIMD variance | Refuted — reproduces within a single process on one machine. |
| BLAS/OpenMP thread count | Refuted for the sidecar path. **But** pinning `OMP_NUM_THREADS=1` *does* make a raw `BootstrapODPSample` on `load_sample("genins")` deterministic (6/6 identical vs 2 outcomes unpinned) — so there are two independent sources and pinning kills only one. |
| chainladder sparse array backend | Refuted — forcing `ARRAY_BACKEND=numpy` still forks. |

Leading remaining hypothesis, untested: identity-based ordering inside
chainladder (iterating a `set`/`dict` of non-string objects, which hash by
`id()`, so order shifts with memory layout). That matches the signature —
single-threaded, sporadic, exactly two orderings. `PYTHONHASHSEED` would not
address it, since that only randomises `str`/`bytes` hashing.

A reproduction lives on the `ci/bootstrap-determinism-probe` branch.

## What the sidecar does about it

It still **requires** a seed. An unseeded run is not even attributable, and the
sidecar will not emit a distribution it cannot say how to re-request.

What changed is the claim attached to it. The sidecar no longer implies that a
seed buys reproducibility. Instead it **self-witnesses**: it runs the identical
seeded request more than once, compares, and writes the answer onto the
document.

```json
"reproducibility": "witnessed",
"stability": { "repeats": 2, "byteIdentical": false, "maxRelativeDeviation": 0.0021 }
```

Instability is therefore *measured and disclosed at run time*, rather than
lying dormant until something downstream fails to reproduce a number.

Set `parameters.stability_repeats = 1` to skip the extra run when compute cost
outweighs the disclosure; the result is still classed `witnessed`, just with no
stability evidence attached. The default is 2 — honesty costs one extra run.

## What this means for a reviewer

A `witnessed` result is still legitimate ASOP No. 56 evidence. It supports an
**attestation** — this engine, this version, this seed, this output, recorded
tamper-evidently — rather than a **replay** that a reviewer can regenerate. The
distinction matters when relying on the number, so the format states it instead
of leaving the reader to assume.

Cross-engine agreement on a witnessed result is assessed distributionally, not
byte-wise, by **`crosscheckStochastic`**. `crosscheck` — the deterministic
referee — refuses a stochastic document and points at it, because applying a
deterministic tolerance to two Monte Carlo samples reports ordinary sampling
noise as disagreement.

`crosscheckStochastic` derives its tolerance from sampling theory rather than
declaring a constant: at n simulations the relative MC standard error is
`CV/sqrt(n)` on the mean and `1/sqrt(2n)` on the sd, two independent runs
differ by `sqrt(2)` times those, and the bound is 4 sigma of that by default.
More simulations therefore bind tighter, automatically.

It also adapts to the class: two results that BOTH claim `seeded-reproducible`
at the SAME seed are asserting byte-reproducibility, so the Monte Carlo
allowance is withheld and they must agree exactly. The allowance is for
genuinely independent draws, not a blanket loosening.

Agreement between witnessed results is an ordinary `agree` verdict carrying a
warning that the comparison was distributional and that re-running will not
reproduce the numbers. (It is NOT `verified-by-value` — that verdict means the
engines replayed the same values instead of recomputing, which is the opposite
of what two independent bootstraps did.)

## Governance

`promoteStudy` surfaces every witnessed supporting result at the rationale
gate, with its stability self-check, before the actuary's attestation is
written to the assumption ledger. Promotion is not blocked — a witnessed result
can be perfectly adequate support — but the attestation has to be informed
rather than nominal.

## Reporting it upstream

A ready-to-send bug report for `casact/chainladder-python` is drafted at
`docs/interop/upstream/chainladder-python-bootstrap-determinism.md`.
