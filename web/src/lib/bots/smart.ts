/**
 * Smart heuristic bot (Patwa 2026, Algorithm 2), ported from
 * big2_ai/agents/smart_bot.py. Plays the lowest-scoring move; passes only
 * when the best early reply spends two or more 2s, or the trick is a four of
 * a kind or straight flush.
 */
import { type Card, rank, suit } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import { MoveType, detectMoveType } from "@/lib/engine/moves";

const TWO = 12;
const LOW_ORPHAN_MAX_RANK = 6; // rank 9

type Phase = "early" | "mid" | "late";

export function smartMove(state: GameState, player: number): Card[] {
  const legal = legalMoves(state, player);
  const candidates = legal.filter((m) => m.length > 0);
  if (candidates.length === 0 || legal.length === 1) return legal[0];

  const hand = state.hands[player];
  const phase = handPhase(hand);
  const trick = state.lastPlay?.cards ?? [];
  const trickType = detectMoveType(trick);
  const trickIsBomb = trick.length > 0 && (trickType === MoveType.Quad || trickType === MoveType.StraightFlush);
  const trickVeryStrong = trick.some((c) => rank(c) === TWO);

  let best = candidates[0];
  let bestScore = Infinity;
  for (const move of candidates) {
    const score = scoreMove(move, hand, phase, trickIsBomb, trickVeryStrong);
    if (score < bestScore) {
      best = move;
      bestScore = score;
    }
  }

  const canPass = candidates.length < legal.length;
  const twosUsed = best.filter((c) => rank(c) === TWO).length;
  if (canPass && phase === "early" && twosUsed >= 2 && bestScore > 30) return [];
  if (canPass && trickIsBomb) return [];
  return best;
}

function handPhase(hand: Card[]): Phase {
  if (hand.length > 10) return "early";
  if (hand.length >= 6) return "mid";
  return "late";
}

function scoreMove(cards: Card[], hand: Card[], phase: Phase, trickIsBomb: boolean, trickVeryStrong: boolean): number {
  if (cards.length === hand.length) return -1000;
  const twos = cards.filter((c) => rank(c) === TWO).length;
  let score = 0.8 * cards.reduce((sum, c) => sum + rank(c), 0);
  if (phase === "early") score += 10 * twos;
  else if (phase === "mid") score += 5 * twos;

  const remaining = hand.filter((c) => !cards.includes(c));
  score += breakPenalty(cards, hand, remaining, phase);
  score += 6 * lowOrphans(remaining);
  score -= 4 * cards.length;

  if (phase === "late") {
    score -= 10;
    if (trickVeryStrong) score -= 10;
  }
  if (trickIsBomb) score += 25;
  return score;
}

function countBy(cards: Card[], key: (c: Card) => number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(key(c), (counts.get(key(c)) ?? 0) + 1);
  return counts;
}

function breakPenalty(cards: Card[], hand: Card[], remaining: Card[], phase: Phase): number {
  let penalty = 0;
  const handRanks = countBy(hand, rank);
  const playedRanks = countBy(cards, rank);
  const breaksGroup = [...playedRanks].some(([r, n]) => {
    const inHand = handRanks.get(r) ?? 0;
    return (inHand === 2 || inHand === 3) && n > 0 && n < inHand;
  });
  if (breaksGroup) penalty = { early: 8, mid: 4, late: 0 }[phase];

  if (cards.length !== 5) {
    const after = fiveCardStructures(remaining);
    const lost = [...fiveCardStructures(hand)].some((s) => !after.has(s));
    if (lost) penalty = Math.max(penalty, { early: 20, mid: 8, late: 4 }[phase]);
  }
  return penalty;
}

/** Potential five-card hands still available in these cards. */
function fiveCardStructures(cards: Card[]): Set<string> {
  const ranks = countBy(cards, rank);
  const suits = countBy(cards, suit);
  const structures = new Set<string>();
  for (const [r, n] of ranks) if (n === 4) structures.add(`quad ${r}`);
  for (const [t, n] of ranks) {
    if (n >= 3 && [...ranks].some(([r, m]) => r !== t && m >= 2)) structures.add(`full_house ${t}`);
  }
  for (const [s, n] of suits) if (n >= 5) structures.add(`flush ${s}`);
  for (let low = 0; low < 8; low++) {
    // Windows 3-7 through 10-A; the 2 is excluded.
    if ([0, 1, 2, 3, 4].every((i) => (ranks.get(low + i) ?? 0) > 0)) structures.add(`straight ${low}`);
  }
  return structures;
}

function lowOrphans(cards: Card[]): number {
  return [...countBy(cards, rank)].filter(([r, n]) => n === 1 && r <= LOW_ORPHAN_MAX_RANK).length;
}
