import { describe, expect, it } from "vitest";
import { greedyMove } from "@/lib/bots/greedy";
import { type GameState, applyMove, deal, mulberry32 } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import {
  TAKEOVER_AFTER_MS, type Seat, autoMove, canTakeOver, joinState, nextDeadline, roomCode, runBots, splitState, statsDelta,
} from "./room-logic";

const seat = (n: number, over: Partial<Seat> = {}): Seat => ({
  seat: n, userId: `u${n}`, displayName: `P${n}`, bot: false, lastSeen: 0, ...over,
});
const bot = async (state: GameState, player: number) => greedyMove(state, player);

describe("splitState and joinState", () => {
  it("keeps hands out of the public part and rebuilds the same state", () => {
    let state = deal(mulberry32(3));
    state = applyMove(state, legalMoves(state, state.current)[0]);
    const { publicGame, hands } = splitState(state, null);
    expect(JSON.stringify(publicGame)).not.toContain("hands");
    expect(publicGame.counts).toEqual(state.hands.map((h) => h.length));
    expect(joinState(publicGame, hands)).toEqual(state);
  });
});

describe("runBots", () => {
  it("plays bot seats until a person is to move", async () => {
    const seats = [seat(0), seat(1, { bot: true }), seat(2, { bot: true }), seat(3, { bot: true })];
    let state = deal(mulberry32(8));
    state = await runBots(state, seats, bot);
    expect(state.winner !== null || state.current === 0).toBe(true);
  });

  it("does nothing when a person is to move", async () => {
    const state = deal(mulberry32(8));
    const seats = [0, 1, 2, 3].map((n) => seat(n));
    expect(await runBots(state, seats, bot)).toBe(state);
  });

  it("finishes the game when every seat is a bot", async () => {
    const seats = [0, 1, 2, 3].map((n) => seat(n, { bot: true }));
    expect((await runBots(deal(mulberry32(2)), seats, bot)).winner).not.toBeNull();
  });
});

describe("turn timer", () => {
  it("sets a deadline only on a person's turn when the room has a timer", () => {
    const state = deal(mulberry32(1));
    const people = [0, 1, 2, 3].map((n) => seat(n));
    expect(nextDeadline(state, people, 30, 1000)).toBe(31_000);
    expect(nextDeadline(state, people, null, 1000)).toBeNull();
    const bots = people.map((s) => ({ ...s, bot: true }));
    expect(nextDeadline(state, bots, 30, 1000)).toBeNull();
  });

  it("passes when it can and otherwise plays the lowest legal move", () => {
    let state = deal(mulberry32(5));
    const opening = autoMove(state);
    expect(opening).toContain(0); // the first move must hold the 3♦
    state = applyMove(state, opening);
    expect(autoMove(state)).toEqual([]);
  });
});

describe("canTakeOver", () => {
  it("allows handing a seat to a bot after a minute without contact", () => {
    const now = 1_000_000;
    expect(canTakeOver(seat(1, { lastSeen: now - TAKEOVER_AFTER_MS - 1 }), now)).toBe(true);
    expect(canTakeOver(seat(1, { lastSeen: now - 1000 }), now)).toBe(false);
    expect(canTakeOver(seat(1, { bot: true, lastSeen: 0 }), now)).toBe(false);
    expect(canTakeOver(seat(1, { userId: null, lastSeen: 0 }), now)).toBe(false);
  });
});

describe("roomCode", () => {
  it("makes six characters without easily confused letters", () => {
    const code = roomCode(mulberry32(9));
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(roomCode(mulberry32(9))).toBe(code);
  });
});

describe("statsDelta", () => {
  const seats = [seat(0), seat(1), seat(2, { userId: null, bot: true }), seat(3, { bot: true })];

  it("counts a finished game for every person who sat in the room", () => {
    const delta = statsDelta(seats, 1, null);
    expect(delta).toEqual([
      { userId: "u0", games: 1, wins: 0, matches: 0, matchWins: 0 },
      { userId: "u1", games: 1, wins: 1, matches: 0, matchWins: 0 },
      { userId: "u3", games: 1, wins: 0, matches: 0, matchWins: 0 },
    ]);
  });

  it("adds the match when it ends, with every tied winner", () => {
    const delta = statsDelta(seats, 0, [0, 3]);
    expect(delta.map((d) => [d.userId, d.matches, d.matchWins])).toEqual([["u0", 1, 1], ["u1", 1, 0], ["u3", 1, 1]]);
  });
});
