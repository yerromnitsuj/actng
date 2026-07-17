import {
  type AverageKey,
  type AverageSpec,
  type LdfSelections,
  ReservingError,
  type TailMethod,
  type Triangle,
  computeDevelopmentFactors,
  fitTail,
  triangleFromGrid,
} from "@actuarial-ts/core";
import {
  DEFAULT_GENERATOR,
  INTERCHANGE_SPEC_VERSION,
  type GeneratorStamp,
  stampIntegrity,
} from "../envelope.js";
import type { OriginLengthMonths, TriangleDoc } from "../schemas/triangle.js";
import {
  type DevelopmentIntent,
  type DevelopmentSelection,
  type SelectionBody,
  type SelectionDoc,
  type TailFamily,
  type TailIntent,
  VALUE_AUTHORITATIVE_KINDS,
  selectionDocSchema,
} from "../schemas/selection.js";
import { docToTriangle } from "./triangle.js";

/**
 * core `LdfSelections` ↔ SelectionDoc, with the coherence rule (spec 3.2).
 *
 * THE COHERENCE RULE (normative): for COMPUTABLE intents (everything
 * except judgmental/external), `value` MUST equal the intent's
 * recomputation on the referenced triangle within 1e-9 relative. Every
 * conforming importer verifies this and, per a strictness flag, warns or
 * refuses (INCOHERENT_SELECTION) on divergence. Intent is authoritative
 * for replay and promotion; values are authoritative only for
 * judgmental/external intents.
 *
 * REPLAY CAPABILITY (spec 3.2 equivalence table): this shore recomputes
 * only the cells the table marks `exact` for actuarial-ts —
 * volume-weighted/simple all-period on any cadence, windowed n ∈ {5, 3}
 * on 12-month cadence, geometric all-period, and medial {5, 1, 1} — via
 * core's computeDevelopmentFactors, plus fitted tails via core's fitTail.
 * Everything else (regression, other windows/trims, and any intent with
 * origin exclusions, which core's menu machinery does not model) is
 * value-only HERE: the value is accepted with a warning naming the
 * limitation, never silently, and never recomputed with semantics the
 * table does not claim. Cross-engine verification of those cells is the
 * conformance suite's and the referee's business.
 */

/** Spec coherence tolerance: 1e-9 relative (spec 3.2). */
export const COHERENCE_TOLERANCE = 1e-9;

/** Menu key → interchange intent (the DEFAULT_AVERAGES mapping target). */
const MENU_INTENTS: Record<AverageKey, DevelopmentIntent> = {
  "all-wtd": { kind: "volume-weighted" },
  "all-str": { kind: "simple" },
  "5-wtd": { kind: "volume-weighted", windowOriginPeriods: 5 },
  "5-str": { kind: "simple", windowOriginPeriods: 5 },
  "3-wtd": { kind: "volume-weighted", windowOriginPeriods: 3 },
  "3-str": { kind: "simple", windowOriginPeriods: 3 },
  "med-5x1": { kind: "medial", windowOriginPeriods: 5, excludeHigh: 1, excludeLow: 1 },
  "geo-all": { kind: "geometric" },
};

const MENU_KEYS = Object.keys(MENU_INTENTS) as AverageKey[];

/** The interchange intent a standard-menu average key expresses. */
export function intentFromAverageKey(key: AverageKey): DevelopmentIntent {
  return { ...MENU_INTENTS[key] };
}

function hasExclusions(intent: DevelopmentIntent): boolean {
  return intent.exclusions !== undefined && intent.exclusions.length > 0;
}

/**
 * The standard-menu key that replays this intent EXACTLY on the given
 * cadence per the spec 3.2 equivalence table, or null (value-only here).
 */
