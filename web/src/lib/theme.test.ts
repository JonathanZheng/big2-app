import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCENTS, DEFAULT_ACCENT, readAccent, saveAccent } from "./theme";

/** WCAG contrast ratio between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

afterEach(() => vi.unstubAllGlobals());

describe("accents", () => {
  it("keeps black text readable on every accent and picked colour", () => {
    for (const a of ACCENTS) {
      expect(contrast(a.accent, "#111111")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(a.picked, "#111111")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("never uses the accent itself for picked cards", () => {
    for (const a of ACCENTS) expect(a.picked.toLowerCase()).not.toBe(a.accent.toLowerCase());
  });

  it("remembers the chosen accent and falls back to orange", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    expect(readAccent()).toBe(DEFAULT_ACCENT);
    saveAccent("blue");
    expect(readAccent()).toBe("blue");
    data.set("big2.accent.v1", "neon");
    expect(readAccent()).toBe(DEFAULT_ACCENT);
  });

  it("falls back when storage is blocked", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(readAccent()).toBe(DEFAULT_ACCENT);
    expect(() => saveAccent("pink")).not.toThrow();
  });
});

describe("globals.css", () => {
  it("defines the same colours as ACCENTS for every choice", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    for (const a of ACCENTS) {
      const rule = a.id === DEFAULT_ACCENT ? ":root {" : `:root[data-accent="${a.id}"]`;
      const start = css.indexOf(rule);
      expect(start).toBeGreaterThanOrEqual(0);
      const body = css.slice(start, css.indexOf("}", start));
      expect(body).toContain(`--accent: ${a.accent}`);
      expect(body).toContain(`--picked: ${a.picked}`);
    }
  });
});
