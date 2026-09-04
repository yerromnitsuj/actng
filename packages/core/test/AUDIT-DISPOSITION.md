# 0.6.1 audit disposition and regression map

This file maps the allegations in the [hardening plan](../../../docs/superpowers/plans/2026-09-04-v0.6.1-full-sdk-hardening.md)
to executable evidence. It is not a release approval. The clean release gate,
exact-source hosted workflows, registry consumer, tag, and release record are
required separately. Test counts and generated fingerprints are evidence only
when the commands have actually run; a test's mere presence is insufficient.

## Preparation allegations rechecked

The initial reports concerned 0.6.0. Rechecking the pre-hardening 0.6.1 worktree
showed that invalid periods, duplicate records/snapshots, incomplete records,
and known-group cutoffs were already handled. These are retained regressions,
not newly discovered defects. `diagnosticPreparationContract.test.ts` and
`packages/data/test/diagnosticRunContract.test.ts` pin the invalid audit rows,
structural checks, blocked outcomes, cutoff exclusions, and retained arithmetic.
Unknown filter/cutoff groups were a separate confirmed fail-open defect.

The final packed/declaration audit also reproduced a validation-library record
assembly defect: legal `__proto__` keys were validated but dropped in data,
interchange, and agent outputs. Shared prototype-key controls now cover values,
roles/bindings, identities, groups, nested dimensions, opaque storage fields,
and actual installed-package/Mastra responses. Getter-backed array slots are
rejected without invocation. These are concrete extensions of D03/D11/L06,
not reasons to forbid legal prototype-like identifiers.

## Confirmed findings

The contract references below are to the generalized-diagnostics specification
and numbered tasks in the hardening plan. “Before” describes the observed
behavior or directly inspected implementation, not a claim that every prior
release was rerun during this closure audit.

