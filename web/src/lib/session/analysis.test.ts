import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/engine/cards";
import { type GameState, applyMove, deal, mulberry32 } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import { type GameAnalysis, analyseGame, summariseAnalyses } from "./analysis";

/** Play a whole game where every seat plays its first legal non-pass move (or passes). */
function finishedGame(seed: number): GameState {
  let state = deal(mulberry32(seed));
  while (state.winner === null) {
    const legal = legalMoves(state, state.current);
    state = applyMove(state, legal.find((m) => m.length > 0) ?? []);
  }
  return state;
}

describe("analyseGame", () => {
  it("labels every decision of the seat and sorts slips by kind", async () => {
    const game = finishedGame(4);
    // A scorer that always prefers passing, then fewer cards.
    const score = async (state: GameState, player: number) => {
      const moves = legalMoves(state, player);
      return { moves, scores: Float32Array.from(moves.map((m: Card[]) => (m.length === 0 ? 1 : -0.2 * m.length))) };
    };
    const a = await analyseGame(game, 0, score);
    const decisions = game.history.filter((p) => p.player === 0).length;
    expect(a.moves).toBe(decisions);
    expect(a.best + a.good + a.inaccuracies + a.mistakes + a.blunders).toBe(decisions);
    // Every first-legal play when a pass was available counts as playing instead of passing.
    expect(a.playedInstead).toBeGreaterThan(0);
    expect(a.passedInstead).toBe(0);
  });
});

describe("summariseAnalyses", () => {
  const a = (over: Partial<GameAnalysis>): GameAnalysis => ({
    moves: 10, best: 6, good: 2, inaccuracies: 1, mistakes: 1, blunders: 0,
    passedInstead: 0, playedInstead: 1, otherPlay: 1, ...over,
  });

  it("returns nothing when no game has been analysed", () => {
    expect(summariseAnalyses([])).toBeNull();
  });

  it("averages slips per game, counts top-choice moves and finds the commonest slip", () => {
    const s = summariseAnalyses([a({}), a({ blunders: 2, mistakes: 0, passedInstead: 3, playedInstead: 0, otherPlay: 0 })])!;
    expect(s).toMatchObject({ games: 2, moves: 20, best: 12, perGame: { inaccuracies: 1, mistakes: 0.5, blunders: 1 } });
    expect(s.commonestSlip).toBe("passedInstead");
    expect(s.recentSlips).toEqual([2, 3]);
  });
});
