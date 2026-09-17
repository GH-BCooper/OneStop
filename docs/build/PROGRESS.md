# OneStop — Progress Tracker

**For Claude Code:** update this file at the end of every phase, before starting the next one. Keep entries short and factual. If you deviate from a build file's spec, say what and why here — don't just leave it undocumented in code. This file (plus `CLAUDE.md`) should be enough for a fresh Claude Code session with no other memory to know exactly where to pick up.

---

## Phase Status

| # | File | Status | Completed On | Notes |
|---|---|---|---|---|
| 01 | 01-foundation.md | Complete | 2026-09-17 | npm workspaces, Next.js 16, Node↔Python bridge, optional Docker Postgres. All acceptance criteria verified. |
| 02 | 02-ui-shell.md | Not started | | |
| 03 | 03-tool-registry.md | Not started | | |
| 04 | 04-file-core.md | Not started | | |
| 05 | 05-pdf-tools-core.md | Not started | | |
| 06 | 06-pdf-tools-advanced.md | Not started | | |
| 07 | 07-word-ppt-tools.md | Not started | | |
| 08 | 08-excel-csv-data-tools.md | Not started | | |
| 09 | 09-image-tools.md | Not started | | |
| 10 | 10-audio-video-tools.md | Not started | | |
| 11 | 11-qr-tools.md | Not started | | |
| 12 | 12-dev-utility-tools.md | Not started | | |
| 13 | 13-auth-database.md | Not started | | |
| 14 | 14-history-favorites.md | Not started | | |
| 15 | 15-workflows.md | Not started | | |
| 16 | 16-ai-assistant.md | Not started | | |
| 17 | 17-online-media-network-tools.md | Not started | | |
| 18 | 18-pwa-offline.md | Not started | | |
| 19 | 19-testing.md | Not started | | |
| 20 | 20-deployment.md | Not started | | |

Status values to use: `Not started` → `In progress` → `Complete`. If a phase is complete but with a known gap, use `Complete (see notes)` and explain in Notes / Known Issues below — never mark something Complete that silently doesn't meet its acceptance criteria.

---

## Decisions Log

(Append one line per real architectural decision — e.g. which Postgres host, which AI runtime default, whether LibreOffice is required or optional locally, etc. Newest at the bottom.)

- **01 — Monorepo tool: plain npm workspaces** (`apps/*`, `packages/*`), no Turborepo/pnpm. Zero extra tooling, matches the `npm run …` acceptance criteria; Turborepo can be layered on later if builds get slow.
- **01 — Versions:** Node 22.18+ (24 recommended, `.nvmrc`), Next.js 16.3 (App Router, Turbopack), React 19.3, TypeScript **6.0** (not 7.0: `typescript-eslint` 8.x peer range is `<6.1`), ESLint 10 flat config, Prettier 3, Vitest 5.
- **01 — `apps/api` is not a separate server.** HTTP routes will be Next.js route handlers in `apps/web/src/app/api/`; `apps/api` (`@onestop/api`) holds framework-agnostic server modules they call (starting with the Python bridge). This is the extraction boundary if a split is ever needed.
- **01 — Workspace packages ship TypeScript source** (`main: ./src/index.ts`), consumed via Next `transpilePackages`; no per-package build step.
- **01 — `.ts` scripts run directly with Node's built-in type stripping** (`node scripts/x.ts`), so no `tsx`/`ts-node` dependency. Relative imports in `apps/api` therefore use `.ts` extensions (`allowImportingTsExtensions`).
- **01 — Node↔Python bridge contract:** `runPython(script, input)` spawns `processors/python/<script>` with `shell: false`, bare script names only (regex-validated), JSON on stdin → JSON on stdout, mandatory timeout (default 30s), 10 MiB stdout cap, typed `PythonBridgeError` codes. Interpreter from `PYTHON_PATH`, else `python3` (`python` on Windows).
- **01 — No SQLite fallback.** Postgres only (Docker compose optional, or free Neon/Supabase). Prisma providers can't be swapped per-environment without maintaining two schemas; conservative choice, revisit in phase 13 if zero-setup DB matters.
- **01 — `docker-compose.yml` binds Postgres to `127.0.0.1` only**, host port overridable via `POSTGRES_PORT` (5432 was unavailable on the dev machine).
- **01 — `agentRules: false` in `next.config.ts`.** Next 16's `next dev` auto-writes `AGENTS.md`/`CLAUDE.md` into `apps/web`; the root `CLAUDE.md` stays the single agent guide. Worth knowing for later phases: Next 16 ships its own docs at `node_modules/next/dist/docs/`, so check them before relying on older Next.js APIs.
- **01 — Lint is strict:** `--max-warnings=0`, `no-console` is an error outside `scripts/` (use `console.warn/error` for server logs).

---

## Deviations From Plan

(Anything you built differently than a build file specified, and why.)

- _(none yet)_

---

## Known Issues / Tech Debt

(Anything acceptance-criteria-adjacent that's deliberately deferred, with the reason and which phase should pick it up.)

- Only a few `.env.example` variables are used yet; most are placeholders documented for later phases (13, 04, 10, 16, 17). Each later phase should confirm/adjust its variables.
- No CI yet (out of scope for 01). Phase 19/20 can add a GitHub Actions workflow running `npm ci && npm run lint && npm run typecheck && npm test && npm run build`.

---

## Open Questions

(Anything ambiguous that needs a decision from the user rather than a guess.)

- _(none yet)_

---

## Next Up

Phase 02 — UI Shell (`docs/build/02-ui-shell.md`). The empty Next.js app is at `apps/web/src/app` (blank `page.tsx` + `layout.tsx`); Tailwind is **not** installed yet, so add it there. Shared components go in `packages/ui` (already listed in `transpilePackages`). Verify with `npm run lint && npm run typecheck && npm test && npm run build`.
