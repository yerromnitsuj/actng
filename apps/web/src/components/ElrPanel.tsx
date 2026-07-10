import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.js";
import { EmptyState, Section, fmt0, fmtPct } from "./ui.js";

/**
 * The expected-loss-ratio compilation: per-year trended SELECTED ultimates
 * over on-level trended premium, an averages menu, the Cape Cod mechanical
 * ELR as cross-check, and the ONE selected ELR (at target level) that feeds
 * BF's a-priori and the Expected Claims method on the next run.
 */
export default function ElrPanel() {
  const workspace = useStore((s) => s.workspace);
  const patchWorkspace = useStore((s) => s.patchWorkspace);

  const review = workspace?.elrReview ?? null;
  const [selectedDraft, setSelectedDraft] = useState("");
  const editing = useRef(false);

  useEffect(() => {
    if (!review || editing.current) return;
    setSelectedDraft(review.selected !== null ? (review.selected * 100).toFixed(1) : "");
  }, [review]);

  if (!review) {
    return (
      <Section title="Expected loss ratio" kicker="trended on-level loss ratios and the a-priori">
        <EmptyState title="Run an analysis with premium data first">
          The ELR exhibit compiles trended selected ultimates over on-level premium from the
          latest run.
        </EmptyState>
      </Section>
    );
  }

  const commitSelected = () => {
    editing.current = false;
    const seeded = review.selected !== null ? (review.selected * 100).toFixed(1) : "";
    if (selectedDraft.trim() === seeded) return;
    const raw = selectedDraft.trim().replace(/%/g, "");
    const parsed = raw === "" ? null : Number(raw) / 100;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setSelectedDraft(seeded);
      return;
    }
    void patchWorkspace({ elr: { selected: parsed } });
  };

  const useAverage = (value: number | null) => {
    if (value === null) return;
    void patchWorkspace({ elr: { selected: Math.round(value * 10000) / 10000 } });
  };

  const levelLabel =
    review.level === "restored"
      ? "RESTORED total-limits"
      : review.level === "limited"
        ? "LIMITED (capped)"
        : "unlimited";

  return (
    <Section
      title="Expected loss ratio"
      kicker={`trended SELECTED ultimates (${levelLabel}) / on-level trended premium, at ${review.targetYear} level`}
    >
      {review.warnings.length > 0 ? (
        <p className="mb-3 rounded-sm border border-gold bg-gold-soft px-3 py-1.5 text-[0.78rem] leading-relaxed text-[#6b4f16]">
          {review.warnings.join(". ")}.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="ledger w-full min-w-[880px]">
          <thead>
            <tr>
              {[
                "Year",
                "Earned premium",
                "OLF",
                "On-level trended",
                "Selected ultimate",
                `Trended @${review.targetYear}`,
                "Loss ratio",
              ].map((h, i) => (
                <th
                  key={h}
                  className={`px-2 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft ${
                    i === 0 ? "text-left" : "text-right"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {review.rows.map((r) => (
              <tr key={r.origin} className="hover:bg-steel-soft/40">
                <td className="px-2 py-1 text-[0.82rem] font-medium text-ink-soft">{r.origin}</td>
                <td className="num px-2 py-1 text-right text-[0.8rem] text-ink-soft">
                  {fmt0(r.premium)}
                </td>
                <td className="num px-2 py-1 text-right text-[0.8rem] text-ink-soft">
                  {r.onLevelFactor.toFixed(3)}
                </td>
                <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                  {fmt0(r.onLevelTrendedPremium)}
                </td>
                <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                  {r.selectedUltimate !== null ? fmt0(r.selectedUltimate) : "-"}
                </td>
                <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                  {r.trendedUltimate !== null ? fmt0(r.trendedUltimate) : "-"}
                </td>
                <td className="num px-2 py-1 text-right text-[0.85rem] font-medium text-ink">
                  {r.lossRatioAtTarget !== null ? fmtPct(r.lossRatioAtTarget, 1) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-start gap-8">
        <div>
          <h3 className="mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Averages
          </h3>
          <table className="ledger min-w-[360px]">
            <tbody>
              {review.averages.map((a) => {
                const isSelected =
                  review.selected !== null &&
                  a.value !== null &&
                  Math.abs(review.selected - a.value) < 5e-4;
                return (
                  <tr key={a.key} className={isSelected ? "bg-gold-soft/60" : "hover:bg-steel-soft/40"}>
                    <td className="px-2 py-1 text-[0.8rem] text-ink-soft">{a.label}</td>
                    <td className="num px-2 py-1 text-right text-[0.85rem] font-medium text-ink">
                      {a.value !== null ? fmtPct(a.value, 1) : "-"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {a.value !== null && !isSelected ? (
                        <button
                          onClick={() => useAverage(a.value)}
                          className="rounded-sm border border-hairline px-2 py-0.5 text-[0.72rem] font-medium text-ink-soft hover:border-steel hover:text-steel"
                        >
                          use
                        </button>
                      ) : isSelected ? (
                        <span className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[#6b4f16]">
                          selected
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1.5 text-[0.74rem] text-ink-faint">
            Cape Cod mechanical ELR (cross-check):{" "}
            <span className="num font-medium text-steel">
              {review.capeCodElr.paid !== null ? fmtPct(review.capeCodElr.paid, 1) : "-"} paid
            </span>
            {" / "}
            <span className="num font-medium text-steel">
              {review.capeCodElr.incurred !== null
                ? fmtPct(review.capeCodElr.incurred, 1)
                : "-"}{" "}
              incurred
            </span>
          </p>
        </div>

        <div>
          <h3 className="mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Selected ELR % (at {review.targetYear} level)
          </h3>
          <input
            value={selectedDraft}
            placeholder="none"
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(e) => setSelectedDraft(e.target.value)}
            onBlur={commitSelected}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="num w-24 rounded-sm border border-hairline-strong bg-panel px-2 py-1 text-right text-[0.85rem] font-semibold text-ink outline-none focus:border-steel"
            aria-label="Selected expected loss ratio percent at target level"
          />
          <p className="mt-1 max-w-[24rem] text-[0.74rem] leading-snug text-ink-faint">
            The engine restates this to each origin year's own cost and rate level: on the next
            run it becomes BF's per-year a-priori (an explicit manual BF override still wins) and
            drives the Expected Claims method. Clear it to revert BF to its derived default.
          </p>
        </div>
      </div>
    </Section>
  );
}
