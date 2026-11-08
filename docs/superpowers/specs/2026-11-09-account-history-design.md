# Account history design

## Intent

Today every vs-bots game, saved review, daily puzzle result and match win is kept only in the browser that played it. An account holds nothing but online-game stats and a display name. A player who plays as a guest, then creates an account, finds the profile page unchanged and their history tied to one browser.

The owner wants the account to be the home for a player's history. Sign in on any device and the profile shows the account's stats. Games played as a guest, on any device, end up in the account.

## Goals

1. **Guest history moves into the account on sign-in.** When a player signs in on a browser that holds guest data, that data is added to the account. This applies to a brand new account and to an existing one: a phone's guest games get added to an account that already has the laptop's history.
2. **Signed in, the account is the source.** The profile page, saved reviews list and daily puzzle screen show the account's data on every device.
3. **New activity while signed in is saved to the account.** Finished vs-bots games, their background analysis, match results, saved reviews, review deletions and puzzle answers all go to the account.
4. **Signing out returns the browser to an empty guest profile.**
5. **RESET STATS while signed in wipes the account's vs-bots history on every device.** The existing in-page confirm step stays.

## Non-goals

- Online-game stats (`player_stats`) and display names are untouched. They already live on the account.
- Card colour (`big2.accent.v1`) stays per device. It is a display preference, not history.
- No import prompt, no conflict screen and no choice of which history to keep. Merging is automatic.
- No live push of changes between two devices open at the same time. A device picks up account changes when the page loads or the player signs in.
- Pass-and-play games still count for nobody, as today.

## Anti-goals (a failure even if it works)

- **One person's history leaking into another person's account.** A shared browser must never upload games from a previous signed-in session into whoever signs in next. This is why guest data is moved, not copied, and why sign-out clears the browser. The one accepted exception is history already sitting in browsers when this ships (see "What starts an upload").
- **Losing games.** A failed or partial upload must leave the guest data in place to retry. A game finished offline while signed in must not be dropped.
- **Counting a game twice.** Uploads may repeat (retries, two tabs, a refresh mid-upload). The same game must count once.
- **Breaking guest play.** Signed-out play, offline play and builds without Supabase settings keep working exactly as now.

## Data that moves

| Browser key | What it is | Account behaviour |
|---|---|---|
| `big2.games.v1` | Up to 500 vs-bots game records (`GameRecord` in `web/src/lib/session/profile.ts`), each with `at` (end time in ms), difficulty, result, plays, suits, hints and an optional `analysis` added later in the background | Keyed per account by `at`. Merge is a union; a duplicate `at` is the same game. A record arriving with `analysis` fills in a stored record that lacks it. The account keeps the newest 500 by `at`. |
| `big2.stats.v1` | Counts: `games`, `wins`, `matches`, `matchWins` (`web/src/lib/session/stats.ts`). Only the MATCHES WON tile reads from here (`matches`/`matchWins`), since matches are not in game records. The GAMES and WINS tiles count game records, and nothing reads the stored `games`/`wins` | Only `matches` and `matchWins` move; they are added to the account's counts. Counts have no natural key, so each upload needs its own id so a retry does not add them twice. |
| `big2.reviews.v1` | Up to 50 saved reviews (`SavedReview` in `web/src/lib/session/saved-reviews.ts`), keyed by `id`, each holding a final `GameState` | Union by `id`. Deleting a review while signed in deletes it from the account. The account keeps the newest 50 by `at`. |
| `big2.puzzles.v1` | Daily puzzle answers, keyed by day (`PuzzleResult` in `web/src/lib/puzzle/puzzle.ts`) | Union by day. If both sides answered the same day, keep the better label. |

## Behaviour

**Signing in.** After sign-in succeeds, the browser sends its guest data to the account. Only after the account confirms it has stored everything does the browser clear those guest keys. If the upload fails, the guest data stays and the upload is retried on the next page load while signed in. The merge rules above make a repeat upload harmless.

