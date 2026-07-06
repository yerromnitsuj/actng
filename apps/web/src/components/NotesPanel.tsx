import { useState } from "react";
import { useStore } from "../state/store.js";
import { Button, EmptyState } from "./ui.js";

export default function NotesPanel() {
  const notes = useStore((s) => s.notes);
  const addNote = useStore((s) => s.addNote);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await addNote(text);
      setDraft("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Record a selection rationale, caveat, or follow-up..."
          className="flex-1 rounded-sm border border-hairline-strong bg-panel px-3 py-1.5 text-[0.85rem] text-ink outline-none focus:border-steel"
        />
        <Button kind="secondary" type="submit" disabled={!draft.trim() || saving}>
          Add
        </Button>
      </form>
      {notes.length === 0 ? (
        <EmptyState title="No notes yet" />
      ) : (
        <ul className="flex max-h-[300px] flex-col gap-0 overflow-y-auto">
          {notes.map((n) => (
            <li key={n.id} className="border-b border-hairline py-2 last:border-b-0">
              <p className="text-[0.85rem] leading-relaxed text-ink">{n.text}</p>
              <p className="mt-0.5 text-[0.68rem] uppercase tracking-[0.12em] text-ink-faint">
                {n.author === "advisor" ? "Advisor" : "You"} -{" "}
                {new Date(n.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
