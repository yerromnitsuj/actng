import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.js";
import { EmptyState, Section, fmt0, fmtPct } from "./ui.js";

/**
 * The a-priori compilation. Two methods share this exhibit:
 * - LOSS RATIO: per-year trended SELECTED ultimates over ON-LEVEL trended
 *   premium; the a-priori is a loss ratio.
 * - PURE PREMIUM: the same ultimates over EXPOSURE UNITS (no premium
 *   on-leveling - units are not rate-sensitive); the a-priori is a pure premium
 *   (loss cost per unit). Either feeds BF and the Expected Claims method.
 */
export default function ElrPanel() {
  const workspace = useStore((s) => s.workspace);
  const patchWorkspace = useStore((s) => s.patchWorkspace);

  const review = workspace?.elrReview ?? null;
  const method = workspace?.state.elr.method ?? "loss-ratio";
  const isPP = method === "pure-premium";
  const [selectedDraft, setSelectedDraft] = useState("");
  const editing = useRef(false);

  // Loss ratio is stored/edited as a percent; pure premium as a dollar amount.
  const seedSelected = (v: number | null): string =>
    v === null ? "" : isPP ? String(v) : (v * 100).toFixed(1);

  useEffect(() => {
    if (!review || editing.current) return;
    setSelectedDraft(seedSelected(review.selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review, isPP]);

  const fmtA = (v: number | null): string =>
    v === null ? "-" : isPP ? `$${fmt0(v)}` : fmtPct(v, 1);

  const setMethod = (m: "loss-ratio" | "pure-premium") => {
    if (m === method) return;
    void patchWorkspace({ elr: { method: m } });
  };

  const MethodToggle = (
    <div className="flex overflow-hidden rounded-sm border border-hairline-strong">
      {(
        [
          ["loss-ratio", "Loss ratio"],
          ["pure-premium", "Pure premium"],
        ] as const
      ).map(([m, label]) => (
        <button
          key={m}
          aria-pressed={method === m}
          onClick={() => setMethod(m)}
          title={
            m === "loss-ratio"
              ? "A-priori = trended losses / on-level earned premium (a loss ratio)"
              : "A-priori = trended losses / exposure units (a pure premium; no premium on-leveling)"
          }
          className={`px-2.5 py-1 text-[0.72rem] font-medium transition-colors ${
            method === m ? "bg-steel text-paper" : "bg-transparent text-ink-soft hover:bg-steel-soft"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (!review) {
    return (
      <Section
        title={isPP ? "Pure premium" : "Expected loss ratio"}
        kicker={isPP ? "trended selected ultimates per exposure unit" : "trended on-level loss ratios and the a-priori"}
        actions={MethodToggle}
      >
        <EmptyState title={`Run an analysis with ${isPP ? "exposure units" : "premium"} data first`}>
          {isPP
            ? "The pure-premium exhibit compiles trended selected ultimates over exposure units from the latest run. Import exposure_units in the Data panel."
            : "The ELR exhibit compiles trended selected ultimates over on-level premium from the latest run."}
        </EmptyState>
      </Section>
    );
  }

  const commitSelected = () => {
    editing.current = false;
    const seeded = seedSelected(review.selected);
    if (selectedDraft.trim() === seeded) return;
    const raw = selectedDraft.trim().replace(/[%,$]/g, "");
    const parsed = raw === "" ? null : isPP ? Number(raw) : Number(raw) / 100;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setSelectedDraft(seeded);
      return;
    }
    void patchWorkspace({ elr: { selected: parsed } });
  };

  const useAverage = (value: number | null) => {
    if (value === null) return;
    // Loss ratio stores 4-dp; pure premium stores the dollar value as-is.
    void patchWorkspace({ elr: { selected: isPP ? Math.round(value * 100) / 100 : Math.round(value * 10000) / 10000 } });
  };

  const levelLabel =
    review.level === "restored"
      ? "RESTORED total-limits"
      : review.level === "limited"
        ? "LIMITED (capped)"
        : "unlimited";

  const baseHeader = isPP ? "Exposure units" : "Earned premium";
  const adjBaseHeader = isPP ? "Units" : "On-level trended";
  const ratioHeader = isPP ? "Pure premium" : "Loss ratio";

  return (
    <Section
      title={isPP ? "Pure premium" : "Expected loss ratio"}
      kicker={`trended SELECTED ultimates (${levelLabel}) / ${
        isPP ? "exposure units" : "on-level trended premium"
      }, at ${review.targetYear} level`}
      actions={MethodToggle}
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
                baseHeader,
                ...(isPP ? [] : ["OLF"]),
                adjBaseHeader,
                "Selected ultimate",
                `Trended @${review.targetYear}`,
                ratioHeader,
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
                {isPP ? null : (
                  <td className="num px-2 py-1 text-right text-[0.8rem] text-ink-soft">
                    {r.onLevelFactor.toFixed(3)}
                  </td>
                )}
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
                  {fmtA(r.lossRatioAtTarget)}
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
                  Math.abs(review.selected - a.value) < (isPP ? 0.5 : 5e-4);
                return (
                  <tr key={a.key} className={isSelected ? "bg-gold-soft/60" : "hover:bg-steel-soft/40"}>
                    <td className="px-2 py-1 text-[0.8rem] text-ink-soft">{a.label}</td>
                    <td className="num px-2 py-1 text-right text-[0.85rem] font-medium text-ink">
                      {fmtA(a.value)}
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
            Cape Cod mechanical {isPP ? "pure premium" : "ELR"} (cross-check):{" "}
            <span className="num font-medium text-steel">
              {fmtA(review.capeCodElr.paid)} paid
            </span>
            {" / "}
            <span className="num font-medium text-steel">{fmtA(review.capeCodElr.incurred)} incurred</span>
          </p>
        </div>

        <div>
          <h3 className="mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            {isPP ? "Selected pure premium" : "Selected ELR %"} (at {review.targetYear} level)
          </h3>
          <div className="flex items-center gap-1">
            {isPP ? <span className="text-[0.85rem] text-ink-soft">$</span> : null}
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
              aria-label={`Selected ${isPP ? "pure premium" : "expected loss ratio percent"} at target level`}
            />
          </div>
          <p className="mt-1 max-w-[24rem] text-[0.74rem] leading-snug text-ink-faint">
            The engine restates this to each origin year&apos;s own cost{isPP ? "" : " and rate"} level: on
            the next run it becomes BF&apos;s per-year a-priori (an explicit manual BF override still wins)
            and drives the Expected Claims method. Clear it to revert BF to its derived default.
          </p>
        </div>
      </div>
    </Section>
  );
}