export function averageKeyForIntent(
  intent: DevelopmentIntent,
  originLengthMonths: OriginLengthMonths,
): AverageKey | null {
  if (hasExclusions(intent)) return null;
  const window = intent.windowOriginPeriods;
  switch (intent.kind) {
    case "volume-weighted":
      if (window === undefined) return "all-wtd";
      if (originLengthMonths === 12 && (window === 5 || window === 3)) {
        return window === 5 ? "5-wtd" : "3-wtd";
      }
      return null;
    case "simple":
      if (window === undefined) return "all-str";
      if (originLengthMonths === 12 && (window === 5 || window === 3)) {
        return window === 5 ? "5-str" : "3-str";
      }
      return null;
    case "geometric":
      return window === undefined ? "geo-all" : null;
    case "medial":
      return originLengthMonths === 12 &&
        window === 5 &&
        intent.excludeHigh === 1 &&
        intent.excludeLow === 1
        ? "med-5x1"
        : null;
    default:
      return null;
  }
}

function isValueAuthoritative(kind: string): boolean {
  return (VALUE_AUTHORITATIVE_KINDS as readonly string[]).includes(kind);
}

/** The AverageSpec core recomputes an exactly-replayable intent with. */
function specForExactIntent(key: AverageKey): AverageSpec {
  const kindByKey: Record<AverageKey, AverageSpec["kind"]> = {
    "all-wtd": "weighted",
    "all-str": "straight",
    "5-wtd": "weighted",
    "5-str": "straight",
    "3-wtd": "weighted",
    "3-str": "straight",
    "med-5x1": "medial",
    "geo-all": "geometric",
  };
  const spec: AverageSpec = { key, label: key, kind: kindByKey[key] };
  const years = MENU_INTENTS[key].windowOriginPeriods;
  if (years !== undefined) spec.years = years;
  return spec;
}

const TAIL_METHOD_BY_FAMILY: Record<TailFamily, TailMethod> = {
  "exponential-decay": "exponentialDecay",
  "inverse-power": "inversePower",
};

export interface CoherenceFinding {
  /** The development interval, or "tail". */
  target: { fromAgeMonths: number; toAgeMonths: number } | "tail";
  /** Whether this shore could recompute the intent exactly. */
  capability: "exact" | "value-only";
  /** Which side of the intent/value pair is authoritative (spec 3.2). */
  authoritative: "intent" | "value";
  /** The recomputed value where capability is exact; null otherwise. */
  expected: number | null;
  /** The value the document states. */
  actual: number;
  relativeDeviation: number | null;
  /** true = verified coherent; false = divergent; null = not recomputed. */
  coherent: boolean | null;
  note?: string;
}

export interface CoherenceCheck {
  coherent: boolean;
  findings: CoherenceFinding[];
  warnings: string[];
}

function relativeDeviation(actual: number, expected: number): number {
  const scale = Math.max(Math.abs(actual), Math.abs(expected));
  return scale === 0 ? 0 : Math.abs(actual - expected) / scale;
}

/** Maps development entries to triangle column indexes; refuses unknown or
 * duplicated intervals. */
function mapEntriesToColumns(
  development: readonly DevelopmentSelection[],
  agesMonths: readonly number[],
): number[] {
  const seen = new Set<number>();
  return development.map((entry) => {
    const j = agesMonths.findIndex(
      (age, idx) =>
        age === entry.fromAgeMonths && agesMonths[idx + 1] === entry.toAgeMonths,
    );
    if (j < 0) {
      throw new ReservingError(
        "BAD_INTERCHANGE",
        `Development interval ${entry.fromAgeMonths}→${entry.toAgeMonths} months does not match ` +
          `adjacent triangle ages (agesMonths: ${agesMonths.join(", ")})`,
      );
    }
    if (seen.has(j)) {
      throw new ReservingError(
        "BAD_INTERCHANGE",
        `Duplicate development entry for ${entry.fromAgeMonths}→${entry.toAgeMonths} months`,
      );
    }
    seen.add(j);
    return j;
  });
}

/** Two-age sub-triangle for column j: recomputation without cross-column effects. */
function columnSubTriangle(tri: Triangle, j: number): Triangle {
  return triangleFromGrid(
    tri.kind,
    tri.origins,
    [tri.ages[j]!, tri.ages[j + 1]!],
    tri.values.map((row) => [row[j] ?? null, row[j + 1] ?? null]),
  );
}

