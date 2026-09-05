import type {
  DiagnosticPeriodAxis,
  DiagnosticSourceLocation,
} from "./diagnosticDefinitions.js";
import { canonicalJson } from "./canonical.js";
import { normalizeDiagnosticSourceLocations } from "./diagnosticSourceOrdering.js";
import { compareDiagnosticSourceLocations } from "./diagnosticSourceOrdering.js";
import { compareDiagnosticIdentityValues } from "./diagnosticOrdering.js";
import { normalizeDiagnosticPeriodWithAxis } from "./diagnosticPeriodAxis.js";
import { validateDiagnosticPeriodAxisInput } from "./diagnosticDefinitions.js";
import {
  DiagnosticValidationError,
  type DiagnosticValidationIssue,
} from "./types.js";
import {
  diagnosticJsonPreflight,
  diagnosticRecord,
  hasDiagnosticOwn,
  isDiagnosticPlainRecord,
  isDiagnosticToken,
  snapshotDiagnosticJson,
  MAX_DIAGNOSTIC_JSON_DEPTH,
} from "./diagnosticRuntime.js";

// Bound the collection separately from each untrusted record. The generic
// million-node JSON cap otherwise rejects legitimate files at ~71k–100k rows,
// depending only on how much source provenance each observation carries.
const MAX_EXPOSURE_OBSERVATIONS = 250_000;

// JSON enumeration skips hidden properties, but the strict exposure schema
// reads recognized own fields. Refuse hidden accessors before those reads.
function hiddenExposureAccessorIssues(
  value: unknown,
  path: string,
): DiagnosticValidationIssue[] {
  if (!isDiagnosticPlainRecord(value)) return [];
  const issues: DiagnosticValidationIssue[] = [];
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable && !("value" in descriptor))
      issues.push({
        domain: "input",
        code: "invalid-json-value",
        path: propertyPath(path, key),
        message: "JSON objects may contain only data properties",
      });
  }
  return issues;
}

function exposureCollectionPreflight(
  value: unknown,
): readonly DiagnosticValidationIssue[] {
  if (!Array.isArray(value)) return diagnosticJsonPreflight(value, "input");
  if (Object.getPrototypeOf(value) !== Array.prototype)
    return [
      {
        domain: "input",
        code: "invalid-json-value",
        path: "$",
        message: "Value must use a plain object or array prototype",
      },
    ];
  if (value.length > MAX_EXPOSURE_OBSERVATIONS)
    return [
      {
        domain: "input",
        code: "expression-limit",
        path: "$",
        message: `Exposure observation count exceeds ${MAX_EXPOSURE_OBSERVATIONS}`,
      },
    ];
  const issues: DiagnosticValidationIssue[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const index = typeof key === "string" ? Number(key) : Number.NaN;
    if (
      Number.isInteger(index) &&
      index >= 0 &&
      index < value.length &&
      String(index) === key
    )
      continue;
    issues.push({
      domain: "input",
      code: "invalid-json-value",
      path: typeof key === "symbol" ? "$" : propertyPath("$", key),
      message: "JSON arrays may contain only indexed data properties",
    });
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) {
      issues.push({
        domain: "input",
        code: "invalid-json-value",
        path: `$[${index}]`,
        message: "JSON arrays may contain only indexed data properties",
      });
      continue;
    }
    issues.push(
      ...hiddenExposureAccessorIssues(descriptor.value, `$[${index}]`),
    );
    if (isDiagnosticPlainRecord(descriptor.value)) {
      const source = Object.getOwnPropertyDescriptor(
        descriptor.value,
        "source",
      );
      if (source && "value" in source)
        issues.push(
          ...hiddenExposureAccessorIssues(source.value, `$[${index}].source`),
        );
    }
    // The outer collection used to occupy depth 1: keep the exact depth
    // contract, and retain the default million-node guard for each record.
    for (const issue of diagnosticJsonPreflight(descriptor.value, "input", {
      maxDepth: MAX_DIAGNOSTIC_JSON_DEPTH - 1,
    }))
      issues.push({ ...issue, path: `$[${index}]${issue.path.slice(1)}` });
  }
  return issues;
}

/** Only for new SDK-owned objects whose leaves have already been validated. */
function freezeExposureRecord<T extends object>(value: T): T {
  return Object.freeze(Object.assign(diagnosticRecord<unknown>(), value)) as T;
}

