import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.js";
import { Section, fmtPct } from "./ui.js";

/**
 * Rate-change history and premium trend: the inputs the parallelogram
 * on-leveling runs on. Each change applies to policies written on/after its
 * effective date (annual-term assumption, stated on the exhibit). History
 * edits commit wholesale so the stored list is always the full record.
 */
export default function RatesPanel() {
  const workspace = useStore((s) => s.workspace);
  const patchWorkspace = useStore((s) => s.patchWorkspace);

  const rates = workspace?.state.rates ?? null;
  const [rows, setRows] = useState<{ effectiveDate: string; change: string }[]>([]);
  const [trendDraft, setTrendDraft] = useState("");
  const editing = useRef(false);

  // Full precision (a CSV/advisor 5.25% must not become "5.3"), trimmed of
  // float noise. Dirty checks compare against these exact seeded strings.
  const seedRows = (history: { effectiveDate: string; change: number }[]) =>
    history.map((h) => ({
      effectiveDate: h.effectiveDate,
      change: String(+(h.change * 100).toFixed(6)),
    }));

  useEffect(() => {
    if (!rates || editing.current) return;
    setRows(seedRows(rates.history));
    setTrendDraft(rates.premiumTrend !== null ? String(+(rates.premiumTrend * 100).toFixed(6)) : "");
  }, [rates]);

  if (!workspace || !rates) return null;

  const parseRow = (
    r: { effectiveDate: string; change: string },
  ): { effectiveDate: string; change: number } | null => {
    const date = r.effectiveDate.trim();
    const raw = r.change.trim().replace(/%/g, "");
    if (raw === "" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const change = Number(raw) / 100;
    if (!Number.isFinite(change) || change <= -1) return null;
    return { effectiveDate: date, change };
  };

  const commitHistory = (next: { effectiveDate: string; change: string }[]) => {
    // Untouched drafts are a no-op; empty/half-typed rows never commit
    // phantom values, and a bailed commit must NOT disarm the reseed guard
    // (the user is still mid-edit).
    const seeded = seedRows(rates.history);
    const dirty =
      next.length !== seeded.length ||
      next.some(
        (r, i) =>
          r.effectiveDate.trim() !== seeded[i]!.effectiveDate ||
          r.change.trim() !== seeded[i]!.change,
      );
    if (!dirty) {
      editing.current = false;
      return;
    }
    const parsed = next.map(parseRow);
    if (parsed.some((r) => r === null)) return; // mid-edit: keep drafts armed
    editing.current = false;
    void patchWorkspace({ rates: { history: parsed as { effectiveDate: string; change: number }[] } });
  };

  /** Removal builds from the STORED history, immune to other rows' drafts. */
  const removeStored = (index: number) => {
    editing.current = false;
    void patchWorkspace({
      rates: { history: rates.history.filter((_, j) => j !== index) },
    });
  };

  const commitTrend = () => {
    editing.current = false;
    const seeded = rates.premiumTrend !== null ? String(+(rates.premiumTrend * 100).toFixed(6)) : "";
    if (trendDraft.trim() === seeded) return;
    const raw = trendDraft.trim().replace(/%/g, "");
    const parsed = raw === "" ? null : Number(raw) / 100;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= -1)) {
      setTrendDraft(seeded);
      return;
    }
    if (parsed === rates.premiumTrend) return;
    void patchWorkspace({ rates: { premiumTrend: parsed } });
  };

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };

  // Round-5 F3: a typed-but-uncommitted rate change silently held its value
  // while the on-level exhibit still showed the prior answer. History commits
  // only on blur, so surface a pending cue (matching the selection matrix) and
  // let Enter commit - a half-typed or changed row must not read as applied.
  const seededNow = seedRows(rates.history);
  const historyPending =
    rows.length !== seededNow.length ||
    rows.some(
      (r, i) =>
        r.effectiveDate.trim() !== (seededNow[i]?.effectiveDate ?? "") ||
        r.change.trim() !== (seededNow[i]?.change ?? ""),
    );
  const trendSeed = rates.premiumTrend !== null ? String(+(rates.premiumTrend * 100).toFixed(6)) : "";
  const trendPending = trendDraft.trim() !== trendSeed;
  const pending = historyPending || trendPending;

  const inputClass =
    "num rounded-sm border border-hairline-strong bg-panel px-2 py-1 text-right text-[0.8rem] text-ink outline-none focus:border-steel";

  return (
    <Section
      title="Rates & premium"
      kicker="rate-change history for parallelogram on-leveling (annual policies, written uniformly) + premium trend"
    >
      {workspace.state.elr.method === "pure-premium" ? (
        <p className="mb-3 rounded-sm border border-steel bg-steel-soft px-3 py-1.5 text-[0.78rem] font-medium text-steel">
          The pure-premium method is active: exposure units are not rate-sensitive, so this rate
          history and parallelogram on-leveling do NOT affect the a-priori. Switch to the loss-ratio
          method in the a-priori exhibit to use them.
        </p>
      ) : null}
      {pending ? (
        <p className="mb-3 rounded-sm border border-gold bg-gold-soft px-3 py-1 text-[0.78rem] font-medium text-[#6b4f16]">
          Pending rate edit - press Enter or click away to apply. The on-level factors and ELR
          exhibit use the committed history below, not this draft.
        </p>
      ) : null}
      <div className="flex flex-wrap items-start gap-8">
        <div>
          <h3 className="mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Rate changes{" "}
            <span className="font-normal normal-case tracking-normal text-ink-faint">
              (applies to policies written on/after the date)
            </span>
          </h3>
          <table className="ledger min-w-[380px]">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Effective
                </th>
                <th className="px-2 py-1 text-right text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Change %
                </th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-1 py-0.5">
                    <input
                      value={r.effectiveDate}
                      placeholder="yyyy-mm-dd"
                      onFocus={() => {
                        editing.current = true;
                      }}
                      onChange={(e) =>
                        setRows(rows.map((x, j) => (j === i ? { ...x, effectiveDate: e.target.value } : x)))
                      }
                      onBlur={() => commitHistory(rows)}
                      onKeyDown={blurOnEnter}
                      className={`${inputClass} w-32 text-left`}
                      aria-label={`Rate change ${i + 1} effective date`}
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      value={r.change}
                      onFocus={() => {
                        editing.current = true;
                      }}
                      onChange={(e) =>
                        setRows(rows.map((x, j) => (j === i ? { ...x, change: e.target.value } : x)))
                      }
                      onBlur={() => commitHistory(rows)}
                      onKeyDown={blurOnEnter}
                      className={`${inputClass} w-20`}
                      aria-label={`Rate change ${i + 1} percent`}
                    />
                  </td>
                  <td className="px-1 py-0.5">
                    <button
                      onClick={() => removeStored(i)}
                      className="rounded-sm border border-hairline px-2 py-0.5 text-[0.7rem] text-ink-soft hover:border-oxblood hover:text-oxblood"
                      aria-label={`Remove rate change ${i + 1}`}
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={() => {
              editing.current = true;
              setRows([...rows, { effectiveDate: "", change: "" }]);
            }}
            className="mt-1.5 rounded-sm border border-hairline px-2.5 py-1 text-[0.75rem] font-medium text-ink-soft hover:border-steel hover:text-steel"
          >
            + add rate change
          </button>
          {rates.history.length === 0 ? (
            <p className="mt-1.5 max-w-[24rem] text-[0.74rem] leading-snug text-ink-faint">
              No history: premium is treated as already on-level. Loss ratios are only
              comparable across years once real rate changes are recorded (or imported as CSV:
              effective_date, rate_change).
            </p>
          ) : null}
        </div>

        <div>
          <h3 className="mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Premium trend %/yr
          </h3>
          <input
            value={trendDraft}
            placeholder="none"
            title="Annual premium trend applied on top of on-leveling"
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(e) => setTrendDraft(e.target.value)}
            onBlur={commitTrend}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className={`${inputClass} w-24`}
            aria-label="Premium trend percent per year"
          />
          <p className="mt-1 max-w-[20rem] text-[0.74rem] leading-snug text-ink-faint">
            NET of rate changes: exposure/inflation drift only. Rate action lives in the
            history - a trend fitted from raw average premium double-counts the on-level
            factor.
          </p>
          {rates.premiumTrend !== null ? (
            <p className="mt-1 text-[0.74rem] text-ink-faint">
              Premium restated at {fmtPct(rates.premiumTrend, 1)}/yr to the target year.
            </p>
          ) : null}
        </div>
      </div>
    </Section>
  );
}
