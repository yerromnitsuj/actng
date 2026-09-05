import {
  CORE_PACKAGE_VERSION,
  DiagnosticValidationError,
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
  type MetricDiagnosticsResult,
} from "@actuarial-ts/core";
import {
  DATA_PACKAGE_VERSION,
  assertCompletedValidatedMetricDiagnosticsRun,
  reviewPreparedDiagnosticData,
  runValidatedMetricDiagnostics,
  validateDiagnosticRunInput,
  type CompletedValidatedMetricDiagnosticsRun,
  type DiagnosticReviewIdentityBody,
  type DiagnosticReviewReceipt,
} from "@actuarial-ts/data";
import { ComplianceError } from "./errors.js";
import { COMPLIANCE_PACKAGE_VERSION } from "./version.js";
import {
  token,
  plain,
  exactKeys,
  snapshotLineage,
  validateArtifactGraph,
} from "./diagnosticRunEvidence.js";

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
      readonly scope: "input" | "preparation";
      readonly assurance: "sdk-computed";
      readonly bytes: Uint8Array;
    }
  | {
      readonly id: string;
      readonly scope: "input" | "preparation";
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
export type NormalizedDiagnosticRunManifestIdentity = DiagnosticDeepReadonly<
  Omit<DiagnosticRunManifest, "executionPolicy"> & {
    readonly executionPolicy: {
      readonly review: {
        readonly body: DiagnosticReviewIdentityBody;
        readonly reportFingerprint: string;
      };
      readonly gate: DiagnosticRunManifest["executionPolicy"]["gate"];
    };
  }
>;

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
  readonly manifest: DiagnosticDeepReadonly<DiagnosticRunManifest>;
  readonly review: DiagnosticReviewReceipt;
  readonly result: DiagnosticDeepReadonly<MetricDiagnosticsResult>;
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
function manifestIdentity(
  manifest: DiagnosticRunManifest,
): NormalizedDiagnosticRunManifestIdentity {
  return {
    ...manifest,
    executionPolicy: {
      gate: manifest.executionPolicy.gate,
      review: {
        body: manifest.executionPolicy.review.identityBody,
        reportFingerprint: manifest.executionPolicy.review.reportFingerprint,
      },
    },
  };
}
function bindingTag(runFingerprint: string, resultFingerprint: string): string {
  return `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({ identityVersion: 1, kind: "diagnostic-run-result", runFingerprint, resultFingerprint }))}`;
}
type SnapshottedArtifact =
  | DiagnosticArtifactDigest
  | {
      readonly id: string;
      readonly scope: "input" | "preparation";
      readonly assurance: "sdk-computed";
      readonly bytes: Uint8Array;
    };
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
    if (item.scope !== scope)
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        `Artifact scope must be ${scope}`,
        `${itemPath}.scope`,
      );
    if (seen.has(item.id))
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        `Duplicate artifact ID ${item.id}`,
        `${itemPath}.id`,
      );
    seen.add(item.id);
    if (item.assurance === "sdk-computed") {
      exactKeys(item, ["id", "scope", "assurance", "bytes"], itemPath);
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
      exactKeys(
        item,
        ["id", "scope", "assurance", "algorithm", "value"],
        itemPath,
      );
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
  path: string,
): Promise<readonly DiagnosticArtifactDigest[]> {
  if (
    snapshot.some((item) => "bytes" in item) &&
    globalThis.crypto?.subtle === undefined
  )
    throw new ComplianceError(
      "CRYPTO_UNAVAILABLE",
      "Web Crypto SHA-256 is unavailable",
      path,
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
  const reviewBlocked =
    review.report.checks.some(
      (check) => !run.gate.allowedReviewStatuses.includes(check.status),
    ) ||
    review.evaluations.some((evaluation) => {
      const status =
        evaluation.expressionOverflows.length > 0
          ? "fail"
          : evaluation.status === "triggered"
            ? evaluation.severity
            : evaluation.status;
      return !run.gate.allowedReviewStatuses.includes(status);
    });
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

function buildManifest(
  run: CompletedValidatedMetricDiagnosticsRun,
  review: DiagnosticReviewReceipt,
  inputArtifacts: readonly DiagnosticArtifactDigest[],
  preparationArtifacts: readonly DiagnosticArtifactDigest[],
  lineage: readonly DiagnosticPreparationLineage[],
): DiagnosticDeepReadonly<DiagnosticRunManifest> {
  const preparation = getPreparedDiagnosticDataIdentity(run.prepared);
  return freeze({
    definitionIntegrity: run.prepared.definition.definitionIntegrity,
    preparationFingerprint: run.prepared.preparationFingerprint,
    runPresetId: run.runPresetId,
    datasetArtifactId: run.datasetArtifactId,
    inputArtifacts: [...inputArtifacts].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    preparationArtifacts: [...preparationArtifacts].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    preparationLineage: lineage,
    inputAudit: preparation.inputAudit,
    filter: preparation.filter,
    groupMap: { ...run.groupMap },
    groupDimensions: { ...run.groupDimensions },
    completePeriodCutoffs: preparation.completePeriodCutoffs,
    expectedCellGridFingerprint: preparation.expectedCellsProvided
      ? tag(
          "diagnostic-expected-cell-grid",
          "expectedCells",
          preparation.expectedCells,
        )
      : null,
    executionPolicy: { review, gate: run.gate },
    engine: {
      packages: {
        core: CORE_PACKAGE_VERSION,
        data: DATA_PACKAGE_VERSION,
        compliance: COMPLIANCE_PACKAGE_VERSION,
      },
      algorithmVersion: "diagnostics-1" as const,
    },
  });
}

export async function createDiagnosticRunIdentity(
  input: CreateDiagnosticRunIdentityInput,
): Promise<VerifiedDiagnosticRunProvenance> {
  if (!plain(input))
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      "Diagnostic evidence must be a plain object",
      "$",
    );
  exactKeys(
    input,
    [
      "completedRun",
      "inputArtifacts",
      "preparationArtifacts",
      "preparationLineage",
    ],
    "$",
  );
  const run = input.completedRun;
  let authenticated: ReturnType<typeof rerunAndVerify>;
  try {
    authenticated = rerunAndVerify(run);
  } catch (error) {
    if (error instanceof ComplianceError) throw error;
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      "completedRun must be an authentic completed diagnostic run",
      "$.completedRun",
    );
  }
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
  validateArtifactGraph(run, inputSnapshot, preparationSnapshot, lineage);
  const [inputArtifacts, preparationArtifacts] = await Promise.all([
    digestArtifacts(inputSnapshot, "$.inputArtifacts"),
    digestArtifacts(preparationSnapshot, "$.preparationArtifacts"),
  ]);
  const manifest = buildManifest(
    run,
    authenticated.review,
    inputArtifacts,
    preparationArtifacts,
    lineage,
  );
  const runFingerprint = tag(
    "diagnostic-run",
    "manifest",
    manifestIdentity(manifest),
  );
  const resultFingerprint = tag(
    "diagnostic-result",
    "result",
    authenticated.result,
  );
  const runResultFingerprint = bindingTag(runFingerprint, resultFingerprint);
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

function readArtifactDigests(
  value: unknown,
  scope: "input" | "preparation",
  path: string,
): DiagnosticArtifactDigest[] {
  if (!Array.isArray(value))
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      "Artifact digests must be an array",
      path,
    );
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!plain(item))
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "Artifact digest must be a plain object",
        itemPath,
      );
    for (const key of ["id", "algorithm", "value"] as const) {
      if (typeof item[key] !== "string")
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          `${key} must be a token`,
          `${itemPath}.${key}`,
        );
      token(item[key], `${itemPath}.${key}`);
    }
    if (item.scope !== scope)
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        `Artifact scope must be ${scope}`,
        `${itemPath}.scope`,
      );
    if (item.assurance === "sdk-computed") {
      exactKeys(
        item,
        ["id", "scope", "assurance", "algorithm", "value", "byteLength"],
        itemPath,
      );
      if (item.algorithm !== "sha256")
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          "SDK digests must use sha256",
          `${itemPath}.algorithm`,
        );
      if (!/^[0-9a-f]{64}$/.test(item.value as string))
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          "Invalid SHA-256 digest",
          `${itemPath}.value`,
        );
      if (
        !Number.isSafeInteger(item.byteLength) ||
        (item.byteLength as number) < 0
      )
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          "Invalid byte length",
          `${itemPath}.byteLength`,
        );
    } else if (item.assurance === "caller-declared") {
      exactKeys(
        item,
        ["id", "scope", "assurance", "algorithm", "value"],
        itemPath,
      );
    } else {
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "Unknown artifact assurance",
        `${itemPath}.assurance`,
      );
    }
    return item as unknown as DiagnosticArtifactDigest;
  });
}

