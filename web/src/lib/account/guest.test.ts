import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "@/lib/engine/game";
import { saveResult } from "@/lib/puzzle/puzzle";
import { saveGameRecord } from "@/lib/session/profile";
import { saveReview } from "@/lib/session/saved-reviews";
import { recordGame, recordMatch } from "@/lib/session/stats";
import { clearGuest, readGuestBundle } from "./guest";
import { memoryStorage } from "./test-helpers";

const final: GameState = {
  hands: [[], [5], [6, 7], [8]], current: 1, firstMove: false, lastPlay: null, passes: 0,
  history: [{ player: 0, cards: [0] }], winner: 0,
};

afterEach(() => vi.unstubAllGlobals());

function playAsGuest() {
  vi.stubGlobal("localStorage", memoryStorage());
  saveGameRecord({ at: 1, difficulty: "easy", won: true, cardsLeft: 0, plays: [], suits: [0, 0, 0, 0], hints: 0 });
  recordGame(true);
  recordMatch(true);
  saveReview({ id: "r1", at: 1, title: "VS BOTS · EASY", final, names: [], seats: [], youSeat: 0, players: [0], scoreAll: true });
  saveResult("2026-11-01", { cards: [1], label: "Good" });
}

describe("guest data", () => {
  it("bundles every guest key", () => {
    playAsGuest();
    const bundle = readGuestBundle();
    expect(bundle?.games.map((g) => g.at)).toEqual([1]);
    expect(bundle?.reviews.map((r) => r.id)).toEqual(["r1"]);
    expect(Object.keys(bundle?.puzzles ?? {})).toEqual(["2026-11-01"]);
    expect(bundle?.matches).toEqual([{ id: expect.any(String), matches: 1, matchWins: 1 }]);
    expect(bundle?.deletedReviews).toEqual([]);
  });

  it("is null when the browser has nothing", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(readGuestBundle()).toBeNull();
    recordGame(true); // counts nobody reads are not history
    expect(readGuestBundle()).toBeNull();
  });

  it("clearGuest empties every guest key and leaves the colour", () => {
    playAsGuest();
    localStorage.setItem("big2.accent.v1", "blue");
    clearGuest();
    expect(readGuestBundle()).toBeNull();
    expect(localStorage.getItem("big2.accent.v1")).toBe("blue");
  });
});
