# OneStop — Progress Tracker

**For Claude Code:** update this file at the end of every phase, before starting the next one. Keep entries short and factual. If you deviate from a build file's spec, say what and why here — don't just leave it undocumented in code. This file (plus `CLAUDE.md`) should be enough for a fresh Claude Code session with no other memory to know exactly where to pick up.

---

## Phase Status

| #   | File                             | Status      | Completed On | Notes                                                                                                                                |
| --- | -------------------------------- | ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | 01-foundation.md                 | Complete    | 2026-09-17   | npm workspaces, Next.js 16, Node↔Python bridge, optional Docker Postgres. All acceptance criteria verified.                          |
| 02  | 02-ui-shell.md                   | Complete    | 2026-09-17   | Tailwind v4 shell, 15 routes, theme tokens, 6 base components. 72 unit/component tests + 66 real-browser checks (375/768/1440) pass. |
| 03  | 03-tool-registry.md              | Complete    | 2026-09-17   | 206 registry entries covering every Features item; validating loader; search/filters/sort; /tools, category and generic tool pages.  |
| 04  | 04-file-core.md                  | Not started |              |                                                                                                                                      |
| 05  | 05-pdf-tools-core.md             | Not started |              |                                                                                                                                      |
| 06  | 06-pdf-tools-advanced.md         | Not started |              |                                                                                                                                      |
| 07  | 07-word-ppt-tools.md             | Not started |              |                                                                                                                                      |
| 08  | 08-excel-csv-data-tools.md       | Not started |              |                                                                                                                                      |
| 09  | 09-image-tools.md                | Not started |              |                                                                                                                                      |
| 10  | 10-audio-video-tools.md          | Not started |              |                                                                                                                                      |
| 11  | 11-qr-tools.md                   | Not started |              |                                                                                                                                      |
| 12  | 12-dev-utility-tools.md          | Not started |              |                                                                                                                                      |
| 13  | 13-auth-database.md              | Not started |              |                                                                                                                                      |
| 14  | 14-history-favorites.md          | Not started |              |                                                                                                                                      |
| 15  | 15-workflows.md                  | Not started |              |                                                                                                                                      |
| 16  | 16-ai-assistant.md               | Not started |              |                                                                                                                                      |
| 17  | 17-online-media-network-tools.md | Not started |              |                                                                                                                                      |
| 18  | 18-pwa-offline.md                | Not started |              |                                                                                                                                      |
| 19  | 19-testing.md                    | Not started |              |                                                                                                                                      |
| 20  | 20-deployment.md                 | Not started |              |                                                                                                                                      |

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
- **02 — Tailwind CSS v4** via `@tailwindcss/postcss` (CSS-first config, no `tailwind.config`). `globals.css` maps Tailwind colors to `--os-*` CSS variables and uses `@source` to scan `packages/ui`.
- **02 — Design tokens are TypeScript-first.** `packages/ui/src/tokens.ts` holds colors (both themes), spacing, radius and fonts; `themeCss()` emits the CSS variables and the root layout injects them. Change tokens there, not in CSS.
- **02 — Theme:** `data-theme="light|dark"` on `<html>`, stored in `localStorage["onestop-theme"]`, applied by an inline pre-paint script (`themeInitScript()`) so there's no flash; falls back to the OS preference. Tailwind `dark:` is bound to the attribute.
- **02 — Nav breakpoint is `lg` (1024px).** Six labelled items don't fit next to the logo/badge/toggle at 768px, so phones and tablets get a hamburger menu.
- **02 — Tests:** component tests run in Vitest with per-file `// @vitest-environment jsdom` and a global `next/navigation` mock (`apps/web/src/test/setup.tsx`). Real-browser checks use `playwright-core` driving the **locally installed Chrome/Edge** (no browser download): `npm run build && npm run test:e2e`. Set `E2E_BROWSER_PATH` or `E2E_BASE_URL` to override. They're excluded from `npm test` because they need a build.

