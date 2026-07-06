import {
  berquistCaseAdequacy,
  berquistSettlement,
  buildTriangles,
  computeDevelopmentFactors,
  fitAllTails,
  isNum,
  ReservingError,
  runBornhuetterFerguson,
  runChainLadder,
  runDiagnostics,
  runMack,
  type BornhuetterFergusonResult,
  type ChainLadderResult,
  type DevelopmentFactors,
  type DiagnosticsResult,
  type MackResult,
  type TailFit,
  type Triangle,
  type TriangleSet,
} from "@actng/core";
import {
  defaultWorkspaceState,
  getClaims,
  getExposures,
  getWorkspaceState,
  insertAnalysis,
  saveWorkspaceState,
  type AnalysisRecord,
  type WorkspaceState,
} from "../db/repo.js";

/**
 * The workspace service: the single implementation of "what the analysis
 * currently looks like" that both the REST API and the advisor's tools call.
 * The advisor can never bypass this layer, so anything it changes is exactly
 * what a user changing the UI would produce.
 */

export class HttpError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface WorkspaceView {
  state: WorkspaceState;
  triangles: TriangleSet;
  /** Development factors for the active basis triangle. */
  factors: { paid: DevelopmentFactors; incurred: DevelopmentFactors };
  tailFits: {
    paid: { exponentialDecay: TailFit; inversePower: TailFit };
    incurred: { exponentialDecay: TailFit; inversePower: TailFit };
  };
  diagnostics: DiagnosticsResult;
  dataAsOf: { claimRows: number; claimCount: number };
}

function latestEvaluationDate(projectId: string): string | null {
  const claims = getClaims(projectId);
  if (claims.length === 0) return null;
  let latest = claims[0]!.evaluationDate;
  for (const c of claims) if (c.evaluationDate > latest) latest = c.evaluationDate;
  return latest;
}

export function ensureWorkspaceState(projectId: string): WorkspaceState {
  const existing = getWorkspaceState(projectId);
  if (existing) return existing;
  const asOf = latestEvaluationDate(projectId) ?? new Date().toISOString().slice(0, 10);
  const state = defaultWorkspaceState(asOf);
  saveWorkspaceState(projectId, state);
  return state;
}

export function buildProjectTriangles(projectId: string, state: WorkspaceState): TriangleSet {
  const claims = getClaims(projectId);
  if (claims.length === 0) {
    throw new HttpError(
      422,
      "NO_CLAIMS",
      "This project has no claim data yet; import a loss run first",
    );
  }
  try {
    return buildTriangles(claims, { cadence: state.cadence, asOfDate: state.asOfDate });
  } catch (err) {
    if (err instanceof ReservingError) {
      throw new HttpError(422, err.code, err.message);
    }
    throw err;
  }
}

/** Resizes a selections vector to the triangle's column count, preserving overlap. */
function fitSelections(selected: (number | null)[], nColumns: number): (number | null)[] {
  const out: (number | null)[] = new Array(nColumns).fill(null);
  for (let j = 0; j < Math.min(nColumns, selected.length); j++) out[j] = selected[j] ?? null;
  return out;
}

export function getWorkspaceView(projectId: string): WorkspaceView {
  const state = ensureWorkspaceState(projectId);
  const triangles = buildProjectTriangles(projectId, state);
  const nCols = Math.max(0, triangles.paid.ages.length - 1);

  // Keep stored selections consistent with the current triangle shape.
  const fittedPaid = fitSelections(state.selections.paid, nCols);
  const fittedIncurred = fitSelections(state.selections.incurred, nCols);
  if (
    fittedPaid.length !== state.selections.paid.length ||
    fittedIncurred.length !== state.selections.incurred.length
  ) {
    state.selections.paid = fittedPaid;
    state.selections.incurred = fittedIncurred;
    saveWorkspaceState(projectId, state);
  } else {
    state.selections.paid = fittedPaid;
    state.selections.incurred = fittedIncurred;
  }

  const claims = getClaims(projectId);
  return {
    state,
    triangles,
    factors: {
      paid: computeDevelopmentFactors(triangles.paid),
      incurred: computeDevelopmentFactors(triangles.incurred),
    },
    tailFits: {
      paid: fitAllTails(state.selections.paid),
      incurred: fitAllTails(state.selections.incurred),
    },
    diagnostics: runDiagnostics({
      paid: triangles.paid,
      incurred: triangles.incurred,
      openCounts: triangles.openCount,
      reportedCounts: triangles.reportedCount,
      closedCounts: triangles.closedCount,
    }),
    dataAsOf: {
      claimRows: claims.length,
      claimCount: new Set(claims.map((c) => c.claimId)).size,
    },
  };
}

