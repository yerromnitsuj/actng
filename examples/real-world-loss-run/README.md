# Real-world loss development and exposures

This tested example uses the complete `freclaimset2motor` experience from
CASdatasets: 1,012,839 annual claim valuations from an unnamed French motor
insurer, paired with 20 origin years of insurance-year exposure, gross written
premium, and source claim counts.

It demonstrates the part of actuarial work that a clean textbook triangle
cannot:

- a documented gross-versus-net recovery selection;
- an explicit interpretation of a source field as incurred;
- annual date precision without pretending exact dates were supplied;
- duplicate identifiers, payment reversals, negative inferred case, gaps, and
  reopened claims retained as review findings;
- exposure-based Cape Cod using insurance-years without relabeling GWP as
  earned premium; and
- a generated draft disclosure carrying the data limitations and illustrative
  factor selections.

Run the offline example:

```bash
npm run example -w @actuarial-ts/example-real-world-loss-run
```

The ordinary example reads compact committed derivatives, so installs and CI
do not download or parse a million-row file. To reproduce them from the pinned
source and also create the ignored full annual CSV:

```bash
npm run data:refresh -w @actuarial-ts/example-real-world-loss-run
```

That command verifies the source SHA-256 before writing anything and requires
base R. See [SOURCE.md](./SOURCE.md) for every mapping and transformation
choice, and [DATA-NOTICE.md](./DATA-NOTICE.md) for the separate Etalab data
licence and attribution.

The all-year volume-weighted development factors and 1.0 tail are illustrative
selections. They are recorded as judgments; the example does not recommend
them for production work.
