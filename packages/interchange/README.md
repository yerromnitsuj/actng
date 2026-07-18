# @actuarial-ts/interchange

The `actuarial-interchange` format (spec v1) for the actuarial-ts SDK:
language-neutral, versioned documents that carry **data, intent, results,
and governance** between actuarial-ts, chainladder-python, and R
ChainLadder — plus the deterministic cross-implementation referee.

## Install

```sh
npm install @actuarial-ts/interchange
```

ESM, Node >= 20. Depends on `@actuarial-ts/core` (>= 0.2.0 — it provides the
`canonicalJson`/`fnv1a64` this package canonicalizes and stamps with) and
`zod`.

- **Document kinds**: `triangle`, `selection`, `method-result`,
  `stochastic-result`, `study`, `bundle`, `crosscheck-report` — zod
  schemas with inferred types, mechanically emitted to JSON Schema under
  `schema/interchange/1.0/` (committed; a drift test fails the build if
  the emitted schemas and the committed files diverge).
- **Canonicalization** is RFC 8785 (JCS) via `@actuarial-ts/core`'s
  `canonicalJson`; the committed cross-language vector suite
  (`schema/interchange/1.0/jcs-vectors.json`) is part of the spec.
- **Integrity tags** cover the semantic body only —
  `fnv1a64(canonicalJson(<kind-named object>))` — never the envelope, so
  a re-export by another adapter changes the envelope, not the tag. Tags
  detect ACCIDENTAL divergence; they are not a security control.
- **Selections travel as intent + values** with a normative coherence
  rule: computable intents must recompute to the stated value within
  1e-9 relative, verified on import (warn or refuse via a strictness
  flag; refusal is `INCOHERENT_SELECTION`). Values are authoritative only
  for `judgmental`/`external` intents, whose rationale is required.
- **Converters**: `triangleToDoc`/`docToTriangle`,
  `selectionsToDoc`/`docToSelections` (intent ↔ the standard averages
  menu), `resultToDoc` (chainLadder, mack, bornhuetterFerguson,
  benktander; Cape Cod, Clark, Munich and the stochastic layer are not yet
  converted and `resultToDoc` throws for them), and
  `parseDocument` (version-checked, integrity-verified,
  warning-channeled).
- **The referee**: `crosscheck({ a, b, tolerance?, selection?, createdAt })`
  compares two `method-result` documents by appliesTo tags and convention
  profile, computes per-origin and total relative deviations, applies
  requested-vs-effective downgrades, and returns a `crosscheck-report`
  with verdict `agree | disagree | not-comparable | verified-by-value`.
  Convention profiles (`deterministic-cl`, `mack1993-vw`) are shipped as
  data, including each engine's pinned alignment parameters.

Version handling (spec 3.5): wrong-major documents throw
`ReservingError("UNSUPPORTED_VERSION")`; same-major unknown minor fields
are accepted and preserved (schemas are passthrough), and
`governance`/`extensions` round-trip opaquely.

Everything is pure and browser-safe: no clock reads (`createdAt` is
caller-supplied), no randomness, no node builtins. Depends on
`@actuarial-ts/core` and `zod` only; `zod-to-json-schema` is a build-time
devDependency used by `npm run emit-schema` (which builds first, then
regenerates the committed JSON Schemas).

This package is designed to support the actuary's compliance with the
ASOPs; cross-implementation agreement supports, but does not by itself
constitute, the model validation contemplated by ASOP No. 56.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
