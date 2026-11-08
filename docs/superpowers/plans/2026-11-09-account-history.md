# Account History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save vs-bots games, match counts, saved reviews and daily puzzle results to the signed-in account, move guest data into the account on sign-in, and return the browser to an empty profile on sign-out.

**Architecture:** One pure merge module defines the data shapes and every merge rule, and both the browser and the server use it. The server keeps one row per game, review, puzzle day and match upload in new Supabase tables, written only by a new `/api/history` route with the secret key. In the browser, a cached copy of the account's history in localStorage (`big2.account.v1`) switches the existing session modules from guest storage to account storage. Writes go into a per-account upload queue that a small `AccountSync` component flushes.

**Tech Stack:** Next.js 16 (app router), TypeScript, Supabase (`@supabase/supabase-js`, Postgres migrations), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-account-history-design.md`

## Global Constraints

- All app code lives in `web/`. Run commands from `web/`.
- Caps: the account keeps the newest **500** games (by `at`) and newest **50** saved reviews (by `at`), the same as the browser.
- Puzzle "better" order, best first: `Best`, `Good`, `Inaccuracy`, `Mistake`, `Blunder` (the `Label` type in `src/lib/model/advice.ts`). On a tie, keep the existing result.
- Only `matches` and `matchWins` move from `big2.stats.v1`. `games` and `wins` there are unused.
- Card colour (`big2.accent.v1`) and online stats (`player_stats`) are untouched.
- New tables: RLS enabled, all privileges granted to `service_role` only. No access for `anon` or `authenticated`.
- Every localStorage access stays wrapped in try/catch, as the existing modules do.
- UI copy is uppercase, matching the app. No em dashes or en dashes anywhere (code, copy, comments, commits).
- Commit messages start with `feat:`, `fix:`, `doc:`, `chore:` or `test:`. No co-author line.
- Builds without Supabase settings (`onlineClient()` returns null) behave exactly as today.

## Review Focus

1. **The same upload sent twice** (retry after a timeout, two tabs, refresh mid-request) must not count a game or a match twice. Pinned in Task 1 (`merge is idempotent`) and Task 2 (integration `merging twice counts once`).
2. **A change made while an upload is in flight** (a game finishes during a flush) must still reach the account. Pinned in Task 5 (`keeps changes queued during a flush`).
3. **A different account signing in on a browser that holds another account's queue** must not send that queue. Pinned in Task 5 (`never sends another account's queue`).
4. **Blocked storage** (localStorage throws) must not crash play: guest mode is used and queued writes are dropped quietly. Pinned in Task 3 (`survives blocked storage`).
5. **A malformed or oversized body sent to `/api/history`** gets a 400 and writes nothing. Pinned in Task 2 (`parseBundle` tests).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/account/merge.ts` (create) | Shared types and pure merge rules: `AccountHistory`, `HistoryBundle`, `mergeHistory`, `combineBundles`, `historyChanges`, `betterPuzzle` |
| `src/lib/account/validate.ts` (create) | `parseBundle(value: unknown)`: shape and size checks for the route |
| `supabase/migrations/20261109000000_account_history.sql` (create) | Four tables, RLS, grants |
| `src/lib/account/server.ts` (create) | Server-only DB access: `loadHistory`, `mergeIntoAccount`, `resetHistory` |
| `src/app/api/history/route.ts` (create) | `POST` with actions `load`, `merge`, `reset` |
| `src/lib/account/store.ts` (create) | Browser storage: account cache, per-account queue, in-flight slot, `queueChange`, events |
| `src/lib/account/guest.ts` (create) | `readGuestBundle`, `clearGuest`: reading guest keys as one bundle |
| `src/lib/account/sync.ts` (create) | Network side in the browser: `syncAccount`, `flushAccount`, `resetAccountHistory`, `signOutAccount` |
| `src/components/account-sync.tsx` (create) | Mounted in the layout: auth listener, flush on queue change and on `online` |
| `src/lib/session/profile.ts`, `stats.ts`, `saved-reviews.ts`, `src/lib/puzzle/puzzle.ts` (modify) | Read from the account cache when signed in; write through `queueChange` |
| `src/components/profile-screen.tsx`, `puzzle-screen.tsx`, `account-section.tsx`, `src/app/layout.tsx` (modify) | Re-render on history events, account-aware reset, sign-out through `signOutAccount`, mount `AccountSync` |

---

### Task 1: Shared types and merge rules

**Files:**
- Create: `src/lib/account/merge.ts`
- Test: `src/lib/account/merge.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const GAME_CAP = 500, REVIEW_CAP = 50;
  export interface AccountHistory { games: GameRecord[]; reviews: SavedReview[]; puzzles: Record<string, PuzzleResult>; matches: number; matchWins: number }
  export interface MatchUpload { id: string; matches: number; matchWins: number }
  export interface HistoryBundle { games: GameRecord[]; reviews: SavedReview[]; deletedReviews: string[]; puzzles: Record<string, PuzzleResult>; matches: MatchUpload[] }
  export function emptyHistory(): AccountHistory;
  export function emptyBundle(): HistoryBundle;
  export function isEmptyBundle(b: HistoryBundle): boolean;
  export function betterPuzzle(existing: PuzzleResult | undefined, incoming: PuzzleResult): PuzzleResult;
  export function mergeHistory(history: AccountHistory, change: Partial<HistoryBundle>): AccountHistory;
  export function combineBundles(earlier: HistoryBundle, later: Partial<HistoryBundle>): HistoryBundle;
  export interface HistoryChanges { upsertGames: GameRecord[]; deleteGames: number[]; upsertReviews: SavedReview[]; deleteReviews: string[]; upsertPuzzles: Record<string, PuzzleResult> }
  export function historyChanges(before: AccountHistory, after: AccountHistory): HistoryChanges;
  ```
  Types are imported with `import type` from `@/lib/session/profile`, `@/lib/session/saved-reviews`, `@/lib/puzzle/puzzle`.

Rules `mergeHistory` must follow:
- games: union by `at`. If both sides have an `at`, keep the existing record, except when it has no `analysis` and the incoming one does. Sorted ascending by `at`, keep the last `GAME_CAP`.
- reviews: union by `id`, incoming replaces existing. Then remove every id in `deletedReviews`. Sorted descending by `at`, keep the first `REVIEW_CAP`.
- puzzles: per day, `betterPuzzle`.
- matches: add every `MatchUpload`'s `matches` and `matchWins` to the totals. The browser uses this only for its optimistic copy. The server counts matches by upload id instead (Task 2).

`combineBundles(earlier, later)` is for the upload queue, where order matters: a review saved in `later` is removed from `deletedReviews`, and a review deleted in `later` is removed from `reviews`. Games and puzzles follow the same rules as `mergeHistory`, without caps. `matches` are concatenated.

`historyChanges` gives the rows the server must write: games and reviews present in `after` that are new or different from `before` (compare with `JSON.stringify`), games and reviews in `before` but missing from `after`, and puzzle days whose value changed.

- [ ] **Step 1: Write the failing tests** in `merge.test.ts`, using small `GameRecord`, `SavedReview` and `PuzzleResult` factories like those in `src/lib/session/saved-reviews.test.ts`:
  - `merge is idempotent`: `mergeHistory(mergeHistory(h, b), b)` deep-equals `mergeHistory(h, b)` for games, reviews and puzzles.
  - `fills in a missing analysis but never removes one`: an existing record without `analysis` gains it from the incoming one. An existing record with `analysis` keeps it when the incoming one has none.
  - `keeps the newest 500 games in time order`: merging 510 games gives 500, with `at` ascending, the oldest 10 dropped.
  - `keeps the newest 50 reviews, newest first, and applies deletions`.
  - `keeps the better puzzle result`: `Good` beats `Mistake` either way round, and a tie keeps the existing result.
  - `adds match uploads to the totals`: `{matches: 1, matchWins: 1}` plus `{matches: 2, matchWins: 0}` on top of 3/1 gives 6/2.
  - `combineBundles respects order`: save then delete leaves the id deleted, and delete then save leaves it saved.
  - `historyChanges lists only what changed`: an unchanged game is absent from `upsertGames`, a newly analysed game is present, and a trimmed game is in `deleteGames`.
- [ ] **Step 2: Run** `npx vitest run src/lib/account/merge.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `src/lib/account/merge.ts` with the interfaces above.
- [ ] **Step 4: Run** `npx vitest run src/lib/account/merge.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/account && git commit -m "feat: add merge rules for account history"`

