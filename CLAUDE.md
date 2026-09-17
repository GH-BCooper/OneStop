# CLAUDE.md — OneStop Repository Guide

This file is instructions for **Claude Code** working in this repository. Read this before touching any code, and re-read it if you're unsure what phase you're in.

## 1. What OneStop Is

OneStop is a single web app for file conversion, PDF, image, data, QR, media, AI, and developer-utility tasks, for personal / small-trusted-group use. It has two front doors:

- **AI Assistant** (`/assistant`) — describe a task in natural language; it plans and runs a chain of OneStop tools.
- **All Tools** (`/tools`) — a searchable catalogue where any tool can be opened and used directly.

Everything is driven by one **Tool Registry** (built in phase 03) so the UI, the search, and the AI assistant all read from the same source of truth. Do not let any tool exist outside the registry.

## 2. Non-Negotiable Constraints

These override convenience every time:

1. **Free-first.** No mandatory paid API, SaaS, or infrastructure. Every core feature must work with $0 spent. If a tool genuinely needs a paid service to reach full quality (e.g. premium OCR), the free/local version must still be the default and must still work — the paid option, if offered at all, is opt-in with the user's own key, never bundled. Note that "free" and "local" are not the same thing: a free-tier hosted API (e.g. Groq) costs nothing but still sends data off the user's device and needs internet — that's an acceptable *option* (see `16-ai-assistant.md`), but it must be clearly disclosed in the UI and must never silently replace the fully local/offline default.
2. **Local-first / offline-friendly.** Process files locally whenever practical. A tool that needs the internet must fail *gracefully* with a clear message (see `18-pwa-offline.md` and `22` in the master plan) — it must never crash or block the rest of the app.
3. **No architecture bloat.** No microservices, no Kubernetes, no enterprise role/billing systems, no multi-region infra. One monorepo, one logical backend with clearly separated modules.
4. **Simple auth.** Email/password + Google OAuth only. Nothing more elaborate unless the user explicitly asks later.
5. **Privacy.** Temporary files are deleted automatically after a short retention window. Cloud storage of files is opt-in only, never default. No raw file binaries in Postgres.
6. **Security baseline (always, every phase):** validate MIME/extension/size on every upload; sanitize filenames and paths; never execute an uploaded file; secrets only in env vars, never committed; validate/limit any externally fetched URL to reduce SSRF risk; **the AI Assistant may never execute arbitrary shell commands and may never call a tool that isn't in the registry.**
7. **One registry, one contract.** Every tool — however implemented — exposes the same metadata shape (id, category, inputTypes, outputTypes, execution, offline, supportsBatch, requiresAuth, description). No tool is usable by the UI or the AI unless it's registered.

If a build file below and this section ever conflict, this section wins — flag the conflict in `PROGRESS.md` under "Open Questions" rather than silently picking one.

## 3. Tech Stack (do not swap without logging why in PROGRESS.md)

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js + TypeScript (App Router) | routing + PWA support in one framework |
| UI | Tailwind CSS | fast, consistent, no license cost |
| Backend | Next.js API routes to start; extract to a NestJS-style module boundary only if it becomes genuinely necessary | avoid premature split |
| Heavy processing | Local Python (`processors/python/`) only where a Python library is materially better (e.g. PyMuPDF, Tesseract) | pragmatic, not dogmatic |
| Database | PostgreSQL via Prisma ORM | typed, portable, works with any free-tier Postgres host |
| Auth | Auth.js (NextAuth), Credentials + Google provider | open-source, self-hosted, free |
| Local storage | IndexedDB (guest/local data), localStorage (small prefs) | offline-first |
| Media | FFmpeg (local binary) | free, industry standard |
| AI runtime | Two free, user-selectable paths: Ollama (local, fully offline) **or** a free-tier hosted API (Groq, OpenRouter free models, Google AI Studio free tier) with the user's own key. A further paid API may be offered as an extra opt-in. | zero mandatory cost either way; hosted path trades offline/privacy for zero hardware requirement — must be disclosed in the UI |
| Media downloading | yt-dlp (local, open-source) | respects the "no mandatory paid tool" rule; ToS/legal caveats still apply |
| Deployment | Any free-tier host (Vercel/Netlify + Render/Railway/Fly.io + Supabase/Neon) | portable, no vendor lock-in in code |

## 4. Repository Structure

```
onestop/
├── apps/
│   ├── web/            # Next.js frontend + PWA
│   └── api/            # Backend/API (may start as Next.js API routes)
├── packages/
│   ├── ui/              # Shared UI components
│   ├── types/           # Shared TypeScript types
│   ├── tool-registry/   # Tool definitions/capabilities — THE source of truth
│   └── config/          # Shared config (eslint, tsconfig, etc.)
├── processors/
│   └── python/          # Python-heavy processing modules
├── docs/
│   └── build/           # These BUILD.md phase files
├── scripts/
├── .env.example
├── docker-compose.yml    # optional local Postgres, never required to run the app
├── CLAUDE.md             # this file
├── PROGRESS.md           # phase tracker — update every phase
└── README.md
```

## 5. How To Work Through This Project

