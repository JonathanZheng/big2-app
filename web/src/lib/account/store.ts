/**
 * The browser's copy of the signed-in account's history, and the changes
 * waiting to reach it. While a copy exists, the profile, saved reviews and
 * puzzle screens read from it. Storage can be blocked, so every access is
 * guarded; blocked storage behaves as signed out.
 */
import {
  type AccountHistory, type HistoryBundle, bundleOverlap, combineBundles, emptyBundle, isEmptyBundle, mergeHistory,
} from "./merge";

const ACCOUNT_KEY = "big2.account.v1";
const QUEUE_KEY = "big2.queue.v1";
const INFLIGHT_KEY = "big2.inflight.v1";

/** Fired on window after the account copy changes. */
export const HISTORY_EVENT = "big2-history";
/** Fired on window after a change is queued for upload. */
export const QUEUE_EVENT = "big2-history-queued";

export interface AccountCache {
  userId: string;
  history: AccountHistory;
}

type Queues = Record<string, HistoryBundle>;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: nothing is kept.
  }
}

function fire(type: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(type));
}

function setEntry(key: string, userId: string, bundle: HistoryBundle | null) {
  const all = read<Queues>(key) ?? {};
  if (bundle) all[userId] = bundle;
  else delete all[userId];
  write(key, Object.keys(all).length ? all : null);
}

export function readAccount(): AccountCache | null {
  return read<AccountCache>(ACCOUNT_KEY);
}

export function writeAccount(cache: AccountCache | null) {
  write(ACCOUNT_KEY, cache);
  fire(HISTORY_EVENT);
}

export function readQueue(userId: string): HistoryBundle | null {
  return read<Queues>(QUEUE_KEY)?.[userId] ?? null;
}

export function addToQueue(userId: string, change: Partial<HistoryBundle>) {
  setEntry(QUEUE_KEY, userId, combineBundles(readQueue(userId) ?? emptyBundle(), change));
}

/** Everything not yet confirmed by the account: changes in flight from any tab, then the queue. */
export function readPending(userId: string): HistoryBundle | null {
  const inflight = read<Queues>(INFLIGHT_KEY)?.[userId] ?? null;
  const queued = readQueue(userId);
  return inflight || queued ? combineBundles(inflight ?? emptyBundle(), queued ?? {}) : null;
}

/** Move this account's queue into flight (with anything still in flight from before) and return it. */
export function takeQueue(userId: string): HistoryBundle | null {
  const inflight = read<Queues>(INFLIGHT_KEY)?.[userId] ?? null;
  const queued = readQueue(userId);
  if (!inflight && !queued) return null;
  const bundle = combineBundles(inflight ?? emptyBundle(), queued ?? {});
  setEntry(INFLIGHT_KEY, userId, bundle);
  setEntry(QUEUE_KEY, userId, null);
  return read<Queues>(INFLIGHT_KEY)?.[userId] ?? null;
}

/**
 * Drop a flight that reached the account, or put a failed one back ahead of
 * newer changes. Only what this flight sent is touched: another tab may have
 * taken more into flight meanwhile.
 */
export function finishInflight(userId: string, ok: boolean, sent: HistoryBundle | null) {
  const inflight = read<Queues>(INFLIGHT_KEY)?.[userId] ?? null;
  if (!inflight || !sent) return;
  const rest = bundleOverlap(inflight, sent, false);
  setEntry(INFLIGHT_KEY, userId, isEmptyBundle(rest) ? null : rest);
  const mine = bundleOverlap(inflight, sent, true);
  if (!ok && !isEmptyBundle(mine)) setEntry(QUEUE_KEY, userId, combineBundles(mine, readQueue(userId) ?? {}));
}

/** Apply a change to the account copy and queue it for upload. False when signed out. */
export function queueChange(change: Partial<HistoryBundle>): boolean {
  const account = readAccount();
  if (!account) return false;
  addToQueue(account.userId, change);
  write(ACCOUNT_KEY, { ...account, history: mergeHistory(account.history, change) });
  fire(HISTORY_EVENT);
  fire(QUEUE_EVENT);
  return true;
}

/** Calls back when the account copy changes in this tab or another. */
export function subscribeHistory(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(HISTORY_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(HISTORY_EVENT, onChange);
  };
}
