import {
  assertCompiledDiagnosticDefinition,
  isDiagnosticToken,
  isDiagnosticPlainRecord,
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

const tokenSchema = z.string().min(1).refine(isDiagnosticToken);
const selectedInstanceIdsSchema: z.ZodType<readonly string[]> = z
  .array(tokenSchema)
  .min(1);
export const diagnosticAgentToolInputSchema = z
  .object({
    runPresetId: tokenSchema,
    instanceIds: selectedInstanceIdsSchema,
    view: z.enum(["emergence", "triangles", "latest-diagonal"]),
  })
  .strict();
export type DiagnosticAgentView = "emergence" | "triangles" | "latest-diagonal";

export interface DiagnosticAgentToolInput {
  readonly runPresetId: string;
  readonly instanceIds: readonly string[];
  readonly view: DiagnosticAgentView;
}

export interface DiagnosticAgentPresetExecutionInput {
  readonly tenantId: string;
  readonly instanceIds: readonly string[];
}

export interface DiagnosticAgentRunPreset {
  readonly id: string;
  readonly definitionIntegrity: string;
  readonly allowedInstanceIds: readonly string[];
  readonly execute: (
    input: DiagnosticAgentPresetExecutionInput,
  ) => Promise<VerifiedDiagnosticRunProvenance>;
}
export interface CreateDiagnosticSelectionToolInput {
  readonly definition: CompiledDiagnosticDefinition;
  readonly runPresets: readonly DiagnosticAgentRunPreset[];
  readonly id?: string;
  readonly description?: string;
  readonly tenantContextKey?: string;
}
export type DiagnosticAgentDisplayProjection =
  | {
      readonly view: "emergence" | "latest-diagonal";
      readonly points: readonly DiagnosticAgentDisplayPoint[];
    }
  | {
      readonly view: "triangles";
      readonly triangles: VerifiedDiagnosticRunProvenance["result"]["triangles"];
    };
export type DiagnosticAgentDisplayPoint = Omit<
  VerifiedDiagnosticRunProvenance["result"]["emergence"][number],
  "components"
>;
export interface DiagnosticAgentToolSuccess {
  readonly success: true;
  readonly data: {
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
  };
}
export type DiagnosticAgentToolResult =
  DiagnosticDeepReadonly<DiagnosticAgentToolSuccess> | ToolEnvelopeFailure;

const toolFailureSchema = z
  .object({
    success: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }).strict(),
  })
  .strict();
const tagSchema = z.string().regex(/^fnv1a64-jcs-v1:[0-9a-f]{16}$/);
const finiteNullable = z.number().finite().nullable();
/** Zod 3 drops an own `__proto__` key when assembling records. Encode every
 * key during validation and decode only after its value has been validated. */
function recordSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .record(
      z.string().transform((key) => `:${key}`),
      valueSchema,
    )
    .transform((record): Record<string, z.output<T>> =>
      Object.fromEntries(
        Object.entries(record).map(([key, value]) => [key.slice(1), value]),
      ),
    );
}
const jsonSchema: z.ZodType<import("@actuarial-ts/core").JsonValue> = z.lazy(
  () =>
    z.union([
      z.string(),
      z.number().finite(),
      z.boolean(),
      z.null(),
      z.array(jsonSchema),
      recordSchema(jsonSchema),
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
    components: recordSchema(statsSchema),
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
    components: recordSchema(statsSchema),
    metrics: recordSchema(evaluationSchema),
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
const reviewCoordinateSchema = z
  .object({
    sourceGroup: tokenSchema,
    origin: tokenSchema,
    valuation: tokenSchema,
    developmentAge: z.number().int().nonnegative().safe(),
    ageUnit: tokenSchema,
  })
  .strict();
const cellReviewScopeSchema = z
  .object({
    kind: z.literal("cell"),
    cell: reviewCoordinateSchema,
    sources: z.array(sourceSchema),
  })
  .strict();
const pairReviewScopeSchema = z
  .object({
    kind: z.literal("valuation-pair"),
    previous: reviewCoordinateSchema,
    current: reviewCoordinateSchema,
    sources: z.array(sourceSchema),
  })
  .strict();
const controlReviewScopeSchema = z
  .object({
    kind: z.literal("control-total"),
    projection: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("valuation"), valuation: tokenSchema })
        .strict(),
      z.object({ kind: z.literal("latest-valuation-per-origin") }).strict(),
      z.object({ kind: z.literal("all-cells") }).strict(),
    ]),
    filter: z
      .object({
        sourceGroups: z.array(tokenSchema).nullable(),
        origins: z.array(tokenSchema).nullable(),
        originFrom: tokenSchema.nullable(),
        originThrough: tokenSchema.nullable(),
        valuations: z.array(tokenSchema).nullable(),
        valuationFrom: tokenSchema.nullable(),
        valuationThrough: tokenSchema.nullable(),
        minDevelopmentAge: z.number().int().nonnegative().safe().nullable(),
        maxDevelopmentAge: z.number().int().nonnegative().safe().nullable(),
      })
      .strict()
      .nullable(),
    selectedCellCount: z.number().int().nonnegative().safe(),
    selectedContributionCount: z.number().int().nonnegative().safe(),
    sources: z.array(sourceSchema),
  })
  .strict();
const reviewScopeSchema = z.discriminatedUnion("kind", [
  cellReviewScopeSchema,
  pairReviewScopeSchema,
  controlReviewScopeSchema,
]);
const dataFindingContextSchema = z
  .object({
    ruleId: tokenSchema.optional(),
    measureId: tokenSchema.optional(),
    expressionPath: z.string().optional(),
    offendingKey: z.string().optional(),
    groupingKey: tokenSchema.optional(),
    cachedEvidenceId: tokenSchema.optional(),
    sourceGroup: tokenSchema.optional(),
    origin: tokenSchema.optional(),
    valuation: tokenSchema.optional(),
    developmentAge: z.number().int().nonnegative().safe().optional(),
    ageUnit: tokenSchema.optional(),
    recordId: tokenSchema.optional(),
    claimId: tokenSchema.optional(),
    exposureKey: tokenSchema.optional(),
    group: tokenSchema.optional(),
    sourceFile: tokenSchema.optional(),
    sourceRow: z.number().int().nonnegative().safe().optional(),
    sources: z.array(sourceSchema).optional(),
    reviewScope: reviewScopeSchema.optional(),
  })
  .strict();
const dataFindingSchema = z
  .object({
    code: tokenSchema,
    message: z.string(),
    context: dataFindingContextSchema.optional(),
  })
  .strict();
const reviewEvaluationBaseSchema = z
  .object({
    ruleId: tokenSchema,
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
    notEvaluatedReasons: metricRuleSchema.shape.notEvaluatedReasons,
    expressionOverflows: z.array(
      overflowSchema.extend({ coordinate: reviewCoordinateSchema.nullable() }),
    ),
  })
  .strict();
const comparabilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("compiler-proven") }).strict(),
  z
    .object({
      kind: z.literal("caller-asserted"),
      rationaleArtifactId: tokenSchema,
    })
    .strict(),
]);
const reviewEvaluationSchema = z.discriminatedUnion("ruleKind", [
  reviewEvaluationBaseSchema.extend({
    ruleKind: z.literal("compare"),
    scope: cellReviewScopeSchema,
  }),
  reviewEvaluationBaseSchema.extend({
    ruleKind: z.literal("reconcile"),
    scope: cellReviewScopeSchema,
  }),
  reviewEvaluationBaseSchema.extend({
    ruleKind: z.literal("monotonic"),
    scope: pairReviewScopeSchema,
  }),
  reviewEvaluationBaseSchema.extend({
    ruleKind: z.literal("control-total"),
    scope: controlReviewScopeSchema,
  }),
  reviewEvaluationBaseSchema.extend({
    ruleKind: z.literal("layer-order"),
    scope: cellReviewScopeSchema,
    comparability: comparabilitySchema,
  }),
]);
const reviewSchemaBase = z
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
    reportFingerprint: tagSchema,
  })
  .strict();
