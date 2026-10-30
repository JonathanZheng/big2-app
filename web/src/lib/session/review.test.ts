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