export interface WorkspacePatch {
  cadence?: WorkspaceState["cadence"];
  asOfDate?: string;
  basis?: WorkspaceState["basis"];
  selections?: { basis: "paid" | "incurred"; selected: (number | null)[] };
  tail?: {
    basis: "paid" | "incurred";
    source: "manual" | "exponentialDecay" | "inversePower";
    value?: number;
  };
  bf?: { aprioriLossRatio: number | null };
  berquist?: { severityTrend?: number | null; interpolation?: "exponential" | "linear" };
}

export function patchWorkspace(projectId: string, patch: WorkspacePatch): WorkspaceView {
  const state = ensureWorkspaceState(projectId);

  if (patch.cadence && patch.cadence !== state.cadence) {
    state.cadence = patch.cadence;
    state.selections = { paid: [], incurred: [] };
  }
  if (patch.asOfDate && patch.asOfDate !== state.asOfDate) {
    state.asOfDate = patch.asOfDate;
    state.selections = { paid: [], incurred: [] };
  }
  if (patch.basis) state.basis = patch.basis;
  if (patch.bf) state.bf.aprioriLossRatio = patch.bf.aprioriLossRatio;
  if (patch.berquist) {
    if (patch.berquist.severityTrend !== undefined) {
      state.berquist.severityTrend = patch.berquist.severityTrend;
    }
    if (patch.berquist.interpolation) {
      state.berquist.interpolation = patch.berquist.interpolation;
    }
  }
  saveWorkspaceState(projectId, state);

  // Selections and tails validate against the current triangle shape.
  if (patch.selections) {
    const triangles = buildProjectTriangles(projectId, state);
    const nCols = Math.max(0, triangles.paid.ages.length - 1);
    if (patch.selections.selected.length !== nCols) {
      throw new HttpError(
        422,
        "SELECTION_SHAPE",
        `Expected ${nCols} LDF selections (one per development interval), got ${patch.selections.selected.length}`,
      );
    }
    for (const v of patch.selections.selected) {
      if (v !== null && (!isNum(v) || v <= 0)) {
        throw new HttpError(422, "BAD_SELECTION", "Selected LDFs must be positive numbers or null");
      }
    }
    state.selections[patch.selections.basis] = patch.selections.selected;
    saveWorkspaceState(projectId, state);
  }
  if (patch.tail) {
    const basis = patch.tail.basis;
    if (patch.tail.source === "manual") {
      if (!isNum(patch.tail.value ?? null) || patch.tail.value! <= 0) {
        throw new HttpError(422, "BAD_TAIL", "A manual tail requires a positive numeric value");
      }
      state.tail[basis] = { source: "manual", value: patch.tail.value! };
    } else {
      const fits = fitAllTails(state.selections[basis]);
      const fit = fits[patch.tail.source];
      if (!fit.valid) {
        throw new HttpError(
          422,
          "TAIL_FIT_INVALID",
          `The ${patch.tail.source} fit is not usable: ${fit.warnings.join("; ")}`,
        );
      }
      state.tail[basis] = { source: patch.tail.source, value: fit.tailFactor };
    }
    saveWorkspaceState(projectId, state);
  }

  return getWorkspaceView(projectId);
}

// ---------------------------------------------------------------------------
// Full analysis run

export interface MethodSummary {
  method: string;
  basis: "paid" | "incurred";
  ultimate: number;
  ibnr: number;
  unpaid: number;
  note?: string;
}

export interface AnalysisResults {
  ranAt: string;
  asOfDate: string;
  cadence: string;
  chainLadder: { paid: ChainLadderResult; incurred: ChainLadderResult };
  bornhuetterFerguson: {
    paid: BornhuetterFergusonResult | null;
    incurred: BornhuetterFergusonResult | null;
    skippedReason?: string;
  };
  berquistSherman: {
    caseAdequacy: {
      severityTrend: number;
      trendSource: string;
      warnings: string[];
      adjustedIncurredTriangle: Triangle;
      chainLadder: ChainLadderResult;
    } | null;
    settlement: {
      interpolation: string;
      warnings: string[];
      ultimateCounts: number[];
      adjustedPaidTriangle: Triangle;
      chainLadder: ChainLadderResult;
    } | null;
    skippedReason?: string;
  };
  mack: { paid: MackResult | null; incurred: MackResult | null; skippedReason?: string };
  diagnostics: DiagnosticsResult;
  summary: MethodSummary[];
  warnings: string[];
}

