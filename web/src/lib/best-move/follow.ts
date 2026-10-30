/**
 * Recording a real game at a table. Only my hand is known; every card another
 * seat plays becomes known as it is entered. Counts follow from the cards each
 * seat has played, and the full move order is kept so the model gets the same
 * last-four-moves input as in a game it played itself.
 */
import type { Card } from "@/lib/engine/cards";
import type { GameState, Play } from "@/lib/engine/game";
import { MoveType, canBeat, detectMoveType } from "@/lib/engine/moves";

export interface FollowState {
  /** The 13 cards I was dealt. */
  initial: Card[];
  myHand: Card[];
  played: Card[][];
  lastPlay: Play | null;
  passes: number;
  /** Null while the 3♦ holder is still unknown. */
  current: number | null;
  opening: boolean;
  winner: number | null;
  history: Play[];
}

const sorted = (cards: Card[]) => [...cards].sort((a, b) => a - b);
const unique = (cards: Card[]) => new Set(cards).size === cards.length;

export function startFollow(initial: Card[]): FollowState {
  const hand = sorted(initial);
  if (hand.length !== 13 || !unique(hand) || hand.some((c) => c < 0 || c > 51)) {
    throw new Error("Your hand must be 13 different cards.");
  }
  return {
    initial: hand,
    myHand: hand,
    played: [[], [], [], []],
    lastPlay: null,
    passes: 0,
    current: hand.includes(0) ? 0 : null,
    opening: true,
    winner: null,
    history: [],
  };
}

/** Add one move to the record. Throws with a readable reason if it is not legal. */
export function applyFollow(state: FollowState, player: number, cards: Card[]): FollowState {
  if (state.winner !== null) throw new Error("The game is over.");
  if (state.current !== null && player !== state.current) {
    throw new Error(`It is ${state.current === 0 ? "your" : "another"} turn.`);
  }
  if (state.current === null && state.opening && player === 0) {
    throw new Error("The 3♦ holder opens, and you do not hold it.");
  }

  const move = sorted(cards);
  if (move.length === 0) {
    if (state.current === null || state.lastPlay === null) throw new Error("You cannot pass when leading.");
    const passing = state.current;
    const passes = state.passes + 1;
    const over = passes >= 3;
    return {
      ...state,
      passes: over ? 0 : passes,
      lastPlay: over ? null : state.lastPlay,
      current: (passing + 1) % 4,
      history: [...state.history, { player: passing, cards: [] }],
    };
  }

  if (!unique(move)) throw new Error("A card cannot be played twice.");
  const alreadyPlayed = new Set(state.played.flat());
  if (move.some((c) => alreadyPlayed.has(c))) throw new Error("One of those cards has already been played.");
  if (player === 0 && move.some((c) => !state.myHand.includes(c))) {
    throw new Error("One of those cards is not in your hand.");
  }
  if (player !== 0 && move.some((c) => state.myHand.includes(c))) {
    throw new Error("One of those cards is in your hand.");
  }
  if (state.opening && !move.includes(0)) throw new Error("The first move must contain 3♦.");

  const type = detectMoveType(move);
  if (type === MoveType.Invalid) throw new Error("That is not a legal Big 2 move.");
  if (state.lastPlay !== null && !canBeat(move, state.lastPlay.cards)) {
    throw new Error("That does not beat the move on the table.");
  }

  const played = state.played.map((set, seat) => (seat === player ? [...set, ...move] : set));
  const myHand = player === 0 ? state.myHand.filter((c) => !move.includes(c)) : state.myHand;
  const winner = player === 0 ? (myHand.length === 0 ? 0 : null) : (played[player].length >= 13 ? player : null);
  return {
    ...state,
    myHand,
    played,
    lastPlay: { player, cards: move },
    passes: 0,
    current: (player + 1) % 4,
    opening: false,
    winner,
    history: [...state.history, { player, cards: move }],
  };
}

export function replayFollow(initial: Card[], history: Play[]): FollowState {
  let state = startFollow(initial);
  for (const play of history) state = applyFollow(state, play.player, play.cards);
  return state;
}

/** A state for the model and the table view, with my real hand and known played cards. */
export function followToGame(state: FollowState): GameState {
  const counts = [0, 1, 2, 3].map((seat) => 13 - state.played[seat].length);
  const notMine = Array.from({ length: 52 }, (_, c) => c).filter((c) => !state.myHand.includes(c));
  const hands: Card[][] = [state.myHand];
  let pool = 0;
  for (let seat = 1; seat < 4; seat++) {
    const hand: Card[] = [];
    for (let i = 0; i < counts[seat]; i++) hand.push(notMine[(pool + i) % Math.max(notMine.length, 1)] ?? 0);
    hands.push(hand);
    pool += counts[seat];
  }
  return {
    hands,
    current: state.current ?? 0,
    firstMove: state.opening && state.lastPlay === null,
    lastPlay: state.lastPlay,
    passes: state.passes,
    history: state.history,
    winner: state.winner,
    playedBy: state.played,
  };
}

/**
 * A finished state that can be replayed by the review screen. The unused cards
 * are shared out among the other seats only so every card has one place; their
 * real hands were never known.
 */
export function followFinalState(state: FollowState): GameState {
  const played = new Set(state.played.flat());
  const remaining = Array.from({ length: 52 }, (_, c) => c).filter((c) => !state.initial.includes(c) && !played.has(c));
  const initialHands: Card[][] = [state.initial, [], [], []];
  let pool = 0;
  for (let seat = 1; seat < 4; seat++) {
    const count = 13 - state.played[seat].length;
    initialHands[seat] = [...state.played[seat], ...remaining.slice(pool, pool + count)];
    pool += count;
  }
  const hands = initialHands.map((hand, seat) => hand.filter((c) => !state.played[seat].includes(c)));
  return {
    hands,
    current: state.current ?? 0,
    firstMove: state.opening && state.lastPlay === null,
    lastPlay: state.lastPlay,
    passes: state.passes,
    history: state.history,
    winner: state.winner,
  };
}

/** Cards the current player may select: mine on my turn, unseen cards on theirs. */
export function selectableCards(state: FollowState, player: number | null): Set<Card> {
  if (player === null) return new Set();
  if (player === 0) return new Set(state.myHand);
  const played = new Set(state.played.flat());
  const mine = new Set(state.myHand);
  return new Set(Array.from({ length: 52 }, (_, c) => c).filter((c) => !played.has(c) && !mine.has(c)));
}

const KEY = "big2.follow.v1";

export function readFollow(): { initial: Card[]; history: Play[] } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { initial?: unknown; history?: unknown };
    if (!Array.isArray(parsed.initial) || !Array.isArray(parsed.history)) return null;
    const initial = parsed.initial as Card[];
    const history = parsed.history as Play[];
    replayFollow(initial, history);
    return { initial, history };
  } catch {
    return null;
  }
}

export function saveFollow(initial: Card[], history: Play[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ initial, history }));
  } catch {
    // Storage blocked: the record lasts for this page only.
  }
}

export function clearFollow() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: nothing was saved anyway.
  }
}
