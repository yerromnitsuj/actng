# Generalized diagnostics SDK (`0.6.0`) — implementation plan

> **Status: COMPLETED THROUGH TASK 20 — SHIPPED 2026-09-03 (`v0.6.0`).**
>
> **Execution contract:** implement this plan test-first, task by task. Keep
> commits narrowly scoped, preserve unrelated work, and do not publish, tag, or
> create a GitHub release without a separate explicit instruction. The
> authoritative design is
> [`../specs/2026-09-03-generalized-diagnostics-sdk.md`](../specs/2026-09-03-generalized-diagnostics-sdk.md).

**Goal:** replace the basis-specific quarterly diagnostics API with a
cadence-neutral, serializable, auditable diagnostics model: six reusable
formula templates, bound metric instances, structured measures and bases,
per-measure aggregation/missingness/exposure timing, explicit period axes,
declarative rules, raw-versus-presentation separation, deterministic content
identities, typed interchange, complete provenance, and real-world integration.

**Release target:** lockstep npm package version `0.6.0`; interchange wire
version `1.1.0`.

**Working directory:** `/Users/justinmorrey/ActNG2`.

**Runtime:** every Node/npm command in this plan must run with:

```bash
PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"
```

The only intentional exception is Task 19's separate packed-runtime CI lane
exercising `node >=20` for core, data, interchange, and compliance. The agents
package and every all-five integration use Node `>=22.13.0`, matching its
Mastra peers; normal development, generation, and release work uses the pinned
Node 22 runtime above.

## Plan-wide engineering constraints

- Core remains pure, deterministic, browser-safe, framework-free, and without
  I/O or clock access.
- Existing reserving math is not rerouted through the diagnostics engine.
- Published-value validation is the immovable regression contract.
- Aggregate measure leaves first; divide once. No mean of row ratios.
- Missing, zero, imputed zero, non-finite, expected-grid-asserted absent cells,
  missing required exposure, incomplete exposure, and conflicting exposure
  remain distinguishable; the engine never infers an expected source group.
- Missing/non-finite/non-positive denominators return null with structured
  findings. No diagnostic output may contain `NaN` or infinity.
- Claim-level limitations are evaluated before aggregation.
- Claim derivations are definition content and move every dependent calculation
  identity.
- Batch aggregation sorts by canonical source identity and uses the specified
  Neumaier accumulator. Do not claim arbitrary IEEE-754 partition merges are
  associative, and never expose a non-finite subtotal.
- Unknown data and wire boundaries are Zod-validated; core still performs
  semantic validation on typed inputs.
- Public definitions contain plain JSON only. No executable callback or
  function may be silently omitted from provenance.
- Prototype-like caller keys (`__proto__`, `constructor`, `toString`) remain
  safe.
- Apply the spec's one cross-shore string-validation matrix at every definition,
  data, evidence, provenance, and agent boundary; do not let packages invent
  local trimming, case-folding, or Unicode-normalization rules.
- Preserve one pre-exclusion audit record for every submitted loss, exposure,
  and expected-cell record that survives atomic definition-aware phase-0
  validation. Filters and cutoffs affect arithmetic, never whether content
  admitted to that audit remains identity- and provenance-bearing.
- Keep `schema/interchange/1.0` and historical `0.4.0` / `0.5.0` release
  records immutable.
- Do not add compatibility aliases for the removed `0.5.0` diagnostics names.
- Never claim "ASOP-approved." The approved phrase is "designed to support the
  actuary's compliance with the ASOPs."
- Actual npm publication is outside implementation scope until separately
  authorized.

## Dependency graph and safe parallelism

```text
T0 baseline
  ↓
T1 contract + migration assertions
  ↓
T2 definitions/identities → T3 formulas/rules/presentation → T4 derivations
  → T5 aggregation/exposure → T6 period axes → T7 runner/views
                                                                  ↓
                                                             T8 casualty pack
                                                                  ↓
                                      ┌────────────────┴────────────────┐
                                 T9 data boundary                T11 interchange TS
                                      ↓                                ↓
                                 T10 review                       T12 Python/R
                                      └──────────┐            ┌─────────┘
                                                 ↓            │
                                      T13 compliance ←────────┘ (T11 required;
                                                 ↓               T12 may finish in parallel)
                                      T14 agents boundary
                                                 ↓
                                      T15 remove legacy surface
                                                 ↓
                                      T16 examples/integration
                                                 ↓
                                      T17 documentation
                                                 ↓
                                      T18 version/release stamps
                                                 ↓
                                      T19 whole-SDK gates ←──── T12
                                                 ↓
                                      T20 separately authorized publish
```

Tasks 2–8 execute serially in numeric order: several touch the compiler,
identity modules, public index, or shared declaration snapshots, and Task 7
requires the runtime outputs of Tasks 3, 4, 5, and 6. After Task 8 freezes the
new core contract, Tasks 9–10 and Tasks 11–12 may
be assigned to separate workers. Task 13 may begin only after Tasks 10 and 11
settle the branded reviewed-run and typed-definition contracts; Task 12 may
finish concurrently but is required by Task 19. Tasks 7–9 are one deliberately
atomic core/data commit because the old and new runner signatures share a name.
Tasks 17–19 likewise share one atomic documentation/version/tooling/CI commit
so active guidance never claims `0.6.0` or names a release command before the
matching manifests and executable gate exist.
No parallel worker may edit the same file.

## Completion gates

The implementation is complete only when all of these are true:

- The casualty reference export contains exactly six formula templates.
- One caller amount basis yields ten count plus six amount instances; two
  bases yield ten count plus twelve amount instances without formula cloning.
- No generalized formula/default identifier contains `250`, `250k`,
  `primary`, a currency, or a fixed limit.
- The former `$250K` and primary fixture is reproduced exactly by configuring
  two bases and bindings.
- Count subtraction/share bindings and ordinary amount role/binding
  add/subtract use one exact population/basis; claim-expression amount addition
  alone may union disjoint components; paid/incurred bindings use one exact
  basis; exposures carry a structured exposure basis.
- Every formula family has a hand-calculated ratio-of-sums counterexample.
- Per-measure missingness, both exposure modes, mixed-cadence period axes,
  every exact rule operator boundary, definition/run/result fingerprints,
  views, interchange, provenance, and real-world data have focused and
  integrated tests.
- The active TypeScript declarations contain none of the removed API names.
- The complete TS, Python, and R suites pass; all runnable examples pass.
- All five package tarballs install together in a clean scratch consumer with
  one physical copy of each `@actuarial-ts/*@0.6.0` package.
- Every active document reflects `0.6.0`; historical records remain unchanged.
- Filtered-only, cutoff-only, and structurally invalid-only runs have distinct
  preparation/run identities and complete artifact coverage; only a genuinely
  empty audited input may omit a dataset artifact.

---

## Task 0: Capture the baseline and freeze `0.5.0` numeric evidence

**Purpose:** prove that the refactor preserves the useful numeric behavior
without preserving the old API model.

**Files:**

- Modify: `packages/core/test/fixtures/quarterlyCasualty.ts`
- Create: `packages/core/test/fixtures/quarterlyCasualtyV05Golden.ts`
- Create: `tools/docs/fixtures/actuarial-ts-0.5-migration.d.ts`
- Test: `packages/core/test/metricDiagnostics.test.ts`
- Do not modify: `packages/core/test/validation.test.ts`

**Produces:** an API-independent golden containing the old 22 metric values,
raw numerators, raw denominators, group/origin/valuation coordinates, and
warnings needed for post-refactor parity.

### Steps

- [ ] Run and record the clean baseline:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" node -e 'const p=require("./packages/core/package.json"); if(p.version!=="0.5.0") { throw new Error(`baseline requires @actuarial-ts/core 0.5.0, found ${p.version}`); }'
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run build
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run example
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run example:real-world
  ```

- [ ] Confirm `git status --short` contains only the approved planning-doc
  changes before implementation work begins.
- [ ] Add a temporary `0.5.0` assertion that serializes every existing fixture
  emergence cell to a plain, sorted record containing the coordinates,
  `metricId`, raw numerator, raw denominator, scaled value, and warning codes.
- [ ] Commit the resulting human-readable golden as data, not as generated
  runtime output. Include a comment that it is migration evidence and not a
  supported legacy API.
- [ ] Add a test that compares the live `0.5.0` engine against the frozen
  golden before any old symbol is removed.
- [ ] From the clean `0.5.0` build declarations, extract the exact ambient
  `@actuarial-ts/{core,data,interchange,compliance,agents}` declarations needed
  by the migration guide's planned before-snippets into
  `tools/docs/fixtures/actuarial-ts-0.5-migration.d.ts`. Compile one source
  fixture against both the live `0.5.0` declarations and the extracted ambient
  fixture and require identical success/failure. Freeze the fixture as dated
  documentation evidence only; it is never exported, packed, or treated as a
  compatibility surface.
- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core -- metricDiagnostics.test.ts
  ```

  Expected: pass with all 22 old outputs frozen.
- [ ] Record the baseline count and published-value result in the task notes;
  never regenerate the golden merely because the new implementation differs.
- [ ] Commit: `test(core): freeze v0.5 diagnostics migration evidence`.

### Task 0 acceptance

- The golden does not import `CASUALTY_QUARTERLY_METRICS` or any implementation
  function.
- Golden generation fails before build/serialization unless the core manifest
  is exactly `0.5.0`.
- The old live engine and golden agree before refactoring.
- The minimal frozen declaration fixture compiles the exact planned `0.5.0`
  migration examples and is proven against the live baseline declarations.
- `packages/core/test/validation.test.ts` is byte-unchanged and passing.

### Task 0 execution record — 2026-09-03

- Verified the clean `0.5.0` baseline under Node `22.22.0`: build, typecheck,
  all workspaces, reserve review, and the real-world example passed. The full
  workspace run had 930 passing tests and 15 intentionally environment-gated
  live-sidecar/capstone skips.
- Frozen 22 metric IDs across five emergence points as 110 independently
  stored records containing coordinates, raw numerators, raw denominators,
  values, and warning codes.
- The published-value anchor remained unpaid `18,680,856` with Mack standard
  error `2,447,095`; `packages/core/test/validation.test.ts` remained
  byte-unchanged and passed all 15 tests.
- Compiled the checked migration source once against the live `0.5.0` package
  declarations and once against the frozen ambient fixture; both succeeded.

---

## Task 1: Lock the new public contract and clean-break migration

**Purpose:** make the desired API fail at compile/runtime before implementing
it, and make accidental compatibility debt visible.

**Files:**

- Create: `packages/core/test/diagnosticDefinitions.test.ts`
- Create: `packages/core/test/diagnosticPublicApi.test.ts`
- Modify: `packages/core/test/customizationTypes.test.ts`
- Modify: `packages/core/src/index.ts` only after the tests exist
- Modify later in this task: `CHANGELOG.md` (`Unreleased` only)

**Public-contract anchors (selected cross-package names locked here; each
owning task adds an exhaustive declaration snapshot for its package):**

- `DiagnosticMeasureDefinition`
- `DiagnosticCountPopulationDefinition`
- `DiagnosticExposureBasisDefinition`
- `AmountBasisDefinition`
- `DiagnosticDerivedMeasureDefinition`
- `DiagnosticFormulaTemplate`
- `DiagnosticMetricInstance`
- `DiagnosticDefinition`
- `CompiledDiagnosticDefinition`
- `NormalizedDiagnosticFormulaIdentity`
- `NormalizedDiagnosticCalculationScope`
- `NormalizedDiagnosticsFilterIdentity`
- `NormalizedDiagnosticSourceLocationIdentity`
- `DiagnosticIdentityProjection`
- `NormalizedDiagnosticExpectedCellIdentity`
- `NormalizedDiagnosticPreparationIdentity`
- `NormalizedDiagnosticResultIdentity`
- `getPreparedDiagnosticDataIdentity`
- `getMetricDiagnosticsResultIdentity`
- `assertCompiledDiagnosticDefinition`
- `CORE_PACKAGE_VERSION`
- `DiagnosticPeriodAxis`
- `DiagnosticComparisonRule`
- `DiagnosticReviewRule`
- `DiagnosticReviewCoordinate`
- `DiagnosticReviewEvaluationScope`
- `DiagnosticReviewRuleEvaluation`
- `DiagnosticReviewExpressionOverflow`
- `evaluateDiagnosticReviewRules`
- `DiagnosticExposureObservation`
- `DiagnosticClaimObservation`
- `DiagnosticLossSnapshot`
- `DiagnosticSourceLocation`
- `DiagnosticCompletePeriodCutoff`
- `DiagnosticExpectedCell`
- `DiagnosticInputDisposition`
- `DiagnosticInputAuditRecord`
- `PrepareDiagnosticDataInput`
- `DiagnosticMeasureContribution`
- `DiagnosticStructuralBlocker`
- `DiagnosticExposureAuditObservation`
- `PreparedDiagnosticSourceCell`
- `ReconciledDiagnosticExposure`
- `PreparedDiagnosticData`
- `RunMetricDiagnosticsInput`
- `DiagnosticsFilter`
- `DiagnosticQuantitySemantics`
- `DiagnosticQuantity`
- `DiagnosticMeasureStats`
- `DiagnosticRuleEvaluation`
- `DiagnosticMetricFinding`
- `DiagnosticMetricEvaluation`
- `DiagnosticEmergencePoint`
- `DiagnosticMetricTriangleCell`
- `DiagnosticMetricTriangle`
- `MetricDiagnosticsResult`
- `CommonMaturityResult`
- `compileDiagnosticDefinition`
- `prepareDiagnosticData`
- `assertPreparedDiagnosticData`
- `verifyPreparedDiagnosticDataIntegrity`
- `runMetricDiagnostics`
- `validateDiagnosticGroupingConfiguration`
- `CASUALTY_FORMULA_TEMPLATES`
- `MAX_DIAGNOSTIC_EXPRESSION_DEPTH`
- `MAX_DIAGNOSTIC_EXPRESSION_NODES`
- `MAX_DIAGNOSTIC_DEFINITION_EXPRESSION_NODES`

The data-package snapshot additionally owns `DiagnosticGroupingAssignment`,
`DiagnosticCachedFormulaEvidence`, `DiagnosticReviewEvidence`, the exact
  `DATA_PACKAGE_VERSION`,
  `DataFindingContext`/`DataFinding`/`DataCheck`/`DataReviewReport` shapes,
`DiagnosticRunInput`, `DiagnosticExecutionPolicyInput`,
`DiagnosticReviewIdentityBody`, `DiagnosticReviewReceipt`,
`DiagnosticExecutionGateReceipt`, `ValidatedMetricDiagnosticsOutcome`,
`CompletedValidatedMetricDiagnosticsRun`, and
`assertCompletedValidatedMetricDiagnosticsRun`. The compliance snapshot owns
`DiagnosticArtifactDigestBase`, `DiagnosticArtifactDigest`,
`DiagnosticArtifactEvidence`, `DiagnosticPreparationLineage`,
`DiagnosticRunManifest`, `DiagnosticRunIdentity`,
`NormalizedDiagnosticRunManifestIdentity`,
`DiagnosticRunProvenance`, `VerifiedDiagnosticRunProvenance`,
the extended `ComplianceError` code/path contract,
`CreateDiagnosticRunIdentityInput`, `createDiagnosticRunIdentity`,
`assertVerifiedDiagnosticRunProvenance`, and
`verifyDiagnosticRunIdentity`; interchange owns its complete document surface.
Tests in those tasks compare complete generated declarations, so this selected
list is not used as a substitute for exhaustive API review.

### Steps

- [ ] Write only the Task 2-scope compile fixtures now: complete authored
  definition shapes for one count-only, one single-basis, one two-basis, one
  static plus valuation-specific exposure, and one ordered-fiscal definition;
  plus `compileDiagnosticDefinition`. Later tasks extend the same public API
  test as their functions become real.
- [ ] Snapshot the pre-existing reserving `DiagnosticFinding` and
  `DiagnosticsResult.findings` declarations before adding generalized result
  types. They remain byte-for-byte source-compatible for `runDiagnostics`;
  the new `DiagnosticMetricFinding` is a separate export and must not broaden,
  alias, or replace that existing contract.
- [ ] Record, but do not yet execute, the Task 15 declaration-removal checklist.
  The eventual built declaration must not export:

  - `MetricDefinition`
  - `MetricWarningRule`
  - `MetricWarningContext`
  - `MetricEvaluation`
  - `SparseValuePolicy`
  - `DiagnosticMeasureMap`
  - `MeasureExpression`
  - `DiagnosticWarning`
  - `diagnosticWarningToFinding`
  - `MeasureAggregateCell`
  - `MeasureAggregate`
  - `FinalizedMeasures`
  - `measureExpressionComponents`
  - `evaluateMetric`
  - `AmountLayerDefinition`
  - `LayerExpression`
  - `DiagnosticClaimRow`
  - `DiagnosticLossRow`
  - `DiagnosticExposureRow`
  - `deriveAmountLayers`
  - `CASUALTY_QUARTERLY_METRICS`
  - `CASUALTY_DIAGNOSTIC_COMPONENTS`
  - `createCasualtyQuarterlyMetrics`
  - `CASUALTY_AMOUNT_LAYERS`
  - `createCasualtyAmountLayers`
  - `CasualtyDiagnosticComponentKeys`
  - `CasualtyMetricPresetOptions`
  - `CasualtyAmountLayerOptions`
  - `aggregateMeasures`
  - `mergeMeasureAggregates`
  - `finalizeMeasureAggregate`
  - `DiagnosticExposureReconciliationFinding`
  - `ReconciledDiagnosticExposures`
  - `reconcileDiagnosticExposureKeys`
  - `metricTriangleFromEmergence`
  - `ValidatedDiagnosticDataset`
  - `validateDiagnosticDataset`
  - `validateAndReconcileDiagnosticExposures`
  - `ValidatedMetricDiagnosticsOptions`
  - `DiagnosticReviewSnapshot`
  - `DiagnosticReviewExposure`
  - `DiagnosticAmountPair`
  - `DiagnosticLayerReviewDefinition`
  - `DiagnosticLayerControlTotal`
  - `CachedFormulaProvenance`
  - `ReviewDiagnosticDataOptions`
  - `reviewDiagnosticData`
  - `DIAGNOSTIC_REVIEW_CHECK_CODES`
  - `DiagnosticReviewCheckCode`
  - `DiagnosticMetricProvenance`
  - `DiagnosticLayerProvenance`
  - `CreateDiagnosticsProvenanceInput`
  - `createDiagnosticsProvenance`

  The same removal contract also contains these non-export legacy identifiers
  and exact string tokens; an exported-name scan alone is insufficient:

  - whole identifiers/field names: `ageMonths`, `minAgeMonths`,
    `maxAgeMonths`, `policyPeriod`, `policyPeriods`, `sparsePolicy`,
    `evaluateWarnings`, `warningRules`, `requiredComponents`, `rawNumerator`,
    `rawDenominator`, `rawComponents`, `componentWarnings`, `metricId`,
    `metricVersion`, `frequencyScale`, `frequencyUnit`, `definitionVersion`,
    `basisLabels`, `limited250`, `paid250`, `incurred250`, `paidPrimary`,
    `incurredPrimary`, `indemnityLimit`, `paidSourceMeasure`,
    `incurredSourceMeasure`, `indemnityPaidMeasure`,
    `indemnityIncurredMeasure`, `expensePaidMeasure`,
    `expenseIncurredMeasure`, `formulaPack`, `ageConvention`,
    `appliedFilters`, `groupingSelections`, `inputReferences`, and
    `packageVersions`;
  - exact legacy policy/AST/basis/default tokens: `preserve-null`, `zero-fill`,
    `claim-cap`, `pre-capped-additive`, `unlimited-additive`,
    `claim-level-cap`, `numerator-greater-than-denominator`,
    `casualty-quarterly-v1`, `250k-pre-capped-total`,
    `primary-1m-indemnity-plus-expense`, `preCapped250Paid`, and
    `preCapped250Incurred`;
  - exact old count-instance IDs: `reported-frequency`, `open-frequency`,
    `closed-no-pay-frequency`, `closed-with-pay-frequency`,
    `non-closed-no-pay-frequency`, `closed-no-pay-share`,
    `closed-with-pay-share`, `closed-with-pay-share-of-non-cnp`, `open-share`,
    and `open-share-of-non-cnp`;
  - exact basis-specific amount-instance IDs: `paid-to-incurred-250`,
    `paid-to-incurred-primary`, `incurred-250-per-exposure`,
    `incurred-primary-per-exposure`, `incurred-250-per-non-cnp`,
    `incurred-primary-per-non-cnp`, `paid-250-per-exposure`,
    `paid-primary-per-exposure`, `paid-250-per-closed-with-pay`,
    `paid-primary-per-closed-with-pay`, `case-250-per-open`, and
    `case-primary-per-open`; and
  - exact old diagnostic warning codes: `MISSING_COMPONENT`,
    `NON_FINITE_COMPONENT`, `NON_FINITE_NUMERATOR`, `NON_FINITE_RESULT`,
    `INVALID_DENOMINATOR`, `INCOMPLETE_EXPOSURE`, `CONFLICTING_EXPOSURE`,
    `DUPLICATE_EXPOSURE_KEY`, and `PAID_EXCEEDS_INCURRED`; and
  - exact retired fixed-review taxonomy tokens: `duplicate-exposure-key`,
    `invalid-development-age`, `development-age-mismatch`,
    `closed-no-pay-exceeds-reported`, `cumulative-paid-decreasing`,
    `cumulative-reported-decreasing`, `layer-control-reconciliation`, and
    `zero-exposure`. Do not deny the old tokens deliberately retained by the
    generalized contract, including `duplicate-aggregate-snapshot`,
    `valuation-before-origin`, `count-reconciliation`,
    `paid-exceeds-incurred`, `closed-reopen-signal`, `layer-order`,
    `loss-without-exposure`, `exposure-without-loss`, `incomplete-exposure`,
    `inconsistent-group-mapping`, and `cached-formula-provenance`.

  In the Task 15 artifact, each entry declares `match: "whole-identifier"` or
  `match: "exact-string-token"`. Whole-identifier matching uses ECMAScript
  identifier-part boundaries and therefore never matches `MetricEvaluation`
  inside `DiagnosticMetricEvaluation`. In source, declarations, and structured
  config, exact-string-token matching recognizes a complete string literal,
  backticked token, or config value rather than an arbitrary substring. In
  tracked Markdown/MDX prose it also catches unquoted whole tokens. The scanner
  first lexes URL/autolink destinations, `%HH`-encoded tokens, and compound
  slash-, colon-, or period-separated identifier spans; it suppresses a hit
  only when the retired token is a strict component/subspan of one of those
  larger lexical tokens. It then applies ASCII letter/digit/underscore/hyphen
  boundaries to ordinary prose. Sentence punctuation is therefore a boundary:
  a bare retired token followed by `.`, `:`, or `/` still fails, while a suffix
  inside `casualty/count/reported-frequency`, a URL, a dotted/colon namespace,
  or a percent-encoded larger token does not. Backticked exact tokens remain
  candidates. Legitimate occurrences survive only through an exact
  occurrence allowlist entry containing normalized path, denylist entry,
  complete source-line text, expected occurrence count, and nonempty reason.
  Line numbers are deliberately excluded so harmless preceding edits do not
  churn the artifact; changed text or a duplicate/stale occurrence still
  fails.

- [ ] Run the focused typecheck and Task 2-scope tests. Expected: fail because
  the new definition model/compiler exports do not exist yet. Do not add
  assertions for the Task 3–8 runtime exports in this red phase.

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/core
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core -- diagnosticDefinitions.test.ts diagnosticPublicApi.test.ts
  ```

- [ ] Add an `Unreleased` breaking-change entry explaining formula templates
  versus bound instances, the long exposure observation shape, and the old→new
  symbol table. Do not change historical `0.4.0` or `0.5.0` text.
- [ ] Keep this red phase uncommitted until Task 2 introduces the minimum real
  definition model. Do not add empty compatibility stubs simply to satisfy
  imports. The Task 2 commit includes only its now-green contract tests; later
  tasks add red→green assertions at their owning green boundary. The
  `runMetricDiagnostics` name changes incompatibly, so Tasks 7–9 intentionally
  share one atomic core+data commit rather than adding a dual-shape dispatcher.
  Task 15 owns final legacy removal.

### Task 1 acceptance

- The proposed examples are readable without casts or `any`.
- The migration checklist matches the approved specification exactly and has
  an explicit Task 15 enforcement owner.
- No new deprecated alias is introduced; the existing `0.5.0` exports remain
  temporarily until their tested Task 15 removal.
- The expected red failures were observed before implementation, but no known
  failing commit was created.

---

## Task 2: Implement JSON-safe expressions, catalogs, compilation, and identities

**Purpose:** establish one validated source of truth before calculation code is
moved.

**Files:**

- Create: `packages/core/src/diagnosticExpressions.ts`
- Create: `packages/core/src/diagnosticDefinitions.ts`
- Create: `packages/core/src/diagnosticIdentity.ts`
- Create: `packages/core/src/version.ts`
- Modify: `packages/core/src/canonical.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/diagnosticDefinitions.test.ts`
- Test: `packages/core/test/diagnosticPublicApi.test.ts`
- Test: `packages/core/test/canonical.test.ts`

**Produces:** normalized, immutable `CompiledDiagnosticDefinition` with lookup
indexes, derived dependencies, formula fingerprints, calculation fingerprints,
and complete definition integrity.

**Consumes:** plain `DiagnosticDefinition` input conforming to the spec.

### Steps

- [ ] Implement `DiagnosticMeasureExpression` and `DiagnosticRoleExpression`
  walkers that return dependencies without executing arbitrary code. Their
  add/subtract operations require one exact kind/unit/semantic basis; do not
  reuse Task 4's claim-expression-only disjoint-component union rule here.
- [ ] Define and compile caller-authored formula templates, metric instances,
  presentations, metric comparison rules, and top-level review-rule ASTs here.
  Validate role bindings and every transitive dependency for exact role kind,
  unit, count population, amount/exposure basis, and compatibility group.
  Treat `compatibilityGroup` as catalog identity only: ordinary pointwise
  add/subtract may combine different development semantics unless the role's
  independent optional `developmentSemantics` requires one exact value across
  every transitive leaf. Claim derivations remain stricter: output and all
  transitive leaves share one exact development semantic. Reject every formula
  that declares a role unused by both numerator and denominator, while allowing
  repeated role references; derive calculation dependencies only from the
  expressions bound to actually referenced roles. Derive distinct calculation
  versus evaluation dependency sets and reject unknown operators/references,
  invalid rule operands, or rule-ID collisions.
  Task 3 supplies the six built-in template data values and runtime evaluator;
  it does not reopen compiler semantics.
- [ ] Add recursion/cycle and node-count guards so pathological caller input
  fails with a typed error rather than overflowing the stack. Export and pin
  the exact 64 per-root depth, 10,000 per-root node, and 100,000 whole-definition
  node limits; count the root/leaves, metric-rule operand wrappers, review
  constant operands, independent sides of every multi-operand rule, and repeated
  syntactic occurrences exactly as the spec requires. Test unknown roles,
  unused declared roles, repeated legal role use, a measure-operand outer
  wrapper at each boundary, and a large left operand that cannot consume or
  conceal the right operand's independent budget.
- [ ] Export `CORE_PACKAGE_VERSION` from one tiny runtime module so compliance
  can stamp the actual installed core version. Pin it to the core manifest in a
  version test; Task 18 updates both together.
- [ ] Implement measure, count-population, amount-basis, and exposure-basis
  catalog types, including development semantics, the component limitation
  union, derivation/source references, and JSON-safe attributes.
- [ ] Declare/export the exact readonly `DiagnosticMeasureStats` result shape
  in the shared definition/result types now so Task 3's pure evaluator can be
  typed before aggregation exists. Task 3 consumes synthetic instances of that
  type; Task 5 owns constructing real statistics from contributions and
  blockers. Neither task creates a second stats interface.
- [ ] Define and export `DiagnosticClaimExpression` and
  `DiagnosticDerivedMeasureDefinition` here as part of the authored definition
  contract. Validate the complete derivation graph during compilation: unique
  output IDs, declared derived outputs, known dependencies, compatible
  kind/unit/basis, no cycles or empty additions, per-root/whole-definition AST
  limits, and deterministic topological order with a code-unit ID tie-break.
  Validate finite nonnegative attachments, positive finite non-null widths,
  attachment-plus-width finiteness, claim-grain-only SDK layers, external
  transformation references, and the exact structured amount-component
  projection. `claim-layer` accepts only one included unlimited source
  component; amount `add` may union pairwise-disjoint components only when
  currency and perspective match exactly. Task 4 executes this already-proven
  private plan and does not introduce or revalidate the public contract.
- [ ] Own the authored period-axis schemas and their static compiler/identity
  normalization here: validate calendar cadence/anchors and ordered
  IDs/versions/age units, labels, aliases, safe coordinates, safe offset,
  collisions, and catalog order. This is what makes Task 1's ordered-fiscal
  definition compile and gives normalized identity an exact axis. Task 6 adds
  runtime label/coordinate/age helpers over this already-compiled shape; it
  does not introduce a second schema or normalizer.
- [ ] Implement `DiagnosticDefinition` and `CompiledDiagnosticDefinition`.
  Make the wrapper opaque with a module-private `unique symbol` brand and deep
  runtime freeze. Keep its public enumerable definition snapshot plain JSON;
  keep indexes and the distinct calculation/evaluation dependency sets
  internal. Register authentic objects with private runtime state and export
  `assertCompiledDiagnosticDefinition` for data/interchange consumers; copied
  symbols and structural/deserialized lookalikes must fail.
- [ ] Let the core compiler accept either the authored definition or the exact
  normalized wire projection and normalize both through one implementation.
  Prove idempotence by recompiling `compiled.definition` and comparing its
  normalized bytes plus every identity. Data exposes only the authored run
  input; Task 11 passes the normalized wire body directly, with no separate
  denormalizer or semantic compiler.
- [ ] Implement one semantic compiler pass that accumulates precise path-based
  validation issues and throws the public `DiagnosticValidationError`. Give it
  the exact domain/high-level-code/issue-code unions, domain-derived error
  code, canonical JSONPath renderer,
  nonempty recursively frozen issue array, first-issue `path`/`message`,
  domain/issue-code-rank/typed-path/code/message ordering,
  exact-deduplication, and downstream-issue
  suppression specified in the design. Snapshot full errors at both boundaries
  and require the same domain/code/message/order and relative typed-path suffix
  for shared semantic failures after data applies the one documented
  `$.definition` prefix to direct compiler `$` paths. It must reject:

  - duplicate/empty IDs, definition/formula/instance/axis versions, units,
    currencies, presentation strings, and required references;
  - empty/all-excluded amount-basis component catalogs;
  - metric-rule IDs that collide within/across instances, collide with a
    top-level review rule, or use the reserved structural-check prefix;
  - references to unknown IDs;
  - any definition schema version other than `1.0.0`;
  - `basisId` on non-amount measures or missing on amount measures;
  - missing/inapplicable count-population and exposure-basis IDs;
  - invalid raw/derived/exposure source, development-semantics, or timing
    combinations, including a violated temporal formula-role constraint or a
    claim derivation whose output and transitive leaves differ temporally;
  - `missing: "zero"` on an exposure measure (known zero must be explicit);
  - invalid or missing `lossRowGrain`;
  - unsupported aggregations;
  - duplicate/missing derived outputs, unknown derivation dependencies, empty
    additions, cycles, incompatible claim-expression semantics, and excessive
    expression depth;
  - non-finite or non-positive scale, and non-finite attachment, finite limit,
    coordinate, tolerance, or constant;
  - negative tolerances;
  - non-positive limits, attachment-plus-width overflow, invalid
    attachment/limit/application combinations, and unsupported layered source
    semantics;
  - functions, `undefined`, bigint, symbol, Date/Map/Set, custom prototypes,
    and circular metadata; and
  - prototype-like key corruption while still allowing those strings as
    caller IDs.

- [ ] Centralize the specification's exact string-class validator and apply it
  to every compiler-owned token, human-text, period-text, free-JSON key/value,
  and source-location field. Share vectors for NUL, unpaired surrogates, blank
  ASCII whitespace, leading/trailing ASCII whitespace, internal whitespace,
  Unicode, and prototype-like keys with Tasks 9, 11, and 12; never call
  locale-sensitive trim/normalize/case-folding as an implicit repair.
  Include attribute-record keys and every nested object key/value in free JSON,
  not only string leaf values.

- [ ] Implement and export the exact
  `NormalizedDiagnosticDefinitionIdentity`, tolerance, review-filter,
  limitation, review-rule, and period-axis projections. Materialize every
  optional as the specified null/empty object/empty array/full tolerance or
  full-filter field; reject explicit `undefined`; recursively normalize `-0`;
  and make the compiled public `definition` this normalized snapshot rather
  than an authored clone with latent defaults.
- [ ] Normalize catalogs and amount components by code-unit-sorted ID;
  ordered coordinates by numeric coordinate then label; alias arrays and
  review-filter sets by exact-deduplicated code-unit order; and every record
  key by code unit. Preserve instance/rule/expression order exactly. Add two
  shared definition-identity vectors (calendar and ordered axes) covering every
  default, present-empty filter versus absence, explicit empty selector,
  compatibility group, formula-role development-semantics constraint, unknown
  limitation, alias reorder invariance, and prototype-like keys.
- [ ] Define the identity payload schemas with an explicit `identityVersion: 1`.
  Use `canonicalJson` and `fnv1a64`; emit tags in the exact form
  `fnv1a64-jcs-v1:<hex>`.
- [ ] Implement and declaration-snapshot the exact
  `NormalizedDiagnosticDefinitionIdentity`,
  `NormalizedDiagnosticFormulaIdentity` and
  `NormalizedDiagnosticCalculationScope` projections. Emit explicit nulls for
  inapplicable measure semantic references, `{}` for absent attributes,
  code-unit-sorted role/binding keys and semantic arrays, and declared-order
  expression terms. Normalize both optional formula-role fields to explicit
  nulls, including `developmentSemantics`, so adding/removing/changing a
  temporal role constraint moves formula, calculation, and definition
  identities. Include exactly the transitive calculation dependencies, not
  rule-only dependencies or human presentation/source prose.
- [ ] Implement the three identity scopes exactly as the spec states:

  - formula fingerprint: formula only;
  - calculation fingerprint: formula, binding, referenced measure,
    count-population, amount/exposure-basis semantics, loss row grain, policies,
    and transitive derivations, excluding both rule families and presentation;
    and
  - definition integrity: the entire normalized definition, including axis and
    presentation.

- [ ] Freeze or defensively clone the compiled snapshot and prove caller
  mutation after compilation cannot alter execution or its tags. Add compile
  failures showing a structural lookalike cannot satisfy the public type and
  runtime assertion tests showing deserialized objects or copied enumerable
  symbols are rejected.
- [ ] Add identity tests:

  - pinned known vector;
  - object insertion-order and catalog-order invariance;
  - ordered-axis alias reorder invariance and alias collision rejection;
  - omitted/defaulted fields versus their exact normalized projections,
    including null versus explicit empty control filters;
  - expression/rule order behavior;
  - field-by-field mutation matrix;
  - metric-presentation (`displayUnit` included) and catalog-display/source-prose changes leave formula
    and calculation fingerprints stable but change definition integrity;
  - measure-unit, population/basis semantic, binding, loss-row-grain,
    missing/timing, and transitive derivation changes leave formula identity
    stable and change calculation + definition identity;
  - instance-comparison and top-level-review rule changes move definition
    integrity but leave formula/calculation identity stable; rule-output effects
    are asserted only after the Task 3 and Task 10 evaluators exist;
  - formula changes move all dependent identities;
  - a formula-role development-semantics constraint is identity-bearing, while
    an unconstrained ordinary binding such as cumulative reported minus
    point-in-time closed-no-pay remains legal and preserves each leaf's own
    semantics;
  - the authored/compiled core API has no caller-supplied identity slot; stale
    supplied-tag rejection belongs to Task 11 wire parsing and Task 13
    provenance verification; and
  - tags are always described as non-cryptographic.

- [ ] Add compiler tests for every invalid combination and exact full error
  issue array, including deterministic multi-issue precedence and unrelated-
  issue retention. Unit-test the public error normalizer with synthetic
  multi-domain issues to pin definition → input → configuration → view order.
  Include all derivation graph/basis/layer cases above and claim-expression
  amount additions with disjoint components but mixed currency or perspective;
  both must reject rather than imply conversion. Prove a compatibility group
  does not itself require temporal equality, an unconstrained mixed-semantics
  pointwise binding compiles, a cumulative-constrained role rejects a
  point-in-time transitive leaf at its precise path, and a claim derivation
  rejects any output/leaf temporal mismatch.
- [ ] Extend the core public declaration snapshot now—not only at legacy
  removal—to cover every Task 2 export and fail on accidental optionality,
  mutability, `any`, or an extra identity field.
- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core -- canonical.test.ts diagnosticDefinitions.test.ts diagnosticPublicApi.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/core
  ```

