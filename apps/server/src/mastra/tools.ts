import {
  callRemoteMethod,
  defineActuarialTool,
  tenantOf,
  toolRegistry,
  type ToolEnvelopeFailure,
} from "@actuarial-ts/agents";
import {
  crosscheck,
  resultToDoc,
  selectionsToDoc,
  triangleToDoc,
  type CrosscheckReportDoc,
  type DevelopmentIntentInput,
  type MethodResultDoc,
} from "@actuarial-ts/interchange";
import { RequestContext } from "@mastra/core/request-context";
import { getMastra } from "./instanceRegistry.js";
import { z } from "zod";
import { isNum, type DevelopmentFactors, type Triangle } from "@actuarial-ts/core";
import {
  activeBf,
  activeSelections,
  activeTail,
  getWorkspaceView,
  patchWorkspace,
  runFullAnalysis,
  runSensitivity,
} from "../services/workspaceService.js";
import { claimSizeDiagnostics, fitAllTails, runChainLadder, runMack, ReservingError } from "@actuarial-ts/core";
import { HttpError } from "../services/workspaceService.js";
import {
  getAnalysis,
  getClaims,
  getExposures,
  insertNote,
  latestAnalysis,
} from "../db/repo.js";
import type { AnalysisResults } from "../services/workspaceService.js";

/**
 * Advisor tools, built on @actuarial-ts/agents' defineActuarialTool. Two
 * kinds:
 * - "read": analyze the triangle, factor stability, tails, data quality
 * - "action": apply selections, set the tail, run analyses, sensitivities, notes
 *
 * SECURITY BOUNDARY: the project id ALWAYS comes from the server-side request
 * context (set by the chat route from the authenticated URL), never from the
 * model. tenantOf reads it, and defineActuarialTool rejects any input schema
 * that declares a tenant-id key at definition time.
 *
 * Error contract: tools never throw. The defineActuarialTool wrapper converts
 * anything a body throws into { success: false, error: { code, message } }
 * (HttpError keeps its code; everything else gets TOOL_ERROR) so the agent
 * can recover: retry with adjusted parameters, suggest an alternative, or ask.
 */

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
// Read-tool input schemas (shared source of truth)
//
// Extracted, keyed by tool id, so the MCP exposure layer
// (src/mcp/workspaceMcp.ts) builds tenant-bridged variants from the SAME
// schema objects these tools use — one source of truth, no drift. Each read
// tool below references its entry here.

export const READ_TOOL_INPUT_SCHEMAS = {
  get_workspace_overview: z.object({}),
  analyze_development_factors: z.object({ basis: basisSchema }),
  assess_data_quality: z.object({}),
  get_diagnostic_detail: z.object({
    metric: z.enum(["paidToIncurred", "averageCase", "closureRates"]),
  }),
  get_analysis_results: z.object({
    analysisId: z.string().nullable().describe("Specific analysis id; latest when null"),
  }),
  run_sensitivity: z.object({
    basis: z.enum(["paid", "incurred"]),
    selections: z
      .array(z.number().positive().nullable())
      .nullable()
      .describe("Alternative LDF vector; null keeps current selections"),
    tailFactor: z.number().positive().nullable().describe("Alternative tail; null keeps current"),
  }),
  crosscheck_with_python: z.object({}),
};

// ---------------------------------------------------------------------------
// READ / ANALYZE TOOLS

export const getWorkspaceOverview = defineActuarialTool({
  id: "get_workspace_overview",
  description:
    "Get the current state of the reserving workspace: triangle dimensions, basis, evaluation date, current LDF selections and tails, data volumes, and the latest analysis totals. Call this first in a conversation to orient yourself.",
  kind: "read",
  inputSchema: READ_TOOL_INPUT_SCHEMAS.get_workspace_overview,
  execute: async (_input, context) => {
    const projectId = tenantOf(context);
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
      aprioriMethod: view.state.elr.method,
      exposures: exposures.map((e) => ({
        origin: e.origin,
        earnedPremium: e.earnedPremium !== null ? round0(e.earnedPremium) : null,
        exposureUnits: e.exposureUnits !== null ? round0(e.exposureUnits) : null,
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
  },
});

export const analyzeDevelopmentFactors = defineActuarialTool({
  id: "analyze_development_factors",
  description:
    "Analyze age-to-age development factors for a basis: per-column factor counts, dispersion (CV), the most recent factors, and the full averages menu (all-year and n-year straight and volume-weighted, medial, geometric). Use this before recommending LDF selections.",
  kind: "read",
  inputSchema: READ_TOOL_INPUT_SCHEMAS.analyze_development_factors,
  execute: async (input, context) => {
    const projectId = tenantOf(context);
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
  },
});

export const fitTailCurves = defineActuarialTool({
  id: "fit_tail_curves",
  description:
    "Fit exponential-decay and inverse-power tail curves (Sherman 1984 / Boor 2006) to the currently selected LDFs (or to a candidate selection vector), returning fitted parameters, R-squared, extrapolated tail factors, and validity warnings.",
  kind: "read",
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
    const projectId = tenantOf(context);
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
  },
});

export const assessDataQuality = defineActuarialTool({
  id: "assess_data_quality",
  description:
    "Run the data-quality diagnostics an actuary checks before trusting development methods: paid-to-incurred ratio drift, average case reserve trends, closure-rate shifts, and Mack's calendar-year test. Returns findings with severities.",
  kind: "read",
  inputSchema: READ_TOOL_INPUT_SCHEMAS.assess_data_quality,
  execute: async (_input, context) => {
    const projectId = tenantOf(context);
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
  },
});

export const getDiagnosticDetail = defineActuarialTool({
  id: "get_diagnostic_detail",
  description:
    "Fetch the underlying by-origin, by-age grid for one diagnostic metric so you can cite the actual numbers: paid-to-incurred ratios, average case reserves, or closure rates.",
  kind: "read",
  inputSchema: READ_TOOL_INPUT_SCHEMAS.get_diagnostic_detail,
  execute: async (input, context) => {
    const projectId = tenantOf(context);
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
  },
});

export const getAnalysisResults = defineActuarialTool({
  id: "get_analysis_results",
  description:
    "Get the results of the latest analysis run (or a specific one by id): ultimates, IBNR, and unpaid by method and origin period, Mack standard errors, and warnings. The UI renders the full tables; use this to ground your commentary in the numbers.",
  kind: "read",
  inputSchema: READ_TOOL_INPUT_SCHEMAS.get_analysis_results,
  execute: async (input, context) => {
    const projectId = tenantOf(context);
    const record = input.analysisId ? getAnalysis(input.analysisId) : latestAnalysis(projectId);
    if (!record || record.projectId !== projectId) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message:
            "No analysis found. Run one with run_analysis after selections are applied.",
        },
      } satisfies ToolEnvelopeFailure;
    }
    return {
      success: true,
      analysisId: record.id,
      label: record.label,
      ...analysisSummaryPayload(record.results as AnalysisResults),
    };
  },
});

