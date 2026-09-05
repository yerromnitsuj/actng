import {
  DiagnosticValidationError,
  diagnosticJsonPreflight,
  isDiagnosticToken,
  assertPreparedDiagnosticData,
  assertCompactPreparedDiagnosticData,
  evaluateDiagnosticReviewRulesCompact,
  getDiagnosticReviewEvaluation,
  getDiagnosticReviewEvaluationSummary,
  getCompactDiagnosticReviewEvaluationsIdentityDocument,
  getCompactPreparedDiagnosticDataFingerprint,
  createDiagnosticIdentityArray,
  createDiagnosticIdentityObject,
  createDiagnosticIdentityValue,
  fingerprintDiagnosticIdentity,
  type DiagnosticIdentityDocument,
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
  type PreparedDiagnosticDataContent,
  type CompactPreparedDiagnosticData,
  type CompactDiagnosticReviewEvaluations,
  type DiagnosticReviewPage,
} from "@actuarial-ts/core";
import { CompactDiagnosticJson } from "./compactDiagnosticJson.js";
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

export interface CompactDiagnosticReviewCheck {
  readonly id: string;
  readonly description: string;
  readonly status: DataCheck["status"];
  readonly details: readonly string[];
  readonly findingCount: number;
}
declare const compactFindingsBrand: unique symbol;
export interface CompactDiagnosticReviewFindings {
  readonly [compactFindingsBrand]: true;
  readonly count: number;
}
export interface CompactDiagnosticReviewReceipt {
  readonly definitionIntegrity: string;
  readonly report: {
    readonly checks: readonly CompactDiagnosticReviewCheck[];
    readonly summary: DiagnosticDeepReadonly<DataReviewReport["summary"]>;
  };
  readonly evaluations: CompactDiagnosticReviewEvaluations;
  readonly findings: CompactDiagnosticReviewFindings;
  readonly evidence: DiagnosticDeepReadonly<DiagnosticReviewEvidence> | null;
}
export interface ReviewPreparedDiagnosticDataCompactInput {
  readonly prepared: CompactPreparedDiagnosticData;
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

function findingMergeSkeleton(finding: DataFinding): DataFinding {
  const context = finding.context;
  const reviewScope = context?.reviewScope;
  return {
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
  };
}
function findingMergeKey(finding: DataFinding): string {
  return canonicalJson(findingMergeSkeleton(finding));
}

function normalizeDataFindings(values: readonly DataFinding[]): DataFinding[] {
  const merged = new Map<string, DataFinding>();
  for (const finding of values) {
    const context = finding.context;
    const reviewScope = context?.reviewScope;
    const key = findingMergeKey(finding);
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
  return [...merged.values()].sort(compareDataFindings);
}

function compareDataFindings(left: DataFinding, right: DataFinding): number {
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
  return (
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
    )
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

function structuralChecks(
  prepared: PreparedDiagnosticDataContent,
  evidence: DiagnosticDeepReadonly<DiagnosticReviewEvidence> | null,
): DataCheck[] {
  const findingsByCheck = new Map<string, DataFinding[]>(
    fixed.map(([id]) => [id, []]),
  );
  for (const finding of prepared.findings) {
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

  const hasExposureMeasures = prepared.definition.definition.measures.some(
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
      if (index === 8 && !prepared.expectedCellsProvided)
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
  return checks;
}

function evaluationFindings(
  item: DiagnosticReviewRuleEvaluation,
  rule: {
    readonly id: string;
    readonly code: string;
    readonly description: string;
  },
): DataFinding[] {
  return [
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
  ];
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
  const checks = structuralChecks(input.prepared, evidence);

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
    const findings = matching.flatMap((item) => evaluationFindings(item, rule));
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

interface FindingBlock {
  readonly checkId: string;
  readonly start: number;
  readonly ids: Uint32Array;
}
interface FindingState {
  readonly table: CompactDiagnosticJson;
  readonly blocks: readonly FindingBlock[];
  readonly count: number;
}
const findingStates = new WeakMap<object, FindingState>();
const compactReceipts = new WeakSet<object>();
const compactReceiptPreparations = new WeakMap<
  CompactDiagnosticReviewReceipt,
  CompactPreparedDiagnosticData
>();
const compactReceiptFingerprints = new WeakMap<
  CompactDiagnosticReviewReceipt,
  string
>();
function compactError(message: string, path = "$"): never {
  throw new DiagnosticValidationError([
    { domain: "input", code: "invalid-input-relationship", path, message },
  ]);
}
export function assertCompactDiagnosticReviewReceipt(
  value: unknown,
): asserts value is CompactDiagnosticReviewReceipt {
  if (
    value === null ||
    typeof value !== "object" ||
    !compactReceipts.has(value)
  )
    compactError("Value is not an authentic compact diagnostic review receipt");
}
function findingState(store: CompactDiagnosticReviewFindings): FindingState {
  if (store === null || typeof store !== "object" || !findingStates.has(store))
    compactError("Value is not an authentic compact diagnostic finding store");
  return findingStates.get(store)!;
}
function findingLocation(
  state: FindingState,
  index: number,
): { block: FindingBlock; id: number } {
  if (!Number.isSafeInteger(index) || index < 0 || index >= state.count)
    compactError("Finding index is outside this review", "$.index");
  const block = state.blocks.find(
    (block) => index >= block.start && index < block.start + block.ids.length,
  )!;
  return { block, id: block.ids[index - block.start]! };
}
export interface DiagnosticReviewFindingEntry {
  readonly index: number;
  readonly checkId: string;
  readonly finding: DiagnosticDeepReadonly<DataFinding>;
}
type WithoutSources<T> = T extends readonly (infer V)[]
  ? readonly WithoutSources<V>[]
  : T extends object
    ? {
        readonly [K in keyof T as K extends "sources"
          ? "sourceCount"
          : K]: K extends "sources" ? number : WithoutSources<T[K]>;
      }
    : T;
export interface DiagnosticReviewFindingSummary {
  readonly index: number;
  readonly checkId: string;
  readonly finding: WithoutSources<DataFinding>;
}
export interface DiagnosticReviewFindingQuery {
  readonly checkId?: string;
  readonly offset?: number;
  readonly limit?: number;
}
export interface DiagnosticReviewFindingSourceQuery {
  readonly location?: "context" | "scope";
  readonly offset?: number;
  readonly limit?: number;
}
const findingQuerySchema = z
  .object({
    checkId: z.string().refine(isDiagnosticToken).optional(),
    offset: z.number().int().nonnegative().safe().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
const findingSourceQuerySchema = z
  .object({
    location: z.enum(["context", "scope"]).optional(),
    offset: z.number().int().nonnegative().safe().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
function pageResult<T>(
  items: T[],
  total: number,
  offset: number,
): DiagnosticReviewPage<T> {
  return Object.freeze({
    total,
    offset,
    items: Object.freeze(items),
    nextOffset: offset + items.length < total ? offset + items.length : null,
  });
}
export function getDiagnosticReviewFinding(
  store: CompactDiagnosticReviewFindings,
  index: number,
): DiagnosticReviewFindingEntry {
  const state = findingState(store);
  const { block, id } = findingLocation(state, index);
  return Object.freeze({
    index,
    checkId: block.checkId,
    finding: state.table.read(id) as DiagnosticDeepReadonly<DataFinding>,
  });
}
/** Full ordered evidence, including every finding's source lists. */
export function iterateDiagnosticReviewFindings(
  store: CompactDiagnosticReviewFindings,
): IterableIterator<DiagnosticReviewFindingEntry> {
  const state = findingState(store);
  return (function* () {
    for (let index = 0; index < state.count; index++)
      yield getDiagnosticReviewFinding(store, index);
  })();
}
/** Summary pages never expand source lists, including high-fanout control totals. */
export function pageDiagnosticReviewFindings(
  store: CompactDiagnosticReviewFindings,
  query: DiagnosticReviewFindingQuery = {},
): DiagnosticReviewPage<DiagnosticReviewFindingSummary> {
  const state = findingState(store);
  const issues = diagnosticJsonPreflight(query, "input");
  if (issues.length) throw new DiagnosticValidationError(issues);
  const parsed = findingQuerySchema.safeParse(query);
  if (!parsed.success) compactError("Invalid finding page query");
  const { checkId, offset = 0, limit = 100 } = parsed.data;
  const blocks = state.blocks.filter(
    (block) => checkId === undefined || block.checkId === checkId,
  );
  const total = blocks.reduce((sum, block) => sum + block.ids.length, 0);
  const items: DiagnosticReviewFindingSummary[] = [];
  let position = 0;
  for (const block of blocks) {
    for (
      let local = Math.max(0, offset - position);
      local < block.ids.length && items.length < limit;
      local++
    )
      items.push(
        Object.freeze({
          index: block.start + local,
          checkId: block.checkId,
          finding: state.table.read(
            block.ids[local]!,
            true,
          ) as WithoutSources<DataFinding>,
        }),
      );
    position += block.ids.length;
    if (items.length >= limit) break;
  }
  return pageResult(items, total, offset);
}
export function pageDiagnosticReviewFindingSources(
  store: CompactDiagnosticReviewFindings,
  index: number,
  query: DiagnosticReviewFindingSourceQuery = {},
): DiagnosticReviewPage<DiagnosticSourceLocation> {
  const state = findingState(store);
  const { id } = findingLocation(state, index);
  const issues = diagnosticJsonPreflight(query, "input");
  if (issues.length) throw new DiagnosticValidationError(issues);
  const parsed = findingSourceQuerySchema.safeParse(query);
  if (!parsed.success) compactError("Invalid finding source-page query");
  const { location = "context", offset = 0, limit = 100 } = parsed.data;
  const context = state.table.property(id, "context");
  const parent =
    location === "scope"
      ? state.table.property(context, "reviewScope")
      : context;
  const sources = state.table.property(parent, "sources");
  if (sources === undefined) return pageResult([], 0, offset);
  const count = state.table.length(sources);
  return pageResult(
    Array.from(
      { length: Math.max(0, Math.min(limit, count - offset)) },
      (_, local) =>
        state.table.read(
          state.table.arrayItem(sources, offset + local),
        ) as DiagnosticSourceLocation,
    ),
    count,
    offset,
  );
}

/** Compact owner receipt; identity projection/hash are deliberately deferred. */
export function reviewPreparedDiagnosticDataCompact(
  input: ReviewPreparedDiagnosticDataCompactInput,
): CompactDiagnosticReviewReceipt {
  assertCompactPreparedDiagnosticData(input.prepared);
  const evidence =
    input.evidence === null
      ? null
      : validateDiagnosticReviewEvidence(input.evidence);
  const evaluations = evaluateDiagnosticReviewRulesCompact(input.prepared);
  const table = new CompactDiagnosticJson();
  const blocks: FindingBlock[] = [];
  const checks: CompactDiagnosticReviewCheck[] = [];
  let findingCount = 0;
  const appendFindings = (
    checkId: string,
    values: Iterable<DataFinding>,
  ): FindingBlock => {
    type SourceUnion = readonly number[] | Set<number>;
    interface Pending {
      keyId: number;
      contextSources?: SourceUnion;
      scopeSources?: SourceUnion;
    }
    const pending: Pending[] = [];
    const sources: DiagnosticSourceLocation[] = [];
    const sourceIds = new Map<string, number>();
    const candidates = new Map<string, number | number[]>();
    const mergeSources = (
      previous: SourceUnion | undefined,
      incoming: readonly DiagnosticSourceLocation[] | undefined,
    ): SourceUnion | undefined => {
      if (incoming === undefined) return previous;
      const ids = incoming.map((source) => {
        const key = canonicalJson(source);
        let id = sourceIds.get(key);
        if (id === undefined) {
          id = sources.length;
          sources.push(source);
          sourceIds.set(key, id);
        }
        return id;
      });
      if (previous === undefined) return ids;
      if (
        ids.every((id) =>
          previous instanceof Set ? previous.has(id) : previous.includes(id),
        )
      )
        return previous;
      const union = previous instanceof Set ? previous : new Set(previous);
      for (const id of ids) union.add(id);
      return union;
    };
    const sourceValues = (union: SourceUnion | undefined) =>
      [...(union ?? [])]
        .map((id) => sources[id]!)
        .sort(compareDiagnosticSourceLocations);
    for (const value of values) {
      const finding = normalizeDataFindings([value])[0]!;
      const key = findingMergeKey(finding);
      // Hashes index candidates only. Exact source-free keys decide equality.
      const hash = fnv1a64(key);
      const bucket = candidates.get(hash);
      const possible =
        bucket === undefined
          ? []
          : typeof bucket === "number"
            ? [bucket]
            : bucket;
      const matching = possible.find(
        (index) => canonicalJson(table.read(pending[index]!.keyId)) === key,
      );
      let entry: Pending;
      if (matching === undefined) {
        const index = pending.length;
        entry = { keyId: table.add(findingMergeSkeleton(finding)) };
        pending.push(entry);
        candidates.set(
          hash,
          bucket === undefined ? index : [...possible, index],
        );
      } else {
        entry = pending[matching]!;
        entry.keyId = table.add(findingMergeSkeleton(finding));
      }
      entry.contextSources = mergeSources(
        entry.contextSources,
        finding.context?.sources,
      );
      entry.scopeSources = mergeSources(
        entry.scopeSources,
        finding.context?.reviewScope?.sources,
      );
    }
    // Source-free fields decide nearly every comparison. Expand source IDs only
    // for the contract's final tie-break, never for each ordinary comparison.
    pending.sort(
      (a, b) =>
        compareDataFindings(
          table.read(a.keyId) as DataFinding,
          table.read(b.keyId) as DataFinding,
        ) ||
        compareSourceArrays(
          sourceValues(a.contextSources),
          sourceValues(b.contextSources),
        ),
    );
    const ids = pending.map((entry) => {
      const skeleton = table.read(entry.keyId) as DataFinding;
      if (skeleton.context === undefined) return table.add(skeleton);
      const context: DataFindingContext = { ...skeleton.context };
      if (entry.contextSources === undefined) delete context.sources;
      else context.sources = sourceValues(entry.contextSources);
      if (context.reviewScope !== undefined)
        context.reviewScope = {
          ...context.reviewScope,
          sources: sourceValues(entry.scopeSources),
        };
      // Each final source list is encoded once, after every duplicate was merged.
      return table.add({ ...skeleton, context });
    });
    const block = { checkId, start: findingCount, ids: Uint32Array.from(ids) };
    findingCount += ids.length;
    blocks.push(block);
    return block;
  };
  for (const check of structuralChecks(input.prepared, evidence)) {
    const block = appendFindings(check.id, check.findings);
    checks.push(
      Object.freeze({
        id: check.id,
        description: check.description,
        status: check.status,
        details: Object.freeze([...check.details]),
        findingCount: block.ids.length,
      }),
    );
  }
  for (const [
    ruleIndex,
    rule,
  ] of input.prepared.definition.definition.reviewRules.entries()) {
    const range = evaluations.rules[ruleIndex]!;
    const counts = range.summary;
    const status =
      counts.fail > 0
        ? "fail"
        : counts.warning > 0
          ? "warning"
          : counts.notEvaluated > 0
            ? "not-evaluated"
            : "pass";
    const values = function* (): IterableIterator<DataFinding> {
      if (counts.pass === range.count) return;
      for (
        let index = range.start;
        index < range.start + range.count;
        index++
      ) {
        if (
          getDiagnosticReviewEvaluationSummary(evaluations, index)
            .effectiveStatus === "pass"
        )
          continue;
        yield* evaluationFindings(
          getDiagnosticReviewEvaluation(evaluations, index),
          rule,
        );
      }
    };
    const block = appendFindings(rule.id, values());
    const details = Array.from(
      block.ids.subarray(0, 20),
      (id) => table.read(table.property(id, "message")!) as string,
    );
    checks.push(
      Object.freeze({
        id: rule.id,
        description: rule.description,
        status,
        details: Object.freeze(details),
        findingCount: block.ids.length,
      }),
    );
  }
  table.seal();
  const findings = Object.freeze({
    count: findingCount,
  }) as CompactDiagnosticReviewFindings;
  findingStates.set(findings, { table, blocks, count: findingCount });
  const summary = summarizeDataChecks(
    checks.map((check) => ({
      ...check,
      details: [...check.details],
      findings: [],
    })),
  ).summary;
  const receipt = Object.freeze({
    definitionIntegrity: input.prepared.definition.definitionIntegrity,
    report: Object.freeze({
      checks: Object.freeze(checks),
      summary: Object.freeze(summary),
    }),
    evaluations,
    findings,
    evidence,
  });
  compactReceipts.add(receipt);
  compactReceiptPreparations.set(receipt, input.prepared);
  return receipt;
}

/** Exact legacy review identity, available only from an authentic immutable owner. */
export function getCompactDiagnosticReviewReceiptIdentityDocument(
  receipt: CompactDiagnosticReviewReceipt,
): DiagnosticIdentityDocument {
  assertCompactDiagnosticReviewReceipt(receipt);
  const state = findingState(receipt.findings);
  const prepared = compactReceiptPreparations.get(receipt)!;
  return createDiagnosticIdentityObject({
    definitionIntegrity: createDiagnosticIdentityValue(
      receipt.definitionIntegrity,
    ),
    preparationFingerprint: createDiagnosticIdentityValue(
      getCompactPreparedDiagnosticDataFingerprint(prepared),
    ),
    evidence: createDiagnosticIdentityValue(receipt.evidence),
    checks: createDiagnosticIdentityArray(
      receipt.report.checks.length,
      (index) => {
        const check = receipt.report.checks[index]!;
        const block = state.blocks[index]!;
        return createDiagnosticIdentityObject({
          id: createDiagnosticIdentityValue(check.id),
          status: createDiagnosticIdentityValue(check.status),
          findings: createDiagnosticIdentityArray(block.ids.length, (local) =>
            state.table.identityDocument(block.ids[local]!),
          ),
        });
      },
    ),
    summary: createDiagnosticIdentityValue(receipt.report.summary),
    evaluations: getCompactDiagnosticReviewEvaluationsIdentityDocument(
      receipt.evaluations,
    ),
  });
}
/** Explicit evidence operation; caches only the small immutable-owner fingerprint. */
export function getCompactDiagnosticReviewReceiptFingerprint(
  receipt: CompactDiagnosticReviewReceipt,
): string {
  assertCompactDiagnosticReviewReceipt(receipt);
  let fingerprint = compactReceiptFingerprints.get(receipt);
  if (fingerprint === undefined) {
    fingerprint = fingerprintDiagnosticIdentity(
      getCompactDiagnosticReviewReceiptIdentityDocument(receipt),
      { kind: "diagnostic-review-report", property: "review" },
    );
    compactReceiptFingerprints.set(receipt, fingerprint);
  }
  return fingerprint;
}
