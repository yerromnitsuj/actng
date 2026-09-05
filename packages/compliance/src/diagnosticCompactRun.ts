import {
  CORE_PACKAGE_VERSION,
  canonicalFnv1a64,
  compareDiagnosticIdentityDocuments,
  createDiagnosticIdentityArray,
  createDiagnosticIdentityObject,
  createDiagnosticIdentityValue,
  fingerprintDiagnosticIdentity,
  getCompactMetricDiagnosticsResultIdentityDocument,
  getCompactPreparedDiagnosticDataFingerprint,
  normalizeDiagnosticsFilterIdentity,
  runMetricDiagnosticsCompact,
  type DiagnosticIdentityDocument,
} from "@actuarial-ts/core";
import {
  DATA_PACKAGE_VERSION,
  assertCompletedCompactMetricDiagnosticsRun,
  getCompactDiagnosticReviewReceiptFingerprint,
  getCompactDiagnosticReviewReceiptIdentityDocument,
  reviewPreparedDiagnosticDataCompact,
  type CompletedCompactMetricDiagnosticsRun,
} from "@actuarial-ts/data";
import {
  assertComputedDiagnosticArtifactDigest,
  type ComputedDiagnosticArtifactDigest,
} from "./diagnosticArtifactStream.js";
import type {
  DiagnosticArtifactDigest,
  DiagnosticPreparationLineage,
  DiagnosticRunIdentity,
  DiagnosticRunProvenance,
} from "./diagnosticRun.js";
import {
  plain,
  snapshotLineage,
  token,
  validateArtifactGraph,
} from "./diagnosticRunEvidence.js";
import { ComplianceError } from "./errors.js";
import { COMPLIANCE_PACKAGE_VERSION } from "./version.js";

/** Computed digests must be authentic completed byte-stream receipts, not JSON copies. */
export type CompactDiagnosticArtifactEvidence =
  | ComputedDiagnosticArtifactDigest
  | Extract<DiagnosticArtifactDigest, { assurance: "caller-declared" }>;

export interface CreateCompactDiagnosticRunIdentityInput {
  readonly completedRun: CompletedCompactMetricDiagnosticsRun;
  readonly inputArtifacts: readonly CompactDiagnosticArtifactEvidence[];
  readonly preparationArtifacts: readonly CompactDiagnosticArtifactEvidence[];
  readonly preparationLineage: readonly DiagnosticPreparationLineage[];
}

declare const verifiedCompactDiagnosticRunProvenanceBrand: unique symbol;
/**
 * Verified compact evidence, not a legacy provenance DTO or BundleDoc.
 * Documents emit the complete legacy normalized manifest/result identity bytes.
 * They retain immutable owners, not expanded identity arrays or source bytes.
 * The provenance brand, not a structural document, establishes verification.
 */
export interface VerifiedCompactDiagnosticRunProvenance
  extends DiagnosticRunIdentity {
  readonly [verifiedCompactDiagnosticRunProvenanceBrand]: true;
  readonly definition: DiagnosticRunProvenance["definition"];
  readonly inputArtifacts: readonly DiagnosticArtifactDigest[];
  readonly preparationArtifacts: readonly DiagnosticArtifactDigest[];
  readonly preparationLineage: readonly DiagnosticPreparationLineage[];
  readonly preparationFingerprint: string;
  readonly reviewFingerprint: string;
  readonly manifestIdentityDocument: DiagnosticIdentityDocument;
  readonly resultIdentityDocument: DiagnosticIdentityDocument;
}

const verified = new WeakMap<object, CompletedCompactMetricDiagnosticsRun>();

function bad(message: string, path: string): never {
  throw new ComplianceError("BAD_DIAGNOSTIC_RUN", message, path);
}

