/** Game state, ported from big2_ai/env/game.py. States are immutable. */
import type { Card } from "./cards";
import { legalMoves } from "./legal";

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
  /**
   * Cards each seat is known to have played. The board editor knows who played
   * which cards but not the order, so these fill the model's played-by-seat
   * inputs without inventing a move history.
   */
  playedBy?: Card[][];
  /** Cards known to be out of the game with no owner (board setup only). */
  dead?: Card[];
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

/** Small seeded random number generator returning numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffle and deal 13 cards each; the holder of the 3♦ starts. */
export function deal(rng: () => number): GameState {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const hands = [0, 1, 2, 3].map((p) => deck.slice(p * 13, p * 13 + 13).sort((a, b) => a - b));
  return {
    hands,
    current: hands.findIndex((h) => h.includes(0)),
    firstMove: true,
    lastPlay: null,
    passes: 0,
    history: [],
    winner: null,
  };
}

/** Play `cards` (or pass with `[]`) for the current player. Throws on an illegal move. */
export function applyMove(state: GameState, cards: Card[]): GameState {
  if (state.winner !== null) throw new Error("The game is over");
  const player = state.current;
  const move = [...cards].sort((a, b) => a - b);
  const key = move.join(",");
  if (!legalMoves(state, player).some((m) => m.join(",") === key)) {
    throw new Error(`Illegal move for player ${player}: [${key}]`);
  }
  const play: Play = { player, cards: move };
  const next: GameState = {
    ...state,
    current: (player + 1) % 4,
    history: [...state.history, play],
  };
  if (move.length > 0) {
    next.hands = state.hands.map((h, i) => (i === player ? h.filter((c) => !move.includes(c)) : h));
    next.lastPlay = play;
    next.passes = 0;
    next.firstMove = false;
    if (next.hands[player].length === 0) next.winner = player;
  } else {
    next.passes = state.passes + 1;
    // After three passes the trick is over and its player leads.
    if (next.passes >= 3) {
      next.lastPlay = null;
      next.passes = 0;
    }
  }
  return next;
}
