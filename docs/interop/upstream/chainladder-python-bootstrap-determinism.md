# Bug report: `BootstrapODPSample` is not reproducible under a fixed `random_state`

> **Status: DRAFT for founder review — NOT sent.** A GitHub-issue-ready draft
> to open on `casact/chainladder-python`. The founder reviews and sends it;
> nothing here has been posted. Substitute public URLs
> (https://github.com/yerromnitsuj/actng/blob/main/...) for the repo-relative
> paths before sending.
>
> Suggested title: **`BootstrapODPSample` returns different samples for
> identical `random_state` within a single process**

---

## Summary

`BootstrapODPSample(n_sims=..., random_state=N)` does not always produce the
same sample for the same `random_state`. Two identical calls **in one process,
on one machine** can return different distributions, and what comes back is
always one of exactly two outcomes rather than a spread.

On our sample sizes: 2 of 15 successive identical requests returned the
minority outcome, and a paired-call assertion (which fails whenever the two
calls in a pair disagree) failed 4 of 5 attempts. Those are small samples and
they measure different things, so please read them as "this happens readily and
is easy to reproduce" rather than as a rate characterising your library.

This matters beyond flaky tests: a seed is the mechanism users rely on to make
a stochastic reserve estimate auditable. If a colleague cannot reproduce a
bootstrap reserve range from the seed recorded in a report, the seed is not
doing the job it appears to do.

## Environment

- `chainladder==0.9.2`
- Python 3.12, `numpy==2.4.6`, `scipy==1.18.0`, `scikit-learn==1.9.0`,
  `pandas==2.3.3`
- Linux, AMD EPYC 7763. We have only observed this on that one machine; it
  reproduces within a single process there, so we do not believe it is
  hardware-specific, but we have not tested a second CPU.

## Reproduction

```python
import numpy as np, chainladder as cl

tri = cl.load_sample("genins")

def once():
    sims = cl.BootstrapODPSample(n_sims=250, random_state=42).fit_transform(tri)
    fit = cl.Chainladder().fit(sims)
    return float(np.asarray(fit.ultimate_.values)[:, 0, :, 0].sum())

vals = [once() for _ in range(6)]
print(vals)
print("distinct:", len(set(vals)))
```

Observed (same process, same seed):

```
call 1: 13346387489.003113
call 2: 13338118123.662247
call 3: 13346387489.003113
call 4: 13338118123.662247
call 5: 13338118123.662247
call 6: 13338118123.662247
distinct: 2   ->  NON-DETERMINISTIC
```

Expected: `distinct: 1`.

## What we ruled out

We chased this for a while before concluding it was upstream, so to save you
the same work — none of these is the cause:

| Hypothesis | Result |
|---|---|
| Dependency version drift | Ruled out — passing and failing runs install byte-identical versions. |
| CI image change | Ruled out — identical image provisioner version. |
| Cross-machine CPU/SIMD differences | Ruled out — reproduces within a single process on one machine. |
| BLAS/OpenMP thread count | **Partially implicated.** Setting `OMP_NUM_THREADS=OPENBLAS_NUM_THREADS=MKL_NUM_THREADS=1` makes the snippet above deterministic (6/6 identical). But it does **not** fix a longer pipeline that builds the triangle from a document and applies a `Development` replay before the bootstrap — that still forks. So there appear to be at least two independent sources. |
| `ARRAY_BACKEND` (sparse vs dense) | Ruled out — forcing `cl.options.set_option("ARRAY_BACKEND", "numpy")` still forks. |

## A hypothesis you may be able to confirm faster than we can

The signature — single-threaded, sporadic, and exactly **two** distinct
outcomes rather than continuous drift — looks like an ordering that depends on
object identity. Iterating a `set` or `dict` keyed by objects that fall back to
`id()`-based hashing gives an order that shifts with memory layout, which would
produce precisely this: a small number of stable outcomes, selected
unpredictably per call.

Consistent with that, `PYTHONHASHSEED` does **not** affect it — that only
randomises `str`/`bytes` hashing, not identity hashing.

We have not confirmed this; you know the residual-resampling internals far
better than we do.

## Why we are not proposing a patch

We did not want to guess at a fix inside code we do not maintain, and our own
need is met by treating the result as non-reproducible and disclosing it
(details below) rather than by pinning your internals.

If it is useful, we are happy to test a candidate fix against our conformance
corpus. To be precise about what that would and would not prove: the corpus is
a set of frozen interchange documents that three implementations each parse and
recompute natively — chainladder-python, our own TypeScript engine, and R's
ChainLadder. Each is compared against the committed documents rather than
directly against the others, so it would tell you whether a patched
chainladder-python still agrees with the frozen expectations, not whether it
agrees with R.

## What we did on our side (in case it is useful framing)

Rather than assume seeded means reproducible, our interchange format now
distinguishes `seeded-reproducible` from `witnessed`, and our
`chainladder-python` bootstrap results are stamped `witnessed`: the document
records what the engine produced on that run and carries a stability
self-check (run twice, compare, disclose the deviation). Our own pure-Python
and TypeScript stochastic layers remain `seeded-reproducible`.

That is a workaround for the disclosure problem, not for the underlying
non-determinism — which is why we are reporting it.

Thanks for chainladder-python; it is the reference implementation we check
ourselves against, and this is the only reproducibility issue we have hit.
