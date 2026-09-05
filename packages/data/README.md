# @actuarial-ts/data

Typed ingestion, preparation, and data-review boundaries for the actuarial-ts SDK. It supports loss-run/exposure CSVs, annual claim-development adaptation, triangle assembly, and generalized diagnostic review designed to support ASOP No. 23 work.

```bash
npm install @actuarial-ts/data@0.7.1 @actuarial-ts/core@0.7.1
```

Node 20+, ESM. Responsibility for the review and resulting actuarial work remains with the actuary.

## Existing ingestion and triangle review

`parseLossRunCsv`, `parseExposureCsv`, `adaptAnnualClaimDevelopment`, `triangleFromLongFormat`, `reviewClaimData`, and `reviewTriangles` return structured errors/findings rather than silently cleaning source records. Physical source-line numbers are retained where available.

## Diagnostic run boundary

The example below uses the retained eager path: `validateDiagnosticRunInput` before `runValidatedMetricDiagnostics`. Validation parses the entire configuration atomically and compiles its definition; no partially validated run escapes. The compact path below uses the same input model and execution policies with a distinct evidence representation.

```ts
import { runValidatedMetricDiagnostics, validateDiagnosticRunInput } from "@actuarial-ts/data";

const validated = validateDiagnosticRunInput({
  definition,
  losses: [{
    rowType: "aggregate",
    recordId: "loss-1",
    sourceGroup: "fleet-a",
    origin: "2025",
    valuation: "2025Q1",
    complete: true,
    source: { artifactId: "loss-run", sourceRow: 2 },
    measures: { reported: 4, "gross-paid": 100, "gross-incurred": 160 },
  }],
  exposures: [{
    key: "exp-2025",
    sourceGroup: "fleet-a",
    origin: "2025",
    measureId: "earned-vehicle-years",
    value: 20,
    complete: true,
    source: { artifactId: "exposures", sourceRow: 2 },
  }],
  filter: { sourceGroups: ["fleet-a"], instanceIds: ["casualty/count/reported-frequency"] },
  groupMap: { "fleet-a": "all-fleet" },
  groupDimensions: { "all-fleet": { region: "all" } },
  runPresetId: "annual-review-v1",
  datasetArtifactId: "loss-run",
});

const outcome = runValidatedMetricDiagnostics(validated);
if (outcome.status !== "completed") console.error(outcome.stage, outcome.review.report);
```

Loss rows use `sourceGroup`; output `group` exists only after explicit mapping. Exposure observations are long-form and measure-specific. `origin-static` exposures ignore valuation filters but honor source-group/origin selection; `valuation-specific` exposures require and honor a valuation. The pre-exclusion audit retains invalid, cutoff, filtered, and retained inputs. Omitted and explicitly empty expected-cell grids remain distinct.

Review happens before output-group filtering and calculation. The structural catalog checks identities, periods, measure/source contracts, completeness, exposure attachment, expected-cell coverage, grouping evidence, and cached-formula provenance in deterministic order. Full findings retain code, message, complete source unions, origin, valuation, derived development age, and unit. `not-evaluated` is not treated as pass.

Definitions add declarative `compare`, `reconcile`, `monotonic`, `layer-order`, and `control-total` review rules. `createCasualtyDiagnosticReviewRules` is an optional convenience factory, not a fixed taxonomy. Missing rule inputs follow each rule’s explicit `not-evaluated` or `finding` policy. Review and metric gates have separate allowed status/severity sets; permitting a fail requires a nonblank rationale reference.

Completed outcomes are owner-branded and include the exact prepared data, review receipt, run preset, dataset artifact, grouping, result, and two-gate receipt. Compliance provenance accepts only that completed object.

## Compact runs and paged review

Introduced in 0.7.0, `validateDiagnosticRunInputCompact` followed by
`runValidatedMetricDiagnosticsCompact` retains complete review evidence behind
authenticated owners. Check `outcome.status` before using a completed run: a
review-blocked result is `null`, while a metric-blocked outcome includes its
diagnostic result but still cannot authorize provenance. Neither blocked path
should be presented as a successfully reviewed analysis.

Compact receipts have summary checks with `findingCount`, an `evaluations`
store, and a `findings` store. They do not contain eager per-check finding arrays.
Use the store from the same receipt throughout paging:

| Need | Public API |
|---|---|
| Finding summaries without expanded source lists | `pageDiagnosticReviewFindings(receipt.findings, query)` from data |
| Sources for one finding's stable index | `pageDiagnosticReviewFindingSources(receipt.findings, index, query)` from data |
| Passed, triggered, and not-evaluated evaluation summaries | `pageDiagnosticReviewEvaluations(receipt.evaluations, query)` from core |
| Sources for one evaluation | `pageDiagnosticReviewEvaluationSources` from core |

Finding-source queries distinguish `context` and review `scope` sources. Page
results disclose totals and continuation offsets; a summary's source count is
not the source list. `getDiagnosticReviewFinding` and
`iterateDiagnosticReviewFindings` provide full individual findings when needed,
but can expand their source arrays. Do not collect every full finding merely to
paginate it afterward.

`getCompletedCompactDiagnosticRunInput` exposes the retained immutable input
owner for a genuine completed run. Keeping that run alive also keeps its replay
inputs alive; release obsolete runs when the host no longer needs them. Parsed
JSON, spreads, and casts cannot recreate these owners. Use
`createCompactDiagnosticRunIdentity` in compliance for compact completed runs;
the eager provenance function is not interchangeable.

See the runnable [compact adoption guide](https://github.com/yerromnitsuj/actng/blob/v0.7.1/docs/migrations/0.7-compact-diagnostics.md)
and [replay/resource-policy reference](https://github.com/yerromnitsuj/actng/blob/v0.7.1/docs/reference/diagnostic-replay-stream.md).
Compact representation preserves evidence; it is not a claim that an arbitrary
large dataset or host memory budget has passed acceptance.

See the [formula catalog](https://github.com/yerromnitsuj/actng/blob/v0.7.1/docs/reference/diagnostic-formulas.md) and [migration guide](https://github.com/yerromnitsuj/actng/blob/v0.7.1/docs/migrations/0.6-generalized-diagnostics.md).

## License

Apache-2.0. See LICENSE and NOTICE.
