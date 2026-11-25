import { describe, expect, it } from "vitest";
import { smartMove } from "@/lib/bots/smart";
import { type GameState } from "@/lib/engine/game";
import { playMove, startMatch } from "./match";
import { myDecisions, reviewStates } from "./review";

function finishedGame(seed: number): GameState {
  let m = startMatch({ difficulty: "medium", games: 1 }, seed);
  while (m.game.winner === null) m = playMove(m, smartMove(m.game, m.game.current));
  return m.game;
}

describe("reviewStates", () => {
  it("rebuilds every position and ends at the finished game", () => {
    const final = finishedGame(11);
    const states = reviewStates(final);
    expect(states).toHaveLength(final.history.length + 1);
    expect(states[0].hands[states[0].current]).toContain(0);
    states.forEach((state, i) => expect(state.history).toHaveLength(i));

    const last = states[states.length - 1];
    expect(last.hands).toEqual(final.hands);
    expect(last.current).toBe(final.current);
    expect(last.firstMove).toBe(final.firstMove);
    expect(last.lastPlay).toEqual(final.lastPlay);
    expect(last.passes).toBe(final.passes);
    expect(last.winner).toBe(final.winner);
  });

  it("identifies my decisions and the position before each one", () => {
    const final = finishedGame(12);
    const states = reviewStates(final);
    const decisions = myDecisions(final);
    expect(decisions.length).toBeGreaterThan(0);
    for (const decision of decisions) {
      expect(states[decision.step].current).toBe(decision.player);
      expect(final.history[decision.step].player).toBe(0);
      expect(final.history[decision.step].cards).toEqual(decision.cards);
    }
  });
});

describe("reviewStates before any move", () => {
  it("returns just the position when nothing was played", () => {
    const empty: GameState = { hands: [[0], [1], [2], [3]], current: 0, firstMove: true, lastPlay: null, passes: 0, history: [], winner: null };
    expect(reviewStates(empty)).toEqual([empty]);
  });
});

describe("house rules in review", () => {
  const rules = { opening: "any", flush: "suit", pass: "out" } as const;

  function houseGame(seed: number): GameState {
    let m = startMatch({ difficulty: "medium", games: 1, rules }, seed);
    while (m.game.winner === null) m = playMove(m, smartMove(m.game, m.game.current));
    return m.game;
  }

  it("rebuilds a house rules game, automatic passes included, and keeps its rules", () => {
    for (const seed of [21, 22, 23]) {
      const final = houseGame(seed);
      const states = reviewStates(final);
      expect(states[0].rules).toEqual(rules);
      expect(states.at(-1)!.hands).toEqual(final.hands);
      expect(states.at(-1)!.winner).toBe(final.winner);
    }
  });

  it("leaves automatic passes out of my decisions", () => {
    const finals = [21, 22, 23, 24, 25].map(houseGame);
    let skipped = 0;
    for (const final of finals) {
      const states = reviewStates(final);
      const steps = new Set(myDecisions(final, [0, 1, 2, 3]).map((d) => d.step));
      final.history.forEach((play, i) => {
        if (steps.has(i)) return;
        // Every move left out is a pass the player had no choice about.
        expect(play.cards).toEqual([]);
        expect(states[i].current).toBe(play.player);
        skipped += 1;
      });
    }
    expect(skipped).toBeGreaterThan(0);
  });
});
