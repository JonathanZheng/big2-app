import { describe, expect, it } from "vitest";
import { emptyBundle } from "./merge";
import { MAX_GAME_BYTES, MAX_REVIEW_BYTES, parseBundle, sendable } from "./validate";

const game = (at: number) => ({ at, difficulty: "easy", won: true, cardsLeft: 0, plays: [], suits: [0, 0, 0, 0], hints: 0 });
const analysis = { moves: 9, best: 5, good: 1, inaccuracies: 1, mistakes: 1, blunders: 1, passedInstead: 1, playedInstead: 1, otherPlay: 1 };
const final = {
  hands: [[], [5], [6, 7], [8]], current: 1, firstMove: false, lastPlay: null, passes: 0,
  history: [{ player: 0, cards: [0] }], winner: 0,
};
const review = (id: string) => ({
  id, at: 1, title: "VS BOTS · EASY", final, names: ["YOU", "WEST", "NORTH", "EAST"], seats: [1, 2, 3], youSeat: 0, players: [0], scoreAll: true,
});

function rejects(value: unknown) {
  expect(parseBundle(value)).toBeNull();
}

describe("parseBundle", () => {
  it("accepts a valid bundle and fills missing parts", () => {
    expect(parseBundle({ games: [] })).toEqual(emptyBundle());
    const bundle = parseBundle({
      games: [game(1), { ...game(2), analysis }],
      reviews: [review("r1"), { ...review("r2"), youSeat: -1 }],
      puzzles: { "2026-11-01": { cards: [3], label: "Good" } },
      matches: [{ id: "m1", matches: 1, matchWins: 1 }],
      deletedReviews: ["r1"],
    });
    expect(bundle?.games).toHaveLength(2);
    expect(bundle?.reviews).toHaveLength(2);
    expect(bundle?.matches[0].id).toBe("m1");
  });

  it("rejects too many games", () => {
    rejects({ games: Array.from({ length: 501 }, (_, i) => game(i)) });
  });

  it("rejects a bad puzzle day, label or cards", () => {
    rejects({ puzzles: { "1 Nov": { cards: [], label: "Good" } } });
    rejects({ puzzles: { "2026-11-01": { cards: [], label: "Great" } } });
    rejects({ puzzles: { "2026-11-01": { cards: ["3"], label: "Good" } } });
    rejects({ puzzles: { "2026-11-01": { cards: [52], label: "Good" } } });
  });

  it("rejects matchWins above matches", () => {
    rejects({ matches: [{ id: "m1", matches: 1, matchWins: 2 }] });
  });

  it("rejects a game without a time or a review without an id", () => {
    rejects({ games: [{ ...game(1), at: "soon" }] });
    rejects({ reviews: [{ at: 1 }] });
  });

  it("rejects a game time that is not a safe whole number", () => {
    rejects({ games: [game(1.5)] });
    rejects({ games: [game(-1)] });
    rejects({ games: [game(2 ** 60)] });
  });

  it("rejects a game missing the fields the profile reads", () => {
    rejects({ games: [{ at: 5 }] });
    rejects({ games: [{ ...game(1), difficulty: "expert" }] });
    rejects({ games: [{ ...game(1), won: "yes" }] });
    rejects({ games: [{ ...game(1), cardsLeft: 14 }] });
    rejects({ games: [{ ...game(1), plays: [1, "2"] }] });
    rejects({ games: [{ ...game(1), plays: Array(10).fill(0) }] });
    rejects({ games: [{ ...game(1), suits: [0, 0, 0, 0, 0] }] });
    rejects({ games: [{ ...game(1), suits: undefined }] });
    rejects({ games: [{ ...game(1), hints: -1 }] });
    rejects({ games: [{ ...game(1), analysis: "good" }] });
    rejects({ games: [{ ...game(1), analysis: { ...analysis, best: undefined } }] });
  });

  it("rejects a review missing the fields the review screen reads", () => {
    rejects({ reviews: [{ ...review("r1"), at: 1.5 }] });
    rejects({ reviews: [{ ...review("r1"), title: 7 }] });
    rejects({ reviews: [{ ...review("r1"), final: {} }] });
    rejects({ reviews: [{ ...review("r1"), final: { ...final, history: [{ player: 0, cards: "x" }] } }] });
    rejects({ reviews: [{ ...review("r1"), final: { ...final, hands: [[60]] } }] });
    rejects({ reviews: [{ ...review("r1"), names: [1] }] });
    rejects({ reviews: [{ ...review("r1"), seats: ["1"] }] });
    rejects({ reviews: [{ ...review("r1"), youSeat: 4 }] });
    rejects({ reviews: [{ ...review("r1"), players: [9] }] });
    rejects({ reviews: [{ ...review("r1"), scoreAll: 1 }] });
  });

  it("rejects a game or review that is too large", () => {
    rejects({ games: [{ ...game(1), note: "x".repeat(MAX_GAME_BYTES) }] });
    rejects({ reviews: [{ ...review("r1"), final: { ...final, note: "x".repeat(MAX_REVIEW_BYTES) } }] });
  });

  it("rejects a non-object body", () => {
    rejects(null);
    rejects([]);
    rejects("games");
  });
});

describe("sendable", () => {
  it("leaves out only the items the server would refuse", () => {
    const bundle = {
      ...emptyBundle(),
      games: [game(1), game(1.5)],
      reviews: [review("r1"), { ...review("r2"), final: {} }],
      puzzles: { "2026-11-01": { cards: [3], label: "Good" }, "2026-11-02": { cards: [99], label: "Good" } },
    } as unknown as Parameters<typeof sendable>[0];
    const kept = sendable(bundle);
    expect(kept.games.map((g) => g.at)).toEqual([1]);
    expect(kept.reviews.map((r) => r.id)).toEqual(["r1"]);
    expect(Object.keys(kept.puzzles)).toEqual(["2026-11-01"]);
    expect(parseBundle(kept)).not.toBeNull();
  });
});
