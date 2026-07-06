import { useState } from "react";
import { useStore } from "../state/store.js";
import { Button, EmptyState, Section, fmt0, fmtFactor, fmtPct } from "./ui.js";
import type { ChainLadderResult } from "@actng/core";

/**
 * Method results: cross-method summary cards, then per-origin detail for the
 * selected method, with Mack standard errors alongside the chain ladder.
 */
export default function ResultsPanel() {
  const analysis = useStore((s) => s.currentAnalysis);
  const analyses = useStore((s) => s.analyses);
  const openAnalysis = useStore((s) => s.openAnalysis);
  const [detail, setDetail] = useState<string>("cl-paid");

  if (!analysis) {
    return (
      <Section title="Results" kicker="ultimates, IBNR, unpaid">
        <EmptyState title="No analysis yet">
          Select development factors above, pick a tail, then press Run analysis.
        </EmptyState>
      </Section>
    );
  }

  const r = analysis.results;
  const detailOptions: { key: string; label: string; cl: ChainLadderResult | null }[] = [
    { key: "cl-paid", label: "Chain Ladder - paid", cl: r.chainLadder.paid },
    { key: "cl-incurred", label: "Chain Ladder - incurred", cl: r.chainLadder.incurred },
    {
      key: "bs-case",
      label: "B-S case adequacy - incurred",
      cl: r.berquistSherman.caseAdequacy?.chainLadder ?? null,
    },
    {
      key: "bs-settlement",
      label: "B-S settlement rate - paid",
      cl: r.berquistSherman.settlement?.chainLadder ?? null,
    },
  ];
  const activeDetail = detailOptions.find((d) => d.key === detail) ?? detailOptions[0]!;
  const bf = r.bornhuetterFerguson;
  const showBf = detail === "bf" && (bf.paid || bf.incurred);

  return (
    <Section
      title="Results"
      kicker={`run ${new Date(r.ranAt).toLocaleString()} - ${analysis.label}`}
      actions={
        analyses.length > 1 ? (
          <select
            value={analysis.id}
            onChange={(e) => void openAnalysis(e.target.value)}
            className="max-w-[260px] rounded-sm border border-hairline-strong bg-panel px-2 py-1 text-[0.78rem] text-ink-soft outline-none focus:border-steel"
          >
            {analyses.map((a) => (
              <option key={a.id} value={a.id}>
                {new Date(a.createdAt).toLocaleString()} - {a.label}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      {/* Cross-method summary */}
      <div className="overflow-x-auto">
        <table className="ledger w-full min-w-[560px]">
          <caption className="pb-2 text-left text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint">
            Cross-method summary (totals across origin periods)
          </caption>
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Method
              </th>
              <th className="px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Basis
              </th>
              <th className="px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Ultimate
              </th>
              <th className="px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                IBNR
              </th>
              <th className="px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Unpaid
              </th>
            </tr>
          </thead>
          <tbody>
            {r.summary.map((s, idx) => (
              <tr key={idx} className="hover:bg-steel-soft/40" title={s.note}>
                <td className="px-2 py-1.5 text-[0.85rem] text-ink">{s.method}</td>
                <td className="px-2 py-1.5 text-[0.8rem] capitalize text-ink-soft">{s.basis}</td>
                <td className="num px-2 py-1.5 text-right text-[0.85rem] font-medium text-ink">
                  {fmt0(s.ultimate)}
                </td>
                <td
                  className={`num px-2 py-1.5 text-right text-[0.85rem] font-medium ${s.ibnr < 0 ? "text-verdigris" : "text-oxblood"}`}
                >
                  {fmt0(s.ibnr)}
                </td>
                <td className="num px-2 py-1.5 text-right text-[0.85rem] text-ink">
                  {fmt0(s.unpaid)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mack standard errors */}
      {r.mack.paid ? (
        <p className="mt-3 border-l-2 border-steel pl-3 text-[0.8rem] leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">Mack (1993) reserve variability:</span> paid
          reserve <span className="num">{fmt0(r.mack.paid.totals.reserve)}</span> with standard
          error <span className="num">{fmt0(r.mack.paid.totals.standardError)}</span> (
          {fmtPct(r.mack.paid.totals.cv ?? null, 0)} of reserve)
          {r.mack.incurred ? (
            <>
              ; incurred reserve <span className="num">{fmt0(r.mack.incurred.totals.reserve)}</span>{" "}
              with standard error{" "}
              <span className="num">{fmt0(r.mack.incurred.totals.standardError)}</span> (
              {fmtPct(r.mack.incurred.totals.cv ?? null, 0)}).
            </>
          ) : (
            "."
          )}{" "}
          Mack runs on volume-weighted factors with no tail, so it will differ from the selected
          chain ladder when your selections depart from all-year volume-weighted.
        </p>
      ) : null}

      {/* Warnings from the run */}
      {r.warnings.length > 0 ? (
        <div className="mt-3 rounded-sm border border-gold bg-gold-soft/60 px-3 py-2">
          {r.warnings.map((w, i) => (
            <p key={i} className="text-[0.78rem] leading-relaxed text-[#6b4f16]">
              {w}
            </p>
          ))}
        </div>
      ) : null}

      {/* Per-origin detail */}
      <div className="mt-5 border-t border-hairline pt-4">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {detailOptions.map((d) => (
            <button
              key={d.key}
              disabled={!d.cl}
              onClick={() => setDetail(d.key)}
              className={`rounded-sm px-2.5 py-1 text-[0.78rem] font-medium transition-colors ${
                detail === d.key
                  ? "bg-ink text-paper"
                  : d.cl
                    ? "text-ink-soft hover:bg-steel-soft"
                    : "cursor-not-allowed text-ink-faint"
              }`}
            >
              {d.label}
            </button>
          ))}
          <button
            disabled={!bf.paid && !bf.incurred}
            onClick={() => setDetail("bf")}
            className={`rounded-sm px-2.5 py-1 text-[0.78rem] font-medium transition-colors ${
              detail === "bf"
                ? "bg-ink text-paper"
                : bf.paid || bf.incurred
                  ? "text-ink-soft hover:bg-steel-soft"
                  : "cursor-not-allowed text-ink-faint"
            }`}
            title={bf.skippedReason}
          >
            Bornhuetter-Ferguson
          </button>
        </div>

        {showBf ? (
          <BfDetail />
        ) : activeDetail.cl ? (
          <div className="overflow-x-auto">
            <table className="ledger w-full min-w-[560px]">
              <thead>
                <tr>
                  {["Origin", "Age", "Latest", "CDF", "% dev", "Ultimate", "Unpaid/IBNR"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={`px-2 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft ${i < 2 ? "text-left" : "text-right"}`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {activeDetail.cl.rows.map((row) => (
                  <tr key={row.origin} className="hover:bg-steel-soft/40">
                    <td className="px-2 py-1 text-[0.82rem] font-medium text-ink-soft">
                      {row.origin}
                    </td>
                    <td className="num px-2 py-1 text-left text-[0.8rem] text-ink-faint">
                      {row.latestAge}
                    </td>
                    <td className="num px-2 py-1 text-right text-[0.82rem] text-ink">
                      {fmt0(row.latestValue)}
                    </td>
                    <td className="num px-2 py-1 text-right text-[0.82rem] text-ink">
                      {fmtFactor(row.cdf)}
                    </td>
                    <td className="num px-2 py-1 text-right text-[0.82rem] text-ink-soft">
                      {fmtPct(row.percentDeveloped, 0)}
                    </td>
                    <td className="num px-2 py-1 text-right text-[0.82rem] font-medium text-ink">
                      {fmt0(row.ultimate)}
                    </td>
                    <td className="num px-2 py-1 text-right text-[0.82rem] font-medium text-oxblood">
                      {fmt0(row.unpaid)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-ink font-semibold">
                  <td className="px-2 py-1.5 text-[0.82rem] text-ink">Total</td>
                  <td />
                  <td className="num px-2 py-1.5 text-right text-[0.82rem] text-ink">
                    {fmt0(activeDetail.cl.totals.latest)}
                  </td>
                  <td />
                  <td />
                  <td className="num px-2 py-1.5 text-right text-[0.82rem] text-ink">
                    {fmt0(activeDetail.cl.totals.ultimate)}
                  </td>
                  <td className="num px-2 py-1.5 text-right text-[0.82rem] text-oxblood">
                    {fmt0(activeDetail.cl.totals.unpaid)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="This method was skipped">
            {r.berquistSherman.skippedReason ?? r.bornhuetterFerguson.skippedReason ?? ""}
          </EmptyState>
        )}
      </div>
    </Section>
  );
}

function BfDetail() {
  const analysis = useStore((s) => s.currentAnalysis);
  const workspace = useStore((s) => s.workspace);
  const patchWorkspace = useStore((s) => s.patchWorkspace);
  const runAnalysis = useStore((s) => s.runAnalysis);
  const [aprioriDraft, setAprioriDraft] = useState("");
  const [basis, setBasis] = useState<"paid" | "incurred">("incurred");

  if (!analysis) return null;
  const bf = analysis.results.bornhuetterFerguson[basis];
  const override = workspace?.state.bf.aprioriLossRatio ?? null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex overflow-hidden rounded-sm border border-hairline-strong">
          {(["paid", "incurred"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBasis(b)}
              className={`px-3 py-1 text-[0.78rem] font-medium capitalize ${
                basis === b ? "bg-ink text-paper" : "text-ink-soft hover:bg-steel-soft"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[0.8rem] text-ink-soft">
          <span>
            A-priori loss ratio:{" "}
            <span className="num font-semibold text-ink">
              {override !== null ? fmtPct(override) : "derived from mature CL ultimates"}
            </span>
          </span>
          <input
            value={aprioriDraft}
            onChange={(e) => setAprioriDraft(e.target.value)}
            placeholder="e.g. 0.65"
            className="num w-20 rounded-sm border border-hairline-strong bg-panel px-2 py-1 text-right text-[0.8rem] outline-none focus:border-steel"
          />
          <Button
            kind="secondary"
            onClick={async () => {
              const v = aprioriDraft.trim() === "" ? null : Number(aprioriDraft);
              if (v !== null && (!Number.isFinite(v) || v <= 0)) return;
              await patchWorkspace({ bf: { aprioriLossRatio: v } });
              await runAnalysis("BF a-priori update");
            }}
          >
            {aprioriDraft.trim() === "" ? "Reset to derived" : "Override + rerun"}
          </Button>
        </div>
      </div>

      {!bf ? (
        <EmptyState title="Bornhuetter-Ferguson unavailable on this basis">
          {analysis.results.bornhuetterFerguson.skippedReason ?? "Import exposure data first."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="ledger w-full min-w-[640px]">
            <thead>
              <tr>
                {[
                  "Origin",
                  "Premium",
                  "A-priori",
                  "Expected ult",
                  "CDF",
                  "Expected unreported",
                  "Latest",
                  "BF ultimate",
                ].map((h, i) => (
                  <th
                    key={h}
                    className={`px-2 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft ${i === 0 ? "text-left" : "text-right"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bf.rows.map((row) => (
                <tr key={row.origin} className="hover:bg-steel-soft/40">
                  <td className="px-2 py-1 text-[0.82rem] font-medium text-ink-soft">
                    {row.origin}
                  </td>
                  <td className="num px-2 py-1 text-right text-[0.82rem] text-ink">
                    {fmt0(row.earnedPremium)}
                  </td>
                  <td className="num px-2 py-1 text-right text-[0.82rem] text-ink-soft">
                    {fmtPct(row.aprioriLossRatio)}
                  </td>
                  <td className="num px-2 py-1 text-right text-[0.82rem] text-ink">
                    {fmt0(row.expectedUltimate)}
                  </td>
                  <td className="num px-2 py-1 text-right text-[0.82rem] text-ink">
                    {fmtFactor(row.cdf)}
                  </td>
                  <td className="num px-2 py-1 text-right text-[0.82rem] text-ink">
                    {fmt0(row.expectedUnreported)}
                  </td>
                  <td className="num px-2 py-1 text-right text-[0.82rem] text-ink">
                    {fmt0(row.latestValue)}
                  </td>
                  <td className="num px-2 py-1 text-right text-[0.82rem] font-medium text-ink">
                    {fmt0(row.ultimate)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-ink font-semibold">
                <td className="px-2 py-1.5 text-[0.82rem] text-ink">Total</td>
                <td colSpan={5} />
                <td className="num px-2 py-1.5 text-right text-[0.82rem] text-ink">
                  {fmt0(bf.totals.latest)}
                </td>
                <td className="num px-2 py-1.5 text-right text-[0.82rem] text-ink">
                  {fmt0(bf.totals.ultimate)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