function readRecordedEngine(value: unknown): DiagnosticRunManifest["engine"] {
  if (!plain(value))
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      "Invalid diagnostic engine",
      "$.manifest.engine",
    );
  exactKeys(value, ["packages", "algorithmVersion"], "$.manifest.engine");
  if (value.algorithmVersion !== "diagnostics-1")
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      "Unsupported diagnostic algorithm",
      "$.manifest.engine.algorithmVersion",
    );
  if (!plain(value.packages))
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      "Invalid diagnostic package versions",
      "$.manifest.engine.packages",
    );
  exactKeys(
    value.packages,
    ["core", "data", "compliance"],
    "$.manifest.engine.packages",
  );
  for (const name of ["core", "data", "compliance"] as const) {
    if (typeof value.packages[name] !== "string")
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "Package version must be a token",
        `$.manifest.engine.packages.${name}`,
      );
    token(value.packages[name], `$.manifest.engine.packages.${name}`);
  }
  return value as unknown as DiagnosticRunManifest["engine"];
}

function auditedNumber(value: unknown, path: string): number | null {
  if (!plain(value))
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      "Invalid audited number",
      path,
    );
  if (
    value.status === "observed" &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
  ) {
    exactKeys(value, ["status", "value"], path);
    return value.value;
  }
  if (value.status === "missing" && value.value === null) {
    exactKeys(value, ["status", "value"], path);
    return null;
  }
  if (value.status === "non-finite" && value.value === null) {
    exactKeys(value, ["status", "value", "nonFiniteKind"], path);
    if (value.nonFiniteKind === "nan") return NaN;
    if (value.nonFiniteKind === "positive-infinity") return Infinity;
    if (value.nonFiniteKind === "negative-infinity") return -Infinity;
  }
  throw new ComplianceError(
    "BAD_DIAGNOSTIC_RUN",
    "Invalid audited number",
    path,
  );
}

