# Compact diagnostic evidence and replay streams

Introduced in SDK 0.7.0 as additive APIs, not a dataset-capacity certification. Existing eager diagnostic and interchange BundleDoc APIs are unchanged. The stream's own wire version is `diagnostic-replay/1`; interchange remains at wire version `1.1.0`.

## Why this format exists

A large diagnostic run can have far more audit evaluations than input rows. The compact gateway retains every evaluation, finding, and source reference in private columns and dictionaries. Normal views request summaries and pages. Complete identity text is generated only when needed, without constructing an expanded audit object or one archive-sized JSON string.

The data gateway owns immutable input snapshots. `getCompletedCompactDiagnosticRunInput` returns that authenticated owner, not a reconstructed audit or a mutable upload object. Keeping a completed run now also keeps its original validated inputs available for replay; this is shared ownership, not another dataset copy.

`digestDiagnosticArtifactChunks` hashes received bytes incrementally. `createCompactDiagnosticRunIdentity` accepts genuine completed runs and genuine computed digest receipts (or explicitly caller-declared evidence), reruns review/math, checks gates, and compares full identities before issuing provenance. Its manifest/result documents emit the exact legacy **normalized identity** bytes. They are not the old provenance DTO.

## Host workflow

1. Validate with `validateDiagnosticRunInputCompact` and execute with `runValidatedMetricDiagnosticsCompact`. Handle blocked outcomes normally.
2. Hash the actual normalized/preparation artifact byte streams with `digestDiagnosticArtifactChunks`. Retain a repeatable host source for each computed artifact. Original-file hashes without retained bytes must remain caller-declared.
3. Create provenance with `createCompactDiagnosticRunIdentity`, supplying complete artifact references and preparation lineage.
4. Consume `writeDiagnosticReplayStream({ runs, openArtifact, signal })` into a temporary host file. Each run has a unique ID and authentic provenance. The callback reopens each unique computed artifact once. Publish/rename the file only after the generator completes successfully.
5. Independently verify with `verifyDiagnosticReplayStream(chunks, { limits, signal })`. The SDK reconstructs one run input at a time, performs full validation and execution, regenerates provenance, and compares every canonical evidence code unit. It returns only small artifact/run receipts after the trailer and EOF have been verified.

Artifacts shared across runs are written once. Conflicting metadata for a shared ID is rejected. Every artifact must be used; every run must resolve a complete, valid artifact graph. Bytes changed between initial hashing and export cause the writer to fail without a valid trailer.

All I/O belongs to the host; the SDK has no filesystem, network, framework, or Node-specific dependency. Browser-standard `Uint8Array`, `TextEncoder`, `TextDecoder`, `AbortSignal`, `atob`, and `btoa` are used. Supply the same signal to host I/O. Cancellation is cooperative between chunks/phases, not a way to interrupt synchronous actuarial calculation; a host needing CPU interruption should isolate that work in its worker/process.

## Required resource policy

The reader requires positive safe-integer limits: `maximumEncodedBytes`, `maximumArtifacts`, `maximumRuns`, `maximumArtifactBytes`, `maximumInputDepth`, `maximumInputNodes`, `maximumInputStringUnits`, and `maximumInputTotalStringUnits`. The last two respectively bound each string and cumulative key/value text within one reconstructed input/metadata block. Encoded bytes additionally bound the entire transport. These are host resource ceilings, not a claim that any chosen dataset size has passed performance testing.

Artifact producers deliver chunks of at most 64 KiB. Replay readers deliver at most 128 KiB per input chunk. Each encoded frame is at most 128 KiB. These limits govern transport granularity only: split host reads rather than lowering total dataset limits. The reader copies bounded received chunks before yielding, and rejects shared, detached, or resizable byte buffers.

## Version 1 wire contract

This is `diagnostic-replay/1`, not a `BundleDoc`, a single JSON document, or the old analysis JSON format. Each line is a UTF-8 JSON **flat array** terminated by LF, with at most 16 primitive atoms. Objects/nested arrays are not legal frame atoms. The first atom of every frame is its contiguous zero-based sequence number. The remaining atoms are events below; names and arities are exact.

