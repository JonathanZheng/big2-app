import type { Card } from "./cards";
import type { GameState } from "./game";
import { MoveType, canBeat, detectMoveType } from "./moves";

/** Pass first, then by number of cards, then by the sorted card numbers. */
export function canonicalOrder(moves: Card[][]): Card[][] {
  return moves
    .map((m) => [...m].sort((a, b) => a - b))
    .sort((a, b) => a.length - b.length || compareCards(a, b));
}

function compareCards(a: Card[], b: Card[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function subsets(cards: Card[], size: number, start = 0, picked: Card[] = [], out: Card[][] = []): Card[][] {
  if (picked.length === size) {
    out.push([...picked]);
    return out;
  }
  for (let i = start; i <= cards.length - (size - picked.length); i++) {
    picked.push(cards[i]);
    subsets(cards, size, i + 1, picked, out);
    picked.pop();
  }
  return out;
}

/**
 * Every legal move for `player`, in canonical order. A pass is `[]`.
 * Enumerates all subsets of size 1, 2, 3 and 5 (at most 1,664 for 13 cards).
 */
export function legalMoves(state: GameState, player: number): Card[][] {
  const hand = [...state.hands[player]].sort((a, b) => a - b);
  const last = state.lastPlay?.cards ?? [];
  const moves: Card[][] = last.length > 0 ? [[]] : [];
  const sizes = last.length > 0 ? [last.length] : [1, 2, 3, 5];
  for (const size of sizes) {
    for (const move of subsets(hand, size)) {
      if (detectMoveType(move) === MoveType.Invalid) continue;
      if (state.firstMove && !move.includes(0)) continue;
      if (canBeat(move, last)) moves.push(move);
    }
  }
  return canonicalOrder(moves);
}
