import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.js";
import { Section, fmt0 } from "./ui.js";
import { api } from "../api/client.js";
import type { SeverityFit } from "../api/types.js";

/**
 * The increased-limits exhibit: severity-distribution fits (censored MLE on
 * the book's own claims), imported ILF tables, illustrative curves, and the
 * resolved uncap factor that restores developed capped ultimates to total
 * limits. Only meaningful once a cap exists; the factor applies on the next
 * analysis run.
 */
export default function IlfPanel() {
  const workspace = useStore((s) => s.workspace);
  const patchWorkspace = useStore((s) => s.patchWorkspace);
  const openProject = useStore((s) => s.openProject);
  const projectId = useStore((s) => s.workspaceProjectId);

  const [targetDraft, setTargetDraft] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const editing = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const review = workspace?.ilfReview ?? null;
  const config = review?.config ?? null;

  useEffect(() => {
    if (editing.current || !config) return;
    setTargetDraft(config.targetLimit !== null ? fmt0(config.targetLimit) : "");
  }, [config]);

  if (!workspace || !review || !config) return null;
  const capSet = workspace.state.layer.cap !== null;

  const commitTarget = () => {
    editing.current = false;
    const raw = targetDraft.trim().replace(/,/g, "");
    const parsed = raw === "" ? null : Number(raw);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setTargetDraft(config.targetLimit !== null ? fmt0(config.targetLimit) : "");
      return;
    }
    if (parsed !== config.targetLimit) {
      void patchWorkspace({ ilf: { targetLimit: parsed } });
    } else if (parsed !== null) {
      setTargetDraft(fmt0(parsed));
    }
  };

  const uploadTable = async (file: File) => {
    if (!projectId) return;
    setUploadBusy(true);
    setUploadError(null);
    try {
      await api.importIlfTable(projectId, file);
      await openProject(projectId);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setUploadBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const sourceButton = (
    source: typeof config.source,
    label: string,
    title: string,
    disabled = false,
  ) => (
    <button
      key={source}
      aria-pressed={config.source === source}
      disabled={disabled}
      title={title}
      onClick={() => void patchWorkspace({ ilf: { source } })}
      className={`px-3 py-1.5 text-[0.8rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        config.source === source
          ? "bg-ink text-paper"
          : "bg-transparent text-ink-soft hover:bg-steel-soft"
      }`}
    >
      {label}
    </button>
  );

  const fitRow = (kind: "lognormal" | "pareto", fit: SeverityFit) => {
    const d = fit.distribution;
    const params =
      d.kind === "lognormal"
        ? `mu ${d.mu.toFixed(3)}, sigma ${d.sigma.toFixed(3)}`
        : `theta ${fmt0(d.theta)}, alpha ${d.alpha.toFixed(3)}`;
    const selected = config.source === "fitted" && config.fittedKind === kind;
    return (
      <tr key={kind} className={selected ? "bg-gold-soft/60" : "hover:bg-steel-soft/40"}>
        <td className="px-2 py-1 text-[0.82rem] font-medium capitalize text-ink">{kind}</td>
        <td className="num px-2 py-1 text-[0.8rem] text-ink-soft">{params}</td>
        <td className="num px-2 py-1 text-right text-[0.8rem] text-ink-soft">
          {fit.valid ? fit.logLikelihood.toFixed(1) : "-"}
        </td>
        <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
          {fit.nExact} / {fit.nCensored}
        </td>
        <td className="px-2 py-1 text-[0.78rem]">
          {fit.valid ? (
            <span className="text-verdigris">usable</span>
          ) : (
            <span className="text-oxblood" title={fit.warnings.join("; ")}>
              not usable
            </span>
          )}
        </td>
        <td className="px-2 py-1 text-right">
          <button
            disabled={!fit.valid}
            onClick={() =>
              void patchWorkspace({ ilf: { source: "fitted", fittedKind: kind } })
            }
            className="rounded-sm border border-hairline px-2 py-0.5 text-[0.72rem] font-medium text-ink-soft hover:border-steel hover:text-steel disabled:cursor-not-allowed disabled:opacity-40"
          >
            use
          </button>
        </td>
      </tr>
    );
  };

  const activeFit =
    config.source === "fitted" && review.fits ? review.fits[config.fittedKind] : null;

  return (
    <Section
      title="Increased limits"
      kicker="restore developed capped ultimates to total limits - severity fits, tables, illustrative curves"
    >
      {!capSet ? (
        <p className="mb-3 text-[0.8rem] text-ink-faint">
          Set a per-occurrence cap in the Development layer exhibit first; the uncap factor is
          E[X to target] / E[X to cap].
        </p>
      ) : null}

      {/* Source + target row */}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
            Restoration source
          </span>
          <div className="flex overflow-hidden rounded-sm border border-hairline-strong">
            {sourceButton("none", "None", "Capped runs stay limited")}
            {sourceButton(
              "fitted",
              "Fitted",
              "Censored MLE on this book's own claim severities",
              !review.fits || (!review.fits.lognormal.valid && !review.fits.pareto.valid),
            )}
            {sourceButton(
              "table",
              "Table",
              config.table
                ? `Imported table (${config.table.length} rows)`
                : "Import an ILF table first",
              !config.table,
            )}
            {sourceButton(
              "illustrative",
              "Illustrative",
              "Bundled textbook curves - NOT ISO/NCCI factors",
            )}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
          Restore to limit
          <input
            value={targetDraft}
            placeholder="blank = unlimited"
            title="Target limit at the cap's base-year cost level. Blank = unlimited (curve sources only; tables need a finite target)."
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(e) => setTargetDraft(e.target.value)}
            onBlur={commitTarget}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="num w-32 rounded-sm border border-hairline-strong bg-panel px-2 py-1 text-right text-[0.82rem] text-ink outline-none focus:border-steel"
            aria-label="Restoration target limit"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
            ILF table (CSV: limit, factor)
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            disabled={uploadBusy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadTable(f);
            }}
            className="text-[0.78rem] text-ink-soft file:mr-2 file:rounded-sm file:border file:border-hairline-strong file:bg-panel file:px-2 file:py-1 file:text-[0.75rem] file:text-ink-soft"
            aria-label="Import ILF table"
          />
        </div>
      </div>
      {uploadError ? (
        <p className="mb-3 rounded-sm border border-oxblood/50 bg-oxblood-soft px-3 py-1.5 text-[0.8rem] text-oxblood">
          {uploadError}
        </p>
      ) : null}

      {/* Resolved factor */}
      {review.resolved ? (
        <p className="mb-4 rounded-sm border border-verdigris bg-verdigris-soft px-3 py-2 text-[0.85rem] text-verdigris">
          Uncap factor{" "}
          <span className="num text-[1.05rem] font-semibold">
            {review.resolved.factor.toFixed(4)}
          </span>{" "}
          to {review.resolved.targetLimit === null
            ? "unlimited"
            : fmt0(review.resolved.targetLimit)}{" "}
          via {review.resolved.sourceLabel}. Applies on the next capped analysis run.
          {review.resolved.warnings.length > 0 ? (
            <span className="mt-1 block text-[0.75rem] text-[#4c6b60]">
              {review.resolved.warnings.join(" - ")}
            </span>
          ) : null}
        </p>
      ) : config.source !== "none" ? (
        <p className="mb-4 rounded-sm border border-gold bg-gold-soft px-3 py-1.5 text-[0.8rem] font-medium text-[#6b4f16]">
          No usable factor: {review.unresolvedReason}
        </p>
      ) : null}

      {/* Fits table */}
      {review.fits ? (
        <>
          <h3 className="mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Severity fits{" "}
            <span className="font-normal normal-case tracking-normal text-ink-faint">
              (censored MLE at the cap's base-year cost level; open claims censored at reported
              incurred - a CASE-ADEQUACY assumption: redundant reserves overstate the fitted
              tail, deficient ones understate it; cross-check the case-adequacy diagnostic)
            </span>
          </h3>
          <div className="overflow-x-auto">
            <table className="ledger w-full min-w-[680px]">
              <thead>
                <tr>
                  {["Curve", "Parameters", "Log-lik", "Closed / open", "Fit", ""].map((h, i) => (
                    <th
                      key={i}
                      className={`px-2 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft ${
                        i === 2 || i === 3 ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fitRow("lognormal", review.fits.lognormal)}
                {fitRow("pareto", review.fits.pareto)}
              </tbody>
            </table>
          </div>

          {activeFit && activeFit.valid ? (
            <>
              <h3 className="mt-3 mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                Quantile check - {config.fittedKind}{" "}
                <span className="font-normal normal-case tracking-normal text-ink-faint">
                  (empirical side is Kaplan-Meier censoring-adjusted - raw closed-claim
                  quantiles run small because large claims stay open; "beyond data" = censoring
                  exhausts the observable range there)
                </span>
              </h3>
              <div className="overflow-x-auto">
                <table className="ledger w-full min-w-[520px]">
                  <thead>
                    <tr>
                      <th className="px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                        Percentile
                      </th>
                      {activeFit.quantileCheck.map((q) => (
                        <th
                          key={q.p}
                          className="num px-2 py-1.5 text-right text-[0.7rem] font-semibold text-ink-soft"
                        >
                          p{Math.round(q.p * 100)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="hover:bg-steel-soft/40">
                      <td className="px-2 py-1 text-[0.8rem] font-medium text-ink-soft">
                        Empirical
                      </td>
                      {activeFit.quantileCheck.map((q) => (
                        <td key={q.p} className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                          {q.empirical !== null ? fmt0(q.empirical) : (
                            <span className="text-ink-faint">beyond data</span>
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr className="hover:bg-steel-soft/40">
                      <td className="px-2 py-1 text-[0.8rem] font-medium text-ink-soft">Fitted</td>
                      {activeFit.quantileCheck.map((q) => (
                        <td key={q.p} className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                          {fmt0(q.fitted)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {/* Illustrative curves */}
      {config.source === "illustrative" ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="rounded-sm border border-gold bg-gold-soft px-3 py-1.5 text-[0.78rem] font-medium text-[#6b4f16]">
            Illustrative curves are textbook-plausible shapes, NOT ISO or NCCI factors. Prefer
            fitted curves or an imported table for anything you intend to book.
          </p>
          {review.illustrativeCurves.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[0.82rem] text-ink">
              <input
                type="radio"
                name="illustrative-curve"
                checked={config.curveId === c.id}
                onChange={() => void patchWorkspace({ ilf: { curveId: c.id } })}
              />
              {c.label}
            </label>
          ))}
        </div>
      ) : null}

      {/* Imported table preview */}
      {config.source === "table" && config.table ? (
        <div className="mt-3 overflow-x-auto">
          <table className="ledger w-auto min-w-[320px]">
            <thead>
              <tr>
                <th className="px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Limit
                </th>
                <th className="px-2 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Factor
                </th>
              </tr>
            </thead>
            <tbody>
              {[...config.table]
                .sort((a, b) => a.limit - b.limit)
                .map((row) => (
                  <tr key={row.limit} className="hover:bg-steel-soft/40">
                    <td className="num px-2 py-1 text-[0.8rem] text-ink">{fmt0(row.limit)}</td>
                    <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                      {row.factor.toFixed(3)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-faint">
        The uncap factor is E[X to target] / E[X to cap] on the selected severity source, at the
        cap's base-year cost level (an indexed cap keeps the layer constant in real terms, so one
        factor serves every origin year). It multiplies each method's developed CAPPED ultimate in
        the Selection of ultimates exhibit; IBNR and unpaid there are then measured against
        UNLIMITED diagonals. Interpolation within an imported table is log-log; the tool refuses
        to extrapolate beyond the table's range.
      </p>
    </Section>
  );
}
