/**
 * The model's input, ported from big2_ai/env/selfplay_encoding.py.
 *
 * State (566), from `player`'s point of view, every value 0 or 1:
 * hand (52), unseen cards (52), cards played by next/across/previous (3 x 52),
 * trick to beat (52), who played it relative to me (4), passes since (3),
 * each opponent's card count one-hot 1 to 13 (3 x 13), last 4 moves (4 x 52).
 */
import type { Card } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import { detectMoveType } from "@/lib/engine/moves";

export const STATE_DIM = 566;
export const MOVE_DIM = 61;
const RECENT_MOVES = 4;

const HAND = 0;
const UNSEEN = 52;
const PLAYED = 104;
const TRICK = 260;
const TRICK_OWNER = 312;
const PASSES = 316;
const COUNTS = 319;
const RECENT = 358;

const relative = (other: number, player: number) => (((other - player) % 4) + 4) % 4;

export function encodeState(state: GameState, player: number): Float32Array {
  const x = new Float32Array(STATE_DIM);
  const seen = new Uint8Array(52);
  for (const c of state.hands[player]) {
    x[HAND + c] = 1;
    seen[c] = 1;
  }
  for (const play of state.history) {
    const rel = relative(play.player, player);
    for (const c of play.cards) {
      seen[c] = 1;
      if (rel > 0) x[PLAYED + (rel - 1) * 52 + c] = 1;
    }
  }
  // Board setup knows who played some cards but not when they were played.
  (state.playedBy ?? []).forEach((cards, seat) => {
    const rel = relative(seat, player);
    for (const c of cards) {
      seen[c] = 1;
      if (rel > 0) x[PLAYED + (rel - 1) * 52 + c] = 1;
    }
  });
  for (const c of state.dead ?? []) seen[c] = 1;
  for (let c = 0; c < 52; c++) x[UNSEEN + c] = 1 - seen[c];

  if (state.lastPlay) {
    for (const c of state.lastPlay.cards) x[TRICK + c] = 1;
    x[TRICK_OWNER + relative(state.lastPlay.player, player)] = 1;
    x[PASSES + state.passes] = 1;
  }

  for (let rel = 1; rel < 4; rel++) {
    const count = state.hands[(player + rel) % 4].length;
    if (count > 0) x[COUNTS + (rel - 1) * 13 + count - 1] = 1;
  }

  const recent = state.history.slice(-RECENT_MOVES);
  const offset = RECENT_MOVES - recent.length;
  recent.forEach((play, i) => {
    for (const c of play.cards) x[RECENT + (offset + i) * 52 + c] = 1;
  });
  return x;
}

/** Indices of the 1s in a move's 61-number encoding: its cards, then 52 + its type. */
export function moveFeatures(cards: Card[]): number[] {
  return [...cards, 52 + detectMoveType(cards)];
}
