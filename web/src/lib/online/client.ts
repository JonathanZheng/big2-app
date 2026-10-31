/** Browser side of online play: sign-in, reading rooms, and sending actions to the server. */
import { type SupabaseClient, createClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/** The browser Supabase client, or null when this build has no Supabase settings. */
export function onlineClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  client = url && key ? createClient(url, key) : null;
  return client;
}

export class OnlineError extends Error {}

/** Send one action to the server as the signed-in player. */
export async function callOnline<T = { ok: true }>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const supabase = onlineClient();
  if (!supabase) throw new OnlineError("Online play is not set up on this site.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new OnlineError("Sign in first.");
  let response: Response;
  try {
    response = await fetch("/api/online", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new OnlineError("Could not reach the server. Check your connection.");
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new OnlineError(body.error ?? "Something went wrong.");
  return body;
}