// ---------------------------------------------------------------------------
// ACTION TOOLS

export const applyLdfSelections = defineActuarialTool({
  id: "apply_ldf_selections",
  description:
    "Apply a full vector of selected LDFs to the workspace for a basis (one entry per development interval, oldest to newest age; null leaves an interval unselected). This changes the live workspace exactly as if the user clicked the values. Optionally set a manual tail factor at the same time.",
  kind: "action",
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
    const projectId = tenantOf(context);
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
  },
});

export const setTailFactor = defineActuarialTool({
  id: "set_tail_factor",
  description:
    "Set the tail factor for a basis, either from a fitted curve (exponentialDecay or inversePower, fitted to the applied selections) or manually with an explicit value.",
  kind: "action",
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
    const projectId = tenantOf(context);
    const view = patchWorkspace(projectId, {
      tail: { basis: input.basis, source: input.source, value: input.value ?? undefined },
    });
    return {
      success: true,
      applied: activeTail(view.state)[input.basis],
      message: `Tail for the ${input.basis} basis is now ${activeTail(view.state)[input.basis].value.toFixed(4)} (${input.source}).`,
    };
  },
});

export const runAnalysisTool = defineActuarialTool({
  id: "run_analysis",
  description:
    "Run the full reserving analysis with the currently applied selections and tails: Chain Ladder (paid and incurred), Bornhuetter-Ferguson, Benktander (BF iterated once), frequency-severity (counts x severity), Berquist-Sherman (both adjustments), Cape Cod, Expected Claims, Mack standard errors, and diagnostics. Persists the run and returns the summary.",
  kind: "action",
  inputSchema: z.object({
    label: z.string().nullable().describe("Optional label for this analysis run"),
  }),
  execute: async (input, context) => {
    const projectId = tenantOf(context);
    const record = runFullAnalysis(projectId, input.label ?? undefined);
    return {
      success: true,
      analysisId: record.id,
      label: record.label,
      ...analysisSummaryPayload(record.results as AnalysisResults),
      message:
        "Analysis complete and persisted. The UI renders the full result tables; do not repeat them verbatim.",
    };
  },
});

export const runSensitivityTool = defineActuarialTool({
  id: "run_sensitivity",
  description:
    "Compare a what-if chain ladder scenario (alternative LDF selections and/or tail) against the current selections WITHOUT changing the workspace. Returns both totals and the deltas.",
  kind: "read",
  inputSchema: READ_TOOL_INPUT_SCHEMAS.run_sensitivity,
  execute: async (input, context) => {
    const projectId = tenantOf(context);
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
  },
});