/** Snapshot boundary metadata without invoking getters or caller array methods. */
function record(
  value: unknown,
  allowed: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!plain(value)) bad("Expected a plain metadata object", path);
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key))
      bad("Unknown metadata field", `${path}.${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      bad(
        "Metadata fields must be enumerable data properties",
        `${path}.${key}`,
      );
    copy[key] = descriptor.value;
  }
  return copy;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    bad("Expected a plain metadata array", path);
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 0)
    bad("Invalid array length", path);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(key) ||
      Number(key) >= length
    )
      bad("Unexpected array property", `${path}.${String(key)}`);
  }
  const copy: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      bad("Array items must be present data properties", `${path}[${index}]`);
    copy.push(descriptor.value);
  }
  return copy;
}

function artifacts(
  value: unknown,
  scope: "input" | "preparation",
  path: string,
): readonly DiagnosticArtifactDigest[] {
  const seen = new Set<string>();
  const result = array(value, path).map(
    (raw, index): DiagnosticArtifactDigest => {
      const itemPath = `${path}[${index}]`;
      const item = record(
        raw,
        ["id", "scope", "assurance", "algorithm", "value", "byteLength"],
        itemPath,
      );
      if (typeof item.id !== "string")
        bad("Artifact id must be a string", `${itemPath}.id`);
      token(item.id, `${itemPath}.id`);
      if (seen.has(item.id))
        bad("Artifact IDs must be unique", `${itemPath}.id`);
      seen.add(item.id);
      if (item.scope !== scope)
        bad(`Artifact must have ${scope} scope`, `${itemPath}.scope`);
      if (item.assurance === "sdk-computed") {
        assertComputedDiagnosticArtifactDigest(raw);
        return raw;
      }
      if (item.assurance !== "caller-declared")
        bad("Unknown artifact assurance", `${itemPath}.assurance`);
      if (Object.hasOwn(item, "byteLength"))
        bad(
          "Caller-declared evidence cannot claim a computed byte length",
          `${itemPath}.byteLength`,
        );
      if (typeof item.algorithm !== "string" || typeof item.value !== "string")
        bad("Declared algorithm and value must be strings", itemPath);
      token(item.algorithm, `${itemPath}.algorithm`);
      token(item.value, `${itemPath}.value`);
      return Object.freeze({
        id: item.id,
        scope,
        assurance: "caller-declared",
        algorithm: item.algorithm,
        value: item.value,
      });
    },
  );
  return Object.freeze(
    result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

function lineage(value: unknown): readonly DiagnosticPreparationLineage[] {
  const copied = array(value, "$.preparationLineage").map((raw, index) => {
    const path = `$.preparationLineage[${index}]`;
    const item = record(
      raw,
      ["outputArtifactId", "inputArtifactIds", "transformationArtifactIds"],
      path,
    );
    return {
      outputArtifactId: item.outputArtifactId,
      inputArtifactIds: array(
        item.inputArtifactIds,
        `${path}.inputArtifactIds`,
      ),
      transformationArtifactIds: array(
        item.transformationArtifactIds,
        `${path}.transformationArtifactIds`,
      ),
    };
  });
  return Object.freeze(
    snapshotLineage(copied).map((edge) =>
      Object.freeze({
        outputArtifactId: edge.outputArtifactId,
        inputArtifactIds: Object.freeze([...edge.inputArtifactIds]),
        transformationArtifactIds: Object.freeze([
          ...edge.transformationArtifactIds,
        ]),
      }),
    ),
  );
}

function requireEqual(
  actual: DiagnosticIdentityDocument,
  expected: DiagnosticIdentityDocument,
  path: string,
): void {
  const comparison = compareDiagnosticIdentityDocuments(actual, expected);
  if (!comparison.equal)
    throw new ComplianceError(
      "DIAGNOSTIC_MISMATCH",
      `Deterministic replay differs at canonical code-unit offset ${comparison.codeUnitOffset}`,
      path,
    );
}

/** Replay before issuing authority; hashes never replace complete identity comparison. */
function rerunAndVerify(run: CompletedCompactMetricDiagnosticsRun): void {
  const review = reviewPreparedDiagnosticDataCompact({
    prepared: run.prepared,
    evidence: run.review.evidence,
  });
  requireEqual(
    getCompactDiagnosticReviewReceiptIdentityDocument(review),
    getCompactDiagnosticReviewReceiptIdentityDocument(run.review),
    "$.review",
  );
  const rerun = runMetricDiagnosticsCompact({
    prepared: run.prepared,
    groupMap: run.groupMap,
    groupDimensions: run.groupDimensions,
  });
  requireEqual(
    getCompactMetricDiagnosticsResultIdentityDocument(rerun),
    getCompactMetricDiagnosticsResultIdentityDocument(run.result),
    "$.result",
  );
  const counts = review.evaluations.summary;
  const effectiveCounts = {
    pass: counts.pass,
    warning: counts.warning,
    fail: counts.fail,
    "not-evaluated": counts.notEvaluated,
  };
  const statuses = ["pass", "warning", "fail", "not-evaluated"] as const;
  const reviewBlocked =
    review.report.checks.some(
      (check) => !run.gate.allowedReviewStatuses.includes(check.status),
    ) ||
    statuses.some(
      (status) =>
        effectiveCounts[status] > 0 &&
        !run.gate.allowedReviewStatuses.includes(status),
    );
  const metricBlocked = rerun.findings.some(
    (finding) =>
      finding.category !== "structural" &&
      !run.gate.allowedMetricFindingSeverities.includes(finding.severity),
  );
  if (
    reviewBlocked ||
    metricBlocked ||
    run.gate.reviewGate !== "passed" ||
    run.gate.metricGate !== "passed"
  )
    throw new ComplianceError(
      "DIAGNOSTIC_MISMATCH",
      "Diagnostic execution gates do not recompute as passed",
      "$.gate",
    );
}

function manifestDocument(
  run: CompletedCompactMetricDiagnosticsRun,
  inputArtifacts: readonly DiagnosticArtifactDigest[],
  preparationArtifacts: readonly DiagnosticArtifactDigest[],
  preparationLineage: readonly DiagnosticPreparationLineage[],
  preparationFingerprint: string,
  reviewFingerprint: string,
): DiagnosticIdentityDocument {
  const prepared = run.prepared;
  const expectedCells = createDiagnosticIdentityArray(
    prepared.expectedCells.length,
    (index) => {
      const cell = prepared.expectedCells[index]!;
      return createDiagnosticIdentityObject({
        sourceGroup: createDiagnosticIdentityValue(cell.sourceGroup),
        origin: createDiagnosticIdentityValue(cell.origin),
        valuation: createDiagnosticIdentityValue(cell.valuation),
        source: createDiagnosticIdentityValue(cell.source ?? null),
      });
    },
  );
  return createDiagnosticIdentityObject({
    definitionIntegrity: createDiagnosticIdentityValue(
      prepared.definition.definitionIntegrity,
    ),
    preparationFingerprint: createDiagnosticIdentityValue(
      preparationFingerprint,
    ),
    runPresetId: createDiagnosticIdentityValue(run.runPresetId),
    datasetArtifactId: createDiagnosticIdentityValue(run.datasetArtifactId),
    inputArtifacts: createDiagnosticIdentityValue(inputArtifacts),
    preparationArtifacts: createDiagnosticIdentityValue(preparationArtifacts),
    preparationLineage: createDiagnosticIdentityValue(preparationLineage),
    inputAudit: createDiagnosticIdentityValue(prepared.inputAudit),
    filter: createDiagnosticIdentityValue(
      normalizeDiagnosticsFilterIdentity(prepared.filter),
    ),
    groupMap: createDiagnosticIdentityValue(run.groupMap),
    groupDimensions: createDiagnosticIdentityValue(run.groupDimensions),
    completePeriodCutoffs: createDiagnosticIdentityValue(
      prepared.completePeriodCutoffs,
    ),
    expectedCellGridFingerprint: createDiagnosticIdentityValue(
      prepared.expectedCellsProvided
        ? fingerprintDiagnosticIdentity(expectedCells, {
            kind: "diagnostic-expected-cell-grid",
            property: "expectedCells",
          })
        : null,
    ),
    executionPolicy: createDiagnosticIdentityObject({
      gate: createDiagnosticIdentityValue(run.gate),
      review: createDiagnosticIdentityObject({
        body: getCompactDiagnosticReviewReceiptIdentityDocument(run.review),
        reportFingerprint: createDiagnosticIdentityValue(reviewFingerprint),
      }),
    }),
    engine: createDiagnosticIdentityValue(
      Object.freeze({
        packages: Object.freeze({
          core: CORE_PACKAGE_VERSION,
          data: DATA_PACKAGE_VERSION,
          compliance: COMPLIANCE_PACKAGE_VERSION,
        }),
        algorithmVersion: "diagnostics-1",
      }),
    ),
  });
}

/**
 * Verify an authentic compact completed run and bind completed artifact digests.
 * Synchronous: source bytes were consumed by digestDiagnosticArtifactChunks already.
 * This deliberately replays review/math and compares every identity code unit.
 */
export function createCompactDiagnosticRunIdentity(
  input: CreateCompactDiagnosticRunIdentityInput,
): VerifiedCompactDiagnosticRunProvenance {
  const snapshot = record(
    input,
    [
      "completedRun",
      "inputArtifacts",
      "preparationArtifacts",
      "preparationLineage",
    ],
    "$",
  );
  const run = snapshot.completedRun;
  try {
    assertCompletedCompactMetricDiagnosticsRun(run);
  } catch {
    bad(
      "completedRun must be an authentic completed compact diagnostic run",
      "$.completedRun",
    );
  }
  const inputArtifacts = artifacts(
    snapshot.inputArtifacts,
    "input",
    "$.inputArtifacts",
  );
  const preparationArtifacts = artifacts(
    snapshot.preparationArtifacts,
    "preparation",
    "$.preparationArtifacts",
  );
  const preparationLineage = lineage(snapshot.preparationLineage);
  validateArtifactGraph(
    run,
    inputArtifacts,
    preparationArtifacts,
    preparationLineage,
  );
  rerunAndVerify(run);
  const preparationFingerprint = getCompactPreparedDiagnosticDataFingerprint(
    run.prepared,
  );
  const reviewFingerprint = getCompactDiagnosticReviewReceiptFingerprint(
    run.review,
  );
  const manifestIdentityDocument = manifestDocument(
    run,
    inputArtifacts,
    preparationArtifacts,
    preparationLineage,
    preparationFingerprint,
    reviewFingerprint,
  );
  const resultIdentityDocument =
    getCompactMetricDiagnosticsResultIdentityDocument(run.result);
  const runFingerprint = fingerprintDiagnosticIdentity(
    manifestIdentityDocument,
    { kind: "diagnostic-run", property: "manifest" },
  );
  const resultFingerprint = fingerprintDiagnosticIdentity(
    resultIdentityDocument,
    { kind: "diagnostic-result", property: "result" },
  );
  const runResultFingerprint = `fnv1a64-jcs-v1:${canonicalFnv1a64({ identityVersion: 1, kind: "diagnostic-run-result", runFingerprint, resultFingerprint })}`;
  const definition = run.prepared.definition;
  const provenance = Object.freeze({
    definition: Object.freeze({
      definition: definition.definition,
      identities: Object.freeze({
        algorithm: "fnv1a64-jcs-v1" as const,
        formulaById: Object.freeze({ ...definition.formulaFingerprints }),
        calculationByInstanceId: Object.freeze({
          ...definition.calculationFingerprints,
        }),
        definition: definition.definitionIntegrity,
      }),
    }),
    inputArtifacts,
    preparationArtifacts,
    preparationLineage,
    preparationFingerprint,
    reviewFingerprint,
    manifestIdentityDocument,
    resultIdentityDocument,
    runFingerprint,
    resultFingerprint,
    runResultFingerprint,
  }) as VerifiedCompactDiagnosticRunProvenance;
  verified.set(provenance, run);
  return provenance;
}

export function assertVerifiedCompactDiagnosticRunProvenance(
  value: unknown,
): asserts value is VerifiedCompactDiagnosticRunProvenance {
  if (value === null || typeof value !== "object" || !verified.has(value))
    bad("Value is not authentic verified compact diagnostic provenance", "$");
}

/** Internal transport plumbing; deliberately not exported from the package index. */
export function getCompactDiagnosticRunOwner(
  provenance: VerifiedCompactDiagnosticRunProvenance,
): CompletedCompactMetricDiagnosticsRun {
  assertVerifiedCompactDiagnosticRunProvenance(provenance);
  return verified.get(provenance)!;
}
