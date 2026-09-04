import {
  assertCompiledDiagnosticDefinition,
  type CompiledDiagnosticDefinition,
  type DiagnosticDeepReadonly,
} from "@actuarial-ts/core";
import {
  assertVerifiedDiagnosticRunProvenance,
  type VerifiedDiagnosticRunProvenance,
} from "@actuarial-ts/compliance";
import { z } from "zod";
import { AgentsError } from "./errors.js";
import {
  defineActuarialTool,
  type DefinedActuarialTool,
  type ToolEnvelopeFailure,
} from "./tools.js";

export const diagnosticAgentToolInputSchema = z
  .object({
    runPresetId: z.string().min(1),
    instanceIds: z.array(z.string().min(1)).min(1),
    view: z.enum(["emergence", "triangles", "latest-diagonal"]),
  })
  .strict();
export type DiagnosticAgentToolInput = z.input<
  typeof diagnosticAgentToolInputSchema
>;

export interface DiagnosticAgentRunPreset {
  readonly id: string;
  readonly definitionIntegrity: string;
  readonly allowedInstanceIds: readonly string[];
  readonly execute: (input: {
    readonly tenant: string;
    readonly instanceIds: readonly string[];
  }) => Promise<VerifiedDiagnosticRunProvenance>;
}
export interface CreateDiagnosticSelectionToolInput {
  readonly definition: CompiledDiagnosticDefinition;
  readonly presets: readonly DiagnosticAgentRunPreset[];
  readonly id?: string;
  readonly description?: string;
  readonly tenantContextKey?: string;
}
export type DiagnosticAgentDisplayProjection =
  | {
      readonly view: "emergence";
      readonly value: VerifiedDiagnosticRunProvenance["result"]["emergence"];
    }
  | {
      readonly view: "triangles";
      readonly value: VerifiedDiagnosticRunProvenance["result"]["triangles"];
    }
  | {
      readonly view: "latest-diagonal";
      readonly value: VerifiedDiagnosticRunProvenance["result"]["latestDiagonal"];
    };
export type DiagnosticAgentDisplayPoint =
  | VerifiedDiagnosticRunProvenance["result"]["emergence"][number]
  | VerifiedDiagnosticRunProvenance["result"]["triangles"][number]
  | VerifiedDiagnosticRunProvenance["result"]["latestDiagonal"][number];
export interface DiagnosticAgentToolSuccess {
  readonly success: true;
  readonly runPresetId: string;
  readonly instanceIds: readonly string[];
  readonly definitionIntegrity: string;
  readonly formulaFingerprints: Readonly<Record<string, string>>;
  readonly calculationFingerprints: Readonly<Record<string, string>>;
  readonly runFingerprint: string;
  readonly resultFingerprint: string;
  readonly runResultFingerprint: string;
  readonly review: VerifiedDiagnosticRunProvenance["review"];
  readonly display: DiagnosticAgentDisplayProjection;
}
export type DiagnosticAgentToolResult =
  | DiagnosticDeepReadonly<DiagnosticAgentToolSuccess>
  | ToolEnvelopeFailure;

const toolFailureSchema = z
  .object({
    success: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }).strict(),
  })
  .strict();
const tokenSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !value.includes("\0") && !/^[\t-\r ]|[\t-\r ]$/.test(value),
  );
const tagSchema = z.string().regex(/^fnv1a64-jcs-v1:[0-9a-f]{16}$/);
const finiteNullable = z.number().finite().nullable();
const jsonSchema: z.ZodType<import("@actuarial-ts/core").JsonValue> = z.lazy(
  () =>
    z.union([
      z.string(),
      z.number().finite(),
      z.boolean(),
      z.null(),
      z.array(jsonSchema),
      z.record(jsonSchema),
    ]),
);
const sourceSchema = z
  .object({
    artifactId: tokenSchema,
    sourceFile: tokenSchema.optional(),
    sourceSheet: tokenSchema.optional(),
    sourceRow: z.number().int().nonnegative().optional(),
    sourceCell: tokenSchema.optional(),
  })
  .strict();
const quantitySchema = z
  .object({
    kind: z.enum(["amount", "count", "exposure"]),
    unit: tokenSchema,
    basisId: tokenSchema.optional(),
    countPopulationId: tokenSchema.optional(),
    exposureBasisId: tokenSchema.optional(),
    value: finiteNullable,
  })
  .strict();
const statsSchema = z
  .object({
    sum: finiteNullable,
    value: finiteNullable,
    observed: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    imputedZero: z.number().int().nonnegative(),
    nonFinite: z.number().int().nonnegative(),
    structural: z.number().int().nonnegative(),
    deduplicated: z.number().int().nonnegative(),
  })
  .strict();
