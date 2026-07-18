# Proposal: native `actuarial-interchange` read/write in chainladder-python

> **Status: DRAFT for founder review — NOT sent.** This is a
> GitHub-issue-ready draft to open on `casact/chainladder-python`. The
> founder reviews and sends it; nothing here has been posted. Path
> references below point at the actuarial-ts repository (currently
> local-only); replace them with public URLs before sending.

## TL;DR

We built a language-neutral interchange format — `actuarial-interchange`
— that moves triangles, factor selections (as **intent**, not just
values), method results, and governance artifacts between ecosystems
losslessly. There is already a published Python adapter
(`pip install actuarial-interchange[chainladder]`) that bridges
chainladder-python today against 0.9.x — **no changes to your library are
required for it to work.** This issue asks a narrower question: would you
be open to first-party `to_ats()` / `read_ats()` support, mirroring your
existing `Triangle.to_json()` / `read_json()`, so your users get the
round-trip without a third-party dependency? We're also flagging three
concrete data-fidelity edges we hit and worked around, in case you'd want
to address them upstream regardless of the interchange question.

## Who we are, and why this is complementary, not competitive

chainladder-python is the better analysis laboratory. It has the depth,
the estimators, the pandas-native ergonomics, and the community.
actuarial-ts is a governed system of record: it's built around
disclosure, an assumption ledger, human-gated promotion of notebook work
into ledgered judgments, and ASOP-support documentation. Most
sophisticated users want both — explore in a chainladder-python notebook,
then decide and document in a governed workflow. The interchange format
is the seam that lets a user move between the two **losslessly**, so the
lab stays the lab and nothing is silently re-typed or re-rounded on the
way out.

We are explicitly **not** trying to reimplement your methods or compete on
analysis. Non-goals we hold ourselves to: no forked method
implementations to force agreement (conventions are mapped and documented,
never silently reconciled); no dependence on your acceptance (the adapter
works against today's published API). Success does not require any
ecosystem goodwill — this issue is an offer, not a prerequisite.

## The hook: you already ship an interchange, and you already want more

Two things make us think first-party support might fit your roadmap:

1. **`Triangle.to_json()` / `cl.read_json()` already exist** and
   round-trip a Triangle through a documented-in-code schema (metadata +
   pandas `orient="split"` data + recursive `sub_tris`/`dfs`). You already
   treat a portable JSON representation as a first-class concern.
2. **Issue #474 (DataFrame-interchange-protocol / polars support)** shows
   appetite for standard interchange surfaces beyond pandas. A
   cross-ecosystem actuarial interchange is the same instinct one layer up
   — portable *reserving documents*, not just portable frames.

## What we propose (scoped minimally)

The smallest useful thing: a thin pair mirroring your existing JSON I/O.

- `Triangle.to_ats(**opts) -> str` and `cl.read_ats(blob) -> Triangle`,
  built on the paths you already have (`to_frame(keepdims=True,
  origin_as_datetime=True)` out; the long-DataFrame constructor in), plus
  the spec's canonicalization (RFC 8785 / JCS) and null-preservation
  rules.
- Optionally, a `chainladder.interchange` companion module (or an
  `extras_require` group) rather than a hard dependency, so the core
  library stays lean.

We are happy for our published `actuarial-interchange` package to be the
**reference implementation you wrap or vendor**, or to contribute the
adapter as a PR under your direction — whichever you prefer. If you'd
rather do nothing, that's a complete answer too: our adapter already
covers your users from the outside.

## The evidence this is real and stable

The format is a versioned spec with a committed conformance suite, not a
sketch:

- **Spec:** `docs/superpowers/specs/2026-07-17-actuarial-interchange-design.md`
  (full design, rev 2.2 — built and shipped, Phases A–E). The convention
  map (`docs/interop/convention-map.md`) is the practitioner's translation
  table between actuarial-ts, chainladder-python, and R ChainLadder, and
  is part of the normative contract.
- **Conformance:** `interop/conformance/` — three published triangles
  (Taylor/Ashe / GenIns, RAA, Mack's mortgage-guarantee) × two convention
  profiles (`deterministic-cl`, `mack1993-vw`), with two independent
  runners (actuarial-ts under vitest, chainladder-python under pytest)
  parsing the **same frozen fixture bytes** and recomputing natively.
  Cross-engine central estimates and totals agree to **1e-14..1e-16
  relative** (well inside the 1e-6 profile tolerance); Taylor/Ashe totals
  tie to Mack's published unpaid of 18,680,855.61 and a Mack standard
  error of 2,447,094.86; integrity tags survive TS→Python→TS
  byte-identically. A deliberately misaligned run (`log-linear` sigma
  while claiming the `mack1993-vw` profile, which requires `"mack"`) is
  correctly flagged `disagree` at a 4.90% SE deviation vs the 0.5%
  tolerance — the format detects convention drift, it doesn't paper over
  it.

The `mack1993-vw` profile pins the settings that make your Mack run match
Mack (1993): `Development(average="volume", n_periods=-1,
sigma_interpolation="mack")` — your default `sigma_interpolation`
`"log-linear"` does not match, which is by design on your side; the
interchange just records the requested-vs-effective convention so a
reviewer can see it.

## Three edges we found and worked around (upstream-fixable if you want)

We mention these not as complaints — the workarounds are ours to carry —
but because two of them are silent data-fidelity corruptions that could
bite anyone building on the same paths, and you may prefer to fix them at
the source.

1. **`Triangle.to_json()` fills missing cells with 0
   (`fillna(0)`).** Verified in `core/io.py`: the wire format normalizes
   to incremental + valuation layout and replaces NaN with 0. That's fine
   for cl→cl persistence (`read_json` reverses it via the metadata flags),
   but it destroys the null-vs-zero distinction — an unobserved cell and a
   genuine 0 become indistinguishable. Our adapter therefore never uses
   `to_json()` as the wire format; it goes through `to_frame(keepdims=True)`
   and preserves nulls explicitly.
2. **The long-frame constructor converts explicit `0.0` cells to NaN via a
   sparse intermediate.** The reverse corruption: build a `cl.Triangle`
   from a long DataFrame that contains genuine observed zeros, and they can
   come back as missing. Our bridge restores observed zeros
   post-construction and tests both directions. This one is easy to miss
   because it only surfaces with true-zero observations (common in count
   and salvage triangles).
3. **`Development(average="geometric")` raises `KeyError` in 0.9.2.**
   `"geometric"` appears in the typed signature but isn't in the
   `{"regression":0,"volume":1,"simple":2}` exponent map, so it isn't
   handled on the averaging path. We demote geometric selections to
   value-only on your engine with a warning rather than pretend a native
   replay happened.

If any of these are already fixed on master past 0.9.2, great — point us at
the commit and we'll narrow our version guard.

## What we are explicitly not asking for

- No method changes, no convention reconciliation, no accuracy claims about
  your engine.
- No hard dependency on `actuarial-interchange` in your core.
- No commitment on your timeline. The adapter ships value to
  actuarial-ts users from day one regardless.

Thanks for chainladder-python — it's the reference the rest of us measure
against. We'd be glad to open a PR, hand over the reference implementation,
or simply keep the bridge on our side; your call.

---

*Draft prepared for the actuarial-ts maintainer to review and send. Links
resolve within the actuarial-ts repository; substitute public URLs before
posting.*