export const setBfApriori = defineActuarialTool({
  id: "set_bf_apriori",
  description:
    "Set (or clear) the Bornhuetter-Ferguson a-priori loss ratio override for this workspace. Pass a positive decimal (e.g. 0.65 for 65%) to override, or null to return to the default derived from mature chain ladder ultimates and earned premium. Rerun the analysis afterwards for it to take effect in results.",
  kind: "action",
  inputSchema: z.object({
    aprioriLossRatio: z
      .number()
      .positive()
      .max(5)
      .nullable()
      .describe("A-priori expected loss ratio; null resets to the derived value"),
  }),
  execute: async (input, context) => {
    const projectId = tenantOf(context);
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
    ccPaid: z.number().min(0).nullable().describe("Cape Cod paid weight"),
    ccIncurred: z.number().min(0).nullable().describe("Cape Cod incurred weight"),
    expectedClaims: z.number().min(0).nullable().describe("Expected Claims (a-priori) weight"),
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

export const setUltimateSelection = defineActuarialTool({
  id: "set_ultimate_selection",
  description:
    "Update the selection-of-ultimates exhibit. Weights are per ORIGIN PERIOD and method, renormalized within each period over the methods with values. Set `weights` to apply a method's credibility across ALL periods (overwrites per-period tweaks for that method), `perOriginWeights` to weight specific periods differently (e.g. BF on green years only), and/or `overrides` to hand-pick a period's selected ultimate (null clears back to the weighted value). Only provide what you want to change. The exhibit blends the LATEST analysis run's method ultimates.",
  kind: "action",
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
    const projectId = tenantOf(context);
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
  },
});

export const analyzeClaimSizes = defineActuarialTool({
  id: "analyze_claim_sizes",
  description:
    "Cap-selection evidence: the claim-size distribution by accident year (percentiles, max, counts), pierce counts and excess-dollar shares for candidate per-occurrence caps, and the capped-vs-unlimited age-to-age factor volatility comparison when a cap is set. Use BEFORE recommending a loss cap.",
  kind: "read",
  inputSchema: z.object({
    candidateCaps: z
      .array(z.number().positive())
      .nullable()
      .describe("Candidate caps (base-year cost level) to evaluate; defaults derived from the distribution when null"),
  }),
  execute: async (input, context) => {
    const projectId = tenantOf(context);
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
  },
});

export const setLossCap = defineActuarialTool({
  id: "set_loss_cap",
  description:
    "Set the per-occurrence loss cap and optionally activate the capped layer, which reroutes the ENTIRE analysis pipeline (triangles, factors, tails, methods, Mack) onto capped losses. The cap is stated at the baseYear cost level and indexed across accident years by indexRate (0 = flat cap). Activating the capped layer fits default tails for it. Selections for the capped layer are independent of the unlimited layer's.",
  kind: "action",
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
    const projectId = tenantOf(context);
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
  },
});

export const fitSeverityCurves = defineActuarialTool({
  id: "fit_severity_curves",
  description:
    "Severity-distribution evidence for the ILF/uncapping decision: censored MLE fits (lognormal and Pareto) to the project's claim severities at the cap's base-year cost level (open claims right-censored at reported incurred), empirical-vs-fitted quantile checks, and the uncap factor each usable source would produce under the current cap and target limit. Call BEFORE recommending an ILF source.",
  kind: "read",
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const projectId = tenantOf(context);
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
  },
});

export const setIlfSource = defineActuarialTool({
  id: "set_ilf_source",
  description:
    "Configure how capped ultimates restore to total limits: source none (stay limited), fitted (own-data censored MLE curve: lognormal or pareto), table (imported ILF table; requires a finite target limit), or illustrative (bundled textbook curves - NOT ISO/NCCI). targetLimit null = unlimited (curve sources only). Rerun the analysis afterwards; the selection-of-ultimates exhibit then blends RESTORED ultimates against unlimited diagonals.",
  kind: "action",
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
    const projectId = tenantOf(context);
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
  },
});

export const analyzeTrends = defineActuarialTool({
  id: "analyze_trends",
  description:
    "The frequency/severity/trend exhibit over the latest run: per-year ultimate counts, frequency (per $1M RAW earned premium), severity and pure premium from the SELECTED ultimates, log-linear trend fits (all years / last 5 / last 3 / ex-hi-lo) with R-squared for frequency and severity, current selections, and the target cost level. Call BEFORE recommending trend rates.",
  kind: "read",
  inputSchema: z.object({}),
  execute: async (input, context) => {
    const projectId = tenantOf(context);
    const view = getWorkspaceView(projectId);
    const review = view.trendReview;
    if (!review) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message:
            "No analysis run yet; the trend exhibit derives from the latest run's selected ultimates",
        },
      } satisfies ToolEnvelopeFailure;
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
  },
});

export const setTrendSelections = defineActuarialTool({
  id: "set_trend_selections",
  description:
    "Select trend rates: frequency and/or severity (severity is PER LAYER - the cap compresses trend), each as a fitted window key with its rate, or manual with a judgmental rate; optionally the target cost level year. Rates are decimals (0.05 = +5%/yr). These arm the expected-loss-ratio machinery; they do not change current method results.",
  kind: "action",
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
    const projectId = tenantOf(context);
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
  },
});

export const setAprioriMethod = defineActuarialTool({
  id: "set_apriori_method",
  description:
    "Choose the a-priori METHOD. 'loss-ratio' divides trended developed losses by ON-LEVEL earned PREMIUM (yields a loss ratio; needs premium + rate history). 'pure-premium' divides by EXPOSURE UNITS (yields a pure premium = loss cost per unit; needs exposure units imported; premium on-leveling does NOT apply). Switching methods CLEARS any selected a-priori and manual BF override (a loss ratio and a pure premium are different units). Rerun the analysis afterwards.",
  kind: "action",
  inputSchema: z.object({
    method: z.enum(["loss-ratio", "pure-premium"]).describe("The a-priori method to use"),
  }),
  execute: async (input, context) => {
    const projectId = tenantOf(context);
    const view = patchWorkspace(projectId, { elr: { method: input.method } });
    return {
      success: true,
      method: view.state.elr.method,
      message: `A-priori method set to ${view.state.elr.method}. Any prior a-priori selection and manual BF override were cleared. Rerun the analysis.`,
    };
  },
});

