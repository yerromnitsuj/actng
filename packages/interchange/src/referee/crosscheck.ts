import { ReservingError } from "@actuarial-ts/core";
import {
  DEFAULT_GENERATOR,
  INTERCHANGE_SPEC_VERSION,
  type GeneratorStamp,
  stampIntegrity,
  verifyIntegrity,
} from "../envelope.js";
import {
  type MethodResultDoc,
  methodResultDocSchema,
} from "../schemas/result.js";
import {
  type SelectionDoc,
  isValueOnlySelection,
  selectionDocSchema,
} from "../schemas/selection.js";
import {
  type CrosscheckBody,
  type CrosscheckReportDoc,
  crosscheckReportDocSchema,
} from "../schemas/crosscheck.js";
import { CONVENTION_PROFILES } from "./profiles.js";

/**
 * The referee (spec 5): deterministic cross-implementation comparison of
 * two MethodResultDocs. NOT an agent (G5) — no judgment, no persuasion,
 * just tags, deviations, tolerances, and a verdict.
 *
 * - Comparability: same triangle tag; same selection tag or both null;
 *   convention profiles must not conflict; origin sets must match.
 * - Tolerance: explicit option > shared known profile > the
 *   deterministic-cl default (with a warning). mack1993-vw compares SEs at
 *   its own SE tolerance; a profile with SEs out of scope skips them.
 * - requested ≠ effective (`effectiveParameters` present on either side)
 *   downgrades the comparison with a comparability warning (spec 3.2).
 * - `verified-by-value`: within tolerance but the selection both results
 *   replayed is value-only — the engines applied the same values rather
 *   than independently recomputing, and the verdict says so.
 */

export interface CrosscheckOptions {
  a: MethodResultDoc;
  b: MethodResultDoc;
  /** Overrides the profile tolerance. A bare number applies to central
   * estimates AND standard errors. */
  tolerance?: number | { central: number; standardError?: number };
  /** The selection both results applied, when one exists — enables the
   * verified-by-value classification. */
  selection?: SelectionDoc;
  /** ISO timestamp for the report envelope (caller-supplied; purity rule). */
  createdAt: string;
  generator?: GeneratorStamp;
}

interface ResolvedTolerance {
  central: number;
  standardError: number | null;
}

function relativeDeviation(x: number, y: number): number {
  const scale = Math.max(Math.abs(x), Math.abs(y));
  return scale === 0 ? 0 : Math.abs(x - y) / scale;
}

function validateInput(label: "a" | "b", doc: MethodResultDoc): MethodResultDoc {
  const parsed = methodResultDocSchema.safeParse(doc);
  if (!parsed.success) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `crosscheck input "${label}" is not a valid MethodResultDoc: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const integrity = verifyIntegrity(parsed.data);
  if (!integrity.ok) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `crosscheck input "${label}" fails its integrity check: stated ${integrity.actual ?? "(none)"}, ` +
        `semantic body hashes to ${integrity.expected}`,
    );
  }
  return parsed.data;
}

function resolveTolerance(
  a: MethodResultDoc,
  b: MethodResultDoc,
  explicit: CrosscheckOptions["tolerance"],
  warnings: string[],
): ResolvedTolerance {
  if (typeof explicit === "number") {
    return { central: explicit, standardError: explicit };
  }
  if (explicit !== undefined) {
    return { central: explicit.central, standardError: explicit.standardError ?? null };
  }
  const profileA = a.result.engine.conventionProfile;
  const profileB = b.result.engine.conventionProfile;
  const shared = profileA !== undefined && profileA === profileB ? profileA : undefined;
  if (shared !== undefined) {
    const profile = CONVENTION_PROFILES[shared];
    if (profile !== undefined) {
      return { ...profile.tolerance };
    }
    warnings.push(
      `Convention profile "${shared}" is not in this package's registry; falling back to the ` +
        "deterministic-cl central tolerance",
    );
  } else {
    warnings.push(
      "No shared convention profile is stated on both results; falling back to the " +
        "deterministic-cl central tolerance",
    );
  }
  const fallback = CONVENTION_PROFILES["deterministic-cl"]!;
  return { ...fallback.tolerance };
}