export interface CheckCoherenceOptions {
  /** warn: report divergence; refuse: throw INCOHERENT_SELECTION. */
  strictness: "warn" | "refuse";
}

/**
 * Verifies the coherence rule for a selection body against its referenced
 * triangle document. Verifies the appliesTo linkage first (tag + measure);
 * a mismatch is BAD_INTERCHANGE, not incoherence.
 */
export function checkSelectionCoherence(
  selection: SelectionBody,
  triangleDoc: TriangleDoc,
  options: CheckCoherenceOptions,
): CoherenceCheck {
  if (selection.appliesTo.triangleIntegrity !== triangleDoc.integrity) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Selection applies to triangle ${selection.appliesTo.triangleIntegrity} but the supplied ` +
        `triangle document's integrity is ${triangleDoc.integrity}`,
    );
  }
  if (selection.appliesTo.measure !== triangleDoc.triangle.measure) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Selection applies to measure "${selection.appliesTo.measure}" but the triangle's measure ` +
        `is "${triangleDoc.triangle.measure}"`,
    );
  }

  const { triangle } = docToTriangle(triangleDoc);
  const cadence = triangleDoc.triangle.originLengthMonths;
  const agesMonths = triangleDoc.triangle.agesMonths;
  const columns = mapEntriesToColumns(selection.development, agesMonths);

  const findings: CoherenceFinding[] = [];
  const warnings: string[] = [];

  selection.development.forEach((entry, idx) => {
    const target = { fromAgeMonths: entry.fromAgeMonths, toAgeMonths: entry.toAgeMonths };
    const label = `${entry.fromAgeMonths}→${entry.toAgeMonths}`;
    if (isValueAuthoritative(entry.intent.kind)) {
      findings.push({
        target,
        capability: "value-only",
        authoritative: "value",
        expected: null,
        actual: entry.value,
        relativeDeviation: null,
        coherent: null,
        note: `intent "${entry.intent.kind}": the value IS the judgment (rationale carries its justification)`,
      });
      return;
    }
    const menuKey = averageKeyForIntent(entry.intent, cadence);
    if (menuKey === null) {
      const reason = hasExclusions(entry.intent)
        ? "origin exclusions are beyond this shore's exact replay in Phase A"
        : `intent "${entry.intent.kind}"${
            entry.intent.windowOriginPeriods !== undefined
              ? ` with windowOriginPeriods ${entry.intent.windowOriginPeriods}`
              : ""
          } on ${cadence}-month cadence is not an exact actuarial-ts replay cell`;
      findings.push({
        target,
        capability: "value-only",
        authoritative: "intent",
        expected: null,
        actual: entry.value,
        relativeDeviation: null,
        coherent: null,
        note: reason,
      });
      warnings.push(
        `Development ${label}: value accepted without recomputation — ${reason} ` +
          "(spec 3.2 equivalence table)",
      );
      return;
    }
    const recomputed = computeDevelopmentFactors(columnSubTriangle(triangle, columns[idx]!), [
      specForExactIntent(menuKey),
    ]).averages[0]!.values[0]!;
    if (recomputed === null) {
      findings.push({
        target,
        capability: "exact",
        authoritative: "intent",
        expected: null,
        actual: entry.value,
        relativeDeviation: null,
        coherent: false,
        note: "the intent produces no factor on this triangle (no usable pairs in the window)",
      });
      return;
    }
    const deviation = relativeDeviation(entry.value, recomputed);
    findings.push({
      target,
      capability: "exact",
      authoritative: "intent",
      expected: recomputed,
      actual: entry.value,
      relativeDeviation: deviation,
      coherent: deviation <= COHERENCE_TOLERANCE,
    });
  });

  if (selection.tail !== undefined) {
    const tail = selection.tail;
    if (isValueAuthoritative(tail.intent.kind)) {
      findings.push({
        target: "tail",
        capability: "value-only",
        authoritative: "value",
        expected: null,
        actual: tail.value,
        relativeDeviation: null,
        coherent: null,
        note: `tail intent "${tail.intent.kind}": the value IS the judgment`,
      });
    } else {
      // Fitted tail: refit core's curve on the selection's own development
      // factors (the fit runs on SELECTED factors), masking columns below
      // fitFromAgeMonths.
      const selectedLdfs: (number | null)[] = new Array(agesMonths.length - 1).fill(null);
      selection.development.forEach((entry, idx) => {
        selectedLdfs[columns[idx]!] =
          tail.intent.kind === "fitted" &&
          tail.intent.fitFromAgeMonths !== undefined &&
          entry.fromAgeMonths < tail.intent.fitFromAgeMonths
            ? null
            : entry.value;
      });
      const fit = fitTail({
        method: TAIL_METHOD_BY_FAMILY[(tail.intent as { family: TailFamily }).family],
        selectedLdfs,
      });
      if (!fit.valid) {
        findings.push({
          target: "tail",
          capability: "exact",
          authoritative: "intent",
          expected: null,
          actual: tail.value,
          relativeDeviation: null,
          coherent: false,
          note: `the fitted-tail intent does not produce a valid fit on this selection: ${fit.warnings.join("; ")}`,
        });
      } else {
        const deviation = relativeDeviation(tail.value, fit.tailFactor);
        findings.push({
          target: "tail",
          capability: "exact",
          authoritative: "intent",
          expected: fit.tailFactor,
          actual: tail.value,
          relativeDeviation: deviation,
          coherent: deviation <= COHERENCE_TOLERANCE,
        });
      }
    }
  }

  const divergent = findings.filter((f) => f.coherent === false);
  for (const f of divergent) {
    const where = f.target === "tail" ? "tail" : `${f.target.fromAgeMonths}→${f.target.toAgeMonths}`;
    warnings.push(
      `INCOHERENT at ${where}: stated value ${f.actual}` +
        (f.expected !== null
          ? ` but the intent recomputes to ${f.expected} (relative deviation ${f.relativeDeviation?.toExponential(3)}, tolerance ${COHERENCE_TOLERANCE})`
          : ` but the intent is not computable on this triangle${f.note !== undefined ? ` (${f.note})` : ""}`),
    );
  }
  if (divergent.length > 0 && options.strictness === "refuse") {
    throw new ReservingError(
      "INCOHERENT_SELECTION",
      `Selection violates the coherence rule (spec 3.2) at ${divergent.length} target(s): ` +
        warnings.filter((w) => w.startsWith("INCOHERENT")).join(" | "),
    );
  }
  return { coherent: divergent.length === 0, findings, warnings };
}