1. Open `PROGRESS.md`. Find the first phase not marked "Complete".
2. Open the matching file in `docs/build/NN-*.md`. That file's **Scope** section is your entire mandate for this session — do not implement later phases' tools even if it'd be "easy while you're in there." Note them as a TODO comment referencing the phase file instead.
3. Implement, following the file's Modules/Interfaces sections.
4. Write and run the tests specified in that file's Test Cases section, plus anything obviously missing.
5. Check every item in that file's Acceptance Criteria. Do not mark a phase complete if any item is unmet — instead log the gap in PROGRESS.md and keep working, or, if truly blocked, log it under "Open Questions" and say so to the user.
6. Update `PROGRESS.md`: mark the phase Complete, note the date, log any deviations from the build file and why, log any new decisions (e.g. "chose Neon over Supabase for Postgres because—"), and write one or two sentences under "Next Up" so the next session has context without re-reading everything.
7. Only then move to the next phase.

Do not skip ahead "just to wire something up" — cross-phase shortcuts are exactly what makes phase 19 (Testing) discover silent gaps.

## 6. Build Phase Index

| # | File | Covers | Depends on |
|---|---|---|---|
| 01 | `01-foundation.md` | Repo, tooling, env, coding standards | — |
| 02 | `02-ui-shell.md` | Layout, nav, theme, Home page shell, route stubs | 01 |
| 03 | `03-tool-registry.md` | Tool registry, generic tool page, All Tools/category pages | 01, 02 |
| 04 | `04-file-core.md` | Upload/validation, temp files, Job model, processing pipeline | 01–03 |
| 05 | `05-pdf-tools-core.md` | Core PDF ops (merge/split/rotate/compress/etc.) | 01–04 |
| 06 | `06-pdf-tools-advanced.md` | Advanced PDF (OCR, sign, forms, password, PDF↔Office) | 05 |
| 07 | `07-word-ppt-tools.md` | Word + PowerPoint tools | 04, 06 |
| 08 | `08-excel-csv-data-tools.md` | Excel/CSV/JSON/XML/YAML tools | 04 |
| 09 | `09-image-tools.md` | All image tools | 04 |
| 10 | `10-audio-video-tools.md` | Audio + video tools (FFmpeg) | 04 |
| 11 | `11-qr-tools.md` | QR generation/scanning/dynamic QR | 04 |
| 12 | `12-dev-utility-tools.md` | Dev + file utilities (JSON, Base64, hashing, ZIP, etc.) | 04 |
| 13 | `13-auth-database.md` | Real Postgres schema, Auth.js login/signup/reset | 01–04 |
| 14 | `14-history-favorites.md` | Persisted history, favorites, settings sync | 13 |
| 15 | `15-workflows.md` | Workflow builder + run engine + batch | 03–14 |
| 16 | `16-ai-assistant.md` | AI Assistant pipeline, AI tools, external recommendations | 03–15 |
| 17 | `17-online-media-network-tools.md` | YouTube/IG/Spotify link tools, IP/DNS/WHOIS lookups | 04 |
| 18 | `18-pwa-offline.md` | PWA manifest, service worker, offline UX, /status | 02–17 |
| 19 | `19-testing.md` | Fill test gaps, contract tests, E2E | all above |
| 20 | `20-deployment.md` | Local + free-tier hosted deployment, README | all above |

Files 05–12 and 17 don't strictly depend on each other and could in principle be reordered, but build them in this numeric order unless the user says otherwise — it keeps PROGRESS.md linear and easy to reason about.

## 7. Coding Conventions

- TypeScript strict mode everywhere in `apps/` and `packages/`.
- A tool module never reaches into another tool module's internals — it goes through the module's exported service contract, or through the registry.
- Every tool gets exactly one canonical registry entry and one route. No duplicate ids.
- Errors shown to the user are short and actionable (see master plan §22). Log the technical detail server-side; never show a stack trace in the UI.
- Prefer small, composable functions over large ones — the AI Assistant (phase 16) and Workflows (phase 15) both need to call individual tool steps in isolation.
- Commit in small, phase-sized chunks so `PROGRESS.md` and git history stay aligned.

## 8. Definition of Done for Any Phase

A phase is done only when **all** of these are true:
- Every Acceptance Criteria bullet in that phase's build file is met.
- Every Test Case in that phase's build file passes, plus obvious edge cases you noticed.
- Any new tool is registered in `packages/tool-registry` with accurate `offline`/`requiresAuth`/`execution` flags — a tool is not marked `offline: true` until an actual offline test for it passes (this is enforced for real in phase 19, but don't cheat early).
- `PROGRESS.md` is updated before you stop.

## 9. When Blocked

- Never silently introduce a paid dependency to get unblocked. Pick the free/local option, even if lower quality, and note the tradeoff in PROGRESS.md.
- If a build file is ambiguous or conflicts with another, don't guess silently — implement the most conservative (simplest, most free-tier-safe) interpretation and log the ambiguity under "Open Questions" in PROGRESS.md for the user to confirm later.

## 10. Security Reminders (short version — full list in `01-foundation.md` and master plan §15)

MIME/size validation → sanitize filenames/paths → never execute uploads → auto-delete temp files → HTTPS in hosted mode → hashed passwords only → secrets in env vars only → limit/validate any externally-fetched URL → AI never runs shell commands or calls unregistered tools.
