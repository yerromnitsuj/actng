import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { isNum, type DevelopmentFactors, type Triangle } from "@actng/core";
import {
  activeBf,
  activeSelections,
  activeTail,
  getWorkspaceView,
  patchWorkspace,
  runFullAnalysis,
  runSensitivity,
  HttpError,
} from "../services/workspaceService.js";
import { claimSizeDiagnostics, fitAllTails } from "@actng/core";
import {
  getAnalysis,
  getClaims,
  getExposures,
  insertNote,
  latestAnalysis,
} from "../db/repo.js";
import type { AnalysisResults } from "../services/workspaceService.js";

/**
 * Advisor tools. Two classes:
 * - read/analyze: analyze the triangle, factor stability, tails, data quality
 * - action: apply selections, set the tail, run analyses, sensitivities, notes
 *
 * SECURITY BOUNDARY: the project id ALWAYS comes from the server-side request
 * context (set by the chat route from the authenticated URL), never from the
 * model. No tool declares projectId in its input schema.
 *
 * Error contract: tools never throw. Failures return
 * { success: false, error: { code, message } } so the agent can recover
 * (retry with adjusted parameters, suggest an alternative, or ask).
 */

type ToolCtx = { requestContext?: { get(key: string): unknown } };

function projectIdOf(context: ToolCtx): string {
  const id = context.requestContext?.get("projectId");
  if (typeof id !== "string" || id.length === 0) {
    throw new HttpError(500, "NO_PROJECT_CONTEXT", "Tool invoked without a project context");
  }
  return id;
}

type ToolFailure = { success: false; error: { code: string; message: string } };

