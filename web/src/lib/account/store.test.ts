import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "@/lib/engine/game";
import type { GameRecord } from "@/lib/session/profile";
import type { SavedReview } from "@/lib/session/saved-reviews";
import { emptyHistory } from "./merge";
import {
  HISTORY_EVENT, QUEUE_EVENT, addToQueue, finishInflight, queueChange, readAccount, readQueue, takeQueue, writeAccount,
} from "./store";

const game = (at: number): GameRecord => ({ at, difficulty: "easy", won: true, cardsLeft: 0, plays: [], suits: [0, 0, 0, 0], hints: 0 });

const final: GameState = {
  hands: [[], [5], [6, 7], [8]], current: 1, firstMove: false, lastPlay: null, passes: 0,
  history: [{ player: 0, cards: [0] }], winner: 0,
};
const review = (id: string): SavedReview => ({
  id, at: 1, title: "VS BOTS · EASY", final, names: [], seats: [], youSeat: 0, players: [0], scoreAll: true,
});

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

let events: string[];

beforeEach(() => {
  events = [];
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("window", {
    dispatchEvent: (e: Event) => events.push(e.type),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("account store", () => {
  it("queueChange without an account returns false and stores nothing", () => {
    expect(queueChange({ games: [game(1)] })).toBe(false);
    expect(readAccount()).toBeNull();
    expect(readQueue("a")).toBeNull();
  });

  it("queueChange updates the cache and queues for that account", () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    expect(queueChange({ games: [game(1)] })).toBe(true);
    expect(readAccount()?.history.games.map((g) => g.at)).toEqual([1]);
    expect(readQueue("a")?.games.map((g) => g.at)).toEqual([1]);
    expect(readQueue("b")).toBeNull();
    expect(events).toContain(HISTORY_EVENT);
    expect(events).toContain(QUEUE_EVENT);
  });

  it("writeAccount(null) removes the account copy", () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    writeAccount(null);
    expect(readAccount()).toBeNull();
  });

  it("a failed flight goes back ahead of newer changes", () => {
    addToQueue("a", { reviews: [review("r1")] });
    expect(takeQueue("a")?.reviews.map((r) => r.id)).toEqual(["r1"]);
    expect(readQueue("a")).toBeNull();
    addToQueue("a", { deletedReviews: ["r1"] });
    finishInflight("a", false);
    const queue = readQueue("a");
    expect(queue?.reviews).toEqual([]);
    expect(queue?.deletedReviews).toEqual(["r1"]);
    expect(takeQueue("a")?.deletedReviews).toEqual(["r1"]);
  });

  it("a successful flight is dropped", () => {
    addToQueue("a", { games: [game(1)] });
    takeQueue("a");
    addToQueue("a", { games: [game(2)] });
    finishInflight("a", true);
    expect(readQueue("a")?.games.map((g) => g.at)).toEqual([2]);
    expect(takeQueue("a")?.games.map((g) => g.at)).toEqual([2]);
  });

  it("an unfinished flight is sent again with the next one", () => {
    addToQueue("a", { games: [game(1)] });
    takeQueue("a"); // the tab closed before the answer came back
    addToQueue("a", { games: [game(2)] });
    expect(takeQueue("a")?.games.map((g) => g.at)).toEqual([1, 2]);
  });

  it("survives blocked storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(readAccount()).toBeNull();
    expect(queueChange({ games: [game(1)] })).toBe(false);
    expect(() => writeAccount({ userId: "a", history: emptyHistory() })).not.toThrow();
    expect(() => addToQueue("a", { games: [game(1)] })).not.toThrow();
    expect(takeQueue("a")).toBeNull();
  });
});