/** Per-column intent: a standard-menu key or an explicit interchange intent. */
export type DevelopmentIntentInput = AverageKey | DevelopmentIntent;

export interface SelectionsToDocOptions {
  /** The triangle document the selection applies to (source of the tag). */
  triangleDoc: TriangleDoc;
  /** ISO timestamp for the envelope (caller-supplied; purity rule). */
  createdAt: string;
  /**
   * Per development column j (length = agesMonths.length - 1): the intent
   * behind selected[j]. Required wherever selected[j] is a number; columns
   * with null selections are omitted from the document.
   */
  intents: readonly (DevelopmentIntentInput | null | undefined)[];
  /** Tail intent; required when selections.tailFactor ≠ 1. */
  tailIntent?: TailIntent;
  /** Authoring-side coherence strictness. Default "refuse": never author
   * an incoherent document silently. */
  strictness?: "warn" | "refuse";
  generator?: GeneratorStamp;
  extensions?: Record<string, unknown>;
}

export interface SelectionsToDocResult {
  doc: SelectionDoc;
  coherence: CoherenceCheck;
  warnings: string[];
}

function resolveIntent(input: DevelopmentIntentInput): DevelopmentIntent {
  return typeof input === "string" && (MENU_KEYS as string[]).includes(input)
    ? intentFromAverageKey(input as AverageKey)
    : (input as DevelopmentIntent);
}

