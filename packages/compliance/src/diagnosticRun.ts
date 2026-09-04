import {
  CORE_PACKAGE_VERSION,
  canonicalJson,
  compileDiagnosticDefinition,
  fnv1a64,
  getMetricDiagnosticsResultIdentity,
  getPreparedDiagnosticDataIdentity,
  runMetricDiagnostics,
  verifyPreparedDiagnosticDataIntegrity,
  type DiagnosticDeepReadonly,
  type CompiledDiagnosticDefinition,
  type DiagnosticDefinition,
  type JsonValue as CoreDiagnosticJsonValue,
  type NormalizedDiagnosticDefinitionIdentity,
  type NormalizedDiagnosticPreparationIdentity,
  type NormalizedDiagnosticResultIdentity,
} from "@actuarial-ts/core";
import {
  DATA_PACKAGE_VERSION,
  assertCompletedValidatedMetricDiagnosticsRun,
  reviewPreparedDiagnosticData,
  type CompletedValidatedMetricDiagnosticsRun,
  type DiagnosticReviewIdentityBody,
  type DiagnosticReviewReceipt,
} from "@actuarial-ts/data";
import { ComplianceError } from "./errors.js";
import { COMPLIANCE_PACKAGE_VERSION } from "./version.js";

export interface DiagnosticArtifactDigestBase {
  readonly id: string;
  readonly value: string;
  readonly scope: "input" | "preparation";
}
export type DiagnosticArtifactDigest = DiagnosticArtifactDigestBase &
  (
    | {
        readonly assurance: "sdk-computed";
        readonly algorithm: "sha256";
        readonly byteLength: number;
      }
    | { readonly assurance: "caller-declared"; readonly algorithm: string }
  );
export type DiagnosticArtifactEvidence =
  | {
      readonly id: string;
      readonly assurance: "sdk-computed";
      readonly bytes: Uint8Array;
    }
  | {
      readonly id: string;
      readonly assurance: "caller-declared";
      readonly algorithm: string;
      readonly value: string;
    };
export interface DiagnosticPreparationLineage {
  readonly outputArtifactId: string;
  readonly inputArtifactIds: readonly string[];
  readonly transformationArtifactIds: readonly string[];
}

export interface DiagnosticRunManifest {
  readonly definitionIntegrity: string;
  readonly runPresetId: string | null;
  readonly datasetArtifactId: string | null;
  readonly preparationFingerprint: string;
  readonly inputArtifacts: readonly DiagnosticArtifactDigest[];
  readonly preparationArtifacts: readonly DiagnosticArtifactDigest[];
  readonly preparationLineage: readonly DiagnosticPreparationLineage[];
  readonly inputAudit: DiagnosticDeepReadonly<
    NormalizedDiagnosticPreparationIdentity["inputAudit"]
  >;
  readonly filter: DiagnosticDeepReadonly<
    NormalizedDiagnosticPreparationIdentity["filter"]
  >;
  readonly groupMap: Readonly<Record<string, string>>;
  readonly groupDimensions: Readonly<Record<string, CoreDiagnosticJsonValue>>;
  readonly completePeriodCutoffs: DiagnosticDeepReadonly<
    NormalizedDiagnosticPreparationIdentity["completePeriodCutoffs"]
  >;
  readonly expectedCellGridFingerprint: string | null;
  readonly executionPolicy: {
    readonly review: DiagnosticReviewReceipt;
    readonly gate: CompletedValidatedMetricDiagnosticsRun["gate"];
  };
  readonly engine: {
    readonly packages: {
      readonly core: string;
      readonly data: string;
      readonly compliance: string;
    };
    readonly algorithmVersion: "diagnostics-1";
  };
}
export type NormalizedDiagnosticRunManifestIdentity =
  DiagnosticDeepReadonly<DiagnosticRunManifest>;