---

### Task 2: Database, server and `/api/history` route

**Files:**
- Create: `supabase/migrations/20261109000000_account_history.sql`
- Create: `src/lib/account/validate.ts`, `src/lib/account/server.ts`, `src/app/api/history/route.ts`
- Test: `src/lib/account/validate.test.ts`, `src/lib/account/history.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `mergeHistory`, `historyChanges`, `emptyHistory`. `admin()`, `requireUser()` and `HttpError` from `src/lib/online/server.ts`.
- Produces:
  - `parseBundle(value: unknown): HistoryBundle` (throws `HttpError(400, "The history was not valid.")`).
  - `loadHistory(userId: string): Promise<AccountHistory>`, `mergeIntoAccount(userId: string, bundle: HistoryBundle): Promise<AccountHistory>`, `resetHistory(userId: string): Promise<AccountHistory>`.
  - `POST /api/history` with bearer token, body `{ action: "load" }`, `{ action: "merge", bundle }` or `{ action: "reset" }`. Every success returns `{ history: AccountHistory }`. Errors return `{ error }` with the `HttpError` status, matching `src/app/api/online/route.ts`.

Migration tables (all `user_id uuid not null references auth.users on delete cascade`):
- `history_games (user_id, at bigint, record jsonb not null, primary key (user_id, at))`
- `history_reviews (user_id, id text, at bigint not null, review jsonb not null, primary key (user_id, id))`
- `history_puzzles (user_id, day text, result jsonb not null, primary key (user_id, day))`
- `history_matches (user_id, upload_id text, matches int not null, match_wins int not null, primary key (user_id, upload_id))`

Enable RLS on all four. `grant select, insert, update, delete ... to service_role`, nothing to `authenticated` or `anon`, with a comment saying only `/api/history` touches them.

`parseBundle` limits: `games` at most 500, `reviews` at most 50, `deletedReviews` at most 200 strings of at most 100 characters, `puzzles` at most 400 keys each matching `/^\d{4}-\d{2}-\d{2}$/` with a known `label`, `matches` at most 500 entries, each with a string `id` of at most 64 characters and integer counts from 0 to 100 where `matchWins <= matches`. Every game needs a finite numeric `at`, and every review a string `id` and numeric `at`. Missing arrays or objects default to empty.

`mergeIntoAccount`: `before = loadHistory`, `after = mergeHistory(before, {...bundle, matches: []})`, write `historyChanges(before, after)` (upserts with `onConflict` on the primary key, deletes by key), insert `bundle.matches` with `upsert(..., { onConflict: "user_id,upload_id", ignoreDuplicates: true })`, then return `loadHistory(userId)`. `loadHistory` sums `history_matches` for the totals. `resetHistory` deletes the user's `history_games` and `history_matches` rows and returns `loadHistory`.

- [ ] **Step 1: Write the failing `validate.test.ts`**: `accepts a valid bundle and fills missing parts` (`parseBundle({games: []})` gives an empty bundle), `rejects too many games` (501 games throws an error with status 400), `rejects a bad puzzle day or label`, `rejects matchWins above matches`, `rejects a non-object body`.
- [ ] **Step 2: Run** `npx vitest run src/lib/account/validate.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `parseBundle`** in `validate.ts`.
- [ ] **Step 4: Run** `npx vitest run src/lib/account/validate.test.ts`. Expected: PASS.
- [ ] **Step 5: Write the migration, `server.ts` and `route.ts`** as specified above. `server.ts` starts with `import "server-only";`.
- [ ] **Step 6: Write `history.integration.test.ts`**, skipped unless `ONLINE_TEST_APP` is set, reusing the `player()` helper pattern from `src/lib/online/online.integration.test.ts`:
  - `requires sign-in`: POST without a token gives 401.
  - `merging twice counts once`: merging the same bundle (2 games, 1 review, 1 puzzle, match upload `{id: "m1", matches: 1, matchWins: 1}`) twice gives 2 games, 1 review and `matches: 1`.
  - `keeps the better puzzle and fills in analysis` across two merges.
  - `reset clears games and matches but keeps reviews and puzzles`.
  - `players cannot read the tables directly`: `p.db.from("history_games").select()` returns no rows or an error.
