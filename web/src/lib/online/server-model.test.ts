import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deal, mulberry32 } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("serverModel", () => {
  it("loads the model once and picks a legal move", async () => {
    const { serverModel } = await import("./server-model");
    const first = serverModel();
    expect(serverModel()).toBe(first);
    const model = await first;
    const state = deal(mulberry32(9));
    const move = model.best(state, state.current);
    expect(legalMoves(state, state.current).map((m) => m.join())).toContain(move.join());
  }, 60_000);

  it("tries again on the next request after a failed load", async () => {
    const cwd = process.cwd();
    vi.spyOn(process, "cwd").mockReturnValue("/no/such/dir");
    const { serverModel } = await import("./server-model");
    const failed = serverModel();
    await expect(failed).rejects.toThrow();
    vi.mocked(process.cwd).mockReturnValue(cwd);
    const retry = serverModel();
    expect(retry).not.toBe(failed);
    await expect(retry).resolves.toHaveProperty("best");
  }, 60_000);
});