export interface DiagnosticRunIdentity {
  readonly runFingerprint: string;
  readonly resultFingerprint: string;
  readonly runResultFingerprint: string;
}
export interface DiagnosticRunProvenance extends DiagnosticRunIdentity {
  readonly definition: {
    readonly definition: DiagnosticDeepReadonly<NormalizedDiagnosticDefinitionIdentity>;
    readonly identities: {
      readonly algorithm: "fnv1a64-jcs-v1";
      readonly formulaById: Readonly<Record<string, string>>;
      readonly calculationByInstanceId: Readonly<Record<string, string>>;
      readonly definition: string;
    };
  };
  readonly manifest: NormalizedDiagnosticRunManifestIdentity;
  readonly review: DiagnosticReviewReceipt;
  readonly result: DiagnosticDeepReadonly<NormalizedDiagnosticResultIdentity>;
}
declare const verifiedDiagnosticRunProvenanceBrand: unique symbol;
export interface VerifiedDiagnosticRunProvenance
  extends DiagnosticRunProvenance {
  readonly [verifiedDiagnosticRunProvenanceBrand]: true;
}
export interface CreateDiagnosticRunIdentityInput {
  readonly completedRun: CompletedValidatedMetricDiagnosticsRun;
  readonly inputArtifacts: readonly DiagnosticArtifactEvidence[];
  readonly preparationArtifacts: readonly DiagnosticArtifactEvidence[];
  readonly preparationLineage: readonly DiagnosticPreparationLineage[];
}

const verified = new WeakMap<object, CompletedValidatedMetricDiagnosticsRun>();
const token = (value: string, path: string) => {
  if (
    value.length === 0 ||
    /^[\t-\r ]|[\t-\r ]$/.test(value) ||
    value.includes("\0")
  )
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      `${path} must be a nonempty token`,
      path,
    );
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          `${path} contains malformed Unicode`,
          path,
        );
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff)
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        `${path} contains malformed Unicode`,
        path,
      );
  }
};
function freeze<T>(
  value: T,
  seen = new WeakSet<object>(),
): DiagnosticDeepReadonly<T> {
  if (value === null || typeof value !== "object" || seen.has(value))
    return value as DiagnosticDeepReadonly<T>;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>))
    freeze(child, seen);
  return Object.freeze(value) as DiagnosticDeepReadonly<T>;
}
function tag(kind: string, key: string, value: unknown): string {
  return `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({ identityVersion: 1, kind, [key]: value }))}`;
}
type SnapshottedArtifact =
  | DiagnosticArtifactDigest
  | {
      readonly id: string;
      readonly scope: "input" | "preparation";
      readonly assurance: "sdk-computed";
      readonly bytes: Uint8Array;
    };
function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        `Unknown field ${key}`,
        `${path}.${key}`,
      );
}
function snapshotArtifacts(
  evidence: unknown,
  scope: "input" | "preparation",
  path: string,
): readonly SnapshottedArtifact[] {
  if (!Array.isArray(evidence))
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      `${path} must be an array`,
      path,
    );
  const seen = new Set<string>();
  const result: SnapshottedArtifact[] = [];
  for (const [index, item] of evidence.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!plain(item))
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "Artifact evidence must be a plain object",
        itemPath,
      );
    if (typeof item.id !== "string")
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "Artifact id must be a string",
        `${itemPath}.id`,
      );
    token(item.id, `${itemPath}.id`);
    if (seen.has(item.id))
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        `Duplicate artifact ID ${item.id}`,
        `${itemPath}.id`,
      );
    seen.add(item.id);
    if (item.assurance === "sdk-computed") {
      exactKeys(item, ["id", "assurance", "bytes"], itemPath);
      if (!(item.bytes instanceof Uint8Array))
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          "SDK-computed artifact evidence requires actual Uint8Array bytes",
          `${itemPath}.bytes`,
        );
      const bytes = new Uint8Array(item.bytes.byteLength);
      bytes.set(item.bytes);
      result.push({ id: item.id, scope, assurance: item.assurance, bytes });
    } else if (item.assurance === "caller-declared") {
      exactKeys(item, ["id", "assurance", "algorithm", "value"], itemPath);
      if (typeof item.algorithm !== "string")
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          "Artifact algorithm must be a string",
          `${itemPath}.algorithm`,
        );
      if (typeof item.value !== "string")
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          "Artifact value must be a string",
          `${itemPath}.value`,
        );
      token(item.algorithm, `${itemPath}.algorithm`);
      token(item.value, `${itemPath}.value`);
      result.push({
        id: item.id,
        scope,
        assurance: item.assurance,
        algorithm: item.algorithm,
        value: item.value,
      });
    } else
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "Unknown artifact assurance",
        `${itemPath}.assurance`,
      );
  }
  return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
