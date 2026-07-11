import type { ReactNode } from "react";

/** Shared primitives for the ledger aesthetic. */

export function fmt0(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  // `+ 0` folds negative zero back to zero so small negatives never render "-0".
  return (Math.round(v) + 0 === 0 ? 0 : Math.round(v)).toLocaleString("en-US");
}

export function fmtK(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(v / 1_000).toFixed(0)}K`;
  return Math.round(v).toLocaleString("en-US");
}

export function fmtFactor(v: number | null | undefined, dp = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return v.toFixed(dp);
}

export function fmtPct(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(dp)}%`;
}

export function Section({
  title,
  kicker,
  actions,
  children,
  className = "",
  id,
}: {
  title: string;
  kicker?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Anchor id for the exhibit jump-nav; scroll-margin keeps the heading clear of the sticky nav. */
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`rise scroll-mt-24 rounded-sm border border-hairline bg-panel shadow-[0_1px_2px_rgb(26_35_50/0.04)] ${className}`}
    >
      <header className="flex items-baseline justify-between gap-4 border-b border-hairline px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-[1.15rem] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {kicker ? (
            <span className="text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint max-sm:hidden">
              {kicker}
            </span>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  kind = "secondary",
  disabled,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const kinds: Record<string, string> = {
    primary:
      "bg-steel text-paper hover:bg-ink border border-steel hover:border-ink disabled:opacity-45",
    secondary:
      "bg-transparent text-steel border border-hairline-strong hover:border-steel hover:bg-steel-soft disabled:opacity-45",
    ghost: "bg-transparent text-ink-soft border border-transparent hover:text-ink hover:bg-steel-soft disabled:opacity-45",
    danger:
      "bg-transparent text-oxblood border border-hairline-strong hover:border-oxblood hover:bg-oxblood-soft disabled:opacity-45",
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-sm px-3 py-1.5 text-[0.82rem] font-medium tracking-wide transition-colors duration-150 ${kinds[kind]}`}
    >
      {children}
    </button>
  );
}

export function SeverityBadge({ severity }: { severity: "info" | "warning" | "critical" }) {
  const styles = {
    info: "bg-steel-soft text-steel",
    warning: "bg-gold-soft text-[#7a5c1d]",
    critical: "bg-oxblood-soft text-oxblood",
  } as const;
  return (
    <span
      className={`inline-block rounded-sm px-1.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.1em] ${styles[severity]}`}
    >
      {severity}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="font-display text-lg italic text-ink-soft">{title}</p>
      {children ? <div className="text-[0.85rem] text-ink-faint">{children}</div> : null}
    </div>
  );
}
