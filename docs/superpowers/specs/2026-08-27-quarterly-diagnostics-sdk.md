# Quarterly diagnostics SDK design

## Gap analysis

| Requested capability | Existing API/module that overlaps it | Decision | Reason and compatibility implications |
|---|---|---|---|
| Named additive measures and ratio-of-sums evaluation | `safeRatio`, `severityTriangle`, `runFrequencySeverity`, triangle algebra | Add new API in `core` | Existing APIs operate on fixed triangle pairs. `MeasureExpression`, mergeable component aggregates, and `evaluateMetric` generalize the lower-level operation while reusing `safeRatio`; published methods are not rerouted. |
| Caller-defined metric metadata and warnings | Existing method result types and string warning arrays | Add new API in `core` | Diagnostic evaluations need raw numerator/denominator, unit, scale, basis, version, and structured warnings. The additive result type leaves existing result/warning contracts unchanged. |
| Null, explicit-zero, sparse-zero, and invalid-denominator semantics | Core null convention and `safeRatio` | Reuse and extend additively | Default missingness remains null, explicit zero remains observed, sparse-zero is opt-in, and invalid denominators return null plus codes. No existing numeric behavior changes. |
| Arbitrary grouping keys and dimensions | `Triangle.origins`; application-side filtering | Add new API in `core` | Stable string group IDs plus generic caller metadata and `groupMap` support grouping/combination without geography vocabulary or presentation state. |
| Exposure counted once by key | `ExposureRecord` has amounts but no stable identity | Add new API in `core`; validate/review in `data` | Exposure identity changes the numeric denominator, so pure key deduplication is enforced beside aggregation. Data owns unknown-input validation and duplicate/incomplete review. Equal values on distinct keys remain distinct. |
| Pre-capped amount bases | Existing additive triangle amounts | Reuse unchanged through configuration | A pre-capped source measure is consumed as additive data and never re-capped. This does not compete with `capClaims`. |
| Claim-level indemnity cap plus unlimited expense | `capClaims` caps total `ClaimSnapshot` paid/incurred | Add a narrow claim-row layer expression | `capClaims` cannot separate indemnity and expense. The new expression is explicitly claim-row-only, uses named split components, and never caps an aggregate; existing capping behavior is untouched. |
| Optional 22-metric casualty preset | Fixed `runDiagnostics` grids | Add configurable factory and default preset in `core` | `createCasualtyQuarterlyMetrics` expresses all formulas over generic definitions while allowing source/exposure keys, scales, units, labels, bases, and versions to vary. `runDiagnostics` remains unchanged. The two additional count-share definitions use the same `reported - CNP` denominator expression as the existing non-CNP frequency and severity definitions. |
| Nullable diagnostic triangle | `Triangle`, `triangleFromLongFormat` | Add diagnostic-specific triangle result | `TriangleKind` is a deliberately closed reserving contract. A metric triangle carries audit cells without weakening or duplicating reserving triangle semantics. |
| Emergence series and exact reconciliation | Existing triangle values only | Add new API in `core` | Emergence is the canonical aggregated record; triangle and maturity views project the same `MetricEvaluation` objects, preventing recomputation drift. |
| Same maturity, ragged latest diagonal, and selected-group common maturity | `lastObservedIndex` helpers and triangle shape conventions | Add small pure view helpers | The helpers are diagnostic projections and do not perform reserving selections or create chart/view models. |
| Origin/valuation/policy/maturity filtering and group combination | Consumers currently pre-filter inputs | Extend additively in `core` | Serializable ranges/maps support repeatable actuarial grains; arbitrary UI filter state, mappings, and interactions remain application-owned. |
| Quarterly parse/format/order/development age | Private quarterly helpers in `triangle`; separate origin parsing in on-level | Add public general quarter primitives in `core` | Public helpers avoid lexical ordering, expose age-3 versus elapsed-age conventions, reject reversed periods, and leave existing triangle construction behavior intact. |
| Policy/fiscal year mapping and complete origin/valuation cutoffs | No reusable public API | Add public adapters in `core` | Q3-Q2 is supported only as configuration/test; Q1 remains default and caller mappers remain possible. Partial-period inclusion is explicit. |
| Reusable aggregate data review | `DataReviewReport`, `reviewClaimData`, `reviewTriangles` | Extend additively in `data` | `reviewDiagnosticData` uses the existing report/status vocabulary and lists pass/fail/not-evaluated checks. Existing check outputs and severity conventions remain compatible. |
| Structured finding context | Existing `DataCheck.details: string[]` and core `DiagnosticFinding` | Extend `DataCheck` with optional `findings`; add a core warning adapter | Optional origin/valuation/age/group/file/row context avoids prose parsing without changing existing required fields or old report serialization. `diagnosticWarningToFinding` maps metric warnings into the existing core vocabulary; ASOP-oriented review statuses remain deliberately separate. |
| Cached-formula provenance | No workbook abstraction; CSV import only | Add lightweight caller-supplied metadata check | Formula text/cached-value metadata can be reviewed without ExcelJS or another XLSX dependency. Workbook extraction stays application-owned. |
| Unknown-input runtime validation | Zod-backed data boundaries | Add Zod schemas in `data` | `validateDiagnosticDataset` and its runner wrapper preserve a zero-dependency core and follow current boundary conventions. |
| Diagnostic run provenance | Compliance bundle, ledger, disclosure, canonical payload | Add composition helper in `compliance` | `createDiagnosticsProvenance` snapshots serializable formula/metric/layer/exposure/convention metadata. Core numeric results carry no app filters or persistence state; hashes/timestamps/signatures remain caller-owned. |
| Cross-language serialized diagnostics contract | Interchange `extensions`, custom measures, bundle parameters | Reuse unchanged | No current Python/R consumer requires a diagnostic document. Existing extensions carry provenance, avoiding a premature schema/version/conformance change. |
| Realistic inputs and golden evidence | Published-value fixtures; real French motor example | Extend tests/examples | A small documented quarterly casualty fixture covers two groups, ragged maturity, repeated exposure, and exact 22-metric results; the full French motor example remains the real-world ingestion/review fixture. |
| UI, charts, database, geography lists, packaging, advisor, cloud | None in SDK packages | Keep application-owned / decline | These concerns do not provide reusable deterministic actuarial math and would violate dependency and non-goal boundaries. |

