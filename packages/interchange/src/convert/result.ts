import {
  type BenktanderResult,
  type BornhuetterFergusonResult,
  type ChainLadderResult,
  type MackResult,
  ReservingError,
} from "@actuarial-ts/core";
import {
  DEFAULT_GENERATOR,
  INTERCHANGE_SPEC_VERSION,
  type GeneratorStamp,
  stampIntegrity,
} from "../envelope.js";
import type { TriangleDoc } from "../schemas/triangle.js";
import type { SelectionDoc } from "../schemas/selection.js";
import {
  type EngineStamp,
  type MethodResultBody,
  type MethodResultDoc,
  type MethodResultRow,
  methodResultDocSchema,
} from "../schemas/result.js";

/**
 * core method results → MethodResultDoc, stamping `appliesTo` (spec 3.2 /
 * 4.1).
 *
 * Converts the deterministic quartet — ChainLadderResult, MackResult,
 * BornhuetterFergusonResult, BenktanderResult. Further methods (Cape Cod,
 * Clark, Munich, the stochastic layer, ...) are NOT yet converted and
 * throw; adding one is a spec-minor change. Method names use the actuarial-ts namespace
 * (unprefixed discriminants); `clpy:`/`rcl:` are reserved for the other
 * shores.
 *
 * Row vocabulary is the spec's: `unpaid` carries what core's Mack calls
 * `reserve` (identical quantity, interchange field name).
 */

export type ConvertibleResult =
  | ChainLadderResult
  | MackResult
  | BornhuetterFergusonResult
  | BenktanderResult;

/**
 * The engine stamp for results computed by @actuarial-ts/core. A sync test
 * pins the version to the installed core package so it cannot drift.
 */
export const CORE_ENGINE: EngineStamp = { name: "actuarial-ts", version: "0.3.0" };

export interface ResultToDocOptions {
  /** The triangle document the result was computed from. */
  triangleDoc: TriangleDoc;
  /** The selection document used, when one exists; null/omitted = none
   * (e.g. Mack on its own volume-weighted factors). */
  selectionDoc?: SelectionDoc | null;
  /** ISO timestamp for the envelope (caller-supplied; purity rule). */
  createdAt: string;
  /** Convention profile the run aligns to (referee comparability input). */
  conventionProfile?: string;
  /** Requested-parameter echo; defaults to {}. */
  parameters?: Record<string, unknown>;
  /** Effective parameters when the engine deviated from requested. */
  effectiveParameters?: Record<string, unknown>;
  engine?: EngineStamp;
  generator?: GeneratorStamp;
  extensions?: Record<string, unknown>;
}

interface MappedResult {
  method: string;
  rows: MethodResultRow[];
  totals: MethodResultBody["totals"];
  warnings: string[];
  /** Basis to cross-check against the triangle's measure; null = untyped. */
  basis: string | null;
}

function mapResult(result: ConvertibleResult): MappedResult {
  switch (result.method) {
    case "chainLadder":
      return {
        method: "chainLadder",
        rows: result.rows.map((r) => ({
          origin: r.origin,
          ultimate: r.ultimate,
          unpaid: r.unpaid,
        })),
        totals: { ultimate: result.totals.ultimate, unpaid: result.totals.unpaid },
        warnings: [...result.warnings],
        basis: result.basis,
      };
    case "mack":
      return {
        method: "mack",
        rows: result.rows.map((r) => ({
          origin: r.origin,
          ultimate: r.ultimate,
          unpaid: r.reserve,
          standardError: r.standardError,
        })),
        totals: {
          ultimate: result.totals.ultimate,
          unpaid: result.totals.reserve,
          standardError: result.totals.standardError,
        },
        warnings: [...result.warnings],
        basis: null,
      };
    case "bornhuetterFerguson":
      return {
        method: "bornhuetterFerguson",
        rows: result.rows.map((r) => ({
          origin: r.origin,
          ultimate: r.ultimate,
          unpaid: r.unpaid,
        })),
        totals: { ultimate: result.totals.ultimate, unpaid: result.totals.unpaid },
        warnings: [...result.warnings],
        basis: result.basis,
      };
    case "benktander":
      return {
        method: "benktander",
        rows: result.rows.map((r) => ({
          origin: r.origin,
          ultimate: r.ultimate,
          unpaid: r.unpaid,
        })),
        totals: { ultimate: result.totals.ultimate, unpaid: result.totals.unpaid },
        warnings: [...result.warnings],
        basis: result.basis,
      };
    default: {
      const method = (result as { method?: string }).method ?? "(unknown)";
      throw new ReservingError(
        "BAD_INTERCHANGE",
        `resultToDoc does not support method "${method}" yet; it converts chainLadder, ` +
          "mack, bornhuetterFerguson, and benktander",
      );
    }
  }
}

export function resultToDoc(
  result: ConvertibleResult,
  options: ResultToDocOptions,
): MethodResultDoc {
  const selectionDoc = options.selectionDoc ?? null;
  if (
    selectionDoc !== null &&
    selectionDoc.selection.appliesTo.triangleIntegrity !== options.triangleDoc.integrity
  ) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `The selection document applies to triangle ${selectionDoc.selection.appliesTo.triangleIntegrity} ` +
        `but the supplied triangle document's integrity is ${options.triangleDoc.integrity}`,
    );
  }

  const mapped = mapResult(result);
  if (mapped.basis !== null && mapped.basis !== options.triangleDoc.triangle.measure) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Result basis "${mapped.basis}" does not match the triangle document's measure ` +
        `"${options.triangleDoc.triangle.measure}"`,
    );
  }

  const engine: EngineStamp = { ...(options.engine ?? CORE_ENGINE) };
  if (options.conventionProfile !== undefined) {
    engine.conventionProfile = options.conventionProfile;
  }

  const body: MethodResultBody = {
    appliesTo: {
      triangleIntegrity: options.triangleDoc.integrity,
      selectionIntegrity: selectionDoc?.integrity ?? null,
    },
    engine,
    method: mapped.method,
    parameters: options.parameters ?? {},
    rows: mapped.rows,
    totals: mapped.totals,
  };
  // Authoring convention (shared with the Python adapter): `warnings` is
  // omitted when empty, so a warning-free result hashes identically no
  // matter which shore authored it.
  if (mapped.warnings.length > 0) body.warnings = mapped.warnings;
  if (options.effectiveParameters !== undefined) {
    body.effectiveParameters = options.effectiveParameters;
  }

  const doc = stampIntegrity<MethodResultDoc>({
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind: "method-result",
    generator: options.generator ?? DEFAULT_GENERATOR,
    createdAt: options.createdAt,
    extensions: options.extensions ?? {},
    result: body,
  });
  const checked = methodResultDocSchema.safeParse(doc);
  if (!checked.success) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `resultToDoc produced an invalid document: ${checked.error.issues
        .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return checked.data;
}