const findingSchema = z
  .object({
    code: tokenSchema,
    message: z.string().min(1),
    severity: z.enum(["info", "warning", "fail"]),
    category: z.enum([
      "structural",
      "aggregation",
      "calculation",
      "rule",
      "presentation",
    ]),
    ruleId: tokenSchema.optional(),
    measureId: tokenSchema.optional(),
    instanceId: tokenSchema.optional(),
    expressionPath: z.string().optional(),
    offendingKey: z.string().optional(),
    sourceGroup: tokenSchema.optional(),
    group: tokenSchema.optional(),
    origin: tokenSchema.optional(),
    valuation: tokenSchema.optional(),
    developmentAge: z.number().int().nonnegative().optional(),
    ageUnit: tokenSchema.optional(),
    recordId: tokenSchema.optional(),
    claimId: tokenSchema.optional(),
    exposureKey: tokenSchema.optional(),
    sources: z.array(sourceSchema),
  })
  .strict();
const overflowSchema = z
  .object({ expressionPath: z.string(), sources: z.array(sourceSchema) })
  .strict();
const metricRuleSchema = z
  .object({
    ruleId: tokenSchema,
    status: z.enum(["pass", "triggered", "not-evaluated"]),
    severity: z.enum(["warning", "fail"]),
    left: finiteNullable,
    right: finiteNullable,
    relation: z.enum(["less", "equal", "greater"]).nullable(),
    notEvaluatedReasons: z.array(
      z.enum([
        "missing",
        "imputed",
        "non-finite",
        "structural-ambiguity",
        "aggregation-overflow",
        "expression-overflow",
        "tolerance-overflow",
      ]),
    ),
    expressionOverflows: z.array(overflowSchema),
    code: z.string().nullable(),
    message: z.string().nullable(),
  })
  .strict();
const presentationSchema = z
  .object({
    displayName: z.string().min(1),
    description: z.string().min(1),
    displayUnit: tokenSchema,
    scale: z.number().finite().positive(),
    numeratorLabel: z.string().min(1),
    denominatorLabel: z.string().min(1),
    value: finiteNullable,
  })
  .strict();
const evaluationSchema = z
  .object({
    instanceId: tokenSchema,
    instanceVersion: tokenSchema,
    formulaId: tokenSchema,
    formulaVersion: tokenSchema,
    semanticReferences: z
      .object({
        amountBasisIds: z.array(tokenSchema),
        countPopulationIds: z.array(tokenSchema),
        exposureBasisIds: z.array(tokenSchema),
      })
      .strict(),
    formulaFingerprint: tagSchema,
    calculationFingerprint: tagSchema,
    definitionIntegrity: tagSchema,
    calculation: z
      .object({
        numerator: quantitySchema,
        denominator: quantitySchema,
        value: finiteNullable,
      })
      .strict(),
    presentation: presentationSchema,
    components: z.record(statsSchema),
    rules: z.array(metricRuleSchema),
    findings: z.array(findingSchema),
  })
  .strict();
const pointSchema = z
  .object({
    group: tokenSchema,
    sourceGroups: z.array(tokenSchema),
    dimensions: jsonSchema.optional(),
    origin: tokenSchema,
    valuation: tokenSchema,
    developmentAge: z.number().int().nonnegative(),
    ageUnit: tokenSchema,
    components: z.record(statsSchema),
    metrics: z.record(evaluationSchema),
    findings: z.array(findingSchema),
  })
  .strict();
const triangleCellSchema = z
  .object({
    origin: tokenSchema,
    valuation: tokenSchema,
    developmentAge: z.number().int().nonnegative(),
    ageUnit: tokenSchema,
    evaluation: evaluationSchema,
  })
  .strict();
const triangleSchema = z
  .object({
    group: tokenSchema,
    instanceId: tokenSchema,
    origins: z.array(tokenSchema),
    developmentAges: z.array(z.number().int().nonnegative()),
    ageUnit: tokenSchema,
    calculationValues: z.array(z.array(finiteNullable)),
    presentationValues: z.array(z.array(finiteNullable)),
    cells: z.array(z.array(triangleCellSchema.nullable())),
  })
  .strict();
const dataFindingSchema = z
  .object({
    code: tokenSchema,
    message: z.string(),
    context: z.record(jsonSchema).optional(),
  })
  .strict();
const reviewEvaluationSchema = z
  .object({
    ruleId: tokenSchema,
    ruleKind: z.enum([
      "compare",
      "reconcile",
      "monotonic",
      "layer-order",
      "control-total",
    ]),
    status: z.enum(["pass", "triggered", "not-evaluated"]),
    severity: z.enum(["warning", "fail"]),
    triggerReason: z
      .enum([
        "predicate",
        "missing-input",
        "aggregation-overflow",
        "expression-overflow",
        "tolerance-overflow",
      ])
      .nullable(),
    left: finiteNullable,
    right: finiteNullable,
    relation: z.enum(["less", "equal", "greater"]).nullable(),
    notEvaluatedReasons: z.array(z.string()),
    expressionOverflows: z.array(jsonSchema),
    scope: jsonSchema,
    comparability: jsonSchema.optional(),
  })
  .strict();