async function digestArtifacts(
  snapshot: readonly SnapshottedArtifact[],
): Promise<readonly DiagnosticArtifactDigest[]> {
  if (
    snapshot.some((item) => "bytes" in item) &&
    globalThis.crypto?.subtle === undefined
  )
    throw new ComplianceError(
      "CRYPTO_UNAVAILABLE",
      "Web Crypto SHA-256 is unavailable",
      "$.artifacts",
    );
  return Promise.all(
    snapshot.map(async (item) => {
      if (!("bytes" in item)) return item;
      const hash = await globalThis.crypto.subtle.digest("SHA-256", item.bytes);
      return {
        id: item.id,
        scope: item.scope,
        assurance: item.assurance,
        algorithm: "sha256" as const,
        value: [...new Uint8Array(hash)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
        byteLength: item.bytes.byteLength,
      };
    }),
  );
}

function snapshotLineage(
  lineage: unknown,
): readonly DiagnosticPreparationLineage[] {
  if (!Array.isArray(lineage))
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      "$.preparationLineage must be an array",
      "$.preparationLineage",
    );
  return lineage
    .map((raw, index) => {
      const path = `$.preparationLineage[${index}]`;
      if (!plain(raw))
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          "Lineage edge must be a plain object",
          path,
        );
      exactKeys(
        raw,
        ["outputArtifactId", "inputArtifactIds", "transformationArtifactIds"],
        path,
      );
      if (typeof raw.outputArtifactId !== "string")
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          "Lineage output must be a string",
          `${path}.outputArtifactId`,
        );
      token(raw.outputArtifactId, `${path}.outputArtifactId`);
      const readIds = (value: unknown, key: string) => {
        if (!Array.isArray(value))
          throw new ComplianceError(
            "BAD_DIAGNOSTIC_RUN",
            `Lineage ${key} must be an array`,
            `${path}.${key}`,
          );
        const result = value.map((id, inputIndex) => {
          if (typeof id !== "string")
            throw new ComplianceError(
              "BAD_DIAGNOSTIC_RUN",
              "Lineage artifact id must be a string",
              `${path}.${key}[${inputIndex}]`,
            );
          token(id, `${path}.${key}[${inputIndex}]`);
          return id;
        });
        if (new Set(result).size !== result.length)
          throw new ComplianceError(
            "BAD_DIAGNOSTIC_RUN",
            `Lineage ${key} must be unique`,
            `${path}.${key}`,
          );
        return [...result].sort();
      };
      const inputs = readIds(raw.inputArtifactIds, "inputArtifactIds"),
        transformations = readIds(
          raw.transformationArtifactIds,
          "transformationArtifactIds",
        );
      if (inputs.length + transformations.length === 0)
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          "Lineage edge must have at least one upstream artifact",
          path,
        );
      return {
        outputArtifactId: raw.outputArtifactId,
        inputArtifactIds: inputs,
        transformationArtifactIds: transformations,
      };
    })
    .sort((a, b) =>
      a.outputArtifactId < b.outputArtifactId
        ? -1
        : a.outputArtifactId > b.outputArtifactId
          ? 1
          : 0,
    );
}

