# Source and transformation record

## Dataset

- **Dataset:** `freclaimset2motor`, part of CASdatasets
- **Authors:** Christophe Dutang, Arthur Charpentier, and Ewen Gallic
- **Original experience:** damage guarantee of an unnamed French motor insurer
- **Period:** occurrence and management years 1995–2014
- **Documentation:** <https://dutangc.github.io/CASdatasets/reference/freclaimset.html>
- **Research archive / citation:** <https://doi.org/10.57745/P0KHAG>
- **Pinned source:** <https://raw.githubusercontent.com/dutangc/CASdatasets/e51f30edc0b8dbfe096cad2d0967d42ce3707f63/data/freclaimset2motor.rda>
- **Pinned source SHA-256:** `4409adb022d18e24a3a0e724523706616e707c53e55f8625ce9fc122a20185d6`
- **Pinned source byte length:** `9,482,793`
- **Source archive publication/update date used for attribution:** 2024-07-09

The machine-readable source of truth for these values is
[`source-manifest.json`](./source-manifest.json); both the downloader and the
analysis validate and consume it.

The research archive describes the collection as insurance data from real
insurers or mutual companies. The individual insurer is anonymous, so the
real-world provenance is author-attested rather than independently
carrier-verifiable.

## Interpretations and conventions

These choices are explicit because they are not all facts supplied verbatim by
the source:

1. `OccurYear` is treated as the origin year. The source documentation's
   aggregate-data section calls `Year` a management year, while its own
   consistency example aligns `ClaimNb` to `OccurYear`; aggregate exposure,
   GWP, and claim counts are therefore treated as origin-year measures.
2. `PaidAmount` is gross cumulative paid.
3. `ExpectCharge` is treated as gross cumulative incurred. The source calls it
   “expected amount,” so this is an interpretation, not a renamed source fact.
4. Net cumulative paid is `PaidAmount - RecourseAmount`; net cumulative
   incurred is `ExpectCharge - ExpectRecourse`.
5. `Exposure` is insurance-year exposure. `GWP` remains gross written premium
   and is never relabeled as earned premium.
6. The source has annual precision only. The generic SDK adapter derives
   calendar-year-end dates and discloses that convention.
7. Same-claim, same-management-year rows are combined for dollar triangles by
   summing their values. Source `ClaimNb`, not distinct IDs, remains the
   authoritative first-development frequency measure.
8. Missing annual snapshots are carried forward as the latest known cumulative
   state. This matches the SDK's claim-timeline triangle convention.
9. `ClaimStatus` values `on-going`, `partially closed`, and `reopened` are
   treated as open; `fully closed` and `closed without further action` are
   treated as closed, and the transform rejects any unknown status. At each
   management year, an identifier is open if any combined source row has an
   open status. Reported, open, closed with pay, and closed without pay are then
   computed from the carried-forward identifier state. This is an adapted
   population because source identifiers collide; it is not represented as an
   undisputed distinct-claim count.

No row is silently dropped because paid decreases, inferred case is negative,
or a claim reopens. Those facts remain visible in `data/quality-summary.csv`
and in the triangle review.

## Reproduction

From this example directory:

```bash
npm run data:refresh
```

The fetch step refuses to write an unverified source file. The transformation
requires base R only and regenerates the compact committed CSVs plus an ignored
`generated/freclaimset2motor-annual.csv` containing all source rows and both
gross and net measures.

`data/diagnostic-snapshots.csv` is the 210-cell upper triangle used by the
generalized diagnostic example. Each row contains origin year, valuation year,
the four adapted claim-state counts, and cumulative gross/net paid/incurred.
The transform asserts the claim states reconcile and every numeric diagnostic
value is finite before writing the derivative.