- [ ] Commit: `feat(core)!: add compiled diagnostic definitions and identities`.

### Task 2 acceptance

- Compilation validates once; cell evaluation does not repeat catalog checks.
- A compiled definition cannot drift when the caller mutates the source object.
- Identity behavior is pinned independently of runtime row order.
- No cryptographic or tamper-evidence claim is made for FNV-1a.

---

## Task 3: Implement formula templates, metric instances, presentation, and rules

**Purpose:** separate reusable actuarial arithmetic from concrete source fields
and communication choices.

**Files:**

- Create: `packages/core/src/diagnosticRules.ts`
- Create: `packages/core/src/diagnosticFormulas.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/diagnosticFormulas.test.ts`
- Create: `packages/core/test/diagnosticRules.test.ts`
- Test: `packages/core/test/diagnosticDefinitions.test.ts`
- Test: `packages/core/test/diagnosticPublicApi.test.ts`

**Produces:** six standard templates, validated role binding, a pure metric/rule
evaluator over explicit finalized-operand and synthetic readiness state, the
exported pure `classifyDiagnosticComparison` oracle, declarative rule
evaluations, and separate raw/display values. Task 7 alone adapts authentic
prepared cells and mapped aggregates into this evaluator.

### Steps

- [ ] Write failing tests for all six template IDs, exact roles, kinds,
  version `1.0.0`, exact `count-population` / `amount-basis` compatibility
  tokens, exact cumulative paid/incurred and point-in-time open constraints,
  true property absence on every unconstrained role, numerator expressions,
  denominator expressions, and `positive-or-null` denominator policy. Snapshot
  both authored property absence and normalized explicit nulls.
- [ ] Implement `CASUALTY_FORMULA_TEMPLATES` as immutable serializable data.
  Do not embed source measure names or amount bases.
- [ ] Exercise caller-authored templates through Task 2's one compiler and the
  same narrow role AST. Runtime evaluation accepts only authentic compiled
  bindings; multiplication, nested division, conditionals, unknown operators,
  incompatible roles, and rule-only/calculation dependency confusion remain
  compiler failures, not evaluator branches. Include rule-only components in
  returned audit stats without treating them as numeric calculation identity.
- [ ] Implement raw metric calculation against an explicit internal evaluator
  input whose entries already contain finalized value, quantity semantics,
  sources, and ordered readiness reasons. This task neither imports
  `PreparedDiagnosticData` nor manufactures preparation blockers. Apply the
  invariant:

  1. consume finalized aggregate measures;
  2. evaluate numerator and denominator expressions;
  3. retain finite raw operands;
  4. return null for a missing/non-finite/non-positive denominator;
  5. divide once with `safeRatio`;
  6. retain negative finite numerator values; and
  7. never emit a non-finite number.

- [ ] Make expression arithmetic normative: declared-order Neumaier finalization
  for each `add`, one subtraction for `subtract`, and null plus a finding for
  any null/non-finite/overflowed intermediate. Pin declared-order and
  cancellation vectors shared with Task 12. A metric-rule measure-expression
  operand retains every exact failed `expressionPath`/source record, becomes
  not-evaluated for `expression-overflow`, and emits both the fail overflow
  finding and informational rule-not-evaluated finding without ancestor or
  reader-induced duplicates.

- [ ] Implement the spec's one shared overflow-safe tolerance classifier. For
  all six operators, the exact tolerance boundary is `equal`; a metric
  `when` predicate that evaluates true is `triggered`, false is `pass`, and a
  missing/non-finite operand or tolerance overflow is `not-evaluated` with a
  finding. Reject negative/non-finite tolerances.
- [ ] Determine rule readiness from every dependency's explicit evaluator
  state, not just its numeric value. Use synthetic states here to pin missing,
  imputed, non-finite, structurally ambiguous, aggregation-overflowed, and
  expression-overflowed reason ordering and not-evaluated behavior. A
  calculation-field operand inherits supplied binding/formula overflow paths
  and all supplied causes without re-emitting the same fail finding. Task 7
  owns the integration proof that source-cell blockers and mapped-group
  finalization produce those states correctly.
- [ ] Pin the complete `DiagnosticRuleEvaluation` serialization table: null
  code/message on pass, authored code/message on trigger, constant
  not-evaluated code/message on not-evaluated, always-present
  `expressionOverflows`, no optional properties, exact relation/reason
  behavior, and finite operand retention on tolerance overflow.
- [ ] Keep metric-rule operands to measure expressions, calculation numerator,
  calculation denominator, and constants. Do not expose the quotient `value`
  as a rule operand in `0.6.0`: it has no single measure-kind semantics.
  Express paid-over-incurred as numerator versus denominator and negative-case
  checks as numerator versus a contextual zero constant. Add declaration and
  compiler tests that reject `field: "value"`.
- [ ] Remove any callback route from the new definition. JSON serialization of
  every built-in formula, instance, and rule must be lossless.
- [ ] Return raw numerator/denominator quantity semantics (kind, semantic unit,
  and basis/population reference) alongside values; presentation
  `displayUnit` is never treated as raw dimensional metadata.
- [ ] Require presentation scale finite and strictly positive. Derive display
  value only after raw calculation. A display-scale overflow
  yields null presentation value plus a finding while preserving raw value.
- [ ] Return nested calculation/presentation, formula/instance IDs and versions,
  separately named amount-basis/count-population/exposure-basis reference
  arrays, all identity tags, component stats, rule results, and structured
  findings. Compute `semanticReferences` from the full evaluation dependency
  graph (including rule-only operands and their transitive derivations), exact-
  deduplicate/sort each matching semantic-ID array, while calculation values
  and fingerprints continue to use calculation dependencies only.
- [ ] Add hand-calculated tests for each family, including an aggregate-of-two
  counterexample whose result differs from the average of row ratios.
- [ ] Add numeric edge tests for missing numerator, missing denominator, zero
  and negative denominator, negative numerator, non-finite operands, raw-ratio
  overflow, display overflow, metric-rule expression overflow, synthetic
  aggregation-overflow readiness, inherited calculation-field overflow, and
  explicit zero. Do not claim a prepared-source or mapped-group integration
  test until Task 7.
- [ ] Add a frozen truth-table test for every operator in less/equal/greater
  states, exact positive/negative tolerance boundaries, absolute-only,
  relative-only, both, huge opposite-sign values without subtraction overflow,
  tolerance overflow, missing operands, rule order, duplicate IDs, and
  concurrent triggered + not-evaluated rules.
- [ ] Add tests proving two presentations of the same calculation have identical
  raw values and calculation fingerprints.
- [ ] Add a rule-only measure on a unique basis and prove it appears in
  components/`semanticReferences` and can affect rule readiness without moving
  the calculation fingerprint; constants/calculation-field operands add no
  semantic reference.
- [ ] Update and test the complete core declaration snapshot for all Task 3
  exports, including `DiagnosticMeasureStats`, the readonly six-template
  constant, and nonoptional nullable rule-evaluation code/message fields.
- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core -- diagnosticFormulas.test.ts diagnosticRules.test.ts diagnosticDefinitions.test.ts diagnosticPublicApi.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/core
  ```

- [ ] Commit: `feat(core)!: separate diagnostic formulas bindings and presentation`.

### Task 3 acceptance

- Exactly six standard templates exist.
- Template definitions contain no basis-specific names.
- All required components are compiler-derived.
- No executable warning callback exists in the public type surface.

---

## Task 4: Generalize claim-level measure derivation

**Purpose:** model caps and layers as data preparation, not formulas.

**Files:**

- Create: `packages/core/src/diagnosticDerivations.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/diagnosticDerivations.test.ts`
- Test: `packages/core/test/diagnosticDefinitions.test.ts`
- Test: `packages/core/test/diagnosticPublicApi.test.ts`
- Regression: `packages/core/test/capping.test.ts`

**Produces:** `deriveDiagnosticClaimMeasures` and the internal quality-aware
runtime evaluator for the Task 2-authored claim/derived contract.

### Steps

- [ ] Write failing tests for direct copy, add, subtract, claim layer, and split
  capped-indemnity-plus-unlimited-expense derivations.
- [ ] Execute `claim-layer` only from Task 2's compiler-proven plan: finite
  layers use `min(max(value - attachment, 0), limit)` per claim row, where
  `limit` is width; `limit: null` is honest unlimited excess
  `max(value - attachment, 0)`. Do not repeat graph/basis validation in the hot
  path.
- [ ] Before producing any output, authenticate the compiled definition and
  validate the complete input row batch atomically. Reject an aggregate-grain
  compiled definition, malformed row/measure containers, or any row that
  already supplies a declared derived output. Selected-population record/claim
  identity validation belongs only to Task 7 preparation; this generic helper
  is row-local. Null and non-finite numeric leaves are quality states, not
  shape exceptions. Retrieve the deterministic topological plan from the
  compiler's private state so chained outputs cannot be reordered by callers.
- [ ] Make the public helper accept the opaque `CompiledDiagnosticDefinition`,
  not a loose derivation array, so catalog/basis/graph/grain checks cannot be
  bypassed. Propagate null/non-finite inputs to null outputs and never turn them
  into zero. The standalone returned rows are intentionally value-only. The
  internal evaluator must implement the exact quality precedence non-finite or
  finite-input expression overflow → non-finite; else missing → missing; else
  observed, normalize mixed non-finite kinds to `nan`, and retain each original
  non-cascading expression path. Task 7 applies the output measure's missing
  policy, creates imputed-zero only for missing (never non-finite), and carries
  transitive quality through chained derivations into stats/findings/rules.
- [ ] Make the helper generic over any `{ measures }` row and preserve its
  identity fields, caller order, arbitrary extra fields, and all existing
  measures without mutation. The public diagnostic loss-row contract itself
  does not carry arbitrary dimensions.
- [ ] Add the load-bearing counterexample: two claims above a limit must equal
  the sum of individually limited values and must differ from limiting their
  aggregate.
- [ ] Test unlimited ground-up, honest unlimited excess (`limit: null`), finite
  layer width, pre-limited pass-through with an external artifact reference,
  zero/negative source values, multiple bases, and split indemnity/expense.
- [ ] In runtime tests, consume compiler-approved definitions covering
  unlimited ground-up/excess, finite layers, exact-basis subtraction,
  disjoint-component addition, separate paid/incurred graphs, and capped
  indemnity plus unlimited expense. Keep rejection and identity-mutation tests
  for invalid layer/basis/graph shapes in Task 2, where the compiler owns them.
- [ ] Record the public-path counterexample for Task 7: claim observations →
  derived measures → source-cell aggregation → exposure attachment → runner.
  Task 4 owns the derivation-unit proof; Task 7 owns integration because the
  preparation and runner surfaces do not exist yet.
- [ ] Add direct and chained quality tests for missing input under both output
  missing policies, each non-finite kind, mixed kinds, finite-input add/subtract
  overflow, separate path retention, no ancestor/repropagation duplicates, and
  downstream rule readiness. The value-only helper stays null in every
  non-observed case even when preparation later imputes a derived output.
- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core -- diagnosticDerivations.test.ts capping.test.ts diagnosticPublicApi.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/core
  ```

- [ ] Commit: `feat(core)!: generalize claim-level diagnostic measures`.

### Task 4 acceptance

- No aggregate-level API accepts `claim-layer`.
- Existing `capClaims` output and public API are unchanged.
- Derivation validation completes before any output row is produced.

---

## Task 5: Implement definition-driven aggregation and exposure timing

**Purpose:** make missingness and exposure behavior explicit per measure while
retaining auditable deterministic batch statistics. This task builds
period-agnostic primitives; Task 7 composes them with Task 6's normalizer into
the public preparation seam.

**Files:**

- Create: `packages/core/src/diagnosticAggregation.ts`
- Create: `packages/core/src/diagnosticExposure.ts`
- Create: `packages/core/test/diagnosticAggregation.test.ts`
- Create: `packages/core/test/diagnosticExposure.test.ts`
- Migrate later: `packages/core/test/metricDiagnostics.test.ts`

**Produces:** period-agnostic catalog-aware loss aggregation, long-form exposure
identity reconciliation and timing-aware attachment primitives, retained leaf
contributions, deterministic batch finalization, nullable component statistics,
and neutral structural findings. These primitives accept already canonical
cell coordinates and never parse period labels. Task 7 is the sole owner of the
public immutable `prepareDiagnosticData` composition. The new path exposes no
arbitrary partial-aggregate merge API; legacy exports remain only until the old
runner/tests are replaced and Task 15 removes them at a whole-repository green
boundary.

### Steps

- [ ] Write failing tests with `missing: "unknown"` and `missing: "zero"`
  count/amount measures present in the same loss rows, plus a compiler test
  proving exposure measures reject zero imputation.
- [ ] Replace discovery-by-object-union with catalog-driven aggregation. Loss
  rows are expected to carry only declared loss measures; exposure observations
  are evaluated only against their declared `measureId`.
- [ ] Keep this layer period-agnostic: its cell inputs carry canonical origin,
  valuation, development age, and age unit supplied by an orchestrator. Unit
  tests hand it explicit canonical coordinates. It must not parse, alias,
  order, filter, or independently normalize period labels; Task 6 implements
  that concern and Task 7 composes the two layers.
- [ ] Apply explicit loss-row grain to canonical inputs: all `recordId` values
  must be unique across the already-selected population; distinct
  `DiagnosticClaimObservation` claims may share a source cell and are summed,
  while a second observation for the same
  `(claimId, sourceGroup, origin, valuation)` or an aggregate-grain second
  canonical source cell is blocked from calculation with reviewable structural
  findings. Treat claim IDs as selected-population-global; repeated
  valuations must preserve source group and origin, or every affected cell
  fails closed. Pin the
  two-record/one-claim cap overstatement and migrating-claim counterexamples.
  The raw row-discriminator/period normalization ordering is integrated in
  Task 7, where both input forms exist together.
- [ ] Retain `sum`, `observed`, `missing`, `nonFinite`, `imputedZero`,
  `deduplicated`, and `structural` for every declared measure, including
  measures absent from every row. Contributions are a safe discriminated union:
  no prepared object may retain `NaN` or infinity, and structural exposure
  ambiguity is retained separately as normalized per-measure blockers. Every
  contribution has a normalized `sources[]` union (never a lossy singular
  source); ordinary loss contributions have zero/one source and deduplicated
  origin-static contributions retain all copy sources.
- [ ] Define `structural` as the exact count of distinct blockers for that
  measure. Group mapping unions/deduplicates blockers before recomputing stats;
  any blocker forces sum/value null so a valid mapped group cannot wash out an
  invalid one.
- [ ] Define zero imputation precisely: it applies only to a missing field on an
  otherwise valid expected loss row. It cannot synthesize an absent loss cell,
  exposure observation, source group, or valuation.
- [ ] Do not infer source-group completeness. Only Task 7's explicit expected
  grid can assert an otherwise absent cell; it creates a review finding/gate
  effect, never a numeric source cell. A missing required exposure in an
  existing loss cell remains a null component.
- [ ] Define the required-exposure set as every declared
  `kind: "exposure"`, `source: "exposure"` catalog measure, independent of a
  later `instanceIds` selection. Build components, missing-join findings, and
  blockers from that definition-wide set; optional/irrelevant exposures belong
  in a separate definition, not an implicit reachability exception.
- [ ] Sort finite contributors by canonical source group/origin/valuation,
  measure ID, and loss-row/exposure-key identity,
  apply the specified Neumaier compensated sum once, normalize signed zero,
  and prove exact row-permutation invariance. Group mapping must gather/sort
  the prepared leaf contributions rather than add rounded source-group totals.
- [ ] Stop all new code from using `aggregateMeasures`,
  `mergeMeasureAggregates`, and `finalizeMeasureAggregate`. Keep them only as
  temporary legacy implementation until Task 7 rewrites the old runner/tests;
  Task 15 removes their exports and activates the negative declaration gate. Do
  not claim arbitrary partition associativity for IEEE-754 numbers.
- [ ] Make exposed `sum` nullable. A non-finite contributor or aggregate
  overflow forces both `sum` and `value` null under either missing policy;
  pin cancellation, subnormal, signed-zero, `Number.MAX_VALUE`, and overflow
  serialization tests.
- [ ] Implement the clean-break long exposure observation shape with required
  `complete: boolean`:
  `key`, `sourceGroup`, `origin`, optional `valuation`, `measureId`, `value`,
  `complete`, and optional structured source location. Row-level dimensions are
  intentionally absent; only the runner's explicit `groupDimensions` map can
  supply output metadata.
- [ ] Implement origin-static identity `(measureId, key)`:

  - equality compares the full audited numeric state, source group, origin,
    and completeness: observed values use signed-zero-normalized numeric
    equality, missing equals missing, and non-finite equals only the same
    `nonFiniteKind`; different statuses/kinds conflict; valuation and source
    location are ignored, then normalized source locations are unioned;
  - equal complete, finite-observed valuation copies deduplicate; equal
    missing/non-finite/incomplete copies remain separate observations in one
    invalid reconciled record and create no contribution;
  - permitted identical valid copies add no structural warning (retain a
    dedupe audit count instead: one/two/three observations report exactly
    zero/one/two suppressed observations, and that count travels on every
    attached static exposure contribution);
  - different stable keys with equal values remain distinct;
  - conflicting value/source-group/origin/completeness fails the affected measure and
    origin closed; and
  - revision selection remains caller-owned.

- [ ] Implement valuation-specific identity `(measureId, key, valuation)`:

  - valuation is definition-aware required input; Task 7's public preparation
    and Task 9's unknown boundary reject its absence atomically with the same
    typed code/path before an audit exists;
  - the same key may change across valuations;
  - a duplicate exact identity always adds `duplicate`; add `conflict` iff the
    full audited numeric state, source group, origin, or completeness differs,
    using the origin-static value-state comparator and ignoring source
    location;
  - conflicts at one valuation affect only that cell; and
  - later valuations never supply earlier cells.

- [ ] Make reconciled exposure audit output the exact discriminated union from
  the spec. Valid identities carry one resolved source-group/origin, a
  timing-applicable valuation only for valuation-specific measures, finite
  value, `N - 1` suppressed-identical-static-copy count, and sorted sources.
  Invalid identities use `status: "invalid"` plus every applicable
  issue in fixed order `missing`, `incomplete`, `non-finite`, `duplicate`,
  `conflict`, null value, and all safe audited observations; no primary-status
  choice or first-record-wins coordinate may hide a second defect. Total
  absence is the separate `loss-without-exposure` cell finding, while
  `missing` means an explicit null observation. Pin mixed duplicate +
  incomplete + non-finite/conflicting examples and mapped-cell dedupe stats.
  Add repeated-null, repeated same-kind non-finite, mixed non-finite kinds, and
  missing-versus-non-finite cohorts under both timing modes; pin the exact
  issue arrays and prove equal non-observed copies remain invalid without a
  spurious conflict while every valuation-specific duplicate still carries
  `duplicate`.
  Apply that rank only to the `issues` array; blockers/findings use the global
  Section 15 sort contract.

- [ ] Normalize valid reconciled records deterministically: origin-static
  records omit `valuation` even when retained copies carry one or several
  different canonical copy valuations; valuation-specific records always
  include their canonical `valuation`. Preserve all copy valuations in the
  input audit/source evidence and pin permutation invariance for equal static
  copies with different valuations.

- [ ] Reconcile exposure source group/origin identities before group mapping.
  Attach reconciled exposures to canonical source cells here so every attached
  cell already contains retained contributions and finalized statistics for
  loss, derived, and exposure measures. Also retain the separate reconciled
  identity records for audit. Test static and valuation-specific measures
  together, incomplete observations, null/non-finite values, duplicate
  identical records, conflicting records, missing one valuation, and missing
  the entire exposure source. Filtered and mapped integration belongs to Task
  7.
- [ ] Prove a missing valuation-specific exposure for an existing loss cell
  fails closed in that attached cell. Record the expected-grid case for Task 7,
  which owns the public preparation input; never infer a grid from absent data.
- [ ] Test prototype-like IDs and groups through every map/index.
- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core -- diagnosticAggregation.test.ts diagnosticExposure.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/core
  ```

- [ ] Commit: `feat(core)!: make diagnostics aggregation and exposure measure-specific`.

### Task 5 acceptance

- Missing and explicit zero are distinguishable in every result.
- Zero policy never masks a missing exposure or source group.
- A batch over the same identified records is byte-reproducible across caller
  row permutations. No unsupported partial-merge guarantee is claimed.
- No exposure is double-counted or leaked across valuation.
- No caller of the prepared-cell contract must rejoin reconciled exposures.

---

## Task 6: Add explicit serializable period axes

**Purpose:** remove the quarterly assumption and silent lexical fallback from
generic diagnostics.

**Files:**

- Create: `packages/core/src/diagnosticPeriods.ts`
- Modify: `packages/core/src/periods.ts` only for reusable strict calendar helpers
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/diagnosticPeriods.test.ts`
- Modify: `packages/core/test/periods.test.ts`
- Test: `packages/core/test/diagnosticPublicApi.test.ts`

**Produces:** runtime normalization, numeric ordering, and one common-unit
development age for Task 2's already-compiled independent origin/valuation
calendar or ordered axes.

### Steps

- [ ] Preserve every existing public quarter helper and its tests. They remain
  useful standalone adapters.
- [ ] Add strict monthly and annual parse/format/index helpers with no native
  `Date` parsing and no locale dependence. Lock the exact calendar grammar:
  quarterly `YYYYQn` / `YYYY-Qn` / `Qn YYYY` with uppercase Q, monthly
  `YYYY-MM`, annual `YYYY`, exactly four year digits, and no surrounding or
  extra whitespace; reject every case/width/locale variant outside it.
- [ ] Implement pure runtime coordinate normalization for Task 2's calendar
  axes with independent `originCadence` and `valuationCadence`, independent
  start/end-exclusive anchors, month as the common coordinate unit, and
  safe-integer `ageOffset`. Do not redefine the authored schema or identity
  projection.
- [ ] Implement the corresponding runtime lookup/order helpers for Task 2's
  ordered axes: separate normalized origin and valuation catalogs, exact labels
  and aliases, preserved safe-integer coordinate gaps, shared caller unit, and
  safe-integer offset.
- [ ] Derive age only as
  `valuationCoordinate - originCoordinate + ageOffset`. Compile aliases to one
  canonical label. Preserve Task 2's compiler validation of the axis catalog,
  including collisions, duplicate coordinates, and unsafe coordinate/offset
  scalars; the compiler cannot inspect run rows. Expose pure coordinate/age helpers for Task 7,
  where invalid observed rows become excluded audited findings, invalid
  filter/cutoff/expected-cell configuration rejects atomically, and view ages
  are validated at the view call. Normalize coordinate catalogs numerically;
  preserve intentional gaps.
- [ ] Replace diagnostic input `ageMonths` with engine-derived
  `developmentAge` and `ageUnit` on results and findings. Filters become
  `minDevelopmentAge` / `maxDevelopmentAge`.
- [ ] Add tests for:

  - all accepted quarter spellings and Q4→Q1;
  - monthly year boundaries and leap-month irrelevance;
  - annual origins/valuations;
  - age offsets 0, 1, 3, and 12;
  - annual origins with quarterly valuations and annual origins with monthly
    valuations under start/end anchors;
  - a Q3–Q2 fiscal ordered axis;
  - arbitrary labels whose lexical order is wrong;
  - explicit aliases and duplicate normalized cells;
  - unknown labels, reversal, preserved gaps, safe-integer extremes whose
    subtraction/offset overflows, and invalid definitions; and
  - pure coordinate ordering helpers from normalized coordinates.

- [ ] Record filter/cutoff/expected-cell/view phase tests for Task 7; do not add
  them prematurely to Task 6 before those public inputs and helpers exist.

- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core -- periods.test.ts diagnosticPeriods.test.ts diagnosticPublicApi.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/core
  ```

- [ ] Commit: `feat(core)!: make diagnostic period semantics explicit`.

### Task 6 acceptance

- All period descriptors are JSON-round-trippable.
- The new period-axis helpers have no lexical fallback; Task 7 owns the guard
  against a generic runner importing the legacy quarter parser.
- Development age is derived, not trusted from a row.
- Existing quarter utilities remain source-compatible outside diagnostics.

---

## Task 7: Rebuild the diagnostic runner and all views around compiled definitions

**Purpose:** integrate definitions, aggregation, exposure, periods, formulas,
rules, filters, group mapping, and views through one canonical emergence path.

**Files:**

- Create: `packages/core/src/diagnosticPreparation.ts`
- Rewrite: `packages/core/src/metricDiagnostics.ts`
- Modify: `packages/core/src/index.ts`
- Rewrite/split: `packages/core/test/metricDiagnostics.test.ts`
- Modify: `packages/core/test/customizationTypes.test.ts`
- Test: `packages/core/test/diagnosticPublicApi.test.ts`
- Regression: all `packages/core/test/*.test.ts`

**Produces:** the public immutable `prepareDiagnosticData` seam,
`runMetricDiagnostics`, diagnostic emergence, metric triangles, latest
diagonal, same-maturity view, and common-maturity view over the new result
contract.

### Steps

- [ ] Write the new runner signature first:

  ```ts
  const prepared = prepareDiagnosticData({
    definition, losses, exposures, filter, completePeriodCutoffs, expectedCells,
  });
  runMetricDiagnostics({
    prepared,
    groupMap,
    groupDimensions,
  });
  ```

  Preparation must receive a compiled definition. The runner must consume that
  immutable prepared object and must not accept/re-normalize raw rows, loose
  metric arrays, a global sparse policy, or a hidden period convention.
- [ ] Extend expected cells with optional structured source location and
  implement the spec's exact six-phase preparation pipeline after atomic
  configuration validation: audit/raw-source selection → period normalization
  → cutoff → remaining filters → provisional selected-population validation
  and reconciliation → arithmetic. A terminal earlier disposition prevents
  later checks; final array sort rank is not processing precedence.
- [ ] Before any audit exists, normalize/validate the complete expected grid
  and reject duplicate canonical cells globally, including alias-equivalent
  cells that a later filter or cutoff would exclude. Also reject a known
  valuation-specific exposure without `valuation` as
  `INVALID_DIAGNOSTIC_INPUT`, and reject any row `rowType` that differs from
  `definition.lossRowGrain` with issue code `invalid-input-relationship` at
  `$.losses[index].rowType`. Direct core preparation and Task 9's data boundary
  must return the same full code/path issue array, and none of these phase-0
  failures may produce an audit or prepared object.
- [ ] Build exactly one `DiagnosticInputAuditRecord` for every loss, exposure,
  and expected-cell input surviving phase 0. Retain the complete
  semantic snapshot, safe non-finite sentinel, explicit null source, and
  multiplicity. Implement the exhaustive condition/disposition matrix:
  missing/null/non-finite loss fields stay on retained rows as quality
  contributions; invalid loss contracts/identities make every selected cohort
  member invalid; incomplete/null/non-finite/duplicate/conflicting exposures
  enter reconciliation then make every cohort observation invalid with all
  issues; equal static copies all remain retained but yield one deduplicated
  exposure; exposure-without-loss stays retained; missing joins/expected cells
  do not invalidate their valid rows. Only final retained rows/reconciled-valid
  exposures enter arithmetic.
- [ ] Implement `prepareDiagnosticData` as the only raw-input composition path
  used by both data review and the runner. It returns canonical source cells,
  reconciled exposure audit records, expected cells, neutral structural
  findings, and immutable contributions/stats for every applicable loss,
  derived, and exposure measure. It never applies group mapping or evaluates a
  metric instance. Return only a deep-frozen, module-private-branded value and
  export the owner-controlled `assertPreparedDiagnosticData` runtime assertion
  plus `verifyPreparedDiagnosticDataIntegrity`, which recomputes the tag with
  core's private normalizer for cross-package callers. Also export
  `getPreparedDiagnosticDataIdentity`, which authenticates the object and
  returns its deeply frozen `NormalizedDiagnosticPreparationIdentity` so
  downstream packages receive normalized filter, audit, cutoff, expected-grid,
  cell, exposure, and finding shapes without rebuilding them. Data/compliance
  must not duplicate that payload. Back authenticity with a private
  `WeakSet` or equivalent noncopyable mechanism; reject deserialized/forged
  lookalikes and copied enumerable symbols at both boundaries.
- [ ] In preparation, normalize origin/valuation through the compiled period
  axis before filters or bucket keys are applied. Unknown row labels,
  valuation-before-origin, unsafe/negative derived ages, duplicate/conflicting
  selected-population loss identities, and undeclared/wrong-source row measure
  keys are reviewable
  dataset relationships: exclude the invalid row from arithmetic and retain
  the exact top-level structural finding. Invalid definition catalogs and run
  configuration—unknown filter/cutoff labels, reversed ranges,
  negative/non-safe-integer development-age bounds, malformed Zod
  scalars—still reject atomically. Test this seam explicitly so a report is not
  promised for an exception path.
- [ ] Apply timing-specific selection exactly. Origin-static copies honor raw
  source-group and origin selectors/ranges plus `originThrough`, but ignore
  valuation selectors/ranges, development-age filters, and
  `valuationThrough`; an optional copy valuation is still normalized and
  period-validated for audit. Reconcile selected copies only after applicable
  selection, then attach once to every matching retained loss cell.
  Valuation-specific exposures, losses, and expected cells honor both axes,
  age filters, and both cutoffs.
- [ ] Give an undeclared/wrong-source exposure the spec's unknown-timing path:
  apply source and origin selection/cutoff; normalize and validate an optional
  valuation only for audit/period validity; never apply valuation/age filters
  or `valuationThrough`; then mark a surviving row invalid with its contract
  finding and omit it from `prepared.exposures`. Pin absence/presence/invalid
  optional valuation, source/origin exclusions, ignored valuation filters, and
  phase precedence where an earlier period failure suppresses the later
  contract check.
- [ ] Normalize and apply at most one executable complete-period cutoff per
  source group to losses, exposures, and expected cells after coordinate
  normalization and before derivation/aggregation. Store the normalized set;
  do not let compliance accept an independent copy later.
- [ ] After global expected-grid validation, give each expected record the
  ordinary source-filter/cutoff/remaining-filter/retained audit disposition;
  sort the retained grid by source group and numeric coordinates. Pin
  duplicate, alias-collision, row-order, omitted-versus-explicit-empty cases,
  and alias-equivalent duplicates beyond a cutoff still rejecting atomically.
- [ ] Keep row-discriminator mismatch in the atomic phase-0 error path above.
  Record fail-closed blockers/findings for duplicate loss `recordId` values, duplicate
  claim/cell snapshots, and—under aggregate grain—duplicate normalized source
  group/origin/valuation snapshots before mapping; for claim grain, allow and
  deterministically sum distinct IDs in the same source cell.
- [ ] In preparation for claim grain, execute the compiled derivation graph
  before source-cell aggregation. Then invoke Task 5's one exposure
  reconciliation/attachment path so each prepared source cell is already
  complete for calculation or explicitly null with findings. Preserve the
  separate reconciled records only as audit evidence; neither data review nor
  the runner may rejoin them.
- [ ] Materialize every definition-wide required exposure measure in each
  timing-applicable retained loss cell before any `instanceIds` selection.
  Prove an unselected/otherwise-unused declared exposure can still produce the
  exact missing join and blocker, and that a different definition omitting the
  measure does not.
- [ ] Compute `preparationFingerprint` over the exact versioned payload from
  the spec, including normalized filter/cutoffs, expected-grid supplied flag,
  the complete pre-exclusion input audit, exposure-attached cells, safe
  contributions, stats, blockers, findings,
  reconciled audits, and expected cells. Omitted `expectedCells` and an
  explicitly empty grid must produce distinct identities. Verify the genuine
  prepared object, reject a forged/copy-tag lookalike, and pin delegation to
  `verifyPreparedDiagnosticDataIntegrity` for later compliance use.
  Implement the exact exported `NormalizedDiagnosticPreparationIdentity`, full
  normalized filter, expected-cell/source-location projections, keys/nesting,
  and omission rules; never hash a spread of the branded prepared object. Pin
  `getPreparedDiagnosticDataIdentity` to the exact body used by the preparation
  tag, deep-freeze it, and prove sparse authored filter/source fields become
  explicit normalized nulls while omitted versus empty selections remain
  distinct.
- [ ] Apply caller group mapping only in the runner. Gather all mapped loss,
  derived, and exposure leaf contributions in canonical order, recompute final
  stats once. Every prepared and mapped emergence component map must have the
  exact code-unit-sorted ID set of **all** definition measures, independent of
  selected instances; metric-local component maps contain only that
  instance's full evaluation dependencies. Output dimensions for every
  singleton or combined group come only from explicit `groupDimensions`; there
  is no row-level fallback.
- [ ] Make group behavior exact: missing `groupMap` keys map source groups to
  themselves; supplied keys must be present after source filtering; target IDs
  must be non-empty. Reject unknown/unused keys. Permit prototype-like strings
  as safe own keys. Treat `groupDimensions` as an optional sparse map whose
  supplied keys must exactly belong to the produced output-group set; reject
  unused keys and non-JSON values, while a missing key emits no dimensions.
- [ ] Export `validateDiagnosticGroupingConfiguration` from core and have the
  data orchestrator call it immediately after preparation and before review.
  It validates group maps, dimensions, produced groups, and post-map
  `outputGroups` without evaluating a metric; `runMetricDiagnostics` reuses the
  same internal validator. Invalid post-map configuration must never consume
  review work or appear as a blocked actuarial outcome.
- [ ] Apply `sourceGroups` filters before mapping and `outputGroups` after it;
  retain every coordinate/age filter in the exact public contract. Assert that
  no policy-period filter exists: aligned policy-period loss/exposure selection
  is an upstream, provenance-recorded preparation responsibility.
- [ ] Normalize every set-like filter array by rejecting blanks, exact
  deduplication, and code-unit sorting. Preserve the difference between an
  omitted array and an explicit empty selection. Normalize range endpoints via
  the relevant axis before filtering and identity hashing. Apply all populated
  predicates conjunctively and reject unknown labels/instances/groups,
  reversed ranges, either age bound unless it is a nonnegative safe integer,
  or inverted development-age bounds.
- [ ] In the runner, evaluate every selected instance in declared order from
  the already complete prepared components. Adapt source-cell and mapped-group
  finalized values, sources, blockers, imputation, and overflow state exactly
  once into Task 3's internal evaluator input; do not give that pure evaluator
  a second path back to preparation. Add a guard test that fails if the runner
  attempts exposure identity reconciliation, a timing join, or period parsing.
  The source-level guard must prove `metricDiagnostics.ts` neither imports nor
  calls `parseQuarterPeriod` and contains no string-order fallback.
- [ ] Implement the exact finding topology: a metric gets prepared findings
  only for its evaluation dependencies plus its own calculation/presentation/
  rule findings; an emergence point unions its mapped-cell and selected-metric
  findings; `result.findings` unions every emergence finding plus unattached
  top-level prepared findings. Views alias the same objects. Pin exact
  deduplication and failure injection at prepared-cell, metric, emergence, and
  result levels.
- [ ] Add a reserving regression proving `runDiagnostics` still returns its
  existing `DiagnosticFinding` shape and `info | warning | critical` severity,
  while generalized results expose only `DiagnosticMetricFinding` with their
  separate `info | warning | fail` vocabulary. Pin both declarations and
  compile-fail cross-assignment in the public API tests.
- [ ] Implement the normative structural-blocker projection table, including
  all-loss-plus-derived blocking for a loss-row/cohort defect, named-measure
  blocking for exposure defects and missing joins, and top-level-only cases.
  Pin mixed valid-plus-invalid contributors in one cell, a conflict spanning
  several canonical cells, an incoherent origin-static exposure cohort, an
  invalid-only coordinate that fabricates no cell, and deterministic blocker
  union through group mapping. Every affected value remains null even when
  another valid row or mapped source group supplies a finite subtotal.
- [ ] Implement and snapshot the exact core generated-finding catalogs from the
  spec: structural codes/messages/severities and non-structural aggregation,
  calculation, rule-not-evaluated, and presentation codes. Implement every
  per-code canonical cohort/site, mandatory context field, source-union rule,
  and RFC 6901 pointer into normalized-definition expression nodes from the two
  normative tables; suppress cascading ancestor overflow findings. Prepared findings
  retain `sourceGroup` and gain `group` when mapped; metric-owned findings use
  only `group`. Keep caller strings in structured context instead of message
  interpolation; test exact deduplication/cardinality and metric-gate severity
  for every code.
- [ ] Make emergence the single canonical evaluated representation. Build every
  triangle and maturity view by projecting the same evaluation object
  references; no view may call formula evaluation. Triangle cells are explicit
  coordinate wrappers containing origin, valuation, development age/unit, and
  the exact emergence evaluation reference.
- [ ] Defensively construct and recursively freeze the complete result before
  returning it. Type the runner/views with `DiagnosticDeepReadonly` and test
  mutation attempts against emergence, triangle wrappers/value matrices,
  findings, and dimensions so projections cannot be desynchronized. Declaration
  tests must make `sameMaturity` and `commonMaturity` deeply readonly too; add
  compile-fail mutations through both helpers.
- [ ] Export `NormalizedDiagnosticResultIdentity` plus
  `getMetricDiagnosticsResultIdentity`. The accessor must retain every result
  field, recursively materialize the exact nullable source-location identity
  fields, return a deeply frozen canonical projection, and be the only public
  owner-normalization seam used for result hashing. Test optional/explicit-null
  source variants, row/input permutations, hostile locale, immutability, and
  byte equality for semantically identical results.
- [ ] Rename every diagnostic age field and filter to generic development-age
  terminology and include the one compiled-axis `ageUnit` at result top level
  as well as emergence/triangles/views, including empty results.
- [ ] Implement every exact canonical order before identity computation:
  input audit by kind/snapshot/disposition; prepared cells by source group and
  numeric origin/valuation coordinates; each emergence `sourceGroups` by code
  unit; emergence by output group and numeric coordinates; triangles by output
  group and selected compiled-instance order; triangle origins by numeric
  coordinate, ages numerically, and matrices on those axes; latest diagonal by
  emergence order. Normalize/deduplicate sources, blockers, and findings using
  the spec's total ordering without locale-sensitive comparison.
- [ ] Add integration tests for:

  - empty input and empty filtered selection;
  - one and multiple groups;
  - group maps and dimensions;
  - identity fallback, unknown/unused/empty mapping keys, sparse dimension
    cardinality, and prototype-like own keys;
  - all filter dimensions and independent origin/valuation cutoffs, including
    exact rejection of negative, fractional, and unsafe minimum/maximum
    development-age bounds plus `minDevelopmentAge > maxDevelopmentAge`;
  - per-source complete-period cutoffs and mismatched/duplicate cutoff errors;
  - expected-cell gaps detectable only with an explicit grid;
  - global expected-grid uniqueness before selection, duplicate/alias-
    colliding expected cells even beyond a cutoff, and grid permutation
    invariance;
  - ragged emergence and null triangle cells;
  - duplicate raw record IDs, duplicate claim/cell snapshots, duplicate
    aggregate cells, and valid same-claim-across-valuation/multi-claim cells;
  - every result view reconciling exact raw values, identities, stats, rules,
    and findings;
  - exact component membership: unselected calculation measures, rule-only
    measures, derived measures, and otherwise-unused required exposures remain
    in prepared/mapped emergence components, while each metric exposes only its
    evaluation dependencies; selection changes cannot silently erase the cell
    ledger;
  - latest diagonal under ragged maturity;
  - many-to-one grouping whose sources have different latest valuations,
    proving latest diagonal is selected after mapped emergence;
  - same maturity and selected-group common maturity: set-like group
    deduplication/code-unit order, omitted-versus-empty selection, unknown-group
    rejection, greatest age present in every selected group, no-common-age
    null result, invalid requested ages, exact point order, and `===` emergence
    references;
  - row reversal and deterministic output;
  - the global runtime comparator over source locations with every nullable
    field variant, absent-versus-null optional fields, numeric rows, booleans,
    unranked enums, and lexicographic source-ID/issue/source arrays (including
    prefix ties), proving insertion order and locale cannot move preparation or
    result bytes;
  - filtered-only, cutoff-only, invalid-only, and genuinely empty submissions,
    proving excluded-content identity sensitivity, complete input-audit
    multiplicity, source retention, and deterministic disposition ordering;
  - exact sorted `lossRecordIds` containing both claim and aggregate row IDs in
    their respective grains;
  - static + valuation exposure in one run;
  - timing-specific filter/cutoff behavior, including origin-static copies on
    excluded valuation labels still reconciling/attaching, source/origin
    exclusion taking effect, and an invalid optional static valuation becoming
    a period finding;
  - selected versus source-filtered/cutoff incomplete + non-finite duplicate
    exposure cohorts, proving only the selected cohort emits the complete
    issue/finding set;
  - source-cell and mapped-group aggregation overflow propagated into the
    complete `DiagnosticMetricEvaluation`, with exact original paths/sources,
    fixed readiness-reason order, one fail finding per true site, and one
    informational not-evaluated finding per affected rule; plus a
    calculation-field operand inheriting the original binding/formula
    overflow without a duplicate fail finding;
  - `N` equal static copies yielding `N` retained audits, one contribution,
    `deduplicated: N - 1`, and the full sorted `sources[]` union;
  - the Task 4 per-claim-before-aggregate limitation counterexample at the
    final public metric result;
  - arbitrary caller IDs including prototype-like strings; and
  - a deterministic 10,000-row performance guard that checks broad complexity
    without an unrealistically brittle wall-clock threshold.

- [ ] Keep the deterministic generated ratio-of-sums property loop and expand
  it to exact input-permutation invariance under canonical ordered compensated
  summation. Assert the complete preparation fingerprint and byte-equal
  canonical deep-readonly result payload—not only displayed values—across
  permutations. Task 13's compliance composition owns the tagged result-content
  fingerprint and adds the corresponding tag assertion there; Task 7 does not
  invent an otherwise-unspecified core fingerprint API. Seed the loop
  explicitly; do not add a runtime random dependency or an unsupported
  arbitrary-partition assertion.
- [ ] Update the complete core public declaration snapshot for every Task 4–7
  export, including audit records, prepared/result deep readonly fields,
  `NormalizedDiagnosticResultIdentity`, both owner-normalized identity
  accessors, `validateDiagnosticGroupingConfiguration`, and the maturity
  helpers. Run it
  at this green boundary rather than postponing accidental API drift to Task 15.
- [ ] Delete the old runner-only helpers made obsolete by extracted modules,
  including quarter fallback and global sparse finalization.
- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core -- metricDiagnostics.test.ts customizationTypes.test.ts diagnosticPublicApi.test.ts
  ```

- [ ] Do not commit a knowingly broken transition if the old casualty preset
  still imports the replaced runner surface. Carry this runner change directly
  into Task 8; Task 8 migrates the new preset, retains the isolated old surface
  for downstream compilation, and runs the full core suite. Carry that green
  but uncommitted core state directly into Task 9, which migrates data and owns
  the single atomic core/data commit.

### Task 7 acceptance

- Each view uses the exact canonical emergence evaluation.
- No result shape carries ambiguous flattened `value`/`scale` fields.
- Filters and group mapping do not change exposure timing semantics.
- Core execution and data review consume the exact same exposure-attached
  prepared cells; neither has a second normalization or join path.
- The new runner/view focused tests pass. Typecheck and the full-core/
  published-value green gate belong to the Task 8 green checkpoint because
  the old preset may still reference the removed surface between the tasks.

---

## Task 8: Replace the basis-specific casualty preset and migrate the fixture

**Purpose:** prove the generalization against the original motivating use case.

**Files:**

- Rewrite: `packages/core/src/casualtyDiagnostics.ts`
- Create temporarily: `packages/core/src/legacyDiagnostics.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/casualtyDiagnostics.test.ts`
- Modify: `packages/core/test/diagnosticPublicApi.test.ts`
- Modify: `packages/core/test/fixtures/quarterlyCasualty.ts`
- Modify: `packages/core/test/fixtures/quarterlyCasualty.md`
- Consume: `packages/core/test/fixtures/quarterlyCasualtyV05Golden.ts`
- Remove old preset assertions from: `packages/core/test/metricDiagnostics.test.ts`

**Produces:** `createCasualtyMetricInstances` without fixed amount bases. It
re-exports the one `CASUALTY_FORMULA_TEMPLATES` value owned by
`diagnosticFormulas.ts`; it must not define a second copy or an underspecified
cross-package `createCasualtyDiagnosticDefinition` convenience.

### Steps

- [ ] Write failing factory tests before replacing the old module.
- [ ] Lock the exact public input types from the spec—count bindings, amount
  bindings, and instance-ID-keyed presentation overrides—and the exact
  `readonly DiagnosticMetricInstance[]` return. Reject unknown override IDs and
  explicit `undefined` inside `createCasualtyMetricInstances` itself before it
  returns anything; the raw factory input never passes through data's run
  boundary.
- [ ] Snapshot every field of the spec's exact basis-neutral default
  presentation table: scale one, exact display names/descriptions/units, and
  role-based operand labels with no binding-ID interpolation, inferred currency,
  limit, or catalog prose. Prove per-million,
  percentage, currency, and bespoke wording are explicit overrides that leave
  formula/calculation identities unchanged while moving definition integrity.
- [ ] Implement the ten count instances once and the six amount instances for
  each caller `amountBinding`.
- [ ] Lock the exact ordered count IDs, six amount suffixes, and instance
  version `1.0.0` from the spec. Build amount IDs as
  `casualty/amount/{encodedBindingId}/{suffix}`, where the binding ID uses UTF-8
  RFC 3986 encoding with uppercase `%HH`. Reject blank IDs and unpaired UTF-16
  surrogates plus NUL and edge ASCII whitespace under the shared token rule;
  prove `/`, `%`, Unicode, `__proto__`, and encoding-collision cases are
  deterministic and unambiguous. Formula IDs never include the binding ID.
- [ ] Validate only factory-owned structure before producing output: required
  count/exposure keys, unique amount-binding IDs, finite positive presentation
  scale, and safe display overrides. Do not accept redundant caller-asserted
  `basisId`; the catalog-aware compiler derives and validates paid/incurred
  basis, kinds, units, and count populations.
- [ ] Attach the metric-local paid-over-incurred and negative-case predicates
  once to only their relevant paid-to-incurred and case-per-open instances.
  Snapshot the spec's exact rule IDs/codes, warning severity, zero tolerances,
  operands, messages, and not-evaluated behavior. Require the explicit
  `{ absolute: 0, relative: 0 }` representation so identities cannot drift by
  omission. The data review pack must not duplicate these relationships.
- [ ] Allow zero amount bindings so count-only diagnostics remain valid.
- [ ] Remove all hard-coded `$250K`, `$1M`, primary, and pre-capped default
  measures/bases/layers from production code.
- [ ] Rebuild the fixture with:

  - structured count-population and exposure-basis catalogs with paid,
    incurred, and reported declared cumulative; open, closed-no-pay, and
    closed-with-pay declared point-in-time; and exposure declared point-in-time
    with its honest origin-static timing;
  - caller-defined `$250K` pre-limited total basis with an external
    transformation artifact reference;
  - caller-defined primary `$1M` indemnity plus unlimited expense basis, also
    marked externally prepared because the historical fixture contains only
    aggregate primary columns and cannot prove claim-level capping;
  - caller-defined paid/incurred bindings for both bases;
  - explicit legacy-equivalent per-million frequency presentation overrides so
    scaled-value parity is configuration rather than a new global scale;
  - a caller-asserted layer-order rule with a resolved rationale artifact for
    the historical cross-basis comparison;
  - a calendar axis with quarterly origins and valuations; and
  - metric-local paid/incurred and negative-case predicates.

  Compile this complete definition as a holistic temporal-contract test. In
  particular, the cumulative paid-to-incurred and mixed cumulative/point-in-
  time case-per-open constraints must pass; count shares and the ordinary
  `reported - closedNoPay` bindings must also pass without treating their
  compatibility group as an implicit temporal-equality assertion.

- [ ] Compare the new outputs to `quarterlyCasualtyV05Golden` by an explicit
  old-ID→new-instance-ID migration map. Match every numeric value, numerator,
  denominator, coordinate, and equivalent warning.
- [ ] Assert exact counts:

  - standard formula templates: 6;
  - count-only instances: 10;
  - one amount basis: 16 total;
  - two amount bases: 22 total; and
  - unique calculation fingerprints: 16 or 22 as appropriate, while paired
    basis instances share formula fingerprints.

- [ ] Snapshot the complete generated ID/version sequence for zero, one, and
  two amount bindings and assert presentation override keys resolve only after
  the deterministic ID encoding step.
- [ ] Extend the core declaration snapshot with the exact factory inputs,
  readonly return type, formula-template re-export, and absence of a broad
  convenience constructor or legacy same-name overload.

- [ ] Add source scans over the new generalized definitions/default IDs to reject
  `250`, `250k`, `primary`, and currency symbols. Allow those strings only in
  explicit caller fixture configuration, the temporary isolated legacy module,
  and historical documents.
- [ ] Rewrite the fixture Markdown to distinguish six formulas from 16/22 bound
  instances and explain every basis assumption.
- [ ] Isolate only non-conflicting old types/helpers needed by downstream
  migration in the temporary legacy module. New code must not import it. The
  same-name old runner cannot coexist and must not gain a dual dispatcher, so
  the whole repository may be transitional only in this uncommitted checkpoint;
  Task 9 restores a green repository. Do not add aliases or extend the legacy
  module; Task 15 deletes it after every downstream consumer has migrated and
  activates the negative declaration assertions.
- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core -- casualtyDiagnostics.test.ts metricDiagnostics.test.ts customizationTypes.test.ts diagnosticPublicApi.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run build -w @actuarial-ts/core
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/core
  ```

- [ ] Inspect `packages/core/dist/index.d.ts` for the intended new exports and
  record the temporary legacy names that Task 15 must remove.
- [ ] Do not commit yet: the new `runMetricDiagnostics` contract conflicts with
  the old data-package wrapper under the same export name. Carry Tasks 7–8
  directly into Task 9; Task 9 migrates that consumer and creates the atomic
  green core+data boundary. Never implement a dual-shape runtime dispatcher.

### Task 8 acceptance

- The original two-basis numeric golden passes with no production formula
  duplication.
- Formula identity stays equal across bases; calculation identity changes.
- The new reference catalog contains no fixed layer or basis vocabulary; the
  isolated old surface has no new consumers and a named Task 15 deletion gate.
- Every count subtraction/share compiles only within one population, and every
  paid/incurred pair compiles only within one exact amount basis.
- The full core suite remains green.

---

## Task 9: Generalize the data-package Zod boundary

**Purpose:** validate the entire unknown dataset/definition/configuration before
core sees it, with the same semantics core compiles.

**Files:**

- Create: `packages/data/src/diagnosticDefinition.ts`
- Create: `packages/data/src/version.ts`
- Rewrite: `packages/data/src/diagnosticInput.ts`
- Modify: `packages/data/src/index.ts`
- Create: `packages/data/test/diagnosticDefinition.test.ts`
- Create: `packages/data/test/diagnosticPublicApi.test.ts`
- Rewrite: `packages/data/test/diagnosticInput.test.ts`
- Modify transitionally: `packages/compliance/test/diagnosticsBundle.test.ts`
- Regression: `packages/data/test/*.test.ts`

**Produces:** strict Zod schemas and public validators for a complete diagnostic
definition, discriminated claim observations/aggregate snapshots, long
exposure observations, source locations, review evidence, filters, group maps,
complete-period cutoffs, expected cells, the authored
`DiagnosticRunInput`/`DiagnosticExecutionPolicyInput` contract, and the opaque
`ValidatedDiagnosticRunInput`. Execution composition waits for Task 10's
review gate.

### Steps

- [ ] Export `DATA_PACKAGE_VERSION` and pin it to the data manifest. This is the
  actual runtime stamp consumed by compliance; Task 18 updates both together.

- [ ] Mirror each core discriminated union in Zod. Use `.strict()` for authored
  configuration and row containers; use explicit JSON-value schemas for
  caller metadata rather than `z.unknown()`.
- [ ] Validate recursive expression ASTs with bounded depth/node count and
  readable issue paths. Run an iterative resource preflight before recursive
  Zod descent so a 65-level or 10,001-node hostile input yields a normal issue
  rather than a JavaScript stack error.
- [ ] Require `diagnosticDefinitionVersion: "1.0.0"`, row discriminators, and
  explicit `complete: boolean` for losses and exposures. Zod rejects malformed
  scalar/object shapes, but array-level duplicates, incomplete observations,
  missing joins, and expected-grid gaps must reach review rather than vanish as
  schema failures.
- [ ] After the definition compiles, atomically reject a loss row whose
  `rowType` differs from `lossRowGrain` with
  `INVALID_DIAGNOSTIC_INPUT` / `invalid-input-relationship` at
  `$.losses[index].rowType`. Require exact parity with direct core preparation
  and prove there is no validated wrapper, audit, or prepared partial result.
- [ ] Require a non-empty loss `recordId`, a non-empty stable `claimId` on
  claim rows, and no `claimId` on aggregate rows at the shape boundary. Leave
  duplicate-record/claim-cell and longitudinal assignment relationships for
  prepared structural review rather than aborting the report.
- [ ] Require `sourceGroup` on loss and exposure inputs and reject the old
  ambiguous row-level `group` key. Reserve `group` for mapped result groups and
  generic non-diagnostic `DataFindingContext` use.
- [ ] Add one strict `DiagnosticSourceLocation` schema and reuse it on loss
  rows, exposure observations, expected cells, grouping assignments, and cached-formula
  evidence. Add strict schemas for `DiagnosticGroupingAssignment`,
  `DiagnosticCachedFormulaEvidence`, and `DiagnosticReviewEvidence`; default
  neither array silently, because absent evidence and reviewed-empty evidence
  have different provenance.
- [ ] Validate structured count populations, amount/exposure bases, limitation
  semantics, formula roles, bindings, presentation, derivations, rules,
  two-coordinate period axes, measure catalogs, and loss row grain. Do not add
  an unauthenticated caller `referencePack` label; portable trust comes from
  the complete normalized definition and its computed identities.
- [ ] Replace the wide exposure row schema with one-observation-per-measure and
  enforce timing-dependent valuation requirements after the definition is
  known. A declared valuation-specific measure without `valuation` rejects the
  complete call atomically as `INVALID_DIAGNOSTIC_INPUT` at the same canonical
  path as direct core preparation; an origin-static optional valuation is
  validated but remains provenance-only for selection.
- [ ] Remove `ageMonths` from accepted loss input. Reject it as an unknown key so
  stale callers fail loudly.
- [ ] Reject `undefined`, functions, Date/Map/Set, custom prototypes, circular
  metadata, and non-JSON definition/configuration/evidence/group metadata.
  Require finite numbers everywhere except raw loss measure values and exposure
  values: those programmatic inputs may be NaN/infinite solely so preparation
  can convert them immediately to audited sentinels and fail-closed findings.
  The owner-branded validated wrapper is the one temporary in-memory carrier;
  prove no raw non-finite number reaches canonical JSON, review/provenance, or
  any result/outcome beyond that wrapper.
- [ ] Reuse the exact string-class vectors from core for every record ID/key,
  source group, map key/target, rule code/message, ordered label/alias, evidence
  ID/formula/grouping key, source-location field, preset/dataset/rationale ID,
  and nested free-JSON string. Assert data and core report the same first path;
  never trim an invalid value into a valid one.
- [ ] Validate the **whole** definition and dataset, including source
  locations, review evidence, and expected cells, before reviewing, running, or
  persisting anything. Normalize all expected coordinates and reject duplicate
  canonical cells across the full submitted grid before filters/cutoffs, even
  when both duplicates would be excluded. No partial normalization may escape
  after a late issue.
- [ ] Call core's semantic compiler after structural Zod parsing; do not
  duplicate kind/basis/reference semantics in a way that can drift. Translate
  Zod issues and core failures to the public `DiagnosticValidationError`
  contract with exact issue codes, canonical paths, ordering, freezing, and
  same-problem parity rather than wrapping only the first message.
- [ ] Implement the spec's exact field-root domain table: definition;
  losses/exposures/review evidence as input; filters/cutoffs/expected grid/maps/
  dimensions/policy/preset/dataset IDs and unknown top-level keys as
  configuration; view arguments as view. Nested unknown keys and source
  locations inherit their owning root. Pin a mixed-domain error array and the
  first-domain-derived high-level code.
- [ ] Replace the old immediate-run convenience internals with an atomic
  branded `validateDiagnosticRunInput` result carrying the one compiled
  definition produced during validation, normalized cutoffs, explicit
  expected-grid null-versus-empty state, review-evidence null-versus-empty
  state, non-empty `runPresetId` and `datasetArtifactId` values or normalized
  `null`, JSON-safe group
  metadata, and the requested gate policy with its two set-like allowed arrays
  deduplicated into the fixed status/severity orders. The preset ID is bound here and
  carried unchanged through every Task 10 outcome; compliance must not accept
  a replacement ID after execution. Do not bypass
  or fabricate the Task 10 review report merely to keep
  `runValidatedMetricDiagnostics` convenient; complete that public convenience
  only after the review evaluator exists.
- [ ] Lock the exact authored strict object and omission rules from the spec:
  required possibly-empty `losses`; omitted exposures/cutoffs → `[]`; omitted
  filter/grid/evidence → `null` while explicit empty grid/evidence remains
  distinct; omitted maps → safe empty records; and omitted policy fields →
  review `pass|warning|not-evaluated`, metric `info|warning`, null rationale.
  Preserve explicit empty allowed sets, canonicalize their fixed orders,
  require a rationale when either admits fail, reject extra keys/explicit
  `undefined`, and carry dataset/preset IDs through every later outcome without
  relabeling.
- [ ] Migrate the compliance diagnostic fixture test's direct core invocation
  to the new compiled-definition → preparation → runner signature now. Its
  provenance assertions remain on the temporary legacy snapshot until Task 13,
  but no repository test may call the removed old runner shape.
- [ ] Add tests for every accepted union variant and for malformed shapes,
  unknown operators, unknown roles/measures/bases, duplicate IDs, timing
  violations, malformed source coordinates, blank preset/dataset-artifact IDs,
  grouping evidence, cached-formula evidence, non-JSON metadata, stale
  `ageMonths`, omitted/null/empty distinctions, partial policy defaults,
  explicit empty gate arrays, negative/fractional/unsafe development-age
  bounds and inverted bounds, fail-without-rationale, valuation-specific
  missing valuation, global expected-grid alias duplicates beyond a cutoff,
  and deterministic complete multiple-issue arrays. Include one composed
  multi-domain vector proving definition → input → configuration ordering,
  domain-derived high-level error code, and suppression only of checks that
  cannot safely run after an invalid definition node.
- [ ] Add data-to-core parity cases for the unknown-timing exposure selection
  rule and its omission from reconciled exposures, plus a definition-wide
  required exposure that remains required when every consuming instance is
  unselected. These are reviewable execution relationships, not premature Zod
  failures; the atomic missing-valuation and row-grain cases remain distinct.
- [ ] Add parity tests: a typed invalid definition rejected by core must also be
  rejected through data, and a data-validated definition must compile in core
  without semantic change. A spy test requires exactly one compiler call and
  proves a structural lookalike cannot forge the validated brand.
- [ ] Snapshot the complete Task 9 data diagnostics declaration surface,
  including normalized validated input, evidence inputs, and package version;
  Task 10 extends the same snapshot with report context, gates/outcomes, and the
  owner-controlled completed-run assertion.
- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/data -- diagnosticDefinition.test.ts diagnosticInput.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/data
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/data
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test
  ```

- [ ] Commit the atomic Tasks 7–9 boundary:
  `feat(core,data)!: generalize diagnostic execution and validation`.

### Task 9 acceptance

- Unknown configuration is validated atomically.
- Data and core agree on every semantic rejection.
- No public validation path accepts non-JSON behavioral metadata.
- No workspace or test imports the old `runMetricDiagnostics` call shape, and
  the whole repository is green at the commit boundary.

---

## Task 10: Split structural review from declarative semantic review

**Purpose:** retain useful data-quality coverage without treating one casualty
taxonomy as universal truth.

**Files:**

- Create: `packages/core/src/diagnosticReview.ts`
- Modify: `packages/core/src/diagnosticDefinitions.ts`
- Modify: `packages/core/src/diagnosticIdentity.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/diagnosticReview.test.ts`
- Modify: `packages/core/test/diagnosticPublicApi.test.ts`
- Rewrite: `packages/data/src/diagnosticReview.ts`
- Modify: `packages/data/src/diagnosticInput.ts`
- Create: `packages/data/src/casualtyDiagnosticReview.ts`
- Modify: `packages/data/src/review.ts`
- Modify: `packages/data/src/index.ts`
- Modify: `packages/agents/src/promotion.ts`
- Modify: `packages/agents/test/promotion.test.ts`
- Modify: `packages/compliance/src/disclosure.ts`
- Modify: `packages/compliance/test/disclosure.test.ts`
- Modify transitionally: `examples/real-world-loss-run/src/main.ts`
- Modify transitionally: `examples/real-world-loss-run/test/example.test.ts`
- Create: `packages/data/test/diagnosticStructuralReview.test.ts`
- Create: `packages/data/test/diagnosticRules.test.ts`
- Rewrite: `packages/data/test/diagnosticReview.test.ts`
- Modify: `packages/data/test/diagnosticPublicApi.test.ts`
- Modify: `packages/data/test/review.test.ts`

**Produces:** one core-owned generic `DiagnosticReviewRule` evaluator,
universal data structural checks, complete `DiagnosticReviewReceipt`, exact
`createCasualtyDiagnosticReviewRules` inputs/outputs, and the discriminated
`ValidatedMetricDiagnosticsOutcome` with pre- and post-calculation gates.

### Steps

- [ ] Enumerate the old 19 checks and classify each as:

  - universal structural;
  - generic declarative semantic; or
  - ancillary provenance/grouping check.

  Add a test table proving every old check has one explicit successor.
- [ ] Keep universal checks native: duplicate IDs, grain-aware duplicate cells,
  valuation-specific exposure duplicates (identical origin-static valuation
  copies are permitted/deduplicated), period validity,
  declared measure/source consistency, incomplete loss records,
  incomplete/conflicting exposure,
  loss/exposure join gaps, grouping conflicts, and cached-formula provenance.
  Do not classify an omitted declared measure on an otherwise valid row as a
  universal blocker; preserve the measure's `unknown`/`zero` policy. Required
  row identities/discriminators and malformed scalars belong to Zod.
- [ ] Implement the spec's exact 11-check structural/ancillary catalog in its
  fixed order, including IDs, constant messages, warning/fail defaults, and
  applicability. Implement the normative per-code cohort cardinality,
  mandatory context, and full normalized source-union table—never first-row
  provenance. Then append one aggregate check per definition review rule in
  declaration order. Reserve `diagnostic/structural/`; prove report order and
  fingerprint are invariant to input discovery order. Unknown row periods,
  unsafe row ages, duplicate identities, and wrong-source/undeclared row keys
  must arrive as prepared findings with invalid rows excluded—not throw before
  review—while malformed scalar/Zod and invalid run configuration still reject.
  Distinguish explicit null `missing-exposure-value` from total-absence
  `loss-without-exposure`. Project every preparation-owned structural finding
  through the core blocker/result topology exactly once. Keep grouping and
  cached-formula findings evidence-owned: they exist only in the data review
  report/receipt, review and run identities, execution review gate, and later
  compliance provenance—never in prepared/result findings or the metric gate.
- [ ] Accept the exact `PreparedDiagnosticData` returned by core plus
  `DiagnosticReviewEvidence | null`. `reviewPreparedDiagnosticData` is itself
  the strict public evidence boundary: first authenticate prepared data, then
  strict-Zod-validate the evidence, reject extras/explicit `undefined`/blank or
  non-finite scalars, and defensively clone/deep-freeze the normalized snapshot
  before evaluation and hashing. Composed runs call this same boundary and do
  not bypass it because Task 9 parsed an earlier copy. Direct-boundary evidence
  errors use domain `input` and root `$.evidence`, with the same relative
  suffix, message, and issue order as the composed `$.reviewEvidence` path. An
  unauthentic prepared value short-circuits evidence inspection with exactly
  one `input` / `invalid-input-relationship` issue at `$.prepared`, message
  `Prepared diagnostic data is not authentic`, and high-level code
  `INVALID_DIAGNOSTIC_INPUT`. Add direct-entry tests for every malformed class,
  direct/composed path parity, unauthentic-prepared precedence, and
  mutation-after-call identity stability. Then
  inspect its exposure-attached `cells`, reconciled exposure audit records, and
  preparation findings; it may not parse periods, re-aggregate loss rows, or
  redo an exposure timing join. Use grouping/cached-formula evidence only for
  their named ancillary checks.
- [ ] Implement `evaluateDiagnosticReviewRules` in core as the only numeric
  semantic-review seam. It authenticates the prepared object and uses core's
  private dependency/readiness indexes, expression evaluator, Neumaier
  accumulator/finalizer, period order, tolerance classifier, and layer proof.
  Return deeply frozen neutral evaluations. Data invokes it exactly once and
  only projects checks/findings/receipt/gates; forbid data/compliance copies of
  the arithmetic or imports of private core modules with source-level guards.
  Extend the core public declaration snapshot with every review rule,
  coordinate/scope/evaluation type and the exact evaluator signature/re-export;
  no data-owned duplicate may appear in declarations.
- [ ] Make review scope explicitly conservative and pre-map: review every cell
  surviving source/period/age filters and cutoffs. A source-group failure still
  blocks when that group is later excluded only by `outputGroups`; top-level
  review rules also run regardless of metric-only `instanceIds`. Pin both cases
  and document that an exact narrow review must use `sourceGroups` or a separate
  run.
- [ ] Update structured `DataCheck.findings` to retain every finding in the
  spec's deterministic order. Keep the existing 20-item limit only for rendered
  `details`; counts, review fingerprints, policy gates, and compliance may
  never operate on a truncated finding set.
- [ ] For each violated or required-not-evaluated top-level rule evaluation,
  project exactly one `DataFinding` keyed by rule ID plus canonical review
  scope, with mandatory rule/scope context and the same source union as the
  scope. Add per-code permutation/cardinality snapshots, including a
  multi-defect exposure cohort whose duplicate/conflict/completeness findings
  coexist without multiplying per observation.
- [ ] Make the cached-formula check follow the complete truth table: declaration
  false never findings; declaration true requires present source, valid
  nonempty formula, and an own finite cached value. Pin absent versus null
  cached values, blank/non-finite boundary rejection, and exactly one finding
  per evidence ID.
- [ ] Normalize `DataFinding` only over fields it actually owns: merge equal
  code/message/context values by unioning sources and apply the exact context
  ordering in the spec. Do not reuse the richer core `DiagnosticMetricFinding`
  category/severity/rule sort for the data report.
- [ ] Pin the global comparator in review identity with source locations that
  differ at each nullable field, absent versus present formula/cached values,
  false/true declared-source flags, numeric source rows, and lexicographic
  issue/source arrays including prefix ties. Permute input/evidence order and
  run under a hostile locale; normalized review bytes must remain identical.
- [ ] Implement and snapshot the spec's exact readonly
  `DataFindingContext`/`DataFinding`/`DataCheck`/`DataReviewReport` declarations:
  diagnostic context includes source group (with generic `group` retained for
  non-diagnostic reviewers), both normalized period
  labels, development age/unit, rule/measure/offending/grouping/cached-evidence
  IDs, record/claim/exposure IDs, the exact cell/pair/control review scope, and
  every source location; generic source-file/source-row fields remain available, while
  `ageMonths` is removed. `findings` is always a complete array, never optional.
- [ ] In that core seam, evaluate the schema-neutral semantic rule variants
  from the spec:
  `compare`, `reconcile`, `monotonic`, `layer-order`, and `control-total`.
- [ ] Evaluate rules over normalized period coordinates and declared measure
  expressions. Reuse core's exact overflow-safe three-way tolerance classifier;
  do not fork operator semantics. `compare.when` true emits a finding, while
  reconcile/monotonic/layer/control assertions true means pass. Use the shared
  checked expression evaluator: source-cell measure finalization overflow is
  `aggregation-overflow`. A cell/pair finite operation overflow is
  `expression-overflow` at its exact operation path and concrete coordinate.
  For control totals, both a selected-contribution leaf accumulator overflow
  (path to that exact `measureId` leaf) and a later finite-leaf `add`/`subtract`
  operation overflow (path to that exact operation node) are
  `expression-overflow` with `coordinate: null`. Each carries the exact failed
  site's source union; none may become pass or alias an earlier source-cell
  aggregation overflow.
- [ ] Implement exact scope/cardinality: cell rules once per selected source
  cell. For monotonic rules, form the union of source-group/origin partitions
  and valuation coordinates appearing in retained prepared cells or the
  selected normalized expected grid, numeric-axis-sort each partition, and
  evaluate every adjacent coordinate pair by resolving both exact endpoints.
  Never bridge a missing endpoint; observed A/C plus expected A/B/C yields A-B
  and B-C, while a partition with fewer than two coordinates yields none. With
  no expected coordinates for a partition, compare adjacent available cells
  and disclose that unobserved gaps were not inferable. Include expected-only
  partitions and prove caller/grid permutation invariance. Evaluate a control total once after its explicit
  valuation/latest/all-cells projection by gathering/finalizing each leaf's
  canonical contributions across the selection, never by summing rounded cell
  expressions. Reject `all-cells` when any transitive leaf is cumulative or an
  origin-static exposure attached at multiple valuations. For monotonic rules,
  accept expressions only when every transitive leaf is `cumulative` or
  `point-in-time`; allow either class (and a compatible pointwise mixture),
  preserve every leaf's declaration, and reject `incremental` or `unknown`.
  Reject incomparable layer units/bases. Pin cumulative paid, point-in-time
  status, mixed-compatible, incremental, unknown, cancellation, zero-selected-
  cells-as-missing, and origin-static double-count counterexamples.
- [ ] Compute `selectedContributionCount` exactly as the sum of contribution
  array lengths across unique selected source cells and exact-deduplicated
  syntactic expression-leaf measure IDs. Do not recount a derived measure's
  raw derivation inputs, blockers, repeated AST leaves, or suppressed static
  copies. Count all retained quality states and count one origin-static
  attachment in each selected cell. Pin it independently from
  `selectedCellCount`.
- [ ] For `layer-order`, implement the exact interval/component partial order
  for `compiler-proven`. Require every matched component—including unlimited
  components—to trace to the same ultimate raw measure leaf on both sides, and
  require at least one compiler-authenticated `claim-layer` operation in the
  comparison; equal intervals on unrelated raw measures are not proof. Permit
  the explicitly portable `caller-asserted` form
  only for same-currency, same-perspective amounts with a non-empty rationale
  artifact ID, retain the assertion mode in every evaluation, and leave
  artifact resolution to Task 13. The old source-defined `$250K` versus externally prepared primary
  fixture uses this honest asserted path rather than fake compiler proof.
- [ ] Make every rule produce pass/fail-or-warning/not-evaluated. Required input
  absence follows `missingInput` and can never produce pass.
- [ ] Pin both missing-input policies. `not-evaluated` retains null relation and
  all readiness reasons with the standard not-evaluated finding; `finding`
  produces a triggered evaluation with `triggerReason: "missing-input"` for
  ordinary readiness absence, `"aggregation-overflow"`,
  `"expression-overflow"`, or `"tolerance-overflow"` under the exact
  precedence in the spec, null relation, retained reasons, and the rule's
  code/description/severity. Every expression overflow additionally projects
  the fixed fail `diagnostic-expression-overflow` finding, irrespective of
  `missingInput`.
  Ordinary violations use `triggerReason: "predicate"`; passes and honest
  not-evaluated outcomes use null. Aggregate rule-check status must follow the
  exact overflow-fail → triggered-fail → triggered-warning → not-evaluated →
  pass precedence without hiding individual evaluations from the gate.
- [ ] Retain one structured `DiagnosticReviewRuleEvaluation` for every pass,
  trigger, and not-evaluated outcome, including coordinates, all readiness
  reasons, always-present exact `expressionOverflows`, and layer comparability
  mode/rationale ID. Include the full ordered evaluation array in the review
  receipt fingerprint and declaration snapshot.
- [ ] Define `DiagnosticReviewIdentityBody` exactly. Hash definition/preparation
  tags, normalized evidence, check ID/status/complete findings, summary, and all
  evaluations; exclude human check descriptions and capped details. Pin that
  detail wording/cap changes do not move `reportFingerprint`, while any
  identity-bearing finding/evaluation change does, including any overflow
  path, site, sources, or reason. Expose the exact deeply frozen owner-produced
  body as `DiagnosticReviewReceipt.identityBody`; its declaration and runtime
  value must be locked, and compliance must consume it rather than reconstruct
  a projection from receipt/report fields.
- [ ] Use the exact discriminated evaluation scope: compare/reconcile/layer
  rules retain one cell; monotonic retains both previous and current
  coordinates/ages; control totals retain normalized filter/projection,
  selected cell/contribution counts, and all sources. Pin left/right meaning
  for every rule kind exactly as the spec defines it. Cell and valuation-pair
  scopes also carry the sorted source union from both transitive operands,
  including partial source evidence on missing-input evaluations.
- [ ] Complete the composed path as `validateDiagnosticRunInput` performs
  Zod validation + compilation atomically exactly once, then
  `runValidatedMetricDiagnostics` consumes only that authentic validated value
  → `prepareDiagnosticData` exactly once →
  core grouping/output-selection preflight → structural/semantic review of
  that prepared object → execution gate → core
  run with the same object → metric-finding gate. Default to allowing review
  pass/warning/not-evaluated and metric info/warning while refusing fail in
  either gate. Return the exact review receipt, prepared/result identities, and
  applied gate receipt. A review-blocked outcome has no result; a metric-blocked
  outcome retains the deterministic result for human review; an explicit
  fail-allowing policy requires a non-empty rationale and can complete only
  after both gates. Even under an override, core nulls structurally ambiguous
  components.
- [ ] Evaluate the review gate against every aggregate check status and every
  rule evaluation mapped independently (`pass`, `not-evaluated`, or triggered
  severity). Add a mixed warning + not-evaluated test proving that allowing
  warnings alone cannot hide the not-evaluated outcome.
- [ ] Add an allowed-fail integration case containing a valid claim and an
  incomplete, duplicate, or measure-contract-invalid claim in the same source
  cell. Prove the override can complete for review purposes but every raw-loss
  and derived component covered by the structural blocker remains null; the
  policy must never approve a partial subtotal as the missing claim's value.
- [ ] Evaluate the metric gate only from canonical top-level `result.findings`,
  once, and only for aggregation/calculation/rule/presentation categories.
  Structural findings are already review-gated; do not recursively rescan
  metric/emergence findings. Inject one finding at every topology level and pin
  both gate outcome and no-double-count behavior.
- [ ] Carry the normalized `runPresetId` and `datasetArtifactId` from validated
  input unchanged through both blocked variants and the completed variant.
  Create/freeze each outcome wrapper and unbranded configuration snapshot, but
  preserve the exact already-frozen `prepared`, `review`, and `result`
  references. Never spread, deep-clone, or JSON-round-trip branded inner
  objects. Register genuine completed objects with a private authenticity
  mechanism, and export
  `assertCompletedValidatedMetricDiagnosticsRun` for compliance. Test forged
  lookalikes, copied symbols, and mutate-after-completion attempts.
- [ ] Extend the data declaration snapshot to cover every exact review
  coordinate/scope variant, receipt, report, gate/outcome branch, and runtime
  assertion with no legacy aliases.
- [ ] Atomically update all existing `DataCheck`/`DataReviewReport` producers
  and structural consumers—`packages/agents/src/promotion.ts`,
  `packages/compliance/src/disclosure.ts`, and the real-world example—to emit
  required complete `findings`, respect deep readonly inputs, and keep their
  established human output. Add their focused tests now so the full workspace
  remains green before Task 15; Task 16 may later rewrite the example's
  diagnostic flow but must not repair a knowingly broken shared type migration.
- [ ] Preserve structured finding context with source group, normalized
  origin, normalized valuation, development age, age unit, row/exposure key,
  and every relevant `DiagnosticSourceLocation`. Data review occurs before
  mapping and therefore never invents an output group; runner findings add the
  mapped group later. Conflicts may retain multiple source locations rather
  than arbitrarily choosing one.
- [ ] Add explicit alias/reference tests proving a completed outcome holds
  `outcome.prepared === prepared`, review consumed that same object, and every
  result view retains its core aliases after the outer outcome is frozen.
- [ ] Implement `createCasualtyDiagnosticReviewRules` as plain serializable data
  reproducing the old count reconciliation, CNP bounds, cumulative
  paid/reported, reopen signal, explicit nonpositive-exposure finding, layer
  order, and control-total behavior. Lock its exact monotonic/layer/control
  binding interfaces and readonly rule-array return in declaration tests.
  Snapshot all four fixed rules and every caller-bound rule field: exact order,
  IDs/codes/descriptions, expression term order, severity, explicit normalized
  zero/supplied tolerance, and missing-input behavior.
  Validate the raw factory input before returning any array: reject blank
  binding/rule IDs, duplicate IDs within or across monotonic/layer/control
  bindings, collisions with any of the four fixed rule IDs, unknown severity-
  override keys, extra keys, and explicit `undefined`. Pin every rejection at
  this factory boundary rather than relying on a later definition compiler.
  Paid/incurred and negative-case predicates are owned/evaluated only by their
  metric instances from Task 8; cross-reference those IDs in parity tests rather
  than emitting duplicate data-review findings. Compile and execute the fixed
  `closed-reopen-signal` against the point-in-time
  `add(closedNoPay, closedWithPay)` expression; this is a required end-to-end
  monotonic regression, not a cumulative relabeling.
- [ ] Prove an alternate status taxonomy
  `reported = open + CNP + CWP + reopened` works solely by configuration.
- [ ] Add positive, triggered, missing-input, mixed-outcome, severity override,
  exact six-operator truth-table, tolerance-overflow/boundary, missing-gap,
  output-cardinality, full evaluation-scope, and projection tests for every
  rule variant. For every
  variant, prove missing/imputed/non-finite/structural/aggregation-overflow
  dependencies cannot pass, even when a zero-imputed expression is numeric.
  Force finite-leaf expression overflow in compare, reconcile, monotonic, and
  layer-order. For control-total, separately force (a) selected-contribution
  overflow while finalizing one measure leaf and (b) overflow at a global
  `add`/`subtract` node after finite leaf finalization; require null coordinates,
  distinct exact leaf/operation paths, and no concrete-cell fabrication for
  both. Run every case under both missing-input policies. Pin exact path/site/source
  cardinality, no ancestor duplicates, standard fail finding coexistence,
  check-status precedence, gate result, and review-fingerprint mutation. Add a
  two-operand counterexample whose left subtree overflows while the right
  operand has unrelated sources: `context.sources` must retain only the failed
  site, `reviewScope.sources` must retain the complete operand union, and
  permutation/normalization must merge the arrays independently.
- [ ] Add exact parity tests against the existing quarterly fixture findings and
  a test that intentionally omits every optional semantic pack.
- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core -- diagnosticReview.test.ts diagnosticPublicApi.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/core
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/data -- diagnosticStructuralReview.test.ts diagnosticRules.test.ts diagnosticReview.test.ts review.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/data
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/data
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/agents -- promotion.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/compliance -- disclosure.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/example-real-world-loss-run
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test
  ```

- [ ] Commit: `refactor(core,data)!: make diagnostic review rules declarative`.

### Task 10 acceptance

- No production review function hard-codes the four casualty count measure
  names.
- All old useful checks have an explicit successor and parity evidence.
- Missing data never yields a false pass.
- Review and execution share object identity for the prepared input; a test
  spy proves compilation and preparation each occur once and no review-only
  join path exists.
- Metric-local fail findings participate in the recorded post-calculation gate,
  so paid-over-incurred parity is not deferred until after approval.

---

## Task 11: Add the typed `diagnostic-definition` interchange document

**Purpose:** make the portable definition a real semantic document whose
integrity is checked, rather than an opaque extension outside envelope
integrity.

**Wire decision:** write `interchangeVersion: "1.1.0"`, add
`kind: "diagnostic-definition"`, use semantic body key
`diagnosticDefinition`, keep all `1.0` schemas and frozen fixtures unchanged,
and do not add a diagnostic-result document in this release.

**Files:**

- Create: `packages/interchange/src/schemas/diagnosticDefinition.ts`
- Create: `packages/interchange/src/convert/diagnosticDefinition.ts`
- Modify: `packages/interchange/src/envelope.ts`
- Modify: `packages/interchange/src/parse.ts`
- Modify: `packages/interchange/src/schemas/manifest.ts`
- Modify: `packages/interchange/src/schemas/bundle.ts`
- Modify: `packages/interchange/src/index.ts`
- Modify: `packages/interchange/scripts/emit-schema.ts`
- Create: `packages/interchange/test/diagnosticDefinition.test.ts`
- Create: `packages/interchange/test/diagnosticPublicApi.test.ts`
- Modify: `packages/interchange/test/envelope.test.ts`
- Modify: `packages/interchange/test/schemas.test.ts`
- Modify: `packages/interchange/test/schemaDrift.test.ts`
- Modify: `packages/interchange/test/interopConformance.test.ts`
- Create: `schema/interchange/1.1/*.schema.json` (generated complete set)
- Preserve byte-for-byte: `schema/interchange/1.0/*`

**Produces:** `DiagnosticDefinitionDoc`, its Zod/JSON Schema, author/parse
helpers, and optional `diagnosticDefinitions` inside a wrapped bundle's
integrity-covered `interchange` body.

### Steps

- [ ] Add failing tests proving current `extensions` mutation does not change a
  triangle tag. Keep that existing behavior explicit; it motivates rather than
  gets "fixed" by changing the envelope's historical contract.
- [ ] Pin the existing opaque-extension boundary: malformed strings inside
  generic envelope `extensions`, and preserved same-major unknown fields,
  continue to parse and round-trip under the historical interchange contract,
  while every string in the diagnostic semantic body rejects according to the
  Section 5 matrix. Prove that no diagnostic behavior or identity can be
  supplied solely through either opaque location.
- [ ] Add `diagnostic-definition` to `DOCUMENT_KINDS`, semantic-body mapping,
  parser union, schema manifest, and public exports.
- [ ] Snapshot the complete interchange declaration addition: definition body,
  identity set, document, exact author/parse converters, and bundle wire field. Keep
  diagnostic results out of the reserving result unions.
- [ ] Implement the public converters with these exact signatures and no
  alternate alias: `diagnosticDefinitionToDoc(compiled,
  { createdAt, generator?, extensions? }): DiagnosticDefinitionDoc` and
  `docToDiagnosticDefinition(doc, options?: ParseDocumentOptions):
  { definition: CompiledDiagnosticDefinition; warnings: readonly string[] }`.
  The latter must route through `parseDocument`, require the diagnostic kind,
  return core's authentic compiled object, and preserve generic parse warnings.
- [ ] Set the writer constant to `1.1.0`; keep reader major acceptance at `1`.
  Test reading all committed `1.0.0` documents and writing the new version.
- [ ] Model the exact non-self-referential body
  `{ definition, identities: { algorithm, formulaById,
  calculationByInstanceId, definition } }` with Zod. Authored definitions
  contain no tags; its `definition` field is the exact
  `NormalizedDiagnosticDefinitionIdentity`, not the authored optional shape;
  require exact formula/instance key-set equality. Do not
  use a single `z.unknown()` escape for formulas, measures, bases, rules, axis,
  or identity tags.
- [ ] Make the wire schema structurally independent but semantically checked by
  core compilation. The converter must:

  - take a compiled core definition;
  - call core's owner-controlled compiled-definition assertion;
  - emit its normalized snapshot and recomputed identities;
  - stamp envelope integrity over the semantic body; and
  - parse back through Zod, verify envelope integrity, compile the body, and
    reject any identity mismatch.

- [ ] Round-trip and schema-test every normalized-definition default/order:
  null semantic IDs/prose/reference/filter, `{}` attributes, `[]` aliases,
  full tolerances and present filters, catalog/component/alias/set ordering,
  declaration-order arrays, and recursive signed-zero normalization. Prove the
  wire body cannot reintroduce omitted defaults or a differently ordered alias
  identity after core compilation.

- [ ] Add `diagnosticDefinitions: DiagnosticDefinitionDoc[]` as an optional
  wire field in `BundleInterchange` and include it in outer bundle integrity
  when present. Do not expose a free caller-authored diagnostic-definition copy
  on `BundleWrapInput`: Task 13 derives this field from completed-run
  provenance. Do not add it to reserving `results` or promotion unions.
- [ ] Update embedded-document traversal so nested diagnostic definitions in a
  bundle receive version and integrity verification.
- [ ] Separate generic forward-compatible document handling from semantic
  execution. The generic same-major parser preserves raw unknown fields and can
  verify the outer body tag. `docToDiagnosticDefinition` accepts only
  `diagnosticDefinitionVersion: "1.0.0"` plus the closed behavioral vocabulary;
  it must refuse a newer version or unknown nested behavioral field rather than
  drop, project, rehash, or execute it.
- [ ] Change schema emission to target `schema/interchange/1.1/` and generate a
  complete current schema set, not only the new file. Keep the normative JCS
  vectors at `schema/interchange/1.0/jcs-vectors.json`; `1.1/` intentionally
  contains schemas only and every shore continues to load the one frozen vector
  path.
- [ ] Add a frozen-manifest test for `schema/interchange/1.0` so future schema
  emission cannot rewrite historical files. The `1.1` drift test regenerates
  every current schema byte-for-byte and asserts no second JCS vector file is
  created.
- [ ] Add tests for:

  - valid author → parse → compile round-trip;
  - exact declaration signatures, generic `InterchangeDocument`/parse-result
    inclusion, and rejection of structural compiled-definition lookalikes;
  - every missing/invalid required field;
  - semantic-body mutation causing envelope mismatch;
  - formula/binding/basis/rule/axis/presentation mutation with a recomputed
    envelope but stale nested identity causing semantic rejection;
  - same-major envelope/document unknown fields preserved on the generic path;
  - future fields nested inside a measure, rule, and period axis round-trip
    opaquely with outer integrity intact but are refused by semantic conversion;
  - unsupported diagnostic-definition version refusal;
  - wrong-major refusal and unknown-kind refusal;
  - nested bundle definition integrity;
  - outer bundle tag changing when a nested definition changes; and
  - an extension mutation still leaving an unrelated document tag unchanged.

- [ ] Run schema generation and inspect the diff:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run emit-schema -w @actuarial-ts/interchange
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/interchange -- diagnosticDefinition.test.ts diagnosticPublicApi.test.ts envelope.test.ts schemas.test.ts schemaDrift.test.ts interopConformance.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/interchange
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/interchange
  ```

- [ ] Verify `git diff -- schema/interchange/1.0` is empty.
- [ ] Commit: `feat(interchange)!: add typed diagnostic definition documents`.

### Task 11 acceptance

- A portable diagnostic definition is integrity-covered as semantic content.
- Existing extension semantics and every `1.0` fixture remain unchanged.
- No diagnostic result is silently treated as a reserving result.

---

## Task 12: Implement Python/R definition conformance and replay vectors

**Purpose:** prove the portable definition has one interpretation on all three
shores without duplicating the entire TypeScript diagnostic runner.

**Files:**

- Create: `interop/python/actuarial_interchange/diagnostics.py`
- Modify: `interop/python/pyproject.toml`
- Modify: `interop/python/actuarial_interchange/documents.py`
- Modify: `interop/python/actuarial_interchange/__init__.py`
- Create: `interop/python/tests/test_diagnostics.py`
- Modify: `interop/python/tests/test_documents.py`
- Modify: `tools/interop/actuarialInterchange.R`
- Modify: `tools/interop/conformance.R`
- Modify: `tools/interop/test-read-document.R`
- Create: `interop/conformance/fixtures/diagnostics/generalized-casualty/definition.json`
- Create: `interop/conformance/fixtures/diagnostics/generalized-casualty/aggregate-cells.json`
- Create: `interop/conformance/fixtures/diagnostics/generalized-casualty/expected.json`
- Create: `interop/conformance/fixtures/diagnostics/generalized-casualty/ordered-axis-definition.json`
- Create: `interop/conformance/fixtures/diagnostics/generalized-casualty/ordered-axis-aggregate-cells.json`
- Create: `interop/conformance/fixtures/diagnostics/generalized-casualty/ordered-axis-expected.json`
- Modify: `interop/conformance/py/test_conformance.py`
- Modify: `interop/conformance/ts/conformance.test.ts`
- Modify: `interop/conformance/README.md`

**Produces:** three-shore parse/integrity/identity/formula/rule agreement over a
frozen diagnostics definition and aggregate-cell corpus.

### Steps

- [ ] Generate the calendar and ordered-axis fixtures once from the approved
  TypeScript definitions, then review and commit them as a human-readable
  frozen corpus. One discriminated definition cannot represent both axis
  variants, so the companion has its own definition, cells, and expected
  output. Together they must include:

  - all six formula templates;
  - their exact canonical JSON, including authored absence versus normalized
    explicit null for both formula-role optionals, cumulative paid/incurred and
    point-in-time open constraints, and the fixed `count-population` /
    `amount-basis` compatibility tokens;
  - ten count and twelve two-basis amount instances;
  - a pre-limited total basis and split capped-indemnity/unlimited-expense basis;
  - the exact claim-derivation ASTs and population/exposure-basis catalogs;
  - both missing policies in the catalog;
  - static and valuation-specific exposure definitions;
  - a mixed-cadence calendar axis and at least one gapped ordered-axis companion
    vector;
  - every comparison operator, exact tolerance boundary, and tolerance-overflow
    form;
  - declared-order additions with catastrophic-cancellation, subtraction, and
    non-finite/overflow-to-null vectors, including a metric-rule
    measure-expression overflow and a calculation-field operand that inherits
    the original failure path/readiness without duplicating its finding;
  - null components and not-evaluated rules; and
  - formula, calculation, definition, and envelope identity expectations.

- [ ] Add multiple calculation-identity fixtures—not just one standard pack—
  that vary binding object insertion order, transitive derivations, all three
  semantic catalog kinds, nullable semantic references, attributes, component
  order, and declared expression order. TypeScript, Python, and R must emit the
  exact Section 15 normalized scope bytes before comparing tags.

- [ ] Extend Python's document kind/body-key dispatch, dataclasses/types,
  unknown-field preservation, version constant, parse, serialization, and
  exports for `diagnostic-definition`. Bump the Python adapter package/generator
  version from `0.1.0` to `0.2.0`. Keep implementation syntax and declared
  dependencies compatible with the existing Python `>=3.10` package floor;
  Task 19 proves that floor in its own clean CI lane.
- [ ] Add a small Python diagnostic replay module limited to:

  - canonical definition normalization;
  - identity recomputation;
  - role/measure add/subtract expression evaluation;
  - positive-denominator ratio evaluation; and
  - declarative comparison-rule evaluation over supplied aggregate cells.

  It must not become a second full exposure/period/view SDK. Pin
  `expression-overflow` in the shared metric-rule readiness order and its exact
  path/output behavior. The five top-level data-review rule variants, prepared
  contribution provenance, and `DiagnosticReviewExpressionOverflow`
  source/site records remain TypeScript runtime conformance in Task 10; the
  other shores must still preserve and identity-hash those authored rule
  definitions exactly.
- [ ] Add equivalent self-contained R helpers to parse/emit the new kind,
  recompute identities, evaluate the narrow expressions/formulas, and evaluate
  comparison rules over the same aggregate cells. Bump the R adapter's default
  generator version from `0.1.0` to `0.2.0`.
- [ ] Reuse the existing cross-shore JCS and FNV implementations. Do not add a
  second normalization/hash algorithm.
- [ ] Pin expression resource-limit agreement with exact 64/65,
  10,000/10,001, and aggregate 100,000/100,001 vectors; all shores count roots,
  leaves, repeated occurrences, metric-rule measure-operand wrappers, and
  review constants identically and fail without stack overflow. Include every
  multi-operand rule kind so a maximal left/narrower/actual operand neither
  consumes nor hides the independent right/broader/expected root budget, while
  both still contribute to the whole-definition budget.
- [ ] Test exact canonical bytes and all identity strings on all shores.
- [ ] Pin normalized-definition byte equality across both definitions,
  including every optional default, code-unit-sorted alias arrays (authored
  alias reordering is invariant), present-empty control filters/selectors,
  formula-role development-semantics constraints, coordinate ordering, and
  declaration-order expressions/rules. Mutating only a temporal role
  constraint must move formula/calculation/definition tags identically on all
  three shores. Include
  `"😀"` and `"�"` together in set-like aliases/selectors and catalog IDs and
  require UTF-16 code-unit order (`😀` before `�`) on TypeScript, Python, and R;
  this must catch accidental native code-point or locale sorting rather than
  merely retest JCS object-key order.
- [ ] Limit cross-shore identity assertions to formula, calculation,
  definition, and envelope tags. Preparation/review/run/result/run-result
  identities remain TypeScript package-workflow contracts in `0.6.0`.
- [ ] Test numeric/null/rule outputs from every aggregate cell on all shores,
  including negative numerator, zero/negative denominator, missing component,
  declared-order add/cancellation, subtraction/overflow, metric-rule
  expression overflow, inherited calculation-field overflow, tolerance boundaries,
  rejection of a calculation-`value` rule operand, and two bases sharing a
  formula fingerprint.
- [ ] Test semantic mutation detection after recomputing only the envelope tag:
  each shore must report the stale nested identity.
- [ ] Preserve same-major unknown fields through Python and R generic opaque
  round-trips; semantic replay must refuse unknown behavioral fields or an
  unsupported diagnostic-definition version exactly as TypeScript does.
- [ ] Run the shared string-class corpus on all three shores, including NUL,
  malformed surrogate input at the applicable decoder boundary, blank/edge
  ASCII whitespace, internal whitespace, Unicode, free-JSON empty text, and
  prototype-like keys. Require the same accept/reject outcome and canonical
  bytes without normalization or case folding.
- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/interchange -- interopConformance.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run test:py
  RSCRIPT_BIN="${ACTUARIAL_TS_RSCRIPT:-Rscript}"
  "$RSCRIPT_BIN" tools/interop/conformance.R
  "$RSCRIPT_BIN" tools/interop/test-read-document.R
  ```

- [ ] If R is unavailable on an execution host, do not claim it passed. The
  repository CI R-conformance workflow must run and pass before Task 19 can be
  signed off.
- [ ] Commit: `feat(interop): replay diagnostic definitions across three shores`.

### Task 12 acceptance

- TypeScript, Python, and R produce byte-identical identities and equivalent
  finite/null calculations for the frozen corpus.
- Cross-shore helpers remain narrow; full aggregation and view logic stays in
  TypeScript core.
- Frozen reserving conformance fixtures are untouched except where writer
  version expectations explicitly require additive test coverage.

---

## Task 13: Make compliance provenance complete and self-verifying

**Purpose:** capture the exact reviewed calculation and run context, including
rules and definitions that `0.5.0` omitted.

**Files:**

- Rewrite: `packages/compliance/src/diagnostics.ts`
- Create: `packages/compliance/src/diagnosticRun.ts`
- Create: `packages/compliance/src/errors.ts`
- Create: `packages/compliance/src/version.ts`
- Modify: `packages/compliance/package.json`
- Modify: `package-lock.json`
- Modify: `packages/compliance/src/bundle.ts`
- Modify: `packages/compliance/src/index.ts`
- Rewrite: `packages/compliance/test/diagnosticsBundle.test.ts`
- Create: `packages/compliance/test/diagnosticPublicApi.test.ts`
- Modify: `packages/compliance/test/bundle.test.ts`
- Modify: `packages/compliance/test/bundleCompat.test.ts`
- Modify: `packages/compliance/test/wrappedBundle.test.ts`
- Modify if needed: `packages/compliance/src/ledger.ts`
- Regression: all `packages/compliance/test/*.test.ts`

**Produces:** `DiagnosticArtifactDigestBase`, `DiagnosticArtifactDigest`,
`DiagnosticArtifactEvidence`, `DiagnosticPreparationLineage`,
`CreateDiagnosticRunIdentityInput`, `DiagnosticRunManifest`,
`NormalizedDiagnosticRunManifestIdentity`,
`DiagnosticRunIdentity`, `DiagnosticRunProvenance`,
owner-authenticated `VerifiedDiagnosticRunProvenance`,
`createDiagnosticRunIdentity`, `verifyDiagnosticRunIdentity`, verified
owner-produced preparation/review fingerprints, compliance-computed expected-
grid/result/run/run-result fingerprints, normalized
diagnostic-run provenance, cross-artifact coherence verification, wrapped-bundle
inclusion of the typed definition document, and precise mismatch reporting.

### Steps

- [ ] Add lockstep `@actuarial-ts/data` as a compliance dependency. Task 13
  depends on Task 10 so compliance consumes the one branded
  `DiagnosticReviewReceipt` and `CompletedValidatedMetricDiagnosticsRun` type;
  do not recreate either shape structurally.
- [ ] Preserve compliance's existing public mutable-recursive ledger
  `JsonValue` exactly. Import core's readonly `JsonValue` as
  `CoreDiagnosticJsonValue` and use that alias for
  `DiagnosticRunManifest.groupDimensions` and
  `NormalizedDiagnosticRunManifestIdentity.groupDimensions`; do not merge or
  redeclare the package-local names. Pin both exports and the imported alias in
  the generated compliance declaration, plus compile tests assigning nested
  readonly diagnostic dimensions without broadening the ledger API.
- [ ] Extract `COMPLIANCE_PACKAGE_VERSION` into dependency-leaf `version.ts`
  and the existing `ComplianceError`/registry into dependency-leaf `errors.ts`;
  re-export them unchanged from the old public paths/index. Add
  `BAD_DIAGNOSTIC_RUN`, `DIAGNOSTIC_MISMATCH`, and `CRYPTO_UNAVAILABLE` plus
  optional readonly `path`. Both bundle and diagnostic-run modules import only
  these leaves, avoiding an ESM cycle. Pin exact code and first deterministic
  JSONPath for all verifier/capability failures.
- [ ] Stamp the actual imported `CORE_PACKAGE_VERSION`,
  `DATA_PACKAGE_VERSION`, and `COMPLIANCE_PACKAGE_VERSION`; never accept package
  versions from the run caller or assume all installed patch versions match.

- [ ] Replace flattened metric/layer provenance with a deep normalized snapshot
  containing:

  - definition ID/version and complete normalized definition;
  - formula, calculation, and definition identity tags plus algorithm/version;
  - all structured measures, count populations, amount bases, exposure bases,
    and claim derivations;
  - bindings, formula expressions, presentation, metric rules, and review rules;
  - per-measure aggregation/missing/exposure timing;
  - claim-versus-aggregate loss row grain;
  - period axis and complete-period cutoffs;
  - applied filters and grouping selections;
  - typed input/preparation artifact digests, each with algorithm, scope, and
    `sdk-computed` versus `caller-declared` assurance;
  - package versions; and
  - the definition identity that makes any separately named host catalog
    independently verifiable rather than caller-labeled inside the definition.

- [ ] Implement the spec's exact `NormalizedDiagnosticRunManifestIdentity`
  rather than hashing a spread of `DiagnosticRunManifest`. Use the fixed keys
  and nesting, the full normalized filter, and precisely
  `executionPolicy.review: { body, reportFingerprint }`; include no human
  receipt fields in that identity projection. Its run
  fingerprint covers definition integrity, approved run-preset ID, artifact
  digests and preparation lineage, the complete prepared pre-exclusion input
  audit, prepared filter/grouping, prepared cutoffs,
  expected-cell-grid fingerprint, review identity body + two-gate receipt, and lockstep
  package/engine version. Store the complete review receipt, but exclude its
  human descriptions/capped details from the normalized run identity. Compute
  the expected-grid tag (or exact null), separate result-content fingerprint,
  run fingerprint, and run-result binding fingerprint here in compliance over
  the Section 15 payloads. Call core's
  `getPreparedDiagnosticDataIdentity` once and consume its normalized filter,
  input audit, cutoffs, preparation body, and expected-cell array; call
  `getMetricDiagnosticsResultIdentity` for result payloads; and consume data's
  exact `DiagnosticReviewReceipt.identityBody`. Use the shared public canonical
  JSON/FNV primitives, but do not invent a core result-fingerprint export,
  import a private helper, or rebuild any owner-normalized payload
  independently.
- [ ] Implement `createDiagnosticRunIdentity` to accept only the data-owned
  branded completed run plus artifact evidence. Derive definition,
  preparation, filter, cutoffs, expected-grid presence/content, review, gate,
  grouping, run-preset ID, and result fields from it; accept no second
  caller-authored copies, preset label, or identity strings. Return the exact
  recursively frozen `VerifiedDiagnosticRunProvenance`: complete normalized definition
  body/identity maps + run manifest + complete result + the three run/result
  tags. Authenticate it with private owner state; this is the sole replacement
  for `createDiagnosticsProvenance`. Its public `result` must alias the exact
  completed-run result; there is deliberately no public prepared/completed-run
  field.
- [ ] Before stamping, have core verify preparation identity, then recompute
  review identity and both gate
  predicates, require reviewGate/metricGate `passed`, and call data's
  `assertCompletedValidatedMetricDiagnosticsRun`. Delegate preparation-tag
  recomputation to core's `verifyPreparedDiagnosticDataIntegrity`; compliance
  must not fork its private payload/normalizer. Re-run
  `reviewPreparedDiagnosticData` from the same prepared object and frozen
  receipt evidence, requiring the complete identity-bearing report projection,
  evaluations, and fingerprint to match by exact
  `DiagnosticReviewReceipt.identityBody` and `reportFingerprint`.
  Require all identity-bearing receipt fields to match, but do not make human
  description/detail rendering a run identity. On verification, discard the
  candidate's unverified descriptions/details and build the returned manifest
  from the authenticated rerun's complete regenerated receipt; altered stored
  prose is never silently blessed. Then rerun core with the
  branded prepared object plus recorded group map/dimensions. Call
  `getMetricDiagnosticsResultIdentity` on both the rerun and completed result,
  then require those two normalized projections to be byte-identical. Reject a
  forged completed brand, a genuine-run mutation attempt, fabricated but
  self-consistent review/pass receipt, wrong group map/dimensions, stale result,
  or blocked outcome.
- [ ] Implement async artifact evidence exactly: SDK-computed accepts actual
  bytes and only SHA-256, recording lowercase hex and byte length;
  caller-declared accepts a non-empty external algorithm/value and remains
  labeled unverified. Reject any caller-supplied digest masquerading as
  SDK-computed. Use standards-based Web Crypto available in supported Node and
  browsers, not a Node-only import; fail with a typed capability error if the
  runtime genuinely lacks SHA-256 support.
- [ ] Apply the shared token-string contract to artifact IDs/scopes, lineage
  references, algorithm/value fields, and all rationale/transformation IDs.
  Pin blank, edge-whitespace, NUL, malformed Unicode, and prototype-like IDs at
  exact error paths before any asynchronous digest begins.
- [ ] Before the first async digest, synchronously validate and snapshot the
  entire constructor/verifier input. Copy only each `Uint8Array` view's exact
  `byteOffset`/`byteLength` bytes into fresh storage. Add sliced-buffer and
  microtask mutation tests proving neither caller mutation nor unrelated
  backing-buffer bytes can change a pending digest.
- [ ] Resolve every source `artifactId` in the complete pre-exclusion input
  audit, prepared/review material, and ancillary evidence to one input artifact;
  resolve every external amount transformation, caller-asserted layer rationale,
  and fail-override rationale to one preparation artifact. Reject missing,
  duplicate, and cross-array-colliding IDs plus duplicate cutoff groups. Add
  exact acyclic `DiagnosticPreparationLineage` edges from a downstream input
  artifact to upstream input artifacts and transformation artifacts. Require
  unique producing edges, sorted unique references, valid artifact categories,
  no self/cycles, and reject only evidence that is neither directly referenced
  nor reachable by walking lineage backward from referenced artifacts. Pin the
  original archive → script/manifest → compact derivative case. Compute
  expected-grid identity from the actual prepared grid, with omitted and
  explicitly empty grids distinct.
- [ ] Bind the run-time `datasetArtifactId` into the manifest. If any input-audit
  or review-evidence record lacks a row-level source, require that fallback to resolve to an
  SDK-computed input artifact. Permit null plus no input artifacts only for a
  genuinely empty input audit with zero evidence records; both omitted/null
  evidence and an explicitly empty evidence object qualify, while their review
  identities remain distinct. Pin fully sourced,
  mixed sourced/unsourced, filtered-only, cutoff-only, invalid-only,
  canonical prepared-input-audit/evidence bytes (including non-finite
  sentinels), empty-run, missing fallback, partial
  source, post-execution ID mutation, and orphan cases.
- [ ] Implement `verifyDiagnosticRunIdentity` over unknown stored provenance
  plus the same actual completed run/evidence input. Recompute artifact bytes,
  all versioned FNV payloads, engine package stamps, gate predicates, core
  rerun, and semantic references; return a newly authenticated/frozen verified
  value or throw the exact typed code/path. A plain deserialized or fabricated
  provenance may not enter new bundle authoring until this reverification.
  Add a candidate with altered human descriptions/details but valid semantic
  identity and prove the verified return contains regenerated authentic text,
  never the candidate text. Mutate aggregation/expression-overflow reasons,
  paths, sites, or source unions in a candidate and require review/run/result
  fingerprint verification to fail at the first exact path.
- [ ] Normalize artifacts, sources, findings, evaluations, cutoffs, filter-set
  fields, status/severity sets, group maps, and dimensions exactly as the spec
  requires. Allow fail in either gate only with a non-empty, resolved rationale
  artifact; never fabricate one.
- [ ] Recompute the metric gate from top-level `result.findings` only, ignoring
  structural category and never recursively double-counting nested findings.
  Pin a structurally failed-but-explicitly-review-allowed run separately from a
  nonstructural fail finding so the two gate responsibilities cannot drift.
- [ ] Gate every `DataCheck.status` and every review-rule evaluation independently
  using the spec's status mapping; do not let an aggregate warning hide a
  not-evaluated member. Pin the mixed-outcome policy case.
- [ ] Canonicalize all identity payloads for validation/hashing and clone/freeze
  unbranded artifact/lineage/policy/manifest fields. Retain the exact authentic
  frozen `completedRun.result` as the public result so emergence/triangle/view
  `===` aliases survive, and register the verified object in a private
  `WeakMap` retaining the exact completed run and prepared object. The public
  interface gains no hidden-looking enumerable prepared field; owner
  assertions and bundle authoring consult the registry. Never spread,
  deep-clone, or JSON-round-trip branded inner objects. A serialized plain
  provenance promises semantic equality rather than JS identity;
  reverification creates a newly registered value around the authentic rerun
  objects and regenerated receipt. Reject all non-JSON values and mutation
  attempts.
- [ ] Add `diagnosticRuns?: readonly VerifiedDiagnosticRunProvenance[]` to the existing
  compliance bundle input. Include each complete provenance record in the
  canonical inner body and derive the distinct verified
  `DiagnosticDefinitionDoc` entries in wrapped bundle
  `interchange.diagnosticDefinitions`; never accept a second caller-authored
  definition copy and never place the claimed contract solely in `extensions`.
  Use the bundle timestamp/compliance generator, deduplicate by definition
  integrity, sort deterministically, and distinguish omitted from explicit
  reviewed-empty arrays. Export/call the private-state-backed
  `assertVerifiedDiagnosticRunProvenance`; a cast, copied symbol, or structural
  lookalike must fail at runtime.
- [ ] Replace any compliance-bundle literal that still writes interchange
  `1.0.0` with the interchange package's current writer constant/API while
  preserving historical-read tests. A bundle containing diagnostic definitions
  must write `1.1.0`; no second version literal may drift from Task 11.
- [ ] For nonempty diagnostic runs, require all manifests to agree on
  core/data/compliance versions and require matching entries in outer
  `sdkVersions`. Reject missing/conflicting entries. In wrapped mode, omit the
  generator override or require it to equal the actual compliance name/version;
  enforce the same manifest/inner/outer agreement during verification. Keep
  the historical override only for bundles without authenticated diagnostics.
- [ ] At author and verify time, require semantic coherence among the native
  provenance snapshot, nested definition doc, run manifest, every evaluation's
  formula/calculation/definition tags, preparation/review identities,
  result-content fingerprint, and run-result binding fingerprint. Independent
  valid integrity tags are necessary but not sufficient.
- [ ] Keep core results free of filters, timestamps, user identity, ledger
  state, and persistence metadata.
- [ ] Add a documented list of material judgment fields for hosts to ledger:
  amount basis, limit/application mechanics, expense treatment, missingness,
  exposure timing, period convention, filters/grouping, and communicated scale.
  The helper may compose records but must not fabricate an actuary's rationale.
- [ ] Add tests for:

  - exact full-provenance snapshot including every rule AST;
  - insertion-order/row-permutation invariance, defensive cloning, runtime
    freeze/mutation attempts, exact prepared/result identity preservation, and
    in-memory result/view reference aliases;
  - run-manifest ordering with nullable/absent source fields, numeric rows,
    booleans, status values, and lexicographic artifact/source/issue arrays
    including prefix ties, proving the global comparator controls bytes rather
    than object insertion order or locale;
  - complete public declaration snapshots for artifact evidence/lineage,
    manifest, identity, provenance, constructor, verifier, and bundle field;
  - function/non-finite/undefined rejection;
  - stale definition/preparation/review/run/result/binding fingerprint
    rejection at its exact path;
  - formula mutation moving formula/calculation/definition identities;
  - binding/basis/missing/timing/derivation mutation keeping formula stable
    while moving calculation and definition identities;
  - either rule-family mutation moving definition/run identity but not formula
    or numeric-calculation identity; result identity changes only when the
    normalized result actually changes, while the run-result binding always
    follows either tag;
  - display-only mutation moving definition/bundle integrity but not formula or
    calculation identity;
  - caller-declared digest clearly remaining unverified, and SDK-computed
    digest requiring actual supplied bytes;
  - sliced `Uint8Array` views and mutation queued while SHA-256 is pending;
  - input/filter/group/cutoff/review-policy mutation moving run identity while
    leaving the reusable definition unchanged; assert result-content identity
    separately and require the run-result binding to move;
  - async SDK SHA-256 byte hashing, caller-declared assurance, missing/orphan/
    duplicate artifact references, external transformation/rationale
    resolution, valid multistage archive/script/derivative lineage,
    malformed/cyclic/orphan lineage, and omitted-versus-empty expected grids;
  - a fully re-stamped wrong-group-map/result pair rejected by deterministic
    core rerun, plus fabricated/self-consistent review, gate-pass,
    post-execution preset relabeling, copied-brand, mutation, and
    blocked-outcome rejection;
  - exact core/data/compliance lockstep package stamps derived internally;
  - outer SDK-version/generator disagreement rejected during authoring and
    verification;
  - plain/copy-branded provenance rejected by bundle authoring, then accepted
    only as the newly verified value returned from exact evidence;
  - core-owned preparation integrity delegation plus stale preparation
    content/tag rejection without a compliance-side normalizer;
  - typed bad-run/mismatch/crypto error codes with deterministic first paths;
  - nested definition mutation failing its own and outer bundle checks;
  - two internally valid, fully re-stamped but mutually inconsistent
    provenance/definition/result halves failing at the exact coherence path;
  - exact mismatch paths; and
  - historical unwrapped `v0_1_bundle.json` verification unchanged.

- [ ] Remove the old test that presents an opaque extension round-trip as
  complete diagnostic integrity. Retain a lower-level interchange test proving
  extension behavior honestly.
- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/compliance -- diagnosticsBundle.test.ts bundle.test.ts bundleCompat.test.ts wrappedBundle.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/compliance
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/compliance
  ```

- [ ] Commit: `feat(compliance)!: seal complete diagnostic provenance`.

### Task 13 acceptance

- No behavioral definition is omitted from provenance.
- A run is tied to its input/preparation artifacts, material selections,
  reviewed execution policy, engine version, and complete result.
- A nonempty partially unsourced run cannot be stamped without its
  validation-bound SDK-computed dataset artifact.
- The public provenance record contains the complete normalized definition,
  manifest, result, artifact lineage, and mutually bound identity tags; no
  flattened/free-form diagnostic constructor survives.
- Only a data-package-branded completed run whose review and metric gates
  and full regenerated review recompute as passed can be stamped.
- Provenance identities are recomputed rather than trusted.
- New bundle authoring accepts only owner-verified provenance; stored plain JSON
  must be reverified against the completed run and evidence first.
- A wrapped bundle protects the nested definition through both its own and the
  outer semantic-body integrity tags.
- Independently valid but mutually inconsistent artifacts cannot verify as one
  bundle.
- Historical bundle compatibility remains green.

---

## Task 14: Add a narrow, trusted-catalog agent boundary

**Purpose:** demonstrate the SDK's AI-era transparency principle without
letting a model define or mutate the actuarial calculation.

**Files:**

- Create: `packages/agents/src/diagnostics.ts`
- Modify: `packages/agents/src/tools.ts`
- Modify: `packages/agents/src/errors.ts`
- Modify: `packages/agents/src/index.ts`
- Modify: `packages/agents/package.json`
- Modify: root `package.json`
- Modify: `package-lock.json`
- Create: `packages/agents/test/diagnostics.test.ts`
- Create: `packages/agents/test/diagnosticPublicApi.test.ts`
- Modify: `packages/agents/test/tools.test.ts`
- Regression: all `packages/agents/test/*.test.ts`

**Produces:** `createDiagnosticSelectionTool` and the exact public host/model
types from the spec for a host-owned diagnostic tool whose model
input can select registered instance IDs plus a host-approved run preset. It
cannot create or restate a calculation population.

### Steps

- [ ] Make the runtime contract honest before adding the new Mastra seam: set
  both the private all-workspace root and agents package engines to
  `>=22.13.0`, raise the agents `@mastra/core` peer floor
  to `>=1.51.0 <2`, retain the installed/tested `@mastra/mcp` floor
  `>=1.14.0 <2`, and raise the Zod floor to `^3.25.76`. Update the lockfile with
  Node 22 `npm install`. The other four SDK packages retain `node >=20`; Task 19
  proves that split rather than executing an incompatible Mastra stack on
  Node 20.

- [ ] Before writing Mastra code, inspect the installed declarations under
  `node_modules/@mastra/core/dist/**/*.d.ts`; installed types are authoritative.
- [ ] Design the factory around a trusted host configuration containing a
  compiled definition plus approved `DiagnosticAgentRunPreset` catalog whose
  executor returns an owner-authenticated
  `VerifiedDiagnosticRunProvenance`. Lock the default tool ID/description and
  every exported type/function name before implementation. The
  model-visible schema may contain:

  - one or more registered metric instance IDs;
  - one registered `runPresetId` whose filters/grouping/cutoffs were already
    human approved; and
  - an output-view enum.

  It may not contain arbitrary calculation filters, measure/formula/rule ASTs,
  bases, missingness, exposure timing, period axes, presentation overrides,
  provenance, or project/tenant identifiers.
- [ ] Authenticate the compiled definition and validate the complete preset
  catalog atomically at tool construction. Require a nonempty catalog; reject
  a supplied tool ID or tenant-context key unless it is a token string and a
  supplied description unless it is valid human text. Reject
  blank or duplicate preset IDs, blank or duplicate IDs within each allowed
  instance list, wrong definition tags, unresolved allowed IDs, and non-function
  executors. Do not silently deduplicate host configuration. After validation,
  copy preset IDs and definition tags, code-unit-sort each already-unique
  allowed instance list, capture each execute function reference by value, and
  deeply freeze one private lookup catalog. Every such definition/catalog
  failure throws `AgentsError` code `BAD_DIAGNOSTIC_CATALOG` before a Tool is
  returned. Runtime code must never reread caller-owned arrays, preset objects,
  allowlists, or mutable execute properties.
- [ ] Build the tool with `defineActuarialTool` so the tenant still comes only
  from server-set context and thrown host errors become structured failure
  envelopes. Default `tenantContextKey` to `projectId`, validate an override as
  a token string, and pass it as `tenantKey` with `tenant: "required"`. Consume
  the wrapper-resolved tenant callback argument; do not call `tenantOf` again
  or use `tenant: "none"`. Missing, empty, and wrong-type context values must
  return `NO_TENANT_CONTEXT` before host execution; there is no model fallback.
- [ ] Repair the shared factory's public generics instead of casting only this
  tool. Export the spec's exact `DefinedActuarialTool<TInput, TOutput>` and
  `DefineActuarialToolOptions<TShape, TResult>` signatures. The body returns
  `TResult` and receives `z.infer`/`z.output`; the SDK-returned execute input is
  `z.input<z.ZodObject<TShape>>`, because the adapter itself parses the raw
  value exactly once. Its execute function returns only
  `TResult | ToolEnvelopeFailure`. Base the inherited non-execute Tool surface
  on `Tool<unknown, unknown>` so its attached metadata schemas, approval hooks,
  transforms, and output callbacks make no false domain-validation claim; only
  the replacement `execute` is concretely typed to `TInput` and `TOutput`.
  Export the strict real Zod schemas separately. Make the existing
  `ToolEnvelopeFailure` recursively readonly and snapshot every existing tool
  declaration affected by that deliberate `0.6.0` tightening.
- [ ] Account explicitly for the minimum-tested Mastra `1.51.0` contract and
  lock-tested `1.64.0`: their `Tool.execute`
  return includes `ValidationError | void`, and the real public
  `makeCoreTool`/Agent conversion validates an attached input schema before it
  calls `Tool.execute`. Attaching the private real Zod would therefore run a
  transform twice or let Mastra return `ValidationError` before the SDK
  adapter. Retain each real input/output Zod privately. Use only the installed
  public `toStandardSchema` and JSON Schema APIs from `@mastra/core/schema` to
  derive its exact input/output converters, then build an SDK-internal
  `StandardSchemaWithJSON<unknown, unknown>` metadata bridge whose synchronous
  validator returns the value unchanged and whose converters delegate exactly
  to the real schema for every supported target. Call `createTool` with ID,
  description, those metadata bridges, and without its optional `execute`, then
  assign one SDK-owned adapter to the real Tool instance. That adapter must
  safe-parse raw input exactly once; normalize failure to
  `TOOL_INPUT_INVALID` / `Tool input failed schema validation`; safe-parse the
  body-or-envelope output exactly once after tenant/body/exception handling;
  and normalize failure to `TOOL_OUTPUT_INVALID` / `Tool output failed schema
  validation`. If the pre-schema value is any failure envelope, require the
  parsed value to deep-equal that exact envelope; otherwise return
  `TOOL_OUTPUT_INVALID`, preventing a conditional transform from preserving the
  construction probe but rewriting a real SDK error. Success transforms remain
  allowed. In the no-output-schema branch, map a body's actual runtime
  `undefined` to `TOOL_OUTPUT_INVALID` as well. The metadata bridges remain on
  the Tool for model/provider JSON Schema while all domain parsing remains in
  the adapter. At definition time require a supplied output schema to parse the
  exact canonical probe
  `{ success: false, error: { code: "TOOL_OUTPUT_INVALID", message: "Tool output failed schema validation" } }`
  to a deep-equal value or throw `BAD_OUTPUT_SCHEMA`. Catch throwing
  input/output transforms and refinements and normalize them to the same
  phase-specific error contract; a throwing construction probe is
  `BAD_OUTPUT_SCHEMA`. Treat the probe as the one documented construction-time
  output-schema parse; input parsing still runs exactly once per execute, and
  output parsing runs exactly once per execute in addition to the probe.
- [ ] Implement schema-present/schema-absent construction branches and allow
  exactly one documented assertion where they converge on the final Tool with
  its assigned adapter; justify it with the wrapper's exactly-once runtime
  validators and exact execute annotation. The adapter forwards the structural
  request context directly and must not take a dependency on Mastra's private
  legacy context reshaping or suspend/resume path. Prohibit casts in
  callers/individual factories and caller-supplied fake pass-through schemas
  used only for inference; the sole permitted identity validator is the
  SDK-owned metadata bridge above. Export strict diagnostic
  input/result Zod schemas; the diagnostic factory always supplies its result
  union schema while instantiating the body result as success, and returns
  `DiagnosticSelectionTool = DefinedActuarialTool<DiagnosticAgentToolInput,
  DiagnosticAgentToolResult>`. Existing tools omit `outputSchema` on the same
  wrapper path; the one shared assertion prevents Mastra's no-schema inference
  from leaking `unknown` into the public type. Generated declarations may
  contain no `unknown`/`any` substitute for diagnostic input or output, no
  exposed Mastra `ValidationError | void`, and no success-only output type that
  hides wrapper failures. Conversely, attached metadata schemas and every
  inherited schema-typed callback remain honestly `unknown`; only direct
  `execute` has the exact domain input/output. Prove the object remains
  structurally accepted by installed Mastra through the public `makeCoreTool`
  path.
- [ ] Resolve selected instance and run-preset IDs against trusted host catalogs
  before invoking the executor. Unknown, unavailable, or cross-definition IDs
  fail closed. Exact-deduplicate and sort model instance IDs by code-unit order and
  require them to be a nonempty subset of the preset allowlist. Call core's
  compiled-definition assertion and compliance's verified-provenance assertion.
  Require returned definition integrity, boundary-bound manifest
  `runPresetId`, and explicit manifest `filter.instanceIds` to match exactly;
  never add labels only to the agent response or compliance call. A preset may
  execute or return a cached verified run only for that exact selection; reject
  a cached superset rather than display-filtering it into an unstamped apparent
  result.
- [ ] Add the exact diagnostic agent error codes to `errors.ts` and pin failure
  precedence as strict input schema → trusted tenant → preset → instance
  allowlist → host execution → verified provenance/coherence → projection →
  output schema.
  Use `UNKNOWN_DIAGNOSTIC_PRESET`, `UNAPPROVED_DIAGNOSTIC_INSTANCE`, and
  `DIAGNOSTIC_RUN_MISMATCH`; add the shared `BAD_OUTPUT_SCHEMA`,
  `TOOL_INPUT_INVALID`, and `TOOL_OUTPUT_INVALID` codes plus the
  construction-only `BAD_DIAGNOSTIC_CATALOG`; retain
  `NO_TENANT_CONTEXT` and the existing `TOOL_ERROR` fallback.
- [ ] Include formula/calculation/definition identities and rule
  not-evaluated/triggered status plus approved preset ID, run fingerprint, and
  result-content and run-result binding fingerprints in successful output so a
  human can identify exactly what the agent requested and which run/result pair
  belongs together. Key `calculationFingerprints` by exactly the normalized
  requested instance IDs; key `formulaFingerprints` by exactly the
  exact-deduplicated formula IDs those instances reference. Code-unit-order
  both records and omit every unselected or stale catalog entry.
- [ ] Return the full review receipt and an explicitly display-only projection
  for `emergence`, `triangles`, or `latest-diagonal`. Never fingerprint that
  projection as a new result or omit triggered/not-evaluated evaluations.
  Snapshot `DiagnosticAgentDisplayPoint`, the display projection union,
  `DiagnosticAgentToolSuccess`, and `DiagnosticAgentToolResult`; keep every
  nested returned value readonly.
- [ ] Do not add a path that edits a definition. A future "change basis/rule"
  capability would require a separate human-gated workflow and ledger entry.
- [ ] Do not add diagnostic documents to existing reserving promotion unions.
- [ ] Snapshot the complete new agents declaration surface and prove its input
  type contains only trusted IDs/view selection—not definition, filter,
  population, basis, period, tenant, or provenance authoring fields. Prove its
  required execute input/output are exact while attached metadata schemas and
  inherited schema-typed callbacks remain `unknown` by design.
- [ ] Add tests for:

  - valid registered-ID selection;
  - construction-time `BAD_DIAGNOSTIC_CATALOG` for invalid supplied tool ID,
    description, or tenant-context key, an empty catalog, blank or duplicate
    preset IDs, blank or duplicate allowed IDs, wrong definition tag,
    unresolved allowed ID, unauthentic definition, and non-function executor,
    with no partially returned Tool and no deferred `NO_TENANT_CONTEXT`;
  - nonlexical IDs proving code-unit selection order and exact manifest-filter
    equality;
  - unknown instance/preset and cross-definition failure;
  - absent tenant context failure before host execution;
  - no tenant/project field in the model schema;
  - arbitrary filters and definition/basis/rule fields impossible in the strict
    input schema;
  - output identities preserved;
  - exact selected calculation-key and referenced-formula-key sets/order, with
    shared formulas deduplicated and no full-catalog/stale extras;
  - fake/copy-branded provenance, mismatched definition/preset/instance filter,
    cached supersets, and an executor returning an unapproved extra instance
    rejected;
  - post-construction mutation of the outer preset array, preset ID/tag,
    allowed-instance array, and execute property has no effect, while the
    originally captured function and private catalog remain authoritative;
  - every diagnostic failure code and precedence branch;
  - triggered and not-evaluated rule results preserved;
  - hostile tool error converted to an envelope;
  - malformed raw model input returning the exact readonly
    `TOOL_INPUT_INVALID` envelope before the body runs;
  - exact provider JSON Schema equality between each metadata bridge and its
    private real Zod on every supported conversion target, plus synchronous
    identity validation by the bridge itself;
  - malformed input through the installed public `makeCoreTool` conversion
    reaching the SDK adapter and returning the exact `TOOL_INPUT_INVALID`
    envelope rather than Mastra `ValidationError`;
  - malformed host success/failure output returning the exact readonly
    `TOOL_OUTPUT_INVALID` envelope—not Mastra `ValidationError` or `void`—and a
    supplied schema that omits the failure branch being rejected at definition;
  - a schema-absent body returning runtime `undefined`, plus a conditional
    output transform that preserves the canonical construction sample but
    rewrites `NO_TENANT_CONTEXT` or `TOOL_ERROR`, both returning the exact
    readonly `TOOL_OUTPUT_INVALID` envelope;
  - throwing input/output transforms or refinements and a throwing construction
    probe, proving the exact input/output/`BAD_OUTPUT_SCHEMA` normalization;
  - a nested type-changing input transform, with declaration tests proving
    direct `execute` accepts the raw `z.input` shape while the body receives
    the transformed `z.output` shape, and runtime tests through both direct
    execute and installed public `makeCoreTool` proving exactly one transform;
  - declaration tests proving body-result versus observable failure-union
    typing, schema-bearing and schema-omitted calls, the installed Mastra
    `ValidationError | void` difference, exact adapted execute output,
    deliberately unknown metadata-schema/callback types, and the exact public
    diagnostic input/result union only on `execute`;
  - manifest tests proving the agents Node engine and three peer lower bounds
    match the minimum versions exercised by the clean-consumer gate;
  - stateful input and output Zod transforms on direct, agent-shaped, workflow-
    shaped, and MCP-shaped context calls, proving input executes once per call
    and output executes once per call after accounting for/resetting the single
    construction probe, with tenant resolution unchanged; and
  - existing promotion/remote/tool behavior unchanged.

- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm install
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/agents -- diagnostics.test.ts tools.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/agents
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/agents
  ```

