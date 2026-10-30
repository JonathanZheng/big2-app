/**
 * Single games and matches against bots. The human is seat 0; seats 1 to 3
 * are bots (West, North, East, in play order after the human). Only wins are
 * counted, and the holder of the 3♦ opens every game.
 */
import type { Difficulty } from "@/lib/bots/bots";
import type { Card } from "@/lib/engine/cards";
import { type GameState, applyMove, deal, mulberry32 } from "@/lib/engine/game";

export const SEAT_NAMES = ["You", "West", "North", "East"];

export interface MatchConfig {
  difficulty: Difficulty;
  /** 1 is a single game. */
  games: 1 | 3 | 5 | 10;
}

export interface MatchState {
  config: MatchConfig;
  game: GameState;
  gameIndex: number;
  wins: number[];
  over: boolean;
  seed: number;
}

export function startMatch(config: MatchConfig, seed: number): MatchState {
  return { config, game: deal(mulberry32(seed)), gameIndex: 0, wins: [0, 0, 0, 0], over: false, seed };
}

/** Play (or pass with `[]`) for whoever's turn it is. */
export function playMove(m: MatchState, cards: Card[]): MatchState {
  const game = applyMove(m.game, cards);
  if (game.winner === null) return { ...m, game };
  const wins = m.wins.map((w, seat) => (seat === game.winner ? w + 1 : w));
  return { ...m, game, wins, over: m.gameIndex + 1 >= m.config.games };
}

export function nextGame(m: MatchState): MatchState {
  if (m.over) throw new Error("The match is over");
  if (m.game.winner === null) throw new Error("The game is still going");
  const gameIndex = m.gameIndex + 1;
  return { ...m, gameIndex, game: deal(mulberry32(m.seed + gameIndex * 7919)) };
}

export function endMatch(m: MatchState): MatchState {
  return { ...m, over: true };
}

/** Every seat tied on the most wins. */
export function matchWinners(m: MatchState): number[] {
  const most = Math.max(...m.wins);
  return m.wins.flatMap((w, seat) => (w === most ? [seat] : []));
}