/** Normalized optional nulls are omitted only when rebuilding authored input. */
function omitNulls(value: unknown): unknown {
  return plain(value)
    ? Object.fromEntries(
        Object.entries(value).filter(([, item]) => item !== null),
      )
    : value;
}

/** Human descriptions/details are regenerated, but are not identity-bearing. */
function reviewIdentityView(value: unknown): unknown {
  if (
    !plain(value) ||
    !plain(value.report) ||
    !Array.isArray(value.report.checks)
  )
    return value;
  return {
    ...value,
    report: {
      ...value.report,
      checks: value.report.checks.map((check) => {
        if (!plain(check)) return check;
        const {
          description: _description,
          details: _details,
          ...identity
        } = check;
        return identity;
      }),
    },
  };
}

function provenanceIdentityView(value: unknown): unknown {
  if (!plain(value)) return value;
  const manifest = value.manifest;
  const executionPolicy = plain(manifest) ? manifest.executionPolicy : null;
  return {
    ...value,
    review: reviewIdentityView(value.review),
    ...(plain(manifest) && plain(executionPolicy)
      ? {
          manifest: {
            ...manifest,
            executionPolicy: {
              ...executionPolicy,
              review: reviewIdentityView(executionPolicy.review),
            },
          },
        }
      : {}),
  };
}