- [ ] Commit: `feat(agents): expose trusted diagnostic selections to agents`.

### Task 14 acceptance

- A model can choose among reviewed calculations but cannot author one.
- A model cannot silently change the calculation population; it names an
  approved run preset plus an exact stamped instance selection. Only the
  emergence/triangle/latest-diagonal view choice is display-only.
- The tenant seam and structured error contract remain intact.
- No SDK tool leaks Mastra `ValidationError`, framework `void`, or a body's
  runtime `undefined`; schema transforms execute once per call (plus the one
  declared output construction probe), failure envelopes cannot be rewritten,
  and the entire success/failure union is deeply readonly.
- No new promotion semantics are implied.

---

## Task 15: Remove the complete `0.5.0` diagnostics surface

**Purpose:** finish the clean break only after every SDK package has migrated,
at one repository-wide green boundary with no aliases or shadow implementation.

**Files:**

- Delete: `packages/core/src/legacyDiagnostics.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/data/src/index.ts`
- Modify: `packages/compliance/src/index.ts`
- Modify: `packages/agents/src/index.ts`
- Modify: `packages/core/test/diagnosticPublicApi.test.ts`
- Modify: `packages/data/test/diagnosticPublicApi.test.ts`
- Modify: `packages/interchange/test/diagnosticPublicApi.test.ts`
- Modify: `packages/compliance/test/diagnosticPublicApi.test.ts`
- Modify: `packages/agents/test/diagnosticPublicApi.test.ts`
- Modify: `package.json`
- Create: `tools/docs/diagnostics-legacy-denylist.json`
- Create: `tools/docs/check-diagnostics-stale.mts`
- Create: `tools/docs/check-diagnostics-stale.test.mts`
- Preserve: `packages/core/test/fixtures/quarterlyCasualtyV05Golden.ts`

