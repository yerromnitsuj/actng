import type {
  BornhuetterFergusonResult,
  BornhuetterFergusonRow,
  ChainLadderResult,
  ExposureRecord,
  Triangle,
} from "./types.js";
import { ReservingError } from "./types.js";
import { isNum, lastObservedIndex } from "./util.js";

/**
 * Bornhuetter-Ferguson method.
 *
 * Ground truth:
 * - Expected ultimate = a-priori loss ratio x earned premium.
 * - BF ultimate = actual to date + expected ultimate x (1 - 1/CDF).
 *
 * A-priori selection: by default, derived from the chain ladder ultimates of
 * mature origin periods (percent developed >= maturityThreshold), as the
 * premium-weighted loss ratio across those periods. The user (or the advisor)
 * can override with an explicit loss ratio, globally or per origin.
 */
export interface BfOptions {
  /** Global a-priori loss ratio override. */
  aprioriLossRatio?: number;
  /** Per-origin a-priori overrides (take precedence over the global value). */
  aprioriByOrigin?: Record<string, number>;
  /** Percent-developed cutoff for "mature" periods used to derive the default a-priori. */
  maturityThreshold?: number;
}

export function runBornhuetterFerguson(
  tri: Triangle,
  chainLadder: ChainLadderResult,
  exposures: ExposureRecord[],
  options: BfOptions = {},
): BornhuetterFergusonResult {
  const warnings: string[] = [];
  const maturityThreshold = options.maturityThreshold ?? 0.9;
  const premiumByOrigin = new Map(exposures.map((e) => [e.origin, e.earnedPremium]));

  // Default a-priori: premium-weighted CL loss ratio across mature periods.
  let derivedApriori: number | null = null;
  {
    let lossSum = 0;
    let premSum = 0;
    for (const row of chainLadder.rows) {
      const prem = premiumByOrigin.get(row.origin);
      if (!isNum(prem ?? null) || prem! <= 0) continue;
      if (row.percentDeveloped >= maturityThreshold) {
        lossSum += row.ultimate;
        premSum += prem!;
      }
    }
    if (premSum > 0) derivedApriori = lossSum / premSum;
  }
  if (derivedApriori === null && options.aprioriLossRatio === undefined) {
    // Fall back to all periods when nothing is mature enough.
    let lossSum = 0;
    let premSum = 0;
    for (const row of chainLadder.rows) {
      const prem = premiumByOrigin.get(row.origin);
      if (!isNum(prem ?? null) || prem! <= 0) continue;
      lossSum += row.ultimate;
      premSum += prem!;
    }
    if (premSum > 0) {
      derivedApriori = lossSum / premSum;
      warnings.push(
        "No origin period is mature enough to anchor the a-priori; derived it from all periods' chain ladder ultimates instead",
      );
    }
  }

  const clByOrigin = new Map(chainLadder.rows.map((r) => [r.origin, r]));
  const rows: BornhuetterFergusonRow[] = [];
  for (let i = 0; i < tri.origins.length; i++) {
    const origin = tri.origins[i]!;
    const cl = clByOrigin.get(origin);
    if (!cl) continue;
    const latestIdx = lastObservedIndex(tri.values[i]!);
    const latestValue = latestIdx >= 0 ? tri.values[i]![latestIdx]! : 0;
    const prem = premiumByOrigin.get(origin) ?? null;
    if (!isNum(prem) || prem <= 0) {
      warnings.push(`Origin ${origin} has no usable earned premium; excluded from BF`);
      continue;
    }
    const apriori =
      options.aprioriByOrigin?.[origin] ?? options.aprioriLossRatio ?? derivedApriori;
    if (!isNum(apriori ?? null)) {
      throw new ReservingError(
        "NO_APRIORI",
        "Cannot derive an a-priori loss ratio (no exposure data matched the triangle origins) and no override was supplied",
      );
    }
    const expectedUltimate = apriori! * prem;
    const expectedUnreported = expectedUltimate * (1 - 1 / cl.cdf);
    const ultimate = latestValue + expectedUnreported;
    rows.push({
      origin,
      latestValue,
      cdf: cl.cdf,
      aprioriLossRatio: apriori!,
      earnedPremium: prem,
      expectedUltimate,
      expectedUnreported,
      ultimate,
      unpaid: ultimate - latestValue,
    });
  }

  if (rows.length === 0) {
    throw new ReservingError(
      "NO_BF_ROWS",
      "Bornhuetter-Ferguson produced no rows; check that exposure origins match the triangle origins",
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({
      latest: acc.latest + r.latestValue,
      ultimate: acc.ultimate + r.ultimate,
      unpaid: acc.unpaid + r.unpaid,
    }),
    { latest: 0, ultimate: 0, unpaid: 0 },
  );

  return { method: "bornhuetterFerguson", basis: tri.kind, rows, totals, warnings };
}
