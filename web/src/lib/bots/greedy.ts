/** Greedy bot with simple heuristics, ported from big2_ai/agents/greedy_bot.py. */
import { type Card, rank, suit } from "@/lib/engine/cards";
import type { GameState, Play } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import { MoveType, detectMoveType } from "@/lib/engine/moves";

interface HandAnalysis {
  pairs: Set<number>;
  triples: Set<number>;
  straights: Card[][];
  flushes: Card[][];
}

interface Situation {
  handSize: number;
  minOpponentCards: number;
  lastPlay: Play | null;
}

export function greedyMove(state: GameState, player: number): Card[] {
  const legal = legalMoves(state, player);
  if (legal.length === 1) return legal[0];

  const others = [0, 1, 2, 3].filter((p) => p !== player).map((p) => state.hands[p].length);
  const situation: Situation = {
    handSize: state.hands[player].length,
    minOpponentCards: Math.min(...others),
    lastPlay: state.lastPlay,
  };
  const analysis = analyseHand(state.hands[player]);

  const canPass = legal.some((m) => m.length === 0);
  if (canPass && shouldPass(legal, situation, analysis)) return [];

  const plays = legal.filter((m) => m.length > 0);
  if (plays.length === 0) return [];
  let best = plays[0];
  let bestScore = -Infinity;
  for (const move of plays) {
    const score = scoreMove(move, analysis, situation);
    if (score > bestScore) {
      best = move;
      bestScore = score;
    }
  }
  return best;
}

function combinations(cards: Card[], size: number): Card[][] {
  const out: Card[][] = [];
  const pick = (start: number, picked: Card[]) => {
    if (picked.length === size) {
      out.push([...picked]);
      return;
    }
    for (let i = start; i < cards.length; i++) pick(i + 1, [...picked, cards[i]]);
  };
  pick(0, []);
  return out;
}

function analyseHand(hand: Card[]): HandAnalysis {
  const counts = new Map<number, number>();
  for (const c of hand) counts.set(rank(c), (counts.get(rank(c)) ?? 0) + 1);
  const withCount = (n: number) => new Set([...counts].filter(([, m]) => m === n).map(([r]) => r));
  const straights = combinations(hand, 5).filter((combo) => {
    // Plain consecutive ranks only, as in the Python bot.
    const ranks = combo.map(rank).sort((a, b) => a - b);
    return ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1);
  });
  const flushes: Card[][] = [];
  for (let s = 0; s < 4; s++) {
    const ofSuit = hand.filter((c) => suit(c) === s);
    if (ofSuit.length >= 5) flushes.push(...combinations(ofSuit, 5));
  }
  return { pairs: withCount(2), triples: withCount(3), straights, flushes };
}

const TYPE_STRENGTH: Partial<Record<MoveType, number>> = {
  [MoveType.Single]: 0.2,
  [MoveType.Pair]: 0.3,
  [MoveType.Triple]: 0.4,
  [MoveType.Straight]: 0.5,
  [MoveType.Flush]: 0.6,
  [MoveType.FullHouse]: 0.7,
  [MoveType.Quad]: 0.8,
  [MoveType.StraightFlush]: 0.9,
};

/** Strength of the move on the table, 0 (weak) to 1 (very strong). */
function lastMoveStrength(situation: Situation): number {
  const last = situation.lastPlay;
  if (!last || last.cards.length === 0) return 0;
  const typeStrength = TYPE_STRENGTH[detectMoveType(last.cards)] ?? 0;
  const avgRank = last.cards.reduce((sum, c) => sum + rank(c), 0) / last.cards.length;
  return 0.7 * typeStrength + 0.3 * (avgRank / 12);
}

function breaksCombination(move: Card[], analysis: HandAnalysis): boolean {
  if (move.length === 0) return false;
  const type = detectMoveType(move);
  const r = rank(move[0]);
  if (type === MoveType.Single) {
    if (analysis.pairs.has(r) || analysis.triples.has(r)) return true;
    if (analysis.straights.some((s) => s.some((c) => move.includes(c)))) return true;
    if (analysis.flushes.some((f) => f.some((c) => move.includes(c)))) return true;
  }
  if (type === MoveType.Pair && analysis.triples.has(r)) return true;
  return false;
}

const maxRank = (move: Card[]) => (move.length === 0 ? -1 : Math.max(...move.map(rank)));

function scoreMove(move: Card[], analysis: HandAnalysis, situation: Situation): number {
  const type = detectMoveType(move);
  const avgRank = move.reduce((sum, c) => sum + rank(c), 0) / move.length;
  let score = (12 - avgRank) * 15;
  if (breaksCombination(move, analysis)) score -= 15;
  score += move.length * 3;
  if (situation.handSize <= 3) score += 50;
  if (move.some((c) => rank(c) >= 10) && lastMoveStrength(situation) < 0.5) score -= 10;
  if (move.length === 5) score += 20;
  if (situation.minOpponentCards <= 2) score += 25;
  return score;
}

function shouldPass(legal: Card[][], situation: Situation, analysis: HandAnalysis): boolean {
  if (situation.handSize <= 2) return false;
  const plays = legal.filter((m) => m.length > 0);
  if (plays.some((m) => m.length === situation.handSize)) return false;

  if (situation.minOpponentCards <= 2 && plays.length > 0) {
    let highest = plays[0];
    for (const m of plays) if (maxRank(m) > maxRank(highest)) highest = m;
    if (maxRank(highest) < 9) return true;
  }

  const strength = lastMoveStrength(situation);
  if (strength > 0.75 && plays.some((m) => breaksCombination(m, analysis))) return true;
  if (situation.handSize > 9 && strength > 0.55) return true;
  return false;
}
