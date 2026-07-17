import {
  ReservingError,
  type Triangle,
  type TriangleKind,
  incrementalToCumulative,
  triangleFromGrid,
} from "@actuarial-ts/core";
import {
  DEFAULT_GENERATOR,
  INTERCHANGE_SPEC_VERSION,
  type GeneratorStamp,
  stampIntegrity,
} from "../envelope.js";
import {
  CORE_MEASURES,
  type CoreMeasure,
  type Measure,
  type OriginLengthMonths,
  type TriangleBody,
  type TriangleDoc,
  triangleDocSchema,
} from "../schemas/triangle.js";

/**
 * core `Triangle` ↔ TriangleDoc.
 *
 * - The seven core TriangleKind values are the interchange measures of the
 *   same name, both directions.
 * - Cadence: annual ("2023") and quarterly ("2023Q3") origin labels derive
 *   starts and originLengthMonths automatically; anything else needs
 *   explicit `originStarts` + `originLengthMonths`. Reading 1- or 6-month
 *   cadences parses with a capability warning (spec 3.2).
 * - `createdAt` and `valuationDate` are caller-supplied — this module
 *   never reads a clock (purity rule).
 * - Null means unobserved, both directions, always.
 */

export interface TriangleToDocOptions {
  /** ISO timestamp for the envelope (caller-supplied; purity rule). */
  createdAt: string;
  /** ISO yyyy-mm-dd valuation date of the triangle. */
  valuationDate: string;
  /** Interchange measure; defaults to the core kind, which maps verbatim. */
  measure?: Measure;
  /** Whether values are cumulative. Core triangles are; defaults true. */
  cumulative?: boolean;
  /** Override when labels are not annual/quarterly (e.g. semiannual). */
  originLengthMonths?: OriginLengthMonths;
  /** Explicit origin period start dates; required when labels do not parse. */
  originStarts?: string[];
  basis?: TriangleBody["basis"];
  units?: TriangleBody["units"];
  segment?: TriangleBody["segment"];
  extensions?: Record<string, unknown>;
  generator?: GeneratorStamp;
}

interface DerivedOrigin {
  start: string;
  lengthMonths: 12 | 3;
}

function deriveOrigin(label: string): DerivedOrigin | null {
  const annual = /^(\d{4})$/.exec(label);
  if (annual) return { start: `${annual[1]}-01-01`, lengthMonths: 12 };
  const quarterly = /^(\d{4})[Qq]([1-4])$/.exec(label);
  if (quarterly) {
    const month = (Number(quarterly[2]) - 1) * 3 + 1;
    return {
      start: `${quarterly[1]}-${String(month).padStart(2, "0")}-01`,
      lengthMonths: 3,
    };
  }
  return null;
}

export function triangleToDoc(tri: Triangle, options: TriangleToDocOptions): TriangleDoc {
  let starts = options.originStarts;
  let lengthMonths = options.originLengthMonths;
  if (starts === undefined || lengthMonths === undefined) {
    const derived = tri.origins.map(deriveOrigin);
    const missing = derived.findIndex((d) => d === null);
    if (missing >= 0) {
      throw new ReservingError(
        "BAD_INTERCHANGE",
        `Origin label "${tri.origins[missing]}" is neither annual ("2023") nor quarterly ` +
          `("2023Q3"); supply originStarts and originLengthMonths explicitly`,
      );
    }
    const lengths = new Set(derived.map((d) => d!.lengthMonths));
    if (lengths.size > 1) {
      throw new ReservingError(
        "BAD_INTERCHANGE",
        "Origin labels mix annual and quarterly forms; supply originStarts and originLengthMonths explicitly",
      );
    }
    starts ??= derived.map((d) => d!.start);
    lengthMonths ??= derived[0]!.lengthMonths;
  }
  if (starts.length !== tri.origins.length) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `originStarts has ${starts.length} entries but the triangle has ${tri.origins.length} origins`,
    );
  }

  const body: TriangleBody = {
    measure: options.measure ?? tri.kind,
    cumulative: options.cumulative ?? true,
    originLengthMonths: lengthMonths,
    origins: tri.origins.map((label, i) => ({ label, start: starts![i]! })),
    agesMonths: [...tri.ages],
    values: tri.values.map((row) => [...row]),
    valuationDate: options.valuationDate,
  };
  if (options.basis !== undefined) body.basis = options.basis;
  if (options.units !== undefined) body.units = options.units;
  if (options.segment !== undefined) body.segment = options.segment;

  const doc = stampIntegrity<TriangleDoc>({
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind: "triangle",
    generator: options.generator ?? DEFAULT_GENERATOR,
    createdAt: options.createdAt,
    extensions: options.extensions ?? {},
    triangle: body,
  });
  const checked = triangleDocSchema.safeParse(doc);
  if (!checked.success) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `triangleToDoc produced an invalid document: ${checked.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }
  return checked.data;
}

export interface DocToTriangleResult {
  triangle: Triangle;
  warnings: string[];
}

function measureToKind(measure: Measure): TriangleKind | null {
  return (CORE_MEASURES as readonly string[]).includes(measure)
    ? (measure as CoreMeasure)
    : null;
}

/**
 * TriangleDoc → core `Triangle`. Validates the document SCHEMA (integrity
 * verification is parseDocument's job — pass documents through it first
 * when provenance matters), maps the measure to a core kind, cumulates incremental
 * values through core's `incrementalToCumulative` (with a warning), and
 * channels reader-capability warnings for 1-/6-month cadences.
 */
export function docToTriangle(doc: unknown): DocToTriangleResult {
  const parsed = triangleDocSchema.safeParse(doc);
  if (!parsed.success) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Not a valid TriangleDoc: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const triangleDoc = parsed.data;
  const body = triangleDoc.triangle;

  const kind = measureToKind(body.measure);
  if (kind === null) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Measure "${body.measure}" has no core triangle kind (core kinds: ${CORE_MEASURES.join(", ")}); ` +
        "premium and custom measures are handled as exposure/reference data, not core triangles",
    );
  }
  if (body.values === undefined) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      "This triangle carries only a bulk-lane valuesRef; Phase A converters require inline values",
    );
  }

  const warnings: string[] = [];
  if (body.originLengthMonths === 1 || body.originLengthMonths === 6) {
    warnings.push(
      `originLengthMonths ${body.originLengthMonths} parsed successfully, but actuarial-ts ` +
        "computes natively on 12- and 3-month cadences; computation support is limited",
    );
  }

  let triangle = triangleFromGrid(
    kind,
    body.origins.map((o) => o.label),
    body.agesMonths,
    body.values,
  );
  if (!body.cumulative) {
    triangle = incrementalToCumulative(triangle);
    warnings.push(
      "Incremental values were cumulated via core incrementalToCumulative (a null stops " +
        "accumulation for its row); core methods run on cumulative triangles",
    );
  }
  return { triangle, warnings };
}
