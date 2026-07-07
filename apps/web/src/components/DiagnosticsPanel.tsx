import { useState } from "react";
import { useStore } from "../state/store.js";
import { Section, SeverityBadge, fmt0, fmtFactor } from "./ui.js";

/**
 * The assumption-violation radar: findings first (what an actuary should
 * worry about), then the underlying grids on tabs, then the Mack
 * calendar-year test verdict.
 */
export default function DiagnosticsPanel() {
  const workspace = useStore((s) => s.workspace);
  const [tab, setTab] = useState<"paidToIncurred" | "averageCase" | "closureRates" | "counts">(
    "paidToIncurred",
  );

  if (!workspace) return null;
  const d = workspace.diagnostics;
  const origins = workspace.triangles.paid.origins;
  const ages = workspace.triangles.paid.ages;

  const grids = {
    paidToIncurred: {
      label: "Paid / incurred",
      grid: d.paidToIncurredRatios,
      render: (v: number | null) => (v === null ? "" : fmtFactor(v)),
    },
    averageCase: {
      label: "Average case reserve",
      grid: d.averageCaseReserves,
      render: (v: number | null) => (v === null ? "" : fmt0(v)),
    },
    closureRates: {
      label: "Closure rates",
      grid: d.closureRates,
      render: (v: number | null) => (v === null ? "" : fmtFactor(v)),
    },
  } as const;

  const cy = d.calendarYearTest;

  return (
    <Section title="Diagnostics" kicker="method assumption checks">
      <ul className="mb-4 flex flex-col gap-2">
        {d.findings.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <SeverityBadge severity={f.severity} />
            <p className="text-[0.85rem] leading-relaxed text-ink">{f.message}</p>
          </li>
        ))}
      </ul>

      {cy ? (
        <p className="mb-4 border-l-2 border-steel pl-3 text-[0.8rem] leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">Mack calendar-year test:</span> Z ={" "}
          <span className="num">{cy.totalZ.toFixed(1)}</span> against an expected{" "}
          <span className="num">{cy.expectedTotalZ.toFixed(1)}</span> (95% range{" "}
          <span className="num">
            {cy.confidenceInterval[0].toFixed(1)} to {cy.confidenceInterval[1].toFixed(1)}
          </span>
          ) - {cy.significant ? "diagonal effects detected" : "no significant diagonal effects"}.{" "}
          <span className="text-ink-faint">
            This test detects correlated adjacent development factors along diagonals; a steady
            settlement-rate or case-adequacy trend flagged above can be real without tripping it.
          </span>
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(Object.keys(grids) as (keyof typeof grids)[]).map((key) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-sm px-2.5 py-1 text-[0.78rem] font-medium transition-colors ${
              tab === key ? "bg-ink text-paper" : "text-ink-soft hover:bg-steel-soft"
            }`}
          >
            {grids[key].label}
          </button>
        ))}
        <button
          aria-pressed={tab === "counts"}
          onClick={() => setTab("counts")}
          className={`rounded-sm px-2.5 py-1 text-[0.78rem] font-medium transition-colors ${
            tab === "counts" ? "bg-ink text-paper" : "text-ink-soft hover:bg-steel-soft"
          }`}
        >
          Claim counts
        </button>
      </div>

      {tab === "counts" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {(
            [
              ["reportedCount", "Reported claims"],
              ["closedCount", "Closed claims"],
              ["openCount", "Open claims"],
              ["closedWithPayCount", "Closed with payment"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="overflow-x-auto">
              <table className="ledger w-full min-w-[480px]">
                <caption className="pb-1.5 text-left text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint">
                  {label}
                </caption>
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink-soft">
                      Origin
                    </th>
                    {ages.map((age) => (
                      <th
                        key={age}
                        className="num px-1.5 py-1 text-right text-[0.7rem] font-semibold text-ink-soft"
                      >
                        {age}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {origins.map((origin, i) => (
                    <tr key={origin}>
                      <td className="px-2 py-0.5 text-[0.76rem] font-medium text-ink-soft">
                        {origin}
                      </td>
                      {ages.map((_, j) => {
                        const v = workspace.triangles[key].values[i]?.[j];
                        return (
                          <td key={j} className="num px-1.5 py-0.5 text-right text-[0.76rem] text-ink">
                            {v === null || v === undefined ? "" : fmt0(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="ledger w-full min-w-[560px]">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink-soft">
                  Origin
                </th>
                {ages.map((age) => (
                  <th
                    key={age}
                    className="num px-1.5 py-1 text-right text-[0.7rem] font-semibold text-ink-soft"
                  >
                    {age}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {origins.map((origin, i) => (
                <tr key={origin} className="hover:bg-steel-soft/40">
                  <td className="px-2 py-0.5 text-[0.78rem] font-medium text-ink-soft">{origin}</td>
                  {ages.map((_, j) => (
                    <td key={j} className="num px-1.5 py-0.5 text-right text-[0.78rem] text-ink">
                      {grids[tab].render(grids[tab].grid[i]?.[j] ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