- [ ] **Step 7: Run it against local Supabase:**
  ```bash
  supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,storage-api,postgres-meta
  supabase db reset   # applies both migrations
  # .env.local holds the local URL and keys from `supabase status -o env`
  PORT=3123 npm run dev &
  ONLINE_TEST_APP=http://localhost:3123 npx vitest run src/lib/account/history.integration.test.ts
  ```
  Expected: 5 passed.
- [ ] **Step 8: Run** `npx tsc --noEmit && npx eslint src/lib/account src/app/api/history`. Expected: no errors.
- [ ] **Step 9: Commit** `git add supabase/migrations src/lib/account src/app/api/history && git commit -m "feat: store account history in Supabase behind /api/history"`

---

### Task 3: Browser account cache and upload queue

**Files:**
- Create: `src/lib/account/store.ts`
- Test: `src/lib/account/store.test.ts`

**Interfaces:**
- Consumes: Task 1 (`AccountHistory`, `HistoryBundle`, `mergeHistory`, `combineBundles`, `emptyBundle`).
- Produces:
  ```ts
  export const HISTORY_EVENT = "big2-history";   // dispatched on window after any cache change
  export const QUEUE_EVENT = "big2-history-queued"; // dispatched on window after queueChange
  export interface AccountCache { userId: string; history: AccountHistory }
  export function readAccount(): AccountCache | null;           // key "big2.account.v1"
  export function writeAccount(cache: AccountCache | null): void; // null removes; dispatches HISTORY_EVENT
  export function readQueue(userId: string): HistoryBundle | null; // key "big2.queue.v1", a Record<userId, HistoryBundle>
  export function addToQueue(userId: string, change: Partial<HistoryBundle>): void; // combineBundles onto that user's entry
  export function takeQueue(userId: string): HistoryBundle | null; // moves the entry into "big2.inflight.v1" (Record<userId, HistoryBundle>), combining with anything already in flight, and returns it
  export function finishInflight(userId: string, ok: boolean): void; // ok: drop it; not ok: combineBundles(inflight, queue) back into the queue
  export function queueChange(change: Partial<HistoryBundle>): boolean; // no account cache: returns false. Otherwise addToQueue + mergeHistory into the cache, dispatches both events, returns true
  export function subscribeHistory(onChange: () => void): () => void; // listens to "storage" and HISTORY_EVENT
  ```
