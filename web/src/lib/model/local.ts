/** Main-thread model fallback for browsers where the module worker will not start. */
import type { GameState } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import type { Scored } from "./client";
import { encodeState } from "./encoding";
import { MODEL_URLS } from "./current";
import { Network, type WeightsManifest } from "./network";

export interface LocalScorer {
  score(state: GameState, player: number): Promise<Scored>;
}

export async function createLocalScorer(): Promise<LocalScorer> {
  const [manifest, weights] = await Promise.all([
    fetch(MODEL_URLS.manifest).then((response) => {
      if (!response.ok) throw new Error(`Model manifest: HTTP ${response.status}`);
      return response.json() as Promise<WeightsManifest>;
    }),
    fetch(MODEL_URLS.weights).then((response) => {
      if (!response.ok) throw new Error(`Model weights: HTTP ${response.status}`);
      return response.arrayBuffer();
    }),
  ]);
  const network = Network.fromBuffers(manifest, weights);
  return {
    score(state: GameState, player: number) {
      const moves = legalMoves(state, player);
      const scores = network.scoreMoves(encodeState(state, player), moves);
      return Promise.resolve({ moves, scores });
    },
  };
}
