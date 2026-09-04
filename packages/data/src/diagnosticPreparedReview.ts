import {
  DiagnosticValidationError,
  assertPreparedDiagnosticData,
  canonicalJson,
  evaluateDiagnosticReviewRules,
  fnv1a64,
  compareDiagnosticSourceLocations,
  compareDiagnosticIdentityValues,
  normalizeDiagnosticSourceLocations,
  projectDiagnosticIdentity,
  type DiagnosticIdentityProjection,
  type DiagnosticDeepReadonly,
  type DiagnosticMetricFinding,
  type DiagnosticReviewRuleEvaluation,
  type DiagnosticSourceLocation,
  type PreparedDiagnosticData,
} from "@actuarial-ts/core";
import { z } from "zod";
import {
  createNotEvaluatedDataCheck,
  createStructuredDataCheck,
  summarizeDataChecks,
  type DataCheck,
  type DataFinding,
  type DataFindingContext,
  type DataReviewReport,
} from "./review.js";

export interface DiagnosticGroupingAssignment {
  readonly key: string;
  readonly group: string;
  readonly source?: DiagnosticSourceLocation;
}

export interface DiagnosticCachedFormulaEvidence {
  readonly id: string;
  readonly source?: DiagnosticSourceLocation;
  readonly formula?: string;
  readonly cachedValue?: number | null;
  readonly declaredFormulaSource: boolean;
}

export interface DiagnosticReviewEvidence {
  readonly groupingAssignments: readonly DiagnosticGroupingAssignment[];
  readonly cachedFormulas: readonly DiagnosticCachedFormulaEvidence[];
}

export interface DiagnosticReviewIdentityBody {
  readonly definitionIntegrity: string;
  readonly preparationFingerprint: string;
  readonly evidence: DiagnosticIdentityProjection<DiagnosticReviewEvidence> | null;
  readonly checks: readonly {
    readonly id: string;
    readonly status: DataCheck["status"];
    readonly findings: readonly DiagnosticIdentityProjection<DataFinding>[];
  }[];
  readonly summary: DataReviewReport["summary"];
  readonly evaluations: readonly DiagnosticIdentityProjection<DiagnosticReviewRuleEvaluation>[];
}

export interface DiagnosticReviewReceipt {
  readonly definitionIntegrity: string;
  readonly preparationFingerprint: string;
  readonly report: DiagnosticDeepReadonly<DataReviewReport>;
  readonly evaluations: readonly DiagnosticReviewRuleEvaluation[];
  readonly evidence: DiagnosticDeepReadonly<DiagnosticReviewEvidence> | null;
  readonly identityBody: DiagnosticDeepReadonly<DiagnosticReviewIdentityBody>;
  readonly reportFingerprint: string;
}

export interface ReviewPreparedDiagnosticDataInput {
  readonly prepared: PreparedDiagnosticData;
  readonly evidence: DiagnosticReviewEvidence | null;
}

const fixed = [
  ["diagnostic/structural/loss-identity", "Loss identities are unique", "fail"],
  [
    "diagnostic/structural/exposure-identity",
    "Exposure identities are coherent",
    "fail",
  ],
  ["diagnostic/structural/period-validity", "Periods are valid", "fail"],
  [
    "diagnostic/structural/measure-contract",
    "Measure keys match their declared sources",
    "fail",
  ],
  [
    "diagnostic/structural/loss-completeness",
    "Loss records are complete",
    "fail",
  ],
  [
    "diagnostic/structural/exposure-completeness",
    "Exposure records are complete and finite",
    "fail",
  ],
  [
    "diagnostic/structural/loss-without-exposure",
    "Loss cells have required exposure",
    "warning",
  ],
  [
    "diagnostic/structural/exposure-without-loss",
    "Exposures attach to retained loss cells",
    "warning",
  ],
  [
    "diagnostic/structural/expected-cell-coverage",
    "Expected cells are present",
    "fail",
  ],
  [
    "diagnostic/structural/grouping-consistency",
    "Grouping assignments are consistent",
    "fail",
  ],
  [
    "diagnostic/structural/cached-formula-provenance",
    "Cached formulas retain provenance",
    "warning",
  ],
] as const;