**What starts an upload.** The trigger is simply "signed in, and the browser holds guest data", checked after sign-in and on every page load. This one rule covers three cases: a fresh sign-in, a retry after a failed upload, and browsers that are already signed in when this ships. Those browsers hold history from before the feature existed, and on their first load after the update that history is uploaded into the signed-in account and then cleared. At that moment the guest data is handed to the signed-in account: it leaves the guest keys and waits in that account's own upload queue. If the upload fails and the player signs out before a retry succeeds, it stays queued for that account and is sent the next time that account is signed in and online. It never goes to a different account.

**Signed in.** Screens read the account's data. Each finished game, analysis, match result, saved review, deletion and puzzle answer is written to the account. If the write cannot reach the account (offline, network error), it is held in the browser and sent when the connection returns. Held items are tied to the account they were made under; if a different account signs in first, they are not sent to it.

**Signing out.** The browser clears any copy of the account's data it was showing. The profile, saved reviews and puzzle screen show an empty guest state. Items still waiting to upload for that account are the one exception the builder needs to decide on (see below).

**RESET STATS while signed in.** After the existing confirm, the account's game records and its match counts are deleted. Other devices show the empty state the next time they load. Saved reviews and puzzle results are not part of RESET STATS today and stay that way. The reset deletes what the account holds at that moment and nothing more: there is no stored reset time, so games that reach the account afterwards (held offline on another device, or guest games merged on a later sign-in) are added as normal, in line with goal 1. A reset is never held for later. While offline the button tells the player it needs a connection, so a late reset can never wipe games saved after it was pressed.

**Signed out, or no Supabase settings.** Everything works from the browser, as today.

## Constraints

- Next.js app in `web/`, Supabase for auth and data, deployed on Vercel. New tables go in a new migration under `web/supabase/migrations/`.
- The existing migration's convention: signed-in players can only `select`, and only their own rows; all writes go through the server route `web/src/app/api/online/route.ts` using the secret key (`admin()` and `requireUser()` in `web/src/lib/online/server.ts`). Signed-out visitors get nothing.
- Only the owner can read or write their history.
- Storage access in the browser is already wrapped in try/catch because storage can be blocked; keep that.
- The service worker caches the app for offline play; this feature must not stop the app loading offline.
- Unit tests run under vitest. The online integration test (`online.integration.test.ts`) runs against a local Supabase and is the model for an end-to-end check of this feature.

## Decided by the owner

- The account is the source of stats on every device.
- Guest games from every device are added to the account on sign-in, including into an account that already has history.
- Signing out returns the browser to an empty profile.
- RESET STATS while signed in wipes the account's history everywhere.
- Browsers already signed in when this ships upload their existing browser history into that account on the first load after the update, accepting the small risk on a browser shared by two people.

## Calls made by Claude (owner can overrule)

- Merging is automatic, with no prompt.
- Guest data is moved (cleared after a confirmed upload), not copied, to meet the shared-browser anti-goal.
- Saved reviews and puzzle results move with the account; card colour does not.
- The account keeps the same caps as the browser: 500 games, 50 saved reviews.
- For a puzzle answered on both sides, the better label wins.
- Writes made while offline are held and sent later, tied to the account that made them.
- RESET STATS is a plain delete of what the account holds, needs a connection, and does not block older games that arrive later.
- Guest data is handed to the signed-in account the moment it is picked up, so an upload that fails before sign-out waits for that same account, never the next one.

## Left to the builder

- Table layout (one row per game record, review and puzzle day is the natural fit for union-by-key merging and for trimming to the caps).
- Whether writes go through the existing server route, following the repo's convention, or through own-row policies written directly from the browser. The data is self-reported by the client either way, so this is a consistency and simplicity choice, not a trust one.
- How the profile, saved reviews and puzzle screens switch between browser data and account data. They currently read storage through `useSyncExternalStore`.
- How held offline writes are stored and flushed.
- What happens to writes still waiting to upload when the player signs out (sending them first, or keeping them for that account's next sign-in, both meet the goals; dropping them does not).
- Ranking of puzzle labels for "better", from the existing `Label` order.
