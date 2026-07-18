## What and why

<!-- What changes, and the reasoning. The "why" matters more than the "what". -->

## Checklist

- [ ] `npm test` and `npm run typecheck` pass
- [ ] Tests added or updated for the behavior change

If this PR touches any of the following, please confirm:

- [ ] **Methods / numerics** — no published-value test moved. If one did, the
      description says which primary source justifies the new value.
- [ ] **Conformance fixtures** (`interop/conformance/fixtures/`) — not
      regenerated, or regenerated for one of the triggers the freeze policy in
      `interop/conformance/README.md` allows, with the reason stated here.
      (A version bump is not one of those triggers.)
- [ ] **Interchange spec** — the other shores (Python, R) are updated too, or
      this notes which lags and why.
- [ ] **ASOP wording** — still "designed to support" compliance; nothing claims
      approval, certification, or a guarantee.
- [ ] **Purity** — no clock reads or ambient randomness added to library code.
