/**
 * A manually entered Big 2 position. Every card has exactly one owner state,
 * so the board cannot put the same card in two places. The model only needs
 * the unseen cards, each seat's count, who played what, and the trick on the
 * table, so opponent hands can be filled with placeholders.
 */
import type { Card } from "@/lib/engine/cards";
import type { GameState, Play } from "@/lib/engine/game";
import { MoveType, detectMoveType } from "@/lib/engine/moves";

export type CardOwner = "unseen" | "mine" | "minePlayed" | "west" | "north" | "east" | "out";
export type LastSeat = 1 | 2 | 3;

export const OWNER_CYCLE: readonly CardOwner[] = ["unseen", "mine", "west", "north", "east", "out"];

export const OWNER_LABEL: Record<CardOwner, string> = {
  unseen: "NOT SEEN",
  mine: "YOUR HAND",
  minePlayed: "PLAYED BY YOU",
  west: "PLAYED BY WEST",
  north: "PLAYED BY NORTH",
  east: "PLAYED BY EAST",
  out: "OUT OF THE GAME",
};

export interface Board {
  /** One owner per card number (0 to 51). */
  owners: CardOwner[];
  lastPlayer: LastSeat | null;
  lastCards: Card[];
  passes: 0 | 1 | 2;
  /** Typed opponent counts, or null to use 13 minus their played cards. */
  counts: [number, number, number] | null;
}

export const EMPTY_BOARD: Board = {
  owners: Array<CardOwner>(52).fill("unseen"),
  lastPlayer: null,
  lastCards: [],
  passes: 0,
  counts: null,
};

export const SEAT_OWNER: Record<LastSeat, CardOwner> = { 1: "west", 2: "north", 3: "east" };

export function cycleOwner(owner: CardOwner): CardOwner {
  return OWNER_CYCLE[(OWNER_CYCLE.indexOf(owner) + 1) % OWNER_CYCLE.length];
}

export function cardsWithOwner(board: Board, owner: CardOwner): Card[] {
  return board.owners.flatMap((o, card) => (o === owner ? [card] : []));
}

export function myHand(board: Board): Card[] {
  return cardsWithOwner(board, "mine");
}

/** Played cards by seat; index 0 is always empty because the board is mine. */
export function playedBy(board: Board): Card[][] {
  return [
    [],
    cardsWithOwner(board, "west"),
    cardsWithOwner(board, "north"),
    cardsWithOwner(board, "east"),
  ];
}

export function deadCards(board: Board): Card[] {
  return cardsWithOwner(board, "out");
}

export function unseenCards(board: Board): Card[] {
  return cardsWithOwner(board, "unseen");
}

/** Counts that follow the played cards, unless the user typed their own. */
export function autoCounts(board: Board): [number, number, number] {
  const played = playedBy(board);
  return [13 - played[1].length, 13 - played[2].length, 13 - played[3].length];
}

export function opponentCounts(board: Board): [number, number, number] {
  return board.counts ?? autoCounts(board);
}

/** The 3♦ has not been played yet, so the next lead is the opening move. */
export function isOpening(board: Board): boolean {
  return board.owners[0] !== "west" && board.owners[0] !== "north" && board.owners[0] !== "east" && board.owners[0] !== "out";
}

export function lastPlayerCards(board: Board): Card[] {
  return board.lastPlayer === null ? [] : playedBy(board)[board.lastPlayer];
}

/** Change one card's owner, dropping it from the trick if it no longer belongs there. */
export function setOwner(board: Board, card: Card, owner: CardOwner): Board {
  const owners = [...board.owners];
  owners[card] = owner;
  const lastCards = board.lastPlayer === null
    ? []
    : board.lastCards.filter((c) => owners[c] === SEAT_OWNER[board.lastPlayer!]);
  return { ...board, owners, lastCards };
}

export function toggleLastCard(board: Board, card: Card): Board {
  if (board.lastPlayer === null) return board;
  const lastCards = board.lastCards.includes(card)
    ? board.lastCards.filter((c) => c !== card)
    : [...board.lastCards, card].sort((a, b) => a - b);
  return { ...board, lastCards };
}

/**
 * Build the immutable state the model and the legal-move generator expect.
 * Opponent placeholders only need the right length; the encoding reads our
 * hand and each opponent's count, never the identity of their cards.
 */
