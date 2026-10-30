# Big 2 Web App Design

## Intent

A Big 2 app to play against the trained bot, play with friends, and get the bot's advice during a real game at a table. It replaces the original `big2-web` app, which did not use the trained model, let players see each other's hands, and whose look the owner did not like.

## Goals

1. Three modes: vs bots, vs friends, best move.
2. The trained model (`models/selfplay_v1.pt`) runs in the browser for bots and advice. No server is needed for the bot modes.
3. Works well on both phones and laptops, with touch, mouse and keyboard.
4. House rules exactly as in the Python engine (see the README).

## Non-goals (for now)

- A turn timer in online games. Postponed by the owner.
- Rankings or ELO.

## Anti-goals

- Any player able to see another player's hand in online games.
- Advice that pretends to be more certain than it is.

## Look: Swiss brutal

Chosen from four directions on the design canvas (Swiss brutal, cyber terminal, pixel arcade, wabi-sabi).

- Off-white paper `#F2F0EA`, black ink `#111111`, white cards, one accent `#FF5A1F`, red suits `#C8102E`.
- Archivo (heavy weights for headings) and IBM Plex Mono for data and labels.
- Thick black borders and hard offset shadows; slightly thinner on phones.
- Tokens live in `web/src/app/globals.css`.

## Modes

### Vs bots

- Me against 3 bots. Difficulty: Easy (greedy), Medium (Smart), Hard (the trained model).
- Hint button: the best-move panel during my turn.
- Summary after each game; win counts kept in the browser, and in the account when logged in.

### Vs friends

- **One device:** passed around the table. Between turns a hand-off screen ("Pass to East, tap when ready") hides the hand.
- **Online:** create a room, share its code or link, 4 seats, the host fills empty seats with bots at a chosen difficulty. The server deals and checks every move, and each device only receives its own hand. Bots in online rooms run on the server. Reopening the link rejoins the seat. Live updates through Supabase.

### Best move

- Enter my hand, each opponent's card count (default 13), the move on the table and who played it, and cards already played.
- The model ranks every legal move.
- The model also uses who played which cards and the last 4 moves, so the more of that is entered, the better the advice. How much detail to ask for is left to the builder, with the default kept quick to fill in.

## Shared features

- **Card history:** a log grouped by trick (who played what, who passed), a 52-card "cards out" grid marked with who played each card, and a count of the 2s and Aces still out.
- **Sorting:** by rank, by suit, by combo (pairs, triples and five-card hands grouped, singles last). Manual reordering by drag (hold then drag on phones) that survives cards leaving the hand. Grouping selected cards so they stay together. Undo after a sort. The preferred sort applies on each deal.
- **Selecting:** tap to raise a card; slide across cards to select several on phones; tap a card to cycle through the combos it can make that beat the table. Cards that cannot be played right now are dimmed. The last move is highlighted. Bot speed setting.
- **Keyboard on laptops:** arrows move between cards, Space selects, Enter plays, P passes, S switches the sort, H shows hints.

## Advice: how scores are shown

The model scores every legal move with its prediction of the final result (winner 0.8 to 1.0, losers -0.8 to -1.0). Checked on 400 self-play games (17,780 decisions), the scores match real outcomes closely, so the app shows them as an estimated win chance:

| Model's score | Actual result | Games won |
|---|---|---|
| below -0.8 | -0.88 | 1.5% |
| -0.8 to -0.6 | -0.76 | 7.4% |
| -0.6 to -0.3 | -0.50 | 21.5% |
| -0.3 to 0.0 | -0.18 | 39.0% |
| 0.0 to +0.3 | +0.14 | 57.0% |
| +0.3 to +0.6 | +0.47 | 75.9% |
| above +0.6 | +0.81 | 94.5% |

- That check covers moves the model chose. Moves it would rarely play are scored less reliably, so the panel shows the top few moves only.
- Options whose scores are very close are shown as about the same rather than as a clear winner.

## Layout

- **Laptop:** opponents across the top, table in the middle, hand in one row at the bottom, a right column with Best moves and History tabs.
- **Phone, upright:** opponents as one strip, hand as one row of slightly overlapping cards with every corner visible and every card large enough to tap, Best moves and History as panels sliding up from buttons beside Play and Pass. Thumb-sized buttons throughout.

## Accounts

- Supabase email login with a 6-digit code, no password. Display name chosen at first login.
- Bots, one-device play and Best move work without logging in. Online play and saved stats need an account.
- Stats: games played and won per mode, and recent online games.

## Stack and deployment

- Next.js 16 (App Router), React 19, Tailwind 4, TypeScript, in `web/`. Python training code stays at the repo root.
- Game engine ported to TypeScript and checked against the cases in `tests/test_straights.py`.
- Model weights exported from `models/selfplay_v1.pt` to a compact file; the forward pass is written in TypeScript (a 716K-parameter MLP needs no ML library) and runs off the main thread in the browser.
- Supabase for auth, Postgres and live updates. Environment variables and Vercel steps: `web/README.md`.
- Vercel project imported once with Root Directory `web`.

## Builder decisions

Calls made without the owner, open to change:

- The `web/` folder and the stack above.
- Light theme only; the Swiss brutal look does not get a dark mode for now.
- No Supabase code until login is built; the setup only documents the variables.
- How much detail Best move asks for by default.
