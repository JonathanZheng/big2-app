import { describe, expect, it } from "vitest";
import type { GameState } from "@/lib/engine/game";
import type { Label } from "@/lib/model/advice";
import type { PuzzleResult } from "@/lib/puzzle/puzzle";
import type { GameAnalysis } from "@/lib/session/analysis";
import type { GameRecord } from "@/lib/session/profile";
import type { SavedReview } from "@/lib/session/saved-reviews";
import {
  type AccountHistory, betterPuzzle, combineBundles, emptyBundle, emptyHistory, historyChanges, mergeHistory, splitBundle,
} from "./merge";
import { parseBundle } from "./validate";

const analysis = { moves: 10, best: 8, good: 1, inaccuracies: 1, mistakes: 0, blunders: 0 } as GameAnalysis;

const game = (at: number, withAnalysis = false): GameRecord => ({
  at, difficulty: "easy", won: at % 2 === 0, cardsLeft: 0, plays: [0, 1], suits: [1, 0, 0, 0], hints: 0,
  ...(withAnalysis ? { analysis } : {}),
});

const final: GameState = {
  hands: [[], [5], [6, 7], [8]], current: 1, firstMove: false, lastPlay: null, passes: 0,
  history: [{ player: 0, cards: [0] }], winner: 0,
};

const review = (id: string, at: number): SavedReview => ({
  id, at, title: "VS BOTS · EASY", final, names: ["You", "West", "North", "East"],
  seats: [1, 2, 3], youSeat: 0, players: [0], scoreAll: true,
});

const puzzle = (label: Label): PuzzleResult => ({ cards: [label.length], label });

const history = (h: Partial<AccountHistory> = {}): AccountHistory => ({ ...emptyHistory(), ...h });

describe("mergeHistory", () => {
  it("merge is idempotent", () => {
    const start = history({ games: [game(1)], reviews: [review("a", 1)], puzzles: { "2026-11-01": puzzle("Good") } });
    const change = { games: [game(1), game(2)], reviews: [review("b", 2)], puzzles: { "2026-11-02": puzzle("Best") } };
    const once = mergeHistory(start, change);
    const twice = mergeHistory(once, change);
    expect(twice.games).toEqual(once.games);
    expect(twice.reviews).toEqual(once.reviews);
    expect(twice.puzzles).toEqual(once.puzzles);
  });

  it("fills in a missing analysis but never removes one", () => {
    const filled = mergeHistory(history({ games: [game(1)] }), { games: [game(1, true)] });
    expect(filled.games[0].analysis).toEqual(analysis);
    const kept = mergeHistory(history({ games: [game(1, true)] }), { games: [game(1)] });
    expect(kept.games[0].analysis).toEqual(analysis);
  });

  it("keeps the newest 500 games in time order", () => {
    const games = Array.from({ length: 510 }, (_, i) => game(510 - i));
    const merged = mergeHistory(emptyHistory(), { games });
    expect(merged.games).toHaveLength(500);
    expect(merged.games[0].at).toBe(11);
    expect(merged.games[499].at).toBe(510);
  });

  it("keeps the newest 50 reviews, newest first, and applies deletions", () => {
    const reviews = Array.from({ length: 55 }, (_, i) => review(`r${i}`, i));
    const merged = mergeHistory(emptyHistory(), { reviews, deletedReviews: ["r54"] });
    expect(merged.reviews).toHaveLength(50);
    expect(merged.reviews[0].id).toBe("r53");
    expect(merged.reviews.some((r) => r.id === "r54")).toBe(false);
  });

  it("keeps the better puzzle result", () => {
    expect(betterPuzzle(puzzle("Mistake"), puzzle("Good")).label).toBe("Good");
    expect(betterPuzzle(puzzle("Good"), puzzle("Mistake")).label).toBe("Good");
    const existing = { cards: [1], label: "Best" as Label };
    expect(betterPuzzle(existing, { cards: [2], label: "Best" })).toBe(existing);
    expect(betterPuzzle(undefined, puzzle("Blunder")).label).toBe("Blunder");
  });

  it("adds match uploads to the totals", () => {
    const merged = mergeHistory(history({ matches: 3, matchWins: 1 }), {
      matches: [{ id: "x", matches: 1, matchWins: 1 }, { id: "y", matches: 2, matchWins: 0 }],
    });
    expect([merged.matches, merged.matchWins]).toEqual([6, 2]);
  });
});

