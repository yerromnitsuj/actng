import type { Triangle } from "@actng/core";
import { fmt0, fmtFactor } from "./ui.js";

/**
 * The ledger triangle: origins down, ages across, hairline rules, tabular
 * numerals, and the latest observed diagonal underlaid in gold -- the
 * evaluation-date truth the whole analysis hangs on.
 */
export default function TriangleGrid({
  triangle,
  mode = "value",
  caption,
}: {
  triangle: Triangle;
  mode?: "value" | "factor" | "ratio";
  caption?: string;
}) {
  const lastObserved = triangle.values.map((row) => {
    for (let j = row.length - 1; j >= 0; j--) {
      if (row[j] !== null && row[j] !== undefined) return j;
    }
    return -1;
  });

  const render = (v: number | null | undefined): string => {
    if (v === null || v === undefined) return "";
    if (mode === "factor") return fmtFactor(v);
    if (mode === "ratio") return fmtFactor(v, 3);
    return fmt0(v);
  };

  return (
    <div className="overflow-x-auto">
      <table className="ledger w-full min-w-[640px]">
        {caption ? (
          <caption className="pb-2 text-left text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint">
            {caption}
          </caption>
        ) : null}
        <thead>
          <tr>
            <th className="px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
              Origin
            </th>
            {triangle.ages.map((age) => (
              <th
                key={age}
                className="num px-2 py-1.5 text-right text-[0.72rem] font-semibold text-ink-soft"
              >
                {age}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {triangle.origins.map((origin, i) => (
            <tr key={origin} className="hover:bg-steel-soft/40">
              <td className="px-2 py-1 text-[0.8rem] font-medium text-ink-soft">{origin}</td>
              {triangle.ages.map((_, j) => {
                const v = triangle.values[i]?.[j];
                const isDiagonal = j === lastObserved[i];
                return (
                  <td
                    key={j}
                    className={`num px-2 py-1 text-right text-[0.8rem] ${
                      isDiagonal
                        ? "bg-gold-soft font-semibold text-ink shadow-[inset_0_-1.5px_0_var(--color-gold)]"
                        : v === null || v === undefined
                          ? ""
                          : "text-ink"
                    }`}
                  >
                    {render(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
