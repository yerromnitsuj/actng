import { useEffect } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { useStore } from "./state/store.js";
import ProjectsPage from "./pages/ProjectsPage.js";
import WorkspacePage from "./pages/WorkspacePage.js";

export default function App() {
  const error = useStore((s) => s.error);
  const clearError = useStore((s) => s.clearError);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(clearError, 8000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b-2 border-ink bg-paper">
        <div className="mx-auto flex w-full max-w-[1720px] items-baseline justify-between px-6 py-3">
          <Link to="/" className="group flex items-baseline gap-3 no-underline">
            <span className="font-display text-[1.65rem] font-semibold italic tracking-tight text-ink">
              ActNG
            </span>
            <span className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-ink-soft group-hover:text-steel">
              Reserving Workbench
            </span>
          </Link>
          <span className="hidden text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint sm:block">
            Unpaid claim estimation - P&C
          </span>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="sticky top-0 z-50 border-b border-oxblood bg-oxblood-soft px-6 py-2 text-[0.85rem] text-oxblood shadow-[0_2px_6px_rgb(163_46_46/0.15)]"
        >
          <div className="mx-auto flex w-full max-w-[1720px] items-center justify-between">
            <span>{error}</span>
            <button onClick={clearError} className="font-semibold hover:underline">
              dismiss
            </button>
          </div>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-[1720px] flex-1 px-6 py-6">
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<WorkspacePage />} />
        </Routes>
      </main>
    </div>
  );
}