| ID | Reproduction / before behavior | Contract and permanent regression evidence |
|---|---|---|
| D01 | One rule had warning and not-evaluated cells; an aggregate warning hid the forbidden individual outcome. | Gate every check/evaluation. `packages/data/test/diagnosticRunContract.test.ts`: mixed-status case and all 16 review-policy subsets. |
| D02 | Supply a nonexistent runtime source group in filter/cutoff configuration; selection could silently do nothing. | Atomic configuration validation. `diagnosticPreparationContract.test.ts` and data run contract. |
| D03 | Prototype-like IDs, malformed UTF-16/NUL, cycles, custom prototypes, unsafe rows, and invalid dates at boundaries. | Task 1 shared primitives; `diagnosticRuntime.test.ts`, preparation/runner tests, and the shared three-shore negative corpus. |
| D04 | A branded validated run could later reject an invalid grouping configuration. | Validation must establish deterministic configuration validity. Data run contract's grouping/configuration cases. |
| D05 | Add unknown executable keys or malformed enum/catalog nodes; some were dropped or accepted. | Closed compiler vocabulary. `diagnosticDefinitions.test.ts`, interchange definition tests, shared semantic refusal vectors. Additional closure regressions reject unknown review-constant fields and null operands without raw exceptions. |
| D06 | Compare incompatible quantities, or place a depth-64 expression inside the metric-rule wrapper. | Independent root budgets and exact semantics. `diagnosticDefinitions.test.ts`; shared exact depth/node/definition-budget vectors. Wrapper depth and unknown-constant tests were witnessed failing before their closure fixes. |
| D07 | Use `toString`/`__proto__` as declared measures and omit a raw value. | Own-property derivation. `diagnosticDerivations.test.ts` and prototype runtime vectors. |
| D08 | Structural dependency projection relied on optional finding text and could duplicate or lose mapped findings. | Explicit blocker topology. Preparation and runner contract tests, plus fail-allowed arithmetic-null regression in the data run contract. |
| D09 | Compound operand metadata or overflow findings could use unrelated bindings/sources. | Actual operand dependencies determine semantics and evidence. `diagnosticRunnerContract.test.ts`, `diagnosticReview.test.ts`, and shared rule replay. |
| D10 | Fingerprints could be deterministic while using wrong tags, omitted source-null fields, or lexical numeric ordering. | Specification §15. `diagnosticIdentityProjection.test.ts`, typed finding/exposure-order regressions, and compliance `diagnosticIdentityBytes.test.ts` pinning complete canonical bytes and existing tags at all nine layers. Raw execution objects remain distinct from normalized identity projections. |
| D11 | Diagnostic document authoring could return invalid/mutable envelopes. | Validate, snapshot, and freeze writer output. `packages/interchange/test/diagnosticDefinition.test.ts`. |
| D12 | Re-stamp an unknown executable field and submit it to a semantic reader. | Same-major opaque storage is allowed; semantic execution must refuse unknown behavior. Shared TypeScript/Python/R diagnostic corpus. |
| D13 | Invalid artifact assurance/scope/length or impossible lineage was insufficiently checked. | Specification §16. `packages/compliance/test/diagnosticsBundle.test.ts`: scope, digest, duplicate/orphan/cyclic graph, byte-view and async mutation cases. |
| D14 | Re-stamp altered audit/result/review data in a serialized bundle. | Replay semantic/provenance coherence, not just tags. Compliance diagnostic bundle tests cover results, audits, cutoffs, filters, expected grids, policy receipts, and historical runtime versions. |
| L01 | Conflicting claim accident/report metadata could change allocation with row order. | `engine.test.ts`, data `review.test.ts` and `annualDevelopment.test.ts`. |
| L02 | Duplicate semantically normalized CSV headers silently selected one column. | Atomic import rejection. Data `lossRun.test.ts` and `exposure.test.ts`. |
| L03 | Impossible/suffixed dates and non-finite triangle coordinates crossed direct boundaries. | `engine.test.ts`, period/runtime tests, interchange schema tests, compliance metadata tests. |
| L04 | Invalid caps/indexes or no eligible base year could leak invalid diagnostics. | `capping.test.ts` and casualty diagnostics tests; missing base-year result is explicitly nullable. |
| L05 | Nested ledger inputs remained caller-owned after recording. | `packages/compliance/test/ledger.test.ts` mutation regression. |
| L06 | Prototype-named profiles/tools/results used inherited membership. | Runtime and runner prototype cases, interchange profile tests, agent catalog tests. |
| L07 | Agent output schemas accepted structurally invalid nested data. | Diagnostic-agent tests validate normalized review identity, actual display projections, trusted catalogs, and result envelope. |
| S01 | Frozen 0.5 quarterly golden was orphaned. | `quarterlyV05Migration.test.ts` imports immutable source/golden bytes; checks all 110 metric records, warnings, six templates, 22 instances, triangles, diagonal, and exposure reconciliation. |
| S02 | Cross-shore diagnostic tests consumed only a happy single cell. | Shared calendar/ordered corpus with all formula and rule families, tolerances, missingness, overflow, hostile mutations, and exact resource limits. |
| S03 | Source derivatives could be verified locally without a clean-checkout rebuild in automation. | Real-world source manifest tests and `rebuild:compare`; R CI and the full release gate perform pinned-source rebuild-and-diff. |
| S04 | No source-test inventory, incomplete gate self-test, standalone attestation creation. | Source registry runtime bijection/assertion counts and fault tests; release manifest dispatch tests, skip-failing reporters, stale/dirty/tarball evidence tests. Only successful gate completion creates publish evidence. |
| S05 | Tail ultimates were anchored but the paper's random-error contribution was not. | Core published-value suite and `mack1999TailConformance.test.ts`; Python/R consume the same immutable tail fixture. All nine SEs and total are checked at paper precision and tighter independent-engine precision. |

## Intentional behavior, not defects

- Generic interchange storage preserves opaque same-major extensions; semantic
  readers reject unsupported executable fields even when tags are recomputed.
- RAA has no claimed reserve/SE literature anchor. It remains an independent
  engine/convention fixture, with its published diagnostic anchors identified
  separately in the source registry.
- A fully developed no-tail Mack origin may be Python null versus TypeScript
  zero for uncertainty. The cross-engine contract accounts for that explicit
  absence convention; it does not hide missing uncertainty on immature rows.
- A justified policy can allow a structural fail outcome to be reviewed, but
  affected arithmetic remains null. Allowing a status does not repair data.
- Closed/reopen and configured monotonic rules default to warning. Their
  findings can complete under the default policy. Fault-injection tests also
  configure fail severity and prove the unchanged default gate blocks them.
- The Python Mack 1999 fixture uses native no-tail Mack followed by the
  published explicit terminal variance step. It does not claim that Python's
  deterministic `TailConstant` accepts stochastic tail parameters.

## Permanent execution

`npm test` runs the workspace regressions, including the source-guard tests.
`npm run validation:source` validates the immutable source registry and executes
its inventoried tests with exact assertion cardinalities and no skipped cases.
`npm run validation:reconciliation` runs data/source reconciliation tests.
`npm run release:gate` provisions the applicable live Python/R suites, runs
all required lanes and examples, verifies packed declarations and consumers,
and creates evidence only on a clean, unchanged release commit. The one paid,
probabilistic model evaluation remains an explicitly non-release experiment.
