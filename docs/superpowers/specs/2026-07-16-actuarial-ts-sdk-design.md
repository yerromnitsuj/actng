# actuarial-ts: an ASOP-compliance-supporting P&C actuarial SDK (design)

Approved by the founder 2026-07-16. Founder decisions of record:

1. **Evolve inside ActNG2** and publish from this repo. The workbench
   (apps/server, apps/web) is the flagship consumer and living proof of the
   API boundary.
   > SUPERSEDED 2026-07-18: the SDK is published, and the workbench was
   > extracted to its own repository — it consumes the packages from npm at
   > `^0.2.0` and is a better proof of the API boundary for it, since it can no
   > longer reach into source. The in-repo proof is now
   > `examples/reserve-review`, which is tested. The decision to evolve the SDK
   > inside this repo stands and succeeded; only the workbench's location
   > changed.
2. **npm scope `@actuarial-ts`**: packages `@actuarial-ts/core`,
   `@actuarial-ts/data`, `@actuarial-ts/compliance`, `@actuarial-ts/agents`.
3. **Apache-2.0, everything open source** including the agent architecture
   and the compliance layer. No monetization planned.
4. **P&C only.** No life/health/pensions, ever, by decision.

## Positioning (the honest claim)

The ASB does not approve, certify, or endorse software; ASOPs bind
credentialed actuaries. The SDK's claim is: **"designed to support the
actuary's compliance with ASOP Nos. 43, 23, 41, 56, 25, 36, 20, 21, 38, and
13 — by generating the disclosures, documentation, and diagnostics those
standards call for. Responsibility for compliance remains with the
credentialed actuary."** Never "ASOP-approved". Build discounting to the
NEW ASOP 20 (effective 2026-06-01); version disclosure templates by ASOP
edition (41 and 13 revisions are in exposure).

## Market context (verified 2026-07-16)

The JS/TS actuarial ecosystem is empty (best prior art: an abandoned v0.0.3
package). No agent-native reserving product exists anywhere; CAS and SOA are
running 2026 RFPs on exactly this. chainladder-python (CAS) and R ChainLadder
are the mature calculators; neither has a compliance layer or agent surface.
The moat is the compliance-artifact + reproducibility layer, not the math.

## Architecture

Five packages under `packages/`, all Apache-2.0, all ESM, all with the same
grammar the core already has (pure functions, typed inputs + options object,
`warnings: string[]` channel, `ReservingError` with machine codes, the
three-tier severity design: null cell < warning < throw).

| Package | Contents | Runtime deps |
|---|---|---|
| `@actuarial-ts/core` | All reserving math, deterministic AND stochastic. Triangle types, factors, CL, Mack, BF, Benktander, Cape Cod (+Gluck decay), Expected Claims, freq-sev, Berquist-Sherman, tails, capping/ILF, trend/on-level, diagnostics, incremental-triangle algebra, seeded RNG, ODP bootstrap, Merz-Wuthrich, Clark, Munich CL, case outstanding, Fisher-Lange, salvage/subro, ULAE, discounting. | zero |
| `@actuarial-ts/data` | Ingestion + data quality: claim-level loss-run CSV, long-format (origin, dev, value) and grid ingestion, control-total reconciliation, the ASOP 23 data review report. | zero (papaparse-free; parse CSV in-house or vendor minimal) |
| `@actuarial-ts/compliance` | Estimate metadata (intended measure/purpose, gross/net, LAE, accounting/valuation/review dates), assumption ledger (machine default vs human/agent judgment, rationale + source), ASOP 41 disclosure generator, ASOP 56 model cards, reproducibility bundles, actual-vs-expected roll-forward. | @actuarial-ts/core |
| `@actuarial-ts/agents` | Mastra toolkit: typed tool factory (tenant id via RequestContext only, never in input schemas; `{success:false, error:{code,message}}` envelopes; action/read classification), suspend-gate judgment workflow factory whose decision trails write into the compliance ledger, reserving advisor agent factory, golden-prompt eval harness. | @actuarial-ts/core, @actuarial-ts/compliance; @mastra/core + zod as peers |

Workbench (extracted to its own repository 2026-07-18) continues to consume all five (server: core+data+compliance+agents;
web: types only), proving the boundary.

## The agent fusion (why agents and compliance are one design)

Every judgment point (factor selection, tail, cap, ILF, trends, ELR, final
selection) is a suspend-gate workflow step: agent gathers evidence via read
tools, proposes with rationale, suspends for the human decision, applies it
through the same service layer as the UI, and **records decision + rationale
into the assumption ledger**. The ASOP 41 disclosure generator renders
workpapers from the same ledger. Agents produce the documentation the
profession says is the blocker to using AI at all.

## Validation strategy (the contract)

- Published-value tests remain the contract, extended per method:
  Mack 1993/1999 (already pinned), Benktander (Mack 2000 example),
  ODP GLM mean must reproduce chain ladder exactly, bootstrap seeded
  determinism + SE tolerance vs published analytics, Merz-Wuthrich 2008
  published example, Clark 2003 worked example, Quarg-Mack 2004 Munich CL
  example, canonical triangles (RAA, GenIns) cross-validated against
  chainladder-python / R ChainLadder outputs.
- Every stochastic method: seeded and reproducible, no ambient randomness.
- Compliance: golden-file disclosure snapshots + reproducibility round-trips.
- Agents: deterministic vitest coverage of factories/workflows plus the
  opt-in live-model eval harness.

## Phases (each ends with a regression gate + /ship)

- **Phase 0 — shipping mechanics:** rename @actng/core → @actuarial-ts/core,
  tsc build to dist (.js + .d.ts, exports map, sideEffects:false, files
  whitelist), LICENSE files, error-code registry, typed average keys, dead
  code pruned (util.ts sumDefined/round, ilf.ts unreachable line, trend.ts
  duplicate OLS), mack.ts non-positive-selection warning parity with CL,
  SSE disconnect aborts the agent stream, core README, GitHub Actions CI,
  npm pack validation.
- **Phase 1 — Friedland shelf + data package:** Benktander-Hovinen,
  frequency-severity ultimates (consume the existing count triangles),
  Generalized Cape Cod (Gluck decay), Mack factor-correlation test,
  standardized residuals as data; @actuarial-ts/data with the ASOP 23
  review report.
- **Phase 2 — compliance package:** metadata, ledger, ASOP 41 generator,
  model cards, reproducibility bundles, AvE roll-forward.
- **Phase 3 — stochastic backbone:** incremental triangles + algebra, seeded
  RNG, StochasticResult, ODP bootstrap (Shapland), Merz-Wuthrich, Clark.
- **Phase 4 — agents package:** tool factory, judgment-gate workflow factory,
  advisor factory, eval harness; ActNG2 server refactored onto it (dogfood).
- **Phase 5 — reserve-review completeness:** Munich CL, case outstanding,
  Fisher-Lange, salvage/subro, ULAE (Conger-Nolibos), discounting to new
  ASOP 20.
- **Final:** whole-SDK adversarial review, root README + CHANGELOG, npm pack
  all packages, publish-readiness (publish requires the founder's npm auth
  and the @actuarial-ts scope; if absent, document the one manual step).

## Non-goals

- Life/health/pensions methods (founder decision).
- A migration framework, auth, or Docker for the workbench (standing
  decisions).
- Whole-column/all-periods setters in any grid (standing founder rule; the
  agent API keeps bulk affordances).
- Marketing language implying certification of compliance.
