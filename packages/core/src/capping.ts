import type { ClaimSnapshot } from "./types.js";
import { ReservingError } from "./types.js";
import { isNum } from "./util.js";

/**
 * Claim-level loss capping: the foundation of developing a reliable layer.
 *
 * Large losses are volatile and distort development patterns; capping every
 * claim at a per-occurrence limit and developing the capped ("limited")
 * triangles gives stable factors. The excess layer is restored later via
 * increased-limits factors, applied to the developed capped ultimates.
 *
 * The cap can be INDEXED: stated at a base-year cost level and moved by an
 * annual rate so the layer stays constant in real terms across origin years
 * (a flat $250k cap in 2016 is a deeper real layer than in 2025). indexRate 0
 * reproduces the flat-cap convention.
 */

export interface CapOptions {
  /** Per-occurrence cap, stated at the baseYear cost level. */
  cap: number;
  /** Annual index rate moving the cap across accident years (0 = flat cap). */
  indexRate?: number;
  /**
   * Accident year at whose cost level `cap` is stated. Defaults to the latest
   * accident year present in the data.
   */
  baseYear?: number;
}

function accidentYear(snap: ClaimSnapshot): number {
  return Number(snap.accidentDate.slice(0, 4));
}

/**
 * The default base year for a cap index: the latest accident year with a
 * snapshot evaluated on or before asOfDate. capClaims and
 * claimSizeDiagnostics MUST resolve this identically, or the applied caps
 * diverge from what the exhibits report; services should resolve it once via
 * this helper and pass baseYear explicitly to both.
 */
export function latestAccidentYear(claims: ClaimSnapshot[], asOfDate?: string): number {
  const asOf = asOfDate ?? "9999-12-31";
  let year = -Infinity;
  for (const snap of claims) {
    if (snap.evaluationDate > asOf) continue;
    year = Math.max(year, accidentYear(snap));
  }
  if (!Number.isFinite(year)) {
    throw new ReservingError(
      "NO_CLAIMS",
      "No claim snapshots on or before the analysis date; cannot resolve a cap base year",
    );
  }
  return year;
}

/** The effective cap for one accident year under the index. */
export function effectiveCap(options: Required<CapOptions>, year: number): number {
  return options.cap * Math.pow(1 + options.indexRate, year - options.baseYear);
}

function resolveOptions(claims: ClaimSnapshot[], options: CapOptions): Required<CapOptions> {
  if (!isNum(options.cap) || options.cap <= 0) {
    throw new ReservingError("BAD_CAP", "The per-occurrence cap must be a positive number");
  }
  const indexRate = options.indexRate ?? 0;
  if (!isNum(indexRate) || indexRate <= -1) {
    throw new ReservingError("BAD_CAP", "The cap index rate must be a number greater than -100%");
  }
  let baseYear = options.baseYear ?? null;
  if (baseYear === null) {
    baseYear = -Infinity;
    for (const snap of claims) baseYear = Math.max(baseYear, accidentYear(snap));
  }
  if (!isNum(baseYear) || !Number.isFinite(baseYear)) {
    throw new ReservingError("BAD_CAP", "Could not resolve a base year for the cap index");
  }
  return { cap: options.cap, indexRate, baseYear };
}

/**
 * Caps every snapshot at the (indexed) per-occurrence limit for its accident
 * year: capped incurred = min(reported incurred, cap_y); capped paid =
 * min(paid, cap_y); capped case = capped incurred - capped paid (never
 * negative by construction). Claim counts and statuses are untouched - the
 * cap limits dollars, not claims.
 */
export function capClaims(claims: ClaimSnapshot[], options: CapOptions): ClaimSnapshot[] {
  const resolved = resolveOptions(claims, options);
  return claims.map((snap) => {
    const capY = effectiveCap(resolved, accidentYear(snap));
    const incurred = snap.paidToDate + snap.caseReserve;
    const cappedIncurred = Math.min(incurred, capY);
    const cappedPaid = Math.min(snap.paidToDate, capY);
    if (cappedIncurred === incurred && cappedPaid === snap.paidToDate) return snap;
    return {
      ...snap,
      paidToDate: cappedPaid,
      caseReserve: cappedIncurred - cappedPaid,
    };
  });
}

// ---------------------------------------------------------------------------
// Cap-selection diagnostics: the evidence an actuary picks the layer from.

export interface ClaimSizeYearRow {
  year: number;
  claimCount: number;
  /** Reported incurred at each claim's latest evaluation. */
  totalIncurred: number;
  maxClaim: number;
  percentiles: { p: number; value: number }[];
}

export interface CapCandidateYearCell {
  year: number;
  /** The candidate cap at this year's cost level (indexed). */
  effectiveCap: number;
  /** Claims whose reported incurred pierces the effective cap. */
  pierceCount: number;
  pierceShare: number;
  /** Dollars above the cap as a share of total reported incurred. */
  excessShare: number;
}

export interface CapCandidate {
  /** Candidate cap stated at the base-year cost level. */
  cap: number;
  byYear: CapCandidateYearCell[];
  totalPierceCount: number;
  totalPierceShare: number;
  totalExcessShare: number;
}

export interface ClaimSizeDiagnostics {
  years: ClaimSizeYearRow[];
  candidates: CapCandidate[];
  baseYear: number;
  indexRate: number;
  /** Claims with a positive reported incurred at their latest evaluation. */
  nonZeroClaimCount: number;
}

