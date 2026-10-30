/// <reference lib="webworker" />
/** Loads the model once and scores the legal moves of positions sent to it. */
import type { GameState } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import { encodeState } from "./encoding";
import { Network, type WeightsManifest } from "./network";

export type WorkerRequest = { id: number; state: GameState; player: number };
export type WorkerResponse =
  | { id: number; moves: number[][]; scores: number[] }
  | { id: number; error: string };

const network: Promise<Network> = (async () => {
  const [manifest, weights] = await Promise.all([
    fetch("/model/selfplay_v1.json").then((r) => {
      if (!r.ok) throw new Error(`Model manifest: HTTP ${r.status}`);
      return r.json() as Promise<WeightsManifest>;
    }),
    fetch("/model/selfplay_v1.bin").then((r) => {
      if (!r.ok) throw new Error(`Model weights: HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  return Network.fromBuffers(manifest, weights);
})();

// id 0 asks only whether the model loaded.
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, state, player } = event.data;
  try {
    const net = await network;
    if (id === 0) {
      self.postMessage({ id, moves: [], scores: [] } satisfies WorkerResponse);
      return;
    }
    const moves = legalMoves(state, player);
    const scores = net.scoreMoves(encodeState(state, player), moves);
    self.postMessage({ id, moves, scores: [...scores] } satisfies WorkerResponse);
  } catch (error) {
    self.postMessage({ id, error: String(error) } satisfies WorkerResponse);
  }
};
