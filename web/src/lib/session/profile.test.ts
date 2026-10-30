import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCards } from "@/lib/engine/cards";
import type { GameState, Play } from "@/lib/engine/game";
import { MoveType } from "@/lib/engine/moves";
import { type GameRecord, clearProfile, gameRecord, readGameRecords, saveGameRecord, summarise } from "./profile";

const play = (player: number, cards: string): Play => ({ player, cards: cards ? parseCards(cards) : [] });

function finished(history: Play[], myCardsLeft: number, winner: number): GameState {
  return {
    hands: [Array(myCardsLeft).fill(0), [], [], []],
    current: 0, firstMove: false, lastPlay: null, passes: 0, history, winner,
  };
}

const record = (won: boolean, extra: Partial<GameRecord> = {}): GameRecord => ({
  at: 1, difficulty: "medium", won, cardsLeft: won ? 0 : 5,
  plays: [0, 0, 0, 0, 0, 0, 0, 0, 0], suits: [0, 0, 0, 0], hints: 0, ...extra,
});

describe("gameRecord", () => {
  it("counts my move types, passes and the suits of the cards I played", () => {
    const history = [
      play(0, "3d"), play(1, "5c"), play(2, ""), play(3, ""),
      play(0, ""), play(1, "4d 4c"), play(2, ""), play(3, ""), play(0, "9h 9s"),
      play(0, "3c 4h 5s 6d 7c"),
    ];
    const r = gameRecord(finished(history, 3, 1), 0, "hard", 2, 99);
    expect(r).toMatchObject({ at: 99, difficulty: "hard", won: false, cardsLeft: 3, hints: 2 });
    expect(r.plays[MoveType.Pass]).toBe(1);
    expect(r.plays[MoveType.Single]).toBe(1);
    expect(r.plays[MoveType.Pair]).toBe(1);
    expect(r.plays[MoveType.Straight]).toBe(1);
    expect(r.suits).toEqual([2, 2, 2, 2]); // ♦ 3d 6d, ♣ 3c 7c, ♥ 9h 4h, ♠ 9s 5s
  });
});

describe("summarise", () => {
  it("returns empty figures when there are no games", () => {
    const p = summarise([]);
    expect(p.games).toBe(0);
    expect(p.favouriteSuit).toBeNull();
    expect(p.favouriteCombo).toBeNull();
    expect(p.avgCardsLeftWhenLosing).toBeNull();
    expect(p.hintsPerGame).toBeNull();
  });

  it("counts wins by difficulty and the current and best win streaks", () => {
    const records = [record(true), record(true), record(true), record(false), record(true, { difficulty: "easy" }),
      record(true, { difficulty: "hard" })];
    const p = summarise(records);
    expect(p).toMatchObject({ games: 6, wins: 5, currentStreak: 2, bestStreak: 3 });
    expect(p.byDifficulty).toEqual({ easy: { games: 1, wins: 1 }, medium: { games: 4, wins: 3 }, hard: { games: 1, wins: 1 } });
  });

  it("finds the favourite suit and combo, and averages cards left in losses and hints per game", () => {
    const plays = [0, 3, 5, 1, 0, 0, 0, 0, 0];
    const p = summarise([
      record(false, { cardsLeft: 4, suits: [1, 6, 2, 0], plays, hints: 1 }),
      record(false, { cardsLeft: 7, suits: [0, 1, 0, 0], plays, hints: 2 }),
      record(true, { suits: [0, 0, 3, 0], plays, hints: 0 }),
    ]);
    expect(p.suits).toEqual([1, 7, 5, 0]);
    expect(p.favouriteSuit).toBe(1);
    expect(p.combos[MoveType.Pair]).toBe(15);
    expect(p.favouriteCombo).toBe(MoveType.Pair);
    expect(p.avgCardsLeftWhenLosing).toBe(5.5);
    expect(p.hintsPerGame).toBe(1);
  });

  it("lists the ten most recent games, newest first", () => {
    const records = Array.from({ length: 12 }, (_, i) => record(i % 2 === 0, { at: i }));
    expect(summarise(records).recent.map((r) => r.at)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });
});

describe("storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves records, keeps the newest 500, and clears them", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
    for (let i = 0; i < 505; i++) saveGameRecord(record(true, { at: i }));
    const saved = readGameRecords();
    expect(saved.length).toBe(500);
    expect(saved[0].at).toBe(5);
    clearProfile();
    expect(readGameRecords()).toEqual([]);
  });

  it("reads nothing and does not throw when storage is blocked or corrupt", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "not json",
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(readGameRecords()).toEqual([]);
    expect(() => saveGameRecord(record(true))).not.toThrow();
    expect(() => clearProfile()).not.toThrow();
  });
});
