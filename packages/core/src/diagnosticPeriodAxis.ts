import type { DiagnosticPeriodAxis } from "./diagnosticDefinitions.js";

export interface NormalizedDiagnosticAxisPeriod {
  readonly label: string;
  readonly coordinate: number;
}

export type DiagnosticPeriodSide = "origin" | "valuation";

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

/** Pure axis-level period normalization shared by compilation and execution. */
export function normalizeDiagnosticPeriodWithAxis(
  axis: DiagnosticPeriodAxis,
  side: DiagnosticPeriodSide,
  label: unknown,
): NormalizedDiagnosticAxisPeriod | null {
  if (typeof label !== "string" || axis === null || typeof axis !== "object")
    return null;
  if (axis.kind === "calendar") {
    const cadence =
      side === "origin" ? axis.originCadence : axis.valuationCadence;
    const anchor = side === "origin" ? axis.originAnchor : axis.valuationAnchor;
    if (
      !["month", "quarter", "year"].includes(cadence) ||
      !["start", "end"].includes(anchor)
    )
      return null;
    const coordinate = calendarCoordinate(label, cadence, anchor);
    if (coordinate === null) return null;
    const canonicalLabel =
      cadence === "quarter"
        ? (() => {
            const startCoordinate = calendarCoordinate(
              label,
              cadence,
              "start",
            )!;
            const year = Math.floor(startCoordinate / 12);
            return `${String(year).padStart(4, "0")}-Q${Math.floor((startCoordinate % 12) / 3) + 1}`;
          })()
        : label;
    return { label: canonicalLabel, coordinate };
  }
  if (
    axis.kind !== "ordered" ||
    !Array.isArray(axis[side === "origin" ? "origins" : "valuations"])
  )
    return null;
  const catalog = side === "origin" ? axis.origins : axis.valuations;
  const item = catalog.find(
    (coordinate) =>
      coordinate?.label === label || coordinate?.aliases?.includes(label),
  );
  return item && typeof item.coordinate === "number"
    ? { label: item.label, coordinate: item.coordinate }
    : null;
}
