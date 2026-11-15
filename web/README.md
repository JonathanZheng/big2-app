# Big 2 web app

Next.js 16, React 19 and Tailwind 4. The design is in `../docs/superpowers/specs/2026-10-30-web-app-design.md`.

Current state: vs bots, vs friends on one device or online, Best move, following a real game, game review, the daily puzzle, the profile and the rules page are built. The app can be installed on a phone and works offline, except for online play.

- `src/lib/engine`: the game rules, legal moves and game state, checked against positions exported from the Python engine
- `src/lib/model`: the trained model's input encoding and network (weights in `public/model/`), run in a Web Worker with a main-thread fallback, plus the evaluation and move labels
- `src/lib/bots`: Easy (greedy) and Medium (Smart) bots; Hard uses the model
- `src/lib/hand`, `src/lib/session`: sorting, matches, history, browser stats and game review
- `src/lib/best-move`: the manual board, following a real game and their saved state
- `src/components`: the game screens, the board grid, review, best moves and their parts

## Run locally

Requires Node 20.9 or later.

```bash
cd web
npm install
npm run dev      # http://localhost:3000
npm test         # Vitest
npm run lint
npm run build
```

## Environment variables

Bots, one-device play, Best move and the daily puzzle run entirely in the browser and need none. Accounts and online play need these. Without them the app still runs, and the online tab says it is not set up.

Copy `.env.example` to `.env.local` and fill in:

| Name | Where to find it | Exposed to the browser |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase: Project Settings > API | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase: Project Settings > API Keys, publishable key | Yes |
| `SUPABASE_SECRET_KEY` | Supabase: Project Settings > API Keys, secret key | No, server only |

`.env.local` is git-ignored. Never give the secret key a `NEXT_PUBLIC_` prefix, because that would put it in the code sent to every browser.

## Deploy on Vercel

1. In Vercel, Add New > Project, and import `JonathanZheng/big2-app` once.
2. Set **Root Directory** to `web`. Vercel detects Next.js and its build settings.
3. Under Environment Variables, add the three names above for Production and Preview.
4. Deploy. Every push to `main` deploys to production, and every pull request gets a preview link.

Supabase:

- Link the project and push the database: `supabase link --project-ref <ref>` then `supabase db push` (from `web/`). This creates the tables and the rules that keep each hand private.

- Authentication > Providers: turn on Email.
- Authentication > Email Templates: make the sign-in email show the code (`{{ .Token }}`) rather than only a link.
- Authentication > URL Configuration: set Site URL to the Vercel production address, and add the preview addresses (`https://*-<your-vercel-team>.vercel.app/**`) to Redirect URLs.
- Authentication > SMTP Settings: connect an email sender such as Resend. Supabase's built-in sender is for testing and only sends a few emails per hour.

## Online play locally

Needs Docker and the Supabase CLI.

```bash
cd web
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,storage-api,postgres-meta
supabase status -o env   # copy the API URL, publishable key and secret key into .env.local
npm run dev
```

Sign-in emails go to the local inbox at http://127.0.0.1:54324, and show the 6-digit code.

## Tests

There are three kinds: unit tests that run anywhere, integration tests against a running app, and k6 load tests. Integration and load tests create test players through the Supabase admin API, so only point them at a local Supabase, never the live project.

### Unit tests

```bash
npm test                # every unit test (integration tests skip themselves)
npm run test:coverage   # the same, with a coverage report
```

- They cover the game rules, bots, model, Best move, sessions, accounts, online rooms and the API routes. Coverage is about 99.8% of lines in `src/lib` and `src/app/api`; components and pages are not unit tested.
- The engine, bots, model and daily puzzles are checked against positions and scores exported from the Python code, so the browser plays the same game as the trained model.
- Server code is tested without a database: `src/lib/online/test-helpers.ts` has a stand-in Supabase client that records each query and replies from a script.
- `src/lib/model/perf.test.ts` checks that the model scores every move of a large hand in under 300 ms. It is skipped during coverage runs, which slow the model several times over.
- Coverage also works from the VS Code Vitest extension. If the extension and `npm run test:coverage` run at the same time, one stops with "already in use".

