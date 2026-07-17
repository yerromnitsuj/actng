# Publishing @actuarial-ts to npm

The packages are pack-ready; publishing needs credentials only the founder
holds. One-time setup, then one command per release.

## One-time setup

1. Create the free `actuarial-ts` organization on npmjs.com (the scope must
   exist before a scoped publish): https://www.npmjs.com/org/create
   — as of 2026-07-17 `@actuarial-ts/core` returned 404 on the registry
   (name unclaimed).
2. `npm login` on this machine (`npm whoami` should print your username).

## Release

From the repo root (order matters: consumers after dependencies):

```bash
npm run build            # fresh dist for every package
npm test                 # 520+ tests must be green
npm publish --access public -w @actuarial-ts/core
npm publish --access public -w @actuarial-ts/data
npm publish --access public -w @actuarial-ts/compliance
npm publish --access public -w @actuarial-ts/agents
```

Note: npm publishes dependency ranges AS WRITTEN (verified by unpacking a
real tarball on 2026-07-17 — a `"*"` survives into the manifest), so the
inter-package dependencies are pinned to `^0.1.0` in the package.json
files. Bump those ranges together with the versions on each release.

## After publishing

- Tag the release: `git tag v0.1.0 && git push origin v0.1.0`.
- Consider `npm deprecate`-proofing nothing and enabling 2FA for publish
  on the org.