---

## Deviations From Plan

(Anything you built differently than a build file specified, and why.)

- **02 — Paths:** the build file says `apps/web/app/**`, `apps/web/components/layout/*` and `packages/ui/tokens.ts`; phase 01 set up `src/` directories, so these live at `apps/web/src/app/**`, `apps/web/src/components/layout/*` and `packages/ui/src/tokens.ts`.
- **02 — Extra layout piece:** `ConnectionBadge.tsx` (the static "Online" indicator) sits next to Header/Nav/ThemeToggle/Footer so phase 18 has one place to wire real connectivity.
- **02 — Settings is not in the header nav.** Master §3 lists it under Home, but the nav order in the build file and Features §18 leaves it out, so it's linked from the footer. Phase 14 could add it to an account menu.
- **02 — Home "recent jobs"** always shows its sample data (labelled "Sample data") because there's no session yet; phase 13/14 should show it only when signed in.
- **03 — Registry shape: one entry per _tool_, not per Features line.** Where the Features doc lists the same tool twice (PDF -> Images in 1.4 and 6.2, ZIP Creator in 12.22 and 14.2, JSON/XML Formatter & Validator in section 4 and 12, Extract Audio in 7.10 and 8.10, PDF -> PowerPoint in 1.3 and 5.2) there is a single entry whose `sources` array lists every reference. A contract test parses `docs/OneStop_Features.md` and asserts every one of the 230+ numbered items is claimed exactly once. Result: **206 tools**.
- **03 — Categories:** the 12 schema categories are the registry ids and the tool-route segment; master section 4's 8 catalogue groups (`GROUPS`) sit above them for the Home cards and `/tools` filters. `/tools/[category]` accepts either, so `/tools/media` lists Audio + Video + Online Media. The group that would have collided with the `dev-utility` category id is named `utilities`. (Resolves the phase-02 open question, in the way it suggested.)
- **03 — `offline` stays `false` for every tool.** CLAUDE.md section 8 forbids `offline: true` before a passing offline test, so the loader enforces it with an (empty) `VERIFIED_OFFLINE` allow-list that phase 19 fills. Design intent lives in a separate `network: "none" | "optional" | "required"` field, which drives the "Runs locally / Local or online / Needs internet" badges and the offline/online filter tags.
- **03 — Metadata beyond the build file's interface:** `subcategory`, `network`, `phase`, `status` (`stub` | `demo` | `available`), `popularity`, `sources`. These are what make "Coming in phase 06", the offline/online filters, popularity sort and the coverage test possible.
- **03 — Features section 15 (Workflow Tools) are not registry tools.** Create/Save/Edit/Delete/Run/Duplicate Workflow, multi-step and batch processing are capabilities of the workflow builder, so they live in `PLATFORM_FEATURES` pointing at `/workflows*` routes (phase 15) instead of the tool catalogue.
- **03 — Demo executor:** `file-metadata-viewer` is wired to a real `echoExecutor` (reflects the name/size/type/modified date of the selected files) to prove select -> validate -> execute -> result -> download end to end. Every other tool returns `NOT_IMPLEMENTED` with its phase file name, so the UI shows "Coming in a later phase" and never a fake success.
- **03 — Search is keyword-only** (no AI, per Scope - Out): lemmas and synonyms ("compressor" -> "compress", "photo" -> "image"), weighted matching over name/keywords/types/category/description, and direction parsing so "make a pdf from images" ranks Image -> PDF above PDF -> Images. `scoreTool` is exported so phase 16's assistant can reuse it.
- **03 — Recently used tools** live in `localStorage["onestop-recent-tools"]` (12 max) and feed the `recent` sort plus the Home "Recently used" row; phase 14 replaces this with synced history.
- **02 — Snapshot test** snapshots the Nav markup under both `data-theme` values. Theme colors are CSS variables, so markup is identical across themes; the visual difference is asserted in the browser test (body background changes on toggle).
- **03 — Paths:** the build file says `packages/tool-registry/{schema.ts, entries/*.ts, loader.ts, search.ts}` and `apps/web/{app,components}/...`; following phases 01/02 these live under `src/`. Files added beyond the listed modules: `define.ts` (entry-authoring helper), `io.ts` (input-type helpers), `executors.ts`, `platform.ts`, plus `components/tools/{ToolBadges,ToolsExplorer}.tsx` and `apps/web/src/lib/tool-search-params.ts` — the `/tools` query-string contract, kept out of the client component so the server page may import it.
- **03 — `/tools` is server-rendered on demand** (it reads `?q=` and the filters from `searchParams`); `/tools/[category]` and all 206 tool routes are prerendered via `generateStaticParams` with `dynamicParams = false`, so an unknown slug is a real 404.
- **03 — `apps/web/src/lib/mock-data.ts` now only holds the sample recent jobs**; categories and popular tools come from the registry.