const normalizedSourceSchema = sourceSchema.extend({
  sourceFile: tokenSchema.nullable(),
  sourceSheet: tokenSchema.nullable(),
  sourceRow: z.number().int().nonnegative().safe().nullable(),
  sourceCell: tokenSchema.nullable(),
});
const normalizedSourcesSchema = z.array(normalizedSourceSchema);
const normalizedCellScopeSchema = cellReviewScopeSchema.extend({
  sources: normalizedSourcesSchema,
});
const normalizedPairScopeSchema = pairReviewScopeSchema.extend({
  sources: normalizedSourcesSchema,
});
const normalizedControlScopeSchema = controlReviewScopeSchema.extend({
  sources: normalizedSourcesSchema,
});
const normalizedScopeSchema = z.discriminatedUnion("kind", [
  normalizedCellScopeSchema,
  normalizedPairScopeSchema,
  normalizedControlScopeSchema,
]);
const normalizedReviewEvaluationBaseSchema = reviewEvaluationBaseSchema.extend({
  expressionOverflows: z.array(
    overflowSchema.extend({
      sources: normalizedSourcesSchema,
      coordinate: reviewCoordinateSchema.nullable(),
    }),
  ),
});
const normalizedReviewEvaluationSchema = z.discriminatedUnion("ruleKind", [
  normalizedReviewEvaluationBaseSchema.extend({
    ruleKind: z.literal("compare"),
    scope: normalizedCellScopeSchema,
  }),
  normalizedReviewEvaluationBaseSchema.extend({
    ruleKind: z.literal("reconcile"),
    scope: normalizedCellScopeSchema,
  }),
  normalizedReviewEvaluationBaseSchema.extend({
    ruleKind: z.literal("monotonic"),
    scope: normalizedPairScopeSchema,
  }),
  normalizedReviewEvaluationBaseSchema.extend({
    ruleKind: z.literal("control-total"),
    scope: normalizedControlScopeSchema,
  }),
  normalizedReviewEvaluationBaseSchema.extend({
    ruleKind: z.literal("layer-order"),
    scope: normalizedCellScopeSchema,
    comparability: comparabilitySchema,
  }),
]);
const normalizedFindingSchema = dataFindingSchema.extend({
  context: dataFindingContextSchema
    .extend({
      sources: normalizedSourcesSchema.optional(),
      reviewScope: normalizedScopeSchema.optional(),
    })
    .optional(),
});
const evidenceShape = reviewSchemaBase.shape.evidence.unwrap().shape;
const normalizedEvidenceSchema = z
  .object({
    groupingAssignments: z.array(
      evidenceShape.groupingAssignments.element.extend({
        source: normalizedSourceSchema.optional(),
      }),
    ),
    cachedFormulas: z.array(
      evidenceShape.cachedFormulas.element.extend({
        source: normalizedSourceSchema.optional(),
      }),
    ),
  })
  .strict()
  .nullable();
const reviewSchema = reviewSchemaBase.extend({
  identityBody: z
    .object({
      definitionIntegrity: tagSchema,
      preparationFingerprint: tagSchema,
      evidence: normalizedEvidenceSchema,
      checks: z.array(
        reviewSchemaBase.shape.report.shape.checks.element
          .omit({ description: true, details: true })
          .extend({ findings: z.array(normalizedFindingSchema) }),
      ),
      summary: reviewSchemaBase.shape.report.shape.summary,
      evaluations: z.array(normalizedReviewEvaluationSchema),
    })
    .strict(),
});
const displaySchema = z.discriminatedUnion("view", [
  z
    .object({
      view: z.literal("emergence"),
      points: z.array(pointSchema.omit({ components: true })),
    })
    .strict(),
  z
    .object({
      view: z.literal("triangles"),
      triangles: z.array(triangleSchema),
    })
    .strict(),
  z
    .object({
      view: z.literal("latest-diagonal"),
      points: z.array(pointSchema.omit({ components: true })),
    })
    .strict(),
]);
const toolSuccessSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        runPresetId: tokenSchema,
        instanceIds: z.array(tokenSchema).min(1),
        definitionIntegrity: tagSchema,
        formulaFingerprints: recordSchema(tagSchema),
        calculationFingerprints: recordSchema(tagSchema),
        runFingerprint: tagSchema,
        resultFingerprint: tagSchema,
        runResultFingerprint: tagSchema,
        review: reviewSchema,
        display: displaySchema,
      })
      .strict(),
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

