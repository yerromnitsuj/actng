import type { CompiledDiagnosticDefinition, DiagnosticPeriodAxis } from "./diagnosticDefinitions.js";
import { assertCompiledDiagnosticDefinition } from "./diagnosticDefinitions.js";
import { DiagnosticValidationError } from "./types.js";

export interface DiagnosticNormalizedPeriod {
  readonly label: string;
  readonly coordinate: number;
}

type PeriodSide = "origin" | "valuation";

function calendarCoordinate(
  label: string,
  cadence: "month" | "quarter" | "year",
  anchor: "start" | "end",
): number | null {
  let year: number;
  let start: number;
  let width: number;
  if (cadence === "year") {
    const match = /^(\d{4})$/.exec(label);
    if (!match) return null;
    year = Number(match[1]);
    start = year * 12;
    width = 12;
  } else if (cadence === "month") {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(label);
    if (!match) return null;
    year = Number(match[1]);
    start = year * 12 + Number(match[2]) - 1;
    width = 1;
  } else {
    const compact = /^(\d{4})Q([1-4])$/.exec(label);
    const hyphenated = /^(\d{4})-Q([1-4])$/.exec(label);
    const first = /^Q([1-4]) (\d{4})$/.exec(label);
    const match = compact ?? hyphenated ?? first;
    if (!match) return null;
    const quarterFirst = match === first;
    year = Number(match[quarterFirst ? 2 : 1]);
    const quarter = Number(match[quarterFirst ? 1 : 2]);
    start = year * 12 + (quarter - 1) * 3;
    width = 3;
  }
  if (year < 1 || year > 9999) return null;
  return start + (anchor === "end" ? width : 0);
}

function normalizeWithAxis(
  axis: DiagnosticPeriodAxis,
  side: PeriodSide,
  label: string,
): DiagnosticNormalizedPeriod {
  if (axis.kind === "calendar") {
    const cadence = side === "origin" ? axis.originCadence : axis.valuationCadence;
    const anchor = side === "origin" ? axis.originAnchor : axis.valuationAnchor;
    const coordinate = calendarCoordinate(label, cadence, anchor);
    if (coordinate === null) throw new DiagnosticValidationError([{
      domain: "input",
      code: "invalid-period",
      path: `$.${side}`,
      message: `Invalid ${cadence} ${side} label ${JSON.stringify(label)}`,
    }]);
    const canonicalLabel = cadence === "quarter"
      ? (() => {
          const startCoordinate = calendarCoordinate(label, cadence, "start")!;
          const year = Math.floor(startCoordinate / 12);
          return `${String(year).padStart(4, "0")}Q${Math.floor((startCoordinate % 12) / 3) + 1}`;
        })()
      : label;
    return Object.freeze({ label: canonicalLabel, coordinate });
  }
  const catalog = side === "origin" ? axis.origins : axis.valuations;
  const item = catalog.find((coordinate) => coordinate.label === label || coordinate.aliases?.includes(label));
  if (!item) throw new DiagnosticValidationError([{
    domain: "input",
    code: "invalid-period",
    path: `$.${side}`,
    message: `Unknown ordered-axis ${side} label ${JSON.stringify(label)}`,
  }]);
  return Object.freeze({ label: item.label, coordinate: item.coordinate });
}

export function normalizeDiagnosticPeriod(
  definition: CompiledDiagnosticDefinition,
  side: PeriodSide,
  label: string,
): DiagnosticNormalizedPeriod {
  assertCompiledDiagnosticDefinition(definition);
  return normalizeWithAxis(definition.definition.periodAxis as DiagnosticPeriodAxis, side, label);
}

export function diagnosticDevelopmentAge(
  definition: CompiledDiagnosticDefinition,
  origin: string,
  valuation: string,
): { readonly origin: DiagnosticNormalizedPeriod; readonly valuation: DiagnosticNormalizedPeriod; readonly developmentAge: number; readonly ageUnit: string } {
  const normalizedOrigin = normalizeDiagnosticPeriod(definition, "origin", origin);
  const normalizedValuation = normalizeDiagnosticPeriod(definition, "valuation", valuation);
  const axis = definition.definition.periodAxis;
  const developmentAge = normalizedValuation.coordinate - normalizedOrigin.coordinate + axis.ageOffset;
  if (!Number.isSafeInteger(developmentAge) || developmentAge < 0) throw new DiagnosticValidationError([{
    domain: "input",
    code: "invalid-period",
    path: "$.valuation",
    message: "Valuation period precedes origin period or development age is unsafe",
  }]);
  return Object.freeze({
    origin: normalizedOrigin,
    valuation: normalizedValuation,
    developmentAge,
    ageUnit: axis.ageUnit,
  });
}

export function compareDiagnosticPeriods(left: DiagnosticNormalizedPeriod, right: DiagnosticNormalizedPeriod): number {
  return left.coordinate - right.coordinate || (left.label < right.label ? -1 : left.label > right.label ? 1 : 0);
}