---

## Known Issues / Tech Debt

(Anything acceptance-criteria-adjacent that's deliberately deferred, with the reason and which phase should pick it up.)

- Only a few `.env.example` variables are used yet; most are placeholders documented for later phases (13, 04, 10, 16, 17). Each later phase should confirm/adjust its variables.
- **02:** Home search sends `/tools?q=…` but `/tools` ignores `q` until phase 03 adds registry search. Category/tool placeholder routes accept any slug (no 404) until phase 03 validates against the registry.
- **02:** "Continue with Google" is a disabled button and forms only validate client-side; phase 13 wires Auth.js.
- **03:** tool pages have no per-tool **Options** yet ("No options for this tool yet") — each tool phase adds its own. The result **Save** button is disabled until phase 14, and `requiresAuth` tools (dynamic QR, QR analytics, landing/content pages) always report "Sign in required" because there is no session until phase 13.
- **03:** `popularity` is a hand-set number per entry; phase 14 should derive it from real usage.
- **03:** the five fit modes of Fit Image to Square/Circle (fill, contain, stretch, repeat, blurred background) are modelled as options of one tool each, not separate tools — phase 09 must implement all five.
- No CI yet (out of scope for 01). Phase 19/20 can add a GitHub Actions workflow running `npm ci && npm run lint && npm run typecheck && npm test && npm run build`.

---

## Open Questions

(Anything ambiguous that needs a decision from the user rather than a guess.)

- _(none open)_. **Resolved (03):** the phase-02 category question, as described in the Decisions Log. Two judgement calls were made the conservative way and are worth a glance: JSON/XML Formatter & Validator are filed under **Excel, CSV & Data** (phase 08 owns them; phase 12 repeats them), and "User-Agent Viewer" (12.20, shows your own browser) is kept as a separate tool from "User-Agent Lookup" (13.6, parses any UA string). **Resolved (02):** the master plan and the feature list are now in the repo as `docs/OneStop_MasterDoc.md` and `docs/OneStop_Features.md`. Phase 02 was checked against them: routes match master §3.1, Home matches §5, nav order matches Features §18 ("§18" in `02-ui-shell.md` means the Features doc, not master §18, which covers hosting). Home category cards now use master §4's 8 categories, with counts taken from the Features list.

---

## Next Up

Phase 04 — File Core (`docs/build/04-file-core.md`): uploads with MIME/extension/size validation, sanitized temp files with automatic deletion, the Job model and the processing pipeline. It plugs in underneath phase 03 at one seam: `getExecutor(tool)` in `packages/tool-registry/src/executors.ts` is where real processing arrives (phases 05-17 register executors by tool id), and `FileRef` / `ExecResult` in `@onestop/types` are the contracts to extend — `FileRef` is browser metadata only today and needs a temp-file handle. The tool page already drives all eight UX states, so phase 04 mostly needs to move the client-side checks in `ToolPage.validateToolInput` to real server-side validation.

Verify any phase with `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e` (the last needs the build plus a local Chrome/Edge).
