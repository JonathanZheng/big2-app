/**
 * A skill rating worked out from the saved vs bots games, so it needs no
 * storage of its own and follows a signed-in player to every device.
 *
 * It is Elo for one player against three bots. Each bot level has a fixed
 * rating, and at equal ratings the player is expected to win one game in
 * four. The levels come from the benchmarks: the trained model (hard) wins
 * about 46% against three Smart bots (medium) and 56% against three greedy
 * bots (easy).
 */
import type { Difficulty } from "@/lib/bots/bots";
import type { GameRecord } from "./profile";

export const START_RATING = 1000;
export const BOT_RATINGS: Record<Difficulty, number> = { easy: 930, medium: 1000, hard: 1160 };
/** How far one game can move the rating. */
const K = 32;
const GROUP = 10;
const GROUPS = 10;

/** The chance of winning against three bots rated `bot`. */
export function expectedWin(rating: number, bot: number): number {
  return 1 / (1 + 3 * 10 ** ((bot - rating) / 400));
}

export interface RatedGame {
  at: number;
  difficulty: Difficulty;
  won: boolean;
  /** Rating after this game, rounded. */
  rating: number;
  /** Change from the rating before it, as shown. */
  change: number;
}

/** The rating after every game, oldest first. */
export function ratingHistory(records: GameRecord[]): RatedGame[] {
  let rating = START_RATING;
  return [...records].sort((a, b) => a.at - b.at).map((r) => {
    const before = Math.round(rating);
    rating += K * ((r.won ? 1 : 0) - expectedWin(rating, BOT_RATINGS[r.difficulty]));
    const after = Math.round(rating);
    return { at: r.at, difficulty: r.difficulty, won: r.won, rating: after, change: after - before };
  });
}

export interface RatingSummary {
  rating: number;
  /** Change from the last game. */
  change: number;
  best: number;
  games: number;
  /** The strongest bot level at or below the rating, or null below easy. */
  level: Difficulty | null;
  history: RatedGame[];
}

export function summariseRating(records: GameRecord[]): RatingSummary | null {
  const history = ratingHistory(records);
  const last = history.at(-1);
  if (!last) return null;
  const levels = (["hard", "medium", "easy"] as const).filter((d) => last.rating >= BOT_RATINGS[d]);
  return {
    rating: last.rating,
    change: last.change,
    best: Math.max(...history.map((g) => g.rating)),
    games: history.length,
    level: levels[0] ?? null,
    history,
  };
}

export interface FormGroup {
  games: number;
  /** Percent of games won, rounded. */
  winRate: number;
  /** Over the lost games in the group, to one decimal place, or null when none were lost. */
  avgCardsLeftWhenLosing: number | null;
}

/** Up to the last ten groups of ten games, counted back from the newest, oldest group first. */
export function form(records: GameRecord[]): FormGroup[] {
  const sorted = [...records].sort((a, b) => a.at - b.at);
  const groups: FormGroup[] = [];
  for (let end = sorted.length; end > 0 && groups.length < GROUPS; end -= GROUP) {
    const games = sorted.slice(Math.max(0, end - GROUP), end);
    const losses = games.filter((g) => !g.won);
    groups.unshift({
      games: games.length,
      winRate: Math.round(((games.length - losses.length) / games.length) * 100),
      avgCardsLeftWhenLosing: losses.length
        ? Math.round((losses.reduce((sum, g) => sum + g.cardsLeft, 0) / losses.length) * 10) / 10
        : null,
    });
  }
  return groups;
}
