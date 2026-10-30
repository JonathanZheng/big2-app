import type { Card } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import type { ModelClient } from "@/lib/model/client";
import { greedyMove } from "./greedy";
import { smartMove } from "./smart";

/** Easy is the greedy bot, Medium the Smart bot, Hard the trained model. */
export type Difficulty = "easy" | "medium" | "hard";

/** The model's highest-scoring move. */
export async function modelMove(client: ModelClient, state: GameState, player: number): Promise<Card[]> {
  const { moves, scores } = await client.score(state, player);
  let best = 0;
  for (let i = 1; i < moves.length; i++) if (scores[i] > scores[best]) best = i;
  return moves[best];
}

export async function botMove(
  difficulty: Difficulty,
  state: GameState,
  player: number,
  client: ModelClient | null,
): Promise<Card[]> {
  if (difficulty === "easy") return greedyMove(state, player);
  if (difficulty === "medium") return smartMove(state, player);
  if (!client) throw new Error("model unavailable");
  return modelMove(client, state, player);
}