export function crosscheck(options: CrosscheckOptions): CrosscheckReportDoc {
  const a = validateInput("a", options.a);
  const b = validateInput("b", options.b);

  const warnings: string[] = [];
  const notComparable: string[] = [];

  // --- comparability: appliesTo tags (spec 5) ---
  const aTo = a.result.appliesTo;
  const bTo = b.result.appliesTo;
  const sameTriangle = aTo.triangleIntegrity === bTo.triangleIntegrity;
  const sameSelection = aTo.selectionIntegrity === bTo.selectionIntegrity;
  if (!sameTriangle) {
    notComparable.push(
      `the results apply to different triangles (${aTo.triangleIntegrity} vs ${bTo.triangleIntegrity})`,
    );
  }
  if (!sameSelection) {
    notComparable.push(
      `the results apply to different selections (${aTo.selectionIntegrity ?? "null"} vs ` +
        `${bTo.selectionIntegrity ?? "null"}); comparability requires the same selection or both null`,
    );
  }

  // --- comparability: convention profiles ---
  const profileA = a.result.engine.conventionProfile;
  const profileB = b.result.engine.conventionProfile;
  if (profileA !== undefined && profileB !== undefined && profileA !== profileB) {
    notComparable.push(
      `the results claim different convention profiles ("${profileA}" vs "${profileB}")`,
    );
  }

  // --- the selection both results replayed, when supplied ---
  let selection: SelectionDoc | null = null;
  if (options.selection !== undefined) {
    const parsed = selectionDocSchema.safeParse(options.selection);
    if (!parsed.success) {
      throw new ReservingError(
        "BAD_INTERCHANGE",
        `crosscheck "selection" is not a valid SelectionDoc: ${parsed.error.issues
          .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
          .join("; ")}`,
      );
    }
    selection = parsed.data;
    if (sameSelection && aTo.selectionIntegrity !== selection.integrity) {
      throw new ReservingError(
        "BAD_INTERCHANGE",
        `The supplied selection's integrity (${selection.integrity}) does not match the results' ` +
          `selectionIntegrity (${aTo.selectionIntegrity ?? "null"})`,
      );
    }
  }

  // --- comparability: origin sets ---
  const aOrigins = a.result.rows.map((r) => r.origin);
  for (const [label, rows] of [["a", a.result.rows] as const, ["b", b.result.rows] as const]) {
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.origin)) {
        throw new ReservingError(
          "BAD_INTERCHANGE",
          `Result "${label}" lists origin "${row.origin}" more than once; per-origin comparison is ill-defined`,
        );
      }
      seen.add(row.origin);
    }
  }
  const bByOrigin = new Map(b.result.rows.map((r) => [r.origin, r]));
  const aOnly = aOrigins.filter((o) => !bByOrigin.has(o));
  const bOnly = b.result.rows.map((r) => r.origin).filter((o) => !a.result.rows.some((r) => r.origin === o));
  if (aOnly.length > 0 || bOnly.length > 0) {
    notComparable.push(
      `the results cover different origin sets (only in a: [${aOnly.join(", ")}]; only in b: [${bOnly.join(", ")}])`,
    );
  }

  // --- requested vs effective downgrade (spec 3.2 / 5) ---
  for (const [label, doc] of [
    ["a", a],
    ["b", b],
  ] as const) {
    if (doc.result.effectiveParameters !== undefined) {
      warnings.push(
        `Comparability downgrade: engine "${label}" (${doc.result.engine.name}) ran with effective ` +
          `parameters ${JSON.stringify(doc.result.effectiveParameters)} deviating from the requested ` +
          `${JSON.stringify(doc.result.parameters)}`,
      );
    }
  }

  const tolerance = resolveTolerance(a, b, options.tolerance, warnings);
  const compareSe = tolerance.standardError !== null;
  if (!compareSe) {
    const seOnBoth =
      a.result.rows.some((r) => r.standardError !== undefined) &&
      b.result.rows.some((r) => r.standardError !== undefined);
    if (seOnBoth) {
      warnings.push(
        "Both results carry standard errors but the applied tolerance has SEs out of scope; " +
          "standard errors were not compared",
      );
    }
  }

  // --- deviations ---
  let comparable = notComparable.length === 0;
  const perOrigin: CrosscheckBody["deviations"]["perOrigin"] = [];
  let maxCentral = 0;
  let maxSe = 0;
  if (comparable) {
    for (const rowA of a.result.rows) {
      const rowB = bByOrigin.get(rowA.origin)!;
      const ultimate = relativeDeviation(rowA.ultimate, rowB.ultimate);
      const unpaid = relativeDeviation(rowA.unpaid, rowB.unpaid);
      const standardError =
        compareSe && rowA.standardError !== undefined && rowB.standardError !== undefined
          ? relativeDeviation(rowA.standardError, rowB.standardError)
          : null;
      maxCentral = Math.max(maxCentral, ultimate, unpaid);
      if (standardError !== null) maxSe = Math.max(maxSe, standardError);
      perOrigin.push({ origin: rowA.origin, ultimate, unpaid, standardError });
    }
  }
  const totalsA = a.result.totals;
  const totalsB = b.result.totals;
  const totals: CrosscheckBody["deviations"]["totals"] = comparable
    ? {
        ultimate: relativeDeviation(totalsA.ultimate, totalsB.ultimate),
        unpaid: relativeDeviation(totalsA.unpaid, totalsB.unpaid),
        standardError:
          compareSe &&
          totalsA.standardError !== undefined &&
          totalsB.standardError !== undefined
            ? relativeDeviation(totalsA.standardError, totalsB.standardError)
            : null,
      }
    : { ultimate: null, unpaid: null, standardError: null };
  if (comparable) {
    maxCentral = Math.max(maxCentral, totals.ultimate ?? 0, totals.unpaid ?? 0);
    if (totals.standardError !== null) maxSe = Math.max(maxSe, totals.standardError);
  }

  // --- verdict ---
  let verdict: CrosscheckBody["verdict"];
  if (!comparable) {
    verdict = "not-comparable";
    warnings.push(...notComparable.map((reason) => `Not comparable: ${reason}`));
  } else if (
    maxCentral > tolerance.central ||
    (compareSe && maxSe > tolerance.standardError!)
  ) {
    verdict = "disagree";
  } else if (
    selection !== null &&
    sameSelection &&
    aTo.selectionIntegrity !== null &&
    isValueOnlySelection(selection.selection)
  ) {
    verdict = "verified-by-value";
    warnings.push(
      "The compared results replayed a value-only selection (every intent judgmental/external): " +
        "no independent recomputation occurred; agreement verifies value transport, not methodology",
    );
  } else {
    verdict = "agree";
  }

  const body: CrosscheckBody = {
    engines: { a: a.result.engine, b: b.result.engine },
    appliesTo: sameTriangle && sameSelection ? aTo : null,
    parameters: {
      a: { requested: a.result.parameters, effective: a.result.effectiveParameters ?? null },
      b: { requested: b.result.parameters, effective: b.result.effectiveParameters ?? null },
    },
    tolerance: { central: tolerance.central, standardError: tolerance.standardError },
    deviations: { perOrigin, totals },
    verdict,
    warnings,
  };

  const doc = stampIntegrity<CrosscheckReportDoc>({
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind: "crosscheck-report",
    generator: options.generator ?? DEFAULT_GENERATOR,
    createdAt: options.createdAt,
    extensions: {},
    report: body,
  });
  const checked = crosscheckReportDocSchema.safeParse(doc);
  if (!checked.success) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `crosscheck produced an invalid report: ${checked.error.issues
        .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return checked.data;
}