function validateArtifactGraph(
  run: CompletedValidatedMetricDiagnosticsRun,
  inputArtifacts: readonly DiagnosticArtifactDigest[],
  preparationArtifacts: readonly DiagnosticArtifactDigest[],
  lineage: readonly DiagnosticPreparationLineage[],
): void {
  const byId = new Map<string, DiagnosticArtifactDigest>();
  for (const [index, item] of [
    ...inputArtifacts,
    ...preparationArtifacts,
  ].entries()) {
    if (byId.has(item.id))
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        `Duplicate artifact ID ${item.id}`,
        `$.${index < inputArtifacts.length ? "inputArtifacts" : "preparationArtifacts"}[${index < inputArtifacts.length ? index : index - inputArtifacts.length}].id`,
      );
    byId.set(item.id, item);
  }
  const referenced = new Set<string>();
  const requireArtifact = (
    id: string,
    scope: "input" | "preparation",
    path: string,
  ) => {
    const artifact = byId.get(id);
    if (!artifact)
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        `Artifact reference ${id} is unresolved`,
        path,
      );
    if (artifact.scope !== scope)
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        `Artifact ${id} must have ${scope} scope`,
        path,
      );
    referenced.add(id);
  };
  let unsourced = false;
  for (const [index, item] of run.prepared.inputAudit.entries()) {
    const source = item.record.source;
    if (source)
      requireArtifact(
        source.artifactId,
        "input",
        `$.completedRun.prepared.inputAudit[${index}].record.source.artifactId`,
      );
    else unsourced = true;
  }
  const evidence = run.review.evidence;
  if (evidence) {
    for (const [index, item] of evidence.groupingAssignments.entries()) {
      if (item.source)
        requireArtifact(
          item.source.artifactId,
          "input",
          `$.completedRun.review.evidence.groupingAssignments[${index}].source.artifactId`,
        );
      else unsourced = true;
    }
    for (const [index, item] of evidence.cachedFormulas.entries()) {
      if (item.source)
        requireArtifact(
          item.source.artifactId,
          "input",
          `$.completedRun.review.evidence.cachedFormulas[${index}].source.artifactId`,
        );
      else unsourced = true;
    }
  }
  if (unsourced) {
    if (run.datasetArtifactId === null)
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "Unsourced diagnostic input requires datasetArtifactId",
        "$.completedRun.datasetArtifactId",
      );
    const fallback = byId.get(run.datasetArtifactId);
    if (
      !fallback ||
      fallback.scope !== "input" ||
      fallback.assurance !== "sdk-computed"
    )
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "datasetArtifactId must resolve to SDK-computed input evidence",
        "$.completedRun.datasetArtifactId",
      );
    referenced.add(run.datasetArtifactId);
  } else if (run.datasetArtifactId !== null)
    requireArtifact(
      run.datasetArtifactId,
      "input",
      "$.completedRun.datasetArtifactId",
    );
  for (const [
    basisIndex,
    basis,
  ] of run.prepared.definition.definition.amountBases.entries())
    for (const [componentIndex, component] of basis.components.entries())
      if (
        component.limitation.kind !== "unlimited" &&
        component.limitation.kind !== "unknown" &&
        component.limitation.derivation.kind === "external"
      )
        requireArtifact(
          component.limitation.derivation.transformationRef,
          "preparation",
          `$.definition.amountBases[${basisIndex}].components[${componentIndex}].limitation.derivation.transformationRef`,
        );
  for (const [
    ruleIndex,
    rule,
  ] of run.prepared.definition.definition.reviewRules.entries())
    if (
      rule.kind === "layer-order" &&
      rule.comparability.kind === "caller-asserted"
    )
      requireArtifact(
        rule.comparability.rationaleArtifactId,
        "preparation",
        `$.definition.reviewRules[${ruleIndex}].comparability.rationaleArtifactId`,
      );
  if (run.gate.rationaleRef !== null)
    requireArtifact(
      run.gate.rationaleRef,
      "preparation",
      "$.completedRun.gate.rationaleRef",
    );
  const edges = new Map<string, readonly string[]>();
  for (const [index, edge] of lineage.entries()) {
    const path = `$.preparationLineage[${index}]`;
    if (edges.has(edge.outputArtifactId))
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "An artifact may have only one producing lineage edge",
        `${path}.outputArtifactId`,
      );
    const downstream = byId.get(edge.outputArtifactId);
    if (!downstream)
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        `Lineage artifact ${edge.outputArtifactId} is unresolved`,
        `${path}.outputArtifactId`,
      );
    if (downstream.scope !== "input")
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "Lineage output artifact must have input scope",
        `${path}.outputArtifactId`,
      );
    for (const [inputIndex, id] of edge.inputArtifactIds.entries()) {
      if (id === edge.outputArtifactId)
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          "Lineage may not reference itself",
          `${path}.inputArtifactIds[${inputIndex}]`,
        );
      const artifact = byId.get(id);
      if (!artifact || artifact.scope !== "input")
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          `Lineage input ${id} must resolve to input evidence`,
          `${path}.inputArtifactIds[${inputIndex}]`,
        );
    }
    for (const [
      transformIndex,
      id,
    ] of edge.transformationArtifactIds.entries()) {
      const artifact = byId.get(id);
      if (!artifact || artifact.scope !== "preparation")
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          `Lineage transformation ${id} must resolve to preparation evidence`,
          `${path}.transformationArtifactIds[${transformIndex}]`,
        );
    }
    edges.set(edge.outputArtifactId, [
      ...edge.inputArtifactIds,
      ...edge.transformationArtifactIds,
    ]);
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const walk = (id: string, path: string) => {
    if (visiting.has(id))
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "Artifact lineage contains a cycle",
        path,
      );
    if (visited.has(id)) return;
    visiting.add(id);
    for (const upstream of edges.get(id) ?? []) {
      referenced.add(upstream);
      walk(upstream, path);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...referenced]) walk(id, "$.preparationLineage");
  for (const [index, artifact] of inputArtifacts.entries())
    if (!referenced.has(artifact.id))
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        `Artifact ${artifact.id} is orphaned`,
        `$.inputArtifacts[${index}].id`,
      );
  for (const [index, artifact] of preparationArtifacts.entries())
    if (!referenced.has(artifact.id))
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        `Artifact ${artifact.id} is orphaned`,
        `$.preparationArtifacts[${index}].id`,
      );
}

