import type { CompactPreparedDiagnosticData } from "@actuarial-ts/core";
import type { CompactDiagnosticReviewReceipt } from "@actuarial-ts/data";
import type {
  DiagnosticArtifactDigest,
  DiagnosticPreparationLineage,
} from "./diagnosticRun.js";
import { ComplianceError } from "./errors.js";

/** Shared content validation; callers separately authenticate their run owner. */
export interface DiagnosticArtifactGraphContent {
  readonly prepared: Pick<
    CompactPreparedDiagnosticData,
    "inputAudit" | "definition"
  >;
  readonly review: Pick<CompactDiagnosticReviewReceipt, "evidence">;
  readonly datasetArtifactId: string | null;
  readonly gate: { readonly rationaleRef: string | null };
}

export const token = (value: string, path: string) => {
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
export function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
export function exactKeys(
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
export function snapshotLineage(
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

export function validateArtifactGraph(
  run: DiagnosticArtifactGraphContent,
  inputArtifacts: readonly Pick<
    DiagnosticArtifactDigest,
    "id" | "scope" | "assurance"
  >[],
  preparationArtifacts: readonly Pick<
    DiagnosticArtifactDigest,
    "id" | "scope" | "assurance"
  >[],
  lineage: readonly DiagnosticPreparationLineage[],
): void {
  const byId = new Map<
    string,
    Pick<DiagnosticArtifactDigest, "id" | "scope" | "assurance">
  >();
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
  } else if (run.datasetArtifactId !== null) {
    requireArtifact(
      run.datasetArtifactId,
      "input",
      "$.completedRun.datasetArtifactId",
    );
    if (byId.get(run.datasetArtifactId)!.assurance !== "sdk-computed")
      throw new ComplianceError(
        "BAD_DIAGNOSTIC_RUN",
        "datasetArtifactId must resolve to SDK-computed input evidence",
        "$.completedRun.datasetArtifactId",
      );
  }
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
  for (const root of [...referenced]) {
    const stack = [{ id: root, exit: false }];
    while (stack.length > 0) {
      const { id, exit } = stack.pop()!;
      if (exit) {
        visiting.delete(id);
        visited.add(id);
        continue;
      }
      if (visiting.has(id))
        throw new ComplianceError(
          "BAD_DIAGNOSTIC_RUN",
          "Artifact lineage contains a cycle",
          "$.preparationLineage",
        );
      if (visited.has(id)) continue;
      visiting.add(id);
      stack.push({ id, exit: true });
      for (const upstream of [...(edges.get(id) ?? [])].reverse()) {
        referenced.add(upstream);
        stack.push({ id: upstream, exit: false });
      }
    }
  }
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
