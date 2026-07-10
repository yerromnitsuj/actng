import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.js";
import type { ToolEvent } from "../api/types.js";

const TOOL_LABELS: Record<string, string> = {
  analyze_claim_sizes: "Analyzing claim sizes",
  set_loss_cap: "Setting the loss cap",
  analyze_trends: "Analyzing trends",
  set_trend_selections: "Setting trend selections",
  analyze_elr: "Analyzing expected loss ratios",
  set_elr: "Selecting the ELR",
  set_rate_history: "Setting rate history",
  fit_severity_curves: "Fitting severity curves",
  set_ilf_source: "Setting the ILF source",
  get_workspace_overview: "Read workspace",
  analyze_development_factors: "Analyzed development factors",
  fit_tail_curves: "Fitted tail curves",
  assess_data_quality: "Assessed data quality",
  get_diagnostic_detail: "Read diagnostic detail",
  get_analysis_results: "Read analysis results",
  apply_ldf_selections: "Applied LDF selections",
  set_tail_factor: "Set tail factor",
  run_analysis: "Ran analysis",
  run_sensitivity: "Ran sensitivity",
  save_note: "Saved note",
};

function ToolChip({ event }: { event: ToolEvent }) {
  const label = TOOL_LABELS[event.toolName] ?? event.toolName;
  const failed =
    typeof event.result === "object" &&
    event.result !== null &&
    (event.result as { success?: boolean }).success === false;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[0.7rem] font-medium tracking-wide ${
        failed
          ? "border-oxblood/40 bg-oxblood-soft text-oxblood"
          : event.isAction
            ? "border-gold bg-gold-soft text-[#6b4f16]"
            : "border-hairline bg-paper text-ink-soft"
      }`}
      title={failed ? "Tool returned an error" : undefined}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          failed ? "bg-oxblood" : event.isAction ? "bg-gold" : "bg-steel"
        }`}
      />
      {label}
      {failed ? " (failed)" : ""}
    </span>
  );
}

/** Minimal markdown: paragraphs, **bold**, headers become bold lines. */
function renderContent(content: string) {
  return content
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((para, i) => {
      const clean = para.replace(/^#+\s*/gm, "");
      const parts = clean.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
        seg.startsWith("**") && seg.endsWith("**") ? (
          <strong key={j} className="font-semibold text-ink">
            {seg.slice(2, -2)}
          </strong>
        ) : (
          seg
        ),
      );
      return (
        <p key={i} className="whitespace-pre-wrap text-[0.85rem] leading-relaxed text-ink">
          {parts}
        </p>
      );
    });
}

export default function AdvisorPanel() {
  const messages = useStore((s) => s.messages);
  const liveTurn = useStore((s) => s.liveTurn);
  const chatBusy = useStore((s) => s.chatBusy);
  const sendMessage = useStore((s) => s.sendMessage);
  const threads = useStore((s) => s.threads);
  const activeThreadId = useStore((s) => s.activeThreadId);
  const selectThread = useStore((s) => s.selectThread);
  const newThread = useStore((s) => s.newThread);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, liveTurn]);

  const submit = () => {
    const text = draft.trim();
    if (!text || chatBusy) return;
    setDraft("");
    void sendMessage(text);
  };

  return (
    // Height leaves ~120px of bottom clearance so the composer stays clear
    // of an overlaying macOS dock / OS taskbar even when pinned.
    <aside className="rise sticky top-6 flex h-[calc(100vh-9rem)] w-[400px] shrink-0 flex-col rounded-sm border border-hairline bg-panel shadow-[0_1px_2px_rgb(26_35_50/0.04)] max-xl:hidden">
      <header className="flex shrink-0 items-center justify-between border-b-2 border-ink px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="font-display text-[1.1rem] font-semibold italic text-ink">Advisor</h2>
          <span className="text-[0.64rem] uppercase tracking-[0.2em] text-ink-faint">
            reserving counsel
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {threads.length > 0 ? (
            <select
              value={activeThreadId ?? ""}
              disabled={chatBusy}
              onChange={(e) => void selectThread(e.target.value)}
              className="max-w-[150px] rounded-sm border border-hairline bg-panel px-1.5 py-1 text-[0.72rem] text-ink-soft outline-none focus:border-steel disabled:opacity-50"
            >
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          ) : null}
          <button
            onClick={() => void newThread()}
            disabled={chatBusy}
            className="rounded-sm border border-hairline px-2 py-1 text-[0.72rem] font-medium text-ink-soft hover:border-steel hover:text-steel disabled:opacity-50"
            title="Start a new conversation"
          >
            New
          </button>
        </div>
      </header>

      {/* min-h-0 is load-bearing: without it this flex child refuses to
          shrink below its content, and a long thread inflates the panel past
          its fixed height, pushing the composer off-screen. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !liveTurn ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="font-display text-[1.05rem] italic text-ink-soft">
              Ask for a review, a recommendation, or an action.
            </p>
            <div className="flex flex-col gap-1.5">
              {[
                "Review this triangle and recommend LDF selections, then apply them and rerun.",
                "Any data quality concerns I should know about?",
                "Which tail factor would you use here, and why?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setDraft("");
                    void sendMessage(suggestion);
                  }}
                  disabled={chatBusy}
                  className="rounded-sm border border-hairline bg-paper px-3 py-1.5 text-left text-[0.78rem] leading-snug text-ink-soft transition-colors hover:border-steel hover:text-ink disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m) => (
              <div key={m.id}>
                {m.role === "user" ? (
                  <div className="ml-6 rounded-sm bg-steel-soft px-3 py-2">
                    <p className="whitespace-pre-wrap text-[0.85rem] leading-relaxed text-ink">
                      {m.content}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {m.toolEvents.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {m.toolEvents.map((e, i) => (
                          <ToolChip key={i} event={e} />
                        ))}
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-2 border-l-2 border-gold pl-3">
                      {renderContent(m.content)}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {liveTurn ? (
              <div className="flex flex-col gap-2">
                {liveTurn.toolEvents.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {liveTurn.toolEvents.map((e, i) => (
                      <ToolChip key={i} event={e} />
                    ))}
                  </div>
                ) : null}
                {liveTurn.pendingTool ? (
                  <p className="text-[0.75rem] italic text-ink-faint">
                    {TOOL_LABELS[liveTurn.pendingTool] ?? liveTurn.pendingTool}...
                  </p>
                ) : null}
                {liveTurn.content ? (
                  <div className="flex flex-col gap-2 border-l-2 border-gold pl-3">
                    {renderContent(liveTurn.content)}
                  </div>
                ) : (
                  <p className="pl-1 text-[1rem] text-ink-faint">
                    <span className="advisor-dot">.</span>
                    <span className="advisor-dot">.</span>
                    <span className="advisor-dot">.</span>
                  </p>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <form
        className="shrink-0 border-t border-hairline p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            maxLength={8000}
            placeholder={chatBusy ? "The advisor is working..." : "Ask the advisor..."}
            disabled={chatBusy}
            className="flex-1 resize-none rounded-sm border border-hairline-strong bg-paper px-3 py-2 text-[0.85rem] text-ink outline-none focus:border-steel disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={chatBusy || !draft.trim()}
            className="rounded-sm bg-ink px-3 py-2 text-[0.8rem] font-medium text-paper transition-colors hover:bg-steel disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}
