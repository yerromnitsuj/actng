import type {
  CompiledDiagnosticDefinition,
  DiagnosticPeriodAxis,
} from "./diagnosticDefinitions.js";
import { assertCompiledDiagnosticDefinition } from "./diagnosticDefinitions.js";
import {
  normalizeDiagnosticPeriodWithAxis,
  type DiagnosticPeriodSide,
} from "./diagnosticPeriodAxis.js";
import { DiagnosticValidationError } from "./types.js";

export interface DiagnosticNormalizedPeriod {
  readonly label: string;
  readonly coordinate: number;
}

function normalizeWithAxis(
  axis: DiagnosticPeriodAxis,
  side: DiagnosticPeriodSide,
  label: string,
): DiagnosticNormalizedPeriod {
  const normalized = normalizeDiagnosticPeriodWithAxis(axis, side, label);
  if (!normalized)
    throw new DiagnosticValidationError([
      {
        domain: "input",
        code: "invalid-period",
        path: `$.${side}`,
        message:
          axis.kind === "calendar"
            ? `Invalid ${side === "origin" ? axis.originCadence : axis.valuationCadence} ${side} label ${JSON.stringify(label)}`
            : `Unknown ordered-axis ${side} label ${JSON.stringify(label)}`,
      },
    ]);
  return Object.freeze(normalized);
}

export function normalizeDiagnosticPeriod(
  definition: CompiledDiagnosticDefinition,
  side: DiagnosticPeriodSide,
  label: string,
): DiagnosticNormalizedPeriod {
  assertCompiledDiagnosticDefinition(definition);
  return normalizeWithAxis(
    definition.definition.periodAxis as DiagnosticPeriodAxis,
    side,
    label,
  );
}

export function diagnosticDevelopmentAge(
  definition: CompiledDiagnosticDefinition,
  origin: string,
  valuation: string,
): {
  readonly origin: DiagnosticNormalizedPeriod;
  readonly valuation: DiagnosticNormalizedPeriod;
  readonly developmentAge: number;
  readonly ageUnit: string;
} {
  const normalizedOrigin = normalizeDiagnosticPeriod(
    definition,
    "origin",
    origin,
  );
  const normalizedValuation = normalizeDiagnosticPeriod(
    definition,
    "valuation",
    valuation,
  );
  const axis = definition.definition.periodAxis;
  const developmentAge =
    normalizedValuation.coordinate -
    normalizedOrigin.coordinate +
    axis.ageOffset;
  if (!Number.isSafeInteger(developmentAge) || developmentAge < 0)
    throw new DiagnosticValidationError([
      {
        domain: "input",
        code: "invalid-period",
        path: "$.valuation",
        message:
          "Valuation period precedes origin period or development age is unsafe",
      },
    ]);
  return Object.freeze({
    origin: normalizedOrigin,
    valuation: normalizedValuation,
    developmentAge,
    ageUnit: axis.ageUnit,
  });
}

export function compareDiagnosticPeriods(
  left: DiagnosticNormalizedPeriod,
  right: DiagnosticNormalizedPeriod,
): number {
  return (
    left.coordinate - right.coordinate ||
    (left.label < right.label ? -1 : left.label > right.label ? 1 : 0)
  );
}