function rerunAndVerify(run: CompletedValidatedMetricDiagnosticsRun): {
  review: DiagnosticReviewReceipt;
  result: DiagnosticDeepReadonly<NormalizedDiagnosticResultIdentity>;
} {
  assertCompletedValidatedMetricDiagnosticsRun(run);
  verifyPreparedDiagnosticDataIntegrity(run.prepared);
  const review = reviewPreparedDiagnosticData({
    prepared: run.prepared,
    evidence: run.review.evidence,
  });
  if (
    review.reportFingerprint !== run.review.reportFingerprint ||
    canonicalJson(review.identityBody) !==
      canonicalJson(run.review.identityBody)
  )
    throw new ComplianceError(
      "DIAGNOSTIC_MISMATCH",
      "Stored diagnostic review does not match a regenerated review",
      "$.review",
    );
  const rerun = runMetricDiagnostics({
    prepared: run.prepared,
    groupMap: run.groupMap,
    groupDimensions: run.groupDimensions,
  });
  if (
    canonicalJson(getMetricDiagnosticsResultIdentity(rerun)) !==
    canonicalJson(getMetricDiagnosticsResultIdentity(run.result))
  )
    throw new ComplianceError(
      "DIAGNOSTIC_MISMATCH",
      "Stored diagnostic result does not match deterministic replay",
      "$.result",
    );
  const reviewBlocked = review.report.checks.some(
    (check) => !run.gate.allowedReviewStatuses.includes(check.status),
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
  return { review, result: getMetricDiagnosticsResultIdentity(run.result) };
}

export async function createDiagnosticRunIdentity(
  input: CreateDiagnosticRunIdentityInput,
): Promise<VerifiedDiagnosticRunProvenance> {
  const run = input.completedRun;
  const authenticated = rerunAndVerify(run);
  const inputSnapshot = snapshotArtifacts(
    (input as unknown as Record<string, unknown>).inputArtifacts,
    "input",
    "$.inputArtifacts",
  );
  const preparationSnapshot = snapshotArtifacts(
    (input as unknown as Record<string, unknown>).preparationArtifacts,
    "preparation",
    "$.preparationArtifacts",
  );
  const lineage = snapshotLineage(
    (input as unknown as Record<string, unknown>).preparationLineage,
  );
  const [inputArtifacts, preparationArtifacts] = await Promise.all([
    digestArtifacts(inputSnapshot),
    digestArtifacts(preparationSnapshot),
  ]);
  validateArtifactGraph(run, inputArtifacts, preparationArtifacts, lineage);
  const preparation = getPreparedDiagnosticDataIdentity(run.prepared);
  const expectedGridFingerprint = preparation.expectedCellsProvided
    ? tag(
        "diagnostic-expected-grid",
        "expectedCells",
        preparation.expectedCells,
      )
    : null;
  const manifest = freeze({
    definitionIntegrity: run.prepared.definition.definitionIntegrity,
    preparationFingerprint: run.prepared.preparationFingerprint,
    runPresetId: run.runPresetId,
    datasetArtifactId: run.datasetArtifactId,
    inputArtifacts,
    preparationArtifacts,
    preparationLineage: lineage,
    inputAudit: preparation.inputAudit,
    filter: preparation.filter,
    groupMap: { ...run.groupMap },
    groupDimensions: { ...run.groupDimensions },
    completePeriodCutoffs: preparation.completePeriodCutoffs,
    expectedCellGridFingerprint: expectedGridFingerprint,
    executionPolicy: { review: authenticated.review, gate: run.gate },
    engine: {
      packages: {
        core: CORE_PACKAGE_VERSION,
        data: DATA_PACKAGE_VERSION,
        compliance: COMPLIANCE_PACKAGE_VERSION,
      },
      algorithmVersion: "diagnostics-1" as const,
    },
  });
  const runFingerprint = tag("diagnostic-run", "run", manifest);
  const resultFingerprint = tag(
    "diagnostic-result",
    "result",
    authenticated.result,
  );
  const runResultFingerprint = tag("diagnostic-run-result", "binding", {
    runFingerprint,
    resultFingerprint,
  });
  const definition = run.prepared.definition;
  const provenance = freeze({
    definition: {
      definition: definition.definition,
      identities: {
        algorithm: "fnv1a64-jcs-v1" as const,
        formulaById: { ...definition.formulaFingerprints },
        calculationByInstanceId: { ...definition.calculationFingerprints },
        definition: definition.definitionIntegrity,
      },
    },
    manifest,
    review: authenticated.review,
    result: run.result,
    runFingerprint,
    resultFingerprint,
    runResultFingerprint,
  }) as unknown as VerifiedDiagnosticRunProvenance;
  verified.set(provenance, run);
  return provenance;
}

export function assertVerifiedDiagnosticRunProvenance(
  value: unknown,
): asserts value is VerifiedDiagnosticRunProvenance {
  if (value === null || typeof value !== "object" || !verified.has(value))
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      "Value is not authentic verified diagnostic provenance",
      "$",
    );
}