function replaySerializedRun(
  compiled: CompiledDiagnosticDefinition,
  manifest: Record<string, unknown>,
  review: Record<string, unknown>,
): CompletedValidatedMetricDiagnosticsRun {
  if (!Array.isArray(manifest.inputAudit))
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      "Input audit must be an array",
      "$.manifest.inputAudit",
    );
  const losses: unknown[] = [],
    exposures: unknown[] = [],
    expectedCells: unknown[] = [];
  for (const [index, item] of manifest.inputAudit.entries()) {
    const path = `$.manifest.inputAudit[${index}]`;
    if (!plain(item) || !plain(item.record))
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "Invalid input audit entry",
        path,
      );
    exactKeys(item, ["kind", "record", "disposition"], path);
    const record = { ...item.record };
    if (record.source === null) delete record.source;
    else if (record.source !== undefined)
      record.source = omitNulls(record.source);
    if (item.kind === "loss") {
      if (!plain(record.measures))
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          "Invalid audited measures",
          `${path}.record.measures`,
        );
      record.measures = Object.fromEntries(
        Object.entries(record.measures).map(([id, value]) => [
          id,
          auditedNumber(value, `${path}.record.measures.${id}`),
        ]),
      );
      if (record.claimId === null) delete record.claimId;
      losses.push(record);
    } else if (item.kind === "exposure") {
      record.value = auditedNumber(record.value, `${path}.record.value`);
      if (record.valuation === null) delete record.valuation;
      exposures.push(record);
    } else if (item.kind === "expected-cell") expectedCells.push(record);
    else
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "Unknown input audit kind",
        `${path}.kind`,
      );
  }
  if (!plain(manifest.executionPolicy) || !plain(manifest.executionPolicy.gate))
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      "Missing execution gate",
      "$.manifest.executionPolicy.gate",
    );
  const gate = manifest.executionPolicy.gate;
  exactKeys(
    gate,
    [
      "allowedReviewStatuses",
      "allowedMetricFindingSeverities",
      "rationaleRef",
      "reviewGate",
      "metricGate",
    ],
    "$.manifest.executionPolicy.gate",
  );
  let outcome: ReturnType<typeof runValidatedMetricDiagnostics>;
  try {
    outcome = runValidatedMetricDiagnostics(
      validateDiagnosticRunInput({
        definition: compiled.definition,
        losses,
        exposures,
        ...(manifest.filter === null
          ? {}
          : { filter: omitNulls(manifest.filter) }),
        completePeriodCutoffs: manifest.completePeriodCutoffs,
        ...(manifest.expectedCellGridFingerprint === null
          ? {}
          : { expectedCells }),
        reviewEvidence: review.evidence,
        ...(manifest.runPresetId === null
          ? {}
          : { runPresetId: manifest.runPresetId }),
        ...(manifest.datasetArtifactId === null
          ? {}
          : { datasetArtifactId: manifest.datasetArtifactId }),
        groupMap: manifest.groupMap,
        groupDimensions: manifest.groupDimensions,
        policy: {
          allowedReviewStatuses: gate.allowedReviewStatuses,
          allowedMetricFindingSeverities: gate.allowedMetricFindingSeverities,
          ...(gate.rationaleRef === null
            ? {}
            : { rationaleRef: gate.rationaleRef }),
        },
      }),
    );
  } catch (error) {
    if (!(error instanceof DiagnosticValidationError)) throw error;
    const issue = error.issues[0];
    let issuePath = issue?.path ?? "$";
    const recordPath =
      /^\$\.(losses|exposures|expectedCells)\[(\d+)\](.*)$/.exec(issuePath);
    if (recordPath) {
      const kind =
        recordPath[1] === "losses"
          ? "loss"
          : recordPath[1] === "exposures"
            ? "exposure"
            : "expected-cell";
      const auditIndices = manifest.inputAudit.flatMap((item, index) =>
        plain(item) && item.kind === kind ? [index] : [],
      );
      issuePath = `$.manifest.inputAudit[${auditIndices[Number(recordPath[2])]}].record${recordPath[3]}`;
    } else if (issuePath.startsWith("$.reviewEvidence"))
      issuePath = issuePath.replace("$.reviewEvidence", "$.review.evidence");
    else if (issuePath.startsWith("$.policy"))
      issuePath = issuePath.replace(
        "$.policy",
        "$.manifest.executionPolicy.gate",
      );
    else if (issuePath.startsWith("$.definition"))
      issuePath = issuePath.replace("$.definition", "$.definition.definition");
    else issuePath = issuePath.replace(/^\$\./, "$.manifest.");
    throw new ComplianceError(
      "BAD_DIAGNOSTIC_RUN",
      issue?.message ?? "Invalid diagnostic replay input",
      issuePath,
    );
  }
  if (outcome.status !== "completed")
    throw new ComplianceError(
      "DIAGNOSTIC_MISMATCH",
      "Stored execution does not pass its declared gates",
      "$.manifest.executionPolicy.gate",
    );
  return outcome;
}

