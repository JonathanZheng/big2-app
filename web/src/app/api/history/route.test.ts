import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyBundle, emptyHistory } from "@/lib/account/merge";
import { MAX_REQUEST_BYTES } from "@/lib/account/validate";
import { HttpError } from "@/lib/online/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  loadHistory: vi.fn(),
  mergeIntoAccount: vi.fn(),
  resetHistory: vi.fn(),
}));

vi.mock("@/lib/online/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/online/server")>()),
  requireUser: mocks.requireUser,
}));
vi.mock("@/lib/account/server", () => ({
  loadHistory: mocks.loadHistory, mergeIntoAccount: mocks.mergeIntoAccount, resetHistory: mocks.resetHistory,
}));

const history = { ...emptyHistory(), matches: 2 };

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.requireUser.mockResolvedValue({ id: "u1" });
  mocks.loadHistory.mockResolvedValue(history);
  mocks.mergeIntoAccount.mockResolvedValue(history);
  mocks.resetHistory.mockResolvedValue(history);
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://app.test/api/history", {
    method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
  }));

async function expectError(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
}

describe("POST /api/history", () => {
  it("refuses a declared length over the limit before checking the sign-in", async () => {
    await expectError(await post({ action: "load" }, { "content-length": String(MAX_REQUEST_BYTES + 1) }), 413, "The request was too large.");
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("refuses a body over the limit even without a declared length", async () => {
    const big = JSON.stringify({ action: "load", pad: "x".repeat(MAX_REQUEST_BYTES) });
    await expectError(await post(big), 413, "The request was too large.");
  });

  it("passes on a sign-in refusal with its status", async () => {
    mocks.requireUser.mockRejectedValue(new HttpError(401, "Sign in first."));
    await expectError(await post({ action: "load" }), 401, "Sign in first.");
  });

  it("refuses a body that is not JSON and an unknown action", async () => {
    await expectError(await post("{"), 400, "The request was not valid.");
    await expectError(await post({ action: "drop" }), 400, "Unknown action.");
  });

  it("loads and resets the signed-in player's history", async () => {
    expect(await (await post({ action: "load" })).json()).toEqual({ history });
    expect(mocks.loadHistory).toHaveBeenCalledWith("u1");
    expect(await (await post({ action: "reset" })).json()).toEqual({ history });
    expect(mocks.resetHistory).toHaveBeenCalledWith("u1");
  });

  it("merges a valid bundle and refuses an invalid one", async () => {
    await expectError(await post({ action: "merge", bundle: { games: "lots" } }), 400, "The history was not valid.");
    expect(mocks.mergeIntoAccount).not.toHaveBeenCalled();
    expect(await (await post({ action: "merge", bundle: emptyBundle() })).json()).toEqual({ history });
    expect(mocks.mergeIntoAccount).toHaveBeenCalledWith("u1", emptyBundle());
  });

  it("logs unexpected failures and hides their details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.loadHistory.mockRejectedValue(new Error("db down"));
    await expectError(await post({ action: "load" }), 500, "Something went wrong on the server.");
    expect(log).toHaveBeenCalledWith("History action failed", expect.any(Error));
    log.mockRestore();
  });
});
