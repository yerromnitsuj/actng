import type { WorkspaceState } from "../api/types.js";

interface AnalysisInputs {
  selections: WorkspaceState["selections"];
  tail: WorkspaceState["tail"];
  bf: WorkspaceState["bf"];
  berquist: WorkspaceState["berquist"];
  cadence: string;
  asOfDate: string;
}

/**
 * True when the workspace's method inputs no longer match the snapshot that
 * produced a given analysis run. Selection weights/overrides are deliberately
 * NOT inputs here: they re-blend existing results without a rerun.
 */
export function resultsAreStale(inputs: unknown, state: WorkspaceState | undefined): boolean {
  if (!inputs || !state) return false;
  const run = inputs as Partial<AnalysisInputs>;
  const pick = (s: Partial<AnalysisInputs> | WorkspaceState) =>
    JSON.stringify({
      selections: s.selections,
      tail: s.tail,
      bf: s.bf,
      berquist: s.berquist,
      cadence: s.cadence,
      asOfDate: s.asOfDate,
    });
  return pick(run) !== pick(state);
}
