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
  { key: "ccPaid", short: "CC Paid", full: "Cape Cod - paid" },
  { key: "ccIncurred", short: "CC Inc", full: "Cape Cod - incurred" },
  { key: "expectedClaims", short: "Exp Clms", full: "Expected Claims (a-priori)" },
];

/**
 * The selection-of-ultimates exhibit: every method's indicated ultimate side
 * by side per origin period, with that period's credibility weight editable
 * directly to the right of each ultimate (weights renormalize within the
 * period), and a manually overridable final selection. This is the exhibit a
 * reserve review actually signs.
 */
export default function SelectionPanel() {
  const workspace = useStore((s) => s.workspace);
  const analysis = useStore((s) => s.currentAnalysis);
  const patchWorkspace = useStore((s) => s.patchWorkspace);

  const selection = workspace?.ultimateSelection ?? null;
  /** Weight drafts keyed "<origin>:<method>". */
  const [weightDraft, setWeightDraft] = useState<Record<string, string>>({});
  const [overrideDraft, setOverrideDraft] = useState<Record<string, string>>({});
  const editing = useRef(false);

  useEffect(() => {
    if (editing.current || !selection) return;
    const drafts: Record<string, string> = {};
    for (const row of selection.rows) {
      for (const m of METHOD_COLUMNS) {
        drafts[`${row.origin}:${m.key}`] = String(row.weights[m.key] ?? 0);
      }
    }
    setWeightDraft(drafts);
    setOverrideDraft(
      Object.fromEntries(
        selection.rows.map((r) => [r.origin, r.override !== null ? fmt0(r.override) : ""]),
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

  // Level coherence (round-5 F1): the provenance banner below states the level
  // of the run this exhibit BLENDS. When the armed layer has since changed, that
  // level claim is about a superseded run - so "RESTORED TO 1M" must not stand
  // unqualified next to an unlimited toggle. Name the level change in the stale
  // note instead of leaving the two banners silently contradicting each other.
  const levelWord = (l: "unlimited" | "limited" | "restored") =>
    l === "restored" ? "restored (total-limits)" : l === "limited" ? "limited (capped)" : "unlimited";
  const runLevel: "unlimited" | "limited" | "restored" = selection.restored
    ? "restored"
    : selection.layer.active === "capped"
      ? "limited"
      : "unlimited";
  const armedLevel: "unlimited" | "limited" | "restored" =
    workspace?.state.layer.active === "capped"
      ? workspace?.ilfReview.resolved
        ? "restored"
        : "limited"
      : "unlimited";
  const levelChanged = stale && armedLevel !== runLevel;

  // Round-5 F2: this run could not drive Expected Claims / the ELR-derived BF
  // a-priori (ELR level mismatch), so those columns are deliberately blank -
  // state WHY on the matrix instead of leaving a silent "-".
  const elrSkip = analysis?.results.elrDerivedSkipReason ?? null;

  const committedFor = (origin: string, method: SelectionMethodKey): number => {
    const row = selection.rows.find((r) => r.origin === origin);
    return row?.weights[method] ?? 0;
  };

  const isDirty = (origin: string, method: SelectionMethodKey): boolean => {
    const draft = (weightDraft[`${origin}:${method}`] ?? "").trim();
    const committed = committedFor(origin, method);
    if (draft === "") return committed !== 0;
    const parsed = Number(draft);
    return Number.isFinite(parsed) ? parsed !== committed : true;
  };

  const anyDirty = selection.rows.some((r) =>
    METHOD_COLUMNS.some((m) => isDirty(r.origin, m.key)),
  );

  const commitWeight = (origin: string, method: SelectionMethodKey) => {
    editing.current = false;
    const key = `${origin}:${method}`;
    const raw = (weightDraft[key] ?? "").trim();
    const committed = committedFor(origin, method);
    const parsed = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setWeightDraft((d) => ({ ...d, [key]: String(committed) }));
      return;
    }
    if (parsed === committed) {
      setWeightDraft((d) => ({ ...d, [key]: String(parsed) }));
      return;
    }
    void patchWorkspace({
      ultimateSelection: { weightsByOrigin: { [origin]: { [method]: parsed } } },
    });
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
      setOverrideDraft((d) => ({ ...d, [origin]: current !== null ? fmt0(current) : "" }));
      return;
    }
    // Re-render the committed figure comma-grouped like every other cell.
    setOverrideDraft((d) => ({ ...d, [origin]: fmt0(parsed) }));
    if (current !== null && Math.abs(parsed - current) < 0.5) return;
    void patchWorkspace({ ultimateSelection: { overrides: { [origin]: parsed } } });
  };

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };

  const allWeightsZero = selection.rows.every((r) =>
    METHOD_COLUMNS.every((m) => (r.weights[m.key] ?? 0) === 0),
  );
  const anyOverride = selection.rows.some((r) => r.override !== null);

  // The tool's own diagnostics vs the weighting: warn when across every
  // period the weight sits solely on unadjusted methods flagged as distorted.
  const findings = workspace?.diagnostics.findings ?? [];
  const settlementFlagged = findings.some((f) => f.code === "SETTLEMENT_RATE_SHIFT");
  const caseFlagged = findings.some((f) => f.code === "CASE_ADEQUACY_SHIFT");
  const totalWeight = (key: SelectionMethodKey) =>
    selection.rows.reduce((a, r) => a + (r.weights[key] ?? 0), 0);
  const adjustedWeight =
    totalWeight("bsCase") + totalWeight("bsSettlement") + totalWeight("bfPaid") + totalWeight("bfIncurred");
  const distortedCarryWeight =
    (settlementFlagged && totalWeight("clPaid") > 0) ||
    (caseFlagged && totalWeight("clIncurred") > 0);
  const diagnosticsTension = distortedCarryWeight && adjustedWeight === 0;

  return (
    <Section
      title="Selection of ultimates"
      kicker={`blends the run "${selection.analysisLabel}" - each cell: indicated ultimate with its period weight beside it - overrides win`}
    >
      {selection.restored ? (
        <p className="mb-3 rounded-sm border border-verdigris bg-verdigris-soft px-3 py-1.5 text-[0.8rem] font-medium text-verdigris">
          RESTORED TO {selection.restored.targetLimit === null
            ? "UNLIMITED"
            : `A ${fmt0(selection.restored.targetLimit)} LIMIT`}: capped ultimates x{" "}
          <span className="num">{selection.restored.factor.toFixed(4)}</span> via{" "}
          {selection.restored.sourceLabel}; IBNR and unpaid are against UNLIMITED diagonals.
          One expected factor restores EVERY year - this assumes each year's excess share
          equals the book average; years with realized large-loss excess violate it (flagged
          below when the restored blend falls short of reported incurred).
        </p>
      ) : selection.layer.active === "capped" ? (
        <p className="mb-3 rounded-sm border border-steel bg-steel-soft px-3 py-1.5 text-[0.8rem] font-medium text-steel">
          LIMITED LAYER: every method ultimate below is capped at{" "}
          <span className="num">{fmt0(selection.layer.cap ?? 0)}</span>
          {selection.layer.indexRate !== 0
            ? ` (indexed ${(selection.layer.indexRate * 100).toFixed(1)}%/yr)`
            : ""}{" "}
          per occurrence - the excess layer is NOT in these selections, IBNR, or unpaid figures.
          Configure an ILF source in the Increased limits exhibit to restore total limits.
        </p>
      ) : null}
      {stale ? (
        <p className="mb-3 rounded-sm border border-gold bg-gold-soft px-3 py-1.5 text-[0.8rem] font-medium text-[#6b4f16]">
          {levelChanged
            ? `You switched to the ${levelWord(armedLevel)} layer since this run - the method ultimates below are STILL at the ${levelWord(runLevel)} level (the banner above describes that superseded run). Rerun to move them onto the ${levelWord(armedLevel)} basis.`
            : "Inputs have changed since the run this exhibit blends; rerun the analysis to refresh the method ultimates below."}
        </p>
      ) : null}
      {elrSkip ? (
        <p className="mb-3 rounded-sm border border-steel bg-steel-soft px-3 py-1.5 text-[0.8rem] font-medium text-steel">
          Exp Clms is blank (and BF carries its derived a-priori, not the selected ELR): {elrSkip}
        </p>
      ) : null}
      {selection.rows.some((r) => r.restorationShortfall) ? (
        <p className="mb-3 rounded-sm border border-oxblood/50 bg-oxblood-soft px-3 py-1.5 text-[0.8rem] font-medium text-oxblood">
          Restoration shortfall in{" "}
          {selection.rows
            .filter((r) => r.restorationShortfall)
            .map((r) => r.origin)
            .join(", ")}
          : the restored blend sits BELOW that year's unlimited reported incurred - realized
          large-loss excess exceeds the book-average restoration. Handle these years with a
          manual override (reported incurred plus a development provision) or an aggregate
          excess treatment; their negative IBNR is an artifact, not favorable development.
        </p>
      ) : null}
      {allWeightsZero && !anyOverride ? (
        <p className="mb-3 rounded-sm border border-oxblood/50 bg-oxblood-soft px-3 py-1.5 text-[0.8rem] font-medium text-oxblood">
          All method weights are zero in every period, so there is no weighted blend and no
          selection. Set weights, or type Selected values directly.
        </p>
      ) : null}
      {diagnosticsTension ? (
        <p className="mb-3 rounded-sm border border-gold bg-gold-soft px-3 py-1.5 text-[0.8rem] text-[#6b4f16]">
          Heads up: the diagnostics below flag distortions in the unadjusted chain ladder methods
          that currently carry all of the weight. Consider weighting the Berquist-Sherman
          (or BF) columns, or ask the advisor to set diagnostics-aware weights.
        </p>
      ) : null}
      {anyDirty ? (
        <p className="mb-3 rounded-sm border border-gold bg-gold-soft px-3 py-1 text-[0.78rem] font-medium text-[#6b4f16]">
          Pending weight edit - press Enter or click away to apply.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        {/* Origin and the four outcome columns are frozen so the bottom line
            never scrolls out of view; only the method matrix pans. Sticky
            cells need opaque backgrounds, fixed widths (table-fixed) so the
            right offsets stay exact, and border-separate because collapsed
            and tr-level borders do not travel with sticky cells. */}
        <table className="ledger w-full min-w-[1792px] table-fixed border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] w-14 border-r border-hairline bg-panel px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Origin
              </th>
              {METHOD_COLUMNS.map((m) => (
                <th
                  key={m.key}
                  title={`${m.full} - indicated ultimate, with this period's credibility weight in the small box beside it`}
                  className="cursor-help px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft"
                >
                  {m.short}
                  <span className="ml-1 font-normal normal-case tracking-normal text-ink-faint">
                    / wt
                  </span>
                </th>
              ))}
              <th className="sticky right-[328px] z-[1] w-[112px] border-l border-hairline bg-panel px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-steel">
                Weighted
              </th>
              <th
                className="sticky right-[208px] z-[1] w-[120px] cursor-help bg-panel px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink"
                title="Type a value to override the weighted ultimate for that period; clear it to return to the weighted value"
              >
                Selected
              </th>
              <th className="sticky right-[104px] z-[1] w-[104px] bg-panel px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                IBNR
              </th>
              <th className="sticky right-0 z-[1] w-[104px] bg-panel px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Unpaid
              </th>
            </tr>
          </thead>
          <tbody>
            {selection.rows.map((row) => (
              <tr key={row.origin} className="group hover:bg-steel-soft/40">
                <td className="sticky left-0 z-[1] border-r border-hairline bg-panel px-2 py-1 text-[0.82rem] font-medium text-ink-soft group-hover:bg-[#f6f7f7]">
                  {row.origin}
                  {row.restorationShortfall ? (
                    <span
                      className="ml-1 cursor-help font-semibold text-oxblood"
                      title="Restored blend below this year's unlimited reported incurred - the uniform factor understates realized excess here"
                    >
                      !
                    </span>
                  ) : null}
                </td>
                {METHOD_COLUMNS.map((m) => {
                  const weight = row.weights[m.key] ?? 0;
                  const value = row.ultimates[m.key];
                  const key = `${row.origin}:${m.key}`;
                  return (
                    <td key={m.key} className="px-1 py-0.5">
                      <div className="flex items-center justify-end gap-1">
                        <span
                          className={`num text-right text-[0.8rem] ${
                            value === null
                              ? "text-ink-faint"
                              : weight > 0
                                ? "font-medium text-ink"
                                : "text-ink-faint"
                          }`}
                        >
                          {value !== null ? fmt0(value) : "-"}
                        </span>
                        <input
                          value={weightDraft[key] ?? ""}
                          aria-label={`Weight for ${m.full} in ${row.origin}`}
                          onFocus={() => {
                            editing.current = true;
                          }}
                          onChange={(e) =>
                            setWeightDraft((d) => ({ ...d, [key]: e.target.value }))
                          }
                          onBlur={() => commitWeight(row.origin, m.key)}
                          onKeyDown={blurOnEnter}
                          title="Credibility weight - type a number, Enter or click away to apply"
                          className={`num w-9 shrink-0 cursor-text rounded-sm border px-1 py-0.5 text-right text-[0.72rem] outline-none focus:border-steel ${
                            isDirty(row.origin, m.key)
                              ? "border-gold bg-gold-soft text-ink"
                              : weight > 0
                                ? "border-hairline bg-panel text-steel"
                                : "border-transparent bg-transparent text-ink-faint hover:border-hairline-strong focus:bg-panel"
                          }`}
                        />
                      </div>
                    </td>
                  );
                })}
                <td className="num sticky right-[328px] z-[1] border-l border-hairline bg-panel px-2 py-1 text-right text-[0.8rem] font-medium text-steel group-hover:bg-[#f6f7f7]">
                  {row.weighted !== null ? fmt0(row.weighted) : "-"}
                </td>
                <td className="sticky right-[208px] z-[1] bg-panel px-1 py-0.5 group-hover:bg-[#f6f7f7]">
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
                  title={
                    row.restorationShortfall
                      ? "Negative IBNR here is a restoration artifact (uniform factor vs realized excess), not favorable development"
                      : undefined
                  }
                  className={`num sticky right-[104px] z-[1] bg-panel px-2 py-1 text-right text-[0.8rem] font-medium group-hover:bg-[#f6f7f7] ${
                    row.restorationShortfall
                      ? "text-oxblood"
                      : (row.ibnr ?? 0) < 0
                        ? "text-verdigris"
                        : "text-oxblood"
                  }`}
                >
                  {row.ibnr !== null ? fmt0(row.ibnr) : "-"}
                </td>
                <td className="num sticky right-0 z-[1] bg-panel px-2 py-1 text-right text-[0.8rem] text-ink group-hover:bg-[#f6f7f7]">
                  {row.unpaid !== null ? fmt0(row.unpaid) : "-"}
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="sticky left-0 z-[1] border-r border-t-2 border-hairline border-t-ink bg-panel px-2 py-1.5 text-[0.82rem] text-ink">
                Total
              </td>
              {METHOD_COLUMNS.map((m) => {
                const total = selection.rows.reduce(
                  (acc, r) => (r.ultimates[m.key] !== null ? acc + r.ultimates[m.key]! : acc),
                  0,
                );
                const any = selection.rows.some((r) => r.ultimates[m.key] !== null);
                return (
                  <td key={m.key} className="border-t-2 border-ink px-1 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      <span className="num text-right text-[0.8rem] text-ink-soft">
                        {any ? fmt0(total) : "-"}
                      </span>
                      <span className="w-9 shrink-0" />
                    </div>
                  </td>
                );
              })}
              <td className="num sticky right-[328px] z-[1] border-l border-t-2 border-hairline border-t-ink bg-panel px-2 py-1.5 text-right text-[0.8rem] text-steel">
                {selection.totals.weighted !== null ? fmt0(selection.totals.weighted) : "-"}
              </td>
              <td className="num sticky right-[208px] z-[1] border-t-2 border-ink bg-panel px-2 py-1.5 pr-3 text-right text-[0.85rem] text-ink">
                {selection.totals.selected !== null ? fmt0(selection.totals.selected) : "-"}
              </td>
              <td className="num sticky right-[104px] z-[1] border-t-2 border-ink bg-panel px-2 py-1.5 text-right text-[0.85rem] text-oxblood">
                {selection.totals.ibnr !== null ? fmt0(selection.totals.ibnr) : "-"}
              </td>
              <td className="num sticky right-0 z-[1] border-t-2 border-ink bg-panel px-2 py-1.5 text-right text-[0.85rem] text-ink">
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
        Each method cell shows the indicated ultimate with that period&apos;s credibility weight
        in the small box beside it. Weighted = sum of weight x method ultimate over the methods
        with a value for that period, divided by the sum of those weights (weights renormalize
        within the period). A typed Selected value overrides the weighted blend for that period
        only. IBNR = selected minus reported incurred; Unpaid = selected minus paid, both on the
        latest diagonal. Overrides are dollar judgments at the exhibit's CURRENT level (limited
        or restored); changing the layer, cap, or restoration settings clears them.
      </p>
    </Section>
  );
}