### Integration tests

These send real requests to the app and a local Supabase (see [Online play locally](#online-play-locally)). Start the app on port 3123, then run the tests in a second terminal:

```bash
npm run build && npm start -- -p 3123

set -a; source .env.local; set +a
ONLINE_TEST_APP=http://localhost:3123 npm run test:integration
```

| File | Checks |
|---|---|
| `src/lib/online/online.integration.test.ts` | A room from creation to the end of a game: joining by code, bots in empty seats, no player seeing another's hand, refusing illegal and out-of-turn moves, the turn timer, handing a quiet seat to a bot and back, and the stats at the end |
| `src/lib/online/concurrency.integration.test.ts` | Races: players competing for the last seats, one player joining from several tabs, and repeated starts, moves, timeouts and heartbeats arriving together, each applied once |
| `src/lib/account/history.integration.test.ts` | Account history through `/api/history`: merges counted once, resets, the game and review limits under concurrent merges, refusing bad or oversized uploads, and no direct access to the tables |

### Load tests

The `load/` folder has three [k6](https://k6.io) tests (`brew install k6`). Each virtual user is a pair of friends on one visit: they sync their history, open a room, play with bots in the empty seats and keep checking in, as the online screen does. A 409 counts as a correct answer, because it is the server refusing a race or an early timeout.

With the app and local Supabase running as above:

```bash
set -a; source .env.local; set +a
export APP=http://localhost:3123 SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
k6 run load/concurrency.js
```

| Test | What it does | Passes when | Settings (default) |
|---|---|---|---|
| `concurrency.js` | Ramps up to `VUS` pairs, holds, then ramps down | Under 1% of requests fail, over 99% of checks pass, and 95% of room creates and history merges answer within 2 s and heartbeats within 1.5 s | `VUS` (10), `HOLD` (1m) |
| `spike.js` | A steady baseline, then a minute of far more players than a local stack can serve, then the baseline again | The baseline and the recovery, judged from 90 s after the spike, fail under 1% of requests with 95% answered within 1.5 s; no spike request takes over 10 s | `BASE_VUS` (5), `SPIKE_VUS` (40) |
| `soak.js` | A minute of light load, a long steady run, then the light load again | Under 1% of requests fail, the steady run answers 95% within 2 s, and the app is as quick afterwards (95% within 1.5 s) as when fresh | `SOAK_VUS` (8), `SOAK` (30m) |

Give `SOAK` in whole minutes and keep it under an hour, since a test player's sign-in lasts an hour.

### In CI

- **Every push and pull request** (`.github/workflows/ci.yml`): lint, typecheck, unit tests and a build, then the integration tests and a 30-second concurrency run against a local stack.
- **Nightly** (`.github/workflows/nightly.yml`, 02:00 Singapore time): every test including integration, plus the concurrency, spike and soak load tests. A failure opens or updates a "Nightly tests failing" issue. Started by hand, the soak length can be chosen.
- The local stack (`.github/actions/local-stack`) starts Supabase with every migration applied and serves a production build of the app on port 3123. Test results and the app log are uploaded with each run.

## Current model

Hard bots, hints, Best move, reviews and online server-side bots use
`selfplay_v2` (`public/model/selfplay_v2.json` and `.bin`). See the
[training and validation report](../docs/training/selfplay-v2.md). The Python
export scripts select `models/selfplay_v2.pt`; v1 remains available for comparison.
The worker, fallback and server load the same version. Service-worker cache
`big2-v2` refreshes offline assets on update; existing open pages may need a reload.

The 301 Python parity positions were regenerated for v2. Daily puzzle positions
are preserved and their expected best moves are rescored using
`python3 scripts/export_puzzles.py --rescore`; existing saved results stay as
historical records. The score-to-advice mapping is still the v1-derived mapping,
not a newly measured v2 probability calibration.
