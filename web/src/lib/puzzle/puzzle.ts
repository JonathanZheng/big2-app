/**
 * Daily puzzles: positions from the bot's own games where one move is clearly
 * best (made by scripts/export_puzzles.py). Results stay in this browser or,
 * when signed in, on the account.
 */
import { queueChange, readAccount } from "@/lib/account/store";
import type { Card } from "@/lib/engine/cards";
import type { GameState, Play } from "@/lib/engine/game";
import type { Label } from "@/lib/model/advice";

export interface Puzzle {
  hands: Card[][];
  current: number;
  firstMove: boolean;
  lastPlay: Play | null;
  passes: number;
  history: Play[];
  winner: null;
  /** The bot's best move. */
  best: Card[];
}

export interface PuzzleResult {
  cards: Card[];
  label: Label;
}

const KEY = "big2.puzzles.v1";

export function puzzleState(p: Puzzle): GameState {
  return {
    hands: p.hands.map((h) => [...h]),
    current: p.current,
    firstMove: p.firstMove,
    lastPlay: p.lastPlay,
    passes: p.passes,
    history: p.history,
    winner: null,
  };
}

/** The local calendar day as YYYY-MM-DD. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const dayNumber = (date: Date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);

/** Index of the puzzle for this local day. */
export function puzzleFor(date: Date, count: number): number {
  return dayNumber(date) % count;
}

export function readResults(): Record<string, PuzzleResult> {
  return readAccount()?.history.puzzles ?? readGuestResults();
}

/** Results kept in this browser while signed out. */
export function readGuestResults(): Record<string, PuzzleResult> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, PuzzleResult>) : {};
  } catch {
    return {};
  }
}

export function saveResult(day: string, result: PuzzleResult) {
  if (queueChange({ puzzles: { [day]: result } })) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readGuestResults(), [day]: result }));
  } catch {
    // Storage blocked: the result is shown but not kept.
  }
}

export function clearGuestResults() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: nothing to clear.
  }
}

/** Days in a row solved with the best move, ending today (or yesterday if today is not played yet). */
export function streak(results: Record<string, PuzzleResult>, today: Date): number {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!results[dayKey(day)]) day.setDate(day.getDate() - 1);
  let count = 0;
  while (results[dayKey(day)]?.label === "Best") {
    count += 1;
    day.setDate(day.getDate() - 1);
  }
  return count;
}