export const analyzeElr = defineActuarialTool({
  id: "analyze_elr",
  description:
    "The a-priori compilation over the latest run: per-year trended SELECTED ultimates over the exposure base, an averages menu, the Cape Cod mechanical cross-check, and the current selection. The METHOD determines the base and the a-priori's unit: loss-ratio (over ON-LEVEL premium -> a loss RATIO, percent) or pure-premium (over EXPOSURE UNITS -> a pure premium, DOLLARS per unit). Call BEFORE recommending an a-priori. All a-priori values below are in the unit named by `aprioriUnit`.",
  kind: "read",
  inputSchema: z.object({}),
  execute: async (input, context) => {
    const projectId = tenantOf(context);
    const view = getWorkspaceView(projectId);
    const review = view.elrReview;
    if (!review) {
      const isPP = view.state.elr.method === "pure-premium";
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `The a-priori exhibit needs an analysis run and ${isPP ? "exposure units (import exposure_units)" : "premium data (import exposures)"} first`,
        },
      } satisfies ToolEnvelopeFailure;
    }
    const isPP = review.method === "pure-premium";
    // Loss ratios are reported in percent; pure premiums as whole dollars.
    const fmtA = (v: number | null): number | null =>
      v === null ? null : isPP ? round0(v) : Math.round(v * 1000) / 10;
    return {
      success: true,
      method: review.method,
      aprioriUnit: isPP ? "pure premium (dollars per exposure unit)" : "loss ratio (percent)",
      targetYear: review.targetYear,
      level: review.level,
      warnings: review.warnings,
      rows: review.rows.map((r) => ({
        origin: r.origin,
        base: round0(r.premium),
        onLevelFactor: round3(r.onLevelFactor),
        adjustedBase: round0(r.onLevelTrendedPremium),
        trendedUltimate: r.trendedUltimate !== null ? round0(r.trendedUltimate) : null,
        aprioriAtTarget: fmtA(r.lossRatioAtTarget),
      })),
      averages: review.averages.map((a) => ({
        key: a.key,
        label: a.label,
        value: fmtA(a.value),
      })),
      capeCodApriori: {
        paid: fmtA(review.capeCodElr.paid),
        incurred: fmtA(review.capeCodElr.incurred),
      },
      selected: fmtA(review.selected),
      note: isPP
        ? "Pure premiums are DOLLARS per exposure unit; set_elr takes the dollar value (e.g. 475)"
        : "All ratios in PERCENT; set_elr takes a DECIMAL (0.65 = 65%)",
    };
  },
});

export const setElr = defineActuarialTool({
  id: "set_elr",
  description:
    "Select the a-priori AT THE TARGET COST LEVEL. Its unit follows the method: loss-ratio -> a DECIMAL loss ratio (0.65 = 65%); pure-premium -> a positive DOLLAR pure premium per exposure unit (e.g. 475). The engine restates it to each origin year's own level for the BF a-priori and the Expected Claims method on the NEXT run. null clears the selection (BF reverts to its CL-derived default; Expected Claims drops out). Call analyze_elr / read the exhibit first to know the current method.",
  kind: "action",
  inputSchema: z.object({
    selected: z
      .number()
      .positive()
      .nullable()
      .describe("A-priori at target level: a decimal loss ratio (loss-ratio method) or a dollar pure premium (pure-premium method); null clears"),
  }),
  execute: async (input, context) => {
    const projectId = tenantOf(context);
    const view = patchWorkspace(projectId, { elr: { selected: input.selected } });
    const isPP = view.state.elr.method === "pure-premium";
    const sel = view.state.elr.selected;
    return {
      success: true,
      method: view.state.elr.method,
      selected: sel,
      message:
        sel !== null
          ? `${isPP ? "Pure premium" : "ELR"} selected at ${isPP ? "$" + Math.round(sel).toLocaleString() : (sel * 100).toFixed(1) + "%"} (target level). Rerun the analysis for BF and Expected Claims to use it.`
          : "A-priori selection cleared; BF reverts to its derived default on the next run.",
    };
  },
});

export const setRateHistory = defineActuarialTool({
  id: "set_rate_history",
  description:
    "Replace the rate-change history used for parallelogram premium on-leveling (each change applies to policies written on/after its effective date; change is a decimal, 0.05 = +5%), and/or set the annual premium trend rate. History replaces wholesale - include ALL changes.",
  kind: "action",
  inputSchema: z.object({
    history: z
      .array(
        z.object({
          effectiveDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe("yyyy-mm-dd"),
          change: z.number().gt(-1).describe("decimal rate change"),
        }),
      )
      .nullable()
      .describe("Full replacement history; null leaves it unchanged"),
    premiumTrend: z
      .number()
      .gt(-1)
      .nullable()
      .describe("Annual premium trend NET OF RATE CHANGES (exposure/inflation drift only - rate action lives in the history, and fitting this from raw average premium double-counts the on-level factor); null CLEARS the trend, matching set_elr"),
  }),
  execute: async (input, context) => {
    const projectId = tenantOf(context);
    const view = patchWorkspace(projectId, {
      rates: {
        ...(input.history !== null ? { history: input.history } : {}),
        // null = CLEAR (single-field semantics, same as set_elr).
        premiumTrend: input.premiumTrend,
      },
    });
    return {
      success: true,
      rates: view.state.rates,
      message: `Rate history now has ${view.state.rates.history.length} change(s); premium trend ${
        view.state.rates.premiumTrend !== null
          ? (view.state.rates.premiumTrend * 100).toFixed(1) + "%/yr"
          : "none"
      }.`,
    };
  },
});