**Produces:** only the generalized `0.6.0` diagnostics surface, while retaining
the API-independent numeric golden and migration evidence.

### Steps

- [ ] Re-run all package declaration snapshots before deletion and inventory
  every remaining consumer of the temporary legacy module or old exported
  name. Migrate a real consumer to its owning new API; do not replace an old
  symbol with an alias, deprecation wrapper, `any`, or dual-shape dispatcher.
- [ ] Move both complete Task 1 lists—the exported symbols and the supplemental
  non-export identifiers/tokens/IDs—verbatim into one machine-readable
  `diagnostics-legacy-denylist.json`. Give every entry its category and exact
  `whole-identifier` or `exact-string-token` matcher, and maintain an exact
  occurrence allowlist—normalized path, denylist entry, complete line text,
  expected count, and nonempty reason—only for marked history, migration
  examples, the immutable golden/map, and legitimate caller-owned capped-basis
  examples.
  Implement one checker that supports source/declaration and `tracked-docs`
  scopes. Despite that stable CLI name, the documentation scope must enumerate
  cached plus nonignored working-tree Markdown/MDX with
  `git ls-files --cached --others --exclude-standard`, so a newly created but
  unstaged migration/reference page is checked. No task may maintain a second
  hand-copied regex subset.
- [ ] Add `check-diagnostics-stale.test.mts` with temporary source,
  declaration, Markdown, and allowlist fixtures. Pin whole-identifier
  boundaries (`MetricEvaluation` must not match
  `DiagnosticMetricEvaluation`), literal-aware source/config matching,
  unquoted Markdown/MDX token boundaries, bare retired tokens immediately
  followed by sentence `.`, `:`, and `/` punctuation that must match, and
  slash/dotted/colon namespaced, URL, and `%HH`-encoded larger tokens that must
  not match a retired strict subspan, every scope, deterministic
  diagnostics, exact path+entry+line+count+reason allowlisting, path
  normalization, duplicate entries, a new bare hit elsewhere in an allowlisted
  file, a new untracked nonignored document, and rejection of changed,
  overbroad, stale, or unused allowlist entries.
  Expose it as
  `diagnostics:legacy:test`; the checker must never silently widen a match or
  accept a directory-wide/blank-reason exception.