export function selectionsToDoc(
  selections: LdfSelections,
  options: SelectionsToDocOptions,
): SelectionsToDocResult {
  const agesMonths = options.triangleDoc.triangle.agesMonths;
  const nColumns = agesMonths.length - 1;
  if (selections.selected.length !== nColumns) {
    throw new ReservingError(
      "SELECTION_SHAPE",
      `Expected ${nColumns} LDF selections (one per development interval), got ${selections.selected.length}`,
    );
  }
  if (options.intents.length !== nColumns) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Expected ${nColumns} intents (one per development column), got ${options.intents.length}`,
    );
  }

  const development: DevelopmentSelection[] = [];
  for (let j = 0; j < nColumns; j++) {
    const value = selections.selected[j];
    if (value === null || value === undefined) continue;
    const intentInput = options.intents[j];
    if (intentInput === null || intentInput === undefined) {
      throw new ReservingError(
        "BAD_INTERCHANGE",
        `Column ${agesMonths[j]}→${agesMonths[j + 1]} months has a selected factor but no intent; ` +
          'hand-picked values need { kind: "judgmental", rationale: "..." }',
      );
    }
    development.push({
      fromAgeMonths: agesMonths[j]!,
      toAgeMonths: agesMonths[j + 1]!,
      value,
      intent: resolveIntent(intentInput),
    });
  }

  const body: SelectionBody = {
    appliesTo: {
      measure: options.triangleDoc.triangle.measure,
      triangleIntegrity: options.triangleDoc.integrity,
    },
    development,
  };
  if (options.tailIntent !== undefined) {
    body.tail = { value: selections.tailFactor, intent: options.tailIntent };
  } else if (selections.tailFactor !== 1) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Tail factor ${selections.tailFactor} needs a tailIntent (fitted, or judgmental/external with rationale); ` +
        "only a tail of exactly 1 may be omitted",
    );
  }

  const coherence = checkSelectionCoherence(body, options.triangleDoc, {
    strictness: options.strictness ?? "refuse",
  });

  const doc = stampIntegrity<SelectionDoc>({
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind: "selection",
    generator: options.generator ?? DEFAULT_GENERATOR,
    createdAt: options.createdAt,
    extensions: options.extensions ?? {},
    selection: body,
  });
  const checked = selectionDocSchema.safeParse(doc);
  if (!checked.success) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `selectionsToDoc produced an invalid document: ${checked.error.issues
        .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return { doc: checked.data, coherence, warnings: coherence.warnings };
}

export interface DocToSelectionsOptions {
  /** The triangle document the selection claims to apply to. */
  triangleDoc: TriangleDoc;
  /** Importer-side coherence strictness. Default "warn"; promotion gates
   * and other refuse-mode consumers pass "refuse". */
  strictness?: "warn" | "refuse";
}

export interface DocToSelectionsResult {
  selections: LdfSelections;
  /** Per column: the standard-menu key that replays the intent exactly,
   * or null (value-only on this shore / no selection). */
  averageKeys: (AverageKey | null)[];
  coherence: CoherenceCheck;
  warnings: string[];
}

export function docToSelections(
  doc: unknown,
  options: DocToSelectionsOptions,
): DocToSelectionsResult {
  const parsed = selectionDocSchema.safeParse(doc);
  if (!parsed.success) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Not a valid SelectionDoc: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const body = parsed.data.selection;
  const agesMonths = options.triangleDoc.triangle.agesMonths;
  const cadence = options.triangleDoc.triangle.originLengthMonths;

  const coherence = checkSelectionCoherence(body, options.triangleDoc, {
    strictness: options.strictness ?? "warn",
  });

  const columns = mapEntriesToColumns(body.development, agesMonths);
  const selected: (number | null)[] = new Array(agesMonths.length - 1).fill(null);
  const averageKeys: (AverageKey | null)[] = new Array(agesMonths.length - 1).fill(null);
  body.development.forEach((entry, idx) => {
    selected[columns[idx]!] = entry.value;
    averageKeys[columns[idx]!] = isValueAuthoritative(entry.intent.kind)
      ? null
      : averageKeyForIntent(entry.intent, cadence);
  });

  return {
    selections: { selected, tailFactor: body.tail?.value ?? 1 },
    averageKeys,
    coherence,
    warnings: coherence.warnings,
  };
}