export interface ClaimSizeDiagnosticsOptions {
  /** Only snapshots evaluated on or before this ISO date are considered. */
  asOfDate?: string;
  /** Candidate caps stated at the base-year level; sensible defaults derived if omitted. */
  candidateCaps?: number[];
  /** Caps merged into the derived defaults (e.g. the currently-set cap). */
  extraCaps?: number[];
  indexRate?: number;
  baseYear?: number;
}

const PERCENTILES = [0.5, 0.75, 0.9, 0.95, 0.99];

// Crude empirical convention (ceil-rank, no interpolation) is deliberate:
// candidate caps get rounded to 1-2 significant digits right after, so the
// interpolated refinement in stochastic.ts's percentileOfSorted buys nothing.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

/** Round to 1-2 significant digits for readable candidate caps. */
function roundCandidate(value: number): number {
  if (value <= 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const scaled = value / magnitude;
  const nice = scaled < 1.5 ? 1 : scaled < 3.5 ? 2.5 : scaled < 7.5 ? 5 : 10;
  return nice * magnitude;
}

/**
 * Latest-evaluation claim-size distribution by accident year plus pierce and
 * excess-share statistics for a set of candidate caps (indexed to each year).
 */
export function claimSizeDiagnostics(
  claims: ClaimSnapshot[],
  options: ClaimSizeDiagnosticsOptions = {},
): ClaimSizeDiagnostics {
  if (claims.length === 0) {
    throw new ReservingError("NO_CLAIMS", "Cannot analyze claim sizes with no claims");
  }
  const asOf = options.asOfDate ?? "9999-12-31";
  // Latest evaluation per claim on or before the analysis date.
  const latest = new Map<string, ClaimSnapshot>();
  for (const snap of claims) {
    if (snap.evaluationDate > asOf) continue;
    const prev = latest.get(snap.claimId);
    if (!prev || snap.evaluationDate > prev.evaluationDate) latest.set(snap.claimId, snap);
  }

  const byYear = new Map<number, number[]>();
  for (const snap of latest.values()) {
    const year = accidentYear(snap);
    const incurred = snap.paidToDate + snap.caseReserve;
    let arr = byYear.get(year);
    if (!arr) byYear.set(year, (arr = []));
    arr.push(incurred);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const indexRate = options.indexRate ?? 0;
  const baseYear = options.baseYear ?? years[years.length - 1]!;

  const yearRows: ClaimSizeYearRow[] = years.map((year) => {
    const sorted = [...byYear.get(year)!].sort((a, b) => a - b);
    return {
      year,
      claimCount: sorted.length,
      totalIncurred: sorted.reduce((a, v) => a + v, 0),
      maxClaim: sorted[sorted.length - 1] ?? 0,
      percentiles: PERCENTILES.map((p) => ({ p, value: percentile(sorted, p) })),
    };
  });

  // Candidate caps: provided, or derived from the pooled distribution so the
  // menu spans "caps almost nothing" to "caps only the extreme tail".
  // Candidates are STATED at the base-year cost level, so each claim's
  // incurred is deflated to that level before taking percentiles - otherwise
  // a nominal anchor re-indexed forward overshoots the whole distribution
  // and every derived candidate reads near-zero pierce.
  let candidateCaps = options.candidateCaps;
  if (!candidateCaps || candidateCaps.length === 0) {
    const pooled = [...latest.values()]
      .map((s) => {
        const incurred = s.paidToDate + s.caseReserve;
        return incurred / Math.pow(1 + indexRate, accidentYear(s) - baseYear);
      })
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const anchors = [0.75, 0.9, 0.95, 0.99].map((p) => percentile(pooled, p));
    const uniq = new Set<number>();
    for (const a of anchors) {
      const rounded = roundCandidate(a);
      if (rounded > 0) uniq.add(rounded);
    }
    for (const extra of options.extraCaps ?? []) {
      if (extra > 0) uniq.add(extra);
    }
    candidateCaps = [...uniq].sort((a, b) => a - b);
  }

  const resolved: Required<CapOptions> = { cap: 1, indexRate, baseYear };
  const candidates: CapCandidate[] = candidateCaps.map((cap) => {
    let totalPierce = 0;
    let totalClaims = 0;
    let totalExcess = 0;
    let totalIncurred = 0;
    const cells: CapCandidateYearCell[] = years.map((year) => {
      const capY = cap * Math.pow(1 + resolved.indexRate, year - resolved.baseYear);
      const values = byYear.get(year)!;
      let pierce = 0;
      let excess = 0;
      let incurred = 0;
      for (const v of values) {
        incurred += v;
        if (v > capY) {
          pierce++;
          excess += v - capY;
        }
      }
      totalPierce += pierce;
      totalClaims += values.length;
      totalExcess += excess;
      totalIncurred += incurred;
      return {
        year,
        effectiveCap: capY,
        pierceCount: pierce,
        pierceShare: values.length > 0 ? pierce / values.length : 0,
        excessShare: incurred > 0 ? excess / incurred : 0,
      };
    });
    return {
      cap,
      byYear: cells,
      totalPierceCount: totalPierce,
      totalPierceShare: totalClaims > 0 ? totalPierce / totalClaims : 0,
      totalExcessShare: totalIncurred > 0 ? totalExcess / totalIncurred : 0,
    };
  });

  return {
    years: yearRows,
    candidates,
    baseYear,
    indexRate,
    nonZeroClaimCount: [...latest.values()].filter((s) => s.paidToDate + s.caseReserve > 0)
      .length,
  };
}
