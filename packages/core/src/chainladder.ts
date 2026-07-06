import type { ChainLadderResult, ChainLadderRow, LdfSelections, Triangle } from "./types.js";
import { ReservingError } from "./types.js";
import { isNum, lastObservedIndex } from "./util.js";

/**
 * Chain Ladder (development) method.
 *
 * Ground truth:
 * - CDFs are computed right to left: CDF at the last observed age = tail
 *   factor; CDF_j = LDF_j x CDF_{j+1}.
 * - Percent developed = 1 / CDF.
 * - Ultimate = latest diagonal value x CDF at its age.
 * - IBNR (incurred basis) / unpaid (paid basis) = ultimate - current.
 * - Missing LDF selections: warn loudly and treat as 1.0; refuse to run when
 *   ALL selections are missing.
 */
export function runChainLadder(tri: Triangle, selections: LdfSelections): ChainLadderResult {
  const nAges = tri.ages.length;
  const nLdfs = nAges - 1;
  if (selections.selected.length !== nLdfs) {
    throw new ReservingError(
      "SELECTION_SHAPE",
      `Expected ${nLdfs} LDF selections (one per development interval), got ${selections.selected.length}`,
    );
  }
  if (!isNum(selections.tailFactor) || selections.tailFactor <= 0) {
    throw new ReservingError("BAD_TAIL", "Tail factor must be a positive number");
  }

  const warnings: string[] = [];
  const anySelected = selections.selected.some((s) => isNum(s));
  if (nLdfs > 0 && !anySelected) {
    throw new ReservingError(
      "NO_SELECTIONS",
      "No LDFs are selected for any development interval; select factors before running the analysis",
    );
  }

  const effective: number[] = selections.selected.map((s, j) => {
    if (isNum(s)) {
      if (s <= 0) {
        warnings.push(
          `Selected LDF for ${tri.ages[j]}-${tri.ages[j + 1]} months is not positive; treated as 1.000`,
        );
        return 1;
      }
      return s;
    }
    warnings.push(
      `Missing LDF selection for ${tri.ages[j]}-${tri.ages[j + 1]} months; treated as 1.000`,
    );
    return 1;
  });

  // Right-to-left cumulative development factors; cdfs[j] develops age[j] to ultimate.
  const cdfs: number[] = new Array(nAges).fill(selections.tailFactor);
  for (let j = nAges - 2; j >= 0; j--) {
    cdfs[j] = effective[j]! * cdfs[j + 1]!;
  }
  const percentDeveloped = cdfs.map((c) => 1 / c);

  const rows: ChainLadderRow[] = [];
  for (let i = 0; i < tri.origins.length; i++) {
    const latestIdx = lastObservedIndex(tri.values[i]!);
    if (latestIdx < 0) {
      warnings.push(`Origin ${tri.origins[i]} has no observed values; excluded from results`);
      continue;
    }
    const latestValue = tri.values[i]![latestIdx]!;
    const cdf = cdfs[latestIdx]!;
    const ultimate = latestValue * cdf;
    rows.push({
      origin: tri.origins[i]!,
      latestAge: tri.ages[latestIdx]!,
      latestValue,
      cdf,
      percentDeveloped: 1 / cdf,
      ultimate,
      unpaid: ultimate - latestValue,
    });
  }

  const totals = rows.reduce(
    (acc, r) => ({
      latest: acc.latest + r.latestValue,
      ultimate: acc.ultimate + r.ultimate,
      unpaid: acc.unpaid + r.unpaid,
    }),
    { latest: 0, ultimate: 0, unpaid: 0 },
  );

  return {
    method: "chainLadder",
    basis: tri.kind,
    cdfs,
    percentDeveloped,
    rows,
    totals,
    warnings,
  };
}