/** Structural view of the workflow surface these tools need (breaks the
 * type-level cycle tools -> index -> advisor -> tools that full inference
 * through the dynamic import would create). */
interface ElrWorkflowRun {
  runId: string;
  start(params: {
    inputData: Record<string, never>;
    requestContext: RequestContext;
  }): Promise<unknown>;
  resume(params: {
    step: string;
    resumeData: Record<string, unknown>;
    requestContext: RequestContext;
  }): Promise<unknown>;
}

/**
 * Resolved through the zero-import instance registry: a static import of
 * ./index.js closes the module cycle index -> advisor -> tools, and a
 * dynamic import deadlocks inside tool execution under the tsx loader.
 */
function getWorkflowInstance(): {
  createRun(options?: { runId?: string }): Promise<ElrWorkflowRun>;
} {
  return getMastra().getWorkflow("deriveExpectedLossesWorkflow") as {
    createRun(options?: { runId?: string }): Promise<ElrWorkflowRun>;
  };
}

const GATE_STEP_IDS = {
  cap: "cap-gate",
  ilf: "ilf-gate",
  trends: "trend-gate",
  elr: "elr-gate",
} as const;

type WorkflowRunResult = {
  status: string;
  suspended?: string[][];
  steps?: Record<string, { suspendPayload?: { stage?: string; recommendation?: string; evidence?: unknown } }>;
  result?: unknown;
  error?: unknown;
};

function describeRunState(runId: string, result: WorkflowRunResult) {
  if (result.status === "suspended" && result.suspended?.length) {
    const stepId = result.suspended[0]![result.suspended[0]!.length - 1]!;
    const payload = result.steps?.[stepId]?.suspendPayload;
    return {
      success: true as const,
      status: "awaiting-decision" as const,
      runId,
      gate: payload?.stage ?? stepId,
      recommendation: payload?.recommendation ?? "",
      evidence: payload?.evidence ?? null,
      message:
        "The derivation is paused at a judgment gate. Present the recommendation and evidence to the user, take their decision, then call advance_elr_derivation.",
    };
  }
  if (result.status === "success") {
    return {
      success: true as const,
      status: "complete" as const,
      runId,
      result: result.result ?? null,
      message:
        "Derivation complete: the selected ELR is applied, the analysis reran, and the rationale trail is saved as a note.",
    };
  }
  return {
    success: false as const,
    status: result.status,
    runId,
    error: {
      code: "WORKFLOW_ERROR",
      message: String((result as { error?: unknown }).error ?? "workflow did not suspend or complete"),
    },
  };
}

export const deriveExpectedLosses = defineActuarialTool({
  id: "derive_expected_losses",
  description:
    "Start the guided expected-loss-ratio derivation: a Mastra workflow that walks cap -> restoration -> trends -> ELR, PAUSING at every actuarial judgment with a recommendation and evidence. Nothing is applied without a decision. Present each gate to the user in chat, then advance with advance_elr_derivation. Requires at least one analysis run.",
  // "read" on purpose: starting the derivation mutates nothing (the first
  // gate suspends before any decision is applied); advance_elr_derivation is
  // the action. This keeps ACTION_TOOL_IDS identical to its pre-package set.
  kind: "read",
  inputSchema: z.object({}),
  execute: async (input, context) => {
    const projectId = tenantOf(context);
    const requestContext = new RequestContext();
    requestContext.set("projectId", projectId);
    const wf = getWorkflowInstance();
    const run = await wf.createRun();
    const result = (await run.start({
      inputData: {},
      requestContext,
    })) as WorkflowRunResult;
    return describeRunState(run.runId, result);
  },
});

