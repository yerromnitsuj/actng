import {
  DiagnosticValidationError,
  compileDiagnosticDefinition,
  prepareDiagnosticData,
  runMetricDiagnostics,
  validateDiagnosticGroupingConfiguration,
  type CompiledDiagnosticDefinition,
  type DiagnosticCompletePeriodCutoff,
  type DiagnosticDeepReadonly,
  type DiagnosticDefinition,
  type DiagnosticExpectedCell,
  type DiagnosticExposureObservation,
  type DiagnosticLossInput,
  type DiagnosticsFilter,
  type JsonValue,
  type MetricDiagnosticsResult,
  type DiagnosticValidationIssue,
  diagnosticRecord,
  isDiagnosticToken,
  isWellFormedDiagnosticString,
} from "@actuarial-ts/core";
import { z } from "zod";
import {
  reviewPreparedDiagnosticData,
  validateDiagnosticReviewEvidence,
  type DiagnosticReviewEvidence,
  type DiagnosticReviewReceipt,
} from "./diagnosticPreparedReview.js";

// Zod 3 validates but drops the literal __proto__ key while assembling records.
// Encode every key reversibly during validation, then restore owned data keys.
// The same adapter is exercised by the shared three-shore prototype-key corpus.
function recordSchema<T extends z.ZodTypeAny>(value: T) {
  return z
    .record(
      z.string().transform((key) => `:${key}`),
      value,
    )
    .transform(
      (record) =>
        Object.fromEntries(
          Object.entries(record).map(([key, item]) => [key.slice(1), item]),
        ) as Record<string, z.output<T>>,
    );
}

const tokenSchema = z
  .string()
  .refine(
    isDiagnosticToken,
    "Expected a nonempty token with valid Unicode and no U+0000",
  );
const jsonStringSchema = z
  .string()
  .refine(
    isWellFormedDiagnosticString,
    "Expected valid Unicode without U+0000",
  );
const sourceSchema = z
  .object({
    artifactId: tokenSchema,
    sourceFile: tokenSchema.optional(),
    sourceSheet: tokenSchema.optional(),
    sourceRow: z.number().int().nonnegative().safe().optional(),
    sourceCell: tokenSchema.optional(),
  })
  .strict();
const rawNumberSchema = z.custom<number>(
  (value) => typeof value === "number",
  "Expected number",
);
const measuresSchema = recordSchema(z.union([rawNumberSchema, z.null()]));
const lossBase = {
  recordId: tokenSchema,
  sourceGroup: tokenSchema,
  origin: tokenSchema,
  valuation: tokenSchema,
  complete: z.boolean(),
  source: sourceSchema.optional(),
  measures: measuresSchema,
};
const lossSchema = z.discriminatedUnion("rowType", [
  z
    .object({ ...lossBase, rowType: z.literal("claim"), claimId: tokenSchema })
    .strict(),
  z.object({ ...lossBase, rowType: z.literal("aggregate") }).strict(),
]);
const exposureSchema = z
  .object({
    key: tokenSchema,
    sourceGroup: tokenSchema,
    origin: tokenSchema,
    valuation: tokenSchema.optional(),
    measureId: tokenSchema,
    value: z.union([rawNumberSchema, z.null()]),
    complete: z.boolean(),
    source: sourceSchema.optional(),
  })
  .strict();
const filterSchema = z
  .object({
    sourceGroups: z.array(tokenSchema).optional(),
    outputGroups: z.array(tokenSchema).optional(),
    origins: z.array(tokenSchema).optional(),
    originFrom: tokenSchema.optional(),
    originThrough: tokenSchema.optional(),
    valuations: z.array(tokenSchema).optional(),
    valuationFrom: tokenSchema.optional(),
    valuationThrough: tokenSchema.optional(),
    minDevelopmentAge: z.number().int().nonnegative().safe().optional(),
    maxDevelopmentAge: z.number().int().nonnegative().safe().optional(),
    instanceIds: z.array(tokenSchema).optional(),
  })
  .strict();
const cutoffSchema = z
  .object({
    sourceGroup: tokenSchema,
    originThrough: tokenSchema.nullable(),
    valuationThrough: tokenSchema.nullable(),
  })
  .strict();
