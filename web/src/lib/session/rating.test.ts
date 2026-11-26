import { describe, expect, it } from "vitest";
import type { Difficulty } from "@/lib/bots/bots";
import type { GameRecord } from "./profile";
import { BOT_RATINGS, START_RATING, expectedWin, form, ratingHistory, summariseRating } from "./rating";

const game = (at: number, difficulty: Difficulty, won: boolean, cardsLeft = won ? 0 : 5): GameRecord => ({
  at, difficulty, won, cardsLeft, plays: Array(9).fill(0), suits: [0, 0, 0, 0], hints: 0,
});

describe("expectedWin", () => {
  it("is one in four against bots of your own rating", () => {
    expect(expectedWin(1000, 1000)).toBeCloseTo(0.25);
  });

  it("is higher against weaker bots and lower against stronger ones", () => {
    expect(expectedWin(1000, BOT_RATINGS.easy)).toBeGreaterThan(0.25);
    expect(expectedWin(1000, BOT_RATINGS.hard)).toBeLessThan(0.25);
  });

  it("puts the bot levels where the benchmarks put them", () => {
    // The trained model (hard) wins about 46% against three Smart bots and 56% against three greedy bots.
    expect(expectedWin(BOT_RATINGS.hard, BOT_RATINGS.medium)).toBeCloseTo(0.46, 1);
    expect(expectedWin(BOT_RATINGS.hard, BOT_RATINGS.easy)).toBeCloseTo(0.56, 1);
  });
});

describe("ratingHistory", () => {
  it("starts everyone at the same rating", () => {
    expect(ratingHistory([])).toEqual([]);
    expect(summariseRating([])).toBeNull();
    expect(START_RATING).toBe(1000);
  });

  it("gains more for a win than it loses for a loss at even strength", () => {
    const [win] = ratingHistory([game(1, "medium", true)]);
    const [loss] = ratingHistory([game(1, "medium", false)]);
    expect(win.change).toBe(24);
    expect(loss.change).toBe(-8);
    expect(win.rating).toBe(1024);
  });

  it("rewards a win against harder bots more, and forgives a loss to them more", () => {
    const win = (d: Difficulty) => ratingHistory([game(1, d, true)])[0].change;
    const loss = (d: Difficulty) => ratingHistory([game(1, d, false)])[0].change;
    expect(win("hard")).toBeGreaterThan(win("medium"));
    expect(win("medium")).toBeGreaterThan(win("easy"));
    expect(loss("hard")).toBeGreaterThan(loss("easy"));
  });

  it("plays the games in the order they ended, whatever order they are stored in", () => {
    const records = [game(3, "hard", true), game(1, "easy", false), game(2, "medium", true)];
    expect(ratingHistory(records).map((r) => r.at)).toEqual([1, 2, 3]);
  });

  it("drifts up for a player who wins more than one game in four, and down for one who wins fewer", () => {
    const strong = Array.from({ length: 200 }, (_, i) => game(i, "medium", i % 2 === 0));
    const weak = Array.from({ length: 200 }, (_, i) => game(i, "medium", i % 10 === 0));
    expect(ratingHistory(strong).at(-1)!.rating).toBeGreaterThan(1100);
    expect(ratingHistory(weak).at(-1)!.rating).toBeLessThan(950);
  });
});

describe("summariseRating", () => {
  it("gives the current rating, the last change and the best so far", () => {
    const s = summariseRating([game(1, "medium", true), game(2, "medium", true), game(3, "medium", false)])!;
    expect(s.rating).toBe(s.history.at(-1)!.rating);
    expect(s.change).toBe(s.history.at(-1)!.change);
    expect(s.change).toBeLessThan(0);
    expect(s.best).toBe(s.history[1].rating);
    expect(s.games).toBe(3);
  });

  it("names the strongest bot level at or below the rating", () => {
    expect(summariseRating(Array.from({ length: 20 }, (_, i) => game(i, "hard", true)))!.level).toBe("hard");
    expect(summariseRating(Array.from({ length: 20 }, (_, i) => game(i, "easy", false)))!.level).toBeNull();
  });
});

describe("form", () => {
  it("groups games into tens from the newest back, oldest group first", () => {
    const records = Array.from({ length: 25 }, (_, i) => game(i, "easy", i >= 10, i >= 10 ? 0 : (i % 13) + 1));
    const groups = form(records);
    expect(groups.map((g) => g.games)).toEqual([5, 10, 10]);
    expect(groups[2].winRate).toBe(100);
    expect(groups[2].avgCardsLeftWhenLosing).toBeNull();
    expect(groups[1].winRate).toBe(50);
  });

  it("averages cards left over the lost games only", () => {
    const records = [game(1, "easy", false, 4), game(2, "easy", false, 6), game(3, "easy", true)];
    expect(form(records)).toEqual([{ games: 3, winRate: 33, avgCardsLeftWhenLosing: 5 }]);
  });

  it("keeps at most the last ten groups", () => {
    expect(form(Array.from({ length: 150 }, (_, i) => game(i, "easy", true)))).toHaveLength(10);
    expect(form([])).toEqual([]);
  });
});
