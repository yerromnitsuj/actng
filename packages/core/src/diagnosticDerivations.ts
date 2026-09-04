import {
  assertCompiledDiagnosticDefinition,
  getCompiledDiagnosticDefinitionInternals,
  type CompiledDiagnosticDefinition,
} from "./diagnosticDefinitions.js";
import type { DiagnosticClaimExpression } from "./diagnosticExpressions.js";
import type { DiagnosticExpressionOverflow } from "./diagnosticRules.js";
import {
  DiagnosticValidationError,
  type DiagnosticValidationIssue,
} from "./types.js";
import {
  diagnosticRecord,
  hasDiagnosticOwn,
  isDiagnosticPlainRecord,
  normalizeDiagnosticNumber,
} from "./diagnosticRuntime.js";

export type DiagnosticMeasureValues = Readonly<Record<string, number | null>>;

export type DiagnosticRowWithDerivedMeasures<
  TRow extends { measures: DiagnosticMeasureValues },
> = Omit<TRow, "measures"> & { readonly measures: DiagnosticMeasureValues };

export type DiagnosticDerivedValueAudit =
  | { readonly status: "observed"; readonly value: number }
  | { readonly status: "missing"; readonly value: null }
  | {
      readonly status: "non-finite";
      readonly value: null;
      readonly nonFiniteKind: "nan" | "positive-infinity" | "negative-infinity";
    };

export interface DiagnosticDerivedRowAudit<
  TRow extends { measures: DiagnosticMeasureValues },
> {
  readonly row: DiagnosticRowWithDerivedMeasures<TRow>;
  readonly derived: Readonly<Record<string, DiagnosticDerivedValueAudit>>;
  readonly expressionOverflows: Readonly<
    Record<string, readonly DiagnosticExpressionOverflow[]>
  >;
}

interface ClaimExpressionAudit {
  readonly state: DiagnosticDerivedValueAudit;
  readonly overflows: readonly DiagnosticExpressionOverflow[];
}

function nonFiniteKind(
  value: number,
): "nan" | "positive-infinity" | "negative-infinity" {
  return Number.isNaN(value)
    ? "nan"
    : value > 0
      ? "positive-infinity"
      : "negative-infinity";
}

function mergeNonFiniteKinds(
  values: readonly ("nan" | "positive-infinity" | "negative-infinity")[],
): "nan" | "positive-infinity" | "negative-infinity" {
  const unique = new Set(values);
  return unique.size === 1 ? values[0]! : "nan";
}

function neumaier(values: readonly number[]): {
  readonly value: number | null;
  readonly nonFiniteKind?: "nan" | "positive-infinity" | "negative-infinity";
} {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const next = sum + value;
    if (!Number.isFinite(next))
      return { value: null, nonFiniteKind: nonFiniteKind(next) };
    const nextCorrection =
      correction +
      (Math.abs(sum) >= Math.abs(value)
        ? sum - next + value
        : value - next + sum);
    if (!Number.isFinite(nextCorrection))
      return { value: null, nonFiniteKind: nonFiniteKind(nextCorrection) };
    correction = nextCorrection;
    sum = next;
  }
  const result = sum + correction;
  return Number.isFinite(result)
    ? { value: Object.is(result, -0) ? 0 : result }
    : { value: null, nonFiniteKind: nonFiniteKind(result) };
}

function evaluateClaimExpressionAudit(
  expression: DiagnosticClaimExpression,
  states: Readonly<Record<string, DiagnosticDerivedValueAudit>>,
  path: string,
): ClaimExpressionAudit {
  if (expression.op === "measure")
    return {
      state: hasDiagnosticOwn(states, expression.measureId)
        ? states[expression.measureId]!
        : { status: "missing", value: null },
      overflows: [],
    };
  if (expression.op === "claim-layer") {
    const source = hasDiagnosticOwn(states, expression.measureId)
      ? states[expression.measureId]!
      : { status: "missing" as const, value: null };
    if (source.status !== "observed") return { state: source, overflows: [] };
    const value =
      source.value <= expression.attachment
        ? 0
        : expression.limit === null
          ? source.value - expression.attachment
          : Math.min(source.value - expression.attachment, expression.limit);
    if (Number.isFinite(value))
      return {
        state: { status: "observed", value: normalizeDiagnosticNumber(value) },
        overflows: [],
      };
    return {
      state: {
        status: "non-finite",
        value: null,
        nonFiniteKind: nonFiniteKind(value),
      },
      overflows: [{ expressionPath: path, sources: [] }],
    };
  }
  const children =
    expression.op === "add"
      ? expression.terms.map((term, index) =>
          evaluateClaimExpressionAudit(term, states, `${path}/terms/${index}`),
        )
      : [
          evaluateClaimExpressionAudit(expression.left, states, `${path}/left`),
          evaluateClaimExpressionAudit(
            expression.right,
            states,
            `${path}/right`,
          ),
        ];
  const overflows = children.flatMap((child) => child.overflows);
  const nonFinite = children.flatMap((child) =>
    child.state.status === "non-finite" ? [child.state.nonFiniteKind] : [],
  );
  if (nonFinite.length > 0)
    return {
      state: {
        status: "non-finite",
        value: null,
        nonFiniteKind: mergeNonFiniteKinds(nonFinite),
      },
      overflows,
    };
  if (children.some((child) => child.state.status === "missing"))
    return { state: { status: "missing", value: null }, overflows };
  const values = children.map((child) => child.state.value!);
  const calculation =
    expression.op === "add"
      ? neumaier(values)
      : { value: values[0]! - values[1]! };
  if (calculation.value !== null && Number.isFinite(calculation.value)) {
    return {
      state: {
        status: "observed",
        value: normalizeDiagnosticNumber(calculation.value),
      },
      overflows,
    };
  }
  const failedKind =
    calculation.nonFiniteKind ?? nonFiniteKind(calculation.value ?? Number.NaN);
  return {
    state: { status: "non-finite", value: null, nonFiniteKind: failedKind },
    overflows: [...overflows, { expressionPath: path, sources: [] }],
  };
}

