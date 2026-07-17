# Publishing @actuarial-ts to npm

**Release record:** v0.1.0 shipped 2026-07-17 — all four packages
(`@actuarial-ts/core`, `data`, `compliance`, `agents`) published to npm,
the `actuarial-ts` org created, and tag `v0.1.0` pushed. Everything below
is the runbook for FUTURE releases.

## Per-machine prerequisite

`npm login` once on the publishing machine (`npm whoami` must answer).
Publishing requires an account with owner/admin rights on the
`actuarial-ts` org; 2FA in auth-and-writes mode prompts for an OTP per
publish.

## Release (per version)

From the repo root, with the new version X.Y.Z:

1. Bump `version` in all four `packages/*/package.json` AND the
   inter-package dependency ranges (`^X.Y.Z`) together — npm publishes
   dependency ranges AS WRITTEN (verified by unpacking a real tarball:
   a `"*"` survives into the manifest), so the ranges must be real.
2. Update CHANGELOG.md.

```bash
npm run build            # fresh dist for every package
npm test                 # full workspace suite must be green
npm publish -w @actuarial-ts/core
npm publish -w @actuarial-ts/data
npm publish -w @actuarial-ts/compliance
npm publish -w @actuarial-ts/agents
```

Order matters: dependencies before consumers. `publishConfig.access:
"public"` is set in every manifest, so no `--access` flag is needed; each
package's `prepack` rebuilds its dist.

## After publishing

- Verify: `npm view @actuarial-ts/core version` and a scratch-project
  install + import smoke test.
- Tag: `git tag vX.Y.Z && git push origin vX.Y.Z` (v0.1.0: done
  2026-07-17).
- Org hygiene (one-time, if not yet done): require 2FA for publishing in
  the org settings on npmjs.com.
