# Upstream drafts

These are **DRAFTS for the founder to review and send** — correspondence with
the maintainers of the two upstream reserving engines the
`actuarial-interchange` format bridges. **None has been sent.** Sending is a
deliberate founder action, and the in-repo path references in each draft must
be swapped for public URLs first.

Two kinds live here, and they carry different weight.

## Overtures (an offer; upstream owes us nothing)

- **`chainladder-python-proposal.md`** — a GitHub-issue-ready proposal for
  native interchange read/write support in chainladder-python, hooked to their
  existing `to_json`/`read_json` precedent and issue #474's
  DataFrame-interchange appetite.
- **`r-chainladder-note.md`** — a shorter, respectful note to the R
  ChainLadder maintainer covering the interchange recipes and the `est.sigma`
  auto-fallback / `CLFMdelta` feasibility honesty findings.

Both are framed as complementary-not-competitive and depend on no upstream
acceptance. Before sending the chainladder-python proposal, note that
`actuarial-interchange` is **not on PyPI**: the draft says "installable from
source, PyPI publication pending", and that must stay true or be made true.

## Defect report (a bug they would want to know about)

- **`chainladder-python-bootstrap-determinism.md`** — `BootstrapODPSample` is
  not reproducible under a fixed `random_state`: identical seeded calls in one
  process fork, roughly 13% of the time, into exactly two outcomes. Carries a
  self-contained ~10-line reproduction and the hypotheses already ruled out
  (dependency drift, CI image, cross-machine CPU, sparse array backend, and —
  partially implicated — BLAS/OpenMP thread pinning, which makes the raw
  engine call deterministic but not the full pipeline), plus the
  identity-hashing lead.

This one is not an overture. A seeded bootstrap that does not reproduce is a
real defect in a library we hold ourselves against, so reporting it is a
contribution rather than a request. It deliberately proposes no patch: we did
not want to guess inside internals we do not maintain, and our own need is met
by classifying such results `witnessed` and disclosing the measured
instability — see `docs/interop/reproducibility.md`.
