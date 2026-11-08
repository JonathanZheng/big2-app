import { describe, expect, it } from "vitest";
import { emptyBundle } from "./merge";
import { parseBundle } from "./validate";

const game = (at: number) => ({ at, difficulty: "easy", won: true, cardsLeft: 0, plays: [], suits: [0, 0, 0, 0], hints: 0 });

function rejects(value: unknown) {
  expect(parseBundle(value)).toBeNull();
}

describe("parseBundle", () => {
  it("accepts a valid bundle and fills missing parts", () => {
    expect(parseBundle({ games: [] })).toEqual(emptyBundle());
    const bundle = parseBundle({
      games: [game(1)],
      puzzles: { "2026-11-01": { cards: [3], label: "Good" } },
      matches: [{ id: "m1", matches: 1, matchWins: 1 }],
      deletedReviews: ["r1"],
    });
    expect(bundle?.games).toHaveLength(1);
    expect(bundle?.matches[0].id).toBe("m1");
  });

  it("rejects too many games", () => {
    rejects({ games: Array.from({ length: 501 }, (_, i) => game(i)) });
  });

  it("rejects a bad puzzle day or label", () => {
    rejects({ puzzles: { "1 Nov": { cards: [], label: "Good" } } });
    rejects({ puzzles: { "2026-11-01": { cards: [], label: "Great" } } });
  });

  it("rejects matchWins above matches", () => {
    rejects({ matches: [{ id: "m1", matches: 1, matchWins: 2 }] });
  });

  it("rejects a game without a time or a review without an id", () => {
    rejects({ games: [{ ...game(1), at: "soon" }] });
    rejects({ reviews: [{ at: 1 }] });
  });

  it("rejects a non-object body", () => {
    rejects(null);
    rejects([]);
    rejects("games");
  });
});
