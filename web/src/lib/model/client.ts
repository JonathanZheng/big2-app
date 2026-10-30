/** Talks to the model worker, with a main-thread fallback if it cannot start. */
import type { Card } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import type { LocalScorer } from "./local";
import type { WorkerRequest, WorkerResponse } from "./worker";

export interface Scored {
  moves: Card[][];
  scores: Float32Array;
}

/** Give up on a worker that has not loaded the model in this long. */
const LOAD_TIMEOUT_MS = 20_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class ModelClient {
  readonly ready: Promise<void>;
  private worker: Worker | null = null;
  private local: LocalScorer | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (s: Scored) => void; reject: (e: Error) => void }>();
  private failure: Error | null = null;
  private fallbackPromise: Promise<void> | null = null;

  constructor() {
    this.ready = this.start();
  }

  private async start(): Promise<void> {
    try {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const reply = event.data;
        const waiting = this.pending.get(reply.id);
        if (!waiting) return;
        this.pending.delete(reply.id);
        if ("error" in reply) waiting.reject(new Error(reply.error));
        else waiting.resolve({ moves: reply.moves, scores: Float32Array.from(reply.scores) });
      };
      // Without these, a worker that fails to start would leave every request
      // waiting forever (and a Hard game stuck on THINKING).
      worker.onerror = (event) => this.fail(new Error(event.message || "Model worker failed"));
      worker.onmessageerror = () => this.fail(new Error("Model worker sent an unreadable message"));
      await this.withTimeout(0, null);
    } catch (error) {
      await this.fallback(error);
    }
  }

  /** Load the weights on the main thread when the worker cannot run. */
  private fallback(workerError: unknown): Promise<void> {
    if (this.local) return Promise.resolve();
    if (!this.fallbackPromise) {
      this.fallbackPromise = (async () => {
        try {
          const { createLocalScorer } = await import("./local");
          this.local = await createLocalScorer();
          this.failure = null;
        } catch (localError) {
          const combined = new Error(
            `Model worker failed (${message(workerError)}); local model failed (${message(localError)})`,
          );
          this.failure = combined;
          throw combined;
        }
      })();
    }
    return this.fallbackPromise;
  }

  private withTimeout(id: number, state: GameState | null): Promise<Scored> {
    return new Promise<Scored>((resolve, reject) => {
      const timer = setTimeout(() => {
        const timeout = new Error("Model load timed out");
        this.fail(timeout);
        reject(timeout);
      }, LOAD_TIMEOUT_MS);
      this.request(id, state, 0).then(
        (scored) => { clearTimeout(timer); resolve(scored); },
        (error: Error) => { clearTimeout(timer); reject(error); },
      );
    });
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }

  /** Every legal move for `player` with the model's score for each. */
  async score(state: GameState, player: number): Promise<Scored> {
    if (this.local) return this.local.score(state, player);
    if (this.failure) {
      await this.fallback(this.failure);
      return this.local!.score(state, player);
    }
    try {
      return await this.request(this.nextId++, state, player);
    } catch (error) {
      await this.fallback(error);
      return this.local!.score(state, player);
    }
  }

  dispose() {
    this.worker?.terminate();
  }

  private request(id: number, state: GameState | null, player: number): Promise<Scored> {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.worker) return Promise.reject(new Error("Model worker is not running"));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, state, player } as WorkerRequest);
    });
  }
}
