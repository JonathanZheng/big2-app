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
  /** Answered from the archive after its day: counts as solved, not towards the streak. */
  late?: true;
}

const KEY = "big2.puzzles.v1";
/** The first daily puzzle. The archive starts here. */
export const PUZZLE_LAUNCH = "2026-10-31";
/** The archive goes back at most this many days, so each of the 365 puzzles shows once. */
const ARCHIVE_DAYS = 364;

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

/** The local day in a YYYY-MM-DD string, or null when it is not a real calendar day. */
export function parseDay(text: string | null): Date | null {
  const match = text?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dayKey(date) === text ? date : null;
}

/** Past days with a puzzle to play, newest first: from yesterday back to launch, at most a year. */
export function archiveDays(today: Date): string[] {
  const days: string[] = [];
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  while (days.length < ARCHIVE_DAYS && dayKey(day) >= PUZZLE_LAUNCH) {
    days.push(dayKey(day));
    day.setDate(day.getDate() - 1);
  }
  return days;
}

export function isArchiveDay(day: string, today: Date): boolean {
  return archiveDays(today).includes(day);
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
  if (queueChange({ puzzles: { [day]: result } }) !== null) return;
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

/**
 * Days in a row solved with the best move on the day, ending today (or
 * yesterday if today is not played yet). Late answers from the archive do not count.
 */
export function streak(results: Record<string, PuzzleResult>, today: Date): number {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!results[dayKey(day)]) day.setDate(day.getDate() - 1);
  let count = 0;
  while (results[dayKey(day)]?.label === "Best" && !results[dayKey(day)].late) {
    count += 1;
    day.setDate(day.getDate() - 1);
  }
  return count;
}
