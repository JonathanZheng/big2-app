import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "@/lib/engine/game";
import { readQueue } from "@/lib/account/store";
import { signedIn } from "@/lib/account/test-helpers";
import { type SavedReview, deleteSavedReview, readGuestReviews, readSavedReviews, saveReview } from "./saved-reviews";

const game: GameState = {
  hands: [[], [5], [6, 7], [8]], current: 1, firstMove: false, lastPlay: null, passes: 0,
  history: [{ player: 0, cards: [0] }], winner: 0,
};

const review = (at: number): SavedReview => ({
  id: String(at), at, title: "VS BOTS · EASY", final: game, names: ["You", "West", "North", "East"],
  seats: [1, 2, 3], youSeat: 0, players: [0], scoreAll: true,
});

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("saved reviews", () => {
  it("saves a review once, newest first, and deletes it", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    saveReview(review(1));
    saveReview(review(2));
    saveReview(review(1)); // saving again does not duplicate
    expect(readSavedReviews().map((r) => r.id)).toEqual(["2", "1"]);
    deleteSavedReview("2");
    expect(readSavedReviews().map((r) => r.id)).toEqual(["1"]);
  });

  it("keeps the newest 50", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    for (let i = 0; i < 55; i++) saveReview(review(i));
    const saved = readSavedReviews();
    expect(saved).toHaveLength(50);
    expect(saved[0].id).toBe("54");
    expect(saved.at(-1)!.id).toBe("5");
  });

  it("reports whether saving worked and survives blocked or corrupt storage", () => {
    vi.stubGlobal("localStorage", { getItem: () => "{bad", setItem: () => { throw new Error("full"); } });
    expect(readSavedReviews()).toEqual([]);
    expect(saveReview(review(1))).toBe(false);
    expect(() => deleteSavedReview("1")).not.toThrow();
  });
});

describe("signed in", () => {
  it("saves and deletes reviews on the account", () => {
    signedIn();
    expect(saveReview(review(1))).toBe(true);
    expect(readSavedReviews().map((r) => r.id)).toEqual(["1"]);
    expect(readGuestReviews()).toEqual([]);
    deleteSavedReview("1");
    expect(readSavedReviews()).toEqual([]);
    expect(readQueue("a")?.deletedReviews).toEqual(["1"]);
  });
});