/** Total paid on the latest diagonal (for IBNR vs unpaid on incurred bases). */
function latestDiagonalTotal(tri: Triangle): number {
  let total = 0;
  for (const row of tri.values) {
    for (let j = row.length - 1; j >= 0; j--) {
      const v = row[j];
      if (v !== null && v !== undefined) {
        total += v;
        break;
      }
    }
  }
  return total;
}

/** Volume-weighted all-year selections for a triangle (used for adjusted triangles and counts). */
function volumeWeightedSelections(tri: Triangle): (number | null)[] {
  const dev = computeDevelopmentFactors(tri);
  return dev.averages.find((a) => a.spec.key === "all-wtd")?.values ?? [];
}

export function runFullAnalysis(projectId: string, label?: string): AnalysisRecord {
  const view = getWorkspaceView(projectId);
  const { state, triangles } = view;
  const warnings: string[] = [];

  const paidCl = runChainLadderOr422(
    triangles.paid,
    state.selections.paid,
    state.tail.paid.value,
    "paid",
  );
  const incurredCl = runChainLadderOr422(
    triangles.incurred,
    state.selections.incurred,
    state.tail.incurred.value,
    "incurred",
  );
  const paidAtDiagonal = latestDiagonalTotal(triangles.paid);

  // Bornhuetter-Ferguson (needs exposure data).
  const exposures = getExposures(projectId);
  let bfPaid: BornhuetterFergusonResult | null = null;
  let bfIncurred: BornhuetterFergusonResult | null = null;
  let bfSkipped: string | undefined;
  if (exposures.length === 0) {
    bfSkipped = "No exposure/premium data imported; Bornhuetter-Ferguson was skipped.";
    warnings.push(bfSkipped);
  } else {
    const bfOptions = {
      aprioriLossRatio: state.bf.aprioriLossRatio ?? undefined,
    };
    bfPaid = runBornhuetterFerguson(triangles.paid, paidCl, exposures, bfOptions);
    bfIncurred = runBornhuetterFerguson(triangles.incurred, incurredCl, exposures, bfOptions);
    warnings.push(...bfPaid.warnings, ...bfIncurred.warnings);
  }

  // Berquist-Sherman. Adjusted triangles get fresh volume-weighted selections
  // (the user's selections describe the unadjusted data, not the restated one).
  let bsCase: AnalysisResults["berquistSherman"]["caseAdequacy"] = null;
  let bsSettlement: AnalysisResults["berquistSherman"]["settlement"] = null;
  let bsSkipped: string | undefined;
  try {
    const caseAdj = berquistCaseAdequacy(
      triangles.paid,
      triangles.incurred,
      triangles.openCount,
      state.berquist.severityTrend !== null
        ? { severityTrend: state.berquist.severityTrend }
        : {},
    );
    const caseSelections = volumeWeightedSelections(caseAdj.adjustedIncurred);
    bsCase = {
      severityTrend: caseAdj.severityTrend,
      trendSource: caseAdj.trendSource,
      warnings: caseAdj.warnings,
      adjustedIncurredTriangle: caseAdj.adjustedIncurred,
      chainLadder: runChainLadder(caseAdj.adjustedIncurred, {
        selected: caseSelections,
        tailFactor: state.tail.incurred.value,
      }),
    };

    // Ultimate claim counts: chain ladder on reported counts, no tail.
    const countSelections = volumeWeightedSelections(triangles.reportedCount);
    const countCl = runChainLadder(triangles.reportedCount, {
      selected: countSelections,
      tailFactor: 1,
    });
    const ultimateCounts = triangles.reportedCount.origins.map((origin) => {
      const row = countCl.rows.find((r) => r.origin === origin);
      return row ? row.ultimate : 0;
    });
    const settlement = berquistSettlement(triangles.paid, triangles.closedCount, {
      ultimateCounts,
      interpolation: state.berquist.interpolation,
    });
    const settlementSelections = volumeWeightedSelections(settlement.adjustedPaid);
    bsSettlement = {
      interpolation: settlement.interpolation,
      warnings: settlement.warnings,
      ultimateCounts,
      adjustedPaidTriangle: settlement.adjustedPaid,
      chainLadder: runChainLadder(settlement.adjustedPaid, {
        selected: settlementSelections,
        tailFactor: state.tail.paid.value,
      }),
    };
  } catch (err) {
    bsSkipped =
      err instanceof Error
        ? `Berquist-Sherman was skipped: ${err.message}`
        : "Berquist-Sherman was skipped";
    warnings.push(bsSkipped);
  }

  // Mack standard errors (volume-weighted factors by construction).
  let mackPaid: MackResult | null = null;
  let mackIncurred: MackResult | null = null;
  let mackSkipped: string | undefined;
  try {
    mackPaid = runMack(triangles.paid);
    mackIncurred = runMack(triangles.incurred);
  } catch (err) {
    mackSkipped =
      err instanceof Error ? `Mack was skipped: ${err.message}` : "Mack was skipped";
    warnings.push(mackSkipped);
  }

  const summary: MethodSummary[] = [];
  const push = (
    method: string,
    basis: "paid" | "incurred",
    totals: { ultimate: number },
    note?: string,
  ) => {
    const ibnr = totals.ultimate - latestDiagonalTotal(triangles.incurred);
    const unpaid = totals.ultimate - paidAtDiagonal;
    summary.push({ method, basis, ultimate: totals.ultimate, ibnr, unpaid, note });
  };
  push("Chain Ladder", "paid", paidCl.totals);
  push("Chain Ladder", "incurred", incurredCl.totals);
  if (bfPaid) push("Bornhuetter-Ferguson", "paid", bfPaid.totals);
  if (bfIncurred) push("Bornhuetter-Ferguson", "incurred", bfIncurred.totals);
  if (bsCase) {
    push(
      "Berquist-Sherman (case adequacy)",
      "incurred",
      bsCase.chainLadder.totals,
      "CL on adjusted incurred, fresh volume-weighted factors",
    );
  }
  if (bsSettlement) {
    push(
      "Berquist-Sherman (settlement rate)",
      "paid",
      bsSettlement.chainLadder.totals,
      "CL on adjusted paid, fresh volume-weighted factors",
    );
  }

  warnings.push(...paidCl.warnings, ...incurredCl.warnings);

  const results: AnalysisResults = {
    ranAt: new Date().toISOString(),
    asOfDate: state.asOfDate,
    cadence: state.cadence,
    chainLadder: { paid: paidCl, incurred: incurredCl },
    bornhuetterFerguson: { paid: bfPaid, incurred: bfIncurred, skippedReason: bfSkipped },
    berquistSherman: { caseAdequacy: bsCase, settlement: bsSettlement, skippedReason: bsSkipped },
    mack: { paid: mackPaid, incurred: mackIncurred, skippedReason: mackSkipped },
    diagnostics: view.diagnostics,
    summary,
    warnings,
  };

  const inputs = {
    selections: state.selections,
    tail: state.tail,
    bf: state.bf,
    berquist: state.berquist,
    cadence: state.cadence,
    asOfDate: state.asOfDate,
  };
  return insertAnalysis(
    projectId,
    label ?? `Analysis as of ${state.asOfDate}`,
    inputs,
    results,
  );
}

