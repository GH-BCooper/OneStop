# Phase 01 — Foundation

## Objective
Set up the monorepo, tooling, environment configuration, and coding standards. No UI, no business logic, no database yet — this phase is pure scaffolding that every later phase depends on.

## Depends On
None. This is phase zero.

## Scope — In
- Monorepo tooling (npm/pnpm workspaces or Turborepo — pick one free option and log the choice in PROGRESS.md).
- `apps/web` (empty Next.js + TypeScript app), `apps/api` (can start as Next.js API routes inside `apps/web` — see decision note below).
- `packages/ui`, `packages/types`, `packages/tool-registry`, `packages/config` — empty but wired into the workspace.
- `processors/python/` with a minimal `requirements.txt` and a "hello world" script proving the Node↔Python bridge works (e.g. Node calls a Python script via `child_process` and gets JSON back).
- Root `tsconfig.base.json`, shared ESLint + Prettier config in `packages/config`.
- `.env.example` documenting every env var this project will eventually need (fill in placeholders now, expand in later phases — at minimum: `DATABASE_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OLLAMA_HOST`, `NODE_ENV`).
- `docker-compose.yml` with an **optional** local Postgres service — the app must never require Docker to run; document a SQLite-behind-Prisma fallback as an option for zero-setup local dev if you want one (log this decision).
- Root scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `format`.
- Base `README.md` (expanded fully in phase 20).

## Scope — Out (explicit non-goals)
- No pages, no routes, no auth, no database schema, no tools.
- No CI/CD service setup (GitHub Actions is fine later, optional).

## Modules / Files
```
onestop/
├── apps/web/            (Next.js app, empty)
├── apps/api/             (may be a thin wrapper re-exporting Next API routes initially)
├── packages/ui/
├── packages/types/
├── packages/tool-registry/
├── packages/config/
├── processors/python/
├── .env.example
├── docker-compose.yml
├── package.json (workspace root)
└── README.md
```

## Interfaces
None yet — this phase defines *configuration*, not code contracts. Do make sure `packages/types` exports at least an empty `index.ts` so later phases have somewhere to add shared types immediately.

## Acceptance Criteria
- [ ] `npm install` (or chosen package manager) succeeds from a clean clone.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build` all succeed on the empty scaffold.
- [ ] `npm run dev` starts the Next.js app and it renders a blank page with no errors.
- [ ] The Node↔Python bridge script runs and returns valid JSON.
- [ ] `.env.example` has a comment above every variable explaining what it's for and whether it's required or optional.
- [ ] `docker compose up` (if used) starts Postgres, but the app does not crash or hard-require it to boot in dev mode without it.

## Test Cases
- Fresh clone → install → lint → typecheck → build, all green, on a machine with nothing pre-installed but Node and (optionally) Python/Docker.
- Deliberately break a lint rule and confirm `npm run lint` fails (proves the linter is actually wired in, not a no-op).
- Kill the Python interpreter path and confirm the bridge script fails with a clear error rather than hanging.

## Notes
Log in PROGRESS.md: which package manager/monorepo tool you chose, and whether you added a SQLite dev fallback alongside Postgres.
