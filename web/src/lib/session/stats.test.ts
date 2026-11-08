import { afterEach, describe, expect, it, vi } from "vitest";
import { readQueue } from "@/lib/account/store";
import { signedIn } from "@/lib/account/test-helpers";
import { readGuestStats, readStats, recordGame, recordMatch } from "./stats";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("stats", () => {
  it("counts games, wins, matches and match wins separately", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    recordGame(true);
    recordGame(false);
    recordMatch(false);
    recordGame(true);
    recordMatch(true);
    expect(readStats()).toEqual({ games: 3, wins: 2, matches: 2, matchWins: 1 });
  });

  it("returns zeros and does not throw when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    expect(() => recordGame(true)).not.toThrow();
    expect(() => recordMatch(true)).not.toThrow();
    expect(readStats()).toEqual({ games: 0, wins: 0, matches: 0, matchWins: 0 });
  });
});

describe("signed in", () => {
  it("records matches to the account", () => {
    signedIn();
    recordMatch(true);
    recordGame(true);
    expect(readStats()).toMatchObject({ matches: 1, matchWins: 1 });
    expect(readGuestStats()).toEqual({ games: 0, wins: 0, matches: 0, matchWins: 0 });
    expect(readQueue("a")?.matches).toHaveLength(1);
  });
});