export function boardToGame(board: Board): GameState {
  const mine = myHand(board);
  const played = playedBy(board);
  const dead = deadCards(board);
  const counts = opponentCounts(board);
  const notMine = Array.from({ length: 52 }, (_, c) => c).filter((c) => !mine.includes(c));
  const hands: Card[][] = [mine];
  let pool = 0;
  for (const count of counts) {
    const hand: Card[] = [];
    for (let i = 0; i < count; i++) {
      hand.push(notMine[(pool + i) % Math.max(notMine.length, 1)] ?? 0);
    }
    hands.push(hand);
    pool += count;
  }

  const lastPlay: Play | null = board.lastPlayer === null
    ? null
    : { player: board.lastPlayer, cards: [...board.lastCards].sort((a, b) => a - b) };

  return {
    hands,
    current: 0,
    firstMove: isOpening(board) && lastPlay === null,
    lastPlay,
    passes: lastPlay === null ? 0 : board.passes,
    history: lastPlay === null ? [] : [lastPlay],
    winner: null,
    playedBy: played,
    dead,
  };
}

export interface BoardCheck {
  errors: string[];
  warnings: string[];
}

export function checkBoard(board: Board): BoardCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const mine = myHand(board);
  const played = playedBy(board);
  const opening = isOpening(board);

  // Everything else depends on the hand, so ask for it before anything else.
  if (mine.length === 0) return { errors: ["Mark the cards in your hand first."], warnings };
  if (mine.length > 13) errors.push("Your hand has more than 13 cards.");
  if (board.lastPlayer === null) {
    if (board.lastCards.length > 0) errors.push("Clear the cards on the table if you are leading.");
    if (opening && !mine.includes(0)) {
      errors.push("3♦ is still unseen, so the player holding it opens. Mark it in your hand.");
    }
  } else {
    if (board.lastCards.length === 0) {
      errors.push("Mark the cards that are on the table.");
    } else {
      const type = detectMoveType(board.lastCards);
      if (type === MoveType.Invalid) {
        errors.push("The cards on the table are not a legal Big 2 move.");
      }
      const owned = played[board.lastPlayer];
      if (board.lastCards.some((c) => !owned.includes(c))) {
        errors.push(`The table move must be cards marked as played by ${SEAT_LABEL[board.lastPlayer]}.`);
      }
      if (board.lastCards.some((c) => mine.includes(c))) {
        errors.push("A card in your hand cannot also be on the table.");
      }
    }
    if (opening) {
      errors.push("3♦ has not been played yet, so this cannot be a later trick. Mark the opening move instead.");
    }
  }

  const counts = opponentCounts(board);
  for (const [i, count] of counts.entries()) {
    if (!Number.isInteger(count) || count < 0 || count > 13) {
      errors.push(`${SEAT_LABEL[(i + 1) as LastSeat]} has an invalid card count.`);
    }
  }
  const unseen = unseenCards(board).length;
  const typedTotal = counts.reduce((a, b) => a + b, 0);
  if (typedTotal !== unseen) {
    warnings.push(
      `Your counts give the other players ${typedTotal} cards, but ${unseen} cards are not in your hand or marked as played. Advice may be less accurate.`,
    );
  }

  return { errors, warnings };
}

export const SEAT_LABEL: Record<LastSeat, string> = { 1: "West", 2: "North", 3: "East" };

const KEY = "big2.bestMove.v1";

const ALL_OWNERS: readonly string[] = [...OWNER_CYCLE, "minePlayed"];

function isOwner(value: unknown): value is CardOwner {
  return typeof value === "string" && ALL_OWNERS.includes(value);
}

function isBoard(value: unknown): value is Board {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<Board>;
  if (!Array.isArray(b.owners) || b.owners.length !== 52 || !b.owners.every(isOwner)) return false;
  if (b.lastPlayer !== null && b.lastPlayer !== 1 && b.lastPlayer !== 2 && b.lastPlayer !== 3) return false;
  if (!Array.isArray(b.lastCards) || !b.lastCards.every((c) => Number.isInteger(c) && c >= 0 && c < 52)) return false;
  if (b.passes !== 0 && b.passes !== 1 && b.passes !== 2) return false;
  if (b.counts !== null) {
    if (!Array.isArray(b.counts) || b.counts.length !== 3) return false;
    if (!b.counts.every((n) => Number.isInteger(n) && n >= 0 && n <= 13)) return false;
  }
  return true;
}

export function readBoard(): Board | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isBoard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveBoard(board: Board) {
  try {
    localStorage.setItem(KEY, JSON.stringify(board));
  } catch {
    // Storage blocked: the board lasts for this page only.
  }
}
