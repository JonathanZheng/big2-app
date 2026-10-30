/** Ways to order a hand on screen. These never change the game, only the display. */
import { type Card, rank, suit } from "@/lib/engine/cards";
import { canonicalOrder } from "@/lib/engine/legal";
import { MoveType, detectMoveType } from "@/lib/engine/moves";

export type SortMode = "rank" | "suit" | "combo" | "manual";

/** Five-card hands the combo sort looks for, strongest first. */
const FIVE_CARD_PRIORITY = [MoveType.StraightFlush, MoveType.Quad, MoveType.FullHouse, MoveType.Flush, MoveType.Straight];

const byCard = (a: Card, b: Card) => a - b;

function fiveCardSubsets(cards: Card[]): Card[][] {
  const out: Card[][] = [];
  const pick = (start: number, picked: Card[]) => {
    if (picked.length === 5) return void out.push(picked);
    for (let i = start; i < cards.length; i++) pick(i + 1, [...picked, cards[i]]);
  };
  pick(0, []);
  return canonicalOrder(out);
}

/** The lowest five-card hand of the strongest type available, or null. */
function findFiveCardHand(cards: Card[]): Card[] | null {
  const subsets = fiveCardSubsets(cards);
  for (const type of FIVE_CARD_PRIORITY) {
    const found = subsets.find((s) => detectMoveType(s) === type);
    if (found) return found;
  }
  return null;
}

function comboSort(cards: Card[]): Card[] {
  let rest = [...cards].sort(byCard);
  const fives: Card[] = [];
  for (let found = findFiveCardHand(rest); found; found = findFiveCardHand(rest)) {
    fives.push(...found);
    rest = rest.filter((c) => !found.includes(c));
  }
  const byRank = new Map<number, Card[]>();
  for (const c of rest) byRank.set(rank(c), [...(byRank.get(rank(c)) ?? []), c]);
  const groups = (size: number) =>
    [...byRank.values()].filter((g) => g.length === size).flat();
  return [...fives, ...groups(4), ...groups(3), ...groups(2), ...groups(1)];
}

export function sortHand(cards: Card[], mode: Exclude<SortMode, "manual">): Card[] {
  if (mode === "rank") return [...cards].sort(byCard);
  if (mode === "suit") return [...cards].sort((a, b) => suit(a) - suit(b) || a - b);
  return comboSort(cards);
}

/** Keep a manual order as cards leave the hand; new cards go at the end. */
export function keepOrder(order: Card[], hand: Card[]): Card[] {
  const kept = order.filter((c) => hand.includes(c));
  return [...kept, ...hand.filter((c) => !kept.includes(c))];
}

/** Move a group's cards next to each other, at the position of its first card. */
export function groupCards(order: Card[], group: Card[]): Card[] {
  const members = order.filter((c) => group.includes(c));
  if (members.length === 0) return order;
  const result: Card[] = [];
  for (const c of order) {
    if (c === members[0]) result.push(...members);
    else if (!group.includes(c)) result.push(c);
  }
  return result;
}

/** The card Combos cycles around: the last tapped card while it is still selected. */
export function comboAnchor(selected: Card[], lastTapped: Card | null): Card | null {
  return lastTapped !== null && selected.includes(lastTapped) ? lastTapped : null;
}

/** Legal plays holding `card`, or every legal play when no card is chosen. */
export function combosContaining(card: Card | null, legal: Card[][]): Card[][] {
  return legal.filter((m) => m.length > 0 && (card === null || m.includes(card)));
}

const SORT_KEY = "big2.sort.v1";
const MODES: SortMode[] = ["rank", "suit", "combo", "manual"];

/** The sort applied to each new deal. Storage can be blocked, so this falls back to rank. */
export function readSortPreference(): SortMode {
  try {
    const saved = localStorage.getItem(SORT_KEY) as SortMode | null;
    return saved && MODES.includes(saved) ? saved : "rank";
  } catch {
    return "rank";
  }
}

export function saveSortPreference(mode: SortMode) {
  try {
    localStorage.setItem(SORT_KEY, mode);
  } catch {
    // Storage blocked: the preference lasts for this page only.
  }
}
