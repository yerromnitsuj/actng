# Versioning and stability

Two version streams exist and they are deliberately independent:

## Package versions (`@actuarial-ts/*`)

The five packages version **in lockstep** — one number, released together —
because on 0.x, `^0.N.0` means `>=0.N.0 <0.N+1.0`: a package left behind
refuses its siblings' next minor and pulls a duplicate copy of core into the
consumer's tree, breaking `instanceof` on shared error classes. This has been
demonstrated, not theorized. A package with no source changes is republished
at the new number to hold the lockstep, and its changelog entry says so.

While pre-1.0:

- a **minor** bump (0.2 → 0.3) may break APIs; breaking changes are marked
  `!` in commit subjects and consolidated in the CHANGELOG entry;
- a **patch** bump never breaks APIs;
- published-value behavior (the reserving math) never changes silently at ANY
  bump: a change that moves a pinned published value is wrong until proven
  otherwise, and if genuinely right it ships with the primary-source citation
  that justifies it.

## The wire format (`interchangeVersion`)

The interchange spec versions separately (`docs/spec/actuarial-interchange.md`,
section 11). Readers accept same-major and ignore unknown minor fields, so
ADDITIVE optional fields do not bump the wire version — reproducibility
classes landed inside 1.0 this way. Changing what a document MUST contain, or
how it must be read, is a spec minor; changing existing alignment requirements
or replay capabilities is a spec major with a dual-read window.

The frozen conformance corpus is the compatibility statement for the wire
format; its update policy lives in `interop/conformance/README.md` and a
package version bump is never grounds for regenerating it.
