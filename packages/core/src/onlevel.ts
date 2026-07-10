import { ReservingError } from "./types.js";
import { isNum } from "./util.js";

/**
 * Parallelogram-method premium on-leveling (Werner & Modlin ch. 5).
 *
 * Assumptions, stated plainly: policies carry an ANNUAL term, are written
 * uniformly through time, and premium earns evenly over the policy term. A
 * rate change applies to policies WRITTEN on or after its effective date.
 * Under those assumptions the share of a calendar period's EARNED premium
 * sitting at each historical rate level is a piece of parallelogram
 * geometry, computed here exactly (piecewise-linear integration, no grids).
 *
 * The on-level factor for a period = current cumulative rate level divided
 * by the average rate level earned in that period.
 */

export interface RateChange {
  /** ISO date the change takes effect (applies to policies written on/after it). */
  effectiveDate: string;
  /** Rate change, e.g. 0.05 = +5%. */
  change: number;
}

export interface OnLevelRow {
  origin: string;
  /** Average relative rate level earned in the period (1 = initial level). */
  averageRateLevel: number;
  /** currentLevel / averageRateLevel. */
  onLevelFactor: number;
}

export interface OnLevelResult {
  rows: OnLevelRow[];
  /** Cumulative rate level after all changes (1 = initial level). */
  currentLevel: number;
  warnings: string[];
}

/** ISO date -> fractional year (2021-07-01 -> ~2021.5). */
function dateToYearFraction(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) {
    throw new ReservingError("BAD_DATE", `Not an ISO date: ${iso}`);
  }
  const year = Number(m[1]);
  const start = Date.UTC(year, 0, 1);
  const next = Date.UTC(year + 1, 0, 1);
  const t = Date.UTC(year, Number(m[2]) - 1, Number(m[3]));
  return year + (t - start) / (next - start);
}

/** Origin label -> [start, end) in fractional years ("2021" or "2021Q3"). */
function originInterval(origin: string): [number, number] {
  const year = Number(origin.slice(0, 4));
  if (!Number.isInteger(year)) {
    throw new ReservingError("BAD_ORIGIN", `Cannot parse an origin period from "${origin}"`);
  }
  const qMatch = /Q([1-4])$/.exec(origin);
  if (qMatch) {
    const q = Number(qMatch[1]);
    return [year + (q - 1) / 4, year + q / 4];
  }
  return [year, year + 1];
}

/**
 * Earned-premium density of the period [p0, p1) by policy WRITTEN time w:
 * overlap of the earning interval [w, w+1] with [p0, p1). Integrated exactly
 * over [a, b] (the density is piecewise linear with breakpoints at p0-1,
 * p1-1, p0, p1).
 */
function earnedArea(p0: number, p1: number, a: number, b: number): number {
  const lo = Math.max(a, p0 - 1);
  const hi = Math.min(b, p1);
  if (hi <= lo) return 0;
  const density = (w: number): number =>
    Math.max(0, Math.min(p1, w + 1) - Math.max(p0, w));
  // Integrate exactly across the linear segments.
  const breaks = [p0 - 1, p1 - 1, p0, p1]
    .filter((x) => x > lo && x < hi)
    .sort((x, y) => x - y);
  const knots = [lo, ...breaks, hi];
  let area = 0;
  for (let i = 0; i + 1 < knots.length; i++) {
    const x0 = knots[i]!;
    const x1 = knots[i + 1]!;
    area += ((density(x0) + density(x1)) / 2) * (x1 - x0); // exact: linear segment
  }
  return area;
}

/**
 * On-level factors per origin period from a rate-change history. Changes
 * effective before all data simply set the base level; an empty history
 * yields factors of exactly 1.
 */
export function parallelogramOnLevel(
  origins: string[],
  history: RateChange[],
): OnLevelResult {
  const warnings: string[] = [];
  for (const rc of history) {
    if (!isNum(rc.change) || rc.change <= -1) {
      throw new ReservingError(
        "BAD_RATE_CHANGE",
        "A rate change must be a number greater than -100%",
      );
    }
  }
  const changes = [...history]
    .map((rc) => ({ at: dateToYearFraction(rc.effectiveDate), change: rc.change }))
    .sort((a, b) => a.at - b.at);

  // Rate-level eras: [eraStart_i, eraStart_{i+1}) at cumulative level_i.
  const eras: { from: number; level: number }[] = [{ from: -Infinity, level: 1 }];
  let level = 1;
  for (const c of changes) {
    level *= 1 + c.change;
    eras.push({ from: c.at, level });
  }
  const currentLevel = level;

  const rows: OnLevelRow[] = origins.map((origin) => {
    const [p0, p1] = originInterval(origin);
    const total = earnedArea(p0, p1, -Infinity, p1);
    if (!(total > 0)) {
      throw new ReservingError("BAD_ORIGIN", `Origin "${origin}" has no earnable area`);
    }
    let weighted = 0;
    for (let i = 0; i < eras.length; i++) {
      const from = eras[i]!.from;
      const to = i + 1 < eras.length ? eras[i + 1]!.from : Infinity;
      const share = earnedArea(p0, p1, from, to) / total;
      weighted += share * eras[i]!.level;
    }
    return {
      origin,
      averageRateLevel: weighted,
      onLevelFactor: currentLevel / weighted,
    };
  });

  if (changes.length > 0) {
    const lastOriginEnd = Math.max(...origins.map((o) => originInterval(o)[1]));
    const beyond = changes.filter((c) => c.at >= lastOriginEnd);
    if (beyond.length > 0) {
      warnings.push(
        `${beyond.length} rate change(s) effective after the last origin period only move the current level (nothing historical to restate)`,
      );
    }
  }

  return { rows, currentLevel, warnings };
}
