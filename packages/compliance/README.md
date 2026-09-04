# @actuarial-ts/compliance

Documentation, judgment, provenance, and reproducibility primitives for actuarial-ts. The package is designed to support compliance work under applicable ASOPs; it neither determines compliance nor replaces the actuary’s review.

```bash
npm install @actuarial-ts/compliance@0.6.1 @actuarial-ts/core@0.6.1 @actuarial-ts/data@0.6.1 @actuarial-ts/interchange@0.6.1
```

Node 20+, ESM.

## Diagnostic provenance

`createDiagnosticRunIdentity` accepts only an owner-authenticated, completed data-package run. It does not accept caller-restated formulas, filters, review status, or result identities.

```ts
import { createBundle, createDiagnosticRunIdentity } from "@actuarial-ts/compliance";

if (outcome.status !== "completed") throw new Error(`diagnostics blocked at ${outcome.stage}`);

const provenance = await createDiagnosticRunIdentity({
  completedRun: outcome,
  inputArtifacts: [
    { id: "loss-run", assurance: "sdk-computed", bytes: lossRunBytes },
    { id: "exposures", assurance: "sdk-computed", bytes: exposureBytes },
    { id: "source-archive", assurance: "caller-declared", algorithm: "sha256", value: archiveSha256 },
  ],
  preparationArtifacts: [
    { id: "transform-script", assurance: "caller-declared", algorithm: "git-sha", value: transformCommit },
  ],
  preparationLineage: [
    { outputArtifactId: "loss-run", inputArtifactIds: ["source-archive"], transformationArtifactIds: ["transform-script"] },
  ],
});

const bundle = createBundle({
  inputs,
  parameters,
  results: outcome.result,
  sdkVersions: {
    "@actuarial-ts/core": provenance.manifest.engine.packages.core,
    "@actuarial-ts/data": provenance.manifest.engine.packages.data,
    "@actuarial-ts/compliance": provenance.manifest.engine.packages.compliance,
  },
  createdAt: "2026-09-03T00:00:00Z",
  diagnosticRuns: [provenance],
  wrap: { triangles: [], selections: [], results: [] },
});
```

SDK-computed evidence requires actual `Uint8Array` bytes and records SHA-256 plus exact byte length. Caller-declared digests remain explicitly unverified. All evidence is synchronously validated and copied before hashing. Source, dataset fallback, external transformation, layer-comparability rationale, and fail-override references must resolve to the correct artifact scope. Lineage must have unique producers, resolve completely, be acyclic, and contain no orphan evidence.

The manifest contains the complete normalized definition, preparation identity and input audit, filter, cutoffs, expected-grid identity, grouping, review identity, two-gate execution policy, artifact graph, and core/data/compliance versions. The provenance adds the authentic complete result and separate run, result-content, and run-result binding fingerprints. Creation verifies preparation integrity, regenerates review and both gates, reruns core, and compares normalized output before stamping.

The returned `VerifiedDiagnosticRunProvenance` is frozen and registered in private owner state. A cast, clone, or parsed JSON object cannot author a new bundle. Use `verifyDiagnosticRunIdentity(stored, sameRunAndEvidence)` to regenerate and authenticate stored provenance; it reports the first mismatching JSON path and returns regenerated authentic review text rather than trusting stored prose.

Wrapped bundles include one deduplicated typed `diagnostic-definition` document per definition and require the outer SDK versions/generator to agree with every run manifest. `verifyBundle` also recompiles serialized definitions and rechecks definition, review, result, run, and binding fingerprints plus the typed definition mirror; merely re-stamping inconsistent JSON cannot make it verify. FNV-1a/JCS tags are deterministic integrity aids, not cryptographic authentication.

Material host judgments worth recording in the assumption ledger include amount basis and limit application, expense treatment, missingness, exposure timing, period convention, filters/grouping, communicated scale, and any policy that permits a failed review. Helpers never invent an actuary’s rationale.

The package also provides estimate metadata, assumption ledgers, ASOP No. 41 draft disclosure generation, ASOP No. 56 model cards, actual-versus-expected roll-forward, and canonical reproducibility bundles.

See the [formula catalog](https://github.com/yerromnitsuj/actng/blob/v0.6.1/docs/reference/diagnostic-formulas.md) and [migration guide](https://github.com/yerromnitsuj/actng/blob/v0.6.1/docs/migrations/0.6-generalized-diagnostics.md).

## License

Apache-2.0. See LICENSE and NOTICE.
