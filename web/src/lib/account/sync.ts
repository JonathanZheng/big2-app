/**
 * Browser side of account history: hands guest data to the account on
 * sign-in, sends queued changes, and keeps the account copy current.
 */
import { OnlineError, onlineClient } from "@/lib/online/client";
import { clearGuest, readGuestBundle } from "./guest";
import { type AccountHistory, type HistoryBundle, emptyHistory, isEmptyBundle, mergeHistory, splitBundle } from "./merge";
import { addToQueue, finishInflight, readAccount, readQueue, takeQueue, writeAccount } from "./store";

/** A request /api/history answered with an error status. */
class HistoryError extends OnlineError {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** The server will never accept this request as it is. An expired sign-in (401) is not that: it is sent again later. */
const refused = (error: unknown) => error instanceof HistoryError && error.status >= 400 && error.status < 500 && error.status !== 401;

type HistoryRequest = { action: "load" } | { action: "merge"; bundle: HistoryBundle } | { action: "reset" };

/** Send one history request as the signed-in player. */
export async function callHistory(request: HistoryRequest): Promise<AccountHistory> {
  const supabase = onlineClient();
  if (!supabase) throw new OnlineError("Online play is not set up on this site.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new OnlineError("Sign in first.");
  let response: Response;
  try {
    response = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(request),
    });
  } catch {
    throw new OnlineError("Could not reach the server. Check your connection.");
  }
  const body = (await response.json().catch(() => ({}))) as { history?: AccountHistory; error?: string };
  if (!response.ok || !body.history) throw new HistoryError(body.error ?? "Something went wrong.", response.status);
  return body.history;
}

/** The server's history with this account's still-queued changes shown on top. */
function show(userId: string, history: AccountHistory) {
  writeAccount({ userId, history: mergeHistory(history, readQueue(userId) ?? {}) });
}

async function flushOnce(userId: string): Promise<boolean> {
  const bundle = takeQueue(userId);
  let history: AccountHistory | null = null;
  try {
    for (const part of bundle && !isEmptyBundle(bundle) ? splitBundle(bundle) : []) {
      try {
        history = await callHistory({ action: "merge", bundle: part });
      } catch (error) {
        // Sending it again would be refused again, so it is dropped rather than retried forever.
        if (!refused(error)) throw error;
      }
    }
    history ??= await callHistory({ action: "load" });
  } catch {
    finishInflight(userId, false);
    const account = readAccount();
    if (account?.userId === userId) show(userId, account.history);
    return false;
  }
  finishInflight(userId, true);
  if (readAccount()?.userId === userId) show(userId, history);
  return true;
}

let flight: Promise<boolean> | null = null;

/** Send this account's queued changes (or just fetch its history). One flush runs at a time; changes queued meanwhile go next. */
export function flushAccount(userId: string): Promise<boolean> {
  flight ??= (async () => {
    try {
      let ok = await flushOnce(userId);
      while (ok && readQueue(userId)) ok = await flushOnce(userId);
      return ok;
    } finally {
      flight = null;
    }
  })();
  return flight;
}

/** After sign-in or on page load while signed in: hand guest data to this account, then sync. */
export function syncAccount(userId: string): Promise<boolean> {
  const current = readAccount();
  if (current && current.userId !== userId) writeAccount(null);
  const guest = readGuestBundle();
  if (guest) {
    addToQueue(userId, guest);
    clearGuest();
  }
  if (!readAccount()) writeAccount({ userId, history: mergeHistory(emptyHistory(), readQueue(userId) ?? {}) });
  return flushAccount(userId);
}

/** RESET STATS while signed in: needs a connection, and sends queued changes first. */
export async function resetAccountHistory(): Promise<void> {
  const offline = () => new OnlineError("RESET NEEDS A CONNECTION.");
  const userId = readAccount()?.userId;
  if (!userId || !navigator.onLine) throw offline();
  if (!(await flushAccount(userId))) throw offline();
  const history = await callHistory({ action: "reset" }).catch(() => {
    throw offline();
  });
  show(userId, history);
}

/** Try to send what is queued, then sign out; anything unsent waits for this account's next sign-in. */
export async function signOutAccount(): Promise<void> {
  const userId = readAccount()?.userId;
  if (userId) await flushAccount(userId);
  writeAccount(null);
  await onlineClient()?.auth.signOut();
}
