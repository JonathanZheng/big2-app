/** Test-only helpers: an in-memory localStorage and a signed-in account copy. */
import { vi } from "vitest";
import { emptyHistory } from "./merge";
import { writeAccount } from "./store";

export function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

/** Fresh storage with account "a" signed in and its copy empty. */
export function signedIn(userId = "a") {
  vi.stubGlobal("localStorage", memoryStorage());
  writeAccount({ userId, history: emptyHistory() });
}