/** Verify serialized evidence by replaying the owning core/data public workflows. */
export function serializedDiagnosticRunMismatch(
  value: unknown,
  path = "$.diagnosticRuns[0]",
): string | null {
  try {
    if (!plain(value)) return path;
    const fields = [
      "definition",
      "manifest",
      "review",
      "result",
      "runFingerprint",
      "resultFingerprint",
      "runResultFingerprint",
    ];
    exactKeys(value, fields, "$");
    for (const key of fields)
      if (!Object.hasOwn(value, key)) return `${path}.${key}`;
    if (!plain(value.definition)) return `${path}.definition`;
    exactKeys(value.definition, ["definition", "identities"], "$.definition");
    let compiled: CompiledDiagnosticDefinition;
    try {
      compiled = compileDiagnosticDefinition(
        value.definition.definition as DiagnosticDefinition,
      );
    } catch (error) {
      const issuePath =
        error instanceof DiagnosticValidationError
          ? error.issues[0]?.path
          : undefined;
      return `${path}.definition.definition${issuePath?.startsWith("$") ? issuePath.slice(1) : ""}`;
    }
    const identities = {
      algorithm: "fnv1a64-jcs-v1",
      formulaById: compiled.formulaFingerprints,
      calculationByInstanceId: compiled.calculationFingerprints,
      definition: compiled.definitionIntegrity,
    };
    let mismatch = firstDifference(
      value.definition.identities,
      identities,
      `${path}.definition.identities`,
    );
    if (mismatch !== null) return mismatch;
    if (!plain(value.manifest)) return `${path}.manifest`;
    if (!plain(value.review)) return `${path}.review`;
    const manifest = value.manifest;
    const engine = readRecordedEngine(manifest.engine);
    const inputArtifacts = readArtifactDigests(
      manifest.inputArtifacts,
      "input",
      "$.manifest.inputArtifacts",
    );
    const preparationArtifacts = readArtifactDigests(
      manifest.preparationArtifacts,
      "preparation",
      "$.manifest.preparationArtifacts",
    );
    const lineage = snapshotLineage(manifest.preparationLineage);
    const run = replaySerializedRun(compiled, manifest, value.review);
    if (manifest.preparationFingerprint !== run.prepared.preparationFingerprint)
      return `${path}.manifest.preparationFingerprint`;
    validateArtifactGraph(run, inputArtifacts, preparationArtifacts, lineage);
    mismatch = firstDifference(
      reviewIdentityView(value.review),
      reviewIdentityView(run.review),
      `${path}.review`,
    );
    if (mismatch !== null) return mismatch;
    const expectedManifest = {
      ...buildManifest(
        run,
        run.review,
        inputArtifacts,
        preparationArtifacts,
        lineage,
      ),
      // Historical package versions describe the original run; reproduction
      // checks the supported algorithm and bundle-wide version agreement.
      engine,
    };
    mismatch = firstDifference(
      (provenanceIdentityView({ manifest }) as Record<string, unknown>)
        .manifest,
      (
        provenanceIdentityView({ manifest: expectedManifest }) as Record<
          string,
          unknown
        >
      ).manifest,
      `${path}.manifest`,
    );
    if (mismatch !== null) return mismatch;
    const result = getMetricDiagnosticsResultIdentity(run.result);
    let candidateResult: DiagnosticDeepReadonly<NormalizedDiagnosticResultIdentity>;
    try {
      candidateResult = getMetricDiagnosticsResultIdentity(
        value.result as MetricDiagnosticsResult,
      );
    } catch (error) {
      const issuePath =
        error instanceof DiagnosticValidationError
          ? error.issues[0]?.path
          : undefined;
      return `${path}.result${issuePath?.startsWith("$") ? issuePath.slice(1) : ""}`;
    }
    mismatch = firstDifference(candidateResult, result, `${path}.result`);
    if (mismatch !== null) return mismatch;
    const runFingerprint = tag(
      "diagnostic-run",
      "manifest",
      manifestIdentity(expectedManifest),
    );
    const resultFingerprint = tag("diagnostic-result", "result", result);
    if (value.runFingerprint !== runFingerprint)
      return `${path}.runFingerprint`;
    if (value.resultFingerprint !== resultFingerprint)
      return `${path}.resultFingerprint`;
    if (
      value.runResultFingerprint !==
      bindingTag(runFingerprint, resultFingerprint)
    )
      return `${path}.runResultFingerprint`;
    return null;
  } catch (error) {
    if (error instanceof ComplianceError && error.path) {
      const relative = error.path
        .replace(/^\$\.completedRun\.prepared/, "$.manifest")
        .replace(/^\$\.completedRun\.review/, "$.review")
        .replace(/^\$\.completedRun\.gate/, "$.manifest.executionPolicy.gate")
        .replace(/^\$\.completedRun\./, "$.manifest.")
        .replace(
          /^\$\.(inputArtifacts|preparationArtifacts|preparationLineage)/,
          "$.manifest.$1",
        );
      return `${path}${relative.slice(1)}`;
    }
    return path;
  }
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
  let left: string;
  let snapshot: unknown;
  try {
    left = canonicalJson(candidate);
    snapshot = JSON.parse(left);
  } catch {
    throw new ComplianceError(
      "DIAGNOSTIC_MISMATCH",
      "Stored diagnostic provenance is not canonical JSON",
      "$",
    );
  }
  const regenerated = await createDiagnosticRunIdentity(input);
  const comparedSnapshot = provenanceIdentityView(snapshot);
  const comparedRegenerated = provenanceIdentityView(regenerated);
  if (canonicalJson(comparedSnapshot) !== canonicalJson(comparedRegenerated))
    throw new ComplianceError(
      "DIAGNOSTIC_MISMATCH",
      "Stored diagnostic provenance differs from regenerated provenance",
      firstDifference(comparedSnapshot, comparedRegenerated, "$") ?? "$",
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
      const childPath = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
        ? `${path}.${key}`
        : `${path}[${JSON.stringify(key)}]`;
      if (
        !Object.prototype.hasOwnProperty.call(left, key) ||
        !Object.prototype.hasOwnProperty.call(right, key)
      )
        return childPath;
      const found = firstDifference(left[key], right[key], childPath);
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