export interface DiagnosticExposureObservation {
  readonly key: string;
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation?: string;
  readonly measureId: string;
  readonly value: number | null;
  readonly complete: boolean;
  readonly source?: DiagnosticSourceLocation;
}

export type DiagnosticAuditedNumericValue =
  | { readonly status: "observed"; readonly value: number }
  | { readonly status: "missing"; readonly value: null }
  | {
      readonly status: "non-finite";
      readonly value: null;
      readonly nonFiniteKind: "nan" | "positive-infinity" | "negative-infinity";
    };

export interface DiagnosticExposureAuditObservation {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation?: string;
  readonly value: DiagnosticAuditedNumericValue;
  readonly complete: boolean;
  readonly source?: DiagnosticSourceLocation;
}

export type ReconciledDiagnosticExposure =
  | {
      readonly measureId: string;
      readonly key: string;
      readonly status: "valid";
      readonly sourceGroup: string;
      readonly origin: string;
      readonly valuation?: string;
      readonly value: number;
      readonly deduplicated: number;
      readonly sources: readonly DiagnosticSourceLocation[];
    }
  | {
      readonly measureId: string;
      readonly key: string;
      readonly status: "invalid";
      readonly issues: readonly (
        "missing" | "incomplete" | "non-finite" | "duplicate" | "conflict"
      )[];
      readonly value: null;
      readonly observations: readonly DiagnosticExposureAuditObservation[];
    };

export function auditDiagnosticNumber(
  value: number | null,
): DiagnosticAuditedNumericValue {
  if (value !== null && typeof value !== "number")
    throw new DiagnosticValidationError([
      {
        domain: "input",
        code: "invalid-type",
        path: "$",
        message: "Numeric input must be a number or null",
      },
    ]);
  if (value === null) return Object.freeze({ status: "missing", value: null });
  if (!Number.isFinite(value))
    return Object.freeze({
      status: "non-finite",
      value: null,
      nonFiniteKind: Number.isNaN(value)
        ? "nan"
        : value > 0
          ? "positive-infinity"
          : "negative-infinity",
    });
  return Object.freeze({
    status: "observed",
    value: Object.is(value, -0) ? 0 : value,
  });
}

