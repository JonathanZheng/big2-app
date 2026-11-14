import type { Card } from "./cards";
import type { GameState } from "./game";
import { MoveType, detectMoveType } from "./moves";

/**
 * Why a selection cannot be played right now, in the words the table shows
 * under PLAY. Call it only for a selection that is not among the legal moves.
 */
export function whyIllegal(game: GameState, cards: Card[], names: string[]): string {
  if (detectMoveType(cards) === MoveType.Invalid) return "THOSE CARDS ARE NOT A COMBINATION";
  if (game.firstMove && !cards.includes(0)) return "THE OPENING PLAY MUST INCLUDE THE 3♦";
  const last = game.lastPlay;
  if (!last) return "THOSE CARDS CANNOT BE PLAYED";
  const name = names[last.player].toUpperCase();
  if (cards.length !== last.cards.length) {
    return `PLAY ${last.cards.length} ${last.cards.length === 1 ? "CARD" : "CARDS"} TO MATCH ${name}`;
  }
  return `THAT DOES NOT BEAT ${name}'S PLAY`;
}
