import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.js";
import { EmptyState, Section, fmt0 } from "./ui.js";
import type { TrendFit } from "../api/types.js";

/**
 * Trends and frequency/severity: per-year ultimate counts, frequency,
 * severity and pure premium from the latest run's SELECTED ultimates, with
 * log-linear trend fits over the standard windows and judgmental selection -
 * the same menu grammar as the LDF exhibit. Selections arm the ELR module.
 */
export default function TrendPanel() {
  const workspace = useStore((s) => s.workspace);
  const patchWorkspace = useStore((s) => s.patchWorkspace);

  const review = workspace?.trendReview ?? null;
  const [freqDraft, setFreqDraft] = useState("");
  const [sevDraft, setSevDraft] = useState("");
  const [targetDraft, setTargetDraft] = useState("");
  const editing = useRef(false);

  const storedTargetYear = workspace?.state.trend.targetYear ?? null;

  useEffect(() => {
    if (!review || editing.current) return;
    setFreqDraft(
      review.frequency.selection.value !== null
        ? (review.frequency.selection.value * 100).toFixed(1)
        : "",
    );
    setSevDraft(
      review.severity.selection.value !== null
        ? (review.severity.selection.value * 100).toFixed(1)
        : "",
    );
    // Seed from STATE: blank = floating latest-origin-year default. Seeding
    // the resolved year would let a mere focus+blur pin the float.
    setTargetDraft(storedTargetYear !== null ? String(storedTargetYear) : "");
  }, [review, storedTargetYear]);

  if (!review) {
    return (
      <Section title="Trends" kicker="frequency, severity, and cost-level restatement">
        <EmptyState title="Run an analysis first">
          The trend exhibit derives frequency and severity from the latest run's selected
          ultimates.
        </EmptyState>
      </Section>
    );
  }

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };

  const commitRate = (component: "frequency" | "severity") => {
    editing.current = false;
    const draft = component === "frequency" ? freqDraft : sevDraft;
    const selection =
      component === "frequency" ? review.frequency.selection : review.severity.selection;
    // An untouched draft must be a no-op: the display is rounded to 0.1%, so
    // re-parsing it would silently rewrite a fitted selection as a rounded
    // manual one on any focus+blur.
    const seeded = selection.value !== null ? (selection.value * 100).toFixed(1) : "";
    if (draft.trim() === seeded) return;
    const raw = draft.trim().replace(/%/g, "");
    const parsed = raw === "" ? null : Number(raw) / 100;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= -1)) {
      const setter = component === "frequency" ? setFreqDraft : setSevDraft;
      setter(seeded);
      return;
    }
    if (parsed === selection.value) return;
    const payload =
      component === "frequency"
        ? { frequency: { source: "manual" as const, value: parsed } }
        : {
            severity: {
              layer: review.severityLayer,
              source: "manual" as const,
              value: parsed,
            },
          };
    void patchWorkspace({ trend: payload });
  };

  const commitTarget = () => {
    editing.current = false;
    const raw = targetDraft.trim();
    const parsed = raw === "" ? null : Number(raw);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2200)) {
      setTargetDraft(storedTargetYear !== null ? String(storedTargetYear) : "");
      return;
    }
    if (parsed === storedTargetYear) return; // no-op blur must not pin the float
    void patchWorkspace({ trend: { targetYear: parsed } });
  };

  const useFit = (component: "frequency" | "severity", fit: TrendFit) => {
    if (fit.annualRate === null) return;
    const payload =
      component === "frequency"
        ? { frequency: { source: fit.key, value: fit.annualRate } }
        : {
            severity: { layer: review.severityLayer, source: fit.key, value: fit.annualRate },
          };
    void patchWorkspace({ trend: payload });
  };

  const fitsMenu = (component: "frequency" | "severity", fits: TrendFit[], selectedKey: string, selectedValue: number | null) => (
    <table className="ledger w-full min-w-[460px]">
      <thead>
        <tr>
          {["Window", "Trend %/yr", "R²", "n", ""].map((h, i) => (
            <th
              key={i}
              className={`px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-soft ${
                i === 0 ? "text-left" : "text-right"
              }`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {fits.map((f) => {
          // 5e-4 tolerance: selections may carry the 0.1%-rounded rate the
          // advisor read from analyze_trends.
          const isSelected =
            selectedKey === f.key &&
            selectedValue !== null &&
            f.annualRate !== null &&
            Math.abs(selectedValue - f.annualRate) < 5e-4;
          return (
            <tr
              key={f.key}
              className={isSelected ? "bg-gold-soft/60" : "hover:bg-steel-soft/40"}
              title={f.warnings.join("; ") || undefined}
            >
              <td className="px-2 py-1 text-[0.8rem] text-ink-soft">{f.label}</td>
              <td className="num px-2 py-1 text-right text-[0.8rem] font-medium text-ink">
                {f.annualRate !== null ? `${(f.annualRate * 100).toFixed(1)}%` : "-"}
              </td>
              <td className="num px-2 py-1 text-right text-[0.8rem] text-ink-soft">
                {f.rSquared !== null ? f.rSquared.toFixed(3) : "-"}
              </td>
              <td className="num px-2 py-1 text-right text-[0.8rem] text-ink-soft">
                {f.nPoints}
              </td>
              <td className="px-2 py-1 text-right">
                {f.annualRate !== null && !isSelected ? (
                  <button
                    onClick={() => useFit(component, f)}
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
  );

  const levelLabel =
    review.level === "restored"
      ? "RESTORED total-limits"
      : review.level === "limited"
        ? "LIMITED (capped)"
        : "unlimited";

  return (
    <Section
      title="Trends"
      kicker={`frequency and severity from the latest run's selected ultimates (${levelLabel} level) - trended to ${review.targetYear}`}
    >
      {review.notes.length > 0 ? (
        <p className="mb-3 text-[0.75rem] leading-relaxed text-ink-faint">
          {review.notes.join(". ")}.
        </p>
      ) : null}

      {/* Per-year series */}
      <div className="overflow-x-auto">
        <table className="ledger w-full min-w-[900px]">
          <thead>
            <tr>
              {[
                "Year",
                "Earned premium",
                "OLF",
                "Ult counts",
                "Freq /$1M",
                "Severity",
                "Pure prem /$1M",
                `Freq @${review.targetYear}`,
                `Sev @${review.targetYear}`,
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
                  {r.earnedPremium !== null ? fmt0(r.earnedPremium) : "-"}
                </td>
                <td
                  className="num cursor-help px-2 py-1 text-right text-[0.8rem] text-ink-faint"
                  title="Parallelogram on-level factor applied to the frequency and pure-premium denominators"
                >
                  {r.onLevelFactor.toFixed(3)}
                </td>
                <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                  {r.ultimateCounts !== null ? r.ultimateCounts.toFixed(1) : "-"}
                </td>
                <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                  {r.frequency !== null ? r.frequency.toFixed(2) : "-"}
                </td>
                <td className="num px-2 py-1 text-right text-[0.8rem] text-ink">
                  {r.severity !== null ? fmt0(r.severity) : "-"}
                </td>
                <td className="num px-2 py-1 text-right text-[0.8rem] text-ink-soft">
                  {r.purePremium !== null ? fmt0(r.purePremium) : "-"}
                </td>
                <td className="num px-2 py-1 text-right text-[0.8rem] font-medium text-steel">
                  {r.trendedFrequency !== null ? r.trendedFrequency.toFixed(2) : "-"}
                </td>
                <td className="num px-2 py-1 text-right text-[0.8rem] font-medium text-steel">
                  {r.trendedSeverity !== null ? fmt0(r.trendedSeverity) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Fits + selections */}
      <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div>
          <h3 className="mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Frequency trend
          </h3>
          {fitsMenu(
            "frequency",
            review.frequency.fits,
            review.frequency.selection.source,
            review.frequency.selection.value,
          )}
          <label className="mt-2 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
            Selected %/yr
            {review.frequency.selectionStale ? (
              <span className="rounded-sm border border-gold bg-gold-soft px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-[#6b4f16]" title="The fitted window this selection came from has since refit differently; re-select or treat as manual">
                stale
              </span>
            ) : null}
            <input
              value={freqDraft}
              placeholder="none"
              onFocus={() => {
                editing.current = true;
              }}
              onChange={(e) => setFreqDraft(e.target.value)}
              onBlur={() => commitRate("frequency")}
              onKeyDown={blurOnEnter}
              className="num w-20 rounded-sm border border-hairline-strong bg-panel px-2 py-1 text-right text-[0.8rem] text-ink outline-none focus:border-steel"
              aria-label="Selected frequency trend percent per year"
            />
          </label>
        </div>
        <div>
          <h3 className="mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Severity trend{" "}
            <span className="font-normal normal-case tracking-normal text-ink-faint">
              ({review.severityLayer} layer, {levelLabel} level)
            </span>
          </h3>
          {fitsMenu(
            "severity",
            review.severity.fits,
            review.severity.selection.source,
            review.severity.selection.value,
          )}
          <label className="mt-2 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
            Selected %/yr
            {review.severity.selectionStale ? (
              <span className="rounded-sm border border-gold bg-gold-soft px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-[#6b4f16]" title="The fitted window this selection came from has since refit differently; re-select or treat as manual">
                stale
              </span>
            ) : null}
            <input
              value={sevDraft}
              placeholder="none"
              onFocus={() => {
                editing.current = true;
              }}
              onChange={(e) => setSevDraft(e.target.value)}
              onBlur={() => commitRate("severity")}
              onKeyDown={blurOnEnter}
              className="num w-20 rounded-sm border border-hairline-strong bg-panel px-2 py-1 text-right text-[0.8rem] text-ink outline-none focus:border-steel"
              aria-label="Selected severity trend percent per year"
            />
          </label>
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
        Trend to year
        <input
          value={targetDraft}
          placeholder={String(review.targetYear)}
          onFocus={() => {
            editing.current = true;
          }}
          onChange={(e) => setTargetDraft(e.target.value)}
          onBlur={commitTarget}
          onKeyDown={blurOnEnter}
          className="num w-20 rounded-sm border border-hairline-strong bg-panel px-2 py-1 text-right text-[0.8rem] text-ink outline-none focus:border-steel"
          aria-label="Trend target year"
        />
        <span className="font-normal normal-case tracking-normal text-ink-faint">
          (blank = latest origin year)
        </span>
      </label>

      <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">
        Log-linear fits (ln y = a + b·t) on origin-period MIDPOINTS; the annual trend is
        e^b - 1, and trended columns restate to the midpoint of the target year. Frequency x severity
        trend should roughly reproduce a pure-premium trend - cross-check the product. Trend
        selections feed the expected-loss-ratio machinery; they do not change current method
        results, so no rerun is needed.
      </p>
    </Section>
  );
}
