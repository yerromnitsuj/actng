import type { LayerKey, WorkspaceState } from "../api/types.js";

interface AnalysisInputs {
  layer: WorkspaceState["layer"];
  ilf?: WorkspaceState["ilf"];
  rates?: WorkspaceState["rates"];
  elr?: WorkspaceState["elr"];
  trend?: WorkspaceState["trend"];
  selections: WorkspaceState["selections"];
  tail: WorkspaceState["tail"];
  bf: WorkspaceState["bf"];
  berquist: WorkspaceState["berquist"];
  cadence: string;
  asOfDate: string;
}

const DEFAULT_LAYER: WorkspaceState["layer"] = {
  active: "unlimited",
  cap: null,
  indexRate: 0,
  baseYear: null,
};

type FlatSelections = { paid: (number | null)[]; incurred: (number | null)[] };
type FlatTail = WorkspaceState["tail"]["unlimited"];

/**
 * A run's selections/tail for one layer, tolerating the pre-layer flat shape
 * (which was the unlimited layer by construction).
 */
function layerSlice<T>(
  nested: Record<LayerKey, T> | T | undefined,
  layer: LayerKey,
): T | undefined {
  if (!nested) return undefined;
  const maybe = nested as Record<LayerKey, T>;
  if (maybe.unlimited !== undefined || maybe.capped !== undefined) {
    return maybe[layer];
  }
  // Legacy flat shape = unlimited. (A legacy run can only be compared while
  // the unlimited layer is active; a capped state differs on `layer` first.)
  return layer === "unlimited" ? (nested as T) : undefined;
}

/**
 * True when the workspace's method inputs no longer match the snapshot that
 * produced a given analysis run. Only inputs that feed the ACTIVE layer's
 * pipeline count: editing the inactive layer's selections must not flag the
 * active layer's results, and vice versa staleness on layer switch comes from
 * the layer block itself. Selection weights/overrides are deliberately NOT
 * inputs here: they re-blend existing results without a rerun.
 */
export function resultsAreStale(inputs: unknown, state: WorkspaceState | undefined): boolean {
  if (!inputs || !state) return false;
  const run = inputs as Partial<AnalysisInputs>;

  const runLayer = run.layer ?? DEFAULT_LAYER;
  // Only layer settings that FEED the active pipeline count: while unlimited
  // is active, tuning cap/indexRate/baseYear to explore the Layer exhibit
  // must not flag results whose numbers cannot change.
  if (runLayer.active !== state.layer.active) return true;
  if (
    state.layer.active === "capped" &&
    (runLayer.cap !== state.layer.cap ||
      runLayer.indexRate !== state.layer.indexRate ||
      runLayer.baseYear !== state.layer.baseYear)
  ) {
    return true;
  }

  // ILF settings only feed capped runs, and only the fields that RESOLVE the
  // factor for the chosen source count - editing a leftover table while the
  // source is fitted (or a target while source is none) changes nothing.
  if (state.layer.active === "capped") {
    const signature = (c: WorkspaceState["ilf"] | undefined): string => {
      const cfg = c ?? {
        source: "none" as const,
        fittedKind: "lognormal" as const,
        curveId: null,
        table: null,
        targetLimit: null,
      };
      switch (cfg.source) {
        case "none":
          return "none";
        case "fitted":
          return `fitted|${cfg.fittedKind}|${cfg.targetLimit ?? "unlimited"}`;
        case "illustrative":
          return `illustrative|${cfg.curveId ?? ""}|${cfg.targetLimit ?? "unlimited"}`;
        case "table":
          return `table|${JSON.stringify(cfg.table ?? null)}|${cfg.targetLimit ?? "unlimited"}`;
      }
    };
    if (signature(run.ilf) !== signature(state.ilf)) return true;
  }

  const active = state.layer.active;
  type FlatBf = { aprioriLossRatio: number | null };
  type FlatBerquist = WorkspaceState["berquist"]["unlimited"];
  const pick = (
    selections: FlatSelections | undefined,
    tail: FlatTail | undefined,
    bf: FlatBf | undefined,
    berquist: FlatBerquist | undefined,
    s: Partial<AnalysisInputs> | WorkspaceState,
  ) =>
    JSON.stringify({
      selections: selections ?? null,
      tail: tail ?? null,
      bf: bf ?? null,
      berquist: berquist ?? null,
      rates: (s as Partial<AnalysisInputs>).rates ?? { history: [], premiumTrend: null },
      elr: (s as Partial<AnalysisInputs>).elr ?? { selected: null },
      // Trend feeds Cape Cod / Expected Claims / the BF a-priori; only the
      // ACTIVE layer's severity slot matters to this run. Pre-phase-4 runs
      // had no trend influence, normalized to the empty default.
      trend: (() => {
        const t = (s as Partial<AnalysisInputs>).trend ?? ("trend" in s ? (s as WorkspaceState).trend : undefined);
        if (!t) return { frequency: null, severity: null, targetYear: null };
        return {
          frequency: t.frequency?.value ?? null,
          severity: t.severity?.[active]?.value ?? null,
          targetYear: t.targetYear ?? null,
        };
      })(),
      cadence: s.cadence,
      asOfDate: s.asOfDate,
    });

  return (
    pick(
      layerSlice<FlatSelections>(run.selections, active),
      layerSlice<FlatTail>(run.tail, active),
      layerSlice<FlatBf>(run.bf as never, active),
      layerSlice<FlatBerquist>(run.berquist as never, active),
      run,
    ) !==
    pick(
      state.selections[active],
      state.tail[active],
      state.bf[active],
      state.berquist[active],
      state,
    )
  );
}
