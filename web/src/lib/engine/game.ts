/** Game state, ported from big2_ai/env/game.py. States are immutable. */
import type { Card } from "./cards";

/** One turn: the cards played, or an empty list for a pass. */
export interface Play {
  player: number;
  cards: Card[];
}

export interface GameState {
  hands: Card[][];
  current: number;
  firstMove: boolean;
  lastPlay: Play | null;
  passes: number;
  history: Play[];
  winner: number | null;
}

/** A position exported by scripts/export_web_fixtures.py. */
export interface Fixture {
  hands: Card[][];
  current: number;
  firstMove: boolean;
  lastPlay: Play | null;
  passes: number;
  history: Play[];
  legal: Card[][];
  stateOnes: number[];
  scores: number[];
  greedy: Card[];
  smart: Card[];
}

export function stateFromFixture(f: Fixture): GameState {
  return {
    hands: f.hands.map((h) => [...h]),
    current: f.current,
    firstMove: f.firstMove,
    lastPlay: f.lastPlay,
    passes: f.passes,
    history: f.history,
    winner: null,
  };
}