const expectedSchema = z
  .object({
    sourceGroup: tokenSchema,
    origin: tokenSchema,
    valuation: tokenSchema,
    source: sourceSchema.optional(),
  })
  .strict();
const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    jsonStringSchema,
    z.array(jsonSchema),
    recordSchema(jsonSchema),
  ]),
);
const policySchema = z
  .object({
    allowedReviewStatuses: z
      .array(z.enum(["pass", "warning", "not-evaluated", "fail"]))
      .optional(),
    allowedMetricFindingSeverities: z
      .array(z.enum(["info", "warning", "fail"]))
      .optional(),
    rationaleRef: tokenSchema.optional(),
  })
  .strict();
const runSchema = z
  .object({
    definition: z.unknown(),
    losses: z.array(lossSchema),
    exposures: z.array(exposureSchema).optional(),
    filter: filterSchema.optional(),
    completePeriodCutoffs: z.array(cutoffSchema).optional(),
    expectedCells: z.array(expectedSchema).optional(),
    reviewEvidence: z.unknown().nullable().optional(),
    runPresetId: tokenSchema.optional(),
    datasetArtifactId: tokenSchema.optional(),
    groupMap: recordSchema(tokenSchema).optional(),
    groupDimensions: recordSchema(jsonSchema).optional(),
    policy: policySchema.optional(),
  })
  .strict();

export type DiagnosticAllowedReviewStatus =
  | "pass"
  | "warning"
  | "not-evaluated"
  | "fail";
export interface DiagnosticExecutionPolicyInput {
  readonly allowedReviewStatuses?: readonly DiagnosticAllowedReviewStatus[];
  readonly allowedMetricFindingSeverities?: readonly (
    | "info"
    | "warning"
    | "fail"
  )[];
  readonly rationaleRef?: string;
}
export interface DiagnosticRunInput {
  readonly definition: DiagnosticDefinition;
  readonly losses: readonly DiagnosticLossInput[];
  readonly exposures?: readonly DiagnosticExposureObservation[];
  readonly filter?: DiagnosticsFilter;
  readonly completePeriodCutoffs?: readonly DiagnosticCompletePeriodCutoff[];
  readonly expectedCells?: readonly DiagnosticExpectedCell[];
  readonly reviewEvidence?: DiagnosticReviewEvidence | null;
  readonly runPresetId?: string;
  readonly datasetArtifactId?: string;
  readonly groupMap?: Readonly<Record<string, string>>;
  readonly groupDimensions?: Readonly<Record<string, JsonValue>>;
  readonly policy?: DiagnosticExecutionPolicyInput;
}
declare const validatedDiagnosticRunInputBrand: unique symbol;
export interface ValidatedDiagnosticRunInput {
  readonly [validatedDiagnosticRunInputBrand]: true;
  readonly definition: CompiledDiagnosticDefinition;
  readonly losses: readonly DiagnosticDeepReadonly<DiagnosticLossInput>[];
  readonly exposures: readonly DiagnosticDeepReadonly<DiagnosticExposureObservation>[];
  readonly filter: DiagnosticDeepReadonly<DiagnosticsFilter> | null;
  readonly completePeriodCutoffs: readonly DiagnosticCompletePeriodCutoff[];
  readonly expectedCells: readonly DiagnosticExpectedCell[] | null;
  readonly reviewEvidence: DiagnosticDeepReadonly<DiagnosticReviewEvidence> | null;
  readonly runPresetId: string | null;
  readonly datasetArtifactId: string | null;
  readonly groupMap: Readonly<Record<string, string>>;
  readonly groupDimensions: Readonly<Record<string, JsonValue>>;
  readonly policy: {
    readonly allowedReviewStatuses: readonly DiagnosticAllowedReviewStatus[];
    readonly allowedMetricFindingSeverities: readonly (
      | "info"
      | "warning"
      | "fail"
    )[];
    readonly rationaleRef: string | null;
  };
}
export interface DiagnosticExecutionGateReceipt {
  readonly allowedReviewStatuses: readonly DiagnosticAllowedReviewStatus[];
  readonly allowedMetricFindingSeverities: readonly (
    | "info"
    | "warning"
    | "fail"
  )[];
  readonly rationaleRef: string | null;
  readonly reviewGate: "passed" | "blocked";
  readonly metricGate: "not-run" | "passed" | "blocked";
}
export interface CompletedValidatedMetricDiagnosticsRun {
  readonly status: "completed";
  readonly prepared: import("@actuarial-ts/core").PreparedDiagnosticData;
  readonly review: DiagnosticReviewReceipt;
  readonly result: DiagnosticDeepReadonly<MetricDiagnosticsResult>;
  readonly runPresetId: string | null;
  readonly datasetArtifactId: string | null;
  readonly groupMap: Readonly<Record<string, string>>;
  readonly groupDimensions: Readonly<Record<string, JsonValue>>;
  readonly gate: DiagnosticExecutionGateReceipt & {
    readonly reviewGate: "passed";
    readonly metricGate: "passed";
  };
}
export type ValidatedMetricDiagnosticsOutcome =
  | CompletedValidatedMetricDiagnosticsRun
  | {
      readonly status: "blocked";
      readonly stage: "review";
      readonly prepared: import("@actuarial-ts/core").PreparedDiagnosticData;
      readonly review: DiagnosticReviewReceipt;
      readonly result: null;
      readonly runPresetId: string | null;
      readonly datasetArtifactId: string | null;
      readonly groupMap: Readonly<Record<string, string>>;
      readonly groupDimensions: Readonly<Record<string, JsonValue>>;
      readonly gate: DiagnosticExecutionGateReceipt & {
        readonly reviewGate: "blocked";
        readonly metricGate: "not-run";
      };
    }
  | {
      readonly status: "blocked";
      readonly stage: "metric";
      readonly prepared: import("@actuarial-ts/core").PreparedDiagnosticData;
      readonly review: DiagnosticReviewReceipt;
      readonly result: DiagnosticDeepReadonly<MetricDiagnosticsResult>;
      readonly runPresetId: string | null;
      readonly datasetArtifactId: string | null;
      readonly groupMap: Readonly<Record<string, string>>;
      readonly groupDimensions: Readonly<Record<string, JsonValue>>;
      readonly gate: DiagnosticExecutionGateReceipt & {
        readonly reviewGate: "passed";
        readonly metricGate: "blocked";
      };
    };

