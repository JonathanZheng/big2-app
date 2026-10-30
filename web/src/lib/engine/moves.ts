/** Move types and comparisons, ported from big2_ai/env/move_detector.py. */
import { type Card, rank, suit } from "./cards";

/** Numeric values match the Python MoveType enum (the model's input uses them). */
export enum MoveType {
  Pass = 0,
  Single = 1,
  Pair = 2,
  Triple = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quad = 7,
  StraightFlush = 8,
  Invalid = 9,
}

/**
 * Straight rank sets, lowest to highest (house rules):
 * 3-4-5-6-7 < ... < 10-J-Q-K-A < J-Q-K-A-2 < 2-3-4-5-6 < A-2-3-4-5
 */
export const STRAIGHT_RANKS: number[][] = [
  ...Array.from({ length: 9 }, (_, low) => [low, low + 1, low + 2, low + 3, low + 4]),
  [0, 1, 2, 3, 12],
  [0, 1, 2, 11, 12],
];

const STRAIGHT_KEYS = new Map(STRAIGHT_RANKS.map((ranks, i) => [ranks.join(","), i]));

/** Position of these ranks in STRAIGHT_RANKS, or -1 if they are not a straight. */
export function straightKey(ranks: number[]): number {
  if (ranks.length !== 5) return -1;
  const key = [...ranks].sort((a, b) => a - b).join(",");
  return STRAIGHT_KEYS.get(key) ?? -1;
}

function rankCounts(cards: Card[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(rank(c), (counts.get(rank(c)) ?? 0) + 1);
  return counts;
}

export function detectMoveType(cards: Card[]): MoveType {
  if (cards.length === 0) return MoveType.Pass;
  if (cards.length === 1) return MoveType.Single;
  const counts = rankCounts(cards);
  if (cards.length === 2) return counts.size === 1 ? MoveType.Pair : MoveType.Invalid;
  if (cards.length === 3) return counts.size === 1 ? MoveType.Triple : MoveType.Invalid;
  if (cards.length === 5) {
    const straight = straightKey(cards.map(rank)) >= 0;
    const flush = new Set(cards.map(suit)).size === 1;
    if (straight && flush) return MoveType.StraightFlush;
    if (straight) return MoveType.Straight;
    if (flush) return MoveType.Flush;
    if (counts.size === 2) {
      const sizes = [...counts.values()].sort((a, b) => a - b).join(",");
      if (sizes === "2,3") return MoveType.FullHouse;
      if (sizes === "1,4") return MoveType.Quad;
    }
  }
  return MoveType.Invalid;
}

/** [primary, suit] for comparing moves of the same type; higher beats lower. */
function moveValue(cards: Card[], type: MoveType): [number, number] {
  const top = Math.max(...cards);
  switch (type) {
    case MoveType.Single:
      return [rank(cards[0]), suit(cards[0])];
    case MoveType.Pair:
    case MoveType.Triple:
      return [rank(cards[0]), Math.max(...cards.map(suit))];
    case MoveType.Straight:
    case MoveType.StraightFlush:
      // Straight order, then the suit of the highest card (the 2 when present).
      return [straightKey(cards.map(rank)), suit(top)];
    case MoveType.Flush:
      return [rank(top), suit(top)];
    case MoveType.FullHouse:
    case MoveType.Quad: {
      const need = type === MoveType.FullHouse ? 3 : 4;
      const counts = rankCounts(cards);
      const r = [...counts.entries()].find(([, n]) => n === need)![0];
      return [r, Math.max(...cards.filter((c) => rank(c) === r).map(suit))];
    }
    default:
      return [-1, -1];
  }
}

const FIVE_CARD_ORDER: Partial<Record<MoveType, number>> = {
  [MoveType.Straight]: 1,
  [MoveType.Flush]: 2,
  [MoveType.FullHouse]: 3,
  [MoveType.Quad]: 4,
  [MoveType.StraightFlush]: 5,
};

/** Whether `cards` beats `last`. Anything beats an empty table. */
export function canBeat(cards: Card[], last: Card[]): boolean {
  if (last.length === 0) return true;
  const type = detectMoveType(cards);
  const lastType = detectMoveType(last);
  if (type === MoveType.Invalid || cards.length !== last.length) return false;
  if (cards.length === 5) {
    const a = FIVE_CARD_ORDER[type] ?? 0;
    const b = FIVE_CARD_ORDER[lastType] ?? 0;
    if (a !== b) return a > b;
  } else if (type !== lastType) {
    return false;
  }
  const [p, s] = moveValue(cards, type);
  const [lp, ls] = moveValue(last, lastType);
  return p > lp || (p === lp && s > ls);
}
