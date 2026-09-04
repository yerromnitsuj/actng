# Documentation verification

`npm run docs:check` checks the active Markdown inventory, exact fence hashes,
links, generated formula reference, syntax, and public examples. Its tests also
verify that a changed API argument, a changed declared input shape, an added
runtime exception, and an unregistered executable fence are rejected.

The classifications in `public-snippet-manifest.json` distinguish evidence:

| Classification                | What is checked                                                                                                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packed-executable`           | The actual Markdown AST fence source is strictly typechecked and executed with output assertions.                                                                                                                                            |
| `packed-mixed-contract`       | Declaration nodes receive the contract checks below; the actual executable nodes also run.                                                                                                                                                   |
| `packed-declaration-contract` | Actual declarations compile with their public dependencies. Exported non-generic interfaces, aliases, and function signatures are checked in both assignability directions against packed types. Types are not claimed as runtime execution. |
| `executed-python`             | Actual source runs under the provisioned Python interop environment in `docs:check:py`.                                                                                                                                                      |
| `syntax-only-operational`     | Shell syntax is checked, but install, deployment, publication, and configuration operations never run.                                                                                                                                       |
| `parsed-configuration`        | JSON, JSONC, and YAML use their real parsers, without executing configuration.                                                                                                                                                               |
| `reviewed-illustrative`       | Output, diagrams, and prose are explicitly non-executable.                                                                                                                                                                                   |

`packed-snippets.mts` creates a temporary consumer outside the repository,
packs all five SDK packages, and installs those tarballs plus lock-pinned
external dependencies. SDK imports must resolve to physical installations in
that consumer, never workspace source or symlinks. The enclosing release gate
builds the packages first. The consumer is removed after checking.

Fragments that refer to host-owned data use explicit imports from
`fixtures/public-snippet-setup.mts`. That setup is itself copied into the
consumer, typechecked, and executed against the packed APIs; it supplies data,
metadata, and an approved tenant-bound callback, not substituted example code.
Every runnable fence has its own registered setup and output assertions. Adding
a TypeScript or JavaScript fence without a reviewed recipe fails verification.

The active diagnostics specification is one connected declaration contract;
forward references are resolved across its actual declaration nodes. Named
public dependencies and the Mastra/Zod type dependencies come from installed
packages. Structural comparisons remove private symbol brands (which cannot
be independently recreated) and allow caller-owned mutable arrays as inputs to
readonly public arrays. No operational or model-visible examples receive a
blanket syntax-only exception.

After intentional documentation edits, regenerate inventory and fence hashes
with `npm run docs:manifests`, then run the checks. Regenerating the manifest
does not bypass typechecks, runtime checks, or the mutation tests.
