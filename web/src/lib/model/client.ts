/** Talks to the model worker. Create one per page; it loads the weights once. */
import type { Card } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import type { WorkerRequest, WorkerResponse } from "./worker";

export interface Scored {
  moves: Card[][];
  scores: Float32Array;
}

export class ModelClient {
  readonly ready: Promise<void>;
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (s: Scored) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const reply = event.data;
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      if ("error" in reply) waiting.reject(new Error(reply.error));
      else waiting.resolve({ moves: reply.moves, scores: Float32Array.from(reply.scores) });
    };
    this.ready = this.request(0, null, 0).then(() => undefined);
  }

  /** Every legal move for `player` with the model's score for each. */
  score(state: GameState, player: number): Promise<Scored> {
    return this.request(this.nextId++, state, player);
  }

  dispose() {
    this.worker.terminate();
  }

  private request(id: number, state: GameState | null, player: number): Promise<Scored> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, state, player } as WorkerRequest);
    });
  }
}
