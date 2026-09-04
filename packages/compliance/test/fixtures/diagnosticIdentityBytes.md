# Reviewed diagnostic identity byte vectors

`diagnosticIdentityBytes.json` pins the exact RFC 8785 JSON text and tagged
FNV-1a value at all nine diagnostic identity layers. It uses the sourced,
explicitly empty expected-grid run in `diagnosticIdentityRun.ts`: four reported
claims, twenty origin-static earned vehicle years, and a quarter alias that
normalizes to `2025-Q1`. Artifact bytes are the one-byte values 1 and 2.

Seven tags were already fixed in the full-workflow provenance regression before
the byte fixtures were added. The final contract audit corrected the normalized
run-manifest review key from `identityBody` to the specified `body`, intentionally
changing only the run and run/result-binding tags. That exact change was applied
to the reviewed bytes and independently hashed before the implementation fix;
the regression was observed failing against the previous implementation. No
actuarial result or other identity payload changed. Review checked the §15 envelope
and kind at every layer, source-location null fields, canonical array order,
the absent filter versus explicitly empty grid, calculation-only scope, the
review identity projection, artifact digests and scopes, recorded engine
versions, and the two-tag run/result binding.

| Layer | Canonical UTF-8 bytes |
|---|---:|
| Formula | 398 |
| Calculation | 1,057 |
| Definition | 2,074 |
| Preparation | 1,972 |
| Expected-cell grid | 79 |
| Review | 1,192 |
| Run manifest | 2,971 |
| Result | 4,593 |
| Run/result binding | 157 |

`diagnosticIdentityBytes.test.ts` compares the complete strings, verifies that
the fixtures are canonical, and checks both runtime tags and independently
hashed fixture bytes. There is no test option that rewrites this file. A
future intentional identity or engine-version change must explain and review
the affected bytes and tags; updating a digest alone is insufficient.
