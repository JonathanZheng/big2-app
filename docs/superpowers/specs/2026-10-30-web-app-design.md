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

- **One device:** passed around the table. Every game has exactly 4 seats and no turn is skipped. Between turns a hand-off screen ("Pass to East, tap when ready") hides the hand. When fewer than 4 people are present, bots fill the empty seats as full players (decided by the owner), at a difficulty chosen at setup. Bot turns do not show the hand-off screen. One-device games do not count towards any account's stats, since several people share the device.
- **Online:** create a room, share its code or link, 4 seats, the host fills empty seats with bots at a chosen difficulty. The server deals and checks every move, and each device only receives its own hand. Bots in online rooms run on the server. Reopening the link rejoins the seat. Live updates through Supabase.
- **Hints** (decided by the owner): always available in one-device games. In online rooms, a setting the host picks when creating the room, off by default; when on, everyone in the room can use hints.
- **Leaving** (decided by the owner): once a player has been disconnected for a minute, the host can hand their seat to a bot at a chosen difficulty; if the player rejoins, they take the seat back. A finished game counts in every human player's stats; an abandoned game does not.

### Best move

Two ways in, both confirmed by the owner:

**Set up a board** (any position, any time):

- A grid of all 52 cards. Tapping a card cycles it through: in my hand, played by West, played by North, played by East, not seen yet.
- Card counts fill themselves in (13 minus the cards marked as played by that player) and can be typed directly when it is not known who played what. Played cards with no owner marked count as out of the game.
- The move on the table and who played it, or "I'm leading", and the number of passes since. If the 3♦ has not been played, it is the opening move.
- Checks before suggesting: no card in two places, my hand matches my count, the move on the table is a legal combination.
- Result: the best move, the evaluation bar and every option labelled Best to Blunder. Tapping a suggestion highlights its cards in my hand.
- The last board is remembered so a single card can be changed and asked again.
- The model's last-4-moves input only gets the move on the table, so the screen notes that advice is slightly weaker than in a real game.

**Follow a real game:**

- Enter each player's move as it happens at a real table, a tap or two per move.
- The board, counts and recent moves stay complete and accurate with no setup, so the model gets the same information as in its own games.
- Ask for the best move whenever it is my turn. The game can be reviewed afterwards like any other.

## Single games and matches

Decided by the owner:

- Every mode can play a single game or a match.
- Only who won is tracked: no card penalties or points.
- Every game, including each game in a match, is opened by the player holding the 3♦.
- A match is a set number of games (3, 5 or 10, default 5). The scoreboard shows each player's wins; the player with the most wins takes the match, and a tie is shared. A match can be ended early. (Match length is the builder's call.)

## Shared features

- **Card history:** a log grouped by trick (who played what, who passed), a 52-card "cards out" grid marked with who played each card, and a count of the 2s and Aces still out.
- **Sorting:** by rank, by suit, by combo (pairs, triples and five-card hands grouped, singles last). Manual reordering by drag (hold then drag on phones) that survives cards leaving the hand. Grouping selected cards so they stay together. Undo after a sort. The preferred sort applies on each deal.
- **Selecting:** a tap (or click) raises or lowers one card; sliding across cards selects several on phones; holding a card picks it up to drag. Cycling through combos is its own action: a Combos button beside Play and Pass (C on a keyboard) steps through the legal moves that contain the last card tapped, or all legal moves when none is selected. Cards that cannot be played right now are dimmed. The last move is highlighted. Bot speed setting.
- **Keyboard on laptops:** arrows move between cards, Space selects, Enter plays, P passes, S switches the sort, H shows hints.

## Advice: how scores are shown

Like chess analysis, with no percentages shown anywhere (decided by the owner):

- **Evaluation:** a bar and a number for the position, from the model's score of the best move. 0 means even (the 1-in-4 chance every player starts with), plus is better, minus is worse. Scaled so that about ±1 is a small edge and ±5 or more is close to decided.
- **Move labels:** Best, Good, Inaccuracy, Mistake, Blunder, from how much worse a move scores than the best move in the same position. The cut-offs are set from real score gaps across many games so that a blunder is rare. Before relying on them, check that gaps between moves hold up against weaker opponents (the absolute scale does not, see below).
- Shown in Best move, in hints during a game, and in the game review.

