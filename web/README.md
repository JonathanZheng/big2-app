# Big 2 web app

Next.js 16, React 19 and Tailwind 4. The design is in `../docs/superpowers/specs/2026-10-30-web-app-design.md`.

Current state: the Swiss brutal theme, the header and a page for each mode (vs bots, vs friends, best move). The modes are not built yet.

## Run locally

Requires Node 20.9 or later.

```bash
cd web
npm install
npm run dev      # http://localhost:3000
npm run lint
npm run build
```

## Environment variables

None are needed until login and online play are built. Bots, pass-and-play and Best move run entirely in the browser.

For login and online play, copy `.env.example` to `.env.local` and fill in:

| Name | Where to find it | Exposed to the browser |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase: Project Settings > API | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase: Project Settings > API Keys, publishable key | Yes |
| `SUPABASE_SECRET_KEY` | Supabase: Project Settings > API Keys, secret key | No, server only |

`.env.local` is git-ignored. Never give the secret key a `NEXT_PUBLIC_` prefix, because that would put it in the code sent to every browser.

## Deploy on Vercel

1. In Vercel, Add New > Project, and import `JonathanZheng/big2-app` once.
2. Set **Root Directory** to `web`. Vercel detects Next.js and its build settings.
3. Under Environment Variables, add the three names above for Production and Preview (once login is built).
4. Deploy. Every push to `main` deploys to production, and every pull request gets a preview link.

Supabase settings to make once login is built:

- Authentication > Providers: turn on Email.
- Authentication > Email Templates: make the sign-in email show the code (`{{ .Token }}`) rather than only a link.
- Authentication > URL Configuration: set Site URL to the Vercel production address, and add the preview addresses (`https://*-<your-vercel-team>.vercel.app/**`) to Redirect URLs.
- Authentication > SMTP Settings: connect an email sender such as Resend. Supabase's built-in sender is for testing and only sends a few emails per hour.