function validateRows<TRow extends { measures: DiagnosticMeasureValues }>(
  rows: readonly TRow[],
  definition: CompiledDiagnosticDefinition,
): void {
  const internals = getCompiledDiagnosticDefinitionInternals(definition);
  const issues: DiagnosticValidationIssue[] = [];
  if (definition.definition.lossRowGrain !== "claim") {
    issues.push({
      domain: "input",
      code: "invalid-input-relationship",
      path: "$.definition.lossRowGrain",
      message: "Claim derivation requires a claim-grain definition",
    });
  }
  if (!Array.isArray(rows)) {
    issues.push({
      domain: "input",
      code: "invalid-type",
      path: "$.rows",
      message: "Claim rows must be an array",
    });
  } else {
    rows.forEach((row, rowIndex) => {
      const measures = row?.measures;
      if (!isDiagnosticPlainRecord(measures)) {
        issues.push({
          domain: "input",
          code: "invalid-type",
          path: `$.rows[${rowIndex}].measures`,
          message: "Row measures must be a plain record",
        });
        return;
      }
      for (const [measureId, value] of Object.entries(measures)) {
        const measure = internals.measuresById.get(measureId);
        const path = `$.rows[${rowIndex}].measures[${JSON.stringify(measureId)}]`;
        if (!measure)
          issues.push({
            domain: "input",
            code: "unknown-reference",
            path,
            message: `Unknown measure ${measureId}`,
          });
        else if (measure.source !== "loss")
          issues.push({
            domain: "input",
            code: "invalid-input-relationship",
            path,
            message: `Caller rows cannot supply ${measure.source} measure ${measureId}`,
          });
        if (value !== null && typeof value !== "number")
          issues.push({
            domain: "input",
            code: "invalid-type",
            path,
            message: "Measure value must be a number or null",
          });
      }
    });
  }
  if (issues.length > 0) throw new DiagnosticValidationError(issues);
}

/** @internal Shared with diagnostic preparation to preserve derivation quality. */
export function deriveDiagnosticClaimMeasuresWithAudit<
  TRow extends { measures: DiagnosticMeasureValues },
>(
  rows: readonly TRow[],
  definition: CompiledDiagnosticDefinition,
): readonly DiagnosticDerivedRowAudit<TRow>[] {
  assertCompiledDiagnosticDefinition(definition);
  validateRows(rows, definition);
  const internals = getCompiledDiagnosticDefinitionInternals(definition);
  const plan = [...internals.derivationsByOutputMeasureId.values()];
  const normalizedIndex = new Map(
    definition.definition.derivedMeasures.map((derivation, index) => [
      derivation.outputMeasureId,
      index,
    ]),
  );
  return Object.freeze(
    rows.map((row) => {
      const measures = diagnosticRecord<number | null>();
      const states = diagnosticRecord<DiagnosticDerivedValueAudit>();
      for (const [id, value] of Object.entries(row.measures)) {
        measures[id] = value;
        states[id] =
          value === null || value === undefined
            ? { status: "missing" as const, value: null }
            : Number.isFinite(value)
              ? {
                  status: "observed" as const,
                  value: normalizeDiagnosticNumber(value),
                }
              : {
                  status: "non-finite" as const,
                  value: null,
                  nonFiniteKind: nonFiniteKind(value),
                };
      }
      const derived = diagnosticRecord<DiagnosticDerivedValueAudit>();
      const expressionOverflows =
        diagnosticRecord<readonly DiagnosticExpressionOverflow[]>();
      for (const derivation of plan) {
        const index = normalizedIndex.get(derivation.outputMeasureId)!;
        const evaluated = evaluateClaimExpressionAudit(
          derivation.expression,
          states,
          `/derivedMeasures/${index}/expression`,
        );
        states[derivation.outputMeasureId] = evaluated.state;
        derived[derivation.outputMeasureId] = evaluated.state;
        expressionOverflows[derivation.outputMeasureId] = Object.freeze([
          ...evaluated.overflows,
        ]);
        measures[derivation.outputMeasureId] = evaluated.state.value;
      }
      return Object.freeze({
        row: Object.freeze({
          ...row,
          measures: Object.freeze(measures),
        }) as DiagnosticRowWithDerivedMeasures<TRow>,
        derived: Object.freeze(derived),
        expressionOverflows: Object.freeze(expressionOverflows),
      });
    }),
  );
}

/** Materializes compiler-approved claim-level measures without mutating caller rows. */
export function deriveDiagnosticClaimMeasures<
  TRow extends { measures: DiagnosticMeasureValues },
>(
  rows: readonly TRow[],
  definition: CompiledDiagnosticDefinition,
): readonly DiagnosticRowWithDerivedMeasures<TRow>[] {
  assertCompiledDiagnosticDefinition(definition);
  return Object.freeze(
    deriveDiagnosticClaimMeasuresWithAudit(rows, definition).map(
      (item) => item.row,
    ),
  );
}
