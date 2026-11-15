import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  session: null as { access_token: string } | null,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { getSession: async () => ({ data: { session: fake.session } }) } })),
}));

async function client() {
  return import("./client");
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://db.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pub");
  fake.session = { access_token: "tok" };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("onlineClient", () => {
  it("is null when the build has no Supabase settings, and stays null", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const { onlineClient } = await client();
    expect(onlineClient()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pub");
    expect(onlineClient()).toBeNull();
  });

  it("creates the client once", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const { onlineClient } = await client();
    expect(onlineClient()).toBe(onlineClient());
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith("http://db.test", "pub");
  });
});

describe("callOnline", () => {
  it("explains that online play is off when there is no client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { callOnline, OnlineError } = await client();
    await expect(callOnline("join")).rejects.toBeInstanceOf(OnlineError);
    await expect(callOnline("join")).rejects.toThrow("Online play is not set up on this site.");
  });

  it("asks for a sign-in when there is no session", async () => {
    fake.session = null;
    const { callOnline } = await client();
    await expect(callOnline("join")).rejects.toThrow("Sign in first.");
  });

  it("posts the action and payload with the token and returns the reply", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: "r1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { callOnline } = await client();
    await expect(callOnline("join", { code: "ABC" })).resolves.toEqual({ id: "r1" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/online");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ action: "join", code: "ABC" });
  });

  it("sends an empty payload by default", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { callOnline } = await client();
    await callOnline("heartbeat");
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ action: "heartbeat" });
  });

  it("reports a network failure as a connection problem", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("offline"); });
    const { callOnline } = await client();
    await expect(callOnline("join")).rejects.toThrow("Could not reach the server. Check your connection.");
  });

  it("shows the server's error, or a general one when the body is unreadable", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "That room is full." }), { status: 409 }));
    const { callOnline } = await client();
    await expect(callOnline("join")).rejects.toThrow("That room is full.");
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 502 }));
    await expect(callOnline("join")).rejects.toThrow("Something went wrong.");
  });
});