function runChainLadderOr422(
  tri: Triangle,
  selected: (number | null)[],
  tailFactor: number,
  basisLabel?: string,
): ChainLadderResult {
  try {
    return runChainLadder(tri, { selected, tailFactor });
  } catch (err) {
    if (err instanceof ReservingError) {
      const message =
        err.code === "NO_SELECTIONS" && basisLabel
          ? `No LDFs are selected on the ${basisLabel} basis. Switch to that basis and select factors (or ask the advisor to apply them) before running the full analysis.`
          : err.message;
      throw new HttpError(422, err.code, message);
    }
    throw err;
  }
}

/** Chain ladder under alternative inputs without persisting anything. */
export function runSensitivity(
  projectId: string,
  scenario: {
    basis: "paid" | "incurred";
    selections?: (number | null)[];
    tailFactor?: number;
  },
): {
  scenario: ChainLadderResult;
  current: ChainLadderResult;
  deltaUltimate: number;
  deltaUnpaid: number;
} {
  const view = getWorkspaceView(projectId);
  const tri = view.triangles[scenario.basis];
  const baseSelections = view.state.selections[scenario.basis];
  const baseTail = view.state.tail[scenario.basis].value;
  const current = runChainLadderOr422(tri, baseSelections, baseTail);
  const alt = runChainLadderOr422(
    tri,
    scenario.selections ?? baseSelections,
    scenario.tailFactor ?? baseTail,
  );
  return {
    scenario: alt,
    current,
    deltaUltimate: alt.totals.ultimate - current.totals.ultimate,
    deltaUnpaid: alt.totals.unpaid - current.totals.unpaid,
  };
}
