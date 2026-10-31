/**
 * How one player's moves in a finished game compare with the bot's choices,
 * and a summary across games for the profile page.
 */
import type { Card } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import { labelMoves } from "@/lib/model/advice";
import type { Scored } from "@/lib/model/client";
import { reviewStates } from "./review";

export interface GameAnalysis {
  moves: number;
  best: number;
  good: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  /** Slips (inaccuracy or worse) where you passed but the bot would have played. */
  passedInstead: number;
  /** Slips where you played but the bot would have passed. */
  playedInstead: number;
  /** Slips where you played something other than the bot's play. */
  otherPlay: number;
}

export type SlipKind = "passedInstead" | "playedInstead" | "otherPlay";

const key = (cards: Card[]) => [...cards].sort((a, b) => a - b).join(",");

export async function analyseGame(
  final: GameState,
  seat: number,
  score: (state: GameState, player: number) => Promise<Scored>,
): Promise<GameAnalysis> {
  const a: GameAnalysis = {
    moves: 0, best: 0, good: 0, inaccuracies: 0, mistakes: 0, blunders: 0,
    passedInstead: 0, playedInstead: 0, otherPlay: 0,
  };
  const states = reviewStates(final);
  for (const [i, play] of final.history.entries()) {
    if (play.player !== seat) continue;
    const { moves, scores } = await score(states[i], seat);
    const chosen = moves.findIndex((m) => key(m) === key(play.cards));
    if (chosen < 0) continue;
    a.moves += 1;
    const label = labelMoves(scores)[chosen];
    if (label === "Best") a.best += 1;
    else if (label === "Good") a.good += 1;
    else {
      if (label === "Inaccuracy") a.inaccuracies += 1;
      else if (label === "Mistake") a.mistakes += 1;
      else a.blunders += 1;
      const best = moves[scores.indexOf(Math.max(...scores))];
      if (play.cards.length === 0) a.passedInstead += 1;
      else if (best.length === 0) a.playedInstead += 1;
      else a.otherPlay += 1;
    }
  }
  return a;
}

export interface AnalysisSummary {
  games: number;
  moves: number;
  /** Moves that were the bot's top choice. */
  best: number;
  perGame: { inaccuracies: number; mistakes: number; blunders: number };
  commonestSlip: SlipKind | null;
  /** Slips (inaccuracy or worse) in each of the last ten analysed games, oldest first. */
  recentSlips: number[];
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function summariseAnalyses(analyses: GameAnalysis[]): AnalysisSummary | null {
  if (analyses.length === 0) return null;
  const total = (k: keyof GameAnalysis) => analyses.reduce((sum, a) => sum + a[k], 0);
  const kinds: SlipKind[] = ["passedInstead", "playedInstead", "otherPlay"];
  const commonest = kinds.reduce<SlipKind | null>((top, k) => (total(k) > 0 && (top === null || total(k) > total(top)) ? k : top), null);
  return {
    games: analyses.length,
    moves: total("moves"),
    best: total("best"),
    perGame: {
      inaccuracies: round1(total("inaccuracies") / analyses.length),
      mistakes: round1(total("mistakes") / analyses.length),
      blunders: round1(total("blunders") / analyses.length),
    },
    commonestSlip: commonest,
    recentSlips: analyses.slice(-10).map((a) => a.inaccuracies + a.mistakes + a.blunders),
  };
}
