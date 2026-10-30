"use client";

import { useSyncExternalStore } from "react";
import { ACCENTS, type AccentId, DEFAULT_ACCENT, applyAccent, saveAccent } from "@/lib/theme";

// The chosen accent lives on <html data-accent>, set before the page paints.
const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};
const current = () => (document.documentElement.dataset.accent as AccentId | undefined) ?? DEFAULT_ACCENT;

/** Swatches for the accent colour used for your cards, active tabs and main buttons. */
export function AccentPicker() {
  const accent = useSyncExternalStore(subscribe, current, () => DEFAULT_ACCENT);
  function choose(id: AccentId) {
    applyAccent(id);
    saveAccent(id);
    listeners.forEach((l) => l());
  }
  return (
    <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-3">
      {ACCENTS.map((a) => (
        <button
          key={a.id}
          type="button"
          role="radio"
          aria-checked={accent === a.id}
          onClick={() => choose(a.id)}
          className={`flex items-center gap-2 border-3 border-ink bg-card px-3 py-2 font-extrabold text-xs ${
            accent === a.id ? "shadow-brutal outline-3 outline-offset-2 outline-ink" : "shadow-brutal-sm"
          }`}
        >
          <span aria-hidden className="h-6 w-6 border-2 border-ink" style={{ background: a.accent }} />
          {a.name}
        </button>
      ))}
    </div>
  );
}