- [ ] **Step 1: Write the failing tests** with the `memoryStorage()` stub pattern (add `removeItem`) and a stubbed `window` that has `dispatchEvent`, `addEventListener` and `removeEventListener`:
  - `queueChange without an account returns false and stores nothing`.
  - `queueChange updates the cache and queues for that account`: after `writeAccount({userId: "a", history: emptyHistory()})` and `queueChange({games: [g1]})`, `readAccount().history.games` has `g1`, `readQueue("a").games` has `g1`, and `readQueue("b")` is null.
  - `a failed flight goes back ahead of newer changes`: `takeQueue("a")`, then `addToQueue("a", {deletedReviews: ["r1"]})` where the flight saved `r1`, then `finishInflight("a", false)`. The queue keeps `r1` deleted.
  - `a successful flight is dropped`: `finishInflight("a", true)` leaves only changes added after `takeQueue`.
  - `survives blocked storage`: with `getItem` and `setItem` throwing, `readAccount()` is null, `queueChange` returns false, and nothing throws.
- [ ] **Step 2: Run** `npx vitest run src/lib/account/store.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `store.ts`.
- [ ] **Step 4: Run** `npx vitest run src/lib/account/store.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/lib/account && git commit -m "feat: keep a browser copy of account history and an upload queue"`

---

### Task 4: Session modules read and write the account when signed in

**Files:**
- Modify: `src/lib/session/profile.ts`, `src/lib/session/stats.ts`, `src/lib/session/saved-reviews.ts`, `src/lib/puzzle/puzzle.ts`
- Create: `src/lib/account/guest.ts`
- Test: extend `src/lib/session/profile.test.ts`, `stats.test.ts`, `saved-reviews.test.ts`, `src/lib/puzzle/puzzle.test.ts`. Create `src/lib/account/guest.test.ts`.

**Interfaces:**
- Consumes: Task 3 `readAccount`, `queueChange`.
- Produces:
  - In each module, the current storage body moves into an exported guest reader and the public reader checks the account first: `readGuestGameRecords()`, `readGuestStats()`, `readGuestReviews()`, `readGuestResults()`. Also add `clearGuestReviews()` and `clearGuestResults()`. `clearProfile()` stays as the guest clear for games and stats.
  - Signed in (`readAccount()` not null):
    - `readGameRecords` returns `history.games`.
    - `saveGameRecord(r)` calls `queueChange({games: [r]})`.
    - `attachAnalysis(at, a)` finds the record in `history.games` and queues it with `analysis`.
    - `readStats` returns `{games: games.length, wins: <won count>, matches, matchWins}` from the history.
    - `recordGame` does nothing.
    - `recordMatch(won)` queues `{matches: [{id: crypto.randomUUID(), matches: 1, matchWins: won ? 1 : 0}]}`.
    - `readSavedReviews` returns `history.reviews`.
    - `saveReview` queues and returns `queueChange`'s result.
    - `deleteSavedReview(id)` queues `{deletedReviews: [id]}`.
    - `readResults` returns `history.puzzles`.
    - `saveResult(day, r)` queues `{puzzles: {[day]: r}}`.
  - Signed out: behaviour is unchanged.
  - `guest.ts`: `readGuestBundle(): HistoryBundle | null` (null when there are no games, reviews or puzzles and `matches` is 0; guest match counts become one `MatchUpload` with `id: crypto.randomUUID()`), and `clearGuest(): void` (`clearProfile`, `clearGuestReviews`, `clearGuestResults`).
- [ ] **Step 1: Write the failing tests.** Add a `signed in` describe block to each existing test file that calls `writeAccount({userId: "a", history: emptyHistory()})` first:
  - `profile.test.ts`: `saves games to the account, not the browser`: after `saveGameRecord(g)`, `readGameRecords()` has `g`, `readGuestGameRecords()` is empty, and `readQueue("a").games` has `g`. `attaches analysis to the account copy`.
  - `stats.test.ts`: `records matches to the account`: `recordMatch(true)` makes `readStats()` show matches 1 and matchWins 1, and the guest stats stay zero.
  - `saved-reviews.test.ts`: `saves and deletes reviews on the account`.
  - `puzzle.test.ts`: `saves puzzle results to the account`.
  - `guest.test.ts`: `bundles every guest key`, `is null when the browser has nothing`, `clearGuest empties every guest key and leaves the colour`.
- [ ] **Step 2: Run** `npx vitest run src/lib/session src/lib/puzzle src/lib/account/guest.test.ts`. Expected: the new tests FAIL and the existing ones PASS.
- [ ] **Step 3: Implement** the module changes and `guest.ts`.
- [ ] **Step 4: Run** `npx vitest run src/lib/session src/lib/puzzle src/lib/account`. Expected: all PASS.
- [ ] **Step 5: Commit** `git add src/lib && git commit -m "feat: read and write history on the account when signed in"`

---

### Task 5: Sync with the server

**Files:**
- Create: `src/lib/account/sync.ts`
- Test: `src/lib/account/sync.test.ts`

**Interfaces:**
- Consumes: Task 3 store functions, Task 4 `readGuestBundle` and `clearGuest`, `onlineClient()` and `OnlineError` from `src/lib/online/client.ts`, `mergeHistory` and `emptyHistory`.
- Produces:
  ```ts
  export function callHistory(body: { action: "load" } | { action: "merge"; bundle: HistoryBundle } | { action: "reset" }): Promise<AccountHistory>; // like callOnline, but POSTs to /api/history and returns body.history; throws OnlineError
  export function syncAccount(userId: string): Promise<boolean>;
  export function flushAccount(userId: string): Promise<boolean>;
  export function resetAccountHistory(): Promise<void>;  // throws OnlineError("RESET NEEDS A CONNECTION.") when offline or the flush fails
  export function signOutAccount(): Promise<void>;
  ```
  - `syncAccount(userId)`: if `readAccount()` belongs to another user, `writeAccount(null)`. Hand guest data to this account with `readGuestBundle()`, then `addToQueue(userId, bundle)` and `clearGuest()`. If there is still no account cache for this user, write one at once with `writeAccount({userId, history: mergeHistory(emptyHistory(), readQueue(userId) ?? {})})`, so the profile keeps showing the handed-over games even if the first upload fails or the browser is offline. Then `flushAccount(userId)`.
  - `flushAccount(userId)`: one flush at a time per tab (keep a module-level promise and return it if one is running). `takeQueue(userId)`, then `callHistory` with `merge` if there's something to send, otherwise `load`. Then `finishInflight(userId, ok)`. On success, `writeAccount({userId, history: mergeHistory(response, readQueue(userId) ?? {})})` so changes still queued keep showing. Returns `ok`.
  - `resetAccountHistory()`: needs a signed-in session and `navigator.onLine`, then `await flushAccount` must return true, then `callHistory({action: "reset"})`, then `writeAccount` with the result.
  - `signOutAccount()`: tries `flushAccount` (a failure leaves the queue for that account), then `writeAccount(null)` and `supabase.auth.signOut()`.
- [ ] **Step 1: Write the failing tests.** Mock `@/lib/online/client` with `vi.mock` so `onlineClient()` returns a fake whose `auth.getSession` gives `{session: {access_token: "t", user: {id: "a"}}}` and whose `auth.signOut` is a spy. Stub `fetch`, `localStorage`, `window` and `crypto.randomUUID`. Tests:
  - `uploads guest data on sign-in and clears it`: with a guest game in storage, `syncAccount("a")` sends a merge whose bundle has the game. Afterwards the guest keys are empty and `readAccount().history` equals the stubbed response.
  - `keeps guest data queued for the account when the upload fails`: fetch rejects, so the guest keys are empty, `readQueue("a")` has the game, `readAccount().history.games` still shows it, and `syncAccount` resolves false.
  - `never sends another account's queue`: with a queue for `"b"`, `syncAccount("a")` sends no `"b"` data, and `readQueue("b")` is unchanged.
  - `keeps changes queued during a flush`: start `flushAccount("a")` with fetch held on a pending promise, call `queueChange({games: [g2]})`, then resolve the fetch with a history that lacks `g2`. `readQueue("a").games` has `g2` and `readAccount().history.games` has `g2`.
  - `reset refuses while offline`: with `navigator.onLine` false, it rejects with `RESET NEEDS A CONNECTION.` and fetch is not called.
  - `sign-out clears the account copy`: after `signOutAccount()`, `readAccount()` is null and `signOut` was called.
