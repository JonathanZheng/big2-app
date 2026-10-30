/**
 * Cards are numbers 0 to 51: card = rank * 4 + suit.
 * Rank 0 is 3 up to 12 is 2. Suits: 0 ♦, 1 ♣, 2 ♥, 3 ♠. So 3♦ is 0.
 */
export type Card = number;

export const RANK_NAMES = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
export const SUIT_SYMBOLS = ["♦", "♣", "♥", "♠"];
const SUIT_LETTERS = ["d", "c", "h", "s"];

export function rank(card: Card): number {
  return Math.floor(card / 4);
}

export function suit(card: Card): number {
  return card % 4;
}

export function cardName(card: Card): string {
  return RANK_NAMES[rank(card)] + SUIT_SYMBOLS[suit(card)];
}

export function isRed(card: Card): boolean {
  return suit(card) === 0 || suit(card) === 2;
}

/** Parse cards like "3d 10h Th As 2s". Ranks 3-10 (or T), J, Q, K, A, 2; suits d c h s. */
export function parseCards(text: string): Card[] {
  return text.trim().split(/\s+/).filter(Boolean).map((token) => {
    const r = RANK_NAMES.indexOf(token.slice(0, -1) === "T" ? "10" : token.slice(0, -1));
    const s = SUIT_LETTERS.indexOf(token.slice(-1));
    if (r < 0 || s < 0) throw new Error(`Not a card: ${token}`);
    return r * 4 + s;
  });
}