export const advanceElrDerivation = defineActuarialTool({
  id: "advance_elr_derivation",
  description:
    "Resume a paused ELR derivation with the user's decision at the current gate. Supply ONLY the fields the gate needs: cap gate -> decision (accept/adjust/skip) + cap/indexRate; ilf gate -> decision + source/fittedKind/curveId/targetLimit; trends gate -> decision (accept/adjust) + frequency/severity (decimals; null = none) + optional targetYear; elr gate -> decision (accept/adjust/abort) + selected (decimal). Always pass the user's stated rationale.",
  kind: "action",
  inputSchema: z.object({
    runId: z.string(),
    gate: z.enum(["cap", "ilf", "trends", "elr"]),
    decision: z.enum(["accept", "adjust", "skip", "abort"]),
    cap: z.number().positive().nullable().describe("cap gate only; null when not applicable"),
    indexRate: z.number().gt(-1).nullable(),
    source: z.enum(["fitted", "table", "illustrative"]).nullable(),
    fittedKind: z.enum(["lognormal", "pareto"]).nullable(),
    curveId: z.string().nullable(),
    targetLimit: z.number().positive().nullable(),
    frequency: z.number().gt(-1).nullable(),
    severity: z.number().gt(-1).nullable(),
    targetYear: z.number().int().nullable(),
    selected: z.number().positive().nullable().describe("elr gate: the chosen ELR as a decimal"),
    rationale: z.string(),
  }),
  execute: async (input, context) => {
    const projectId = tenantOf(context);
    const requestContext = new RequestContext();
    requestContext.set("projectId", projectId);
    const wf = getWorkflowInstance();
    const run = await wf.createRun({ runId: input.runId });
    const resumeData: Record<string, unknown> = {
      decision: input.decision,
      rationale: input.rationale,
    };
    if (input.gate === "cap") {
      if (input.cap !== null) resumeData.cap = input.cap;
      if (input.indexRate !== null) resumeData.indexRate = input.indexRate;
    } else if (input.gate === "ilf") {
      if (input.source !== null) resumeData.source = input.source;
      if (input.fittedKind !== null) resumeData.fittedKind = input.fittedKind;
      if (input.curveId !== null) resumeData.curveId = input.curveId;
      if (input.targetLimit !== null) resumeData.targetLimit = input.targetLimit;
    } else if (input.gate === "trends") {
      resumeData.frequency = input.frequency;
      resumeData.severity = input.severity;
      if (input.targetYear !== null) resumeData.targetYear = input.targetYear;
    } else {
      if (input.selected !== null) resumeData.selected = input.selected;
    }
    const result = (await run.resume({
      step: GATE_STEP_IDS[input.gate],
      resumeData,
      requestContext,
    })) as WorkflowRunResult;
    return describeRunState(input.runId, result);
  },
});

// ---------------------------------------------------------------------------
// Second-engine cross-check (interop spec rev 2.1, sections 5 / 7 / 9 item 4)

/** Verdict severity for the roll-up: the summary reports the WORST leg. */
const VERDICT_RANK: Record<string, number> = {
  agree: 0,
  "verified-by-value": 1,
  "not-comparable": 2,
  disagree: 3,
};

/** Max relative deviations recorded in a crosscheck report (per-origin and
 * totals; null SE = no SE cell was compared). */
function reportDeviations(report: CrosscheckReportDoc): {
  maxCentral: number;
  maxStandardError: number | null;
} {
  const body = report.report;
  let maxCentral = 0;
  let maxSe: number | null = null;
  for (const row of body.deviations.perOrigin) {
    maxCentral = Math.max(maxCentral, row.ultimate ?? 0, row.unpaid ?? 0);
    if (row.standardError !== null) maxSe = Math.max(maxSe ?? 0, row.standardError);
  }
  const totals = body.deviations.totals;
  maxCentral = Math.max(maxCentral, totals.ultimate ?? 0, totals.unpaid ?? 0);
  if (totals.standardError !== null) maxSe = Math.max(maxSe ?? 0, totals.standardError);
  return { maxCentral, maxStandardError: maxSe };
}

const relativeDeviation = (x: number, y: number): number => {
  const scale = Math.max(Math.abs(x), Math.abs(y));
  return scale === 0 ? 0 : Math.abs(x - y) / scale;
};

/** Menu keys that replay EXACTLY on the given cadence (spec 3.2 equivalence
 * table): windowed and medial averages are exact only on annual (12-month)
 * origins; the all-period trio replays exactly on any cadence. */
function exactMenuKeys(originLengthMonths: number): readonly string[] {
  return originLengthMonths === 12
    ? ["all-wtd", "all-str", "5-wtd", "5-str", "3-wtd", "3-str", "med-5x1", "geo-all"]
    : ["all-wtd", "all-str", "geo-all"];
}

/**
 * The intent behind each applied factor. The workspace stores VALUES, not
 * provenance, so the intent is recovered by matching each selected factor
 * against the exactly-replayable averages menu at the interchange coherence
 * tolerance (1e-9 relative); a factor matching no menu cell travels as a
 * judgmental (value-authoritative) intent — honest, never guessed. When a
 * factor matches two menu cells, the first in the fixed priority order
 * (all-wtd > all-str > 5-wtd > … > geo-all) wins; the tie-break is cosmetic
 * because equal values replay identically on both engines.
 */
function recoverIntents(
  selected: readonly (number | null)[],
  factors: DevelopmentFactors,
  originLengthMonths: number,
): DevelopmentIntentInput[] {
  const keys = exactMenuKeys(originLengthMonths);
  return selected.map((value, j) => {
    if (!isNum(value)) {
      // Column carries no selection; selectionsToDoc omits it (the intent is
      // never read). A placeholder keeps the arrays aligned.
      return { kind: "judgmental", rationale: "unused placeholder for an unselected column" };
    }
    for (const key of keys) {
      const menu = factors.averages.find((a) => a.spec.key === key)?.values[j];
      if (isNum(menu) && relativeDeviation(value, menu) <= 1e-9) {
        return key as DevelopmentIntentInput;
      }
    }
    return {
      kind: "judgmental",
      rationale:
        "Workbench user-applied factor matching no standard-menu average within 1e-9; value authoritative for cross-engine transport",
    };
  });
}

