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
          // The chosen swatch is pressed into its shadow and turns black, so no outline
          // is needed to mark it.
          className={`flex items-center gap-2 border-3 border-ink px-3 py-2 font-extrabold text-xs motion-safe:transition-transform ${
            accent === a.id ? "translate-x-1 translate-y-1 bg-ink text-paper" : "bg-card shadow-brutal-sm hover:-translate-y-0.5"
          }`}
        >
          <span aria-hidden className="h-6 w-6 border-2 border-current" style={{ background: a.accent }} />
          {a.name}
        </button>
      ))}
    </div>
  );
}