## Boundaries

- `@actuarial-ts/core` owns pure formulas, layer evaluation, periods, aggregation,
  and view derivation. It performs no I/O and takes already-identified rows.
- `@actuarial-ts/data` validates unknown input and extends the existing ASOP
  No. 23-oriented review report with structured contexts.
- `@actuarial-ts/compliance` owns `createDiagnosticsProvenance`; its record
  belongs in `createBundle(...).parameters` and material judgments belong in
  the assumption ledger. Core results do not carry this metadata.
- `@actuarial-ts/interchange` needs no schema change: diagnostic artifacts can
  travel in documented `extensions` until a genuine cross-language contract is
  established.
- Existing reserving triangles and `runDiagnostics` remain source-compatible.

## Semantic invariants

1. Components are summed first and divided once. Averages of row ratios are
   never a substitute.
2. Missing is not zero. An aggregate component is null when any contributing
   value is missing unless the caller explicitly selects sparse-zero policy.
3. Missing, non-finite, zero, or negative denominators produce a null metric
   and a structured warning. Negative numerators are allowed.
4. A unique exposure key contributes once, even if repeated on valuation rows.
   Equal amounts on different keys remain distinct contributions.
5. Claim caps apply to each claim row before amounts are summed. An already
   pre-capped additive measure is never re-capped, and an aggregate is never
   capped after summation.
6. All diagnostic views are projections of the same aggregated emergence
   records. Their raw components, numerators, denominators, values, and warnings
   must reconcile exactly.
7. Quarterly ordering is numeric. The default quarter-end observation age is
   three months; age zero appears only under an explicit elapsed-age convention
   or as caller-supplied genuine data.

## Verification evidence map

| Required evidence | Authoritative source/test |
|---|---|
| All 22 formulas, both amount bases, raw audit fields | `packages/core/test/metricDiagnostics.test.ts` hand-calculated 22-value golden and documented quarterly fixture golden |
| Single/multi-group ratio-of-sums; average-of-ratios counterexample | Generic aggregation tests plus `groupMap` selected-group test |
| Missing/zero/sparse/non-finite/negative denominator and overflow behavior | Metric null/denominator/overflow tests; deterministic generated finite-output invariant |
| Negative case numerator and caller warning rule | Negative-case evaluation test with `NEGATIVE_CASE_REVIEW` callback |
| Paid-over-incurred and incomplete-exposure warnings | Focused metric warning, mixed complete/incomplete exposure, and missing source-group exposure tests |
| Exposure once by stable key; equal values on distinct keys | Core reconciliation tests and data validated-reconciliation test |
| Group/origin range/valuation cutoff/policy/maturity filters | Combined filter test in `metricDiagnostics.test.ts` |
| Empty selection, row-order invariance, staged associativity | Empty-view, reverse-order, and mergeable aggregate tests |
| Triangle/emergence/same-maturity exact equality, ragged diagonal, nulls, duplicate cells, no synthetic age zero | Cross-view block in `metricDiagnostics.test.ts` |
| Quarter formats, Q4/Q1 and multi-year ages, reversed periods, Q3/Q2 across years, independent complete cutoffs | `packages/core/test/periods.test.ts` |
| Positive/negative coverage for every review code; coexistence; contexts; severities/tolerances | `packages/data/test/diagnosticReview.test.ts` |
| Unknown input validation and exposure normalization | `packages/data/test/diagnosticInput.test.ts` |
| Custom components, layers, metrics, group dimensions, standard pack | `packages/core/test/customizationTypes.test.ts` plus configurable factory tests |
| Realistic small quarterly fixture with documented expectations | `packages/core/test/fixtures/quarterlyCasualty.{ts,md}` |
| Deterministic generated cases and non-quadratic guard | Generated ratio-of-sums loop and timed 10,000-row test |
| Provenance in existing bundle/ledger/extensions without core metadata | `packages/compliance/test/diagnosticsBundle.test.ts` |
| Existing published numeric and API compatibility | Complete monorepo tests, typecheck/build, public package imports, and npm dry-run pack |
