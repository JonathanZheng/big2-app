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

End-to-end check of online play (creates test users in the local Supabase), with the app running on port 3123:

```bash
ONLINE_TEST_APP=http://localhost:3123 npx vitest run src/lib/online/online.integration.test.ts
```