function failure(err: unknown): ToolFailure {
  if (err instanceof HttpError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return { success: false, error: { code: "TOOL_ERROR", message } };
}

const round3 = (v: number | null): number | null => (isNum(v) ? Math.round(v * 1000) / 1000 : null);
const round0 = (v: number): number => Math.round(v);

const basisSchema = z
  .enum(["paid", "incurred"])
  .nullable()
  .describe("Triangle basis; defaults to the workspace's active basis when null");

function factorColumnSummaries(factors: DevelopmentFactors, tri: Triangle) {
  return factors.fromAges.map((fromAge, j) => {
    const column = factors.individual
      .map((row, i) => ({ origin: tri.origins[i]!, factor: row[j] ?? null }))
      .filter((e): e is { origin: string; factor: number } => isNum(e.factor));
    const values = column.map((e) => e.factor);
    const n = values.length;
    const mean = n > 0 ? values.reduce((a, b) => a + b, 0) / n : null;
    let cv: number | null = null;
    if (n > 1 && isNum(mean) && mean !== 0) {
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
      cv = Math.sqrt(variance) / mean;
    }
    return {
      development: `${fromAge}-${factors.toAges[j]}`,
      columnIndex: j,
      nFactors: n,
      min: n ? round3(Math.min(...values)) : null,
      max: n ? round3(Math.max(...values)) : null,
      mean: round3(mean),
      coefficientOfVariation: round3(cv),
      mostRecent: column.slice(-3).map((e) => ({ origin: e.origin, factor: round3(e.factor) })),
      averages: Object.fromEntries(
        factors.averages.map((a) => [a.spec.key, round3(a.values[j] ?? null)]),
      ),
    };
  });
}

function analysisSummaryPayload(results: AnalysisResults) {
  return {
    ranAt: results.ranAt,
    asOfDate: results.asOfDate,
    methodSummary: results.summary.map((s) => ({
      method: s.method,
      basis: s.basis,
      ultimate: round0(s.ultimate),
      ibnr: round0(s.ibnr),
      unpaid: round0(s.unpaid),
      note: s.note,
    })),
    chainLadderByOrigin: {
      paid: results.chainLadder.paid.rows.map((r) => ({
        origin: r.origin,
        latest: round0(r.latestValue),
        cdf: round3(r.cdf),
        ultimate: round0(r.ultimate),
        unpaid: round0(r.unpaid),
      })),
      incurred: results.chainLadder.incurred.rows.map((r) => ({
        origin: r.origin,
        latest: round0(r.latestValue),
        cdf: round3(r.cdf),
        ultimate: round0(r.ultimate),
        ibnr: round0(r.unpaid),
      })),
    },
    mack: results.mack.paid
      ? {
          paidTotalReserve: round0(results.mack.paid.totals.reserve),
          paidTotalStandardError: round0(results.mack.paid.totals.standardError),
          incurredTotalReserve: results.mack.incurred
            ? round0(results.mack.incurred.totals.reserve)
            : null,
          incurredTotalStandardError: results.mack.incurred
            ? round0(results.mack.incurred.totals.standardError)
            : null,
        }
      : null,
    diagnosticFindings: results.diagnostics.findings,
    warnings: results.warnings,
  };
}

// ---------------------------------------------------------------------------
// READ / ANALYZE TOOLS

export const getWorkspaceOverview = createTool({
  id: "get_workspace_overview",
  description:
    "Get the current state of the reserving workspace: triangle dimensions, basis, evaluation date, current LDF selections and tails, data volumes, and the latest analysis totals. Call this first in a conversation to orient yourself.",
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = getWorkspaceView(projectId);
      const latest = latestAnalysis(projectId);
      const exposures = getExposures(projectId);
      return {
        success: true,
        basis: view.state.basis,
        cadence: view.state.cadence,
        asOfDate: view.state.asOfDate,
        origins: view.triangles.paid.origins,
        agesMonths: view.triangles.paid.ages,
        layer: view.state.layer,
        selections: {
          paid: activeSelections(view.state).paid.map(round3),
          incurred: activeSelections(view.state).incurred.map(round3),
        },
        tails: activeTail(view.state),
        bfAprioriOverride: activeBf(view.state).aprioriLossRatio,
        exposures: exposures.map((e) => ({
          origin: e.origin,
          earnedPremium: round0(e.earnedPremium),
        })),
        data: view.dataAsOf,
        diagnosticHeadlines: view.diagnostics.findings.map((f) => `${f.severity}: ${f.message}`),
        latestAnalysis: latest
          ? { id: latest.id, label: latest.label, createdAt: latest.createdAt }
          : null,
        ultimateSelection: view.ultimateSelection
          ? {
              defaultMethodWeights: Object.fromEntries(
                view.ultimateSelection.methods.map((m) => [m.key, m.weight]),
              ),
              customWeightOrigins: view.ultimateSelection.rows
                .filter((r) => r.customWeights)
                .map((r) => ({ origin: r.origin, weights: r.weights })),
              overriddenOrigins: view.ultimateSelection.rows
                .filter((r) => r.override !== null)
                .map((r) => ({ origin: r.origin, override: round0(r.override!) })),
              totals: {
                selectedUltimate:
                  view.ultimateSelection.totals.selected !== null
                    ? round0(view.ultimateSelection.totals.selected)
                    : null,
                selectedIbnr:
                  view.ultimateSelection.totals.ibnr !== null
                    ? round0(view.ultimateSelection.totals.ibnr)
                    : null,
                selectedUnpaid:
                  view.ultimateSelection.totals.unpaid !== null
                    ? round0(view.ultimateSelection.totals.unpaid)
                    : null,
              },
              unselectedOrigins: view.ultimateSelection.totals.unselectedOrigins,
            }
          : null,
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const analyzeDevelopmentFactors = createTool({
  id: "analyze_development_factors",
  description:
    "Analyze age-to-age development factors for a basis: per-column factor counts, dispersion (CV), the most recent factors, and the full averages menu (all-year and n-year straight and volume-weighted, medial, geometric). Use this before recommending LDF selections.",
  inputSchema: z.object({ basis: basisSchema }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = getWorkspaceView(projectId);
      const basis = input.basis ?? view.state.basis;
      const columns = factorColumnSummaries(view.factors[basis], view.triangles[basis]);
      return {
        success: true,
        basis,
        columns,
        currentSelections: activeSelections(view.state)[basis].map(round3),
        guidance:
          "Volume-weighted averages resist small-denominator noise; medial trims one-off shocks; compare the most recent factors against all-year averages to spot drift before selecting.",
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const fitTailCurves = createTool({
  id: "fit_tail_curves",
  description:
    "Fit exponential-decay and inverse-power tail curves (Sherman 1984 / Boor 2006) to the currently selected LDFs (or to a candidate selection vector), returning fitted parameters, R-squared, extrapolated tail factors, and validity warnings.",
  inputSchema: z.object({
    basis: basisSchema,
    candidateSelections: z
      .array(z.number().nullable())
      .nullable()
      .describe(
        "Optional candidate LDF vector to fit instead of the currently applied selections (one entry per development column, null to skip a column)",
      ),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = getWorkspaceView(projectId);
      const basis = input.basis ?? view.state.basis;
      const ldfs = input.candidateSelections ?? activeSelections(view.state)[basis];
      const fits = fitAllTails(ldfs);
      const compact = (fit: (typeof fits)["exponentialDecay"]) => ({
        method: fit.method,
        valid: fit.valid,
        tailFactor: round3(fit.tailFactor),
        rSquared: isNum(fit.rSquared) ? round3(fit.rSquared) : null,
        slope: isNum(fit.slope) ? round3(fit.slope) : null,
        nPoints: fit.nPoints,
        warnings: fit.warnings,
      });
      return {
        success: true,
        basis,
        fittedOn: input.candidateSelections ? "candidate selections" : "applied selections",
        exponentialDecay: compact(fits.exponentialDecay),
        inversePower: compact(fits.inversePower),
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const assessDataQuality = createTool({
  id: "assess_data_quality",
  description:
    "Run the data-quality diagnostics an actuary checks before trusting development methods: paid-to-incurred ratio drift, average case reserve trends, closure-rate shifts, and Mack's calendar-year test. Returns findings with severities.",
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = getWorkspaceView(projectId);
      const d = view.diagnostics;
      const cy = d.calendarYearTest;
      return {
        success: true,
        findings: d.findings,
        calendarYearTest: cy
          ? {
              totalZ: round3(cy.totalZ),
              expectedZ: round3(cy.expectedTotalZ),
              confidenceInterval: cy.confidenceInterval.map((v) => round3(v)),
              significant: cy.significant,
            }
          : null,
        hint: "Use get_diagnostic_detail to see the underlying grid for any metric before explaining it to the user.",
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const getDiagnosticDetail = createTool({
  id: "get_diagnostic_detail",
  description:
    "Fetch the underlying by-origin, by-age grid for one diagnostic metric so you can cite the actual numbers: paid-to-incurred ratios, average case reserves, or closure rates.",
  inputSchema: z.object({
    metric: z.enum(["paidToIncurred", "averageCase", "closureRates"]),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = getWorkspaceView(projectId);
      const grid =
        input.metric === "paidToIncurred"
          ? view.diagnostics.paidToIncurredRatios
          : input.metric === "averageCase"
            ? view.diagnostics.averageCaseReserves
            : view.diagnostics.closureRates;
      const decimals = input.metric === "averageCase" ? 0 : 3;
      return {
        success: true,
        metric: input.metric,
        agesMonths: view.triangles.paid.ages,
        rows: view.triangles.paid.origins.map((origin, i) => ({
          origin,
          values: grid[i]!.map((v) =>
            isNum(v) ? Math.round(v * 10 ** decimals) / 10 ** decimals : null,
          ),
        })),
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const getAnalysisResults = createTool({
  id: "get_analysis_results",
  description:
    "Get the results of the latest analysis run (or a specific one by id): ultimates, IBNR, and unpaid by method and origin period, Mack standard errors, and warnings. The UI renders the full tables; use this to ground your commentary in the numbers.",
  inputSchema: z.object({
    analysisId: z.string().nullable().describe("Specific analysis id; latest when null"),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const record = input.analysisId ? getAnalysis(input.analysisId) : latestAnalysis(projectId);
      if (!record || record.projectId !== projectId) {
        return {
          success: false,
          error: {
            code: "NOT_FOUND",
            message:
              "No analysis found. Run one with run_analysis after selections are applied.",
          },
        } satisfies ToolFailure;
      }
      return {
        success: true,
        analysisId: record.id,
        label: record.label,
        ...analysisSummaryPayload(record.results as AnalysisResults),
      };
    } catch (err) {
      return failure(err);
    }
  },
});

// ---------------------------------------------------------------------------
// ACTION TOOLS

export const applyLdfSelections = createTool({
  id: "apply_ldf_selections",
  description:
    "Apply a full vector of selected LDFs to the workspace for a basis (one entry per development interval, oldest to newest age; null leaves an interval unselected). This changes the live workspace exactly as if the user clicked the values. Optionally set a manual tail factor at the same time.",
  inputSchema: z.object({
    basis: z.enum(["paid", "incurred"]),
    selections: z
      .array(z.number().positive().nullable())
      .describe("Selected LDF per development column, e.g. [2.85, 1.41, 1.18, ...]"),
    tailFactor: z
      .number()
      .positive()
      .nullable()
      .describe("Optional manual tail factor to set together with the selections"),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      let view = patchWorkspace(projectId, {
        selections: { basis: input.basis, selected: input.selections },
      });
      if (input.tailFactor !== null && input.tailFactor !== undefined) {
        view = patchWorkspace(projectId, {
          tail: { basis: input.basis, source: "manual", value: input.tailFactor },
        });
      }
      return {
        success: true,
        applied: {
          basis: input.basis,
          selections: activeSelections(view.state)[input.basis].map(round3),
          tail: activeTail(view.state)[input.basis],
        },
        message: `Applied ${input.selections.filter((s) => s !== null).length} LDF selection(s) on the ${input.basis} basis. The workspace UI now reflects them.`,
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const setTailFactor = createTool({
  id: "set_tail_factor",
  description:
    "Set the tail factor for a basis, either from a fitted curve (exponentialDecay or inversePower, fitted to the applied selections) or manually with an explicit value.",
  inputSchema: z.object({
    basis: z.enum(["paid", "incurred"]),
    source: z.enum(["exponentialDecay", "inversePower", "manual"]),
    value: z
      .number()
      .positive()
      .nullable()
      .describe("Required when source is manual; ignored for fitted sources"),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = patchWorkspace(projectId, {
        tail: { basis: input.basis, source: input.source, value: input.value ?? undefined },
      });
      return {
        success: true,
        applied: activeTail(view.state)[input.basis],
        message: `Tail for the ${input.basis} basis is now ${activeTail(view.state)[input.basis].value.toFixed(4)} (${input.source}).`,
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const runAnalysisTool = createTool({
  id: "run_analysis",
  description:
    "Run the full reserving analysis with the currently applied selections and tails: Chain Ladder (paid and incurred), Bornhuetter-Ferguson, Berquist-Sherman (both adjustments), Mack standard errors, and diagnostics. Persists the run and returns the summary.",
  inputSchema: z.object({
    label: z.string().nullable().describe("Optional label for this analysis run"),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const record = runFullAnalysis(projectId, input.label ?? undefined);
      return {
        success: true,
        analysisId: record.id,
        label: record.label,
        ...analysisSummaryPayload(record.results as AnalysisResults),
        message:
          "Analysis complete and persisted. The UI renders the full result tables; do not repeat them verbatim.",
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const runSensitivityTool = createTool({
  id: "run_sensitivity",
  description:
    "Compare a what-if chain ladder scenario (alternative LDF selections and/or tail) against the current selections WITHOUT changing the workspace. Returns both totals and the deltas.",
  inputSchema: z.object({
    basis: z.enum(["paid", "incurred"]),
    selections: z
      .array(z.number().positive().nullable())
      .nullable()
      .describe("Alternative LDF vector; null keeps current selections"),
    tailFactor: z.number().positive().nullable().describe("Alternative tail; null keeps current"),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const result = runSensitivity(projectId, {
        basis: input.basis,
        selections: input.selections ?? undefined,
        tailFactor: input.tailFactor ?? undefined,
      });
      return {
        success: true,
        basis: input.basis,
        current: {
          ultimate: round0(result.current.totals.ultimate),
          unpaid: round0(result.current.totals.unpaid),
        },
        scenario: {
          ultimate: round0(result.scenario.totals.ultimate),
          unpaid: round0(result.scenario.totals.unpaid),
        },
        deltaUltimate: round0(result.deltaUltimate),
        deltaUnpaid: round0(result.deltaUnpaid),
        scenarioWarnings: result.scenario.warnings,
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const setBfApriori = createTool({
  id: "set_bf_apriori",
  description:
    "Set (or clear) the Bornhuetter-Ferguson a-priori loss ratio override for this workspace. Pass a positive decimal (e.g. 0.65 for 65%) to override, or null to return to the default derived from mature chain ladder ultimates and earned premium. Rerun the analysis afterwards for it to take effect in results.",
  inputSchema: z.object({
    aprioriLossRatio: z
      .number()
      .positive()
      .max(5)
      .nullable()
      .describe("A-priori expected loss ratio; null resets to the derived value"),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = patchWorkspace(projectId, {
        bf: { aprioriLossRatio: input.aprioriLossRatio },
      });
      return {
        success: true,
        applied: activeBf(view.state).aprioriLossRatio,
        message:
          activeBf(view.state).aprioriLossRatio === null
            ? `BF a-priori override cleared for the ${view.state.layer.active} layer; the derived loss ratio will be used on the next run.`
            : `BF a-priori loss ratio override set to ${(activeBf(view.state).aprioriLossRatio! * 100).toFixed(1)}% for the ${view.state.layer.active} layer. Run the analysis for it to take effect.`,
      };
    } catch (err) {
      return failure(err);
    }
  },
});

const toolWeightsSchema = z
  .object({
    clPaid: z.number().min(0).nullable().describe("Chain Ladder paid weight"),
    clIncurred: z.number().min(0).nullable().describe("Chain Ladder incurred weight"),
    bfPaid: z.number().min(0).nullable().describe("Bornhuetter-Ferguson paid weight"),
    bfIncurred: z.number().min(0).nullable().describe("Bornhuetter-Ferguson incurred weight"),
    bsCase: z.number().min(0).nullable().describe("B-S case adequacy weight"),
    bsSettlement: z.number().min(0).nullable().describe("B-S settlement rate weight"),
  })
  .describe("Method weights; null entries and omissions keep current values");

function compactWeights(
  input: Record<string, number | null | undefined> | null | undefined,
): Record<string, number> | undefined {
  if (!input) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export const setUltimateSelection = createTool({
  id: "set_ultimate_selection",
  description:
    "Update the selection-of-ultimates exhibit. Weights are per ORIGIN PERIOD and method, renormalized within each period over the methods with values. Set `weights` to apply a method's credibility across ALL periods (overwrites per-period tweaks for that method), `perOriginWeights` to weight specific periods differently (e.g. BF on green years only), and/or `overrides` to hand-pick a period's selected ultimate (null clears back to the weighted value). Only provide what you want to change. The exhibit blends the LATEST analysis run's method ultimates.",
  inputSchema: z.object({
    weights: toolWeightsSchema
      .nullable()
      .describe("All-periods weight changes (also overwrite per-period entries for that method)"),
    perOriginWeights: z
      .array(
        z.object({
          origin: z.string().describe("Origin period label, e.g. '2023'"),
          weights: toolWeightsSchema,
        }),
      )
      .nullable()
      .describe("Per-origin-period weight changes, merged onto that period's current weights"),
    overrides: z
      .array(
        z.object({
          origin: z.string().describe("Origin period label, e.g. '2023'"),
          ultimate: z
            .number()
            .positive()
            .nullable()
            .describe("Manual selected ultimate; null clears the override"),
        }),
      )
      .nullable()
      .describe("Per-origin selected-ultimate overrides to change"),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const weights = compactWeights(input.weights);
      const weightsByOrigin: Record<string, Record<string, number>> = {};
      for (const entry of input.perOriginWeights ?? []) {
        const compact = compactWeights(entry.weights);
        if (compact) weightsByOrigin[entry.origin] = compact;
      }
      const overrides: Record<string, number | null> = {};
      for (const entry of input.overrides ?? []) {
        overrides[entry.origin] = entry.ultimate ?? null;
      }
      const view = patchWorkspace(projectId, {
        ultimateSelection: {
          weights,
          weightsByOrigin:
            Object.keys(weightsByOrigin).length > 0 ? weightsByOrigin : undefined,
          overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        },
      });
      const sel = view.ultimateSelection;
      if (!sel) {
        return {
          success: true,
          message:
            "Selection settings saved, but there is no analysis run yet to blend; run_analysis first.",
        };
      }
      return {
        success: true,
        defaultWeights: Object.fromEntries(sel.methods.map((m) => [m.key, m.weight])),
        rows: sel.rows.map((r) => ({
          origin: r.origin,
          weights: r.customWeights ? r.weights : "defaults",
          weighted: r.weighted !== null ? round0(r.weighted) : null,
          override: r.override !== null ? round0(r.override) : null,
          selected: r.selected !== null ? round0(r.selected) : null,
          ibnr: r.ibnr !== null ? round0(r.ibnr) : null,
          unpaid: r.unpaid !== null ? round0(r.unpaid) : null,
        })),
        totals: {
          selected: sel.totals.selected !== null ? round0(sel.totals.selected) : null,
          ibnr: sel.totals.ibnr !== null ? round0(sel.totals.ibnr) : null,
          unpaid: sel.totals.unpaid !== null ? round0(sel.totals.unpaid) : null,
          unselectedOrigins: sel.totals.unselectedOrigins,
        },
        message:
          "Selection updated. The UI's Selection of ultimates exhibit now reflects it; do not recite the whole table.",
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const analyzeClaimSizes = createTool({
  id: "analyze_claim_sizes",
  description:
    "Cap-selection evidence: the claim-size distribution by accident year (percentiles, max, counts), pierce counts and excess-dollar shares for candidate per-occurrence caps, and the capped-vs-unlimited age-to-age factor volatility comparison when a cap is set. Use BEFORE recommending a loss cap.",
  inputSchema: z.object({
    candidateCaps: z
      .array(z.number().positive())
      .nullable()
      .describe("Candidate caps (base-year cost level) to evaluate; defaults derived from the distribution when null"),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = getWorkspaceView(projectId);
      const review = view.layerReview;
      const diagnostics = review.diagnostics;
      const years = diagnostics.years.map((y) => ({
        year: y.year,
        claimCount: y.claimCount,
        totalIncurred: round0(y.totalIncurred),
        maxClaim: round0(y.maxClaim),
        p90: round0(y.percentiles.find((x) => x.p === 0.9)?.value ?? 0),
        p95: round0(y.percentiles.find((x) => x.p === 0.95)?.value ?? 0),
        p99: round0(y.percentiles.find((x) => x.p === 0.99)?.value ?? 0),
      }));
      const candidates = (
        input.candidateCaps?.length
          ? claimSizeDiagnostics(getClaims(projectId), {
              asOfDate: view.state.asOfDate,
              indexRate: view.state.layer.indexRate,
              baseYear: diagnostics.baseYear,
              candidateCaps: input.candidateCaps,
            }).candidates
          : diagnostics.candidates
      ).map((c) => ({
          cap: c.cap,
          totalPierceCount: c.totalPierceCount,
          totalPierceShare: round3(c.totalPierceShare),
          totalExcessShare: round3(c.totalExcessShare),
        }));
      return {
        success: true,
        layer: view.state.layer,
        years,
        candidates,
        factorVolatility: {
          note: "Per development column, coefficient of variation of the individual age-to-age factors. Lower = stabler. capped is null until a cap is set. Claim sizes are reported incurred at each claim's LATEST EVALUATION, so immature years' pierce and excess shares are floors - open large claims develop into the cap.",
          unlimited: {
            paid: review.volatility.unlimited.paid.map(round3),
            incurred: review.volatility.unlimited.incurred.map(round3),
          },
          capped: review.volatility.capped
            ? {
                paid: review.volatility.capped.paid.map(round3),
                incurred: review.volatility.capped.incurred.map(round3),
              }
            : null,
        },
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const setLossCap = createTool({
  id: "set_loss_cap",
  description:
    "Set the per-occurrence loss cap and optionally activate the capped layer, which reroutes the ENTIRE analysis pipeline (triangles, factors, tails, methods, Mack) onto capped losses. The cap is stated at the baseYear cost level and indexed across accident years by indexRate (0 = flat cap). Activating the capped layer fits default tails for it. Selections for the capped layer are independent of the unlimited layer's.",
  inputSchema: z.object({
    cap: z
      .number()
      .positive()
      .nullable()
      .describe("Per-occurrence cap at the baseYear cost level; null leaves the current cap unchanged"),
    indexRate: z
      .number()
      .gt(-1)
      .nullable()
      .describe("Annual rate indexing the cap across accident years; null leaves unchanged (0 = flat)"),
    baseYear: z
      .number()
      .int()
      .min(1900)
      .max(2200)
      .nullable()
      .describe("Accident year the cap is stated at; null leaves unchanged (default: latest year in data)"),
    activate: z
      .enum(["unlimited", "capped"])
      .nullable()
      .describe("Switch the active development layer; null leaves the active layer unchanged"),
    clearCap: z
      .boolean()
      .nullable()
      .describe("true removes the cap entirely (only while the unlimited layer is active); overrides the cap field"),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = patchWorkspace(projectId, {
        layer: {
          ...(input.clearCap ? { cap: null } : input.cap !== null ? { cap: input.cap } : {}),
          ...(input.indexRate !== null ? { indexRate: input.indexRate } : {}),
          ...(input.baseYear !== null ? { baseYear: input.baseYear } : {}),
          ...(input.activate !== null ? { active: input.activate } : {}),
        },
      });
      return {
        success: true,
        layer: view.state.layer,
        cappedTails: view.state.tail.capped,
        message: `Layer settings applied. Active layer: ${view.state.layer.active}${
          view.state.layer.cap !== null
            ? `, cap ${view.state.layer.cap.toLocaleString()} at ${view.state.layer.baseYear ?? "latest-year"} level, index ${(view.state.layer.indexRate * 100).toFixed(1)}%/yr`
            : ""
        }. Rerun the analysis for results on this layer.`,
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const fitSeverityCurves = createTool({
  id: "fit_severity_curves",
  description:
    "Severity-distribution evidence for the ILF/uncapping decision: censored MLE fits (lognormal and Pareto) to the project's claim severities at the cap's base-year cost level (open claims right-censored at reported incurred), empirical-vs-fitted quantile checks, and the uncap factor each usable source would produce under the current cap and target limit. Call BEFORE recommending an ILF source.",
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = getWorkspaceView(projectId);
      const review = view.ilfReview;
      const compactFit = (fit: NonNullable<typeof review.fits>["lognormal"]) => ({
        valid: fit.valid,
        distribution: fit.distribution,
        logLikelihood: round3(fit.logLikelihood),
        nExact: fit.nExact,
        nCensored: fit.nCensored,
        warnings: fit.warnings,
        quantileCheck: fit.quantileCheck.map((q) => ({
          p: q.p,
          // Kaplan-Meier adjusted; null = censoring exhausts the observable range.
          empirical: q.empirical !== null ? round0(q.empirical) : null,
          fitted: round0(q.fitted),
        })),
      });
      return {
        success: true,
        config: view.state.ilf,
        capBaseYearLevel: true,
        fits: review.fits
          ? { lognormal: compactFit(review.fits.lognormal), pareto: compactFit(review.fits.pareto) }
          : null,
        resolvedFactor: review.resolved
          ? {
              factor: Math.round(review.resolved.factor * 10000) / 10000,
              sourceLabel: review.resolved.sourceLabel,
              targetLimit: review.resolved.targetLimit,
              warnings: review.resolved.warnings,
            }
          : null,
        unresolvedReason: review.unresolvedReason,
        illustrativeCurves: review.illustrativeCurves,
        note: "The factor applies to CAPPED ultimates: total-limits ultimate = capped ultimate x factor. Fits use each claim's latest evaluation; open claims are censored at reported incurred, so heavy open inventories widen the uncertainty.",
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const setIlfSource = createTool({
  id: "set_ilf_source",
  description:
    "Configure how capped ultimates restore to total limits: source none (stay limited), fitted (own-data censored MLE curve: lognormal or pareto), table (imported ILF table; requires a finite target limit), or illustrative (bundled textbook curves - NOT ISO/NCCI). targetLimit null = unlimited (curve sources only). Rerun the analysis afterwards; the selection-of-ultimates exhibit then blends RESTORED ultimates against unlimited diagonals.",
  inputSchema: z.object({
    source: z.enum(["none", "fitted", "table", "illustrative"]).nullable(),
    fittedKind: z.enum(["lognormal", "pareto"]).nullable(),
    curveId: z.string().nullable().describe("Illustrative curve id from fit_severity_curves"),
    targetLimit: z
      .number()
      .positive()
      .nullable()
      .describe("Restoration target at base-year cost level; null LEAVES THE CURRENT TARGET UNCHANGED - to restore to unlimited, set clearTargetLimit true (curve sources only)"),
    clearTargetLimit: z
      .boolean()
      .nullable()
      .describe("true sets the target to unlimited (curves only); overrides targetLimit"),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = patchWorkspace(projectId, {
        ilf: {
          ...(input.source !== null ? { source: input.source } : {}),
          ...(input.fittedKind !== null ? { fittedKind: input.fittedKind } : {}),
          ...(input.curveId !== null ? { curveId: input.curveId } : {}),
          ...(input.clearTargetLimit
            ? { targetLimit: null }
            : input.targetLimit !== null
              ? { targetLimit: input.targetLimit }
              : {}),
        },
      });
      const review = view.ilfReview;
      return {
        success: true,
        config: view.state.ilf,
        resolvedFactor: review.resolved
          ? Math.round(review.resolved.factor * 10000) / 10000
          : null,
        unresolvedReason: review.unresolvedReason,
        message: review.resolved
          ? `ILF source set: ${review.resolved.sourceLabel}, factor ${review.resolved.factor.toFixed(4)} to ${review.resolved.targetLimit === null ? "unlimited" : review.resolved.targetLimit.toLocaleString()}. Rerun the analysis to restore capped ultimates.`
          : `ILF configuration saved but the factor is unresolved: ${review.unresolvedReason}`,
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const analyzeTrends = createTool({
  id: "analyze_trends",
  description:
    "The frequency/severity/trend exhibit over the latest run: per-year ultimate counts, frequency (per $1M RAW earned premium), severity and pure premium from the SELECTED ultimates, log-linear trend fits (all years / last 5 / last 3 / ex-hi-lo) with R-squared for frequency and severity, current selections, and the target cost level. Call BEFORE recommending trend rates.",
  inputSchema: z.object({}),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = getWorkspaceView(projectId);
      const review = view.trendReview;
      if (!review) {
        return {
          success: false,
          error: "No analysis run yet; the trend exhibit derives from the latest run's selected ultimates",
        };
      }
      return {
        success: true,
        targetYear: review.targetYear,
        level: review.level,
        severityLayer: review.severityLayer,
        notes: review.notes,
        rows: review.rows.map((r) => ({
          origin: r.origin,
          earnedPremium: r.earnedPremium !== null ? round0(r.earnedPremium) : null,
          ultimateCounts: r.ultimateCounts !== null ? Math.round(r.ultimateCounts * 10) / 10 : null,
          frequency: r.frequency !== null ? round3(r.frequency) : null,
          severity: r.severity !== null ? round0(r.severity) : null,
          purePremium: r.purePremium !== null ? round0(r.purePremium) : null,
        })),
        fits: {
          frequency: review.frequency.fits.map((f) => ({
            key: f.key,
            annualRatePct: f.annualRate !== null ? Math.round(f.annualRate * 1000) / 10 : null,
            rSquared: round3(f.rSquared),
            nPoints: f.nPoints,
            warnings: f.warnings,
          })),
          severity: review.severity.fits.map((f) => ({
            key: f.key,
            annualRatePct: f.annualRate !== null ? Math.round(f.annualRate * 1000) / 10 : null,
            rSquared: round3(f.rSquared),
            nPoints: f.nPoints,
            warnings: f.warnings,
          })),
        },
        selections: {
          note: "ratePct is PERCENT per year (6.5 = 6.5%/yr), matching the fits' annualRatePct; set_trend_selections takes DECIMALS (0.065)",
          frequency: {
            source: review.frequency.selection.source,
            ratePct:
              review.frequency.selection.value !== null
                ? Math.round(review.frequency.selection.value * 1000) / 10
                : null,
            stale: review.frequency.selectionStale,
          },
          severity: {
            source: review.severity.selection.source,
            ratePct:
              review.severity.selection.value !== null
                ? Math.round(review.severity.selection.value * 1000) / 10
                : null,
            stale: review.severity.selectionStale,
          },
        },
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const setTrendSelections = createTool({
  id: "set_trend_selections",
  description:
    "Select trend rates: frequency and/or severity (severity is PER LAYER - the cap compresses trend), each as a fitted window key with its rate, or manual with a judgmental rate; optionally the target cost level year. Rates are decimals (0.05 = +5%/yr). These arm the expected-loss-ratio machinery; they do not change current method results.",
  inputSchema: z.object({
    frequency: z
      .object({
        source: z.enum(["all", "last5", "last3", "exhilo", "manual"]),
        value: z.number().gt(-1).nullable().describe("Annual rate; null clears the selection"),
      })
      .nullable()
      .describe("null leaves the frequency selection unchanged"),
    severity: z
      .object({
        layer: z.enum(["unlimited", "capped"]),
        source: z.enum(["all", "last5", "last3", "exhilo", "manual"]),
        value: z.number().gt(-1).nullable().describe("Annual rate; null clears the selection"),
      })
      .nullable()
      .describe("null leaves the severity selection unchanged"),
    targetYear: z
      .number()
      .int()
      .min(1900)
      .max(2200)
      .nullable()
      .describe("Target cost-level year (the trended columns restate to ITS MIDPOINT); null LEAVES IT UNCHANGED - to restore the floating latest-origin-year default, set clearTargetYear true"),
    clearTargetYear: z
      .boolean()
      .nullable()
      .describe("true resets the target year to the floating default (latest origin year); overrides targetYear"),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const view = patchWorkspace(projectId, {
        trend: {
          ...(input.frequency !== null ? { frequency: input.frequency } : {}),
          ...(input.severity !== null ? { severity: input.severity } : {}),
          ...(input.clearTargetYear
            ? { targetYear: null }
            : input.targetYear !== null
              ? { targetYear: input.targetYear }
              : {}),
        },
      });
      return {
        success: true,
        trend: view.state.trend,
        message: "Trend selections applied; the trended columns in the exhibit reflect them.",
      };
    } catch (err) {
      return failure(err);
    }
  },
});

export const saveNote = createTool({
  id: "save_note",
  description:
    "Save a short written note to the project's analysis notes (visible in the Notes panel). Use for conclusions, caveats, and rationale worth keeping outside the chat.",
  inputSchema: z.object({
    text: z.string().min(1).max(4000).describe("The note text"),
  }),
  execute: async (input, context) => {
    try {
      const projectId = projectIdOf(context as ToolCtx);
      const note = insertNote(projectId, "advisor", input.text);
      return { success: true, noteId: note.id, message: "Note saved." };
    } catch (err) {
      return failure(err);
    }
  },
});

export const advisorTools = {
  get_workspace_overview: getWorkspaceOverview,
  analyze_development_factors: analyzeDevelopmentFactors,
  fit_tail_curves: fitTailCurves,
  assess_data_quality: assessDataQuality,
  get_diagnostic_detail: getDiagnosticDetail,
  get_analysis_results: getAnalysisResults,
  apply_ldf_selections: applyLdfSelections,
  set_tail_factor: setTailFactor,
  set_bf_apriori: setBfApriori,
  set_ultimate_selection: setUltimateSelection,
  analyze_claim_sizes: analyzeClaimSizes,
  set_loss_cap: setLossCap,
  analyze_trends: analyzeTrends,
  set_trend_selections: setTrendSelections,
  fit_severity_curves: fitSeverityCurves,
  set_ilf_source: setIlfSource,
  run_analysis: runAnalysisTool,
  run_sensitivity: runSensitivityTool,
  save_note: saveNote,
};

/** Tool ids that mutate the workspace (the UI refreshes after these). */
export const ACTION_TOOL_IDS = new Set([
  "apply_ldf_selections",
  "set_tail_factor",
  "set_loss_cap",
  "set_trend_selections",
  "set_ilf_source",
  "set_bf_apriori",
  "set_ultimate_selection",
  "run_analysis",
  "save_note",
]);
