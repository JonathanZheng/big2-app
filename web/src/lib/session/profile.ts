/**
 * Per-game records behind the profile page, kept in this browser or, when
 * signed in, on the account. Only vs bots games are recorded; one-device
 * games are shared and do not count.
 */
import { queueChange, readAccount } from "@/lib/account/store";
import type { Difficulty } from "@/lib/bots/bots";
import { suit } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import { MoveType, detectMoveType } from "@/lib/engine/moves";
import type { GameAnalysis } from "./analysis";

const KEY = "big2.games.v1";
const STATS_KEY = "big2.stats.v1";
const KEEP = 500;

export interface GameRecord {
  /** When the game ended (milliseconds since 1970). */
  at: number;
  difficulty: Difficulty;
  won: boolean;
  /** My cards when the game ended. */
  cardsLeft: number;
  /** My turns by move type; index is MoveType, so 0 counts passes. */
  plays: number[];
  /** Cards I played by suit: ♦ ♣ ♥ ♠. */
  suits: number[];
  /** Turns on which I asked for a hint. */
  hints: number;
  /** How my moves compared with the bot's, added once the game has been analysed. */
  analysis?: GameAnalysis;
}

export interface Profile {
  games: number;
  wins: number;
  byDifficulty: Record<Difficulty, { games: number; wins: number }>;
  currentStreak: number;
  bestStreak: number;
  suits: number[];
  favouriteSuit: number | null;
  /** Plays by move type; index is MoveType, 0 (passes) included. */
  combos: number[];
  favouriteCombo: MoveType | null;
  avgCardsLeftWhenLosing: number | null;
  hintsPerGame: number | null;
  /** Up to ten games, newest first. */
  recent: GameRecord[];
}

export function gameRecord(game: GameState, seat: number, difficulty: Difficulty, hints: number, at: number): GameRecord {
  const plays = Array(9).fill(0);
  const suits = [0, 0, 0, 0];
  for (const p of game.history) {
    if (p.player !== seat) continue;
    plays[detectMoveType(p.cards)] += 1;
    for (const c of p.cards) suits[suit(c)] += 1;
  }
  return { at, difficulty, won: game.winner === seat, cardsLeft: game.hands[seat].length, plays, suits, hints };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Index of the largest positive value (the first on a tie), or null. */
function largest(xs: number[], from = 0): number | null {
  let best: number | null = null;
  for (let i = from; i < xs.length; i++) if (xs[i] > 0 && (best === null || xs[i] > xs[best])) best = i;
  return best;
}

export function summarise(records: GameRecord[]): Profile {
  const byDifficulty = { easy: { games: 0, wins: 0 }, medium: { games: 0, wins: 0 }, hard: { games: 0, wins: 0 } };
  const suits = [0, 0, 0, 0];
  const combos = Array(9).fill(0);
  let run = 0;
  let bestStreak = 0;
  for (const r of records) {
    byDifficulty[r.difficulty].games += 1;
    if (r.won) byDifficulty[r.difficulty].wins += 1;
    run = r.won ? run + 1 : 0;
    bestStreak = Math.max(bestStreak, run);
    r.suits.forEach((n, s) => (suits[s] += n));
    r.plays.forEach((n, t) => (combos[t] += n));
  }
  const losses = records.filter((r) => !r.won);
  return {
    games: records.length,
    wins: records.length - losses.length,
    byDifficulty,
    currentStreak: run,
    bestStreak,
    suits,
    favouriteSuit: largest(suits),
    combos,
    favouriteCombo: largest(combos, MoveType.Single) as MoveType | null,
    avgCardsLeftWhenLosing: losses.length ? Math.round((sum(losses.map((r) => r.cardsLeft)) / losses.length) * 10) / 10 : null,
    hintsPerGame: records.length ? Math.round((sum(records.map((r) => r.hints)) / records.length) * 10) / 10 : null,
    recent: records.slice(-10).reverse(),
  };
}

export function readGameRecords(): GameRecord[] {
  return readAccount()?.history.games ?? readGuestGameRecords();
}

/** Games kept in this browser while signed out. */
export function readGuestGameRecords(): GameRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as GameRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveGameRecord(record: GameRecord) {
  if (queueChange({ games: [record] }) !== null) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...readGuestGameRecords(), record].slice(-KEEP)));
  } catch {
    // Storage blocked: the profile simply is not kept.
  }
}

/** Add the analysis of a saved game, found by when it ended. */
export function attachAnalysis(at: number, analysis: GameAnalysis) {
  const account = readAccount();
  if (account) {
    const record = account.history.games.find((r) => r.at === at);
    if (record) queueChange({ games: [{ ...record, analysis }] });
    return;
  }
  try {
    const records = readGuestGameRecords();
    if (!records.some((r) => r.at === at)) return;
    localStorage.setItem(KEY, JSON.stringify(records.map((r) => (r.at === at ? { ...r, analysis } : r))));
  } catch {
    // Storage blocked: the analysis is not kept.
  }
}

/** Remove every stat this browser keeps while signed out. */
export function clearProfile() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(STATS_KEY);
  } catch {
    // Storage blocked: nothing to clear.
  }
}