function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function validateExposureArguments(
  observations: unknown,
  timingByMeasure: unknown,
  periodAxis: DiagnosticPeriodAxis | undefined,
): void {
  // Nonfinite exposure amounts are supported audited inputs. They are the
  // only non-JSON numbers permitted here; metadata still must be finite.
  const issues: DiagnosticValidationIssue[] = [
    ...exposureCollectionPreflight(observations)
      .filter(
        (issue) =>
          !(
            issue.code === "invalid-json-value" &&
            issue.message === "JSON numeric value must be finite" &&
            /^\$\[\d+\]\.value$/.test(issue.path)
          ),
      )
      .map((issue) => ({
        ...issue,
        path: `$.observations${issue.path.slice(1)}`,
      })),
    ...diagnosticJsonPreflight(timingByMeasure, "configuration").map(
      (issue) => ({
        ...issue,
        path: `$.timingByMeasure${issue.path.slice(1)}`,
      }),
    ),
    ...(periodAxis === undefined
      ? []
      : validateDiagnosticPeriodAxisInput(periodAxis)),
  ];
  if (issues.length > 0) throw new DiagnosticValidationError(issues);
  const issue = (
    domain: DiagnosticValidationIssue["domain"],
    code: DiagnosticValidationIssue["code"],
    path: string,
    message: string,
  ) => issues.push({ domain, code, path, message });
  const token = (
    value: unknown,
    path: string,
    domain: DiagnosticValidationIssue["domain"] = "input",
  ) => {
    if (!isDiagnosticToken(value))
      issue(
        domain,
        typeof value === "string" ? "invalid-string" : "invalid-type",
        path,
        "Expected a nonempty token with valid Unicode and no U+0000",
      );
  };
  const exactKeys = (
    value: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
  ) => {
    for (const key of Object.keys(value))
      if (!allowed.includes(key))
        issue(
          "input",
          "unknown-key",
          propertyPath(path, key),
          `Unknown key ${key}`,
        );
  };
  if (!Array.isArray(observations))
    issue(
      "input",
      "invalid-type",
      "$.observations",
      "Exposure observations must be an array",
    );
  if (!isDiagnosticPlainRecord(timingByMeasure))
    issue(
      "configuration",
      "invalid-type",
      "$.timingByMeasure",
      "Exposure timings must be a plain record",
    );
  if (issues.length > 0) throw new DiagnosticValidationError(issues);
  const timings = timingByMeasure as Record<string, unknown>;
  for (const [measureId, timing] of Object.entries(timings)) {
    const path = propertyPath("$.timingByMeasure", measureId);
    token(measureId, path, "configuration");
    if (timing !== "origin-static" && timing !== "valuation-specific")
      issue(
        "configuration",
        "invalid-type",
        path,
        "Exposure timing must be origin-static or valuation-specific",
      );
  }
  for (const [index, observation] of (observations as unknown[]).entries()) {
    const path = `$.observations[${index}]`;
    if (!isDiagnosticPlainRecord(observation)) {
      issue(
        "input",
        "invalid-type",
        path,
        "Exposure observation must be an object",
      );
      continue;
    }
    exactKeys(
      observation,
      [
        "key",
        "sourceGroup",
        "origin",
        "valuation",
        "measureId",
        "value",
        "complete",
        "source",
      ],
      path,
    );
    for (const key of ["key", "sourceGroup", "origin", "measureId"])
      token(observation[key], `${path}.${key}`);
    if (hasDiagnosticOwn(observation, "valuation"))
      token(observation.valuation, `${path}.valuation`);
    if (typeof observation.complete !== "boolean")
      issue(
        "input",
        "invalid-type",
        `${path}.complete`,
        "Exposure completeness must be boolean",
      );
    if (observation.value !== null && typeof observation.value !== "number")
      issue(
        "input",
        "invalid-type",
        `${path}.value`,
        "Exposure value must be a number or null",
      );
    if (isDiagnosticToken(observation.measureId)) {
      if (!hasDiagnosticOwn(timings, observation.measureId))
        issue(
          "configuration",
          "unknown-reference",
          `${path}.measureId`,
          "Exposure measure has no declared timing",
        );
      else if (
        timings[observation.measureId] === "valuation-specific" &&
        !hasDiagnosticOwn(observation, "valuation")
      )
        issue(
          "input",
          "missing-required",
          `${path}.valuation`,
          "Valuation-specific exposure requires a valuation",
        );
    }
    if (hasDiagnosticOwn(observation, "source")) {
      const source = observation.source;
      if (!isDiagnosticPlainRecord(source))
        issue(
          "input",
          "invalid-type",
          `${path}.source`,
          "Source location must be an object",
        );
      else {
        exactKeys(
          source,
          [
            "artifactId",
            "sourceFile",
            "sourceSheet",
            "sourceRow",
            "sourceCell",
          ],
          `${path}.source`,
        );
        token(source.artifactId, `${path}.source.artifactId`);
        for (const key of ["sourceFile", "sourceSheet", "sourceCell"])
          if (hasDiagnosticOwn(source, key))
            token(source[key], `${path}.source.${key}`);
        if (
          hasDiagnosticOwn(source, "sourceRow") &&
          (typeof source.sourceRow !== "number" ||
            !Number.isSafeInteger(source.sourceRow) ||
            source.sourceRow < 0)
        )
          issue(
            "input",
            "invalid-number",
            `${path}.source.sourceRow`,
            "Source row must be a nonnegative safe integer",
          );
      }
    }
    if (periodAxis !== undefined)
      for (const side of ["origin", "valuation"] as const) {
        if (
          isDiagnosticToken(observation[side]) &&
          normalizeDiagnosticPeriodWithAxis(
            periodAxis,
            side,
            observation[side],
          ) === null
        )
          issue(
            "input",
            "invalid-period",
            `${path}.${side}`,
            `Unknown ${side} period ${JSON.stringify(observation[side])}`,
          );
      }
  }
  if (issues.length > 0) throw new DiagnosticValidationError(issues);
}

function equalAudit(
  left: DiagnosticExposureAuditObservation,
  right: DiagnosticExposureAuditObservation,
): boolean {
  return (
    left.sourceGroup === right.sourceGroup &&
    left.origin === right.origin &&
    left.complete === right.complete &&
    JSON.stringify(left.value) === JSON.stringify(right.value)
  );
}

