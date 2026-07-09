import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.js";
import { Section, fmt0, fmtPct } from "./ui.js";

/**
 * The development-layer exhibit: the evidence an actuary picks a reliable
 * per-occurrence cap from (claim-size distribution, pierce/excess shares per
 * candidate cap, capped-vs-unlimited factor stability), plus the cap
 * settings themselves. The layer toggle in the page header switches the
 * whole pipeline onto the capped triangles.
 */
export default function LayerPanel() {
  const workspace = useStore((s) => s.workspace);
  const patchWorkspace = useStore((s) => s.patchWorkspace);

  const layer = workspace?.state.layer ?? null;
  const review = workspace?.layerReview ?? null;
  const basis = workspace?.state.basis ?? "paid";

  const [capDraft, setCapDraft] = useState("");
  const [indexDraft, setIndexDraft] = useState("");
  const [baseYearDraft, setBaseYearDraft] = useState("");
  const editing = useRef(false);

  useEffect(() => {
    // Workspace refreshes (advisor actions, sibling commits) must not wipe
    // in-progress typing; drafts reseed only while no field is focused.
    if (!layer || editing.current) return;
    setCapDraft(layer.cap !== null ? fmt0(layer.cap) : "");
    setIndexDraft(layer.indexRate !== 0 ? (layer.indexRate * 100).toFixed(1) : "");
    setBaseYearDraft(layer.baseYear !== null ? String(layer.baseYear) : "");
  }, [layer]);

  if (!workspace || !layer || !review) return null;

  const commitCap = () => {
    editing.current = false;
    const raw = capDraft.trim().replace(/,/g, "");
    if (raw === "") {
      if (layer.cap !== null && layer.active === "unlimited") {
        void patchWorkspace({ layer: { cap: null } });
      } else {
        setCapDraft(layer.cap !== null ? fmt0(layer.cap) : "");
      }
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setCapDraft(layer.cap !== null ? fmt0(layer.cap) : "");
      return;
    }
    setCapDraft(fmt0(parsed));
    if (parsed !== layer.cap) void patchWorkspace({ layer: { cap: parsed } });
  };

  const commitIndex = () => {
    editing.current = false;
    const raw = indexDraft.trim().replace(/%/g, "");
    const parsed = raw === "" ? 0 : Number(raw) / 100;
    if (!Number.isFinite(parsed) || parsed <= -1) {
      setIndexDraft(layer.indexRate !== 0 ? (layer.indexRate * 100).toFixed(1) : "");
      return;
    }
    if (parsed !== layer.indexRate) void patchWorkspace({ layer: { indexRate: parsed } });
  };

  const commitBaseYear = () => {
    editing.current = false;
    const raw = baseYearDraft.trim();
    const parsed = raw === "" ? null : Number(raw);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2200)) {
      setBaseYearDraft(layer.baseYear !== null ? String(layer.baseYear) : "");
      return;
    }
    if (parsed !== layer.baseYear) void patchWorkspace({ layer: { baseYear: parsed } });
  };

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };

  const d = review.diagnostics;
  const pct = (p: number) => d.years[0]?.percentiles.findIndex((x) => x.p === p) ?? -1;
  const cappedSelectionsEmpty =
    layer.active === "capped" &&
    workspace.state.selections.capped[basis].every((v) => v === null);

  const inputClass =
    "num w-28 rounded-sm border border-hairline-strong bg-panel px-2 py-1 text-right text-[0.82rem] text-ink outline-none focus:border-steel";

  return (
    <Section
      title="Development layer"
      kicker="cap losses at a reliable per-occurrence limit - the pipeline develops the active layer"
    >
      {/* Settings */}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
          Per-occurrence cap
          <input
            value={capDraft}
            placeholder="e.g. 250,000"
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(e) => setCapDraft(e.target.value)}
            onBlur={commitCap}
            onKeyDown={blurOnEnter}
            className={inputClass}
            aria-label="Per-occurrence cap"
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
          Index %/yr
          <input
            value={indexDraft}
            placeholder="0 = flat"
            title="Annual rate the cap moves across accident years, so the layer stays constant in real terms. 0 keeps a flat cap."
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(e) => setIndexDraft(e.target.value)}
            onBlur={commitIndex}
            onKeyDown={blurOnEnter}
            className={`${inputClass} w-20`}
            aria-label="Cap index rate percent per year"
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
          Cap stated at year
          <input
            value={baseYearDraft}
            placeholder={String(d.baseYear)}
            title="The accident year the cap is stated at; other years' caps are indexed from here. Blank = latest year in the data."
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(e) => setBaseYearDraft(e.target.value)}
            onBlur={commitBaseYear}
            onKeyDown={blurOnEnter}
            className={`${inputClass} w-20`}
            aria-label="Cap base year"
          />
        </label>
        <p className="max-w-[26rem] pb-1 text-[0.75rem] leading-snug text-ink-faint">
          {layer.active === "capped" ? (
            <>
              The workspace is developing the <span className="font-semibold">capped</span>{" "}
              layer: every result is a LIMITED ultimate until increased-limits factors restore
              the excess layer (not built yet). Changing cap settings resets capped selections
              and re-fits capped tails.
            </>
          ) : (
            "Set a cap, then switch the layer toggle above to develop capped losses. The capped layer keeps its own selections and tails."
          )}
        </p>
      </div>

      {cappedSelectionsEmpty ? (
        <p className="mb-3 rounded-sm border border-gold bg-gold-soft px-3 py-1.5 text-[0.8rem] font-medium text-[#6b4f16]">
          The capped layer has no LDF selections on the {basis} basis yet - select factors below
          (unlimited selections deliberately do not carry over).
        </p>
      ) : null}

      {/* Claim-size distribution */}
      <h3 className="mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
        Claim sizes{" "}
        <span className="font-normal normal-case tracking-normal text-ink-faint">
          (reported incurred at each claim's latest evaluation on or before{" "}
          {workspace.state.asOfDate} - immature years develop INTO the cap, so their pierce and
          excess shares are floors)
        </span>
      </h3>
      <div className="overflow-x-auto">
        <table className="ledger w-full min-w-[760px]">
          <thead>
            <tr>
              {["Year", "Claims", "Reported incurred", "p90", "p95", "p99", "Largest"].map(
                (h, i) => (
                  <th
                    key={h}
                    className={`px-2 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft ${
                      i === 0 ? "text-left" : "text-right"
                    }`}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {d.years.map((y) => (
              <tr key={y.year} className="hover:bg-steel-soft/40">
                <td className="px-2 py-1 text-[0.82rem] font-medium text-ink-soft">{y.year}</td>
                <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                  {y.claimCount}
                </td>
                <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                  {fmt0(y.totalIncurred)}
                </td>
                {[0.9, 0.95, 0.99].map((p) => (
                  <td key={p} className="num px-2 py-1 text-right text-[0.8rem] text-ink-soft">
                    {pct(p) >= 0 ? fmt0(y.percentiles[pct(p)]!.value) : "-"}
                  </td>
                ))}
                <td className="num px-2 py-1 text-right text-[0.8rem] font-medium text-ink">
                  {fmt0(y.maxClaim)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Candidate caps */}
      <h3 className="mt-4 mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
        Candidate caps{" "}
        <span className="font-normal normal-case tracking-normal text-ink-faint">
          (stated at {d.baseYear} level
          {d.indexRate !== 0 ? `, indexed ${(d.indexRate * 100).toFixed(1)}%/yr` : ""})
        </span>
      </h3>
      <div className="overflow-x-auto">
        <table className="ledger w-full min-w-[560px]">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Cap
              </th>
              <th className="px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Claims pierced
              </th>
              <th className="px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                % of claims
              </th>
              <th
                className="cursor-help px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft"
                title="Dollars above the cap as a share of total reported incurred"
              >
                % of dollars excess
              </th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {d.candidates.map((c) => {
              const isCurrent = layer.cap === c.cap;
              return (
                <tr
                  key={c.cap}
                  className={isCurrent ? "bg-gold-soft/60" : "hover:bg-steel-soft/40"}
                >
                  <td className="num px-2 py-1 text-[0.82rem] font-medium text-ink">
                    {fmt0(c.cap)}
                    {isCurrent ? (
                      <span className="ml-2 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[#6b4f16]">
                        current
                      </span>
                    ) : null}
                  </td>
                  <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                    {c.totalPierceCount}
                  </td>
                  <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                    {fmtPct(c.totalPierceShare, 1)}
                  </td>
                  <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                    {fmtPct(c.totalExcessShare, 1)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {!isCurrent ? (
                      <button
                        onClick={() => void patchWorkspace({ layer: { cap: c.cap } })}
                        className="rounded-sm border border-hairline px-2 py-0.5 text-[0.72rem] font-medium text-ink-soft hover:border-steel hover:text-steel"
                      >
                        use
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Stability comparison */}
      {review.volatility.capped ? (
        <>
          <h3 className="mt-4 mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Factor stability - {basis} basis{" "}
            <span className="font-normal normal-case tracking-normal text-ink-faint">
              (CV of individual age-to-age factors per column; lower is stabler)
            </span>
          </h3>
          <div className="overflow-x-auto">
            <table className="ledger w-full min-w-[560px]">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                    Layer
                  </th>
                  {workspace.factors[basis].fromAges.map((a, j) => (
                    <th
                      key={j}
                      className="num px-2 py-1.5 text-right text-[0.7rem] font-semibold tracking-[0.05em] text-ink-soft"
                    >
                      {a}-{workspace.factors[basis].toAges[j]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["unlimited", "capped"] as const).map((lk) => {
                  const vols = review.volatility[lk]?.[basis] ?? [];
                  return (
                    <tr key={lk} className="hover:bg-steel-soft/40">
                      <td className="px-2 py-1 text-[0.8rem] font-medium capitalize text-ink-soft">
                        {lk}
                        {layer.active === lk ? (
                          <span className="ml-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-steel">
                            active
                          </span>
                        ) : null}
                      </td>
                      {vols.map((v, j) => {
                        const other = review.volatility[lk === "capped" ? "unlimited" : "capped"]?.[basis]?.[j];
                        const better =
                          lk === "capped" &&
                          v !== null &&
                          other !== null &&
                          other !== undefined &&
                          v < other - 1e-12;
                        return (
                          <td
                            key={j}
                            className={`num px-2 py-1 text-right text-[0.8rem] ${
                              better ? "font-medium text-verdigris" : "text-ink"
                            }`}
                          >
                            {v !== null ? v.toFixed(3) : "-"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">
        Capping every claim at the (indexed) per-occurrence limit removes large-loss volatility
        from the development data; green cells mark columns where the capped layer's factors are
        stabler. The capped layer carries its OWN selections and tails, and the analysis runs on
        whichever layer is active. Counts are never capped.
      </p>
    </Section>
  );
}
