import type { LayerKey, WorkspaceState } from "../api/types.js";

interface AnalysisInputs {
  layer: WorkspaceState["layer"];
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
