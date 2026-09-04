# Publishing @actuarial-ts to npm

**Release record:** v0.6.0 shipped 2026-09-03 — all five packages published
to npm in dependency order from release-source commit
`a7f1916697f99dbfa30ffbccadec0cc37099e769`, immutable tag `v0.6.0`
pushed, and [GitHub Release](https://github.com/yerromnitsuj/actng/releases/tag/v0.6.0)
created. CI, Python conformance, and R conformance passed on that exact commit,
and the clean all-five registry consumer passed against exact `0.6.0`
packages. Registry metadata was verified at `2026-09-04T05:54:54Z`:

| Package | `latest` | Integrity | Internal dependency ranges | Runtime / peer contract |
|---|---:|---|---|---|
| `@actuarial-ts/core` | `0.6.0` | `sha512-X8frEIsg72cBGFYZTGaU9je6y4B7GkrgJZFg8/mc01sc/IW2fDyTmYAG+Ri5Iz4Dtt64CXUtmusQKtFZwDWGjQ==` | none | Node `>=20` |
| `@actuarial-ts/interchange` | `0.6.0` | `sha512-HJGXoNLlCIEYqUit1FTLOWIx0k4Dnl9X6ViV54myxfV0oFjnuqpqTA+0B3eRQTrGK5ZNZZY7yrjS/V5rZ2oK9A==` | `core ^0.6.0` | Node `>=20`; Zod `^3.25.76` dependency |
| `@actuarial-ts/data` | `0.6.0` | `sha512-t1vdtMUxOjiu7aQ811r6RwH3/YCJEKpf23SNb+xlMxSyzCQHbLsRaJFkdtoaiA7aqLirOpBwBROw+fotJZcM/Q==` | `core ^0.6.0` | Node `>=20`; Zod `^3.25.76` dependency |
| `@actuarial-ts/compliance` | `0.6.0` | `sha512-quggKNtDzE8jfzbSEdulLfTN0NrdUaJbvT7azDSEWu5Wr+7ah9AvVnJCcItj65UoC43AOerU9Ke2yM2DbjaxgA==` | `core ^0.6.0`; `data ^0.6.0`; `interchange ^0.6.0` | Node `>=20` |
| `@actuarial-ts/agents` | `0.6.0` | `sha512-HWJ44jeXojbjPANl7GfbTriac2Wx1xTxaebzrPBSuJH3pbizLaxqzhfv6x8CBFvxBi8WfWlU0c3z8+6GfT9Ubg==` | `core ^0.6.0`; `data ^0.6.0`; `interchange ^0.6.0`; `compliance ^0.6.0` | Node `>=22.13.0`; Mastra core `>=1.51.0 <2`, Mastra MCP `>=1.14.0 <2`, and Zod `^3.25.76` peers |

The version-pinned [formula catalog](https://github.com/yerromnitsuj/actng/blob/v0.6.0/docs/reference/diagnostic-formulas.md)
and [migration guide](https://github.com/yerromnitsuj/actng/blob/v0.6.0/docs/migrations/0.6-generalized-diagnostics.md)
both returned HTTP 200 after the tag became visible. The release-source
[CI](https://github.com/yerromnitsuj/actng/actions/runs/33839779100),
[Python](https://github.com/yerromnitsuj/actng/actions/runs/33839779090), and
[R](https://github.com/yerromnitsuj/actng/actions/runs/33839779082) workflows
are the authoritative hosted verification records.

**Release record:** v0.5.0 shipped 2026-08-31 — all five packages published
to npm in dependency order, tag `v0.5.0` pushed, and GitHub Release created.
The release adds closed-with-pay and open shares of non-CNP claims to the
quarterly casualty diagnostic catalog without changing the original twenty
definitions. The full TypeScript, Python, and R verification matrix passed;
all five tarballs were inspected; and a clean registry install confirmed all
five public imports, one deduplicated core version, 22 metrics in the intended
order, exact `50 / 70` and `20 / 70` calculations, and package version stamps.

**Release record:** v0.4.0 shipped 2026-08-28 — all five packages published
to npm in dependency order, tag `v0.4.0` pushed, and GitHub Release created.
The diagnostics release adds reusable quarterly metrics, aggregate data review,
period helpers, and compliance provenance. CI, Python interop, and R interop
were green; all five tarballs were inspected; and a clean registry install
confirmed working imports, one deduplicated core version, diagnostic calculation,
validated-input semantics, review statuses, and package version stamps.

v0.3.0 shipped 2026-07-19 — all five packages published
to npm, tag `v0.3.0` pushed, GitHub Release created. The review-remediation
release; breaking changes and migrations in the CHANGELOG's 0.3.0 section.
Registry-install smoke test passed (Mack row-order invariance, ODP dof guard,
parseCsv warnings, NaN review failure, tenant seam fail-closed, fail-closed
lint — all verified against the published tarballs).

v0.2.0 shipped 2026-07-18 — all FIVE packages
(`@actuarial-ts/core`, `interchange`, `data`, `compliance`, `agents`)
published to npm and tag `v0.2.0` pushed. `interchange` was new in 0.2.0;
`data` was republished source-unchanged to hold the lockstep (its `^0.1.0`
core range would otherwise have refused core 0.2.0 and pulled a duplicate
core into consumer trees). v0.1.0 shipped 2026-07-17 (four packages; the
`actuarial-ts` org was created then). Everything below is the runbook for
FUTURE releases.

## Per-machine prerequisite

`npm login` once on the publishing machine (`npm whoami` must answer).
Publishing requires an account with owner/admin rights on the
`actuarial-ts` org; auth-and-writes protection can require an interactive
2FA or security-key confirmation for each publish.

## Release (per version)

For `0.6.1` and later, publishing is mechanically bound to the stable local
candidate gate:

```bash
PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run release:gate
```

The command list is defined once in `tools/release/release-commands.json` and
includes the full TypeScript/Python/R suites, all examples, both packed
consumers, the source registry, every diagnostic reconciliation, and a
byte-for-byte rebuild of the real-world source derivatives. A successful run
from a clean commit writes ignored `.release/attestation.json` plus the five
reviewed tarballs, bound to the Git SHA and manifest hashes.

Publish only with:

```bash
PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run release:publish
```

Every package's `prepublishOnly` recreates its packed bytes and refuses before
contacting npm if the attestation is absent, the tree is dirty, the SHA or
manifest changed, the versions disagree, or the tarball hash differs. After
publishing—but before tagging—run
the identical public fixture against the registry with
`node tools/release/smoke-packed-diagnostics.mjs --source=registry --version=X.Y.Z`.
Record the exact release-source SHA and require CI, Python conformance, and R
conformance to pass on that SHA. Historical release records above remain the
record of their own procedures.

From the repo root, with the new version X.Y.Z:

1. Bump `version` in all FIVE `packages/*/package.json` (core, interchange,
   data, compliance, agents) AND the inter-package dependency ranges
   (`^X.Y.Z`) together — npm publishes dependency ranges AS WRITTEN
   (verified by unpacking a real tarball: a `"*"` survives into the
   manifest), so the ranges must be real. The dependency graph:
   interchange -> core; data -> core; compliance -> core, interchange;
   agents -> core, compliance, interchange (+ Mastra/zod peers).
2. Update CHANGELOG.md.

The orchestrator publishes dependencies before consumers. Interchange publishes right
after core (it depends on core only), and BEFORE compliance and agents
(which depend on interchange) — publishing compliance first would leave a
consumer's `npm install` resolving an unpublished dependency.
`publishConfig.access: "public"` is set in every manifest, so no
`--access` flag is needed; each package's `prepack` rebuilds its dist.

## After publishing

- Verify: `npm view @actuarial-ts/core version` and a scratch-project
  install + import smoke test.
- Tag: `git tag vX.Y.Z && git push origin vX.Y.Z` (v0.1.0 through v0.5.0: done).
- Org hygiene (one-time, if not yet done): require 2FA for publishing in
  the org settings on npmjs.com.
