/** Summaries of the move history for the History panel. */
import type { Card } from "@/lib/engine/cards";
import type { Play } from "@/lib/engine/game";

/** Split the history into tricks; a trick ends after three passes in a row. */
export function groupTricks(history: Play[]): Play[][] {
  const tricks: Play[][] = [];
  let current: Play[] = [];
  let passes = 0;
  for (const play of history) {
    current.push(play);
    passes = play.cards.length === 0 ? passes + 1 : 0;
    if (passes === 3) {
      tricks.push(current);
      current = [];
      passes = 0;
    }
  }
  if (current.length > 0) tricks.push(current);
  return tricks;
}

/** Each played card and the seat that played it. */
export function cardOwners(history: Play[]): Map<Card, number> {
  const owners = new Map<Card, number>();
  for (const play of history) for (const c of play.cards) owners.set(c, play.player);
  return owners;
}

/** 2s and Aces still in other players' hands (not played and not mine). */
export function highCardsElsewhere(history: Play[], myHand: Card[]): { twos: number; aces: number } {
  const gone = new Set([...cardOwners(history).keys(), ...myHand]);
  const count = (r: number) => [0, 1, 2, 3].filter((s) => !gone.has(r * 4 + s)).length;
  return { twos: count(12), aces: count(11) };
}

/** Short seat labels for the cards-played grid: the first letter plus any number ("Bot 2" is B2), or seat numbers if two would match. */
export function seatLabels(names: string[]): string[] {
  const labels = names.map((name) => name[0].toUpperCase() + (name.match(/\d+$/)?.[0] ?? ""));
  return new Set(labels).size === names.length ? labels : names.map((_, seat) => String(seat + 1));
}
