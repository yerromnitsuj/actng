# Versioning and stability

Package releases, interchange documents, diagnostic replay streams and adapter
generator stamps have distinct version meanings. They do not advance together.

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
section 11). Readers accept same-major documents and preserve unknown minor
fields. Additive fields within an existing kind may remain on the current
minor, but a new document kind or new required semantic body increments the
wire minor: `diagnostic-definition` therefore introduced `1.1.0`. Changing
existing alignment requirements
or replay capabilities is a spec major with a dual-read window.

The frozen conformance corpus is the compatibility statement for the wire
format; its update policy lives in `interop/conformance/README.md` and a
package version bump is never grounds for regenerating it.

## Diagnostic replay stream (`diagnostic-replay/1`)

SDK 0.7.0 introduced a separate streamed archive in the compliance package.
Its framing version is the integer `1`, described in the
[replay reference](docs/reference/diagnostic-replay-stream.md). This is not a
new interchange document kind, a `BundleDoc`, or interchange wire version 2.
The stream reader rejects unknown framing versions; interchange's same-major
forwarding rules do not apply to this independent format.

## Python and R adapter generators

The Python adapter and R recipes use generator version `0.2.0` and write
interchange `1.1.0`. These adapter versions are independent of the five npm
packages. An npm-only release does not republish Python/R adapters, change
their generator stamps or add a Python/R implementation of the replay stream.
Python installation is from the source checkout; R remains source-able recipes.
See [Python setup](interop/python/README.md) and [R setup](tools/interop/README.md).

## Version-bound diagnostic evidence

Diagnostic run manifests include the executing SDK package versions. Changing
those stamps legitimately changes the run fingerprint and its run/result
binding, even when the numerical result is identical. The compact and eager
paths preserve exact normalized identity bytes for equivalent runs under the
same SDK version; this is not a promise that an archive's full identity remains
unchanged across SDK upgrades. Framing compatibility alone does not establish
cross-version replay compatibility. Retain the recorded SDK version with
archived evidence and follow the verifier's actual compatibility contract.

Historical fixture stamps record the versions that authored those fixtures.
Do not update them, their canonical bytes or their expected tags as routine
release bookkeeping.
