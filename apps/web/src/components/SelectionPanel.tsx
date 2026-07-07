import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.js";
import { EmptyState, Section, fmt0 } from "./ui.js";
import { resultsAreStale } from "../lib/staleness.js";
import type { SelectionMethodKey } from "../api/types.js";

const METHOD_COLUMNS: { key: SelectionMethodKey; short: string; full: string }[] = [
  { key: "clPaid", short: "CL Paid", full: "Chain Ladder - paid" },
  { key: "clIncurred", short: "CL Inc", full: "Chain Ladder - incurred" },
  { key: "bfPaid", short: "BF Paid", full: "Bornhuetter-Ferguson - paid" },
  { key: "bfIncurred", short: "BF Inc", full: "Bornhuetter-Ferguson - incurred" },
  { key: "bsCase", short: "B-S Case", full: "Berquist-Sherman case adequacy - incurred" },
  { key: "bsSettlement", short: "B-S Settle", full: "Berquist-Sherman settlement rate - paid" },
];

/**
 * The selection-of-ultimates exhibit: every method's indicated ultimate side
 * by side per origin period, a credibility-weight row that drives the blended
 * column, and a manually overridable final selection. This is the exhibit a
 * reserve review actually signs.
 */
export default function SelectionPanel() {
  const workspace = useStore((s) => s.workspace);
  const analysis = useStore((s) => s.currentAnalysis);
  const patchWorkspace = useStore((s) => s.patchWorkspace);

  const selection = workspace?.ultimateSelection ?? null;
  const [weightDraft, setWeightDraft] = useState<Record<string, string>>({});
  const [overrideDraft, setOverrideDraft] = useState<Record<string, string>>({});
  const editing = useRef(false);

  useEffect(() => {
    if (editing.current || !selection) return;
    setWeightDraft(
      Object.fromEntries(selection.methods.map((m) => [m.key, String(m.weight)])),
    );
    setOverrideDraft(
      Object.fromEntries(
        selection.rows.map((r) => [
          r.origin,
          r.override !== null ? String(Math.round(r.override)) : "",
        ]),
      ),
    );
  }, [selection]);

  if (!selection) {
    return (
      <Section title="Selection of ultimates" kicker="weighted method blend and final selection">
        <EmptyState title="Run an analysis first">
          The selection exhibit blends the ultimates from the latest analysis run.
        </EmptyState>
      </Section>
    );
  }

  const stale = analysis ? resultsAreStale(analysis.inputs, workspace?.state) : false;

  /** Weight inputs whose draft differs from the committed weight (pending). */
  const dirtyWeights = METHOD_COLUMNS.filter((m) => {
    const committed = selection.methods.find((x) => x.key === m.key)?.weight ?? 0;
    const draft = (weightDraft[m.key] ?? "").trim();
    if (draft === "") return committed !== 0;
    const parsed = Number(draft);
    return Number.isFinite(parsed) ? parsed !== committed : true;
  }).map((m) => m.key);

  const allWeightsZero = selection.methods.every((m) => m.weight === 0);
  const anyOverride = selection.rows.some((r) => r.override !== null);

  // The tool's own diagnostics vs the current weighting: warn when all the
  // weight sits on unadjusted methods the diagnostics flag as distorted.
  const findings = workspace?.diagnostics.findings ?? [];
  const settlementFlagged = findings.some((f) => f.code === "SETTLEMENT_RATE_SHIFT");
  const caseFlagged = findings.some((f) => f.code === "CASE_ADEQUACY_SHIFT");
  const weightOf = (key: SelectionMethodKey) =>
    selection.methods.find((m) => m.key === key)?.weight ?? 0;
  const adjustedWeight = weightOf("bsCase") + weightOf("bsSettlement") + weightOf("bfPaid") + weightOf("bfIncurred");
  const distortedCarryWeight =
    (settlementFlagged && weightOf("clPaid") > 0) || (caseFlagged && weightOf("clIncurred") > 0);
  const diagnosticsTension = distortedCarryWeight && adjustedWeight === 0;

  const commitWeight = (key: SelectionMethodKey) => {
    editing.current = false;
    const raw = (weightDraft[key] ?? "").trim();
    const current = selection.methods.find((m) => m.key === key)?.weight ?? 0;
    const parsed = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setWeightDraft((d) => ({ ...d, [key]: String(current) }));
      return;
    }
    if (parsed === current) {
      setWeightDraft((d) => ({ ...d, [key]: String(parsed) }));
      return;
    }
    void patchWorkspace({ ultimateSelection: { weights: { [key]: parsed } } });
  };

  const commitOverride = (origin: string) => {
    editing.current = false;
    const raw = (overrideDraft[origin] ?? "").trim();
    const row = selection.rows.find((r) => r.origin === origin);
    const current = row?.override ?? null;
    if (raw === "") {
      if (current !== null) {
        void patchWorkspace({ ultimateSelection: { overrides: { [origin]: null } } });
      }
      return;
    }
    const parsed = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setOverrideDraft((d) => ({
        ...d,
        [origin]: current !== null ? String(Math.round(current)) : "",
      }));
      return;
    }
    if (current !== null && Math.abs(parsed - current) < 0.5) return;
    void patchWorkspace({ ultimateSelection: { overrides: { [origin]: parsed } } });
  };

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };

  return (
    <Section
      title="Selection of ultimates"
      kicker={`blends the run "${selection.analysisLabel}" - weights renormalize per period over available methods - overrides win`}
    >
      {stale ? (
        <p className="mb-3 rounded-sm border border-gold bg-gold-soft px-3 py-1.5 text-[0.8rem] font-medium text-[#6b4f16]">
          Inputs have changed since the run this exhibit blends; rerun the analysis to refresh the
          method ultimates below.
        </p>
      ) : null}
      {allWeightsZero && !anyOverride ? (
        <p className="mb-3 rounded-sm border border-oxblood/50 bg-oxblood-soft px-3 py-1.5 text-[0.8rem] font-medium text-oxblood">
          All method weights are zero, so there is no weighted blend and no selection. Set at
          least one weight, or type Selected values directly.
        </p>
      ) : null}
      {diagnosticsTension ? (
        <p className="mb-3 rounded-sm border border-gold bg-gold-soft px-3 py-1.5 text-[0.8rem] text-[#6b4f16]">
          Heads up: the diagnostics below flag distortions in the unadjusted chain ladder methods
          that currently carry all of the weight. Consider weighting the Berquist-Sherman
          (or BF) columns, or ask the advisor to set diagnostics-aware weights.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="ledger w-full min-w-[1080px]">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Origin
              </th>
              {METHOD_COLUMNS.map((m) => (
                <th
                  key={m.key}
                  title={m.full}
                  className="cursor-help px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft"
                >
                  {m.short}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-steel">
                Weighted
              </th>
              <th
                className="cursor-help px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink"
                title="Type a value to override the weighted ultimate for that period; clear it to return to the weighted value"
              >
                Selected
              </th>
              <th className="px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                IBNR
              </th>
              <th className="px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Unpaid
              </th>
            </tr>
            {/* Credibility weights row */}
            <tr className="bg-steel-soft/50">
              <th className="px-2 py-1 text-left text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-steel">
                Weights
              </th>
              {METHOD_COLUMNS.map((m) => (
                <th key={m.key} className="px-1 py-1">
                  <input
                    value={weightDraft[m.key] ?? ""}
                    aria-label={`Weight for ${m.full}`}
                    onFocus={() => {
                      editing.current = true;
                    }}
                    onChange={(e) =>
                      setWeightDraft((d) => ({ ...d, [m.key]: e.target.value }))
                    }
                    onBlur={() => commitWeight(m.key)}
                    onKeyDown={blurOnEnter}
                    className={`num w-full rounded-sm border bg-panel px-1.5 py-0.5 text-right text-[0.78rem] font-medium text-steel outline-none focus:border-steel ${
                      dirtyWeights.includes(m.key)
                        ? "border-gold bg-gold-soft"
                        : "border-hairline-strong"
                    }`}
                  />
                </th>
              ))}
              <th colSpan={4} className="px-2 py-1 text-left text-[0.7rem] font-normal normal-case tracking-normal text-ink-faint">
                {dirtyWeights.length > 0 ? (
                  <span className="font-medium text-[#6b4f16]">
                    pending edit - press Enter or click away to apply
                  </span>
                ) : (
                  "non-negative credibility; renormalized per period"
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {selection.rows.map((row) => (
              <tr key={row.origin} className="hover:bg-steel-soft/40">
                <td className="px-2 py-1 text-[0.82rem] font-medium text-ink-soft">
                  {row.origin}
                </td>
                {METHOD_COLUMNS.map((m) => (
                  <td key={m.key} className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                    {row.ultimates[m.key] !== null ? fmt0(row.ultimates[m.key]) : "-"}
                  </td>
                ))}
                <td className="num px-2 py-1 text-right text-[0.8rem] font-medium text-steel">
                  {row.weighted !== null ? fmt0(row.weighted) : "-"}
                </td>
                <td className="px-1 py-0.5">
                  <input
                    value={overrideDraft[row.origin] ?? ""}
                    placeholder={row.weighted !== null ? fmt0(row.weighted) : "-"}
                    aria-label={`Selected ultimate override for ${row.origin}`}
                    onFocus={() => {
                      editing.current = true;
                    }}
                    onChange={(e) =>
                      setOverrideDraft((d) => ({ ...d, [row.origin]: e.target.value }))
                    }
                    onBlur={() => commitOverride(row.origin)}
                    onKeyDown={blurOnEnter}
                    title={
                      row.override !== null
                        ? "Manual override (clear to return to the weighted value)"
                        : "Weighted value applies; type to override"
                    }
                    className={`num w-28 rounded-sm border px-1.5 py-0.5 text-right text-[0.82rem] font-semibold outline-none focus:border-steel ${
                      row.override !== null
                        ? "border-gold bg-gold-soft text-ink"
                        : "border-transparent bg-transparent text-ink hover:border-hairline-strong"
                    }`}
                  />
                </td>
                <td
                  className={`num px-2 py-1 text-right text-[0.8rem] font-medium ${
                    (row.ibnr ?? 0) < 0 ? "text-verdigris" : "text-oxblood"
                  }`}
                >
                  {row.ibnr !== null ? fmt0(row.ibnr) : "-"}
                </td>
                <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                  {row.unpaid !== null ? fmt0(row.unpaid) : "-"}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-ink font-semibold">
              <td className="px-2 py-1.5 text-[0.82rem] text-ink">Total</td>
              {METHOD_COLUMNS.map((m) => {
                const total = selection.rows.reduce(
                  (acc, r) => (r.ultimates[m.key] !== null ? acc + r.ultimates[m.key]! : acc),
                  0,
                );
                const any = selection.rows.some((r) => r.ultimates[m.key] !== null);
                return (
                  <td key={m.key} className="num px-2 py-1.5 text-right text-[0.8rem] text-ink-soft">
                    {any ? fmt0(total) : "-"}
                  </td>
                );
              })}
              <td className="num px-2 py-1.5 text-right text-[0.8rem] text-steel">
                {selection.totals.weighted !== null ? fmt0(selection.totals.weighted) : "-"}
              </td>
              <td className="num px-2 py-1.5 pr-3 text-right text-[0.85rem] text-ink">
                {selection.totals.selected !== null ? fmt0(selection.totals.selected) : "-"}
              </td>
              <td className="num px-2 py-1.5 text-right text-[0.85rem] text-oxblood">
                {selection.totals.ibnr !== null ? fmt0(selection.totals.ibnr) : "-"}
              </td>
              <td className="num px-2 py-1.5 text-right text-[0.85rem] text-ink">
                {selection.totals.unpaid !== null ? fmt0(selection.totals.unpaid) : "-"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {selection.totals.unselectedOrigins.length > 0 ? (
        <p className="mt-2 text-[0.78rem] text-oxblood">
          No selection for {selection.totals.unselectedOrigins.join(", ")}: every weighted method
          is unavailable there and no override is set. These periods are excluded from the totals.
        </p>
      ) : null}
      <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">
        Weighted = sum of weight x method ultimate over the methods with a value for that period,
        divided by the sum of those weights. A typed Selected value overrides the weighted blend
        for that period only. IBNR = selected minus reported incurred; Unpaid = selected minus
        paid, both on the latest diagonal.
      </p>
    </Section>
  );
}