- [ ] Add negative compile/declaration assertions for all five packages before
  deletion and observe them fail on the remaining legacy exports. They must
  load the canonical denylist and require every removed Task 1 name to be absent from source entry points and
  `dist/**/*.d.ts`, while every new owner-controlled brand assertion, gate,
  provenance, and typed definition export appears exactly once.
- [ ] Delete the isolated legacy implementation and remove every old export
  listed in Task 1, including the old aggregate helpers and flattened
  compliance provenance constructor/types. Keep the frozen numeric golden and
  explicit old-ID→new-ID migration map as test data only.
- [ ] Run a production-source import graph scan proving no package or example
  imports `legacyDiagnostics`, no old runner call shape remains, and no
  compatibility file is reachable from a package `exports` map.
- [ ] Add `diagnostics:legacy:check` to run the same checker and execute its
  source/declaration scope at this deletion boundary. Task 17 composes the
  tracked-document scope into `docs:check` with the same artifact.
- [ ] Run the focused golden parity, complete package typechecks, and full SDK
  suite at the deletion boundary:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run build
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run diagnostics:legacy:test
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run diagnostics:legacy:check -- --scope=source,declarations
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test
  ```

- [ ] Inspect all five generated entry declarations manually and commit:
  `refactor!: remove the v0.5 diagnostics API surface`.

### Task 15 acceptance

- No old diagnostics name is exported, implemented, or consumed by active code.
- No compatibility alias or dual runtime path exists.
- The old 22-output numbers remain proven through generalized two-basis
  configuration and the immutable API-independent golden.
- The complete repository is green on the exact deletion commit.

---

## Task 16: Build the holistic real-world diagnostic pipeline

**Purpose:** exercise the generalized design through public imports against the
complete pinned French motor source, while ordinary tests remain small and
offline.

**Files:**

- Modify: `examples/real-world-loss-run/scripts/transform-source.R`
- Create: `examples/real-world-loss-run/data/diagnostic-snapshots.csv`
- Modify: `examples/real-world-loss-run/src/main.ts`
- Modify: `examples/real-world-loss-run/test/example.test.ts`
- Create: `examples/real-world-loss-run/scripts/check-determinism.mts`
- Modify: `examples/real-world-loss-run/package.json`
- Modify: `package-lock.json`
- Modify: `examples/real-world-loss-run/README.md`
- Modify: `examples/real-world-loss-run/SOURCE.md`
- Modify if artifact metadata is added: `examples/real-world-loss-run/source-manifest.json`
- Modify: `examples/reserve-review/test/example.test.ts` only for a public-import
  smoke if needed

**Produces:** a canonical vertical slice:

```text
pinned source → compact derivative → Zod validation + one compilation → preparation
→ structural + semantic review/gate → annual diagnostic run → views → complete provenance
→ compliance bundle → diagnostic-definition document → parse/verify
```

### Steps

- [ ] Extend the source transform to emit one compact annual aggregate snapshot
  per origin/evaluation year (210 rows for the 20×20 upper triangle), with:

  - reported, open, closed-no-pay, and closed-with-pay counts;
  - gross paid and incurred;
  - net paid and incurred; and
  - origin/evaluation labels.

- [ ] Define and document count semantics explicitly. For the adapted claim-ID
  state, reported means seen by valuation, open follows the mapped source open
  statuses, closed-with-pay means closed with positive cumulative paid, and
  closed-no-pay means the remaining closed state. Record the source ID-collision
  and carry-forward policies; do not imply these are carrier-certified status
  definitions.
- [ ] Keep `generated/freclaimset2motor-annual.csv` ignored and out of ordinary
  CI. The committed compact derivative must be regenerated only from the
  checksum-verified source and base R script.
- [ ] Preserve the source archive URL/version, license/attribution, SHA-256,
  retrieval record, upstream script provenance, and derivative-generation
  command in `SOURCE.md`/the source manifest. Recompute and pin the compact
  derivative digest so the example never relies on a mutable download.
- [ ] Give the archive, upstream/base transform, diagnostics transform,
  source manifest, committed compact derivative, and exposure file stable
  artifact IDs. Loss snapshots reference the compact derivative artifact and
  row; exposure observations reference the exposure-file artifact and row;
  any expected-cell/evidence record references its own actual source or relies
  on the validation-bound dataset fallback. Record an acyclic preparation-lineage
  path from the archive through the scripts/manifest to **each** generated
  downstream input artifact, including both the compact diagnostic snapshots
  and `exposures.csv`; do not leave either exposure generation or generic
  count/status/exposure normalization as unreferenced prose.
- [ ] Add independent transformation invariants:

  - exactly 210 snapshot rows;
  - `reported = open + CNP + CWP` for every row under the documented mapping;
  - amounts reconcile to the existing four committed triangle CSVs;
  - final-origin counts reconcile to the adapted claim state; and
  - no non-finite output.

- [ ] Add `@actuarial-ts/interchange` to the example. Continue consuming core,
  data, and compliance only through public package exports.
- [ ] Build an annual definition with one claim-count population,
  an origin-static exposure basis declared as `basis: "other"`, unit
  `insurance-year`, and a source description that explicitly declines to infer
  earned/written/in-force semantics from the field name; explicit cumulative/
  point-in-time development semantics; `lossRowGrain: "aggregate"`; required
  completeness; and structured EUR gross/net bases. Create the same six amount
  instances for both bases from the shared four amount-related formula
  templates; do not create gross/net formula variants.
- [ ] Validate the unknown CSV-derived dataset and complete definition through
  `@actuarial-ts/data`, binding a non-empty approved run-preset ID and actual
  execution policy at that boundary. Give every expected-cell/review-evidence
  record its actual row-level source when one exists. If any remains unsourced,
  bind a distinct stable canonical-dataset artifact ID before execution; after
  completion, compute that SDK artifact from the UTF-8 bytes of
  `canonicalJson({ inputAudit: completed.prepared.inputAudit, reviewEvidence:
  completed.review.evidence })` exactly as specified. The compact derivative
  remains its own row-source artifact and must never masquerade as this
  fallback. Use
  `runValidatedMetricDiagnostics` so compilation and preparation each happen
  exactly once, review gates the exact prepared object, and all 22 instances
  run only after review passes.
- [ ] Require the completed outcome to carry the same approved preset ID.
  Create verified diagnostic-run provenance with actual SDK-computed bytes/digests and
  the source transformation lineage; do not pass a new preset ID or free-form
  provenance fields at stamping. Prove its dataset artifact ID also matches the
  completed outcome, then pass only that verified value to a wrapped
  compliance bundle containing a typed diagnostic-definition document. Parse
  it back through interchange and verify nested integrity, outer integrity, and
  cross-artifact semantic coherence.
- [ ] Add hand-pinned example assertions for:

  - 6 templates and 22 bound instances;
  - annual period ages and ragged/latest view shape;
  - same formula fingerprints for gross/net pairs;
  - different calculation fingerprints for gross/net pairs;
  - paid/incurred numerators reconciling to existing triangle cells;
  - exposure denominator reconciling to `exposures.csv`;
  - raw values unaffected by presentation scale;
  - real review warnings retained;
  - complete provenance fields and identities;
  - definition body, artifact chain, filter/group/cutoff/preset, review receipt,
  complete pre-exclusion input audit, gate, full result, and package stamps
    all present in provenance;
  - a recomputed canonical-dataset artifact digest tying any unsourced
    expected-cell/evidence records to the exact input-audit/evidence bytes,
    with the compact CSV retained as a separate directly referenced artifact;
  - a run-selection/filter change moving run identity while the reusable
    definition remains stable; assert result-content identity according to the
    actual selected output and always require the run-result binding to move;
  - post-execution preset relabeling, orphan lineage, and a fabricated review
    receipt being rejected;
  - definition document parse/identity verification; and
  - bundle rerun verification.

- [ ] Add a deterministic `--format=canonical-json` path to the same public
  example entry point. It serializes the complete normalized public outcome
  with the SDK canonical JSON implementation, supplies every timestamp as a
  fixed caller value, reads committed inputs only, and excludes no
  identity-bearing field. Implement `scripts/check-determinism.mts` to launch
  that entry point in two fresh child processes with `TZ=UTC`, compare stdout
  as exact UTF-8 bytes, and fail on a byte difference, stderr, or a nonzero
  exit. Expose it as the workspace script `example:determinism`; the test suite
  also compares the two normalized byte arrays so this property remains an
  ordinary offline CI assertion rather than a manual observation.

- [ ] Keep the existing chain ladder, Cape Cod, quality, and disclosure outputs
  passing. Add the new diagnostic selections/limitations to the ledger and
  disclosure without describing them as actuarial conclusions.
- [ ] Bootstrap the ignored source cache with the existing checksum-verifying
  fetcher before the one release rebuild. `data:fetch` may use the network only
  when the cache is absent or fails the pinned SHA-256; it must verify the hash
  before writing, and neither it nor `data:rebuild` belongs to ordinary CI.
  Then run the offline suite, the exact two-process byte comparison, and the
  human-facing example:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run data:fetch -w @actuarial-ts/example-real-world-loss-run
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run data:rebuild -w @actuarial-ts/example-real-world-loss-run
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/example-real-world-loss-run
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck -w @actuarial-ts/example-real-world-loss-run
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run example:determinism -w @actuarial-ts/example-real-world-loss-run
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run example:real-world
  ```

- [ ] Run `git diff --stat` and confirm no ignored million-row artifact or cache
  entered version control.
- [ ] Run `npm run example` as the four-package reserving consumer regression
  and the complete agents suite from Task 14 as the fifth-package regression.
- [ ] Commit: `feat(examples): exercise generalized diagnostics on real loss data`.

### Task 16 acceptance

- Ordinary CI reads only compact committed data and performs no network access.
- Gross and net reuse formulas while retaining distinct basis and calculation
  identities.
- The vertical slice crosses core, data, interchange, and compliance; agents
  integration is separately covered by the trusted-catalog suite.
- The original source, transformation implementation/manifest, committed
  derivative, and exposure input form one verified provenance graph with no
  generated downstream artifact or upstream transformation orphaned.
- Two clean-process executions produce byte-identical canonical normalized
  output while the human-facing example remains readable.
- Existing real-world reserving results remain unchanged.

---

## Task 17: Make all active documentation and examples current

**Purpose:** ensure consumers cannot encounter a `0.5.0` mental model in active
documentation after installing `0.6.0`.

**Files to update:**

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `package.json`
- `packages/core/package.json`
- `packages/data/package.json`
- `packages/interchange/package.json`
- `packages/compliance/package.json`
- `packages/agents/package.json`
- `packages/core/README.md`
- `packages/data/README.md`
- `packages/interchange/README.md`
- `packages/compliance/README.md`
- `packages/agents/README.md`
- `docs/README.md`
- `docs/spec/actuarial-interchange.md`
- `docs/interop/convention-map.md`
- `docs/interop/reproducibility.md`
- `docs/interop/upstream/README.md`
- `docs/interop/upstream/chainladder-python-proposal.md`
- `docs/interop/upstream/r-chainladder-note.md`
- `docs/publishing.md` (future-release runbook only)
- `interop/python/README.md`
- `interop/sidecar/README.md`
- `tools/interop/README.md`
- `interop/conformance/README.md`
- `examples/real-world-loss-run/README.md`
- `examples/real-world-loss-run/SOURCE.md`
- `examples/reserve-review/package.json`
- `examples/reserve-review/src/main.ts`
- `packages/core/test/fixtures/quarterlyCasualty.md`
- `CONTRIBUTING.md` (new commands only)
- `VERSIONING.md` (new document kind → wire-minor rule)
- `CHANGELOG.md` (`Unreleased` only at this stage)
- `docs/research/interop/mastra-mcp-capabilities.md` (mark as a dated
  historical environment snapshot; do not rewrite its observed facts)
- `tools/docs/diagnostics-legacy-denylist.json`
- `tools/docs/check-diagnostics-stale.mts`

**Files to create:**

- `docs/migrations/0.6-generalized-diagnostics.md`
- `docs/reference/diagnostic-formulas.md`
- `tools/docs/documentation-inventory.json`
- `tools/docs/public-snippet-manifest.json`
- `tools/docs/check-documentation.mts`
- `tools/docs/check-documentation.test.mts`
- `tools/docs/render-diagnostic-reference.mts`

**Files to preserve as history:**

- `CHANGELOG.md` sections `0.4.0` and `0.5.0`
- `docs/publishing.md` existing release records
- `schema/interchange/1.0/*`
- earlier implementation plans/specs except the already-added superseded banner
- `packages/compliance/test/fixtures/v0_1_bundle.json`
- `docs/superpowers/specs/2026-07-07-expected-losses-design.md`

### Steps

- [ ] Treat the file list above as the known minimum, not a closed inventory.
  Enumerate every tracked or nonignored working-tree Markdown/MDX
  package/example/schema document with
  `git ls-files --cached --others --exclude-standard -- '*.md' '*.mdx'` and
  every JSDoc-exported symbol reachable from a package's declared public
  `types`/`exports` entrypoint graph in generated declarations. This makes
  the check independent of whether newly created docs have been staged. Commit
  `documentation-inventory.json`, keyed by normalized path, with an explicit
  `active`, `historical-snapshot`, or `unrelated` classification and nonempty
  reason for every document; active entries also declare the package(s) whose
  public API names they may cite. The checker must require exact set equality
  with that Markdown/MDX set, reject a manifest path that is ignored by Git,
  and reject missing, duplicate, stale, or unused entries. Test both staged and
  untracked new documents. Classify
  `interop/sidecar/README.md` as active operator documentation and mark
  `docs/research/interop/mastra-mcp-capabilities.md` as a dated historical
  environment snapshot so its recorded Mastra/MCP versions are not mistaken
  for current setup guidance. Classify every diagnostics/version hit as an
  update, historical record, or legitimate unrelated use; a newly tracked page
  must never bypass review merely because it contains no legacy token.
- [ ] Reconcile the reserve-review example's package description, source
  header, root guidance, `AGENTS.md`, and `CLAUDE.md` with executable reality:
  it is the tested four-package deterministic reserving consumer because an
  agent tool requires a host context. State that agents is exercised by its
  trusted-catalog suite and the all-five packed consumer. Do not continue
  claiming reserve-review itself imports five
  packages, and do not add a token agent import solely to satisfy prose.
- [ ] Add a deterministic docs renderer that reads built
  `CASUALTY_FORMULA_TEMPLATES` and a deterministic
  `createCasualtyMetricInstances` sample. Emit the six template IDs/order,
  roles/constraints/expressions, all ten count IDs and six-per-basis suffixes
  in order, each instance's formula mapping and bindings, presentation
  defaults, the two generated rules with exact IDs/messages/tolerances, and
  the `10 + 6×basis` count relationship. No identity-bearing factory catalog
  detail may remain a hand-maintained table outside the generated source.
