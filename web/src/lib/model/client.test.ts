import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type GameState, deal, mulberry32 } from "@/lib/engine/game";
import { ModelClient } from "./client";
import type { WorkerRequest, WorkerResponse } from "./worker";

const local = vi.hoisted(() => ({ create: vi.fn(), score: vi.fn() }));
vi.mock("./local", () => ({ createLocalScorer: local.create }));

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failToStart = false;
  onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent: WorkerRequest[] = [];
  terminated = false;
  constructor() {
    if (FakeWorker.failToStart) throw new Error("module workers unsupported");
    FakeWorker.instances.push(this);
  }
  postMessage(m: WorkerRequest) { this.sent.push(m); }
  reply(data: WorkerResponse) { this.onmessage?.({ data }); }
  terminate() { this.terminated = true; }
}

const state: GameState = deal(mulberry32(1));
const fromLocal = { moves: [[9]], scores: Float32Array.from([0.5]) };
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A client whose worker has loaded the model. */
async function loadedClient() {
  const client = new ModelClient();
  const worker = FakeWorker.instances[0];
  worker.reply({ id: 0, moves: [], scores: [] });
  await client.ready;
  return { client, worker };
}

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.failToStart = false;
  vi.stubGlobal("Worker", FakeWorker);
  local.score.mockReset().mockResolvedValue(fromLocal);
  local.create.mockReset().mockResolvedValue({ score: local.score });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ModelClient with a working worker", () => {
  it("is ready once the worker answers the load check", async () => {
    const { worker } = await loadedClient();
    expect(worker.sent[0]).toEqual({ id: 0, state: null, player: 0 });
    expect(local.create).not.toHaveBeenCalled();
  });

  it("sends positions to the worker and returns its scores as floats", async () => {
    const { client, worker } = await loadedClient();
    const scored = client.score(state, 2);
    expect(worker.sent[1]).toEqual({ id: 1, state, player: 2 });
    worker.reply({ id: 99, moves: [], scores: [] }); // not ours: ignored
    worker.reply({ id: 1, moves: [[1], [2]], scores: [0.1, 0.9] });
    const result = await scored;
    expect(result.moves).toEqual([[1], [2]]);
    expect(result.scores).toBeInstanceOf(Float32Array);
    expect(Array.from(result.scores)).toEqual([Float32Array.from([0.1])[0], Float32Array.from([0.9])[0]]);
  });

  it("falls back to the main thread when the worker answers with an error", async () => {
    const { client, worker } = await loadedClient();
    const scored = client.score(state, 0);
    worker.reply({ id: 1, error: "out of memory" });
    await expect(scored).resolves.toBe(fromLocal);
    // Later requests go straight to the local model.
    await expect(client.score(state, 0)).resolves.toBe(fromLocal);
    expect(worker.sent).toHaveLength(2);
    expect(local.create).toHaveBeenCalledTimes(1);
  });

  it("terminates the worker when disposed", async () => {
    const { client, worker } = await loadedClient();
    client.dispose();
    expect(worker.terminated).toBe(true);
  });
});

describe("ModelClient when the worker fails", () => {
  it("loads the model locally when no worker can be started", async () => {
    FakeWorker.failToStart = true;
    const client = new ModelClient();
    await client.ready;
    await expect(client.score(state, 1)).resolves.toBe(fromLocal);
    expect(local.score).toHaveBeenCalledWith(state, 1);
    client.dispose(); // no worker: nothing to terminate
  });

  it("waits for the local model when asked to score before it has loaded", async () => {
    FakeWorker.failToStart = true;
    const client = new ModelClient();
    await expect(client.score(state, 1)).resolves.toBe(fromLocal);
    expect(local.create).toHaveBeenCalledTimes(1);
  });

  it("falls back when the worker reports an error while loading", async () => {
    const client = new ModelClient();
    FakeWorker.instances[0].onerror?.({ message: "" });
    await client.ready;
    expect(local.create).toHaveBeenCalledTimes(1);
  });

  it("falls back when the worker sends an unreadable message", async () => {
    const client = new ModelClient();
    FakeWorker.instances[0].onmessageerror?.();
    await client.ready;
    await expect(client.score(state, 0)).resolves.toBe(fromLocal);
  });

  it("falls back when the worker never finishes loading", async () => {
    vi.useFakeTimers();
    const client = new ModelClient();
    await vi.advanceTimersByTimeAsync(20_000);
    await client.ready;
    expect(local.create).toHaveBeenCalledTimes(1);
  });

  it("uses the local model for a request made after the worker failed", async () => {
    const { client, worker } = await loadedClient();
    worker.onerror?.({ message: "crashed" });
    await expect(client.score(state, 3)).resolves.toBe(fromLocal);
    expect(worker.sent).toHaveLength(1);
  });

  it("rejects a request that was waiting when the worker crashed, then recovers locally", async () => {
    const { client, worker } = await loadedClient();
    const scored = client.score(state, 0);
    worker.onerror?.({ message: "crashed" });
    worker.onerror?.({ message: "again" }); // only the first failure counts
    await expect(scored).resolves.toBe(fromLocal);
  });

  it("does not load the local model twice when the load check fails after a request already fell back", async () => {
    const client = new ModelClient();
    const worker = FakeWorker.instances[0];
    const scored = client.score(state, 0);
    worker.reply({ id: 1, error: "bad position" });
    await expect(scored).resolves.toBe(fromLocal);
    worker.onerror?.({ message: "crashed" });
    await client.ready;
    expect(local.create).toHaveBeenCalledTimes(1);
  });

  it("explains both failures when the local model cannot load either", async () => {
    FakeWorker.failToStart = true;
    local.create.mockRejectedValue(new Error("offline"));
    const client = new ModelClient();
    await expect(client.ready).rejects.toThrow("Model worker failed (module workers unsupported); local model failed (offline)");
    await expect(client.score(state, 0)).rejects.toThrow("local model failed (offline)");
  });

  it("describes failures that are not Error objects", async () => {
    vi.stubGlobal("Worker", class { constructor() { throw "blocked"; } });
    local.create.mockRejectedValue("no network");
    const client = new ModelClient();
    await expect(client.ready).rejects.toThrow("Model worker failed (blocked); local model failed (no network)");
    await settle();
  });
});