export function reconcileDiagnosticExposures(
  observations: readonly DiagnosticExposureObservation[],
  timingByMeasure: Readonly<
    Record<string, "origin-static" | "valuation-specific">
  >,
  periodAxis?: DiagnosticPeriodAxis,
): readonly ReconciledDiagnosticExposure[] {
  validateExposureArguments(observations, timingByMeasure, periodAxis);
  const periodValue = (
    role: "origin" | "valuation",
    label: string | undefined,
  ) =>
    label === undefined || periodAxis === undefined
      ? label
      : (normalizeDiagnosticPeriodWithAxis(periodAxis, role, label)
          ?.coordinate ?? label);
  const observationOrder = (
    left: DiagnosticExposureAuditObservation,
    right: DiagnosticExposureAuditObservation,
  ) =>
    compareDiagnosticIdentityValues(
      [
        left.sourceGroup,
        periodValue("origin", left.origin),
        periodValue("valuation", left.valuation),
        left.value.status,
        left.value.status === "non-finite"
          ? left.value.nonFiniteKind
          : left.value.value,
        left.complete,
      ],
      [
        right.sourceGroup,
        periodValue("origin", right.origin),
        periodValue("valuation", right.valuation),
        right.value.status,
        right.value.status === "non-finite"
          ? right.value.nonFiniteKind
          : right.value.value,
        right.complete,
      ],
    ) ||
    (left.source === undefined || right.source === undefined
      ? compareDiagnosticIdentityValues(left.source, right.source)
      : compareDiagnosticSourceLocations(left.source, right.source));
  const cohorts = new Map<string, DiagnosticExposureObservation[]>();
  for (const observation of observations) {
    const timing = hasDiagnosticOwn(timingByMeasure, observation.measureId)
      ? timingByMeasure[observation.measureId]
      : undefined;
    const identity = canonicalJson(
      timing === "valuation-specific"
        ? [
            observation.measureId,
            observation.key,
            observation.valuation ?? null,
          ]
        : [observation.measureId, observation.key],
    );
    const cohort = cohorts.get(identity) ?? [];
    cohort.push(observation);
    cohorts.set(identity, cohort);
  }
  return Object.freeze(
    [...cohorts.values()]
      .map((cohort): ReconciledDiagnosticExposure => {
        const first = cohort[0]!;
        const timing = hasDiagnosticOwn(timingByMeasure, first.measureId)
          ? timingByMeasure[first.measureId]
          : undefined;
        const audited = cohort
          .map((item): DiagnosticExposureAuditObservation =>
            snapshotDiagnosticJson({
              sourceGroup: item.sourceGroup,
              origin: item.origin,
              ...(item.valuation === undefined
                ? {}
                : { valuation: item.valuation }),
              value: auditDiagnosticNumber(item.value),
              complete: item.complete,
              ...(item.source === undefined
                ? {}
                : { source: Object.freeze({ ...item.source }) }),
            }),
          )
          .sort(observationOrder);
        const issues: (
          "missing" | "incomplete" | "non-finite" | "duplicate" | "conflict"
        )[] = [];
        if (audited.some((item) => item.value.status === "missing"))
          issues.push("missing");
        if (audited.some((item) => !item.complete)) issues.push("incomplete");
        if (audited.some((item) => item.value.status === "non-finite"))
          issues.push("non-finite");
        if (timing === "valuation-specific" && audited.length > 1)
          issues.push("duplicate");
        if (audited.slice(1).some((item) => !equalAudit(audited[0]!, item)))
          issues.push("conflict");
        const validStaticCopies =
          timing === "origin-static" && issues.length === 0;
        if (issues.length > 0)
          return freezeExposureRecord({
            measureId: first.measureId,
            key: first.key,
            status: "invalid",
            issues: Object.freeze(issues),
            value: null,
            observations: Object.freeze(audited),
          });
        const value = audited[0]!.value;
        if (value.status !== "observed")
          throw new Error("unreachable invalid exposure state");
        const sources = normalizeDiagnosticSourceLocations(
          audited.map((item) => item.source),
        ).map((source) => snapshotDiagnosticJson(source));
        return freezeExposureRecord({
          measureId: first.measureId,
          key: first.key,
          status: "valid",
          sourceGroup: first.sourceGroup,
          origin: first.origin,
          ...(timing === "valuation-specific"
            ? { valuation: first.valuation! }
            : {}),
          value: value.value,
          deduplicated: validStaticCopies ? audited.length - 1 : 0,
          sources: Object.freeze(sources),
        });
      })
      .sort((left, right) => {
        return (
          compareDiagnosticIdentityValues(
            [
              left.measureId,
              left.key,
              left.status,
              left.status === "invalid" ? left.issues : undefined,
            ],
            [
              right.measureId,
              right.key,
              right.status,
              right.status === "invalid" ? right.issues : undefined,
            ],
          ) || compareDiagnosticIdentityValues(left, right)
        );
      }),
  );
}