const codeToCheck: Readonly<Record<string, string>> = {
  "duplicate-loss-record-id": fixed[0][0],
  "duplicate-claim-snapshot": fixed[0][0],
  "claim-identity-conflict": fixed[0][0],
  "duplicate-aggregate-snapshot": fixed[0][0],
  "duplicate-exposure-identity": fixed[1][0],
  "conflicting-exposure-identity": fixed[1][0],
  "unknown-origin-period": fixed[2][0],
  "unknown-valuation-period": fixed[2][0],
  "valuation-before-origin": fixed[2][0],
  "unsafe-development-age": fixed[2][0],
  "undeclared-loss-measure": fixed[3][0],
  "wrong-source-loss-measure": fixed[3][0],
  "undeclared-exposure-measure": fixed[3][0],
  "wrong-source-exposure-measure": fixed[3][0],
  "incomplete-loss-record": fixed[4][0],
  "missing-exposure-value": fixed[5][0],
  "incomplete-exposure": fixed[5][0],
  "non-finite-exposure": fixed[5][0],
  "loss-without-exposure": fixed[6][0],
  "exposure-without-loss": fixed[7][0],
  "missing-expected-cell": fixed[8][0],
};

const sourceSchema = z
  .object({
    artifactId: z.string().min(1),
    sourceFile: z.string().min(1).optional(),
    sourceSheet: z.string().min(1).optional(),
    sourceRow: z.number().int().nonnegative().optional(),
    sourceCell: z.string().min(1).optional(),
  })
  .strict();