function token(value: unknown, label: string): asserts value is string {
  if (!isDiagnosticToken(value))
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
  const definition = input.definition;
  const id = input.id === undefined ? "run_diagnostic_selection" : input.id;
  const description =
    input.description === undefined
      ? "Run a host-approved diagnostic preset for selected registered metric instances."
      : input.description;
  const tenantKey =
    input.tenantContextKey === undefined ? "projectId" : input.tenantContextKey;
  token(id, "tool id");
  token(tenantKey, "tenant context key");
  if (typeof description !== "string" || description.trim().length === 0)
    throw new AgentsError(
      "BAD_DIAGNOSTIC_CATALOG",
      "description must be nonblank",
    );
  if (!Array.isArray(input.runPresets) || input.runPresets.length === 0)
    throw new AgentsError(
      "BAD_DIAGNOSTIC_CATALOG",
      "at least one approved diagnostic preset is required",
    );
  const known = new Set(definition.definition.instances.map((item) => item.id));
  const catalog = new Map<
    string,
    {
      definitionIntegrity: string;
      allowedInstanceIds: readonly string[];
      execute: DiagnosticAgentRunPreset["execute"];
    }
  >();
  for (const preset of input.runPresets) {
    if (!isDiagnosticPlainRecord(preset))
      throw new AgentsError(
        "BAD_DIAGNOSTIC_CATALOG",
        "Each diagnostic preset must be a plain record",
      );
    token(preset.id, "preset id");
    if (catalog.has(preset.id))
      throw new AgentsError(
        "BAD_DIAGNOSTIC_CATALOG",
        `duplicate preset ${preset.id}`,
      );
    if (preset.definitionIntegrity !== definition.definitionIntegrity)
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
    if (!Array.isArray(preset.allowedInstanceIds))
      throw new AgentsError(
        "BAD_DIAGNOSTIC_CATALOG",
        `preset ${preset.id} must declare allowed instance IDs`,
      );
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
        execute: preset.execute as DiagnosticAgentRunPreset["execute"],
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
        tenantId: tenant,
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
          definition.definitionIntegrity ||
        provenance.manifest.runPresetId !== raw.runPresetId ||
        !filter ||
        JSON.stringify(filter.instanceIds ?? []) !== JSON.stringify(selected)
      )
        throw new AgentsError(
          "DIAGNOSTIC_RUN_MISMATCH",
          "Verified run does not match the selected definition, preset, and exact instance set",
        );
      const instances = definition.definition.instances.filter((item) =>
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
      const displayPoints = (
        points: VerifiedDiagnosticRunProvenance["result"]["emergence"],
      ): readonly DiagnosticAgentDisplayPoint[] =>
        points.map(({ components: _components, ...point }) => point);
      const display =
        raw.view === "emergence"
          ? {
              view: "emergence" as const,
              points: displayPoints(provenance.result.emergence),
            }
          : raw.view === "triangles"
            ? {
                view: "triangles" as const,
                triangles: provenance.result.triangles,
              }
            : {
                view: "latest-diagonal" as const,
                points: displayPoints(provenance.result.latestDiagonal),
              };
      return {
        success: true,
        data: {
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
        },
      };
    },
  });
}
