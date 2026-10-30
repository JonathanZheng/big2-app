import { describe, expect, it } from "vitest";
import { smartMove } from "@/lib/bots/smart";
import {
  type MatchState, endMatch, humanSeats, isBotSeat, matchWinners, nextGame, playMove, seatNames, startMatch,
} from "./match";

function finishGame(m: MatchState): MatchState {
  while (m.game.winner === null) m = playMove(m, smartMove(m.game, m.game.current));
  return m;
}

describe("matches", () => {
  it("counts wins per seat and ends after the set number of games", () => {
    let m = startMatch({ difficulty: "medium", games: 3 }, 7);
    for (let g = 0; g < 3; g++) {
      expect(m.over).toBe(false);
      expect(m.game.hands[m.game.current]).toContain(0);
      m = finishGame(m);
      if (g < 2) m = nextGame(m);
    }
    expect(m.over).toBe(true);
    expect(m.wins.reduce((a, b) => a + b, 0)).toBe(3);
    expect(() => nextGame(m)).toThrow();
  });

  it("treats a single game as a one-game match", () => {
    const m = finishGame(startMatch({ difficulty: "easy", games: 1 }, 1));
    expect(m.over).toBe(true);
    expect(m.wins[m.game.winner!]).toBe(1);
  });

  it("can be ended early", () => {
    const m = endMatch(finishGame(startMatch({ difficulty: "easy", games: 5 }, 2)));
    expect(m.over).toBe(true);
  });

  it("returns every seat tied on the most wins", () => {
    const m = startMatch({ difficulty: "easy", games: 5 }, 3);
    expect(matchWinners({ ...m, wins: [2, 0, 2, 1] })).toEqual([0, 2]);
    expect(matchWinners({ ...m, wins: [0, 3, 1, 1] })).toEqual([1]);
  });

  it("rejects moves after the game is won and a new game before it ends", () => {
    const start = startMatch({ difficulty: "easy", games: 3 }, 4);
    expect(() => nextGame(start)).toThrow();
    const done = finishGame(start);
    expect(() => playMove(done, [])).toThrow();
  });

  it("deals a different game each time", () => {
    const first = finishGame(startMatch({ difficulty: "easy", games: 3 }, 5));
    expect(nextGame(first).game.hands).not.toEqual(startMatch({ difficulty: "easy", games: 3 }, 5).game.hands);
  });
});

describe("one device seats", () => {
  it("uses one human and three bots by default", () => {
    const config = { difficulty: "easy" as const, games: 1 as const };
    expect(humanSeats(config)).toEqual([0]);
    expect([0, 1, 2, 3].map((seat) => isBotSeat(config, seat))).toEqual([false, true, true, true]);
    expect(seatNames(config)).toEqual(["You", "West", "North", "East"]);
  });

  it("puts two or three people in the first seats and bots in the rest", () => {
    const three = { difficulty: "medium" as const, games: 5 as const, mode: "friends" as const, humans: 3 };
    expect(humanSeats(three)).toEqual([0, 1, 2]);
    expect(isBotSeat(three, 2)).toBe(false);
    expect(isBotSeat(three, 3)).toBe(true);
    expect(seatNames(three)).toEqual(["Player 1", "Player 2", "Player 3", "Bot 1"]);

    const four = { ...three, humans: 4 };
    expect([0, 1, 2, 3].map((seat) => isBotSeat(four, seat))).toEqual([false, false, false, false]);
    expect(seatNames(four)).toEqual(["Player 1", "Player 2", "Player 3", "Player 4"]);
  });
});
