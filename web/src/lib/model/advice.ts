/**
 * Chess-style advice from model scores. Win chances are internal only and
 * never shown: the app shows an evaluation number and move labels.
 */
import type { Card } from "@/lib/engine/cards";

/** (score, chance the player wins) measured on 600 v1 self-play games; retained for v2 pending recalibration. */
const CALIBRATION: [number, number][] = [
  [-1.0, 0.013], [-0.7, 0.092], [-0.5, 0.188], [-0.3, 0.304], [-0.1, 0.435],
  [0.1, 0.542], [0.3, 0.614], [0.5, 0.792], [0.8, 0.952],
];

/** Drops in win chance against the best move, for Good, Inaccuracy and Mistake. */
const CUTOFFS = { good: 0.02, inaccuracy: 0.05, mistake: 0.12 };

export type Label = "Best" | "Good" | "Inaccuracy" | "Mistake" | "Blunder";

export interface Advice {
  cards: Card[];
  label: Label;
  evaluation: number | null;
}

export function winChance(score: number): number {
  const first = CALIBRATION[0];
  const last = CALIBRATION[CALIBRATION.length - 1];
  let p: number;
  if (score <= first[0]) p = first[1];
  else if (score >= last[0]) p = last[1];
  else {
    const i = CALIBRATION.findIndex(([s]) => s >= score);
    const [s0, p0] = CALIBRATION[i - 1];
    const [s1, p1] = CALIBRATION[i];
    p = p0 + ((score - s0) / (s1 - s0)) * (p1 - p0);
  }
  return Math.min(0.99, Math.max(0.01, p));
}

const logit = (p: number) => Math.log(p / (1 - p));

/** 0 is even (a 1 in 4 chance); about +0.7 is a small edge; about +6 is close to decided. */
export function evaluation(score: number): number {
  const value = 1.5 * (logit(winChance(score)) - logit(0.25));
  return Math.round(Math.max(-9.9, Math.min(9.9, value)) * 10) / 10;
}

export function labelMoves(scores: Float32Array): Label[] {
  const best = winChance(Math.max(...scores));
  return [...scores].map((s) => {
    const drop = best - winChance(s);
    if (drop <= 0) return "Best";
    if (drop < CUTOFFS.good) return "Good";
    if (drop < CUTOFFS.inaccuracy) return "Inaccuracy";
    if (drop < CUTOFFS.mistake) return "Mistake";
    return "Blunder";
  });
}

/** Every option, best first. Only the top three show an evaluation number. */
export function rankAdvice(moves: Card[][], scores: Float32Array): Advice[] {
  const labels = labelMoves(scores);
  return moves
    .map((cards, i) => ({ cards, label: labels[i], score: scores[i] }))
    .sort((a, b) => b.score - a.score)
    .map(({ cards, label, score }, rank) => ({ cards, label, evaluation: rank < 3 ? evaluation(score) : null }));
}