- [ ] Implement `check-documentation.mts` and focused temporary-fixture tests.
  It must load `documentation-inventory.json` and
  `public-snippet-manifest.json`; parse Markdown rather than regex; validate
  every inventoried internal inline/reference/image destination and
  percent-decoded fragment against case-sensitive files and generated heading
  anchors; and
  reject duplicate, missing, stale, or unused manifest entries. Build each
  named package's export set by resolving its manifest's public `types` and
  `exports` entrypoints into emitted declarations and recursively traversing
  only their declaration re-export graph. Never union every `export` found in
  `dist/**/*.d.ts`: an internal declaration that is not reachable from a
  public entrypoint is not a consumer API. Require every manifest-classified
  public API reference/import in active docs to resolve to its declared owner,
  with exact path/token/reason exceptions only for fields, language terms, and
  explicit migration removals. Include a focused fixture in which an internal
  `.d.ts` exports a symbol absent from `dist/index.d.ts`; citing that symbol in
  active prose must fail even though a declaration exists on disk.
- [ ] Make the snippet manifest identify every fenced block in every active
  document by path, heading, language, ordinal, and content hash, so adding or
  changing a fence requires review. Compile all current `0.6.0` TypeScript
  snippets with `tsc --noEmit` against built public entry declarations;
  strict-parse JSON; parse JSONC with its documented comments/trailing-comma
  semantics; run `bash -n` on Bash/sh; and parse YAML with an explicit direct
  parser dependency. Map test-owned runnable snippets to an exact source/test
  marker that the checker proves still exists. Python
  public snippets are AST-parsed and exercised by an exact pytest marker in
  the Python workflow; R public snippets are parsed by the resolved pinned
  `ACTUARIAL_TS_RSCRIPT` and exercised by an exact R conformance/test marker;
  those two shore-specific snippet checks are also called by the canonical
  release gate. Public HTML/CSV or any other executable/configuration fence
  must map to an exact existing parser/test marker. Compile migration
  before-snippets against Task 0's frozen `0.5.0` ambient declaration fixture.
  Only non-public output, diagrams, or pseudocode may use a syntax-only or
  illustrative exception, always with an exact nonempty reviewed reason.
  Reject unclassified fences and unused exceptions. Tests cover broken/case-
  mismatched paths, missing/duplicate anchors, reference links, fenced blocks
  inside list indentation, stale hashes/test markers, misspelled public names,
  strict JSON versus JSONC, YAML, Python/R test ownership, old/new declaration
  selection, and a new untracked/staged unclassified document or fence.
- [ ] Add `docs:diagnostics`, offline `docs:check:test`, a read-only base
  `docs:check`, and `docs:check:py` / `docs:check:r` shore scripts, all backed
  by the same checker and manifests. The base check first runs the focused
  checker test, then diffs generated reference content in memory or a temp
  path, invokes the
  Task 15 checker in `tracked-docs` scope, and runs the inventory/link/API/
  language-neutral snippet checker without rewriting the worktree. The Python
  script uses `ACTUARIAL_TS_PYTHON` (default `python3`) and the R script uses
  the already-defined `ACTUARIAL_TS_RSCRIPT` contract; both consume the same
  extracted manifest entries and never implement a second Markdown parser.
  All commands load the same canonical denylist/allowlist artifact; no docs
  command embeds a second list of legacy names.
- [ ] Generate and commit `docs/reference/diagnostic-formulas.md`. Link the
  formula reference and `docs/migrations/0.6-generalized-diagnostics.md` from
  `README.md`, `docs/README.md`, every affected package README, and the
  `CHANGELOG.md` Unreleased section; `docs:check` asserts those exact inbound
  links. Repository docs use checked relative links. Because `docs/reference`
  and `docs/migrations` are outside every npm package tarball, package READMEs
  use exact
  `https://github.com/yerromnitsuj/actng/blob/v0.6.0/docs/reference/diagnostic-formulas.md`
  and
  `https://github.com/yerromnitsuj/actng/blob/v0.6.0/docs/migrations/0.6-generalized-diagnostics.md`
  links—never broken `../../docs` paths—and the packed smoke inspects their
  rendered link targets. Do not manually duplicate formula tables across
  package guides.
- [ ] Rewrite the root overview and core guide around:

  - measure → template → instance → calculation → presentation;
  - six formula templates and 16 one-basis instances;
  - arbitrary caller bases, including one explicit capped example;
  - ratio-of-sums/null invariants;
  - per-measure missingness, count populations, amount/exposure bases, and
    exposure timing, including catalog-only compatibility groups versus
    explicit formula-role development-semantics constraints;
  - mixed-cadence/two-coordinate period axes, declarative rules, and
    definition/run/result identities; and
  - complete runnable snippets copied from or exercised by tests/examples.

- [ ] Rewrite data docs around atomic whole-config validation, long exposure
  observations, the exact structural-check catalog/order, review scope before
  post-map output filtering, both missing-input policies, authored run/policy
  defaults, the cross-shore string contract, complete pre-exclusion input audit,
  the classification/reconciliation matrix and timing-specific exposure
  filters, global expected-grid uniqueness/no implicit source-group
  expectation, exact per-code finding cardinality/context/source unions,
  validation error shape, projection/gate topology, generic rule variants, and
  the optional casualty rule factory.
  Remove the claim that the review suite is a fixed quarterly 19-code taxonomy.
- [ ] Rewrite compliance docs around complete normalized provenance, identity
  verification, `DiagnosticRunProvenance`, typed artifact-digest assurance and
  transformation lineage, boundary-bound run presets/dataset artifacts,
  excluded-input artifact coverage, semantic review identity versus human
  detail rendering, regenerated review, verified-versus-serialized provenance, run/result
  identity, cross-artifact coherence, material judgment fields, nested typed
  definitions, typed verifier paths, and honest FNV limitations. Remove the flattened
  `createDiagnosticsProvenance` and callback-omission guidance.
- [ ] Rewrite `interop/sidecar/README.md` as current operator guidance: require
  the exact Python 3.12 scientific/sidecar environment, link the canonical
  pinned requirements and engine-identity contract, show the authenticated
  boot/test path and stable `release:gate` command, and explicitly distinguish
  it from the narrower Python 3.10 base-adapter/document conformance floor.
  The environment checker and documentation checker must fail if those support
  statements or canonical commands drift.
- [ ] Update interchange's normative spec and READMEs to revision the document
  to rev `2.4` with a clearly dated additive section (preserving the prior
  as-built text), then update the docs index. Document the expanded kind list,
  wire `1.1.0`, semantic-body mapping, schema directory, nested bundle
  definitions, version behavior, and cross-shore conformance. Correct the stale
  core dependency wording to the matching lockstep release.
- [ ] Refresh the two still-unsent, founder-reviewed upstream proposal drafts
  and their index only where they describe the current interchange revision,
  wire/schema support, or conformance evidence. Preserve their NOT-SENT status,
  intended recipient/tone, and the rule that nothing is auto-posted. Treat the
  dated bootstrap-determinism defect record as historical observed evidence,
  not current environment guidance.
- [ ] Update agents docs with the trusted-catalog boundary and a clear statement
  that a model may select reviewed instances plus host-approved run presets,
  but cannot define calculations/populations or slice a cached superset into an
  unstamped apparent run. Document the strict input/result schemas and concrete
  `DiagnosticSelectionTool` generic type rather than an output-unknown wrapper.
  Also document the shared breaking `defineActuarialTool` contract: required
  exact SDK `execute`, recursively readonly `ToolEnvelopeFailure`, optional
  output schemas covering `TResult | ToolEnvelopeFailure`, once-only transforms,
  raw public `z.input` versus parsed body-callback `z.output` typing,
  failure-envelope preservation, and normalized input/output/undefined failures
  instead of exposed Mastra `ValidationError | void`.
- [ ] Update only the active future-release runbook portion of
  `docs/publishing.md`: compliance now depends on data, the stable packed and
  registry smoke commands replace ad hoc checks, and publication/tagging uses
  the recorded release-source SHA. Preserve every prior release record
  byte-for-byte and do not append the `0.6.0` record before registry
  verification.
- [ ] Write the migration guide with side-by-side `0.5.0` and `0.6.0` examples
  for:

  - prerequisites and upgrade mechanics: install all five SDK packages at the
    same `0.6.0` version with no aliases/shims; use Node 20+ only for the four
    framework-free packages and Node `>=22.13.0` for agents/all-five; satisfy
    the exact Mastra core/MCP/Zod peer ranges and tested lower bounds; explain
    wire writer `1.1.0`, the additive `diagnostic-definition` kind and `1.0`
    reader compatibility; and distinguish Python/R adapter `0.2.0` from npm
    package versions. End with one copy/paste clean-install, public-import,
    typecheck, and representative-run verification sequence;

  - old metric definition → template + instance;
  - global sparse policy → measure-local missingness;
  - wide exposure row → long observation;
  - ambiguous input `group` → `sourceGroup`, with `group` reserved for mapped
    result groups;
  - ageMonths → period axis;
  - callback warning → comparison rule;
  - optional/truncated diagnostic finding context → complete findings with
    `developmentAge` and `ageUnit`;
  - old amount layer → claim-derived measure + structured basis;
  - public partial aggregate helpers → deterministic definition-driven batch
    aggregation;
  - row-level dimensions → explicit output-group `groupDimensions`;
  - ambiguous `groups` → pre-map `sourceGroups` plus post-map `outputGroups`;
  - removed `policyPeriods` → upstream aligned loss/exposure preparation with
    artifact lineage;
  - unsourced programmatic rows → validation-bound `datasetArtifactId` plus an
    SDK-computed canonical dataset artifact;
  - `$250K` / primary hard-coded preset → two caller basis bindings; and
  - flattened/free-form provenance and opaque extensions → completed-run-only
    verified provenance for authoring, plain `DiagnosticRunProvenance` for
    storage, and a typed definition document in a wrapped bundle.
  - legacy `defineActuarialTool` typing/output-schema assumptions → the exact
    `DefinedActuarialTool` execute union, readonly failure shape, and a supplied
    schema that accepts the complete success/failure union; include schema-less
    and schema-bearing before/after snippets, a type-changing input transform
    showing raw `z.input` at public execute and parsed `z.output` in the body,
    and the exact
    `TOOL_INPUT_INVALID`, `TOOL_OUTPUT_INVALID`, and `BAD_OUTPUT_SCHEMA`
    behavior.

- [ ] Document the exact normalized-definition defaults/order once in the
  core/interchange reference and link to it from other package guides. Explain
  formula versus calculation versus full-definition dependency scopes,
  including rule-only `semanticReferences`, without duplicating a hand-edited
  identity table across READMEs.

- [ ] Update package descriptions/keywords where the old quarterly/fixed
  description is incomplete.
- [ ] Expand `CHANGELOG.md`'s `Unreleased` section into a complete release note
  grouped by core, data, interchange, compliance, agents, examples/interop,
  runtime support, and release tooling. Identify every breaking removal and
  support-floor/peer change, the new wire kind/version and reader behavior,
  owner-normalized review/run/result identities, three-shore conformance, and
  the real-world example; link the migration guide and generated formula
  reference. Preserve the historical `0.4.0`/`0.5.0` sections byte-for-byte.
  Task 20 may date this complete section but must not invent missing release
  content during publication.
- [ ] Add the real-world diagnostic rebuild/run instructions and every source
  interpretation to the example docs.
- [ ] Run the canonical scoped stale-reference audit:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run diagnostics:legacy:check -- --scope=tracked-docs
  ```

  The checker loads both complete Task 1 lists from
  `diagnostics-legacy-denylist.json`, enumerates every cached or nonignored
  working-tree Markdown/MDX plus the generated declaration/source scope it
  owns, and requires each hit to be
  removed or matched by one exact occurrence allowlist entry from Task 15.
  Legitimate
  exceptions include the marked historical spec/release records, this
  spec/plan's migration/removal instructions, the migration guide, the old
  golden/migration map, and caller-owned capped-basis examples. Do not add a
  separate regex subset or blanket-replace unrelated expected-loss capping,
  `capClaims`, interchange triangle `primary`, or estimate-basis text.
- [ ] Run link/code/docs checks:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run diagnostics:legacy:test
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run docs:check
  ACTUARIAL_TS_PYTHON="$PWD/.venv-interop/bin/python" PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run docs:check:py
  ACTUARIAL_TS_RSCRIPT="${ACTUARIAL_TS_RSCRIPT:-Rscript}" PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run docs:check:r
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run example:real-world
  ```

  This authoring pass uses the existing interop environments; Task 19 repeats
  both shore checks under the exact release-gate Python/R contracts.

- [ ] Manually verify every changed internal Markdown link and every public API
  name against generated declarations.
- [ ] Do not commit the live `0.6.0` docs against `0.5.0` manifests or publish
  forward references to Task 19 commands. Carry the verified documentation
  changes through Tasks 18 and 19; the actual command names/options must be
  checked against the implemented scripts before their one atomic release-
  candidate commit.

### Task 17 acceptance

- Formula/template, factory-instance, presentation, and generated-rule
  reference drift is machine-detected.
- Every tracked active document has been inventoried and describes only the
  `0.6.0` model; the checked allowlist explains every stale-looking hit.
- Historical documents remain truthful records rather than being rewritten.
- Every internal path/anchor and classified public API name is machine-checked;
  the migration and formula references have required inbound links, including
  package-distribution-safe links.
- Every public snippet is compiled or exercised by a test/example; every other
  fence has an exact reviewed classification and reason.

---

## Task 18: Apply lockstep `0.6.0` and wire `1.1.0` release stamps

**Purpose:** ensure every package, dependency range, generated stamp, example,
and document reports one coherent release.

**Package-version files:**

- `packages/core/package.json`
- `packages/interchange/package.json`
- `packages/data/package.json`
- `packages/compliance/package.json`
- `packages/agents/package.json`
- `package-lock.json`

**Runtime/version constants:**

- `packages/core/src/version.ts`
- `packages/data/src/version.ts`
- `packages/interchange/src/envelope.ts`
- `packages/interchange/src/convert/result.ts`
- `packages/compliance/src/bundle.ts`
- `packages/compliance/src/version.ts`
- `interop/python/pyproject.toml`
- `interop/python/actuarial_interchange/documents.py`
- `tools/interop/actuarialInterchange.R`

**Public declaration snapshots affected by literal stamps:**

- `packages/core/test/diagnosticPublicApi.test.ts`
- `packages/data/test/diagnosticPublicApi.test.ts`
- `packages/interchange/test/diagnosticPublicApi.test.ts`
- `packages/compliance/test/diagnosticPublicApi.test.ts`

**Version-gate implementation:**

- Create: `tools/release/check-version-sync.mjs`
- Create: `tools/release/check-version-sync.test.mjs`
- Modify: root `package.json` to add `version:check`

**Live SDK-version examples:**

- `README.md`
- `packages/compliance/README.md`
- `packages/compliance/test/diagnosticsBundle.test.ts`
- `examples/reserve-review/src/main.ts`
- `examples/real-world-loss-run/src/main.ts`
- `examples/chain-ladder-typescript/src/main.ts`
- `examples/chain-ladder-typescript/app/server.ts`
- `examples/chain-ladder-python/src/main.ts`
- `examples/chain-ladder-python/app/server.ts`
- `examples/chain-ladder-r/src/main.ts`
- `examples/chain-ladder-r/app/server.ts`

### Steps

- [ ] Set all five `@actuarial-ts/*` package versions to `0.6.0`.
- [ ] Set every dependency edge **among the five publishable
  `@actuarial-ts/*` packages** to `^0.6.0`. Keep the root and private example
  workspace dependencies at their intentional `*` ranges; those are local
  integration consumers, not published lockstep edges. Republish the agents
  package even if some underlying agent infrastructure is otherwise unchanged;
  lockstep is mandatory on 0.x.
- [ ] Keep the root package and all private example workspace versions at
  `0.0.0`.
- [ ] Set the Task 2/9 core/data constants and the existing
  interchange/compliance TypeScript package constants to `0.6.0`; set wire
  writer stamps to `1.1.0`. Do not add an agents version constant merely for
  this gate. Update the four owning declaration snapshots in the same step so
  their inferred exported literal types move from `0.5.0`/`1.0.0` to
  `0.6.0`/`1.1.0`; do not widen them to `string` to avoid the snapshot change.
- [ ] Set the Python adapter pyproject/generator and R adapter default generator
  to `0.2.0`; their release stream is independent of npm lockstep. Set their
  wire writers to `1.1.0`.
- [ ] Regenerate `package-lock.json` through Node 22 `npm install`; do not edit
  lockfile entries by hand.
- [ ] Update every live SDK version embedded in examples and tests. Preserve
  intentional historical/compatibility values such as `0.1.0`, `0.2.0`, and
  frozen corpus generator stamps.
- [ ] Add/extend version-sync tests that compare:

  - all five package manifests directly for lockstep equality;
  - core/data/interchange/compliance exported package constants to their
    manifests;
  - every dependency edge among those five publishable packages to `^0.6.0`,
    while private example workspace ranges remain `*`;
  - `engines.node` remains `>=20` for core/data/interchange/compliance and is
    exactly `>=22.13.0` for both the private all-workspace root and agents;
    agents peers remain
    `@mastra/core >=1.51.0 <2`, `@mastra/mcp >=1.14.0 <2`, and
    `zod ^3.25.76`;
  - every current TypeScript writer—including interchange converters/referees
    through `INTERCHANGE_SPEC_VERSION` and compliance wrapped bundles—to wire
    `1.1.0` and the complete `schema/interchange/1.1` directory;
  - Python `pyproject.toml` version and `GENERATOR_VERSION` both to `0.2.0`,
    `requires-python` still exactly `>=3.10`, with `SPEC_VERSION` and a newly
    authored default `Document` at wire `1.1.0`; and
  - R's default `ats_assemble_document()` generator version to `0.2.0` and its
    emitted `interchangeVersion` to `1.1.0`; and
  - every package-README formula/migration URL uses a `blob/v<lockstep
    package-version>/...` segment derived from the manifests—exactly
    `blob/v0.6.0/...` in this release—rather than `main`, another version, or a
    repo-relative path that will break in the npm tarball.

  Implement these assertions in
  `tools/release/check-version-sync.test.mjs`; expose the same read-only checks
  through `npm run version:check`. The test must parse manifests and named
  exported constants/literals from disk, including
  `packages/compliance/src/bundle.ts`, rather than relying on a hand-maintained
  list of expected runtime values in documentation.

- [ ] Run a deliberate search and classify every remaining version hit:

  ```bash
  rg -n '0\.5\.0|\^0\.5\.0|interchangeVersion.?[:=].?"1\.0\.0"|SPEC_VERSION = "1\.0\.0"' \
    --glob '!CHANGELOG.md' \
    --glob '!docs/publishing.md' \
    --glob '!docs/superpowers/**' \
    --glob '!packages/compliance/test/fixtures/**' \
    --glob '!interop/conformance/fixtures/**' \
    --glob '!node_modules/**' \
    --glob '!dist/**'
  ```

