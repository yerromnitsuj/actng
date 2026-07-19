# Note for the R ChainLadder maintainer

> **Status: DRAFT for founder review — NOT sent.** A short, respectful
> note intended for Markus Gesmann (maintainer of the CRAN `ChainLadder`
> package, `mages/ChainLadder`). The founder reviews and sends it; nothing
> here has been posted. Path references point at the actuarial-ts
> repository; substitute public URLs
> (https://github.com/yerromnitsuj/actng/blob/main/...) before
> sending.

## Context

Thank you for `ChainLadder` — it's the reference implementation for Mack,
Munich, Clark, and the bootstrap family in R, and we lean on it as a
verification shore.

We've been building a language-neutral interchange format,
`actuarial-interchange`, that moves triangles, factor selections (carried
as **intent**, not just numbers), and method results losslessly between
ecosystems: a TypeScript SDK (actuarial-ts, a governed system of record),
chainladder-python (the analysis lab), and R ChainLadder. The framing is
complementary, not competitive — R stays the lab; the interchange is just
the seam that lets a user move a study out of a notebook without anything
being silently re-typed or re-rounded.

The R shore ships as sourced **recipes** first (a package only if usage
warrants):

- `tools/interop/actuarialInterchange.R` — a JCS (RFC 8785) serializer +
  FNV-1a hash, TriangleDoc ⇄ matrix conversion with explicit start dates
  and null (NA) preservation, `ata()`-based selection export, and
  `MackChainLadder` component extraction into an interchange result
  document.
- `tools/interop/conformance.R` — reproduces the committed `mack1993-vw`
  fixtures (Taylor/Ashe, RAA, Mack's mortgage triangle) with
  `MackChainLadder(alpha=1, est.sigma="Mack")` pinned, and checks against
  the same frozen expectations the actuarial-ts and chainladder-python
  runners are held to.

## Two findings worth sharing

Both are about **honesty channels** in your API that we found genuinely
useful — this is appreciation with a small discoverability suggestion, not
a bug report.

1. **`est.sigma` log-linear → Mack auto-fallback.** `MackChainLadder`
   silently switches `est.sigma` from `"log-linear"` to `"Mack"` when the
   log-linear regression looks inappropriate (p-value > 0.05). That's a
   sound defensive default — but it means a caller who requested
   `"log-linear"` can get `"Mack"` back with no signal, and a
   reproducibility layer can't tell which one actually ran from the fitted
   object alone. Our adapter records the **effective** method as a
   first-class `effectiveParameters` field so a reviewer can see
   requested-vs-actual. Small suggestion: surfacing the effective method on
   the returned object (e.g. an `$est.sigma.used` component) would let
   downstream tools capture it without heuristics.

2. **`CLFMdelta` feasibility (`foundSolution`).** For injecting
   externally-selected age-to-age factors, `CLFMdelta(Triangle, selected)`
   solving for the per-period `delta` — and returning a per-element
   `foundSolution` flag when a selection isn't feasible — is exactly the
   right honesty signal. Not every user-selected factor vector is
   reproducible by the model, and your API says so instead of quietly
   returning something plausible. We surface a failed injection as a
   `not-comparable` warning in the resulting document (never as agreement).
   The only suggestion is documentation-level: making the "infeasible
   selections exist, check `foundSolution`" point more prominent would help
   adapter authors get it right the first time.

## One thing we made sure to get right (the alpha/delta trap)

For the record, because our own first spec draft got it wrong and an
adversarial review caught it: we respect that `MackChainLadder(alpha)` is
`alpha=1` volume-weighted, `alpha=0` simple average, `alpha=2` regression
of C_{k+1} on C_k — and that the lower-level `chainladder(delta)` uses the
opposite-feeling scale with `alpha = 2 − delta`. The recipes stamp `alpha`,
never `delta`, and the convention map
(`docs/interop/convention-map.md`) documents the trap so nobody downstream
conflates the two. Your docs are correct on this; we're just confirming we
read them right.

## Evidence and spec

- **Spec:** `docs/spec/actuarial-interchange.md`
  (rev 2.2). The R profile-alignment requirements and the alpha/delta note
  are normative parts of it.
- **Conformance:** `interop/conformance/` — frozen fixtures the R recipes
  reproduce; cross-engine central estimates agree to 1e-14..1e-16 relative
  between TS and chainladder-python, and Taylor/Ashe ties to a Mack
  standard error of 2,447,094.86 (the same figure R ChainLadder produces).
- **Research transcription:** `docs/research/interop/r-chainladder-api.md`
  — our source-grounded read of the 0.2.21 API the recipes target.

No ask beyond your time to read it, and no dependency on your side. If
CRAN packaging of an R interchange adapter ever seems worthwhile, we'd
welcome your guidance on doing it the ChainLadder way.

---

*Draft prepared for the actuarial-ts maintainer to review and send. Links
resolve within the actuarial-ts repository; substitute public URLs before
posting.*
