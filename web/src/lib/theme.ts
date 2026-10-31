/**
 * The accent colour. Every option keeps black text readable on it, and each
 * has its own colour for picked cards so the two are never the same.
 */
export const ACCENTS = [
  { id: "orange", name: "ORANGE", accent: "#ff5a1f", picked: "#ffd400" },
  { id: "yellow", name: "YELLOW", accent: "#ffd400", picked: "#00c2a8" },
  { id: "green", name: "GREEN", accent: "#00c2a8", picked: "#ffd400" },
  { id: "blue", name: "BLUE", accent: "#4d8bff", picked: "#ffd400" },
  { id: "pink", name: "PINK", accent: "#ff5ca8", picked: "#ffd400" },
  { id: "violet", name: "VIOLET", accent: "#a78bfa", picked: "#ffd400" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];
export const DEFAULT_ACCENT: AccentId = "orange";
export const ACCENT_KEY = "big2.accent.v1";

const isAccent = (value: string | null): value is AccentId => ACCENTS.some((a) => a.id === value);

export function readAccent(): AccentId {
  try {
    const saved = localStorage.getItem(ACCENT_KEY);
    return isAccent(saved) ? saved : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function saveAccent(id: AccentId) {
  try {
    localStorage.setItem(ACCENT_KEY, id);
  } catch {
    // Storage blocked: the colour lasts for this page only.
  }
}

/** Apply an accent to the page. The CSS reads `data-accent` on <html>. */
export function applyAccent(id: AccentId) {
  document.documentElement.dataset.accent = id;
}

/**
 * Runs before the page paints so a saved colour does not flash orange first.
 * Kept as plain text because it is inlined into the document head.
 */
export const ACCENT_BOOT_SCRIPT = `try{var a=localStorage.getItem("${ACCENT_KEY}");if(a)document.documentElement.dataset.accent=a}catch(e){}`;
