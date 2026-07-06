import type {
  ClaimSnapshot,
  OriginCadence,
  Triangle,
  TriangleKind,
} from "./types.js";
import { ReservingError } from "./types.js";

/**
 * Builds development triangles from claim-level evaluation snapshots.
 *
 * Conventions:
 * - A claim belongs to the origin period containing its accident date.
 * - Development age is measured in months from the start of the origin
 *   period; the age-m evaluation date is the last day of month (start + m - 1).
 * - A cell is observable only when its evaluation date is on or before the
 *   as-of date; unobservable cells are null.
 * - A claim's state at an evaluation date is the latest snapshot on or
 *   before that date (step function). A reported claim with no snapshot yet
 *   counts as reported/open with zero paid and zero case.
 */

interface ParsedDate {
  y: number;
  m: number; // 1-12
  d: number;
}

function parseISO(date: string): ParsedDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) {
    throw new ReservingError("BAD_DATE", `Invalid ISO date: "${date}"`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    throw new ReservingError("BAD_DATE", `Invalid ISO date: "${date}"`);
  }
  return { y, m, d };
}

function monthIndex(p: ParsedDate): number {
  return p.y * 12 + (p.m - 1);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** ISO date of the last day of the month holding this month index. */
function endOfMonthISO(mIdx: number): string {
  const y = Math.floor(mIdx / 12);
  const m = (mIdx % 12) + 1;
  const d = daysInMonth(y, m);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function periodIndexOf(p: ParsedDate, cadence: OriginCadence): number {
  return cadence === "annual" ? p.y : p.y * 4 + Math.floor((p.m - 1) / 3);
}

function periodLabel(index: number, cadence: OriginCadence): string {
  if (cadence === "annual") return String(index);
  const y = Math.floor(index / 4);
  const q = (index % 4) + 1;
  return `${y}Q${q}`;
}

/** Month index of the first month of an origin period. */
function periodStartMonth(index: number, cadence: OriginCadence): number {
  return cadence === "annual" ? index * 12 : index * 3;
}

export interface BuildTrianglesOptions {
  cadence: OriginCadence;
  /** ISO evaluation date of the analysis (the latest diagonal). */
  asOfDate: string;
}

export interface TriangleSet {
  paid: Triangle;
  incurred: Triangle;
  caseReserve: Triangle;
  reportedCount: Triangle;
  openCount: Triangle;
  closedCount: Triangle;
  closedWithPayCount: Triangle;
}

interface ClaimTimeline {
  originIdx: number;
  reportISO: string;
  /** Snapshots sorted ascending by evaluation date. */
  snapshots: ClaimSnapshot[];
}

export function buildTriangles(
  claims: ClaimSnapshot[],
  options: BuildTrianglesOptions,
): TriangleSet {
  const { cadence, asOfDate } = options;
  if (claims.length === 0) {
    throw new ReservingError("NO_CLAIMS", "Cannot build triangles from an empty loss run");
  }
  const asOf = parseISO(asOfDate);
  const asOfMonth = monthIndex(asOf);
  const asOfIsMonthEnd = asOf.d === daysInMonth(asOf.y, asOf.m);
  // The latest complete evaluation month.
  const lastCompleteMonth = asOfIsMonthEnd ? asOfMonth : asOfMonth - 1;
  const cadenceMonths = cadence === "annual" ? 12 : 3;

  // Group snapshots into claim timelines and find the origin period range.
  const byClaim = new Map<string, ClaimTimeline>();
  let minPeriod = Infinity;
  let maxPeriod = -Infinity;
  for (const snap of claims) {
    const accident = parseISO(snap.accidentDate);
    if (snap.evaluationDate > asOfDate) continue; // beyond the analysis date
    const period = periodIndexOf(accident, cadence);
    minPeriod = Math.min(minPeriod, period);
    maxPeriod = Math.max(maxPeriod, period);
    let timeline = byClaim.get(snap.claimId);
    if (!timeline) {
      timeline = { originIdx: period, reportISO: snap.reportDate, snapshots: [] };
      byClaim.set(snap.claimId, timeline);
    }
    timeline.snapshots.push(snap);
  }
  if (!Number.isFinite(minPeriod)) {
    throw new ReservingError(
      "NO_CLAIMS",
      "No claim snapshots fall on or before the as-of date",
    );
  }
  for (const timeline of byClaim.values()) {
    timeline.snapshots.sort((a, b) =>
      a.evaluationDate < b.evaluationDate ? -1 : a.evaluationDate > b.evaluationDate ? 1 : 0,
    );
  }

  const nOrigins = maxPeriod - minPeriod + 1;
  const origins: string[] = [];
  for (let p = minPeriod; p <= maxPeriod; p++) origins.push(periodLabel(p, cadence));

  // Ages available to the oldest origin period determine the column count.
  const oldestStart = periodStartMonth(minPeriod, cadence);
  const maxAge = lastCompleteMonth - oldestStart + 1;
  const nAges = Math.floor(maxAge / cadenceMonths);
  if (nAges < 1) {
    throw new ReservingError(
      "NO_DEVELOPMENT",
      "The as-of date precedes the first complete development age",
    );
  }
  const ages: number[] = [];
  for (let j = 1; j <= nAges; j++) ages.push(j * cadenceMonths);

  const mk = (kind: TriangleKind): Triangle => ({
    kind,
    origins: [...origins],
    ages: [...ages],
    values: Array.from({ length: nOrigins }, (_, i) =>
      ages.map((age) => {
        const evalMonth = periodStartMonth(minPeriod + i, cadence) + age - 1;
        return evalMonth <= lastCompleteMonth ? 0 : null;
      }),
    ),
  });

  const set: TriangleSet = {
    paid: mk("paid"),
    incurred: mk("incurred"),
    caseReserve: mk("caseReserve"),
    reportedCount: mk("reportedCount"),
    openCount: mk("openCount"),
    closedCount: mk("closedCount"),
    closedWithPayCount: mk("closedWithPayCount"),
  };

  const add = (tri: Triangle, i: number, j: number, v: number) => {
    const cell = tri.values[i]![j];
    if (cell !== null && cell !== undefined) tri.values[i]![j] = cell + v;
  };

  for (const timeline of byClaim.values()) {
    const i = timeline.originIdx - minPeriod;
    const originStart = periodStartMonth(timeline.originIdx, cadence);
    for (let j = 0; j < nAges; j++) {
      const evalMonth = originStart + ages[j]! - 1;
      if (evalMonth > lastCompleteMonth) break; // this and later cells are null
      const evalISO = endOfMonthISO(evalMonth);
      if (timeline.reportISO > evalISO) continue; // not yet reported
      // Latest snapshot on or before the cell's evaluation date.
      let state: ClaimSnapshot | null = null;
      for (const snap of timeline.snapshots) {
        if (snap.evaluationDate <= evalISO) state = snap;
        else break;
      }
      const paid = state?.paidToDate ?? 0;
      const caseReserve = state?.status === "open" ? (state?.caseReserve ?? 0) : 0;
      const isClosed = state?.status === "closed";
      add(set.reportedCount, i, j, 1);
      add(set.paid, i, j, paid);
      add(set.caseReserve, i, j, caseReserve);
      add(set.incurred, i, j, paid + caseReserve);
      if (isClosed) {
        add(set.closedCount, i, j, 1);
        if (paid > 0) add(set.closedWithPayCount, i, j, 1);
      } else {
        add(set.openCount, i, j, 1);
      }
    }
  }

  return set;
}

/** Constructs a triangle directly from a grid of values (import path). */
export function triangleFromGrid(
  kind: TriangleKind,
  origins: string[],
  ages: number[],
  values: (number | null)[][],
): Triangle {
  if (values.length !== origins.length) {
    throw new ReservingError("SHAPE", "Row count does not match origin count");
  }
  for (const row of values) {
    if (row.length !== ages.length) {
      throw new ReservingError("SHAPE", "Column count does not match age count");
    }
  }
  return { kind, origins: [...origins], ages: [...ages], values: values.map((r) => [...r]) };
}