/**
 * Verifies the self-contained semantic links in serialized provenance. This
 * intentionally does not confer the in-process authenticity brand: it is the
 * read-side check used by reproducibility bundles after JSON serialization.
 */
export function serializedDiagnosticRunMismatch(
  value: unknown,
  path = "$.diagnosticRuns[0]",
): string | null {
  if (!plain(value)) return path;
  const required = [
    "definition",
    "manifest",
    "review",
    "result",
    "runFingerprint",
    "resultFingerprint",
    "runResultFingerprint",
  ];
  for (const key of required)
    if (!Object.prototype.hasOwnProperty.call(value, key))
      return `${path}.${key}`;
  for (const key of Object.keys(value))
    if (!required.includes(key)) return `${path}.${key}`;
  const definitionWrapper = value.definition;
  if (!plain(definitionWrapper) || !plain(definitionWrapper.identities))
    return `${path}.definition`;
  let compiled: CompiledDiagnosticDefinition;
  try {
    compiled = compileDiagnosticDefinition(
      definitionWrapper.definition as DiagnosticDefinition,
    );
  } catch {
    return `${path}.definition.definition`;
  }
  const expectedIdentities = {
    algorithm: "fnv1a64-jcs-v1",
    formulaById: compiled.formulaFingerprints,
    calculationByInstanceId: compiled.calculationFingerprints,
    definition: compiled.definitionIntegrity,
  };
  if (
    canonicalJson(definitionWrapper.identities) !==
    canonicalJson(expectedIdentities)
  )
    return `${path}.definition.identities`;
  if (!plain(value.manifest) || !plain(value.review) || !plain(value.result))
    return path;
  const manifest = value.manifest;
  const review = value.review;
  const result = value.result;
  if (manifest.definitionIntegrity !== compiled.definitionIntegrity)
    return `${path}.manifest.definitionIntegrity`;
  if (review.definitionIntegrity !== compiled.definitionIntegrity)
    return `${path}.review.definitionIntegrity`;
  if (result.definitionIntegrity !== compiled.definitionIntegrity)
    return `${path}.result.definitionIntegrity`;
  if (review.preparationFingerprint !== manifest.preparationFingerprint)
    return `${path}.review.preparationFingerprint`;
  if (result.preparationFingerprint !== manifest.preparationFingerprint)
    return `${path}.result.preparationFingerprint`;
  if (!plain(review.identityBody)) return `${path}.review.identityBody`;
  const expectedReview = tag(
    "diagnostic-review",
    "review",
    review.identityBody,
  );
  if (review.reportFingerprint !== expectedReview)
    return `${path}.review.reportFingerprint`;
  if (
    !plain(manifest.executionPolicy) ||
    canonicalJson(manifest.executionPolicy.review) !== canonicalJson(review)
  )
    return `${path}.manifest.executionPolicy.review`;
  const expectedRun = tag("diagnostic-run", "run", manifest);
  const expectedResult = tag("diagnostic-result", "result", result);
  const expectedBinding = tag("diagnostic-run-result", "binding", {
    runFingerprint: expectedRun,
    resultFingerprint: expectedResult,
  });
  if (value.runFingerprint !== expectedRun) return `${path}.runFingerprint`;
  if (value.resultFingerprint !== expectedResult)
    return `${path}.resultFingerprint`;
  if (value.runResultFingerprint !== expectedBinding)
    return `${path}.runResultFingerprint`;
  const points = Array.isArray(result.emergence) ? result.emergence : [];
  for (const [pointIndex, point] of points.entries()) {
    if (!plain(point) || !plain(point.metrics))
      return `${path}.result.emergence[${pointIndex}]`;
    for (const [instanceId, metric] of Object.entries(point.metrics)) {
      if (!plain(metric))
        return `${path}.result.emergence[${pointIndex}].metrics.${instanceId}`;
      if (metric.definitionIntegrity !== compiled.definitionIntegrity)
        return `${path}.result.emergence[${pointIndex}].metrics.${instanceId}.definitionIntegrity`;
      if (
        metric.calculationFingerprint !==
        compiled.calculationFingerprints[instanceId]
      )
        return `${path}.result.emergence[${pointIndex}].metrics.${instanceId}.calculationFingerprint`;
      const instance = compiled.definition.instances.find(
        (item) => item.id === instanceId,
      );
      if (
        instance === undefined ||
        metric.formulaFingerprint !==
          compiled.formulaFingerprints[instance.formulaId]
      )
        return `${path}.result.emergence[${pointIndex}].metrics.${instanceId}.formulaFingerprint`;
    }
  }
  return null;
}