const authentic = new WeakSet<object>();
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
function issues(error: z.ZodError): DiagnosticValidationError {
  return new DiagnosticValidationError(
    error.issues.map((issue) => ({
      domain: (issue.path[0] === "definition"
        ? "definition"
        : issue.path[0] === "losses" ||
            issue.path[0] === "exposures" ||
            issue.path[0] === "reviewEvidence"
          ? "input"
          : "configuration") as "definition" | "input" | "configuration",
      code: issue.code === "unrecognized_keys" ? "unknown-key" : "invalid-type",
      path: `$${issue.path.map((part) => (typeof part === "number" ? `[${part}]` : /^[A-Za-z_$][\w$]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`)).join("")}`,
      message: issue.message,
    })),
  );
}
function codeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function sortedRecord<T>(
  value: Readonly<Record<string, T>>,
): Readonly<Record<string, T>> {
  const result = diagnosticRecord<T>();
  for (const key of Object.keys(value).sort(codeUnit))
    result[key] = value[key]!;
  return result;
}

function explicitUndefinedIssues(value: unknown): DiagnosticValidationIssue[] {
  const found: DiagnosticValidationIssue[] = [];
  const stack: { readonly value: unknown; readonly path: string }[] = [
    { value, path: "$" },
  ];
  const seen = new WeakSet<object>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (
      current.value === null ||
      typeof current.value !== "object" ||
      seen.has(current.value)
    )
      continue;
    seen.add(current.value);
    for (const [key, child] of Object.entries(current.value)) {
      const path = Array.isArray(current.value)
        ? `${current.path}[${key}]`
        : /^[A-Za-z_$][\w$]*$/.test(key)
          ? `${current.path}.${key}`
          : `${current.path}[${JSON.stringify(key)}]`;
      if (child === undefined)
        found.push({
          domain: path.startsWith("$.definition")
            ? "definition"
            : path.startsWith("$.losses") ||
                path.startsWith("$.exposures") ||
                path.startsWith("$.reviewEvidence")
              ? "input"
              : "configuration",
          code: "invalid-type",
          path,
          message: "Explicit undefined is not allowed",
        });
      else stack.push({ value: child, path });
    }
  }
  return found;
}

export function validateDiagnosticRunInput(
  value: unknown,
): ValidatedDiagnosticRunInput {
  const undefinedIssues = explicitUndefinedIssues(value);
  if (undefinedIssues.length > 0)
    throw new DiagnosticValidationError(undefinedIssues);
  const parsed = runSchema.safeParse(value);
  if (!parsed.success) throw issues(parsed.error);
  const definition = compileDiagnosticDefinition(
    parsed.data.definition as DiagnosticDefinition,
  );
  const relationIssues: DiagnosticValidationIssue[] =
    parsed.data.losses.flatMap((row, index) =>
      row.rowType === definition.definition.lossRowGrain
        ? []
        : [
            {
              domain: "input" as const,
              code: "invalid-input-relationship" as const,
              path: `$.losses[${index}].rowType`,
              message: "Loss row type does not match definition grain",
            },
          ],
    );
  for (const [index, row] of (parsed.data.exposures ?? []).entries()) {
    const measure = definition.definition.measures.find(
      (item) => item.id === row.measureId,
    );
    if (
      measure?.exposureTiming === "valuation-specific" &&
      row.valuation === undefined
    )
      relationIssues.push({
        domain: "input",
        code: "missing-required",
        path: `$.exposures[${index}].valuation`,
        message: "Valuation-specific exposure requires valuation",
      });
  }
  if (relationIssues.length)
    throw new DiagnosticValidationError(relationIssues);
  const review = parsed.data.policy?.allowedReviewStatuses ?? [
    "pass",
    "warning",
    "not-evaluated",
  ];
  const metric = parsed.data.policy?.allowedMetricFindingSeverities ?? [
    "info",
    "warning",
  ];
  const rationale = parsed.data.policy?.rationaleRef ?? null;
  if (
    (review.includes("fail") || metric.includes("fail")) &&
    rationale === null
  )
    throw new DiagnosticValidationError([
      {
        domain: "configuration",
        code: "missing-required",
        path: "$.policy.rationaleRef",
        message: "A rationale is required when fail outcomes are allowed",
      },
    ]);
  const reviewEvidence =
    parsed.data.reviewEvidence === undefined ||
    parsed.data.reviewEvidence === null
      ? null
      : validateDiagnosticReviewEvidence(
          parsed.data.reviewEvidence,
          "$.reviewEvidence",
        );
  const reviewOrder: readonly DiagnosticAllowedReviewStatus[] = [
    "pass",
    "warning",
    "not-evaluated",
    "fail",
  ];
  const metricOrder: readonly ("info" | "warning" | "fail")[] = [
    "info",
    "warning",
    "fail",
  ];
  for (const key of [
    ...Object.keys(parsed.data.groupMap ?? {}),
    ...Object.keys(parsed.data.groupDimensions ?? {}),
  ])
    if (!isDiagnosticToken(key))
      throw new DiagnosticValidationError([
        {
          domain: "configuration",
          code: "invalid-string",
          path: `$.groupMap[${JSON.stringify(key)}]`,
          message:
            "Group key must be a nonempty token with valid Unicode and no U+0000",
        },
      ]);
  const result = freeze({
    definition,
    losses: parsed.data.losses,
    exposures: parsed.data.exposures ?? [],
    filter: parsed.data.filter ?? null,
    completePeriodCutoffs: parsed.data.completePeriodCutoffs ?? [],
    expectedCells: parsed.data.expectedCells ?? null,
    reviewEvidence,
    runPresetId: parsed.data.runPresetId ?? null,
    datasetArtifactId: parsed.data.datasetArtifactId ?? null,
    groupMap: sortedRecord(parsed.data.groupMap ?? diagnosticRecord()),
    groupDimensions: sortedRecord(
      parsed.data.groupDimensions ?? diagnosticRecord(),
    ),
    policy: {
      allowedReviewStatuses: reviewOrder.filter((status) =>
        review.includes(status),
      ),
      allowedMetricFindingSeverities: metricOrder.filter((severity) =>
        metric.includes(severity),
      ),
      rationaleRef: rationale,
    },
  }) as unknown as ValidatedDiagnosticRunInput;
  const prepared = prepareDiagnosticData({
    definition: result.definition,
    losses: result.losses,
    exposures: result.exposures,
    ...(result.filter === null ? {} : { filter: result.filter }),
    completePeriodCutoffs: result.completePeriodCutoffs,
    ...(result.expectedCells === null
      ? {}
      : { expectedCells: result.expectedCells }),
  });
  validateDiagnosticGroupingConfiguration({
    prepared,
    groupMap: result.groupMap,
    groupDimensions: result.groupDimensions,
  });
  authentic.add(result);
  return result;
}

export function assertValidatedDiagnosticRunInput(
  value: unknown,
): asserts value is ValidatedDiagnosticRunInput {
  if (value === null || typeof value !== "object" || !authentic.has(value))
    throw new DiagnosticValidationError([
      {
        domain: "input",
        code: "invalid-input-relationship",
        path: "$",
        message: "Value is not an authentic validated diagnostic run input",
      },
    ]);
}

const completed = new WeakSet<object>();
export function runValidatedMetricDiagnostics(
  input: ValidatedDiagnosticRunInput,
): ValidatedMetricDiagnosticsOutcome {
  assertValidatedDiagnosticRunInput(input);
  const prepared = prepareDiagnosticData({
    definition: input.definition,
    losses: input.losses,
    exposures: input.exposures,
    ...(input.filter === null ? {} : { filter: input.filter }),
    completePeriodCutoffs: input.completePeriodCutoffs,
    ...(input.expectedCells === null
      ? {}
      : { expectedCells: input.expectedCells }),
  });
  validateDiagnosticGroupingConfiguration({
    prepared,
    groupMap: input.groupMap,
    groupDimensions: input.groupDimensions,
  });
  const review = reviewPreparedDiagnosticData({
    prepared,
    evidence: input.reviewEvidence as DiagnosticReviewEvidence | null,
  });
  const evaluationStatus = (
    evaluation: DiagnosticReviewReceipt["evaluations"][number],
  ): DiagnosticAllowedReviewStatus =>
    evaluation.expressionOverflows.length > 0
      ? "fail"
      : evaluation.status === "not-evaluated"
        ? "not-evaluated"
        : evaluation.status === "triggered"
          ? evaluation.severity
          : "pass";
  const disallowedReview =
    review.report.checks.some(
      (check) => !input.policy.allowedReviewStatuses.includes(check.status),
    ) ||
    review.evaluations.some(
      (evaluation) =>
        !input.policy.allowedReviewStatuses.includes(
          evaluationStatus(evaluation),
        ),
    );
  const base = {
    prepared,
    review,
    runPresetId: input.runPresetId,
    datasetArtifactId: input.datasetArtifactId,
    groupMap: input.groupMap,
    groupDimensions: input.groupDimensions,
  };
  if (disallowedReview)
    return freeze({
      ...base,
      status: "blocked" as const,
      stage: "review" as const,
      result: null,
      gate: {
        ...input.policy,
        reviewGate: "blocked" as const,
        metricGate: "not-run" as const,
      },
    }) as ValidatedMetricDiagnosticsOutcome;
  const result = runMetricDiagnostics({
    prepared,
    groupMap: input.groupMap,
    groupDimensions: input.groupDimensions,
  });
  const disallowedMetric = result.findings.some(
    (finding) =>
      finding.category !== "structural" &&
      !input.policy.allowedMetricFindingSeverities.includes(finding.severity),
  );
  if (disallowedMetric)
    return freeze({
      ...base,
      status: "blocked" as const,
      stage: "metric" as const,
      result,
      gate: {
        ...input.policy,
        reviewGate: "passed" as const,
        metricGate: "blocked" as const,
      },
    }) as ValidatedMetricDiagnosticsOutcome;
  const outcome = freeze({
    ...base,
    status: "completed" as const,
    result,
    gate: {
      ...input.policy,
      reviewGate: "passed" as const,
      metricGate: "passed" as const,
    },
  }) as unknown as CompletedValidatedMetricDiagnosticsRun;
  completed.add(outcome);
  return outcome;
}
export function assertCompletedValidatedMetricDiagnosticsRun(
  value: unknown,
): asserts value is CompletedValidatedMetricDiagnosticsRun {
  if (value === null || typeof value !== "object" || !completed.has(value))
    throw new DiagnosticValidationError([
      {
        domain: "input",
        code: "invalid-input-relationship",
        path: "$",
        message: "Value is not an authentic completed diagnostic run",
      },
    ]);
}