- [ ] Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm install
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" node --test tools/release/check-version-sync.test.mjs
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run version:check
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core -- diagnosticPublicApi.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/data -- diagnosticPublicApi.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/interchange -- diagnosticPublicApi.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/compliance -- diagnosticPublicApi.test.ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run build
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck
  ```

- [ ] Keep the new feature notes under `Unreleased` until Task 20 is explicitly
  authorized and its release-source commit is cut. Dating the complete
  changelog for that commit precedes registry publication; the separate
  publishing record still waits for successful registry verification.
- [ ] Do not commit this boundary yet. Carry the docs and version changes into
  Task 19 so `smoke:packed`, `release:gate`, the R environment contract, CI,
  and the documentation describing them first appear together.

### Task 18 acceptance

- All five packages and every dependency edge among them are lockstep `0.6.0`;
  private example workspace ranges remain intentionally `*`.
- Active documentation and runtime/manifests first become `0.6.0` together in
  this atomic commit.
- Runtime engines and peer floors match the actual split support matrix: four
  framework-free packages on Node 20+, agents/all-five on Node 22.13+.
- The wire writer is `1.1.0` on all three shores.
- Python and R adapter generator versions are exactly `0.2.0`.
- Every remaining old version string is a documented historical fixture or
  compatibility test.

---

## Task 19: Run the whole-SDK, clean-package, and documentation gates

**Purpose:** verify individual modules, cross-package behavior, three-shore
interop, examples, packaging, dependency hygiene, and documentation as one
release candidate.

**Files:**

- Create: `tools/release/smoke-packed-diagnostics.mjs`
- Create: `tools/release/smoke-packed-diagnostics.test.mjs`
- Create: `tools/release/run-generalized-diagnostics-gate.sh`
- Create: `tools/release/run-generalized-diagnostics-gate.test.mjs`
- Create: `tools/release/check-sidecar-engine.py`
- Create: `tools/release/test-check-sidecar-engine.py`
- Create: `tools/release/check-npm-advisories.mjs`
- Create: `tools/release/check-npm-advisories.test.mjs`
- Create: `tools/release/advisory-allowlist.json`
- Create: `tools/interop/r-environment.json`
- Create: `tools/interop/install-r-environment.R`
- Create: `tools/interop/check-r-environment.R`
- Create: `tools/interop/test-r-environment.R`
- Modify: `examples/chain-ladder-r/src/rscript.ts`
- Modify: `examples/chain-ladder-r/test/example.test.ts`
- Modify: `examples/chain-ladder-r/test/app.test.ts`
- Modify: `examples/chain-ladder-crosscheck/src/rscript.ts`
- Modify: `examples/chain-ladder-crosscheck/test/example.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/py-conformance.yml`
- Modify: `.github/workflows/r-conformance.yml`
- Modify: `package.json` for stable `release:gate`, `release:gate:test`, and
  `advisories:check`, `advisories:test`, `smoke:packed:test`, and other
  release-check scripts
- Finalize: `CONTRIBUTING.md`
- Finalize: `interop/sidecar/README.md`
- Finalize: `tools/interop/README.md`
- Finalize: `docs/interop/reproducibility.md`
- Finalize: `docs/superpowers/specs/2026-09-03-generalized-diagnostics-sdk.md`
- Finalize: `docs/superpowers/plans/2026-09-03-generalized-diagnostics-sdk.md`
- Finalize: `docs/README.md` lifecycle labels
- Finalize: `docs/publishing.md` (future-release runbook only)
- No production logic should be first implemented in this task.

### Step 1: CI wiring

- [ ] Add `npm run docs:check` to the main CI job.
- [ ] Add `docs:check:py` to each Python conformance profile after its resolved
  interpreter is exported as `ACTUARIAL_TS_PYTHON`; the minimum 3.10 lane runs
  manifest entries marked base-adapter compatible and the 3.12 lane runs the
  complete Python set. Add `docs:check:r` to R conformance after the exact
  environment check with the resolved executable exported as
  `ACTUARIAL_TS_RSCRIPT`. The language-neutral main-CI check, Python checks,
  and R check all consume the same fence manifest and together must cover it
  exactly once per applicable runtime profile.
- [ ] Provision the checker runtime explicitly in every shore job that invokes
  a docs script. Before `docs:check:py` or `docs:check:r`, use
  `actions/setup-node` with exact Node `22.22.0`, run the major/minor assertion,
  and run root `npm ci`; root `prepare` must emit the declarations consumed by
  the checker. In particular, add these steps to the Python profile jobs that
  currently have no Node/npm installation and move the ordinary R shore from
  its current Node 20 setup to the pinned Node 22 setup before its docs and
  TypeScript example steps. The Python/R language runtimes are then resolved
  and exported independently for their shore-specific docs command. Do not
  rely on a toolchain left by the runner image or on artifacts from a different
  workflow. This pinned checker/bootstrap runtime is distinct from the one
  intentional runtime-four packed-consumer lane that switches to Node 20.
- [ ] Add `npm run version:check` to the main CI job once before `npm ci` and
  again immediately after install, before the explicit build/test gates. The
  first read-only invocation prevents skew from reaching root `prepare` (which
  `npm ci` invokes); the second checks the installed lock state. This script is
  created in Task 18; no earlier task invokes it.
- [ ] Add the packed-public-import smoke or an equivalent tarball job that runs
  without workspace linking.
- [ ] Ensure Python paths include the new diagnostics corpus/module.
- [ ] Ensure R conformance runs the new definition replay.
- [ ] Replace the mutable R-environment assumption with one machine-readable
  contract: R `4.4.3`, `ChainLadder==0.2.21`, `jsonlite==2.0.0`, and the
  R-4.4-compatible transitive pin `Deriv==4.2.0` in
  `tools/interop/r-environment.json`. Make
  both `tools/interop/install-r-environment.R` and
  `tools/interop/check-r-environment.R` read that file. The installer must
  resolve dependencies from each exact package archive rather than moving CRAN
  metadata, require each dependency to be loadable rather than trusting a stale
  installed-package listing, install the compatibility pin before its
  dependants, fail immediately when an exact install is not achieved, and
  install the two exact declared direct-package versions without duplicating
  version literals; the
  checker compares the exact runtime and all pinned package versions and fails
  with actionable guidance. Give both scripts an explicit
  `--contract <path>` seam and the installer a non-mutating `--dry-run` plan
  mode. Have `test-r-environment.R` use only temporary mutated contracts to
  prove pin derivation, mismatch failure, and zero installation or canonical-
  file mutation; it also rejects hard-coded duplicate package versions in
  either script. The R workflow must request R 4.4.3 explicitly, run this test,
  run the installer, and call the checker before conformance; a cache hit never
  substitutes for either check. The local gate
  preflights this contract before creating its Python venv, so it fails early
  rather than silently testing an arbitrary R installation. Changes to the R
  runtime/package pins require a reviewed lock-file change and a full
  three-shore corpus run. Resolve one quoted executable path from
  `ACTUARIAL_TS_RSCRIPT` (default `Rscript`) at gate startup and use it for the
  self-test, checker, conformance, reader test, and R-backed examples; the
  variable is an executable path, not a shell command string. The checker must
  reject any runtime other than 4.4.3 with an actionable message naming that
  variable. In `CONTRIBUTING.md`, document and verify a local 4.4.3 install via
  the official CRAN binary/installer or `rig`, show how to locate its absolute
  `Rscript`, and give the exact quoted variable invocation. Test an executable
  path containing spaces. CI still provisions 4.4.3 explicitly; the package
  installer never pretends it can replace the R runtime.
- [ ] Route both R-backed TypeScript examples through the same
  `ACTUARIAL_TS_RSCRIPT` executable-path convention in availability checks and
  `execFile` calls. Preserve the examples' self-contained helpers, but add
  tests for default lookup, an absolute executable path containing spaces, and
  a missing configured executable. The npm example commands must therefore use
  the runtime already checked by the gate rather than ambient PATH.
- [ ] Keep Node 22.22 as the primary development/conformance runtime, matching
  `.nvmrc`, and run install, build, typecheck, all workspace tests, and the
  all-five packed smoke there. Retain a separate Node 20 packed-runtime lane
  only for core, data, interchange, and compliance, whose manifests continue
  to declare `node >=20`. Have a Node 22 phase build and pack those four into a
  manifest-backed handoff directory, then switch the same CI job to Node 20,
  install only those four tarballs plus their exact external dependency, and
  execute a public-import consumer covering calculation, validation,
  interchange round-trip, and compliance verification. It must not install or
  execute agents, Mastra, or MCP. Agents and every all-five path require Node
  `>=22.13.0`; CI and docs must fail if that support split drifts. The workflow
  uses these direct script phases, with an actual setup-node runtime switch
  between them rather than a root npm script under Node 20:

  ```bash
  # Node 22 phase, after npm ci/build
  node tools/release/smoke-packed-diagnostics.mjs --package-set=runtime-four --pack-only --handoff-dir "$RUNNER_TEMP/actuarial-ts-runtime-four"
  # setup-node has now selected Node 20
  node -e 'if (Number(process.versions.node.split(".")[0]) !== 20) process.exit(1)'
  node tools/release/smoke-packed-diagnostics.mjs --package-set=runtime-four --consume-manifest "$RUNNER_TEMP/actuarial-ts-runtime-four/manifest.json" --require-node-major=20
  ```
- [ ] Keep Python 3.12 as the primary pinned ChainLadder/sidecar runtime, and
  add a separate Python 3.10 minimum-supported adapter lane because
  `interop/python/pyproject.toml` declares `requires-python = ">=3.10"`. The
  3.10 lane installs only the base adapter plus pytest (not the optional
  ChainLadder bridge), then runs `test_jcs.py`, `test_documents.py`, and the new
  `test_diagnostics.py`; the 3.12 lane retains the complete pinned optional-
  dependency, cross-engine, and sidecar matrix. Do not imply that the optional
  scientific stack is supported on 3.10 unless separately proven.
- [ ] Keep workflow path filters broad enough that changes to core definitions,
  schemas, fixtures, compliance, or examples trigger the relevant shore. In
  addition, changes under `docs/**` or `tools/docs/**`, any inventoried active
  root/package/example/interop Markdown/MDX path, or either documentation/
  snippet manifest must trigger **both** Python and R shore workflows; the
  base main-CI check deliberately cannot substitute for their runtime-owned
  snippet checks. Test the workflow path-filter fixtures for each category.
- [ ] Reconcile every Task 17 forward reference against the actual Task 19 CLI:
  document exact prerequisites, R/Python environment checks, sidecar cleanup,
  `release:gate`, packed versus registry smoke modes, debug retention, and
  failure behavior in all listed operator/runbook documents. Re-run snippet/link/
  stale-reference checks after the scripts settle; do not leave pseudocommands
  or a second hand-maintained environment recipe.

### Step 2: Full local test matrix

- [ ] Implement `tools/release/run-generalized-diagnostics-gate.sh` as the
  single executable local gate and expose it as `npm run release:gate`. Its
  first line is `#!/usr/bin/env bash`, the file has executable mode, and the
  package script invokes it explicitly with `bash` so npm can never select
  `/bin/sh` for its Bash-only syntax. It must use `set -euo pipefail`,
  resolve/chdir to the repository root, require Python 3.12, and run
  the R contract self-test and checker through the one resolved
  `ACTUARIAL_TS_RSCRIPT` executable before expensive setup. It initializes
  empty cleanup state and registers traps before allocating the temporary
  venv/log directory, so allocation failure and an immediate post-allocation
  interrupt are both safe. The exact prelude is:

  ```bash
  python3.12 -c 'import sys; v=sys.version_info[:2]; sys.exit(f"requires Python 3.12, got {sys.version}") if v != (3, 12) else print(sys.version)'
  RSCRIPT_BIN="${ACTUARIAL_TS_RSCRIPT:-Rscript}"
  if [[ "$RSCRIPT_BIN" == */* ]]; then
    [[ -x "$RSCRIPT_BIN" ]]
  else
    RSCRIPT_BIN="$(command -v "$RSCRIPT_BIN")"
  fi
  export ACTUARIAL_TS_RSCRIPT="$RSCRIPT_BIN"
  "$RSCRIPT_BIN" tools/interop/test-r-environment.R
  "$RSCRIPT_BIN" tools/interop/check-r-environment.R
  GATE_TMP=""
  GATE_PYTHON=""
  SIDECAR_LOG=""
  SIDECAR_PID=""
  cleanup() {
    status=$?
    trap - EXIT INT TERM
    if [[ -n "${SIDECAR_PID:-}" ]] && kill -0 "$SIDECAR_PID" 2>/dev/null; then
      kill "$SIDECAR_PID" 2>/dev/null || true
      wait "$SIDECAR_PID" 2>/dev/null || true
    fi
    if [[ "$status" -ne 0 && -n "${SIDECAR_LOG:-}" && -f "$SIDECAR_LOG" ]]; then
      sed -n '1,240p' "$SIDECAR_LOG" >&2
    fi
    if [[ -n "${GATE_TMP:-}" && -d "$GATE_TMP" ]]; then
      rm -rf -- "$GATE_TMP"
    fi
    exit "$status"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  GATE_TMP="$(mktemp -d "${TMPDIR:-/tmp}/actuarial-ts-release-gate.XXXXXX")"
  GATE_PYTHON="$GATE_TMP/venv/bin/python"
  SIDECAR_LOG="$GATE_TMP/sidecar.log"
  echo "release gate temp: $GATE_TMP"
  python3.12 -m venv "$GATE_TMP/venv"
  "$GATE_PYTHON" -m pip install --upgrade pip
  "$GATE_PYTHON" -m pip install -e "interop/python[chainladder]" pytest
  "$GATE_PYTHON" -m pip install -r interop/sidecar/requirements-dev.txt
  "$GATE_PYTHON" -m pip check
  ```

  After installation, have the script read the exact pins from the two sidecar
  requirement files and assert the resolved environment contains
  `chainladder==0.9.2`, `pandas==2.3.3`, `numpy==2.4.6`,
  `fastapi==0.139.2`, `uvicorn==0.51.0`, and `httpx==0.28.1`; the named list is
  also a test that the script and requirement files cannot drift. Run
  `"$GATE_PYTHON" -m pytest interop/sidecar/tests tools/release/test-check-sidecar-engine.py -q`
  before boot. The checked helper accepts one `/v1/engine` JSON document on
  stdin and compares its exact top-level keys, ordered profiles, ordered
  method name/result-kind entries, engine name/version, and interchange
  spec/generator object to the installed sidecar registries and package
  constants; it contains no second hand-maintained identity list.
- [ ] Give that script this exact live-service boot/health lifecycle. The
  already-registered `cleanup` captures the original status, disables all
  three traps, terminates and `wait`s for the child if one was started, prints
  `sidecar.log` on failure, removes the temporary directory, and exits with the
  original status. The `EXIT`/`INT`/`TERM` paths therefore cannot leave a
  process, PID, log, or venv behind. Allocate a free loopback port for this run,
  export the matching `SIDECAR_PORT` and `SIDECAR_URL`, and verify it is still
  bindable immediately before spawn. Generate a fresh cryptographic bearer
  token for every run and establish readiness only through authenticated
  `/v1/engine` with the exact expected engine payload; unauthenticated health
  never proves listener ownership. Never probe fixed port 8091 or accept an
  unrelated listener's response.

  ```bash
  SIDECAR_PORT="$("$GATE_PYTHON" -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
  "$GATE_PYTHON" -c 'import socket, sys; s=socket.socket(); s.bind(("127.0.0.1", int(sys.argv[1]))); s.close()' "$SIDECAR_PORT"
  export SIDECAR_PORT
  export SIDECAR_URL="http://127.0.0.1:$SIDECAR_PORT"
  SIDECAR_TOKEN="$("$GATE_PYTHON" -c 'import secrets; print(secrets.token_urlsafe(32))')"
  export SIDECAR_TOKEN
  PYTHONPATH="$PWD/interop" SIDECAR_TOKEN="$SIDECAR_TOKEN" \
    "$GATE_PYTHON" -m sidecar >"$SIDECAR_LOG" 2>&1 &
  SIDECAR_PID=$!
  SIDECAR_READY=0
  for attempt in {1..60}; do
    if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then
      echo "sidecar exited before becoming healthy" >&2
      exit 1
    fi
    if ENGINE_JSON="$(curl -sf --connect-timeout 1 --max-time 2 -H "Authorization: Bearer $SIDECAR_TOKEN" "$SIDECAR_URL/v1/engine")"; then
      if printf '%s' "$ENGINE_JSON" | PYTHONPATH="$PWD/interop" "$GATE_PYTHON" tools/release/check-sidecar-engine.py; then
        SIDECAR_READY=1
        break
      fi
    fi
    sleep 1
  done
  [[ "$SIDECAR_READY" -eq 1 ]]
  kill -0 "$SIDECAR_PID" 2>/dev/null
  ENGINE_JSON="$(curl -sf --connect-timeout 1 --max-time 2 -H "Authorization: Bearer $SIDECAR_TOKEN" "$SIDECAR_URL/v1/engine")"
  printf '%s' "$ENGINE_JSON" | PYTHONPATH="$PWD/interop" "$GATE_PYTHON" tools/release/check-sidecar-engine.py
  ```

  The generated token is scoped to this ephemeral loopback process and is never
  printed or persisted. CI must call the same script/lifecycle or
  an exact tested wrapper around it; it may not maintain a behaviorally
  different boot recipe.
- [ ] With the healthy service and exported environment still active, run from
  the repository root in this exact order:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run version:check
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm ci
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run version:check
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run release:gate:test
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run build
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run typecheck
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test
  "$GATE_PYTHON" -m pytest interop/python/tests interop/conformance/py interop/sidecar/tests -q
  "$RSCRIPT_BIN" tools/interop/conformance.R
  "$RSCRIPT_BIN" tools/interop/test-read-document.R
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run crosscheck:ci
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run diagnostics:legacy:test
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run diagnostics:legacy:check -- --scope=source,declarations
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run docs:check
  ACTUARIAL_TS_PYTHON="$GATE_PYTHON" PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run docs:check:py
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run docs:check:r
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run advisories:test
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run advisories:check
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run smoke:packed:test
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run example
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run example:real-world
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run example:determinism -w @actuarial-ts/example-real-world-loss-run
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run example:cl-ts
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run example:cl-py
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run example:cl-r
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run example:cl-crosscheck
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run smoke:packed
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run smoke:packed:runtime-four
  ```

  These commands are the normative script body; the ordinary operator command
  is `PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run release:gate`,
  not a manually copied subset.

- [ ] Add `tools/release/run-generalized-diagnostics-gate.test.mjs`, expose it
  as stable `npm run release:gate:test`, and make both the normative gate above
  and main CI execute it. The focused test runs `bash -n`, asserts the
  shebang and executable bit, inspects the root package-script spelling, and
  invokes a dependency-injected dry-run path that records the required command
  order—including the R contract self-test before its environment checker,
  base/Python/R documentation checks, advisory-classifier tests/check, the
  all-five packed smoke, and the
  runtime-four packed smoke—without installing, booting, or
  mutating the worktree. The dry run
  must reject a Python executable whose reported/runtime minor is not exactly
  3.12, even if its filename is `python3.12` and even with
  `PYTHONOPTIMIZE=1`, and
  must still exercise trap registration and a disposable child so the test
  proves exit, pre-allocation interrupt, immediate post-allocation interrupt,
  early-health-failure, and successful cleanup. Force an allocated-port
  collision specifically through a test hook between the final bind check and
  spawn; start an unrelated listener with a different token and prove the gate
  fails after its child exits rather than accepting that listener. Add a
  listener that accepts TCP but never returns headers and prove both readiness
  and final identity probes time out and clean up within the documented bound.
  Also inject an R executable path containing
  spaces, assert every R command receives that exact executable, and scan the
  post-resolution script body for any ambient literal `Rscript` invocation.
  Its explicit test
  mode omits only the nested `release:gate:test` dispatch, preventing recursive
  self-invocation; production mode cannot skip any normative command.

- [ ] Record the actual live-shore outcome; never replace a sidecar failure
  with a fixture-only claim. During review, interrupt one disposable gate run
  after boot and inspect both `kill -0 <captured-pid>` and the printed temp path
  to confirm the trap removed the process and directory; record that manual
  lifecycle check beside the automated gate result.
- [ ] Run the published-value suite directly and record its unchanged anchors:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm test -w @actuarial-ts/core -- validation.test.ts
  ```

### Step 3: Focused invariant sweep

- [ ] Run or inspect named tests proving:

  - six template and 10 + 6×basis counts;
  - exact temporal-role normalization/identity, legal mixed pointwise status
    bindings, strict claim-derivation temporal equality, and cumulative/point-
    in-time monotonic behavior including the fixed closed-reopen signal;
  - old fixture numeric parity;
  - six ratio-of-sums counterexamples;
  - mixed missingness, nullable sums, canonical-order Neumaier accumulation,
    adversarial cancellation/subnormal/overflow serialization;
  - source-cell and mapped-group aggregation overflow, formula/metric-rule and
    top-level-review expression overflow, inherited calculation-field failure,
    and derived-measure missing/non-finite/finite-overflow quality precedence,
    with exact original expression paths, site cardinality, source unions,
    readiness-reason ordering, top-level review overflow records, and correct
    review-gate versus metric-gate outcomes without cascading duplicates;
  - finite/unlimited per-claim limitations before aggregation and derivation
    identity propagation;
  - static/valuation exposure coexistence and no leakage;
  - exact origin-static equality/source union and `N - 1` deduplication;
  - definition-aware missing-valuation rejection plus timing-specific static/
    valuation filter and cutoff behavior;
  - filtered/cutoff/invalid-only pre-exclusion audit identity plus complete
    artifact coverage;
  - mixed origin/valuation month/quarter/year and gapped ordered axes with no
    lexical fallback;
  - every exact rule truth-table/scope/projection and no false pass on missing
    data;
  - cached-formula truth table, complete finding topology, semantic-only review
    identity, and nonrecursive two-stage gates;
  - preparation-owned versus evidence-owned finding topology and direct public
    review-evidence validation/snapshot immutability;
  - exact per-code finding cardinality/context/source unions and control-total
    selected cell/contribution counts;
  - raw/display separation;
  - formula/calculation/definition identity mutation matrix;
  - exact normalized-definition defaults/order and separate calendar/ordered
    three-shore vectors;
  - all view reconciliation;
  - typed nested interchange integrity;
  - exact interchange helper declarations and authentic compiled round-trip;
  - three-shore canonical/replay agreement;
  - complete compliance provenance plus mutually coherent definition/run/result
    identities;
  - regenerated review prose on provenance reverification; and
  - agent trusted-catalog boundary with strict private runtime schemas, exact
    `DefinedActuarialTool` execute input/output, deliberately unknown attached
    metadata-schema/callback types, installed `makeCoreTool` traversal,
    immutable construction-time preset capture, exact selected identity-map
    keys, preserved failure envelopes, and schema-absent undefined rejection.

- [ ] Run the deterministic generated/property loops with at least the committed
  seed set and the 10,000-row performance guard.

### Step 4: Dependency and advisory review

- [ ] Implement `tools/release/check-npm-advisories.mjs` as the sole advisory
  policy boundary. It invokes `npm audit --omit=dev --json` and
  `npm audit --json`, captures and parses JSON even when npm returns its
  expected exit code 1, accepts only exits 0/1, and requires
  `auditReportVersion: 2` plus the documented v2 `vulnerabilities` object. It
  fails closed on spawn/network errors, another exit code, invalid JSON,
  missing referenced vulnerability records, a recursive `via` cycle, or an
  unsupported member shape.
- [ ] Canonically flatten each vulnerable package record and every sorted
  `nodes` install location. Traverse `via` depth-first: an advisory object is a
  leaf; a package-name string recursively resolves that named vulnerability
  record. Emit one record per reachable leaf advisory per install node, so one
  package with several source advisories never collapses to one finding. The
  exact finding key is canonical JSON over advisory source ID, URL, advisory
  package/range/title, affected package/range, install node, conservative
  effective severity (the worse of leaf and affected-record severity), and
  normalized `fixAvailable`. Deduplicate only identical keys and code-unit-sort
  the result. Here “dependency path” means npm v2's normalized `nodes` install
  location, not an invented lockfile ancestry.
- [ ] Flatten production and full reports independently. Classify a full
  install-node record as `production` only when the exact key except
  classification also occurs in the `--omit=dev` set; every other full record
  is `development-only`. A production record missing from the full report or
  two overlapping records with incompatible fields is an audit-schema failure,
  not a guessed classification. Zero high/critical production records is an
  unconditional release rule. Every other record—production low/moderate or
  development-only at any severity—must match one exact, unexpired entry in
  `tools/release/advisory-allowlist.json`; there is no fuzzy package-only
  suppression.
- [ ] Give each allowlist entry a schema version plus the npm advisory source
  ID and URL, advisory package/range/title, affected package/range, one exact
  install node, effective severity, normalized fix availability, `production`
  or `development-only` classification, nonempty reachability rationale,
  remediation or upstream blocker, reviewer, `reviewedAt`, and `expiresAt`.
  Timestamps must be canonical millisecond UTC ISO strings; with an injectable
  clock require `reviewedAt <= now < expiresAt` (equality at expiry is expired).
  Reject duplicate, stale, expired, future-reviewed, unused, partially matching,
  or newly unclassified entries. Normalize only npm ordering, never severity,
  ranges, paths, titles, or fix data. Start with an empty exception array if
  the live audit is clean; never fabricate an exception in advance.
- [ ] Unit-test the classifier with injected fixture JSON and a fake audit
  runner: clean reports; npm vulnerability exit codes; production
  high/critical hard failure even if allowlisted; exact allowed development
  finding; low/moderate production classification; new, changed, duplicate,
  stale, expired, and unused entries; malformed/network/spawn failures; and
  multi-source object/string `via` graphs, shared leaves, cycles, mixed
  production/development install nodes, fix-availability changes, timestamp
  boundaries, and output-order invariance. `advisories:test` is offline;
  `advisories:check` is
  the sole live network-dependent **advisory** command (other release-gate
  phases may also install dependencies). Run:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run advisories:test
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run advisories:check
  ```

- [ ] Do not apply a breaking `--force` update merely to make a count zero.
  Review and time-bound a real exception only when the exact dependency path is
  not reachable or no compatible remediation exists; otherwise upgrade and
  rerun the complete gate.
- [ ] Confirm the core package still has no runtime dependency added solely for
  identity hashing.

### Step 5: Real tarballs and clean consumer

- [ ] Implement `tools/release/smoke-packed-diagnostics.mjs` to run from a fresh
  scratch project and expose it as the stable root command
  `npm run smoke:packed`. The script itself must use `mkdtemp`, pack all five
  workspaces into one retained `PACK_DIR` and parse the emitted filenames.
  Create two independent all-five consumers with `npm init -y`: one installs
  all tarballs plus exact peer versions derived from the root lockfile, and the
  other installs the same tarballs plus the exact concrete lower bounds parsed
  from the agents peer ranges. Fail if a peer range has no testable lower bound
  or either profile violates the agents engine. For this release both profiles
  use `@mastra/core@1.51.0`, `@mastra/mcp@1.14.0`, and `zod@3.25.76` in the
  minimum profile. The release-candidate lock profile resolves
  `@mastra/core@1.64.0`, `@mastra/mcp@1.17.3`, and `zod@3.25.76` after the
  compatible advisory-remediation update. Execute both clean consumers so
  later lock drift cannot silently leave either the declared minimum or the
  resolved integration version untested. Each consumer performs one
  `npm install --save-exact`, runs the same public fixture and `npm ls`, and
  needs no shell-local environment handoff. The fixture must exercise
  `defineActuarialTool` through installed public `makeCoreTool`, not merely
  import agents. The default source is packed tarballs; a documented
  `--source=registry --version=0.6.0` mode installs the five exact registry
  versions and runs the identical fixture after publication. It must import
  only published exports and prove:

  - exactly one physical installed copy of each `@actuarial-ts/*@0.6.0`
    package, especially the core/data owners of runtime-authentic objects;
  - all five packages import successfully;
  - one arbitrary-basis definition compiles;
  - one representative calculation returns the expected raw/display values;
  - one diagnostic definition document round-trips;
  - one provenance bundle verifies;
  - its nested definition, run manifest, and result fingerprints are mutually
    coherent; and
  - the trusted agent tool rejects an unregistered metric or run-preset ID.

- [ ] Have the script inspect every actual tarball file list and unpacked
  manifest before install. Verify `dist`, declarations, README, license/notice,
  and intended source are present; tests, caches, full source data, local env
  files, and planning artifacts are absent. Run the same Markdown-link parser
  against each unpacked README in package-distribution mode: every relative
  destination must exist inside that tarball, repo-only references must use
  the canonical HTTPS repository URL, and no `../` escape to an unpacked
  sibling or absent root `docs/` path is accepted. Run `npm ls` for all five
  scoped packages in the scratch consumer and fail on duplicate package copies
  or invalid peer ranges.
- [ ] Expose `smoke:packed:test` for offline, dependency-injected tests of
  package-set selection, exact peer-floor parsing, lock-profile versus
  minimum-profile command construction, manifest ordering/SHA verification,
  extra/missing/tampered tarballs, cleanup/KEEP behavior, and rejection of an
  agents package in `runtime-four`. The live tarball consumers remain required;
  these unit tests do not replace them.
- [ ] Add a `runtime-four` mode and stable local command
  `npm run smoke:packed:runtime-four`. It packs and consumes only core, data,
  interchange, and compliance and runs the smaller public fixture defined in
  Step 1. Also provide tested `--pack-only --handoff-dir <path>` and
  `--consume-manifest <path>` forms: CI creates the manifest/tarballs under
  Node 22, switches to Node 20, then consumes that exact handoff without
  workspace linking or any agents/Mastra/MCP install. The manifest records
  package names, versions, filenames, and SHA-256 values plus the exact
  lock-derived `zod` coordinate required by data/interchange. Consume mode
  verifies the requested Node major, confirms that exact Zod version satisfies
  both package ranges, installs it with the four tarballs, and rejects an
  extra/missing/tampered tarball or dependency coordinate. Run the all-five stable smoke only under
  Node 22 locally:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run smoke:packed
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run smoke:packed:runtime-four
  ```

  The Node 20 workflow runs only the handoff consumer command after its runtime
  switch. It must never invoke the all-five `smoke:packed` command.

  A documented `KEEP_PACKED_SMOKE=1` debug mode prints and preserves its exact
  temp path for manual inspection; ordinary success/failure cleans it.

### Step 6: Source, docs, and repository hygiene

- [ ] Run:

  ```bash
  git diff --check
  git status --short
  bash -n tools/release/run-generalized-diagnostics-gate.sh
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run release:gate:test
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run diagnostics:legacy:test
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run diagnostics:legacy:check -- --scope=source,declarations
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run docs:check
  ```

- [ ] Repeat the version classification from Task 18, but use only the
  canonical `diagnostics:legacy:test`, `diagnostics:legacy:check`, and
  `docs:check` commands above for legacy API scanning. Do not introduce an ad
  hoc release-only regex or a second historical allowlist.
- [ ] Inspect generated declarations for accidental callbacks, `any` at public
  boundaries, removed aliases, and missing exports.
- [ ] Confirm no million-row data, `.cache`, `dist`, tarball, sidecar log, PID,
  Python cache, or R workspace artifact is staged.
- [ ] Review the complete diff by package boundary and have a second reviewer
  challenge numeric semantics, portability claims, and migration clarity.

### Step 7: CI and release-candidate conclusion

- [ ] After every local gate passes, change the design banner to exactly
  “IMPLEMENTED AND VERIFIED AS A 0.6.0 RELEASE CANDIDATE — NOT YET PUBLISHED,”
  add the matching “EXECUTED THROUGH TASK 19; PUBLICATION REQUIRES SEPARATE
  AUTHORIZATION” plan banner, and make `docs/README.md` use the same lifecycle
  language instead of “planned” or “current implementation plan.” Run
  `git diff --check` and `npm run docs:check` after that final prose mutation,
  then commit the one atomic Tasks 17–19 release-candidate boundary:
  `chore!: stage and verify actuarial-ts 0.6.0 release candidate`.
- [ ] Push that commit, then wait for main CI, Python conformance, and R
  conformance. Fix failures at their owning layer, rerun the complete affected
  local matrix, and replace the candidate commit before pushing again; the
  final successful SHA must still contain the coherent docs/version/tooling/CI
  boundary.
- [ ] Do not call the release candidate complete until all required workflows
  report success on the same commit.

### Task 19 acceptance

- Every local and remote required gate passes on one commit.
- The design, plan, and docs index identify that commit as an implemented,
  verified but unpublished release candidate; none still says merely planned.
- The version-sync guard runs locally and in main CI on that commit.
- Tarball behavior matches workspace behavior.
- Every packed README has only self-contained relative links or canonical
  repository links; no npm-rendered reference escapes to an absent repo path.
- Node 22.13+ all-five gates, lock-resolved and minimum-peer clean consumers,
  and the Node 20 packed-runtime lane for core/data/interchange/compliance only
  pass on the same commit.
- Python 3.12 passes the full pinned scientific/sidecar matrix, and the
  declared-minimum Python 3.10 passes the base adapter/document/diagnostic
  conformance lane on that same commit.
- Three-shore conformance and all examples pass.
- Every active public documentation fence is verified by the base, Python, or
  R documentation gate under its declared runtime profile.
- R conformance runs under exactly R `4.4.3`, `ChainLadder==0.2.21`, and
  `jsonlite==2.0.0`, installed and verified from the one machine-readable
  contract in both local and CI gates.
- The canonical release script passes its Bash syntax/mode/order/cleanup test,
  and an interrupted live smoke leaves no sidecar process or temp directory.
- The advisory classifier has zero high/critical production findings and no
  unmatched, stale, expired, or unused exception entry.
- The worktree contains no unintended generated artifacts.

---

## Task 20: Publish only under separate authorization

**Purpose:** keep irreversible registry/release actions out of ordinary
implementation while making the exact final sequence explicit.

**Prerequisite:** the user explicitly authorizes publication after Task 19 and
the npm session is current.

### Steps

- [ ] Preflight npm identity and organization access before preparing the
  release-source commit:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm whoami
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm access list packages "@actuarial-ts"
  ```

- [ ] Convert `CHANGELOG.md` `Unreleased` diagnostics notes into a dated
  `0.6.0` section on the actual release date. Commit that final metadata on a
  clean tree, record its immutable commit SHA as the release-source commit,
  push it, and require all Task 19 workflows to pass on that exact SHA. Commit
  subject: `chore: finalize v0.6.0 release`.
- [ ] Re-run the version, build, typecheck, test, docs, conformance, tarball, and
  scratch-install gates on the exact release-source commit. Do not publish from
  later uncommitted or docs-only state.
- [ ] Immediately after those exact-SHA gates and immediately before the first
  publish, rerun the same `npm whoami` and scoped organization-access commands.
  If the web-auth/session expired, stop, reauthenticate, and prove both checks
  again without changing the release-source commit; an earlier preflight is
  never accepted as current authorization.
- [ ] Publish in dependency order, waiting for registry visibility after each:

  1. `@actuarial-ts/core`
  2. `@actuarial-ts/interchange`
  3. `@actuarial-ts/data`
  4. `@actuarial-ts/compliance`
  5. `@actuarial-ts/agents`

- [ ] After each publish, query npm for version, dist-tags, integrity, and
  dependency ranges. Stop on any mismatch; do not continue a partially broken
  chain blindly.
- [ ] Install all five exact packages from the registry in a second clean
  project and run the same public fixture:

  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" npm run smoke:packed -- --source=registry --version=0.6.0
  ```
- [ ] Create the immutable `v0.6.0` tag explicitly on the recorded
  release-source commit, push it, then create the GitHub release from that tag
  and its final changelog. Fetch both package-README formula/migration HTTPS
  URLs after the tag is visible and require successful exact paths. Never move
  or recreate an existing tag.
- [ ] Append the verified `0.6.0` record to `docs/publishing.md` only after the
  registry smoke and immutable-tag link checks succeed. Include the recorded
  release-source SHA, registry integrities, dist-tags, dependency ranges, tag,
  link checks, and verification time. Change the design banner to “SHIPPED IN
  0.6.0” with the actual date/tag, change the plan banner to “COMPLETED THROUGH
  TASK 20” with the same date/tag, and update `docs/README.md` to describe both
  as shipped records rather than an unpublished candidate. Update the checked
  documentation inventory/snippet classifications for that lifecycle change:
  reclassify this completed implementation plan from `active` to
  `historical-snapshot`, preserve the shipped design as the active current
  contract, and remove or reclassify every plan-owned fence entry in
  `public-snippet-manifest.json` according to the manifest's historical-fence
  policy. The checker must reject stale active-plan entries, orphaned snippet
  entries, and any new blanket historical exception. Run
  `git diff --check` and the full base/Python/R documentation checks against
  this documentation-only status/record mutation, then commit and push it as
  `docs: record verified 0.6.0 publication`. The immutable release tag remains
  on the earlier recorded release-source commit.

### Task 20 acceptance

- The registry exposes all five `0.6.0` packages with compatible ranges.
- A clean registry consumer passes the same public API smoke.
- The tag and GitHub release point to the release-source commit; the later
  publishing record names that exact SHA and the verified registry versions.
- The version-pinned formula and migration links rendered from every npm README
  resolve through the immutable release tag.
- The design, plan, docs index, and publishing record agree on shipped status,
  version, date, tag, and release-source SHA, and pass the final docs gates.

---

## Risk register and stop conditions

| Risk | Required mitigation | Stop condition |
|---|---|---|
| Zero imputation hides absent data | Restrict it to a field missing on an otherwise valid expected loss row; retain stats/finding | Any absent exposure/source group becomes numeric zero |
| Exposure valuation means revision rather than economics | Long observations, per-measure timing, upstream revision selection | Engine guesses which revision to use |
| Origin-static exposure is repeated by a control projection | Reject transitive origin-static leaves under `all-cells`; test latest/valuation alternatives | One stable exposure key is summed once per valuation |
| Filter/cutoff hides submitted evidence | Pre-exclusion input audit is part of preparation/run identity and artifact resolution | Excluded or invalid-only data stamps like an empty run |
| Amount basis overstates source knowledge | Required `unknown` variants and explicit source description | Code infers basis from field names |
| A claim layer is applied over already limited data | Require exactly one unlimited included source component and validate external interval mechanics | SDK labels a stacked cap as a ground-up layer |
| Formula and presentation identity blur | Three separately tested identity scopes | Label/scale changes raw calculation identity |
| Human review rendering destabilizes identity | Hash complete findings/evaluations/summary, exclude description/details, verify the semantic body | Detail cap or wording changes a run tag |
| FNV described as security | Exact non-cryptographic wording everywhere | Any doc claims signing/tamper evidence |
| Callback breaks portability | Closed JSON rule/period unions | Function appears in portable definition/provenance |
| Wire change rewrites history | New complete `1.1` schema directory and frozen `1.0` checksum | Any `schema/interchange/1.0` byte changes |
| Python/R scope becomes a second SDK | Replay only aggregate-cell formulas/rules and identities | Shore starts duplicating exposure/view engine |
| Agent mutates actuarial assumptions | Trusted compiled catalog; model selects exact stamped instance IDs, an approved run preset, and only a view enum | Model schema accepts calculation filters/formula/basis/rule/timing or slices a cached superset |
| Run is relabeled after execution | Bind `runPresetId` in validated input/outcome; compliance derives it | Stamping accepts a replacement preset ID |
| Branded run/review is forged or mutated | Owner-controlled runtime assertions, recursive freeze, regenerated review and core result | Compliance trusts a structural lookalike or self-consistent forged receipt |
| Stored provenance is reused as if runtime-verified | Separate plain/verified types plus private owner assertion and evidence-backed reverification | Bundle authoring accepts a cast or deserialized lookalike |
| Programmatic data has no artifact anchor | Bind dataset artifact before execution; require SDK-computed fallback for every unsourced nonempty run | Nonempty provenance verifies with unsourced data and no dataset artifact |
| Review forks core arithmetic | Core owns the one prepared-data rule evaluator; data only projects reports/gates | Data copies expression, summation, tolerance, period, or layer math |
| Source transformation chain is incomplete | Typed acyclic artifact lineage and reachability/orphan checks | A derivative cannot be traced to its source/transforms |
| Real-world fixture becomes unverifiable or heavy | Pinned source checksum, reproducible compact derivative, offline CI | Full million-row artifact enters package/test path |
| Refactor moves reserving math | Keep diagnostics isolated and published-value suite unchanged | Any published anchor changes without new primary evidence |
| Documentation drifts | Generated formula reference, stale-symbol scan, compiled examples | Active README names removed API |

If any stop condition occurs, pause that task, fix the owning abstraction, and
rerun its focused tests before proceeding. Do not paper over a design failure
with a compatibility alias, cast, skipped test, or documentation caveat.

## Final definition of done

The work is done when an actuary can inspect one portable definition and see,
without reading application code:

- what every measure means, its development semantics, count population or
  amount/exposure basis, and how missing values aggregate;
- which amount basis and exposure timing each calculation uses;
- the reusable formula and the concrete role bindings;
- the exact raw numerator, denominator, value, and presented value;
- which declarative rules passed, triggered, or could not be evaluated;
- the explicit mixed-cadence period convention and approved run preset;
- deterministic definition/run/result identities tying data, filters,
  grouping, review policy, results, and boundary-bound preset together;
- exact input digests and acyclic preparation lineage tracing every committed
  derivative back through its source/transformation artifacts;
- the same definition parsed and replayed consistently in TypeScript, Python,
  and R; and
- a human-gated agent boundary that can request only already-reviewed metrics.

At the same time, every existing reserving validation remains unchanged, the
real-world example demonstrates the model against traceable source data, and a
clean npm consumer sees the same behavior as the monorepo tests.
