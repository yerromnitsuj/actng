import { runChainLadder } from "./chainladder.js";
import type { ChainLadderResult, LdfSelections, Triangle, TriangleKind } from "./types.js";
import { ReservingError } from "./types.js";
import { isNum } from "./util.js";

/**
 * Salvage & subrogation: recovery triangles develop like loss triangles, so
 * ultimate recoveries come from a chain ladder on cumulative RECEIVED
 * recoveries with the caller's selected factors, and net results come from
 * subtracting the recovery projection from a gross one, aligned by origin.
 *
 * Ground truth:
 * - Recovery development is commonly SLOWER and LUMPIER than the loss
 *   development it offsets (recoveries lag settlement); every run says so in
 *   warnings, because borrowing loss LDFs for recoveries is the classic
 *   mistake this module exists to prevent.
 * - `netOfRecoveries` never fabricates: an origin present on only one side
 *   is EXCLUDED with a warning, and both sides' totals cover only the
 *   aligned origins so net = gross - recoveries holds exactly within the
 *   result.
 * - Algebra identity (tested): with the same selections on both triangles,
 *   netting the two projections equals a chain ladder on the cell-wise
 *   difference triangle (subtractTriangles), because CL is linear in the
 *   latest diagonal.
 */

export interface SalvageSubroOptions {
  /** Selected recovery LDFs, one per development interval (null -> 1.000 with a warning). */
  selected: LdfSelections["selected"];
  tailFactor?: number;
}

export interface SalvageSubroRow {
  origin: string;
  latestAge: number;
  /** Cumulative recoveries received as of the latest diagonal. */
  receivedToDate: number;
  /** Cumulative development factor from latestAge to ultimate. */
  cdf: number;
  ultimateRecoveries: number;
  /** ultimate - received: recoveries still expected. */
  futureRecoveries: number;
}

export interface SalvageSubroResult {
  method: "salvageSubro";
  basis: TriangleKind;
  cdfs: number[];
  percentDeveloped: number[];
  rows: SalvageSubroRow[];
  totals: { receivedToDate: number; ultimateRecoveries: number; futureRecoveries: number };
  warnings: string[];
}

/** Chain ladder on a cumulative received-recoveries triangle. */
export function runSalvageSubro(
  recoveries: Triangle,
  options: SalvageSubroOptions,
): SalvageSubroResult {
  const warnings: string[] = [
    "Salvage and subrogation typically develop more slowly and less smoothly than the losses they offset; select recovery factors from recovery experience rather than borrowing loss LDFs",
  ];

  const negativeOrigins = recoveries.origins.filter((_, i) =>
    recoveries.values[i]!.some((v) => isNum(v ?? null) && v! < 0),
  );
  if (negativeOrigins.length > 0) {
    warnings.push(
      `Negative cumulative recoveries for origin(s) ${negativeOrigins.join(", ")}; received salvage/subrogation should be non-negative - verify the data`,
    );
  }

  const cl = runChainLadder(recoveries, {
    selected: options.selected,
    tailFactor: options.tailFactor ?? 1,
  });
  warnings.push(...cl.warnings);

  return {
    method: "salvageSubro",
    basis: cl.basis,
    cdfs: cl.cdfs,
    percentDeveloped: cl.percentDeveloped,
    rows: cl.rows.map((r) => ({
      origin: r.origin,
      latestAge: r.latestAge,
      receivedToDate: r.latestValue,
      cdf: r.cdf,
      ultimateRecoveries: r.ultimate,
      futureRecoveries: r.unpaid,
    })),
    totals: {
      receivedToDate: cl.totals.latest,
      ultimateRecoveries: cl.totals.ultimate,
      futureRecoveries: cl.totals.unpaid,
    },
    warnings,
  };
}

export interface NetOfRecoveriesRow {
  origin: string;
  grossUltimate: number;
  ultimateRecoveries: number;
  netUltimate: number;
  grossUnpaid: number;
  futureRecoveries: number;
  netUnpaid: number;
}

export interface NetOfRecoveriesResult {
  method: "netOfRecoveries";
  basis: TriangleKind;
  rows: NetOfRecoveriesRow[];
  totals: {
    grossUltimate: number;
    ultimateRecoveries: number;
    netUltimate: number;
    grossUnpaid: number;
    futureRecoveries: number;
    netUnpaid: number;
  };
  warnings: string[];
}

/**
 * Nets a gross chain ladder against a recovery projection, aligned by origin
 * label. Origins missing on either side are warned and EXCLUDED - never
 * zero-filled - so the totals net exactly over the aligned origins.
 */
export function netOfRecoveries(
  gross: ChainLadderResult,
  recoveries: SalvageSubroResult,
): NetOfRecoveriesResult {
  const warnings: string[] = [];
  const recoveryByOrigin = new Map(recoveries.rows.map((r) => [r.origin, r]));
  const grossOrigins = new Set(gross.rows.map((r) => r.origin));

  const rows: NetOfRecoveriesRow[] = [];
  const negativeNetOrigins: string[] = [];
  for (const g of gross.rows) {
    const rec = recoveryByOrigin.get(g.origin);
    if (!rec) {
      warnings.push(
        `Origin ${g.origin} has no recovery projection; excluded from the net results (never zero-filled)`,
      );
      continue;
    }
    if (g.latestAge !== rec.latestAge) {
      warnings.push(
        `Origin ${g.origin}: gross projected from age ${g.latestAge} months but recoveries from age ${rec.latestAge}; the net mixes valuation dates`,
      );
    }
    const row: NetOfRecoveriesRow = {
      origin: g.origin,
      grossUltimate: g.ultimate,
      ultimateRecoveries: rec.ultimateRecoveries,
      netUltimate: g.ultimate - rec.ultimateRecoveries,
      grossUnpaid: g.unpaid,
      futureRecoveries: rec.futureRecoveries,
      netUnpaid: g.unpaid - rec.futureRecoveries,
    };
    if (row.netUltimate < 0 || row.netUnpaid < 0) negativeNetOrigins.push(g.origin);
    rows.push(row);
  }
  for (const rec of recoveries.rows) {
    if (!grossOrigins.has(rec.origin)) {
      warnings.push(
        `Origin ${rec.origin} has a recovery projection but no gross result; excluded from the net results (never zero-filled)`,
      );
    }
  }
  if (rows.length === 0) {
    throw new ReservingError(
      "NO_DATA",
      "No origin appears in both the gross and recovery projections",
    );
  }
  if (negativeNetOrigins.length > 0) {
    warnings.push(
      `Projected recoveries exceed gross losses for origin(s) ${negativeNetOrigins.join(", ")}; the net result is negative - verify the recovery development`,
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({
      grossUltimate: acc.grossUltimate + r.grossUltimate,
      ultimateRecoveries: acc.ultimateRecoveries + r.ultimateRecoveries,
      netUltimate: acc.netUltimate + r.netUltimate,
      grossUnpaid: acc.grossUnpaid + r.grossUnpaid,
      futureRecoveries: acc.futureRecoveries + r.futureRecoveries,
      netUnpaid: acc.netUnpaid + r.netUnpaid,
    }),
    {
      grossUltimate: 0,
      ultimateRecoveries: 0,
      netUltimate: 0,
      grossUnpaid: 0,
      futureRecoveries: 0,
      netUnpaid: 0,
    },
  );

  return { method: "netOfRecoveries", basis: gross.basis, rows, totals, warnings };
}
