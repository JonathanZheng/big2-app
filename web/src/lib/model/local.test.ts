import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deal, mulberry32 } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import { createLocalScorer } from "./local";

const publicDir = path.resolve(__dirname, "../../../public");
const serveModel = async (url: string) => new Response(readFileSync(path.join(publicDir, url)));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createLocalScorer", () => {
  it("scores every legal move on the main thread", async () => {
    vi.stubGlobal("fetch", serveModel);
    const scorer = await createLocalScorer();
    const state = deal(mulberry32(5));
    const { moves, scores } = await scorer.score(state, state.current);
    expect(moves).toEqual(legalMoves(state, state.current));
    expect(scores).toHaveLength(moves.length);
  }, 60_000);

  it("names the file that could not be downloaded", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    await expect(createLocalScorer()).rejects.toThrow("Model manifest: HTTP 404");
    vi.stubGlobal("fetch", async (url: string) => (url.endsWith(".bin") ? new Response("", { status: 503 }) : serveModel(url)));
    await expect(createLocalScorer()).rejects.toThrow("Model weights: HTTP 503");
  });
});
