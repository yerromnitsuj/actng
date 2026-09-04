# Source reconciliation contracts

`npm run validation:source` is the executable inventory of external source
anchors in `source-reconciliation.json`. Each entry binds a citation and
immutable fixture to executed expected values, comparison tolerances, required
lanes, and exact test cases with assertion counts.

The runner validates fixture and test-source SHA-256 values, checks registry
expectations against their original fixture exports, executes the registered
files, and requires a one-to-one match between the registered cases and passed
runtime cases. Missing, extra, duplicate, skipped, or todo tests fail. The
`registerSourceFile` hook also checks each case's exact assertion count, so a
shortened loop or deleted assertion cannot silently weaken the evidence.
The guard's mutation tests are part of the core workspace test suite.

Expected fixture exports remain in their original files as immutable source
transcriptions. Tests consume the registry's values through `sourceExpected`
and comparison policies through `sourceTolerance`; `expectedBindings` ties the
registry copies back to those transcriptions. Printed values and precise
implementation regressions are identified separately. In particular, the
mortgage total SE of 3,728,870.241257798 is a deterministic SDK regression, not
a figure printed in Mack (1993).

An intentional test or source change requires reviewing the relevant source,
updating the case inventory and assertion count, and updating only the hashes
of files that were intentionally changed. There is no gate option that records
new passing output or automatically blesses a changed golden. A changed
tolerance needs a documented precision or sampling rationale.

`npm run validation:reconciliation` additionally runs the frozen v0.5 quarterly
migration, source-data integrity checks, and casualty review fault matrix.
The real-world example independently reconstructs every one of the 73
valuation-pair finding coordinates and source arrays from the pinned CSV, and
injects a controlled error into each configured reconciliation. Monotonic
signals remain warnings by default; the blocking cases explicitly select fail
severity while retaining the default execution policy.

Offline validation needs only the seven committed CSV derivatives. Release
automation verifies the raw archive and rebuilds all eight derivatives into a
temporary directory. Every result must match its reviewed manifest hash; the
seven committed CSVs are also byte-compared directly. The large generated claim
history is intentionally ignored by Git and is verified against its manifest,
so a clean checkout does not need a pre-existing generated directory.
