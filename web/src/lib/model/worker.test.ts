import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deal, mulberry32 } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import type { WorkerRequest, WorkerResponse } from "./worker";

const publicDir = path.resolve(__dirname, "../../../public");
const serveModel = async (url: string) => new Response(readFileSync(path.join(publicDir, url)));

let posted: WorkerResponse[];
let scope: { postMessage: (m: WorkerResponse) => void; onmessage: ((e: { data: WorkerRequest }) => Promise<void>) | null };

async function startWorker() {
  await import("./worker");
  return (data: WorkerRequest) => scope.onmessage!({ data });
}

beforeEach(() => {
  vi.resetModules();
  posted = [];
  scope = { postMessage: (m) => posted.push(m), onmessage: null };
  vi.stubGlobal("self", scope);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("model worker", () => {
  it("answers the load check and scores every legal move", async () => {
    vi.stubGlobal("fetch", serveModel);
    const send = await startWorker();
    const state = deal(mulberry32(3));
    await send({ id: 0, state: null as never, player: 0 });
    await send({ id: 1, state, player: state.current });
    expect(posted[0]).toEqual({ id: 0, moves: [], scores: [] });
    const reply = posted[1] as { id: number; moves: number[][]; scores: number[] };
    expect(reply.id).toBe(1);
    expect(reply.moves).toEqual(legalMoves(state, state.current));
    expect(reply.scores).toHaveLength(reply.moves.length);
  }, 60_000);

  it("reports a model that could not be downloaded", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    const send = await startWorker();
    await send({ id: 0, state: null as never, player: 0 });
    expect(posted[0]).toEqual({ id: 0, error: expect.stringMatching(/HTTP 404/) });
  });

  it("reports when the weights fail but the manifest loads", async () => {
    vi.stubGlobal("fetch", async (url: string) => (url.endsWith(".bin") ? new Response("", { status: 500 }) : serveModel(url)));
    const send = await startWorker();
    await send({ id: 0, state: null as never, player: 0 });
    expect(posted[0]).toEqual({ id: 0, error: "Error: Model weights: HTTP 500" });
  });
});