describe("combineBundles", () => {
  it("combineBundles respects order", () => {
    const savedThenDeleted = combineBundles({ ...emptyBundle(), reviews: [review("a", 1)] }, { deletedReviews: ["a"] });
    expect(savedThenDeleted.reviews).toEqual([]);
    expect(savedThenDeleted.deletedReviews).toEqual(["a"]);
    const deletedThenSaved = combineBundles({ ...emptyBundle(), deletedReviews: ["a"] }, { reviews: [review("a", 1)] });
    expect(deletedThenSaved.reviews.map((r) => r.id)).toEqual(["a"]);
    expect(deletedThenSaved.deletedReviews).toEqual([]);
  });

  it("concatenates match uploads and merges games", () => {
    const combined = combineBundles(
      { ...emptyBundle(), games: [game(1)], matches: [{ id: "x", matches: 1, matchWins: 0 }] },
      { games: [game(1, true)], matches: [{ id: "y", matches: 1, matchWins: 1 }] },
    );
    expect(combined.games).toHaveLength(1);
    expect(combined.games[0].analysis).toEqual(analysis);
    expect(combined.matches.map((m) => m.id)).toEqual(["x", "y"]);
  });

  it("keeps a queue within the account's caps", () => {
    const earlier = { ...emptyBundle(), games: Array.from({ length: 500 }, (_, i) => game(i + 1)), reviews: Array.from({ length: 50 }, (_, i) => review(`r${i}`, i)) };
    const combined = combineBundles(earlier, { games: [game(501)], reviews: [review("r50", 50)] });
    expect(combined.games).toHaveLength(500);
    expect(combined.games[0].at).toBe(2);
    expect(combined.games[499].at).toBe(501);
    expect(combined.reviews).toHaveLength(50);
    expect(combined.reviews.map((r) => r.id)).toContain("r50");
    expect(combined.reviews.map((r) => r.id)).not.toContain("r0");
  });
});

describe("splitBundle", () => {
  const day = (i: number) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);

  it("splits a bundle into parts the server accepts, losing nothing", () => {
    const bundle = {
      ...emptyBundle(),
      games: [game(1)],
      puzzles: Object.fromEntries(Array.from({ length: 401 }, (_, i) => [day(i), puzzle("Good")])),
      deletedReviews: Array.from({ length: 201 }, (_, i) => `d${i}`),
      matches: Array.from({ length: 501 }, (_, i) => ({ id: `m${i}`, matches: 1, matchWins: 0 })),
    };
    const parts = splitBundle(bundle);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(parseBundle(part)).not.toBeNull();
    expect(parts.flatMap((p) => p.games)).toHaveLength(1);
    expect(parts.flatMap((p) => Object.keys(p.puzzles))).toHaveLength(401);
    expect(parts.flatMap((p) => p.deletedReviews)).toHaveLength(201);
    expect(parts.flatMap((p) => p.matches)).toHaveLength(501);
  });

  it("leaves a small bundle whole", () => {
    const bundle = { ...emptyBundle(), games: [game(1)] };
    expect(splitBundle(bundle)).toEqual([bundle]);
  });
});

describe("historyChanges", () => {
  it("historyChanges lists only what changed", () => {
    const before = history({ games: [game(1), game(2), game(3)], reviews: [review("a", 1)] });
    const after = history({ games: [game(2), game(3, true)], reviews: [review("b", 2)], puzzles: { "2026-11-01": puzzle("Good") } });
    const changes = historyChanges(before, after);
    expect(changes.upsertGames.map((g) => g.at)).toEqual([3]);
    expect(changes.deleteGames).toEqual([1]);
    expect(changes.upsertReviews.map((r) => r.id)).toEqual(["b"]);
    expect(changes.deleteReviews).toEqual(["a"]);
    expect(Object.keys(changes.upsertPuzzles)).toEqual(["2026-11-01"]);
  });
});