/** @internal Bundle authoring uses owner state rather than trusting the public snapshot. */
export function verifiedDefinitionForBundle(
  value: VerifiedDiagnosticRunProvenance,
): CompiledDiagnosticDefinition {
  assertVerifiedDiagnosticRunProvenance(value);
  return verified.get(value)!.prepared.definition;
}

export async function verifyDiagnosticRunIdentity(
  candidate: unknown,
  input: CreateDiagnosticRunIdentityInput,
): Promise<VerifiedDiagnosticRunProvenance> {
  const regenerated = await createDiagnosticRunIdentity(input);
  let left: string;
  try {
    left = canonicalJson(candidate);
  } catch {
    throw new ComplianceError(
      "DIAGNOSTIC_MISMATCH",
      "Stored diagnostic provenance is not canonical JSON",
      "$",
    );
  }
  if (left !== canonicalJson(regenerated))
    throw new ComplianceError(
      "DIAGNOSTIC_MISMATCH",
      "Stored diagnostic provenance differs from regenerated provenance",
      firstDifference(candidate, regenerated, "$") ?? "$",
    );
  return regenerated;
}

function firstDifference(
  left: unknown,
  right: unknown,
  path: string,
): string | null {
  if (plain(left) && plain(right)) {
    const keys = [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].sort();
    for (const key of keys) {
      if (
        !Object.prototype.hasOwnProperty.call(left, key) ||
        !Object.prototype.hasOwnProperty.call(right, key)
      )
        return `${path}.${key}`;
      const found = firstDifference(left[key], right[key], `${path}.${key}`);
      if (found) return found;
    }
    return null;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const shared = Math.min(left.length, right.length);
    for (let index = 0; index < shared; index++) {
      const found = firstDifference(
        left[index],
        right[index],
        `${path}[${index}]`,
      );
      if (found) return found;
    }
    return left.length === right.length ? null : `${path}[${shared}]`;
  }
  try {
    return canonicalJson(left) === canonicalJson(right) ? null : path;
  } catch {
    return path;
  }
}