## Game review

After a game (decided by the owner): step through the game move by move, with each of my moves labelled and the model's preferred move shown where it differs, plus a count of inaccuracies, mistakes and blunders. Works for every mode, since the app records every move.

## Calibration notes

The model scores every legal move with its prediction of the final result (winner 0.8 to 1.0, losers -0.8 to -1.0). Checked on 400 self-play games (17,780 decisions), the scores match real outcomes closely:

| Model's score | Actual result | Games won |
|---|---|---|
| below -0.8 | -0.88 | 1.5% |
| -0.8 to -0.6 | -0.76 | 7.4% |
| -0.6 to -0.3 | -0.50 | 21.5% |
| -0.3 to 0.0 | -0.18 | 39.0% |
| 0.0 to +0.3 | +0.14 | 57.0% |
| +0.3 to +0.6 | +0.47 | 75.9% |
| above +0.6 | +0.81 | 94.5% |

- That check covers moves the model chose. Moves it would rarely play are scored less reliably: their label (usually Mistake or Blunder) is trustworthy, but their exact numbers are not, so only the top few options show a number.
- Options whose scores are very close get the same label (Best or Good) rather than one being called clearly better.
- What a score means: the model's expected result if the other three players are as strong as the model. It is the model's learned estimate from everything the player can see, not an exact calculation over the hidden hands.
- Against weaker players the model is too pessimistic. Measured on 600 games against 3 Smart bots: decisions scored -0.4 to -0.2 won 54% (30% in self-play), and decisions scored -0.8 to -0.6 won 23% (9% in self-play).
- The calibration above comes from self-play: complete information and the model in every seat. Against people it is unknown.
- Label cut-offs (drop in internal win chance against the best move): Good under 0.02, Inaccuracy under 0.05, Mistake under 0.12, Blunder from 0.12. Checked with `scripts/advice_cutoffs.py` on 300 games of the model against 3 Smart bots: the Smart bots' 5,589 moves with a choice were labelled Best 46.6%, Good 27.7%, Inaccuracy 10.9%, Mistake 7.9%, Blunder 6.8%. This is why the app shows a chess-style evaluation and move labels rather than percentages.

## Layout

- **Laptop:** opponents across the top, table in the middle, hand in one row at the bottom, a right column with Best moves and History tabs.
- **Phone, upright:** opponents as one strip, hand as one row of slightly overlapping cards with every corner visible and every card large enough to tap, Best moves and History as panels sliding up from buttons beside Play and Pass. Thumb-sized buttons throughout.

## Accounts

- Supabase email login with a 6-digit code, no password. Display name chosen at first login.
- Bots, one-device play and Best move work without logging in. Online play and saved stats need an account.
- Stats: games and matches played and won per mode, and recent online games.

## Stack and deployment

- Next.js 16 (App Router), React 19, Tailwind 4, TypeScript, in `web/`. Python training code stays at the repo root.
- Game engine ported to TypeScript and checked against the cases in `tests/test_straights.py`.
- Model weights exported from `models/selfplay_v1.pt` to a compact file; the forward pass is written in TypeScript (a 716K-parameter MLP needs no ML library) and runs off the main thread in the browser.
- Supabase for auth, Postgres and live updates. Environment variables and Vercel steps: `web/README.md`.
- A new Supabase project and a new Vercel project (decided by the owner). Nothing carries over from the old `big2-web` app: no tables, users or domain. Old users sign up again.
- Vercel project imported once with Root Directory `web`.

## Builder decisions

Calls made without the owner, open to change:

- Tap selects; cycling through combos is a separate Combos button and key.
- The evaluation scale and the label cut-offs.
- One-device games do not count towards stats.
- Matches are a set number of games (3, 5 or 10, default 5) rather than a target score.
- The `web/` folder and the stack above.
- Light theme only; the Swiss brutal look does not get a dark mode for now.
- No Supabase code until login is built; the setup only documents the variables.
