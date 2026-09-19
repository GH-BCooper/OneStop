# OneStop

**One web app for every small file job.** Convert a PDF, resize a batch of images, clean a CSV,
generate a QR code, trim a video, hash a file, format some JSON — or just describe what you want
and let the assistant chain the tools together.

**206 tools. 172 of them work with no Internet at all. Nothing costs anything.**

```bash
npm install && cp .env.example .env && npm run dev     # http://localhost:3000
```

---

## What it is

Two front doors onto the same catalogue:

- **[/tools](http://localhost:3000/tools)** — search, filter and run any tool directly.
- **[/assistant](http://localhost:3000/assistant)** — say what you want in plain English. It plans
  a chain of real OneStop tools, shows you the plan, and runs it once you approve.

Plus **[/workflows](http://localhost:3000/workflows)** to save a chain and re-run it on a batch,
**[/history](http://localhost:3000/history)** for what you have run, and
**[/status](http://localhost:3000/status)** for exactly what this instance can and cannot do.

It is a **Progressive Web App**: install it from the browser and the offline-capable tools keep
working on a plane.

## Principles

1. **Free.** No mandatory paid API, SaaS or infrastructure. Every feature works with $0 spent.
2. **Local first.** Files are processed on the machine running OneStop. Cloud storage is opt-in and
   off by default; temporary files are deleted automatically.
3. **Honest.** A tool that needs the Internet, FFmpeg, LibreOffice or an AI model says so in one
   clear sentence. Nothing is silently degraded; `/status` lists every prerequisite.
4. **Simple.** One repository, one app, one Postgres. No microservices, no billing, no roles.

## What it does

| Category                       | Tools | Examples                                                                                                       |
| ------------------------------ | ----: | -------------------------------------------------------------------------------------------------------------- |
| **PDF**                        |    26 | merge, split, compress, rotate, watermark, OCR, sign, fill forms, password, PDF ↔ Word/Excel/PowerPoint/images |
| **Documents**                  |    24 | Word and PowerPoint conversion, merge, split, slide surgery, metadata, grammar, summarise, translate           |
| **Data**                       |    30 | Excel, CSV, JSON, XML, YAML — convert, validate, clean, deduplicate, split, merge                              |
| **Images**                     |    27 | convert, resize, crop, compress, watermark, background removal, upscale, HEIC, metadata                        |
| **Audio & video**              |    27 | convert, trim, merge, extract audio, compress, subtitles, GIF                                                  |
| **QR**                         |    15 | generate every payload type, scan with the camera, dynamic codes with scan counts                              |
| **Developer & file utilities** |    25 | Base64, hashing, UUIDs, passwords, timestamps, regex, ZIP, formatters                                          |
| **AI**                         |    16 | summarise, rewrite, translate, draft, extract, OCR, image generation and editing                               |
| **Online media & network**     |    16 | media links, IP, DNS, WHOIS, headers, user agents                                                              |

The full list is in [`docs/OneStop_Features.md`](docs/OneStop_Features.md) and, live, at `/tools`.

## Quick start

Requires **Node.js 22.18+** (24 recommended — see `.nvmrc`) and npm 10+.

```bash
git clone https://github.com/GH-BCooper/onestop.git
cd onestop
npm install
cp .env.example .env
npm run dev
```

That is a working instance. Everything below is optional:

| Want                                                          | Install                                                                                                       | Adds                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Audio & video tools                                           | FFmpeg (`winget install Gyan.FFmpeg`, `brew install ffmpeg`, `apt install ffmpeg`, or `npm run fetch:ffmpeg`) | 27 tools                   |
| `.doc` / `.xls` / `.ppt` / OpenDocument, better Office layout | LibreOffice                                                                                                   | higher-fidelity conversion |
| Online media tools                                            | `pip install -U yt-dlp`                                                                                       | 7 tools                    |
| Accounts, saved history, saved workflows                      | Postgres (`docker compose up -d` or free Neon/Supabase) + `npm run db:deploy`                                 | sign-in, sync              |
| AI assistant and AI tools                                     | Ollama (`ollama pull llama3.2`) **or** a free API key in `/settings`                                          | 16 tools + the assistant   |

Full instructions, including hardware guidance for local AI:
**[`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md)**.

## Hosting it

A free-tier instance over HTTPS, with the trade-offs of each host spelled out:
**[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**.

Short version: Render/Railway/Fly for everything including FFmpeg and yt-dlp, or Vercel/Netlify for
the document, data, image and utility tools. Postgres from Neon or Supabase. All config is
environment variables, so moving providers never touches the code.

## Architecture

```
+----------------------+
|       OneStop        |
+----------+-----------+
           |
+-------------+-------------+
|                           |
AI Assistant            All Tools
|                           |
+-------------+-------------+
              |
        Tool Registry
              |
+------------------+------------------+
|                  |                  |
Local tools    Online tools       Workflows
|                  |                  |
Browser/Local  Internet/APIs    Chained tools
|                  |                  |
+------------------+------------------+
                   |
           History / Account
                   |
           PostgreSQL + Auth
```

**The Tool Registry is the single source of truth.** Every tool has exactly one entry
(`packages/tool-registry`) declaring its id, category, inputs, outputs, where it executes, whether
it works offline, whether it needs an account, and its options. The catalogue, the search, the
generic tool page, the workflow builder and the AI assistant all read that one registry — and the
assistant can only ever call something that is in it. Executors register themselves
(`registerExecutor(id, fn)`) from `apps/api`, so the registry never imports server code and stays
safe to bundle for the browser.

```
apps/web                 Next.js (App Router) frontend, PWA, and the API route handlers
apps/api                 Server modules the routes call: tools, pipeline, AI, DB
packages/tool-registry   The Tool Registry — the source of truth
packages/types           Shared TypeScript types
packages/ui              Shared components and design tokens
packages/config          Shared ESLint/Prettier config
processors/python        Python processors (JSON in, JSON out)
prisma/                  Schema and migrations
tests/                   Contract, offline and browser (E2E) suites
docs/build/              The 20 phase build files this was written from
```

Stack: Next.js 16 + React 19 + TypeScript (strict) · Tailwind CSS v4 · Prisma + PostgreSQL ·
Auth.js v5 · Vitest + Playwright · FFmpeg, LibreOffice, yt-dlp, Ollama — all optional, all free.

## Security and privacy

- Every upload is validated for MIME type, extension and size, server-side, on one endpoint.
- Temporary files are named by random UUID, never by the uploaded name; inputs are deleted the
  moment a job ends, results after a short TTL, and a sweeper cleans up abandoned tabs.
- An uploaded file is **never executed**. FFmpeg, LibreOffice and yt-dlp run with `shell: false`,
  fixed argument arrays, a private scratch directory and a timeout.
- Passwords are bcrypt (cost 12); reset tokens are stored only as hashes, single-use, one hour.
- Secrets live in environment variables and nowhere else.
- **The AI assistant cannot run shell commands and cannot call a tool that is not in the registry.**

## Scripts

| Command                                                 | What it does                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run dev`                                           | Dev server on http://localhost:3000                                                            |
| `npm run build` / `npm start`                           | Production build and serve                                                                     |
| **`npm run verify`**                                    | **The gate**: lint + typecheck + every unit/integration/contract test + the offline-flag check |
| `npm test`                                              | Vitest only                                                                                    |
| `npm run test:e2e:shared`                               | Browser checks against one shared server (run `npm run build` first)                           |
| `npm run lint` / `npm run typecheck` / `npm run format` | Individually                                                                                   |
| `npm run db:deploy` / `db:migrate` / `db:studio`        | Prisma                                                                                         |
| `npm run fetch:ffmpeg`                                  | Download a local FFmpeg build into `.tools/`                                                   |

`npm run verify` is what CI runs on every push (`.github/workflows/verify.yml`). It proves that
every registry entry maps to a real executor and that every tool claiming `offline: true` really
ran with the network trapped — so the catalogue cannot drift from reality.

## Contributing / picking this up

- **[`CLAUDE.md`](CLAUDE.md)** — the constraints this project is built under. Read it first; it
  overrides convenience every time.
- **[`docs/PROGRESS.md`](docs/PROGRESS.md)** — what was built in each of the 20 phases, every
  decision, every deviation and every known limitation. Start here to find out why something is
  the way it is.
- **[`docs/build/`](docs/build/)** — the 20 phase specifications the project was written from.
- **[`docs/OneStop_MasterDoc.md`](docs/OneStop_MasterDoc.md)** and
  **[`docs/OneStop_Features.md`](docs/OneStop_Features.md)** — the original design and feature list.

A new tool is three steps: add its registry entry, write the executor in `apps/api`, register it
with `registerExecutor`. The contract suite will tell you if you missed one.

## Licence and fair use

For personal and small-trusted-group use. The online media tools download from third-party
platforms — each of those pages carries a legal notice, and respecting each platform's terms of
service and the rights of copyright holders is your responsibility.