const reviewSchema = z
  .object({
    definitionIntegrity: tagSchema,
    preparationFingerprint: tagSchema,
    report: z
      .object({
        checks: z.array(
          z
            .object({
              id: tokenSchema,
              description: z.string(),
              status: z.enum(["pass", "warning", "fail", "not-evaluated"]),
              details: z.array(z.string()),
              findings: z.array(dataFindingSchema),
            })
            .strict(),
        ),
        summary: z
          .object({
            pass: z.number().int().nonnegative(),
            warning: z.number().int().nonnegative(),
            fail: z.number().int().nonnegative(),
            notEvaluated: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    evaluations: z.array(reviewEvaluationSchema),
    evidence: z
      .object({
        groupingAssignments: z.array(
          z
            .object({
              key: tokenSchema,
              group: tokenSchema,
              source: sourceSchema.optional(),
            })
            .strict(),
        ),
        cachedFormulas: z.array(
          z
            .object({
              id: tokenSchema,
              source: sourceSchema.optional(),
              formula: z.string().optional(),
              cachedValue: finiteNullable.optional(),
              declaredFormulaSource: z.boolean(),
            })
            .strict(),
        ),
      })
      .strict()
      .nullable(),
    identityBody: jsonSchema,
    reportFingerprint: tagSchema,
  })
  .strict();
const displaySchema = z.discriminatedUnion("view", [
  z
    .object({ view: z.literal("emergence"), value: z.array(pointSchema) })
    .strict(),
  z
    .object({ view: z.literal("triangles"), value: z.array(triangleSchema) })
    .strict(),
  z
    .object({ view: z.literal("latest-diagonal"), value: z.array(pointSchema) })
    .strict(),
]);
const toolSuccessSchema = z
  .object({
    success: z.literal(true),
    runPresetId: tokenSchema,
    instanceIds: z.array(tokenSchema).min(1),
    definitionIntegrity: tagSchema,
    formulaFingerprints: z.record(tagSchema),
    calculationFingerprints: z.record(tagSchema),
    runFingerprint: tagSchema,
    resultFingerprint: tagSchema,
    runResultFingerprint: tagSchema,
    review: reviewSchema,
    display: displaySchema,
  })
  .strict();
/** Strict model-visible output schema, including the wrapper's failure branch. */
export const diagnosticAgentToolResultSchema = z.union([
  toolSuccessSchema,
  toolFailureSchema,
]) as unknown as z.ZodType<DiagnosticAgentToolResult>;
export type DiagnosticSelectionTool = DefinedActuarialTool<
  DiagnosticAgentToolInput,
  DiagnosticAgentToolResult
>;

function token(value: string, label: string): void {
  if (
    value.length === 0 ||
    /^[\t-\r ]|[\t-\r ]$/.test(value) ||
    value.includes("\0")
  )
    throw new AgentsError(
      "BAD_DIAGNOSTIC_CATALOG",
      `${label} must be a nonempty token`,
    );
}
function sortUniqueRequested(values: readonly string[]): string[] {
  const result = [...new Set(values)];
  result.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return result;
}

export function createDiagnosticSelectionTool(
  input: CreateDiagnosticSelectionToolInput,
): DiagnosticSelectionTool {
  try {
    assertCompiledDiagnosticDefinition(input.definition);
  } catch {
    throw new AgentsError(
      "BAD_DIAGNOSTIC_CATALOG",
      "definition must be an authentic compiled diagnostic definition",
    );
  }
  const id = input.id ?? "run_diagnostic_selection";
  const description =
    input.description ??
    "Run a host-approved diagnostic preset for selected registered metric instances.";
  const tenantKey = input.tenantContextKey ?? "projectId";
  token(id, "tool id");
  token(tenantKey, "tenant context key");
  if (description.trim().length === 0)
    throw new AgentsError(
      "BAD_DIAGNOSTIC_CATALOG",
      "description must be nonblank",
    );
  if (input.presets.length === 0)
    throw new AgentsError(
      "BAD_DIAGNOSTIC_CATALOG",
      "at least one approved diagnostic preset is required",
    );
  const known = new Set(
    input.definition.definition.instances.map((item) => item.id),
  );
  const catalog = new Map<
    string,
    {
      definitionIntegrity: string;
      allowedInstanceIds: readonly string[];
      execute: DiagnosticAgentRunPreset["execute"];
    }
  >();
  for (const preset of input.presets) {
    token(preset.id, "preset id");
    if (catalog.has(preset.id))
      throw new AgentsError(
        "BAD_DIAGNOSTIC_CATALOG",
        `duplicate preset ${preset.id}`,
      );
    if (preset.definitionIntegrity !== input.definition.definitionIntegrity)
      throw new AgentsError(
        "BAD_DIAGNOSTIC_CATALOG",
        `preset ${preset.id} targets another definition`,
      );
    if (typeof preset.execute !== "function")
      throw new AgentsError(
        "BAD_DIAGNOSTIC_CATALOG",
        `preset ${preset.id} has no executor`,
      );
    const seen = new Set<string>();
    for (const instanceId of preset.allowedInstanceIds) {
      token(instanceId, "allowed instance id");
      if (seen.has(instanceId))
        throw new AgentsError(
          "BAD_DIAGNOSTIC_CATALOG",
          `preset ${preset.id} repeats ${instanceId}`,
        );
      if (!known.has(instanceId))
        throw new AgentsError(
          "BAD_DIAGNOSTIC_CATALOG",
          `preset ${preset.id} references unknown instance ${instanceId}`,
        );
      seen.add(instanceId);
    }
    if (seen.size === 0)
      throw new AgentsError(
        "BAD_DIAGNOSTIC_CATALOG",
        `preset ${preset.id} has no allowed instances`,
      );
    catalog.set(
      preset.id,
      Object.freeze({
        definitionIntegrity: preset.definitionIntegrity,
        allowedInstanceIds: Object.freeze([...seen].sort()),
        execute: preset.execute,
      }),
    );
  }
  return defineActuarialTool({
    id,
    description,
    kind: "read",
    tenant: "required",
    tenantKey,
    inputSchema: diagnosticAgentToolInputSchema,
    outputSchema: diagnosticAgentToolResultSchema,
    execute: async (raw, tenant): Promise<DiagnosticAgentToolSuccess> => {
      const preset = catalog.get(raw.runPresetId);
      if (!preset)
        throw new AgentsError(
          "UNKNOWN_DIAGNOSTIC_PRESET",
          `Unknown diagnostic preset ${raw.runPresetId}`,
        );
      const selected = sortUniqueRequested(raw.instanceIds);
      if (selected.some((item) => !preset.allowedInstanceIds.includes(item)))
        throw new AgentsError(
          "UNAPPROVED_DIAGNOSTIC_INSTANCE",
          "One or more diagnostic instances are not approved by the selected preset",
        );
      const provenance = await preset.execute({
        tenant,
        instanceIds: selected,
      });
      try {
        assertVerifiedDiagnosticRunProvenance(provenance);
      } catch {
        throw new AgentsError(
          "DIAGNOSTIC_RUN_MISMATCH",
          "Preset executor returned unauthenticated diagnostic provenance",
        );
      }
      const filter = provenance.manifest.filter;
      if (
        provenance.definition.identities.definition !==
          input.definition.definitionIntegrity ||
        provenance.manifest.runPresetId !== raw.runPresetId ||
        !filter ||
        JSON.stringify(filter.instanceIds ?? []) !== JSON.stringify(selected)
      )
        throw new AgentsError(
          "DIAGNOSTIC_RUN_MISMATCH",
          "Verified run does not match the selected definition, preset, and exact instance set",
        );
      const instances = input.definition.definition.instances.filter((item) =>
        selected.includes(item.id),
      );
      const formulaIds = [
        ...new Set(instances.map((item) => item.formulaId)),
      ].sort();
      const formulaFingerprints = Object.fromEntries(
        formulaIds.map((formulaId) => [
          formulaId,
          provenance.definition.identities.formulaById[formulaId]!,
        ]),
      );
      const calculationFingerprints = Object.fromEntries(
        selected.map((instanceId) => [
          instanceId,
          provenance.definition.identities.calculationByInstanceId[instanceId]!,
        ]),
      );
      const display =
        raw.view === "emergence"
          ? { view: "emergence" as const, value: provenance.result.emergence }
          : raw.view === "triangles"
            ? { view: "triangles" as const, value: provenance.result.triangles }
            : {
                view: "latest-diagonal" as const,
                value: provenance.result.latestDiagonal,
              };
      return {
        success: true,
        runPresetId: raw.runPresetId,
        instanceIds: selected,
        definitionIntegrity: provenance.definition.identities.definition,
        formulaFingerprints,
        calculationFingerprints,
        runFingerprint: provenance.runFingerprint,
        resultFingerprint: provenance.resultFingerprint,
        runResultFingerprint: provenance.runResultFingerprint,
        review: provenance.review,
        display,
      };
    },
  });
}
