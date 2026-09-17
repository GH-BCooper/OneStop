# OneStop

One web app for file conversion, PDF, image, data, QR, media, AI and developer-utility tasks, built for personal / small-trusted-group use. Free-first and local-first: every core feature works without paying for anything.

> Status: **Phase 02 (UI Shell)** done. App shell, navigation, themes and page placeholders; no tools yet. See [`docs/build/PROGRESS.md`](docs/build/PROGRESS.md). Full docs arrive in phase 20.

## Requirements

- **Node.js 22.18+** (24 recommended, see `.nvmrc`) and npm 10+
- **Python 3.10+** (optional until Python-backed tools land; needed for the bridge check)
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

## Optional local Postgres

Not needed until phase 13, and never needed just to boot the app.

```bash
docker compose up -d                       # Postgres 17 on 127.0.0.1:5432
POSTGRES_PORT=5433 docker compose up -d    # if 5432 is taken (update DATABASE_URL to match)
docker compose down
```

A free hosted Postgres (Neon, Supabase) works just as well: put its URL in `DATABASE_URL`.

## Python

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r processors/python/requirements.txt
npm run bridge:hello
```

If Python isn't at `python3` (`python` on Windows), set `PYTHON_PATH` in `.env`.
