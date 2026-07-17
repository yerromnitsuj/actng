# Convention map: actuarial-ts ⇄ chainladder-python ⇄ R ChainLadder

The practitioner's translation table for the actuarial-interchange spec
(v1). NORMATIVE per the spec's Section 11: the intent semantics and
alignment requirements here are part of the interchange contract; the
conformance suite (`interop/conformance/`) is their enforcement. Facts are
source-verified against chainladder-python 0.9.2 master and R ChainLadder
CRAN docs (transcriptions: `docs/research/interop/`).

## Development-factor averages

| interchange intent | actuarial-ts | chainladder-python `Development` | R ChainLadder |
|---|---|---|---|
| `volume-weighted` (all periods) | `all-wtd` | `average="volume", n_periods=-1` | `MackChainLadder(alpha=1)`; `ata()$vwtd` |
| `volume-weighted` (n periods) | `5-wtd`/`3-wtd` (annual, n∈{5,3}); otherwise value-only | `average="volume", n_periods=n` | weights window (approximate) |
| `simple` | `all-str`/`5-str`/`3-str` | `average="simple"` | `alpha=0` |
| `regression` (through origin) | value-only (not in the menu) | `average="regression"` | `alpha=2` |
| `geometric` | `geo-all` | value-only: `average="geometric"` raises KeyError in 0.9.2 (verified) | manual |
| `medial` (excludeHigh/Low trims) | `med-5x1` for {5,1,1}; others value-only | approx: `drop_high`, `drop_low`, `n_periods` | manual |
| `judgmental` / `external` values | typed selection vector | `DevelopmentConstant(patterns={ageMonths: ldf}, style="ldf")` | `CLFMdelta(Triangle, selected)` → per-period `delta` |

`windowOriginPeriods` counts origin periods in the TRIANGLE'S OWN cadence
(quarters on a quarterly triangle).

## The R alpha/delta trap (do not fall in)

`MackChainLadder(alpha)`: **alpha=1 volume-weighted, alpha=0 simple
average, alpha=2 regression of C_{k+1} on C_k.** The lower-level
`chainladder(delta)` uses the OPPOSITE-feeling scale with
**alpha = 2 − delta**. Adapters must never conflate the two
parameterizations. (Our own first spec draft got this wrong; the
adversarial review caught it. Respect the trap.)

## Sigma / standard-error conventions (`mack1993-vw` profile)

| engine | required setting | default you must override |
|---|---|---|
| actuarial-ts `runMack` | (native) Mack sigma + Mack last-column extrapolation | — |
| chainladder-python | `Development(sigma_interpolation="mack")` | default is `"log-linear"` |
| R ChainLadder | `MackChainLadder(est.sigma="Mack")` | default is `"log-linear"`, AND it silently falls back to "Mack" on poor fit — record `effectiveParameters` |

## Tails

| interchange intent | actuarial-ts | chainladder-python | R ChainLadder |
|---|---|---|---|
| fitted `exponential-decay` | `exponentialDecay` | `TailCurve(curve="exponential")` | `tail=TRUE` (log-linear; approximate) |
| fitted `inverse-power` | `inversePower` | `TailCurve(curve="inverse_power")` | manual |
| judgmental value | tail value + rationale | `TailConstant` | `tail=<value>` |

## Injection honesty

- chainladder-python `DevelopmentConstant` is exact and always feasible
  but carries **no sigmas**: Mack on top of it is SE-less (warned or
  refused per strictness; never silently approximated).
- R `CLFMdelta` can FAIL to find a feasible delta for legitimate
  selections (`foundSolution` flag per element); a failed injection is
  `not-comparable` to the referee, never agreement.

## Known cross-engine deltas (expected, documented, not bugs)

- ODP bootstrap: chainladder-python implements Shapland with hat-matrix
  residual adjustment; actuarial-ts implements England-Verrall with the
  sqrt(n/(n−p)) factor. Distribution-level agreement only, with a
  profile-documented expected delta.
- chainladder-python's `Triangle.to_json()` fills missing cells with 0 —
  fine for its own persistence, forbidden as interchange (null ≠ zero).
- chainladder-python's long-frame CONSTRUCTOR converts explicit 0.0 cells
  to NaN via a sparse intermediate (zero → missing, the reverse
  corruption); the Python bridge restores observed zeros post-construction.
- `Development(average="geometric")` raises KeyError in 0.9.2 — geometric
  intents are value-only on that engine.
- Drop semantics differ subtly (`drop_high` ranks link ratios per column;
  medial trims are per-window) — hence `medial` maps as approximate.