export const crosscheckWithPython = defineActuarialTool({
  id: "crosscheck_with_python",
  description:
    "Cross-check the workbench's numbers against chainladder-python (the independent second engine). Runs the CURRENT active-basis triangle with the applied LDF selections and tail through the sidecar's Chainladder and referees it against the workbench's own chain ladder (deterministic-cl profile), plus a volume-weighted Mack with Mack sigma on both engines when standard errors are computable (mack1993-vw profile). Returns per-profile verdicts (agree / verified-by-value / not-comparable / disagree) with maximum relative deviations and both engine versions. Read-only; changes nothing. Requires the sidecar to be configured (SIDECAR_URL and SIDECAR_TOKEN); use it when the user asks to double-check, verify, or validate results against an independent implementation.",
  kind: "read",
  inputSchema: READ_TOOL_INPUT_SCHEMAS.crosscheck_with_python,
  execute: async (_input, context) => {
    const projectId = tenantOf(context);
    // Deployment config is read at call time (not import time) so a sidecar
    // configured after boot is picked up and tests can flip it per case.
    const sidecarUrl = process.env.SIDECAR_URL;
    const sidecarToken = process.env.SIDECAR_TOKEN;
    if (!sidecarUrl || !sidecarToken) {
      return {
        success: false,
        error: {
          code: "SIDECAR_NOT_CONFIGURED",
          message:
            "The chainladder-python sidecar is not configured: set SIDECAR_URL and SIDECAR_TOKEN " +
            "(see interop/sidecar/README.md) to enable second-engine cross-checks. Nothing was compared.",
        },
      } satisfies ToolEnvelopeFailure;
    }

    const view = getWorkspaceView(projectId);
    const basis = view.state.basis;
    const tri = view.triangles[basis];
    const selected = activeSelections(view.state)[basis];
    const tail = activeTail(view.state)[basis];
    const nColumns = tri.ages.length - 1;
    if (nColumns < 1 || selected.length !== nColumns || selected.some((s) => !isNum(s))) {
      return {
        success: false,
        error: {
          code: "INCOMPLETE_SELECTIONS",
          message:
            "The cross-check needs an applied LDF selection for EVERY development column on the " +
            `active (${basis}) basis: unselected columns develop as 1.000 here but replay differently ` +
            "in chainladder-python, which would manufacture a spurious disagreement. Apply a full " +
            "selection vector first (apply_ldf_selections).",
        },
      } satisfies ToolEnvelopeFailure;
    }

    const createdAt = new Date().toISOString();
    const call = {
      sidecarUrl,
      headers: { authorization: `Bearer ${sidecarToken}` },
      timeoutMs: 60_000,
    };
    const abortSignal = (context as { abortSignal?: AbortSignal }).abortSignal;

    // --- author the interchange documents for the active workspace state ---
    const triangleDoc = triangleToDoc(tri, { createdAt, valuationDate: view.state.asOfDate });
    const selections = { selected: [...selected], tailFactor: tail.value };
    const authored = selectionsToDoc(selections, {
      triangleDoc,
      createdAt,
      intents: recoverIntents(selected, view.factors[basis], triangleDoc.triangle.originLengthMonths),
      // The tail VALUE is what the workspace applies; it travels
      // value-authoritative so both engines project with the identical
      // factor (a fitted-tail intent would invite curve-refit noise that
      // says nothing about the projection machinery under referee).
      ...(tail.value !== 1
        ? {
            tailIntent: {
              kind: "judgmental" as const,
              rationale: `Workbench tail (source: ${tail.source}); value authoritative for cross-engine transport`,
            },
          }
        : {}),
      strictness: "warn",
    });

    // --- deterministic-cl: the workbench's own chain ladder vs the sidecar ---
    const tsCl = resultToDoc(runChainLadder(tri, selections), {
      triangleDoc,
      selectionDoc: authored.doc,
      createdAt,
      conventionProfile: "deterministic-cl",
      parameters: {
        selections: "workspace active selections per the linked SelectionDoc",
        tailFactor: tail.value,
      },
    });
    const clpyCl = await callRemoteMethod(
      { ...call, method: "Chainladder" },
      { triangles: { primary: triangleDoc }, selection: authored.doc },
      abortSignal,
    );
    if (!clpyCl.success) return clpyCl;
    const clReport = crosscheck({
      a: tsCl,
      b: clpyCl.doc as MethodResultDoc,
      selection: authored.doc,
      createdAt,
    });
    const clDeviations = reportDeviations(clReport);

    // --- mack1993-vw: as-published Mack (volume-weighted, Mack sigma) on
    // both engines — the PROFILE's pinned run, independent of the applied
    // selections, compared only when this shore can produce SEs ---
    let mackLeg:
      | {
          verdict: CrosscheckReportDoc["report"]["verdict"];
          maxCentral: number;
          maxStandardError: number | null;
          report: CrosscheckReportDoc;
        }
      | { skipped: string };
    let mackReport: CrosscheckReportDoc | null = null;
    try {
      const tsMack = resultToDoc(runMack(tri, {}), {
        triangleDoc,
        selectionDoc: null,
        createdAt,
        conventionProfile: "mack1993-vw",
        parameters: {
          selected: "omitted (volume-weighted per Mack 1993)",
          sigma: "Mack last-column extrapolation (built in)",
          tailFactor: 1,
        },
      });
      const clpyMack = await callRemoteMethod(
        { ...call, method: "MackChainladder" },
        { triangles: { primary: triangleDoc }, parameters: { sigma_interpolation: "mack" } },
        abortSignal,
      );
      if (!clpyMack.success) {
        mackLeg = { skipped: `sidecar Mack run failed: ${clpyMack.error.code} — ${clpyMack.error.message}` };
      } else {
        mackReport = crosscheck({ a: tsMack, b: clpyMack.doc as MethodResultDoc, createdAt });
        mackLeg = { verdict: mackReport.report.verdict, ...reportDeviations(mackReport), report: mackReport };
      }
    } catch (err) {
      // A structured domain error (ReservingError) means the TRIANGLE cannot
      // support Mack (too small, no usable factors) — a legitimate skip. Any
      // OTHER exception is an unexpected failure (a bug in authoring, the
      // referee, or the remote call path) and must NOT be disguised as an
      // expected skip: surface it so a regression is visible, not swallowed.
      if (err instanceof ReservingError) {
        mackLeg = {
          skipped: `Mack standard errors are not computable on this triangle: ${err.message}`,
        };
      } else {
        throw new HttpError(
          500,
          "MACK_LEG_FAILED",
          `the mack1993-vw cross-check failed unexpectedly: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // --- roll-up ---
    const verdicts = [clReport.report.verdict, ...(mackReport ? [mackReport.report.verdict] : [])];
    const overall = verdicts.reduce((worst, v) =>
      (VERDICT_RANK[v] ?? 0) > (VERDICT_RANK[worst] ?? 0) ? v : worst,
    );
    const maxStandardError = [clDeviations, ...("report" in mackLeg ? [mackLeg] : [])]
      .map((d) => d.maxStandardError)
      .reduce<number | null>((max, se) => (se === null ? max : Math.max(max ?? 0, se)), null);
    const warnings = [
      ...authored.warnings.map((w) => `selection authoring: ${w}`),
      ...clReport.report.warnings.map((w) => `deterministic-cl: ${w}`),
      ...(mackReport ? mackReport.report.warnings.map((w) => `mack1993-vw: ${w}`) : []),
      ...("skipped" in mackLeg ? [`mack1993-vw: skipped — ${mackLeg.skipped}`] : []),
    ];
    const engines = clReport.report.engines;
    return {
      success: true,
      basis,
      summary: {
        verdict: overall,
        maxCentral: Math.max(clDeviations.maxCentral, "report" in mackLeg ? mackLeg.maxCentral : 0),
        maxStandardError,
        engineVersions: {
          a: `${engines.a.name}@${engines.a.version}`,
          b: `${engines.b.name}@${engines.b.version}`,
        },
        warnings,
      },
      crosschecks: {
        "deterministic-cl": { verdict: clReport.report.verdict, ...clDeviations, report: clReport },
        "mack1993-vw": mackLeg,
      },
      message:
        `Second-engine cross-check complete: overall verdict "${overall}" ` +
        `(${engines.a.name}@${engines.a.version} vs ${engines.b.name}@${engines.b.version}). ` +
        "Summarize the verdicts and the largest deviations; do not recite the full reports.",
    };
  },
});

export const saveNote = defineActuarialTool({
  id: "save_note",
  description:
    "Save a short written note to the project's analysis notes (visible in the Notes panel). Use for conclusions, caveats, and rationale worth keeping outside the chat.",
  kind: "action",
  inputSchema: z.object({
    text: z.string().min(1).max(4000).describe("The note text"),
  }),
  execute: async (input, context) => {
    const projectId = tenantOf(context);
    const note = insertNote(projectId, "advisor", input.text);
    return { success: true, noteId: note.id, message: "Note saved." };
  },
});

/**
 * The registry classifies tools by kind: `tools` keys the record by tool id
 * (the same ids/order as before the @actuarial-ts/agents migration) and
 * `actionToolIds` is the workspace-mutating set the chat route flags for
 * client refresh.
 */
const registry = toolRegistry([
  getWorkspaceOverview,
  analyzeDevelopmentFactors,
  fitTailCurves,
  assessDataQuality,
  getDiagnosticDetail,
  getAnalysisResults,
  applyLdfSelections,
  setTailFactor,
  setBfApriori,
  setUltimateSelection,
  analyzeClaimSizes,
  setLossCap,
  analyzeTrends,
  setTrendSelections,
  deriveExpectedLosses,
  advanceElrDerivation,
  analyzeElr,
  setAprioriMethod,
  setElr,
  setRateHistory,
  fitSeverityCurves,
  setIlfSource,
  runAnalysisTool,
  runSensitivityTool,
  crosscheckWithPython,
  saveNote,
]);

export const advisorTools = registry.tools;

/** Tool ids that mutate the workspace (the UI refreshes after these). */
export const ACTION_TOOL_IDS = registry.actionToolIds;
