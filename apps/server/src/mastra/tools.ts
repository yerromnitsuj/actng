import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { isNum, type DevelopmentFactors, type Triangle } from "@actng/core";
import {
  getWorkspaceView,
  patchWorkspace,
  runFullAnalysis,
  runSensitivity,
  HttpError,
} from "../services/workspaceService.js";
import { fitAllTails } from "@actng/core";
import {
  getAnalysis,
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
        selections: {
          paid: view.state.selections.paid.map(round3),
          incurred: view.state.selections.incurred.map(round3),
        },
        tails: view.state.tail,
        bfAprioriOverride: view.state.bf.aprioriLossRatio,
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
        currentSelections: view.state.selections[basis].map(round3),
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
      const ldfs = input.candidateSelections ?? view.state.selections[basis];
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
          selections: view.state.selections[input.basis].map(round3),
          tail: view.state.tail[input.basis],
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
        applied: view.state.tail[input.basis],
        message: `Tail for the ${input.basis} basis is now ${view.state.tail[input.basis].value.toFixed(4)} (${input.source}).`,
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
        applied: view.state.bf.aprioriLossRatio,
        message:
          view.state.bf.aprioriLossRatio === null
            ? "BF a-priori override cleared; the derived loss ratio will be used on the next run."
            : `BF a-priori loss ratio override set to ${(view.state.bf.aprioriLossRatio * 100).toFixed(1)}%. Run the analysis for it to take effect.`,
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
  run_analysis: runAnalysisTool,
  run_sensitivity: runSensitivityTool,
  save_note: saveNote,
};

/** Tool ids that mutate the workspace (the UI refreshes after these). */
export const ACTION_TOOL_IDS = new Set([
  "apply_ldf_selections",
  "set_tail_factor",
  "set_bf_apriori",
  "set_ultimate_selection",
  "run_analysis",
  "save_note",
]);
