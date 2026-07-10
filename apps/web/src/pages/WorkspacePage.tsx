import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useStore } from "../state/store.js";
import { Button, EmptyState, Section } from "../components/ui.js";
import TriangleGrid from "../components/TriangleGrid.js";
import FactorPanel from "../components/FactorPanel.js";
import ResultsPanel from "../components/ResultsPanel.js";
import SelectionPanel from "../components/SelectionPanel.js";
import DiagnosticsPanel from "../components/DiagnosticsPanel.js";
import AdvisorPanel from "../components/AdvisorPanel.js";
import LayerPanel from "../components/LayerPanel.js";
import TrendPanel from "../components/TrendPanel.js";
import RatesPanel from "../components/RatesPanel.js";
import ElrPanel from "../components/ElrPanel.js";
import IlfPanel from "../components/IlfPanel.js";
import ImportPanel from "../components/ImportPanel.js";
import NotesPanel from "../components/NotesPanel.js";

export default function WorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const workspace = useStore((s) => s.workspace);
  const workspaceLoading = useStore((s) => s.workspaceLoading);
  const openProject = useStore((s) => s.openProject);
  const patchWorkspace = useStore((s) => s.patchWorkspace);
  const runAnalysis = useStore((s) => s.runAnalysis);
  const runningAnalysis = useStore((s) => s.runningAnalysis);
  const runError = useStore((s) => s.runError);
  const clearRunError = useStore((s) => s.clearRunError);
  const advisorChangeTick = useStore((s) => s.advisorChangeTick);
  const projects = useStore((s) => s.projects);
  const loadProjects = useStore((s) => s.loadProjects);

  useEffect(() => {
    if (!projectId) return;
    void openProject(projectId);
    if (projects.length === 0) void loadProjects();
  }, [projectId, openProject, loadProjects, projects.length]);

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  if (!projectId) return null;

  const basis = workspace?.state.basis ?? "paid";
  const activeTriangle = workspace ? workspace.triangles[basis] : null;

  return (
    <div className="flex gap-5">
      {/* Main analysis column */}
      <div className="flex min-w-0 flex-1 flex-col gap-5" key={advisorChangeTick}>
        <div className="rise flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-display text-[1.5rem] font-semibold tracking-tight text-ink">
              {project?.name ?? "Project"}
            </h1>
            {workspace ? (
              <p className="text-[0.78rem] text-ink-faint">
                Evaluated{" "}
                <span className="num font-medium text-ink-soft">{workspace.state.asOfDate}</span>
                {" - "}
                {workspace.state.cadence} origin periods
                {" - "}
                <span className="num">{workspace.dataAsOf.claimCount.toLocaleString()}</span>{" "}
                claims /{" "}
                <span className="num">{workspace.dataAsOf.claimRows.toLocaleString()}</span>{" "}
                snapshot rows
              </p>
            ) : null}
          </div>
          {workspace ? (
            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-sm border border-hairline-strong">
                {(["paid", "incurred"] as const).map((b) => (
                  <button
                    key={b}
                    aria-pressed={basis === b}
                    onClick={() => void patchWorkspace({ basis: b })}
                    className={`px-3 py-1.5 text-[0.8rem] font-medium capitalize transition-colors ${
                      basis === b
                        ? "bg-ink text-paper"
                        : "bg-transparent text-ink-soft hover:bg-steel-soft"
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
              <div className="flex overflow-hidden rounded-sm border border-hairline-strong">
                {(["unlimited", "capped"] as const).map((l) => {
                  const active = workspace.state.layer.active === l;
                  const disabled = l === "capped" && workspace.state.layer.cap === null;
                  return (
                    <button
                      key={l}
                      aria-pressed={active}
                      disabled={disabled}
                      title={
                        disabled
                          ? "Set a per-occurrence cap in the Development layer exhibit first"
                          : l === "capped"
                            ? "Develop losses capped at the per-occurrence limit (own selections and tails)"
                            : "Develop unlimited losses"
                      }
                      onClick={() => void patchWorkspace({ layer: { active: l } })}
                      className={`px-3 py-1.5 text-[0.8rem] font-medium capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        active
                          ? "bg-steel text-paper"
                          : "bg-transparent text-ink-soft hover:bg-steel-soft"
                      }`}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
              <select
                value={workspace.state.cadence}
                onChange={(e) => void patchWorkspace({ cadence: e.target.value })}
                className="rounded-sm border border-hairline-strong bg-panel px-2 py-1.5 text-[0.8rem] text-ink-soft outline-none focus:border-steel"
                title="Origin period cadence (changing it resets selections)"
              >
                <option value="annual">Annual</option>
                <option value="quarterly">Quarterly</option>
              </select>
              <Button kind="primary" onClick={() => void runAnalysis()} disabled={runningAnalysis}>
                {runningAnalysis ? "Running..." : "Run analysis"}
              </Button>
            </div>
          ) : null}
        </div>

        {runError ? (
          <div
            role="alert"
            className="rise rounded-sm border border-oxblood bg-oxblood-soft px-4 py-3 text-[0.85rem] text-oxblood"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0">
                <span className="font-semibold">Run failed - nothing changed.</span> {runError}
              </p>
              <button
                onClick={clearRunError}
                className="shrink-0 font-semibold hover:underline"
              >
                dismiss
              </button>
            </div>
          </div>
        ) : null}

        {workspaceLoading ? (
          <Section title="Workspace" kicker="loading">
            <EmptyState title="Building triangles..." />
          </Section>
        ) : !workspace ? (
          <>
            <Section title="Import data" kicker="loss run required">
              <ImportPanel projectId={projectId} />
            </Section>
          </>
        ) : (
          <>
            <Section
              title={`${basis === "paid" ? "Paid losses" : "Incurred losses"}`}
              kicker={`cumulative triangle - development age (months) - gold cells mark the ${workspace.state.asOfDate} diagonal`}
            >
              {activeTriangle ? <TriangleGrid triangle={activeTriangle} /> : null}
            </Section>

            <LayerPanel />

            <IlfPanel />

            <FactorPanel />

            <ResultsPanel />

            <SelectionPanel />

            <TrendPanel />

            <RatesPanel />

            <ElrPanel />

            <DiagnosticsPanel />

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Section title="Notes" kicker="analysis record">
                <NotesPanel />
              </Section>
              <Section title="Data" kicker="import / replace">
                <ImportPanel projectId={projectId} />
              </Section>
            </div>
          </>
        )}
      </div>

      {/* Advisor rail */}
      <AdvisorPanel />
    </div>
  );
}
