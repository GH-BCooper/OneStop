# OneStop

One web app for file conversion, PDF, image, data, QR, media, AI and developer-utility tasks, built for personal / small-trusted-group use. Free-first and local-first: every core feature works without paying for anything.

> Status: **Phase 10 (Audio & Video Tools)** done. PDF, Word/PowerPoint, Excel/CSV/data, image and audio/video tools all work end to end; auth, history, workflows and the AI assistant are still to come. See [`docs/PROGRESS.md`](docs/PROGRESS.md). Full docs arrive in phase 20.

## Requirements

- **Node.js 22.18+** (24 recommended, see `.nvmrc`) and npm 10+
- **Python 3.10+** (optional until Python-backed tools land; needed for the bridge check)
- **FFmpeg** (required for the audio & video tools — see [FFmpeg](#ffmpeg) below; everything else works without it)
- **Docker** (optional, only for the local Postgres in `docker-compose.yml`)

## Quick start

```bash
npm install
cp .env.example .env          # optional for now; every variable is documented inside
npm run dev                   # http://localhost:3000
```

## Scripts

| Command                | What it does                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`          | Start the Next.js dev server (`apps/web`)                                                |
| `npm run build`        | Production build of `apps/web`                                                           |
| `npm run start`        | Serve the production build                                                               |
| `npm run lint`         | ESLint across the monorepo (fails on any warning)                                        |
| `npm run typecheck`    | `tsc --noEmit` in every workspace                                                        |
| `npm test`             | Vitest (includes the Node↔Python bridge and lint-wiring tests)                           |
| `npm run test:e2e`     | Browser checks of the built app (run `npm run build` first; uses your local Chrome/Edge) |
| `npm run format`       | Prettier write (`format:check` to verify only)                                           |
| `npm run bridge:hello` | Call `processors/python/hello.py` from Node and print the JSON                           |
| `npm run db:generate`  | Regenerate the Prisma client from `prisma/schema.prisma` (also runs before `build`)      |
| `npm run db:migrate`   | Create and apply a migration in development                                              |
| `npm run db:deploy`    | Apply existing migrations (what a deployed instance runs)                                |
| `npm run db:studio`    | Browse the database in Prisma Studio                                                     |

## Layout

```
apps/web                 Next.js (App Router) frontend; API route handlers live here too
apps/api                 Framework-agnostic backend modules (Python bridge, later services)
packages/types           Shared TypeScript types
packages/ui              Shared UI components
packages/tool-registry   The Tool Registry, the single source of truth for tools
packages/config          Shared ESLint + Prettier config
processors/python        Python processors (JSON on stdin, JSON on stdout)
docs/build               Phase-by-phase build plan and PROGRESS.md
```

## Database and accounts (optional)

OneStop runs with no database at all: every tool works, and jobs are simply not remembered between
restarts. A database adds accounts, durable job history and (from phase 14) synced favourites.

```bash
docker compose up -d                       # Postgres 17 on 127.0.0.1:5432
POSTGRES_PORT=5433 docker compose up -d    # if 5432 is taken (update DATABASE_URL to match)
docker compose down
```

A free hosted Postgres (Neon, Supabase, Railway) works just as well: put its URL in `DATABASE_URL`.

Then create the tables and a session secret:

```bash
npm run db:deploy                          # apply prisma/migrations
npx auth secret                            # or: openssl rand -base64 32 -> NEXTAUTH_SECRET
```

Signing in needs both `DATABASE_URL` and `NEXTAUTH_SECRET`; without them the account pages say so
and everything else carries on. Google sign-in appears only when `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are set (create a free OAuth client in the Google Cloud Console and add
`<APP_URL>/api/auth/callback/google` as the redirect URI).

**Password reset email.** With nothing configured, the reset link is printed to the server console

- no account anywhere, nothing to pay for. Set `RESEND_API_KEY` (Resend's free tier) or `SMTP_URL`
  (plus `npm install nodemailer`) to send it for real. See `.env.example`.

**Passwords** are stored as salted bcrypt hashes (cost 12) and nothing else; reset tokens are
stored only as SHA-256 hashes, are single-use, and expire after an hour.

## FFmpeg

The audio and video tools (phase 10) run entirely locally through FFmpeg, which is free and open
source. Install it once:

| OS            | Command                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| macOS         | `brew install ffmpeg`                                                                                                                     |
| Ubuntu/Debian | `sudo apt install ffmpeg`                                                                                                                 |
| Fedora        | `sudo dnf install ffmpeg`                                                                                                                 |
| Windows       | `winget install Gyan.FFmpeg` (or download a build from [ffmpeg.org](https://ffmpeg.org/download.html) and add its `bin` folder to `PATH`) |

Check it with `ffmpeg -version` and `ffprobe -version` — OneStop needs both, and they ship together.
Open a new terminal after installing on Windows so the new `PATH` is picked up, then restart the dev
server. If FFmpeg lives somewhere unusual, set `FFMPEG_PATH` (and `FFPROBE_PATH` if it is not in the
same folder) in `.env`.

Without FFmpeg the app still runs: every audio/video tool simply reports "FFmpeg is required for
audio/video tools — see setup instructions", and the server logs the same thing once at startup.
Subtitle Conversion is the exception — it is pure TypeScript and works either way.

Long jobs: a media tool may run for up to 10 minutes (`MEDIA_TIMEOUT_SECONDS` to change it).

## Python

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r processors/python/requirements.txt
npm run bridge:hello
```

If Python isn't at `python3` (`python` on Windows), set `PYTHON_PATH` in `.env`.
