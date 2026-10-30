import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/positions.json";
import { parseCards } from "./cards";
import { type Fixture, type GameState, applyMove, deal, mulberry32 } from "./game";
import { legalMoves } from "./legal";

const positions = fixtures as Fixture[];

describe("deal", () => {
  it("deals 13 cards each, every card once, and the 3♦ holder starts", () => {
    const state = deal(mulberry32(1));
    expect(state.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    expect(state.hands.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));
    expect(state.hands[state.current]).toContain(0);
    expect(state.firstMove).toBe(true);
  });

  it("deals differently for different seeds and the same for the same seed", () => {
    expect(deal(mulberry32(1)).hands).toEqual(deal(mulberry32(1)).hands);
    expect(deal(mulberry32(1)).hands).not.toEqual(deal(mulberry32(2)).hands);
  });
});

function position(hands: string[], current: number): GameState {
  return {
    hands: hands.map((h) => parseCards(h).sort((a, b) => a - b)),
    current,
    firstMove: false,
    lastPlay: null,
    passes: 0,
    history: [],
    winner: null,
  };
}

describe("applyMove", () => {
  it("gives the lead back to the player whose move everyone passed", () => {
    let s = position(["5d 9c", "6d 7c", "8d 8c", "Kd Kc"], 0);
    s = applyMove(s, parseCards("5d"));
    s = applyMove(s, []);
    s = applyMove(s, []);
    s = applyMove(s, []);
    expect(s.current).toBe(0);
    expect(s.lastPlay).toBeNull();
    expect(s.passes).toBe(0);
    expect(legalMoves(s, 0)).not.toContainEqual([]);
  });

  it("ends the game when a player plays their last card", () => {
    let s = position(["5d", "6d 7c", "8d 8c", "Kd Kc"], 0);
    s = applyMove(s, parseCards("5d"));
    expect(s.winner).toBe(0);
    expect(() => applyMove(s, [])).toThrow();
  });

  it("rejects illegal moves", () => {
    const s = position(["5d 9c", "6d 7c", "8d 8c", "Kd Kc"], 0);
    expect(() => applyMove(s, parseCards("6d"))).toThrow();
    expect(() => applyMove(s, [])).toThrow();
    expect(() => applyMove(s, parseCards("5d 9c"))).toThrow();
  });

  it("does not change the state it was given", () => {
    const s = position(["5d 9c", "6d 7c", "8d 8c", "Kd Kc"], 0);
    applyMove(s, parseCards("5d"));
    expect(s.hands[0]).toEqual(parseCards("5d 9c"));
    expect(s.history).toEqual([]);
  });

  it("replays each fixture's history to the same position as Python", () => {
    for (const f of positions) {
      const start = f.hands.map((h) => [...h]);
      for (const play of f.history) start[play.player].push(...play.cards);
      const first = start.findIndex((h) => h.includes(0));
      let s: GameState = {
        hands: start.map((h) => h.sort((a, b) => a - b)),
        current: first,
        firstMove: true,
        lastPlay: null,
        passes: 0,
        history: [],
        winner: null,
      };
      for (const play of f.history) s = applyMove(s, play.cards);
      expect(s.hands).toEqual(f.hands);
      expect(s.current).toBe(f.current);
      expect(s.lastPlay).toEqual(f.lastPlay);
      expect(s.passes).toBe(f.passes);
      expect(s.firstMove).toBe(f.firstMove);
    }
  });
});
