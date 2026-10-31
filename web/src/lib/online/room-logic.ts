/**
 * Rules for online rooms that do not touch the database, so they can be
 * tested on their own. The API routes load rows, call these, and save.
 */
import type { Card } from "@/lib/engine/cards";
import { type GameState, type Play, applyMove } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";

/** A seat may be handed to a bot after this long without contact. */
export const TAKEOVER_AFTER_MS = 60_000;

export interface Seat {
  seat: number;
  userId: string | null;
  displayName: string | null;
  /** A bot plays this seat. */
  bot: boolean;
  /** Last contact from the seat's player (milliseconds since 1970). */
  lastSeen: number | null;
}

/** Everything about the game that every player in the room may see. */
export interface PublicGame {
  current: number;
  firstMove: boolean;
  lastPlay: Play | null;
  passes: number;
  history: Play[];
  /** Cards left in each seat's hand. */
  counts: number[];
  winner: number | null;
  /** When the current player's turn runs out, or null for no timer. */
  turnDeadline: number | null;
}

export function splitState(state: GameState, turnDeadline: number | null): { publicGame: PublicGame; hands: Card[][] } {
  return {
    publicGame: {
      current: state.current,
      firstMove: state.firstMove,
      lastPlay: state.lastPlay,
      passes: state.passes,
      history: state.history,
      counts: state.hands.map((h) => h.length),
      winner: state.winner,
      turnDeadline,
    },
    hands: state.hands.map((h) => [...h]),
  };
}

export function joinState(g: PublicGame, hands: Card[][]): GameState {
  return {
    hands: hands.map((h) => [...h]),
    current: g.current,
    firstMove: g.firstMove,
    lastPlay: g.lastPlay,
    passes: g.passes,
    history: g.history,
    winner: g.winner,
  };
}

/** Play every bot turn until a person is to move or the game ends. */
export async function runBots(
  state: GameState,
  seats: Seat[],
  botMove: (state: GameState, player: number) => Promise<Card[]>,
): Promise<GameState> {
  let next = state;
  while (next.winner === null && seats[next.current].bot) {
    next = applyMove(next, await botMove(next, next.current));
  }
  return next;
}

/** When the current turn runs out: only on a person's turn, and only when the room has a timer. */
export function nextDeadline(state: GameState, seats: Seat[], turnSeconds: number | null, now: number): number | null {
  if (turnSeconds === null || state.winner !== null || seats[state.current].bot) return null;
  return now + turnSeconds * 1000;
}

/** The move made for a player whose time ran out: pass if allowed, else the lowest legal move. */
export function autoMove(state: GameState): Card[] {
  return legalMoves(state, state.current)[0];
}

export function canTakeOver(seat: Seat, now: number): boolean {
  return !seat.bot && seat.userId !== null && (seat.lastSeen ?? 0) < now - TAKEOVER_AFTER_MS;
}

// No 0/O, 1/I/L: easy to read out at a table.
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function roomCode(rng: () => number): string {
  return Array.from({ length: 6 }, () => CODE_LETTERS[Math.floor(rng() * CODE_LETTERS.length)]).join("");
}

export interface StatsDelta {
  userId: string;
  games: number;
  wins: number;
  matches: number;
  matchWins: number;
}

/**
 * What a finished game adds to each person who sat in the room, including
 * anyone whose seat a bot took over. `matchWinners` is null unless the game
 * ended a match of several games.
 */
export function statsDelta(seats: Seat[], winner: number, matchWinners: number[] | null): StatsDelta[] {
  return seats.flatMap((s) => (s.userId === null ? [] : [{
    userId: s.userId,
    games: 1,
    wins: s.seat === winner ? 1 : 0,
    matches: matchWinners === null ? 0 : 1,
    matchWins: matchWinners?.includes(s.seat) ? 1 : 0,
  }]));
}
