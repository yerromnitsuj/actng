# @actuarial-ts/data

Data ingestion and ASOP No. 23 data-quality review for the
[actuarial-ts](../core) SDK. Pure functions, zero runtime dependencies
(besides `@actuarial-ts/core`), fully typed.

- `parseCsv(text)` — minimal RFC 4180-subset CSV parser (quoted fields,
  escaped quotes, embedded commas/newlines, BOM, CRLF/LF); the result's
  `rowLines` gives each row's 1-based physical start line in the file.
- `parseLossRunCsv(text)` — loss-run import to `ClaimSnapshot[]` with
  per-row validation errors (errors cite 1-based physical file lines,
  header = line 1).
- `triangleFromLongFormat(rows, { kind })` — pivots long-format
  `(origin, age, value)` rows into a `Triangle`.
- `reviewClaimData(claims, { asOfDate? })` / `reviewTriangles(paid, incurred)`
  — the ASOP No. 23-oriented review; every check performed is listed in the
  report, pass or fail, so the actuary's disclosure can state what WAS
  reviewed, not just what was found.

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

These utilities are designed to support the actuary's compliance with
ASOP No. 23; responsibility for compliance remains with the credentialed
actuary.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