const evidenceSchema = z
  .object({
    groupingAssignments: z.array(
      z
        .object({
          key: z.string().min(1),
          group: z.string().min(1),
          source: sourceSchema.optional(),
        })
        .strict(),
    ),
    cachedFormulas: z.array(
      z
        .object({
          id: z.string().min(1),
          source: sourceSchema.optional(),
          formula: z
            .string()
            .min(1)
            .refine(
              (value) => value.trim().length > 0,
              "Formula must contain non-whitespace text",
            )
            .optional(),
          cachedValue: z.number().finite().nullable().optional(),
          declaredFormulaSource: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

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

function issuePath(root: string, path: readonly PropertyKey[]): string {
  return `${root}${path.map((part) => (typeof part === "number" ? `[${part}]` : /^[A-Za-z_$][\w$]*$/.test(String(part)) ? `.${String(part)}` : `[${JSON.stringify(String(part))}]`)).join("")}`;
}

function compareOptional<T>(
  left: T | undefined,
  right: T | undefined,
  compare: (a: T, b: T) => number,
): number {
  if (left === undefined) return right === undefined ? 0 : -1;
  if (right === undefined) return 1;
  return compare(left, right);
}

function compareSourceArrays(
  left: readonly DiagnosticSourceLocation[],
  right: readonly DiagnosticSourceLocation[],
): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const compared = compareDiagnosticSourceLocations(
      left[index]!,
      right[index]!,
    );
    if (compared !== 0) return compared;
  }
  return left.length - right.length;
}

function normalizeDataFindings(values: readonly DataFinding[]): DataFinding[] {
  const merged = new Map<string, DataFinding>();
  for (const finding of values) {
    const context = finding.context;
    const reviewScope = context?.reviewScope;
    const key = canonicalJson({
      ...finding,
      ...(context === undefined
        ? {}
        : {
            context: {
              ...context,
              sources: [],
              ...(reviewScope === undefined
                ? {}
                : { reviewScope: { ...reviewScope, sources: [] } }),
            },
          }),
    });
    const previous = merged.get(key);
    const previousContext = previous?.context;
    const normalizedContext =
      context === undefined
        ? undefined
        : {
            ...context,
            ...(context.sources === undefined &&
            previousContext?.sources === undefined
              ? {}
              : {
                  sources: normalizeDiagnosticSourceLocations([
                    ...(previousContext?.sources ?? []),
                    ...(context.sources ?? []),
                  ]),
                }),
            ...(reviewScope === undefined
              ? {}
              : {
                  reviewScope: {
                    ...reviewScope,
                    sources: normalizeDiagnosticSourceLocations([
                      ...(previousContext?.reviewScope?.sources ?? []),
                      ...reviewScope.sources,
                    ]),
                  },
                }),
          };
    merged.set(key, {
      ...finding,
      ...(normalizedContext === undefined
        ? {}
        : { context: normalizedContext }),
    });
  }
  const text = (left: string, right: string) =>
    left < right ? -1 : left > right ? 1 : 0;
  const field = (finding: DataFinding, key: keyof DataFindingContext) =>
    finding.context?.[key];
  const textField = (
    left: DataFinding,
    right: DataFinding,
    key: keyof DataFindingContext,
  ) =>
    compareOptional(
      field(left, key) as string | undefined,
      field(right, key) as string | undefined,
      text,
    );
  return [...merged.values()].sort(
    (left, right) =>
      text(left.code, right.code) ||
      textField(left, right, "ruleId") ||
      textField(left, right, "measureId") ||
      textField(left, right, "offendingKey") ||
      textField(left, right, "groupingKey") ||
      textField(left, right, "cachedEvidenceId") ||
      textField(left, right, "sourceGroup") ||
      textField(left, right, "group") ||
      textField(left, right, "origin") ||
      textField(left, right, "valuation") ||
      compareOptional(
        field(left, "developmentAge") as number | undefined,
        field(right, "developmentAge") as number | undefined,
        (a, b) => a - b,
      ) ||
      textField(left, right, "ageUnit") ||
      textField(left, right, "recordId") ||
      textField(left, right, "claimId") ||
      textField(left, right, "exposureKey") ||
      text(
        canonicalJson(
          left.context?.reviewScope === undefined
            ? null
            : { ...left.context.reviewScope, sources: [] },
        ),
        canonicalJson(
          right.context?.reviewScope === undefined
            ? null
            : { ...right.context.reviewScope, sources: [] },
        ),
      ) ||
      textField(left, right, "sourceFile") ||
      compareOptional(
        field(left, "sourceRow") as number | undefined,
        field(right, "sourceRow") as number | undefined,
        (a, b) => a - b,
      ) ||
      text(left.message, right.message) ||
      compareSourceArrays(
        left.context?.sources ?? [],
        right.context?.sources ?? [],
      ),
  );
}

export function validateDiagnosticReviewEvidence(
  value: unknown,
  root = "$.evidence",
): DiagnosticDeepReadonly<DiagnosticReviewEvidence> {
  const undefinedPaths: string[] = [];
  const stack: { readonly value: unknown; readonly path: string }[] = [
    { value, path: root },
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
        : issuePath(current.path, [key]);
      if (child === undefined) undefinedPaths.push(path);
      else stack.push({ value: child, path });
    }
  }
  if (undefinedPaths.length > 0)
    throw new DiagnosticValidationError(
      undefinedPaths.sort().map((path) => ({
        domain: "input",
        code: "invalid-type",
        path,
        message: "Explicit undefined is not allowed",
      })),
    );
  const parsed = evidenceSchema.safeParse(value);
  if (!parsed.success) {
    throw new DiagnosticValidationError(
      parsed.error.issues.map((issue) => ({
        domain: "input" as const,
        code:
          issue.code === "unrecognized_keys"
            ? ("unknown-key" as const)
            : issue.code === "too_small"
              ? ("invalid-string" as const)
              : ("invalid-type" as const),
        path: issuePath(root, issue.path),
        message: issue.message,
      })),
    );
  }
  const codeUnit = (left: string, right: string) =>
    left < right ? -1 : left > right ? 1 : 0;
  parsed.data.groupingAssignments.sort(
    (left, right) =>
      codeUnit(left.key, right.key) ||
      codeUnit(left.group, right.group) ||
      compareOptional(
        left.source,
        right.source,
        compareDiagnosticSourceLocations,
      ),
  );
  parsed.data.cachedFormulas.sort(
    (left, right) =>
      codeUnit(left.id, right.id) ||
      compareOptional(
        left.source,
        right.source,
        compareDiagnosticSourceLocations,
      ) ||
      compareDiagnosticIdentityValues(
        [left.formula, left.cachedValue, left.declaredFormulaSource],
        [right.formula, right.cachedValue, right.declaredFormulaSource],
      ),
  );
  return freeze(parsed.data);
}

function findingContext(finding: DiagnosticMetricFinding): DataFindingContext {
  return {
    ...(finding.ruleId === undefined ? {} : { ruleId: finding.ruleId }),
    ...(finding.measureId === undefined
      ? {}
      : { measureId: finding.measureId }),
    ...(finding.expressionPath === undefined
      ? {}
      : { expressionPath: finding.expressionPath }),
    ...(finding.offendingKey === undefined
      ? {}
      : { offendingKey: finding.offendingKey }),
    ...(finding.sourceGroup === undefined
      ? {}
      : { sourceGroup: finding.sourceGroup }),
    ...(finding.group === undefined ? {} : { group: finding.group }),
    ...(finding.origin === undefined ? {} : { origin: finding.origin }),
    ...(finding.valuation === undefined
      ? {}
      : { valuation: finding.valuation }),
    ...(finding.developmentAge === undefined
      ? {}
      : { developmentAge: finding.developmentAge }),
    ...(finding.ageUnit === undefined ? {} : { ageUnit: finding.ageUnit }),
    ...(finding.recordId === undefined ? {} : { recordId: finding.recordId }),
    ...(finding.claimId === undefined ? {} : { claimId: finding.claimId }),
    ...(finding.exposureKey === undefined
      ? {}
      : { exposureKey: finding.exposureKey }),
    sources: finding.sources,
  };
}

export function reviewPreparedDiagnosticData(
  input: ReviewPreparedDiagnosticDataInput,
): DiagnosticReviewReceipt {
  assertPreparedDiagnosticData(input.prepared);
  const evidence =
    input.evidence === null
      ? null
      : validateDiagnosticReviewEvidence(input.evidence);
  const evaluations = evaluateDiagnosticReviewRules(input.prepared);
  const findingsByCheck = new Map<string, DataFinding[]>(
    fixed.map(([id]) => [id, []]),
  );
  for (const finding of input.prepared.findings) {
    const id = codeToCheck[finding.code];
    if (id)
      findingsByCheck.get(id)!.push({
        code: finding.code,
        message: finding.message,
        context: findingContext(finding),
      });
  }

  if (evidence) {
    const assignments = new Map<string, DiagnosticGroupingAssignment[]>();
    for (const item of evidence.groupingAssignments) {
      const values = assignments.get(item.key) ?? [];
      values.push(item);
      assignments.set(item.key, values);
    }
    for (const [key, values] of assignments) {
      if (new Set(values.map((item) => item.group)).size > 1)
        findingsByCheck.get(fixed[9][0])!.push({
          code: "inconsistent-group-mapping",
          message: "Grouping evidence assigns one key to multiple groups",
          context: {
            groupingKey: key,
            sources: normalizeDiagnosticSourceLocations(
              values.map((item) => item.source),
            ),
          },
        });
    }
    const failingCached = new Map<string, DiagnosticCachedFormulaEvidence[]>();
    for (const item of evidence.cachedFormulas) {
      const hasOwnCachedValue = Object.prototype.hasOwnProperty.call(
        item,
        "cachedValue",
      );
      if (
        item.declaredFormulaSource &&
        (item.formula === undefined ||
          !hasOwnCachedValue ||
          item.cachedValue === null ||
          item.source === undefined)
      ) {
        const values = failingCached.get(item.id) ?? [];
        values.push(item);
        failingCached.set(item.id, values);
      }
    }
    for (const [id, values] of failingCached)
      findingsByCheck.get(fixed[10][0])!.push({
        code: "cached-formula-provenance",
        message:
          "Declared formula-derived value lacks complete formula provenance",
        context: {
          cachedEvidenceId: id,
          sources: normalizeDiagnosticSourceLocations(
            values.map((item) => item.source),
          ),
        },
      });
  }

  const hasExposureMeasures =
    input.prepared.definition.definition.measures.some(
      (measure) => measure.source === "exposure",
    );
  const checks: DataCheck[] = fixed.map(
    ([id, description, severity], index) => {
      if ([1, 5, 6, 7].includes(index) && !hasExposureMeasures)
        return createNotEvaluatedDataCheck(
          id,
          description,
          "the definition declares no exposure measures",
        );
      if (index === 8 && !input.prepared.expectedCellsProvided)
        return createNotEvaluatedDataCheck(
          id,
          description,
          "the expected-cell grid was omitted",
        );
      if ((index === 9 || index === 10) && evidence === null)
        return createNotEvaluatedDataCheck(
          id,
          description,
          "review evidence was omitted",
        );
      return createStructuredDataCheck(
        id,
        description,
        severity,
        normalizeDataFindings(findingsByCheck.get(id)!),
      );
    },
  );

  for (const rule of input.prepared.definition.definition.reviewRules) {
    const matching = evaluations.filter((item) => item.ruleId === rule.id);
    const overflow = matching.some(
      (item) => item.expressionOverflows.length > 0,
    );
    const status =
      overflow ||
      matching.some(
        (item) => item.status === "triggered" && item.severity === "fail",
      )
        ? "fail"
        : matching.some((item) => item.status === "triggered")
          ? "warning"
          : matching.some((item) => item.status === "not-evaluated")
            ? "not-evaluated"
            : "pass";
    const findings: DataFinding[] = matching.flatMap((item) => [
      ...item.expressionOverflows.map((overflowItem) => ({
        code: "diagnostic-expression-overflow",
        message: "Measure expression overflowed",
        context: {
          ruleId: rule.id,
          expressionPath: overflowItem.expressionPath,
          reviewScope: item.scope,
          ...(overflowItem.coordinate === null ? {} : overflowItem.coordinate),
          sources: overflowItem.sources,
        },
      })),
      ...(item.status === "triggered"
        ? [
            {
              code: rule.code,
              message: rule.description,
              context: {
                ruleId: rule.id,
                reviewScope: item.scope,
                sources: item.scope.sources,
              },
            },
          ]
        : []),
      ...(item.status === "not-evaluated"
        ? [
            {
              code: "diagnostic-review-rule-not-evaluated",
              message: "Diagnostic review rule was not evaluated",
              context: {
                ruleId: rule.id,
                reviewScope: item.scope,
                sources: item.scope.sources,
              },
            },
          ]
        : []),
    ]);
    const normalizedFindings = normalizeDataFindings(findings);
    checks.push({
      id: rule.id,
      description: rule.description,
      status,
      details: normalizedFindings.slice(0, 20).map((item) => item.message),
      findings: normalizedFindings,
    });
  }

  const report = freeze(summarizeDataChecks(checks));
  const identityBody = projectDiagnosticIdentity({
    definitionIntegrity: input.prepared.definition.definitionIntegrity,
    preparationFingerprint: input.prepared.preparationFingerprint,
    evidence,
    checks: report.checks.map((check) => ({
      id: check.id,
      status: check.status,
      findings: check.findings,
    })),
    summary: report.summary,
    evaluations,
  });
  return freeze({
    definitionIntegrity: input.prepared.definition.definitionIntegrity,
    preparationFingerprint: input.prepared.preparationFingerprint,
    report,
    evaluations,
    evidence,
    identityBody,
    reportFingerprint: `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({ identityVersion: 1, kind: "diagnostic-review-report", review: identityBody }))}`,
  });
}
