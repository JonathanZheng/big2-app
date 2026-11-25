/** Rebuild every position of a finished game so it can be stepped through. */
import type { Card } from "@/lib/engine/cards";
import { type GameState, replayMove } from "@/lib/engine/game";
import { isOut } from "@/lib/engine/rules";

/**
 * Positions before each recorded move, plus the final position. The finished
 * state keeps the cards left in the losers' hands, so adding the played cards
 * back gives the deal.
 */
export function reviewStates(final: GameState): GameState[] {
  if (final.history.length === 0) return [final];

  const startHands: Card[][] = final.hands.map((hand) => [...hand]);
  for (const play of final.history) {
    for (const card of play.cards) startHands[play.player].push(card);
  }
  const hands = startHands.map((hand) => hand.sort((a, b) => a - b));
  const current = hands.findIndex((hand) => hand.includes(0));
  let state: GameState = {
    hands,
    current,
    firstMove: true,
    lastPlay: null,
    passes: 0,
    history: [],
    winner: null,
    ...(final.rules ? { rules: final.rules } : {}),
  };
  const states = [state];
  for (const play of final.history) {
    state = replayMove(state, play.cards);
    states.push(state);
  }
  return states;
}

/** Steps where one of `players` chose a move, with the move they made. Automatic passes are left out. */
export function myDecisions(final: GameState, players: number[] = [0]): { step: number; player: number; cards: Card[] }[] {
  const states = reviewStates(final);
  return final.history.flatMap((play, index) =>
    players.includes(play.player) && !isOut(states[index], play.player)
      ? [{ step: index, player: play.player, cards: play.cards }]
      : [],
  );
}
