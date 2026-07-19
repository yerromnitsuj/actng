# Publishing @actuarial-ts to npm

**Release record:** v0.3.0 shipped 2026-07-19 — all five packages published
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
`actuarial-ts` org; 2FA in auth-and-writes mode prompts for an OTP per
publish.

## Release (per version)

From the repo root, with the new version X.Y.Z:

1. Bump `version` in all FIVE `packages/*/package.json` (core, interchange,
   data, compliance, agents) AND the inter-package dependency ranges
   (`^X.Y.Z`) together — npm publishes dependency ranges AS WRITTEN
   (verified by unpacking a real tarball: a `"*"` survives into the
   manifest), so the ranges must be real. The dependency graph:
   interchange -> core; data -> core; compliance -> core, interchange;
   agents -> core, compliance, interchange (+ Mastra/zod peers).
2. Update CHANGELOG.md.

```bash
npm run build            # fresh dist for every package
npm test                 # full workspace suite must be green
npm publish -w @actuarial-ts/core
npm publish -w @actuarial-ts/interchange
npm publish -w @actuarial-ts/data
npm publish -w @actuarial-ts/compliance
npm publish -w @actuarial-ts/agents
```

Order matters: dependencies before consumers. interchange publishes right
after core (it depends on core only), and BEFORE compliance and agents
(which depend on interchange) — publishing compliance first would leave a
consumer's `npm install` resolving an unpublished dependency.
`publishConfig.access: "public"` is set in every manifest, so no
`--access` flag is needed; each package's `prepack` rebuilds its dist.

## After publishing

- Verify: `npm view @actuarial-ts/core version` and a scratch-project
  install + import smoke test.
- Tag: `git tag vX.Y.Z && git push origin vX.Y.Z` (v0.1.0, v0.2.0 and v0.3.0: done).
- Org hygiene (one-time, if not yet done): require 2FA for publishing in
  the org settings on npmjs.com.
