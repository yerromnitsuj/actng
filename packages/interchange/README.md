# @actuarial-ts/interchange

Typed TypeScript implementation of actuarial-interchange: portable, integrity-stamped documents shared by actuarial-ts, chainladder-python, and R ChainLadder.

```bash
npm install @actuarial-ts/interchange@0.7.1 @actuarial-ts/core@0.7.1
```

Node 20+, ESM. SDK 0.7 continues to write interchange wire `1.1.0` and read compatible major-version-1 documents. SDK package versions and interchange wire versions are independent.

## Document kinds

`triangle`, `selection`, `method-result`, `stochastic-result`, `study`, `bundle`, `crosscheck-report`, and `diagnostic-definition` share an envelope with writer version, generator, caller-supplied timestamp, semantic-body FNV-1a/JCS integrity tag, and optional governance/extensions.

```ts
import {
  diagnosticDefinitionToDoc,
  docToDiagnosticDefinition,
  parseDocument,
} from "@actuarial-ts/interchange";

const document = diagnosticDefinitionToDoc(compiledDefinition, {
  createdAt: "2026-09-03T00:00:00Z",
});
const generic = parseDocument(document);
const executable = docToDiagnosticDefinition(document);
```

Generic parsing validates known fields, preserves same-major unknown envelope and nested fields, verifies integrity, and recursively verifies documents embedded in studies/bundles. Executable diagnostic conversion is intentionally stricter: it requires the current normalized vocabulary, recompiles the complete definition, and verifies formula, calculation, and definition identities. A future field can therefore survive a storage hop without being silently executed.

Bundles may carry typed diagnostic definition documents under `interchange.diagnosticDefinitions`; each nested document has its own tag and is also covered by the outer `{ bundle, interchange }` tag. JSON Schemas live in `schema/interchange/1.1`; the frozen `1.0` directory remains unchanged.

## Interoperability

The three shores share RFC 8785 vectors, frozen reserving fixtures, and generalized casualty definitions with six formulas and 22 bound instances. Python and R independently recompute definition identities and replay every formula and all five review-rule kinds across the calendar and ordered-axis aggregate-cell corpus, including missingness, tolerance boundaries, and overflow. The replay contract does not claim to reproduce arbitrary raw-data ingestion or selection in those languages.

The compact `diagnostic-replay/1` stream introduced in SDK 0.7.0 belongs to
`@actuarial-ts/compliance`. It is not an interchange document kind, cannot be
passed to `parseDocument`, and is not the three-shore aggregate-cell replay
contract described above. Use compliance's dedicated stream reader with its
required resource policy. A stream's engine-version identities also require
retaining the producing SDK versions; same interchange or stream wire versions
do not promise cross-SDK-version verification. See the [compact adoption guide](https://github.com/yerromnitsuj/actng/blob/v0.7.1/docs/migrations/0.7-compact-diagnostics.md)
and [replay reference](https://github.com/yerromnitsuj/actng/blob/v0.7.1/docs/reference/diagnostic-replay-stream.md).

`crosscheck` compares two method-result documents under explicit convention profiles. Outcomes are `agree`, `disagree`, `not-comparable`, or `verified-by-value`; the referee never hides convention differences or treats mutual agreement as proof of correctness.

Integrity tags detect accidental drift and support deterministic linking. FNV-1a is unkeyed and is not tamper resistance, authentication, or a security boundary.

The normative format is [actuarial-interchange rev 2.4](https://github.com/yerromnitsuj/actng/blob/v0.7.1/docs/spec/actuarial-interchange.md). See the generated [diagnostic formula catalog](https://github.com/yerromnitsuj/actng/blob/v0.7.1/docs/reference/diagnostic-formulas.md) and [0.6 migration guide](https://github.com/yerromnitsuj/actng/blob/v0.7.1/docs/migrations/0.6-generalized-diagnostics.md).

## License

Apache-2.0. See LICENSE and NOTICE.
