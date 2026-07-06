import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store.js";
import { Button, Section, fmtFactor } from "./ui.js";

/**
 * The actuarial heart of the workbench: age-to-age factors, the averages
 * menu (click any cell to select it for that interval; apply a whole row at
 * once), the editable selected-LDF ledger row, and tail factor fitting.
 * Every change recomputes consequences immediately via the workspace PATCH.
 */
export default function FactorPanel() {
  const workspace = useStore((s) => s.workspace);
  const patchWorkspace = useStore((s) => s.patchWorkspace);
  const [draft, setDraft] = useState<string[]>([]);
  const [manualTail, setManualTail] = useState("");
  const [showIndividual, setShowIndividual] = useState(true);
  /** While the user is typing in a draft cell, workspace refreshes (e.g. from
   * advisor actions) must not clobber the in-progress edit. */
  const editingLdf = useRef(false);
  const editingTail = useRef(false);

  const basis = workspace?.state.basis ?? "paid";
  const factors = workspace?.factors[basis] ?? null;
  const triangle = workspace?.triangles[basis] ?? null;
  const selections = useMemo(
    () => workspace?.state.selections[basis] ?? [],
    [workspace, basis],
  );
  const tail = workspace?.state.tail[basis] ?? null;
  const tailFits = workspace?.tailFits[basis] ?? null;

  useEffect(() => {
    if (editingLdf.current) return;
    setDraft(selections.map((v) => (v === null ? "" : String(Math.round(v * 10000) / 10000))));
  }, [selections]);

  useEffect(() => {
    if (editingTail.current) return;
    if (tail) setManualTail(String(Math.round(tail.value * 10000) / 10000));
  }, [tail]);

  if (!workspace || !factors || !triangle) return null;

  const nCols = factors.fromAges.length;

  const applySelections = (selected: (number | null)[]) => {
    void patchWorkspace({ selections: { basis, selected } });
  };

  const selectCell = (j: number, value: number | null) => {
    if (value === null) return;
    const next = [...selections];
    next[j] = Math.round(value * 10000) / 10000;
    applySelections(next);
  };

  const commitDraft = (j: number) => {
    const raw = draft[j]?.trim() ?? "";
    const next = [...selections];
    if (raw === "") {
      next[j] = null;
    } else {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        // Restore the previous value; the store surfaces server-side errors.
        setDraft(selections.map((v) => (v === null ? "" : String(v))));
        return;
      }
      next[j] = parsed;
    }
    if (next.every((v, idx) => v === selections[idx])) return;
    applySelections(next);
  };

  const columnHeader = (
    <tr>
      <th className="sticky left-0 bg-panel px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
        Average
      </th>
      {factors.fromAges.map((from, j) => (
        <th
          key={j}
          className="num px-2 py-1.5 text-right text-[0.72rem] font-semibold text-ink-soft"
        >
          {from}-{factors.toAges[j]}
        </th>
      ))}
      <th className="w-20 px-2" />
    </tr>
  );

  return (
    <Section
      title="Development factors"
      kicker={`${basis} basis - click any average to select it for that interval`}
      actions={
        <Button kind="ghost" onClick={() => setShowIndividual((v) => !v)}>
          {showIndividual ? "Hide" : "Show"} individual factors
        </Button>
      }
    >
      {showIndividual ? (
        <div className="mb-5 overflow-x-auto">
          <table className="ledger w-full min-w-[640px]">
            <caption className="pb-2 text-left text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint">
              Individual age-to-age factors
            </caption>
            <thead>
              <tr>
                <th className="px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Origin
                </th>
                {factors.fromAges.map((from, j) => (
                  <th
                    key={j}
                    className="num px-2 py-1.5 text-right text-[0.72rem] font-semibold text-ink-soft"
                  >
                    {from}-{factors.toAges[j]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {triangle.origins.map((origin, i) => (
                <tr key={origin} className="hover:bg-steel-soft/40">
                  <td className="px-2 py-1 text-[0.8rem] font-medium text-ink-soft">{origin}</td>
                  {factors.fromAges.map((_, j) => (
                    <td key={j} className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                      {fmtFactor(factors.individual[i]?.[j] ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="ledger w-full min-w-[640px]">
          <thead>{columnHeader}</thead>
          <tbody>
            {factors.averages.map((avg) => (
              <tr key={avg.spec.key} className="hover:bg-steel-soft/40">
                <td className="sticky left-0 bg-panel px-2 py-1 text-[0.8rem] text-ink-soft">
                  {avg.spec.label}
                </td>
                {avg.values.map((v, j) => {
                  const isSelected =
                    v !== null &&
                    selections[j] !== null &&
                    Math.abs((selections[j] ?? 0) - Math.round(v * 10000) / 10000) < 5e-5;
                  return (
                    <td key={j} className="px-0.5 py-0.5 text-right">
                      <button
                        disabled={v === null}
                        onClick={() => selectCell(j, v)}
                        className={`num w-full rounded-sm px-1.5 py-0.5 text-right text-[0.8rem] transition-colors ${
                          v === null
                            ? "cursor-default text-ink-faint"
                            : isSelected
                              ? "bg-steel text-paper"
                              : "text-ink hover:bg-steel-soft"
                        }`}
                        title={v === null ? "Not computable" : `Select ${fmtFactor(v, 4)} for this interval`}
                      >
                        {fmtFactor(v)}
                      </button>
                    </td>
                  );
                })}
                <td className="px-2 py-0.5 text-right">
                  <button
                    onClick={() => applySelections(avg.values.map((v) => (v === null ? null : Math.round(v * 10000) / 10000)))}
                    className="rounded-sm px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-steel hover:bg-steel-soft"
                    title={`Select the entire ${avg.spec.label} row`}
                  >
                    use row
                  </button>
                </td>
              </tr>
            ))}
            {/* The selected ledger row: double rule above, editable */}
            <tr className="border-t-2 border-ink bg-gold-soft/60">
              <td className="sticky left-0 bg-gold-soft px-2 py-1.5 text-[0.8rem] font-semibold text-ink">
                Selected LDF
              </td>
              {Array.from({ length: nCols }, (_, j) => (
                <td key={j} className="px-0.5 py-1">
                  <input
                    value={draft[j] ?? ""}
                    onFocus={() => {
                      editingLdf.current = true;
                    }}
                    onChange={(e) => {
                      const next = [...draft];
                      next[j] = e.target.value;
                      setDraft(next);
                    }}
                    onBlur={() => {
                      editingLdf.current = false;
                      commitDraft(j);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    placeholder="-"
                    className="num w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-right text-[0.82rem] font-semibold text-ink outline-none focus:border-steel focus:bg-panel"
                  />
                </td>
              ))}
              <td className="px-2 text-right">
                <button
                  onClick={() => applySelections(new Array(nCols).fill(null))}
                  className="rounded-sm px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-oxblood hover:bg-oxblood-soft"
                  title="Clear all selections"
                >
                  clear
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tail factor */}
      <div className="mt-5 border-t border-hairline pt-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="font-display text-[1rem] font-semibold text-ink">Tail factor</h3>
          <p className="text-[0.8rem] text-ink-soft">
            Current:{" "}
            <span className="num font-semibold text-ink">{tail ? fmtFactor(tail.value, 4) : "-"}</span>{" "}
            <span className="text-ink-faint">
              ({tail?.source === "manual" ? "manual" : tail?.source === "exponentialDecay" ? "fitted exponential decay" : "fitted inverse power"})
            </span>
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {tailFits
            ? (
                [
                  ["exponentialDecay", "Exponential decay", "ln(f-1) linear in age"],
                  ["inversePower", "Inverse power", "ln(f-1) linear in ln(age)"],
                ] as const
              ).map(([key, label, formula]) => {
                const fit = tailFits[key];
                return (
                  <div
                    key={key}
                    className={`flex flex-col gap-1.5 rounded-sm border p-3 ${
                      fit.valid ? "border-hairline bg-paper" : "border-oxblood/40 bg-oxblood-soft/40"
                    }`}
                  >
                    <div className="flex items-baseline justify-between">
                      <p className="text-[0.85rem] font-semibold text-ink">{label}</p>
                      <p className="text-[0.68rem] uppercase tracking-[0.1em] text-ink-faint">
                        {formula}
                      </p>
                    </div>
                    {fit.valid ? (
                      <p className="num text-[1.25rem] font-semibold text-ink">
                        {fmtFactor(fit.tailFactor, 4)}
                        <span className="ml-2 text-[0.72rem] font-normal text-ink-faint">
                          R<sup>2</sup> {fmtFactor(fit.rSquared, 3)} - {fit.nPoints} pts
                        </span>
                      </p>
                    ) : (
                      <p className="text-[0.78rem] leading-snug text-oxblood">
                        {fit.warnings[fit.warnings.length - 1] ?? "Fit unavailable"}
                      </p>
                    )}
                    {fit.valid && fit.warnings.length > 0 ? (
                      <p className="text-[0.72rem] leading-snug text-[#7a5c1d]">
                        {fit.warnings.join(" ")}
                      </p>
                    ) : null}
                    <div className="mt-auto pt-1">
                      <Button
                        kind="secondary"
                        disabled={!fit.valid}
                        onClick={() => void patchWorkspace({ tail: { basis, source: key } })}
                      >
                        Use this tail
                      </Button>
                    </div>
                  </div>
                );
              })
            : null}
          <div className="flex flex-col gap-1.5 rounded-sm border border-hairline bg-paper p-3">
            <p className="text-[0.85rem] font-semibold text-ink">Judgmental</p>
            <p className="text-[0.68rem] uppercase tracking-[0.1em] text-ink-faint">
              direct entry
            </p>
            <input
              value={manualTail}
              onFocus={() => {
                editingTail.current = true;
              }}
              onBlur={() => {
                editingTail.current = false;
              }}
              onChange={(e) => setManualTail(e.target.value)}
              className="num rounded-sm border border-hairline-strong bg-panel px-2 py-1.5 text-right text-[1rem] font-semibold text-ink outline-none focus:border-steel"
            />
            <div className="mt-auto pt-1">
              <Button
                kind="secondary"
                disabled={!Number.isFinite(Number(manualTail)) || Number(manualTail) <= 0}
                onClick={() =>
                  void patchWorkspace({
                    tail: { basis, source: "manual", value: Number(manualTail) },
                  })
                }
              >
                Apply manual tail
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
