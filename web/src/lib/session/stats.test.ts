import { afterEach, describe, expect, it, vi } from "vitest";
import { readStats, recordResult } from "./stats";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("stats", () => {
  it("counts games, wins, matches and match wins", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    recordResult(true, null);
    recordResult(false, false);
    recordResult(true, true);
    expect(readStats()).toEqual({ games: 3, wins: 2, matches: 2, matchWins: 1 });
  });

  it("returns zeros and does not throw when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    expect(() => recordResult(true, null)).not.toThrow();
    expect(readStats()).toEqual({ games: 0, wins: 0, matches: 0, matchWins: 0 });
  });
});
