/**
 * Where each card in the hand sits. Cards overlap evenly when the row is short
 * of space, and each group gets the same extra gap before and after it, so a
 * custom order always lines up.
 */
import type { Card } from "@/lib/engine/cards";

/** Space between cards when the row has room. */
export const CARD_GAP = 6;
/** Extra space at each edge of a group of cards. */
export const GROUP_GAP = 14;
/** Always show at least this much of each card. */
const MIN_STEP = 12;

/** For each card, whether a group edge falls just before it. */
export function groupBreaks(order: Card[], groups: Card[][]): boolean[] {
  const groupOf = new Map<Card, number>();
  groups.forEach((g, i) => {
    if (g.length > 1) for (const c of g) groupOf.set(c, i);
  });
  return order.map((card, i) => i > 0 && groupOf.get(card) !== groupOf.get(order[i - 1]) &&
    (groupOf.has(card) || groupOf.has(order[i - 1])));
}

/**
 * Left margin for each card in a row `width` px wide. Negative margins
 * overlap the cards; group edges add GROUP_GAP.
 */
export function handOffsets(count: number, width: number, cardWidth: number, breaks: boolean[]): number[] {
  if (count === 0) return [];
  const extra = breaks.filter(Boolean).length * GROUP_GAP;
  const fitted = count > 1 ? (width - cardWidth - extra) / (count - 1) : 0;
  const step = Math.max(MIN_STEP, Math.min(cardWidth + CARD_GAP, fitted));
  return Array.from({ length: count }, (_, i) => (i === 0 ? 0 : step - cardWidth + (breaks[i] ? GROUP_GAP : 0)));
}