| Event after sequence number | Meaning |
| --- | --- |
| `["diagnostic-replay", 1]` | Required first frame. Unknown versions are rejected. |
| `["artifact"]` | Begin an artifact's value-event metadata. All artifacts precede all runs. |
| `["artifact-data"]` | End metadata; begin computed bytes, or an empty declared-evidence section. |
| `["bytes", base64]` | Nonempty canonical-base64 chunk, decoded size at most 64 KiB. |
| `["artifact-end"]` | End bytes. Computed length and SHA-256 must match metadata. |
| `["run"]` | Begin value-event run input envelope. |
| `["input-end"]` | End envelope; revalidate and recalculate before comparing evidence. |
| `["manifest", text]`, `["result", text]` | Complete canonical identity text in nonempty fragments of at most 16,384 UTF-16 code units. Manifest must precede result. |
| `["manifest-end"]`, `["result-end"]` | Finish the respective full-content comparison. |
| `["run-end", runTag, resultTag, bindingTag]` | Tags must match the fully regenerated and compared run. |
| `["end", artifactCount, runCount, frameDigest]` | Required final trailer, followed by EOF. No early success or trailing frames. |

Artifact metadata has exactly `id`, `scope`, `assurance`, `algorithm`, `value`, and, for computed evidence only, `byteLength`. Scope is `input` or `preparation`. Computed algorithm is `sha256`, value is 64 lowercase hex characters, and length is a nonnegative safe integer. Declared evidence has no computed length.

Run envelopes have exactly `id`, `input`, `inputArtifactIds`, `preparationArtifactIds`, and `preparationLineage`. The input uses the full data-package schema; its definition may use the core compiler's normalized wire shape. Optional absent fields remain absent; actual zero, negative zero, null, and non-finite input observations remain distinguishable for validation/audit. Parsed values never carry runtime authority.

### Value events

Objects/arrays use `["object"]`, `["array"]`, `["end-object"]`, `["end-array"]`. Object keys must be strictly increasing in UTF-16 order and unique. Keys, including `__proto__`, are installed as own data properties on null-prototype objects. Sparse arrays, extra array fields, and accessors are refused by the writer.

Strings use `["string-start", "key" | "value"]`, zero or more `["text", fragment]`, and `["string-end"]`. Nonempty fragments are at most 16,384 code units; split surrogate pairs are reconstructed before SDK validation. Primitive finite numbers, booleans, and null use `["scalar", value]`. Special raw numbers use `["special-number", "NaN" | "+Infinity" | "-Infinity" | "-0"]` so invalid observations are not silently converted into valid nulls. The full SDK still decides whether each observation blocks or is auditable under the supplied policy.

Value decoding is used only for raw replay inputs and small metadata. Candidate manifest/result evidence is **never** parsed into an expanded object. It is compared directly to the regenerated owner-controlled text stream. Missing, extra, or changed evidence fails even if stored fingerprints are restamped.

### Integrity and assurance

`frameDigest` is SHA-256 over the concatenation of `JSON.stringify(numberedFrame) + "\n"` for every frame before the trailer. Thus it binds canonical decoded event content, not the original transport's whitespace or alternative equivalent JSON number spellings. The final counts are checked independently. Artifact digests hash actual artifact bytes, not this frame encoding.

Neither SHA-256 nor FNV tags are signatures, source authentication, or proof of actuarial correctness. A party who replaces a whole internally consistent archive can compute new tags. The verifier proves internal reproducibility of supplied inputs/evidence. It cannot independently prove that arbitrary original CSV/XLSX bytes were correctly transformed into normalized records, that declared aggregate caps were applied claim by claim, or that a caller's rationale is sound. These remain explicit host/actuary responsibilities. The SHA implementation is not a NIST/FIPS-certified module.

Receipts and provenance are frozen and privately authenticated. Casting, spreading, serializing, or parsing them does not reproduce authority. `assertVerifiedDiagnosticReplayStream` accepts only a receipt from a completely successful verification in the same SDK runtime.
