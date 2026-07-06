import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../state/store.js";
import { Button, EmptyState, Section, fmt0 } from "../components/ui.js";

export default function ProjectsPage() {
  const projects = useStore((s) => s.projects);
  const projectsLoaded = useStore((s) => s.projectsLoaded);
  const loadProjects = useStore((s) => s.loadProjects);
  const createProject = useStore((s) => s.createProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const navigate = useNavigate();

  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const submit = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const project = await createProject(name.trim(), description.trim());
      setShowNew(false);
      setName("");
      setDescription("");
      navigate(`/projects/${project.id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-[960px]">
      <Section
        title="Projects"
        kicker="reserve analyses"
        actions={
          <Button kind="primary" onClick={() => setShowNew((v) => !v)}>
            {showNew ? "Cancel" : "New project"}
          </Button>
        }
      >
        {showNew ? (
          <form
            className="mb-5 flex flex-col gap-3 border border-hairline bg-paper p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="flex flex-col gap-1 text-[0.8rem] font-medium text-ink-soft">
              Project name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. GL Occurrence, year-end 2025"
                className="rounded-sm border border-hairline-strong bg-panel px-3 py-2 text-[0.95rem] text-ink outline-none focus:border-steel"
              />
            </label>
            <label className="flex flex-col gap-1 text-[0.8rem] font-medium text-ink-soft">
              Description (optional)
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Line of business, evaluation date, purpose"
                className="rounded-sm border border-hairline-strong bg-panel px-3 py-2 text-[0.95rem] text-ink outline-none focus:border-steel"
              />
            </label>
            <div>
              <Button kind="primary" type="submit" disabled={!name.trim() || creating}>
                {creating ? "Creating..." : "Create project"}
              </Button>
            </div>
          </form>
        ) : null}

        {!projectsLoaded ? (
          <EmptyState title="Loading projects..." />
        ) : projects.length === 0 ? (
          <EmptyState title="No projects yet">
            Create a project, then import a loss run (CSV or Excel) to build triangles.
          </EmptyState>
        ) : (
          <ul className="flex flex-col">
            {projects.map((p) => (
              <li
                key={p.id}
                className="group flex cursor-pointer items-center justify-between gap-4 border-b border-hairline px-2 py-3 transition-colors last:border-b-0 hover:bg-steel-soft/50"
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                <div className="min-w-0">
                  <p className="truncate font-display text-[1.08rem] font-semibold text-ink group-hover:text-steel">
                    {p.name}
                  </p>
                  {p.description ? (
                    <p className="mt-0.5 line-clamp-1 text-[0.82rem] text-ink-faint">
                      {p.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-5">
                  <div className="text-right">
                    <p className="num text-[0.95rem] font-medium text-ink">
                      {fmt0(p.claimCount)}
                    </p>
                    <p className="text-[0.68rem] uppercase tracking-[0.12em] text-ink-faint">
                      claims
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num text-[0.95rem] font-medium text-ink">
                      {fmt0(p.exposureCount)}
                    </p>
                    <p className="text-[0.68rem] uppercase tracking-[0.12em] text-ink-faint">
                      exposure yrs
                    </p>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    {confirmingDelete === p.id ? (
                      <div className="flex items-center gap-2">
                        <Button
                          kind="danger"
                          onClick={() => {
                            void deleteProject(p.id);
                            setConfirmingDelete(null);
                          }}
                        >
                          Delete permanently
                        </Button>
                        <Button kind="ghost" onClick={() => setConfirmingDelete(null)}>
                          Keep
                        </Button>
                      </div>
                    ) : (
                      <Button kind="ghost" onClick={() => setConfirmingDelete(p.id)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="mt-4 px-1 text-[0.78rem] leading-relaxed text-ink-faint">
        Loss runs are claim-level evaluation snapshots: one row per claim per evaluation date with
        columns claim_id, accident_date, report_date, evaluation_date, paid_to_date, case_reserve,
        status. The seeded demo writes matching CSVs to apps/server/data/demo/ for trying the
        import flow.
      </p>
    </div>
  );
}
