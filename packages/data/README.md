# @actuarial-ts/data

Data ingestion and ASOP No. 23 data-quality review for the
[actuarial-ts](../core) SDK. Pure functions, fully typed, with runtime schemas
at object boundaries.

- `parseCsv(text)` — minimal RFC 4180-subset CSV parser (quoted fields,
  escaped quotes, embedded commas/newlines, BOM, CRLF/LF); the result's
  `rowLines` gives each row's 1-based physical start line in the file.
- `parseLossRunCsv(text)` — loss-run import to `ClaimSnapshot[]` with
  per-row validation errors (errors cite 1-based physical file lines,
  header = line 1).
- `annualDevelopmentToClaimSnapshots(rows, options)` — converts claim
  valuations known only to annual precision without hiding the derived-date,
  report-year, or duplicate-row conventions.
- `parseExposureCsv(text)` — imports earned premium and/or exposure units by
  origin; extra source measures remain extra rather than being relabeled.
- `triangleFromLongFormat(rows, { kind })` — pivots long-format
  `(origin, age, value)` rows into a `Triangle`.
- `reviewClaimData(claims, { asOfDate? })` / `reviewTriangles(paid, incurred)`
  — the ASOP No. 23-oriented review; every check performed is listed in the
  report, pass or fail, so the actuary's disclosure can state what WAS
  reviewed, not just what was found.
- `validateDiagnosticDataset(value)` /
  `validateAndReconcileDiagnosticExposures(value)` /
  `runValidatedMetricDiagnostics(...)` — Zod-validated boundaries plus
  stable-key exposure reconciliation for generic diagnostic rows.
- `reviewDiagnosticData(snapshots, exposures, options)` — quarterly aggregate,
  exposure, layer, grouping, and cached-formula checks using the same
  `DataReviewReport` status contract, with optional structured finding context.

## Checks

### `reviewClaimData`

| id | status when found | what it finds |
|----|-------------------|---------------|
| `negative-paid` | fail | cumulative paid < 0 |
| `negative-case` | warning | case reserve < 0 (legitimate but rare) |
| `paid-decreasing` | fail | cumulative paid decreasing across a claim's snapshots ordered by evaluation date |
| `date-order` | fail | report before accident, or evaluation before report |
| `duplicate-snapshot` | fail | same claimId + evaluationDate twice |
| `future-dated` | fail | any claim date after `asOfDate` (not evaluated when `asOfDate` is omitted) |
| `closed-with-case` | warning | closed claim still carrying case reserve |

### `reviewTriangles`

| id | status when found | what it finds |
|----|-------------------|---------------|
| `shape-mismatch` | fail | origins/ages differ between paid and incurred (blocks cell-level checks, which stay listed as "not evaluated") |
| `paid-exceeds-incurred` | fail | paid > incurred in a cell (1e-9 relative tolerance) |
| `negative-incremental-paid` | warning | cumulative paid decreasing along a row (salvage/subrogation makes this legal but reportable) |
| `negative-incremental-incurred` | warning | cumulative incurred decreasing along a row |
| `interior-missing` | warning | a null cell with observed cells both before and after it in the same row |

## Quickstart

```ts
import { buildTriangles } from "@actuarial-ts/core";
import { parseLossRunCsv, reviewClaimData, reviewTriangles } from "@actuarial-ts/data";

const { claims, errors } = parseLossRunCsv(csvText);
if (errors.length > 0) console.warn(errors); // caller decides: abort or proceed

const claimReview = reviewClaimData(claims, { asOfDate: "2023-12-31" });

const { paid, incurred } = buildTriangles(claims, {
  cadence: "annual",
  asOfDate: "2023-12-31",
});
const triangleReview = reviewTriangles(paid, incurred);
```

### Annual-precision claim data

Do not label a source year as an exact accident or evaluation date. Normalize
the source fields to annual rows, then let the adapter derive calendar-year-end
compatibility dates and return the convention as a disclosure finding:

```ts
import { annualDevelopmentToClaimSnapshots } from "@actuarial-ts/data";

const conversion = annualDevelopmentToClaimSnapshots(
  [{
    claimId: "1995-000001",
    originYear: 1995,
    evaluationYear: 1996,
    paidToDate: 100,
    incurredToDate: 140,
    status: "open",
  }],
  { duplicatePolicy: "reject" },
);

console.log(conversion.conventions.derivedDateConvention); // calendar-year-end
console.log(conversion.findings); // date and inferred-report-year disclosures
```

The default duplicate policy is `reject`. Selecting `combine` is an explicit
judgment: same-claim/same-year paid and incurred values are summed, and the
combined record is open if any component is open. The adapter reports how many
groups and rows were combined.

### Exposure data

`parseExposureCsv` requires `origin` plus `earned_premium`, `exposure_units`,
or both. Each numeric measure may be blank independently. For example, a
source containing insurance-years and gross written premium should expose only
the insurance-years to the SDK unless an earned-premium transformation has
actually been performed:

```csv
origin,exposure_units,gross_written_premium
2024,125000,42000000
```

The extra GWP column is retained in the source file but ignored by the parser;
it is never silently loaded as `earnedPremium`.

### Quarterly diagnostic review

`reviewDiagnosticData` lists all 19 stable codes in
`DIAGNOSTIC_REVIEW_CHECK_CODES`. The suite covers duplicate aggregate and
exposure keys; invalid or mismatched development ages; valuation-before-origin;
count identities; paid/incurred and cumulative movement checks; reopen
signals; layer ordering and control totals; both sides of the loss/exposure
join; zero/incomplete exposure; grouping consistency; and lightweight cached
formula provenance.

The existing `DataCheck.details: string[]` field is unchanged. New checks also
populate `DataCheck.findings` with optional `origin`, `valuation`, `ageMonths`,
`group`, `sourceFile`, and `sourceRow` context so consumers need not parse
prose. Severities and numeric tolerances are caller-configurable. Optional
checks without configuration report `not-evaluated`, never a misleading pass.

For unknown objects, call `validateDiagnosticDataset` (or the convenience
`runValidatedMetricDiagnostics`) before the core analysis. For workbook input,
extract rows with the host's spreadsheet tooling and pass cached formula
metadata to the review; this package deliberately does not add a heavyweight
XLSX dependency.

These utilities are designed to support the actuary's compliance with
ASOP No. 23; responsibility for compliance remains with the credentialed
actuary.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