- [ ] **Step 2: Run** `npx vitest run src/lib/account/sync.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `sync.ts`.
- [ ] **Step 4: Run** `npx vitest run src/lib/account`. Expected: all PASS.
- [ ] **Step 5: Commit** `git add src/lib/account && git commit -m "feat: sync account history with the server"`

---

### Task 6: Wire it into the app

**Files:**
- Create: `src/components/account-sync.tsx`
- Modify: `src/app/layout.tsx`, `src/components/profile-screen.tsx`, `src/components/puzzle-screen.tsx`, `src/components/account-section.tsx`

**Interfaces:**
- Consumes: `syncAccount`, `flushAccount`, `resetAccountHistory`, `signOutAccount` (Task 5); `readAccount`, `writeAccount`, `subscribeHistory`, `QUEUE_EVENT` (Task 3); `clearProfile` (existing).
- Produces: `export function AccountSync(): null`.

Behaviour:
- `AccountSync` (`"use client"`) does nothing when `onlineClient()` is null. Otherwise it subscribes to `supabase.auth.onAuthStateChange`. On `INITIAL_SESSION` or `SIGNED_IN` with a session it calls `syncAccount(session.user.id)`. On a null session it calls `writeAccount(null)`. It also calls `flushAccount(readAccount().userId)` on window `online` and on `QUEUE_EVENT`, when an account cache exists. Mount it next to `<ServiceWorker />` in `layout.tsx`.
- `profile-screen.tsx` and `puzzle-screen.tsx`: their `subscribe` uses `subscribeHistory`.
- `profile-screen.tsx`, when `readAccount()` is not null:
  - the subtitle reads `STATS FROM YOUR VS BOTS GAMES, SAVED TO YOUR ACCOUNT.`
  - the confirm reads `DELETE EVERY VS BOTS STAT ON YOUR ACCOUNT, ON EVERY DEVICE?`
  - DELETE awaits `resetAccountHistory()`, showing its error message next to the buttons if it throws.
  - Signed out, it keeps today's copy and `clearProfile()`.
- `account-section.tsx`: SIGN OUT calls `signOutAccount().then(refresh)`.

- [ ] **Step 1: Implement** the component and edits above.
- [ ] **Step 2: Run** `npx tsc --noEmit && npx eslint src && npx vitest run --exclude '**/*.integration.test.ts'`. Expected: no type or lint errors, and all unit tests pass.
- [ ] **Step 3: Run** `npm run build`. Expected: build succeeds.
- [ ] **Step 4: Check it by hand** against local Supabase (Task 2 Step 7 setup), at `http://localhost:3123`. Use one browser profile. Local Supabase catches sign-in emails in its mail viewer at `http://localhost:54324`, so no real email is sent. Read each code there:
  1. Signed out, finish one Easy game and save its review. The profile shows 1 game.
  2. Sign in as user A. The profile still shows 1 game and the subtitle says SAVED TO YOUR ACCOUNT. In devtools, the `big2.games.v1` key is gone.
  3. Finish another game. The profile shows 2 games.
  4. Sign out. The profile is empty.
  5. Play 1 guest game, then sign in as A again. The profile shows 3 games.
  6. Sign out, then sign in as user B. The profile is empty, so none of A's games leaked.
  7. As A, press RESET STATS, then DELETE. Games go to 0 and the saved review is still listed.
  8. Turn devtools to Offline, finish a game, turn back Online. After a reload the game is still there.
- [ ] **Step 5: Commit** `git add src && git commit -m "feat: save profile history to the signed-in account"`

---

### Task 7: Ship

- [ ] **Step 1:** Push `account-history` and open a PR whose test plan lists Task 2 Step 7 and Task 6 Step 4.
- [ ] **Step 2:** Once the PR is approved, and before merging, apply the migration to the hosted project from `web/`: `supabase link --project-ref pqdrzoqabonimxgkmpmm` then `supabase db push`. Expected: `20261109000000_account_history.sql` applied.
- [ ] **Step 3:** After the production deploy, sign in on `https://big2-app.vercel.app/profile` in a browser that already holds history. The profile keeps its games, and the subtitle says SAVED TO YOUR ACCOUNT.
