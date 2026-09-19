# Running OneStop locally

Everything here is free. Nothing here needs an account, a key or a card.

The short version, if you only want the tools:

```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:3000
```

That gets you a working instance with **188 of the 206 tools**. The other 18 need the Internet,
and a handful of the 188 want an optional local program — all of it is listed below, and
[http://localhost:3000/status](http://localhost:3000/status) tells you what this machine has.

---

## 1. Requirements

|             | Version                                | Needed for                                                                         |
| ----------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| **Node.js** | 22.18+ (24 recommended — see `.nvmrc`) | everything                                                                         |
| **npm**     | 10+                                    | everything                                                                         |
| **Python**  | 3.10+                                  | the Node↔Python bridge (`npm run bridge:hello`); no shipped tool requires it today |

Check with `node -v && npm -v`.

## 2. Install and start

```bash
git clone https://github.com/GH-BCooper/onestop.git
cd onestop
npm install
cp .env.example .env     # every variable is documented in the file; all are optional to start
npm run dev
```

`npm install` also fetches the English OCR model, so scanned-PDF OCR works offline immediately.

Open http://localhost:3000. Try **All Tools → File Metadata Viewer** with any file: if it returns
a report, the upload → validate → process → download pipeline is working end to end.

## 3. Optional local programs

None of these is required. Each one is checked at runtime, each has a fallback or one clear
message, and `/status` shows which were found.

### FFmpeg — for the audio & video tools (27 tools)

| OS            | Command                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| Windows       | `winget install Gyan.FFmpeg`                                                     |
| macOS         | `brew install ffmpeg`                                                            |
| Ubuntu/Debian | `sudo apt install ffmpeg`                                                        |
| Fedora        | `sudo dnf install ffmpeg`                                                        |
| any           | `npm run fetch:ffmpeg` — downloads a build into `.tools/` for this checkout only |

Verify with `ffmpeg -version` and `ffprobe -version`; OneStop needs both and they ship together.
On Windows, open a new terminal afterwards so the new `PATH` is picked up. If it lives somewhere
unusual, set `FFMPEG_PATH` (and `FFPROBE_PATH`) in `.env`.

Without it every audio/video tool reports "FFmpeg is required for audio/video tools" and nothing
else in the app is affected. Subtitle Conversion is pure TypeScript and works either way.

### LibreOffice — for higher-fidelity Office conversion

| OS            | Command                                            |
| ------------- | -------------------------------------------------- |
| Windows       | `winget install TheDocumentFoundation.LibreOffice` |
| macOS         | `brew install --cask libreoffice`                  |
| Ubuntu/Debian | `sudo apt install libreoffice`                     |

Without it, Word/Excel/PowerPoint ↔ PDF still work through OneStop's own converters and say that
fidelity may be lower. With it, layout is closer to the original **and** the formats only
LibreOffice reads become available: `.doc`, `.xls`, `.ppt` and OpenDocument (`.odt`, `.ods`,
`.odp`).

OneStop looks on `PATH`, in both `Program Files` folders, and at the root of drives C–H (its
installer offers `D:\LibreOffice` and people accept). If yours is elsewhere, set
`LIBREOFFICE_PATH` to the full path of `soffice` / `soffice.exe`.

### yt-dlp — for the seven Online Media tools

```bash
pip install -U yt-dlp        # or: winget install yt-dlp.yt-dlp / brew install yt-dlp
```

FFmpeg is needed too if you want those downloads converted to MP3/MP4. Set `YTDLP_PATH` if it is
not on `PATH`. Those tools also need the Internet, and each of their pages carries the legal
notice about respecting each platform's terms — read it.

### Ollama — for fully offline AI

See [AI runtimes](#5-ai-runtimes-all-free) below.

## 4. Database and accounts — optional

OneStop runs with no database at all. Every tool works; jobs, history and favourites live in your
browser (IndexedDB) instead of an account, and sign-in says it is unavailable. A database adds
accounts, durable history, synced favourites and saved workflows.

```bash
docker compose up -d                       # Postgres 17 on 127.0.0.1:5432
POSTGRES_PORT=5433 docker compose up -d    # if 5432 is taken — update DATABASE_URL to match
npm run db:deploy                          # create the tables
npx auth secret                            # writes NEXTAUTH_SECRET into .env
```

A free hosted Postgres (Neon, Supabase, Railway) works identically: put its URL in `DATABASE_URL`.
No Docker needed in that case.

Sign-in needs both `DATABASE_URL` and `NEXTAUTH_SECRET`. **Google sign-in** appears only when
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set — create a free OAuth client in the Google
Cloud Console and add `<APP_URL>/api/auth/callback/google` as an authorised redirect URI.

**Password-reset email.** With nothing configured the reset link is printed to the server console,
which needs no account anywhere. Set `RESEND_API_KEY` (Resend's free tier) or `SMTP_URL` to send it
for real.

Passwords are stored as salted bcrypt hashes (cost 12); reset tokens only as SHA-256 hashes,
single-use, expiring after an hour.

## 5. AI runtimes (all free)

The AI Assistant and the 16 AI tools need a language model. There are two free paths, and the
Settings page (`/settings`) lets you choose. **Neither is required** — every other tool works
without one, and the AI tools with a built-in fallback say which engine produced their result.

### Ollama — local, fully offline, no key

```bash
# Windows:  winget install Ollama.Ollama
# macOS:    brew install ollama
# Linux:    curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2         # ~2 GB, the default OneStop expects
ollama serve                 # usually already running as a service
```

Set `OLLAMA_MODEL` if you pull something else. `OLLAMA_HOST` defaults to
`http://localhost:11434`.

**Practical hardware.** A 3B model (`llama3.2`, `qwen2.5:3b-instruct`, ~2 GB) runs acceptably on
8 GB of RAM with no GPU and is enough for the assistant's planning, summarising and translation.
A 7–8B model wants 16 GB. Below 8 GB, use a hosted free tier instead.

### A free hosted API — no hardware, your own key

Groq, OpenRouter's free models, or Google AI Studio's free tier. Add the key in `/settings` or as
`GROQ_API_KEY` / `OPENROUTER_API_KEY` / `GOOGLE_AI_API_KEY`.

This sends your text to that provider, so it is **never** the silent default: OneStop tries Ollama
first, the UI discloses where a request went, and every result says which runtime produced it.

## 6. Verifying a checkout

```bash
npm run verify        # lint + typecheck + the full unit/integration/contract suite + offline check
```

That is the one gate. It runs ~1,000 checks, proves every registry entry maps to a real executor,
and proves every tool marked `offline: true` really ran with the network trapped.

Browser checks (build first — they drive your installed Chrome or Edge):

```bash
npm run build
npm run test:e2e:shared          # all files against one server — use this one
npm run test:e2e:shared -- -t "journey"   # or a subset
```

`npm run test:e2e` still exists but starts a separate server per file and will saturate a laptop.

Suites that need something this machine may not have skip themselves rather than fail: the
database suites, the live Ollama suite, the live LibreOffice suite, and the live yt-dlp suite
(that last one also needs `ONESTOP_LIVE_DOWNLOAD=1`, so it never runs by accident).

## 7. Troubleshooting

| Symptom                   | Fix                                                                     |
| ------------------------- | ----------------------------------------------------------------------- |
| Port 3000 in use          | `npm run dev -- -p 3001`                                                |
| Port 5432 in use          | `POSTGRES_PORT=5433 docker compose up -d`, and match `DATABASE_URL`     |
| "FFmpeg is required…"     | Install FFmpeg (above), open a **new** terminal, restart the dev server |
| Office file rejected      | `.doc` / `.xls` / `.ppt` / OpenDocument need LibreOffice                |
| AI tools say no runtime   | Start Ollama (`ollama serve`) or add a free key in `/settings`          |
| Sign-in unavailable       | Set `DATABASE_URL` **and** `NEXTAUTH_SECRET`, then `npm run db:deploy`  |
| A tool says "no Internet" | It is one of the 18 Internet-only tools — see `/status`                 |

`/status` is the first place to look: it lists all 206 tools, which are offline-capable, and what
this server found (FFmpeg, LibreOffice, yt-dlp, the AI runtime, the database).

---

Next: [`DEPLOYMENT.md`](DEPLOYMENT.md) for a free hosted instance. See [`../CLAUDE.md`](../CLAUDE.md)
for the rules this project is built under and [`PROGRESS.md`](PROGRESS.md) for what was built when.
