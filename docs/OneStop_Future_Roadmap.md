# OneStop — Future Roadmap: Features, Integrations, Automations & a Cool UI

> **Status: built.** This brainstorm was picked up in full on 2026-09-29 and scoped into
> `docs/build/21-roadmap-expansion.md`; see the "Phase 21" entry in `docs/PROGRESS.md` for what
> shipped and what was deliberately left out. The catalogue went from 206 tools to 285. The one idea
> dropped rather than half-built is the SQL Query Runner over CSV/Excel (§1.3), which needs `sql.js`
> — and the whole expansion was built with zero new runtime dependencies. Everything below is kept
> as written, as the record of what was proposed.

A brainstorm document, not a build file. Nothing here is scoped, sequenced into phases, or
committed to — it's raw material for the *next* wave of `docs/build/NN-*.md`-style work, written
after reading the whole repo: `CLAUDE.md`, `docs/OneStop_MasterDoc.md`, `docs/OneStop_Features.md`,
`docs/PROGRESS.md` (all 20 phases + six post-V1 passes), `versionTwo.md`, the tool registry source,
and the current UI shell/theme.

**Every idea below is written to be buildable at $0**, in the spirit of `CLAUDE.md` §2: local-first
by default, free-tier-hosted as an opt-in that's clearly disclosed and never silently replaces the
offline path, no mandatory paid API/SaaS/infra, no microservices, no Claude/Anthropic dependency
anywhere in the app. Where an idea touches the network, that's called out explicitly with how it
degrades gracefully when offline (§22) — the same pattern the 18 existing Internet-only tools
already use.

This doc does **not** repeat what's already tracked. Before reading on, know that these are
already logged and don't need re-inventing:

- **`docs/PROGRESS.md` → "Next Up"**: composing FFmpeg sub-progress into workflow/batch totals,
  live-testing the AI tools against real hosted providers, more external-recommendation entries,
  and a real local image-model runtime for background/object removal, upscaling and denoising.
- **`versionTwo.md` → Backlog**: watched-folder automation (File System Access API, client-side),
  multi-step scheduled workflows, a dedicated `/automations` page, and native Web Push alongside
  the in-app bell.
- **`docs/PROGRESS.md` → Known Issues**: per-IP rate limiting on `/api/tools/run` (done, but only
  in-memory/per-process), a `worker_threads` sandbox for the Regex Tester, real `terser` minification
  for the JS formatter, streaming multipart uploads to lift the 100 MB buffering ceiling, and a
  Postgres-backed rate limiter for a multi-instance deploy.

Everything from here is new ground.

---

## Part 0 — Where the app stands today

For scale, so the ideas below are read in context: **206 registered tools** across PDF, Word/PPT,
Excel/CSV/data, images, audio/video, QR, AI, dev/file utilities, and network/online-media — 172 of
them proven offline by a test that traps the network. A four-provider free AI runtime (Ollama local,
or Groq/OpenRouter/Google AI Studio with the visitor's own key). A full agentic assistant
(`/api/assistant/agent`, NDJSON streaming) that can search the registry, run tools, chain workflows,
read files, and schedule automations, always validated against the registry — never a raw shell, per
§2.6. Workflows with build-time chain validation, batch mode, and now scheduled runs with real
in-app notifications. Auth.js (email/password + Google), Postgres via Prisma with a working
no-database fallback, IndexedDB-backed guest mode, an installable PWA (Lighthouse 96/100/100/100,
26/26 installability), and a hand-rolled dark "black lacquer" / light "polished chrome" theme with a
pointer-reactive particle field and a 3D tool-orbit landing page — all built with **zero extra UI
dependencies** (`apps/web`'s only runtime deps beyond Next/React/Auth.js are `jsqr` and the internal
workspace packages). That "no library unless it earns its weight" discipline is worth preserving —
most of the UI ideas below are written to fit it.

---

## Part 1 — New tool ideas, by category

Every tool below would get exactly one registry entry (`CLAUDE.md` §2.7) and follow the existing
`offline`/`requiresAuth`/`execution` metadata contract. "Free/local approach" names the specific
library or technique so the idea isn't hand-wavy.

### 1.1 PDF (extending phases 05–06)

| Tool | What it does | Free/local approach |
|---|---|---|
| PDF Redaction | Permanently removes (not just visually covers) text/regions before flattening | `pdf-lib`, same library the existing PDF tools already use — draw over + re-render the page as an image for the redacted region so the original text can't be lifted back out |
| PDF Table of Contents / Bookmark Editor | Add, rename, reorder, delete bookmarks/outline entries | `pdf-lib` outline APIs |
| PDF Accessibility (PDF/UA) Checker | Reports missing tags, alt-text, reading order — pairs with the existing PDF/A checker | Extend `checkPdfA`'s rule-based checker with PDF/UA's tag rules |
| PDF Chapter Splitter | Auto-splits a PDF into one file per bookmark/outline entry | Reuses phase 05's Split PDF engine, driven by the outline instead of manual ranges |
| PDF Booklet / Imposition Layout | Reorders and rotates pages for print-shop-style folded booklets (2-up, saddle-stitch) | Pure page-geometry math over `pdf-lib`, no new dependency |
| PDF Table Extractor → CSV | Dedicated CSV/JSON export of just the detected tables, versus PDF → Excel's whole-page heuristic | Reuses phase 06's table-detection heuristic, new output shape |
| Fillable Form Designer | Build a new AcroForm from a blank/uploaded page (drag fields onto it) instead of only filling an existing one | `pdf-lib` form-field creation APIs, client-side field placement UI |
| PDF Redline / Visual Diff | Renders Compare PDF's page-level diff as an actual highlighted overlay image, not just a text report | Reuses phase 05/06's PDF rasterizer + a pixel-diff pass |

### 1.2 Word / PowerPoint (extending phase 07)

| Tool | What it does | Free/local approach |
|---|---|---|
| Track Changes Cleaner | Accept-all or reject-all tracked changes/comments in a `.docx` | OOXML surgery on `w:ins`/`w:del` elements, same pattern phase 07 already uses for merge/split |
| Markdown ↔ Word | Round-trips Markdown and `.docx` for people who draft in plain text | `docx` (MIT) for the Word side; a Markdown AST the repo likely already needs for the existing Markdown → HTML tool |
| Markdown → Slides | Turns a heading-delimited Markdown file into a basic `.pptx` deck | Reuses the OOXML slide-writing code phase 07 already has |
| Slide Deck → Narrated Video | Auto-advances slides with a local TTS voiceover reading the speaker notes | See §3.3 (local Piper TTS) + FFmpeg image-sequence-to-video, both already-available primitives |
| Resume/CV Template Filler | Fills a chosen `.docx` template's merge fields from a small form | Same templating idea as the new Invoice Generator below |
| Citation Formatter | Converts a reference list between APA/MLA/Chicago/BibTeX | A small, self-contained formatting library — pure data transform, no network |

### 1.3 Data / Excel / CSV (extending phase 08)

| Tool | What it does | Free/local approach |
|---|---|---|
| SQL Query Runner over CSV/Excel | Upload a spreadsheet, write SQL, get a result table/CSV back | `sql.js` (SQLite compiled to WASM, MIT) — runs entirely in the browser or in the Node process, no real database involved |
| Pivot Table Builder | Drag rows/columns/values, get an aggregated table | Pure client-side aggregation over the already-parsed sheet |
| Data Diff Tool | Row-by-row/cell-by-cell diff between two CSVs or JSON files, highlighting changes | Key-based row matching + a diff algorithm — same "compare two files" shape as Compare PDFs |
| Chart Generator | Turns a CSV/Excel column selection into a PNG/SVG bar/line/pie chart | Server-side Canvas or plain SVG string-building — no charting library required for the basics |
| JSON Schema Generator | Infers a JSON Schema from one or more sample JSON files | Pure structural inference, no dependency |
| Sample/Fake Data Generator | Generates realistic placeholder CSV/JSON (names, emails, dates) for testing | `@faker-js/faker` (MIT) — entirely local, no real PII ever involved |
| Parquet ↔ CSV | Converts to/from the columnar Parquet format now common in data pipelines | `parquet-wasm` (Apache-2.0) |
| SQLite ↔ CSV/Excel | Imports a spreadsheet into a `.sqlite` file, or dumps tables back out | `sql.js`, same as the query runner above |

### 1.4 Images (extending phase 09)

| Tool | What it does | Free/local approach |
|---|---|---|
| Color Palette Extractor | Pulls the N dominant colors from an image as hex/RGB swatches | k-means over pixel data with `sharp` (already the phase-09 workhorse) |
| Image → SVG (Vectorizer) | Converts a bitmap (logo, sketch) into scalable vector paths | `potrace` (GPL — note the license before depending on it; if that's a blocker, a from-scratch marching-squares tracer is a fallback) |
| Image → ASCII Art | Renders an image as monospace text art | Pure luminance-to-glyph mapping, no dependency |
| Favicon / App Icon Set Generator | One image in, a full favicon/PWA icon set out (the same job `scripts/build-launcher-icon.mjs` already does for the launcher, exposed as a tool) | `sharp`, already a dependency |
| Social Media Preset Resizer | One-click crops to Instagram post/story, YouTube thumbnail, Open Graph image, LinkedIn banner dimensions | A preset list layered on the existing Image Resizer |
| Collage / Contact Sheet Maker | Arranges multiple images into a grid | `sharp` composite operations |
| Photo Map Viewer | Plots a batch of photos' EXIF GPS coordinates on a map | Reuses phase 17's Nominatim/geo infrastructure client-side, tiles from the free OpenStreetMap raster tile service |
| Batch Renamer | Pattern-based sequential rename across a batch (`{name}-{n}.{ext}`) | Pure string templating over the existing batch pipeline |
| Sprite Sheet Generator / Splitter | Packs multiple images into one sheet with a coordinate manifest, or slices one apart | `sharp` composite/extract |
| Duplicate/Near-Duplicate Image Finder | Perceptual-hash (pHash) comparison across a batch, not just byte-identical like the existing Duplicate File Detector | A from-scratch DCT-based pHash — small, well-documented algorithm, no dependency |

### 1.5 Audio / Video (extending phase 10)

| Tool | What it does | Free/local approach |
|---|---|---|
| **Auto-Subtitle Generator** | Real speech-to-text captioning from audio/video — today's Subtitle tools only *convert* an existing subtitle file | **`whisper.cpp`** (MIT) — a local binary exactly like FFmpeg already is; ships small quantized models (~75 MB–1.5 GB), fully offline. This is the single highest-value new AI-adjacent tool in this whole doc |
| **Text-to-Speech Reader** | Converts any text/document into narrated audio | **Piper TTS** (MIT), a small, fast, fully local neural TTS engine with dozens of free voices — same "optional local binary, `/status` reports it" pattern as FFmpeg/yt-dlp/LibreOffice |
| Silence Trimmer / Auto Dead-Air Cut | Removes silent gaps from a podcast/lecture recording | FFmpeg's own `silencedetect`/`silenceremove` filters — no new binary, just a new filter graph |
| Loudness Normalizer (EBU R128) | Broadcast-standard two-pass loudness normalization, more precise than the existing simple Volume Normalizer | FFmpeg's `loudnorm` filter, two-pass mode |
| Video Stabilizer | Smooths shaky handheld footage | FFmpeg's `vidstab` filter pair (`vidstabdetect`/`vidstabtransform`) — included in most full FFmpeg builds |
| Podcast Chapter Marker | Embeds chapter markers (from a timestamp list) into an MP3/MP4 | FFmpeg metadata/chapters muxing |
| Video Contact Sheet / Thumbnail Grid | One image showing a grid of frames sampled across a video | FFmpeg's `tile` filter |
| Subtitle Burner | Permanently burns an SRT/VTT/ASS file into the video frame | FFmpeg `subtitles`/`ass` filter — complements, doesn't replace, the existing soft-subtitle Extraction/Conversion tools |
| Waveform-to-Video | Renders an audio file as a waveform animation video (for uploading music to video platforms) | FFmpeg's `showwaves`/`showspectrum` filters, already adjacent to the existing Waveform Generator |

### 1.6 QR / Barcodes (extending phase 11)

| Tool | What it does | Free/local approach |
|---|---|---|
| Barcode Generator/Scanner (1D) | UPC-A, EAN-13, Code128 — beyond QR | `bwip-js` (MIT) for generation; `jsQR`'s barcode-scanning sibling or a small 1D decoder for reading |
| Batch QR Generator (mail-merge) | One CSV column in, hundreds of unique QR codes out (as a ZIP or a print sheet) | Reuses the existing QR generator + phase 12's ZIP writer |
| Logo-Embedded QR | Places a logo in the QR's center while keeping it scannable | `qrcode`'s high error-correction mode + `sharp` composite, with a live "still scans" check using the existing decoder before the result is returned |

### 1.7 AI Tools (still zero Claude/Anthropic — §2.8 holds)

| Tool | What it does | Free/local approach |
|---|---|---|
| Ask Your Files (local semantic search) | Natural-language search across a signed-in user's own History/uploaded documents | Local embeddings (see §3.2) + a small vector index — everything stays on the OneStop server, never a third party |
| Meeting/Lecture Summarizer | Transcript-and-summarize a recording in one step | Chains the new Auto-Subtitle tool (whisper.cpp) → the existing AI Summarizer — a natural Workflow template, not even new AI plumbing |
| Flashcard / Quiz Generator | Turns a document into a set of Q&A flashcards for studying | The existing AI runtime + a structured-output prompt, same pattern as the existing "Extract structured data" tool |
| Code Explainer / Reviewer | Explains or reviews a pasted/uploaded code file | The existing AI runtime — works best with a code-tuned free Ollama model (e.g. `qwen2.5-coder`), still just another model name in the existing runtime |
| Resume ↔ Job Description Matcher | Highlights gaps/matches between a resume and a job posting | The existing AI runtime, two-document prompt |
| Prompt Library | Save/reuse named prompts in the Assistant, personal per-account or per-device (same storage split as favorites) | No AI change at all — pure UI/storage feature |

*(Deliberately not listed: anything resembling voice cloning or deepfake-style face swap. Out of
scope on ethical/misuse grounds, not a technical limitation.)*

### 1.8 Developer / File Utilities (extending phase 12)

| Tool | What it does | Free/local approach |
|---|---|---|
| JWT Decoder/Debugger | Decodes header/payload, checks expiry, optionally verifies HMAC signature with a pasted secret | Pure JS base64url + `crypto.createHmac` — no network needed, unlike a JWKS-fetching verifier |
| Color Converter & Palette Tools | HEX/RGB/HSL/CMYK conversion, palette generator, WCAG contrast checker | Pure math, zero dependency — and a nice tie-in with the Accessibility Toolkit below |
| Cron Expression Builder/Explainer | Visual builder + plain-English explanation of a cron string | Small self-contained parser (the automation scheduler already added cadence math in `apps/api/src/automation/` — this is the same kind of function) |
| Text/Code Diff Viewer | Side-by-side diff for plain text or code, not just PDFs | A standard diff algorithm (Myers) implemented once, reused wherever "compare two things" comes up (PDF, Data, and this) |
| Case Converter | camelCase / snake_case / kebab-case / Title Case / CONSTANT_CASE, for developers | Pure string transform |
| Unit Converter | Length, weight, temperature, area, speed | Pure math, fully offline |
| Lorem Ipsum / Placeholder Generator | Text, images (colored blocks with dimensions printed on them), and JSON placeholder generation | Pure generation, zero dependency |
| API Request Tester | A tiny local Postman: method/headers/body in, response out | Reuses phase 17's SSRF-guarded fetch wrapper exactly as-is |
| Secrets Scanner | Scans an uploaded ZIP/repo for accidentally committed API keys/tokens by pattern | Regex pattern set for common key shapes (AWS, GitHub, generic high-entropy strings) — a nice safety-conscious tool that fits the "security baseline" ethos of `CLAUDE.md` §2.6 |

### 1.9 Network / Information (extending phase 17)

| Tool | What it does | Free/local approach |
|---|---|---|
| SSL/TLS Certificate Checker | Expiry date, issuer, chain validity for a given hostname | Node's built-in `tls` module — no external service |
| HTTP Security Header Grader | Checks a URL for CSP/HSTS/X-Frame-Options/etc. presence | Reuses the existing SSRF-guarded fetch, pure header inspection |
| Sitemap/robots.txt Fetcher & Validator | Fetches and lints a site's `sitemap.xml`/`robots.txt` | Same guarded-fetch pattern |
| Email/MX Validator | Syntax check + MX record lookup | Reuses phase 17's DNS lookup code directly |

### 1.10 New categories worth their own tab

**Security & Privacy Toolkit** — fits `CLAUDE.md`'s security-conscious identity perfectly:
- Password Strength Meter (`zxcvbn`, MIT, fully local)
- Breach Check via the **k-anonymity** HaveIBeenPwned API (only the first 5 chars of a SHA-1 hash
  ever leave the browser — the real password/email never does; free, no key, clearly disclosed as
  Internet-required like every other §22 tool)
- TOTP 2FA Code Generator/Tester (verify an authenticator app is wired up correctly)
- Client-Side File Encryptor/Decryptor (AES-GCM via the browser's built-in Web Crypto API — the
  file never leaves the device, so this one tool could be `offline: true` *and* zero-server-trust)
- Diceware Passphrase Generator (public-domain word list, local CSPRNG — pairs with the existing
  Password Generator)

**Finance & Math Utilities**:
- Currency Converter — an Internet-required tool by nature; a free, keyless rate API
  (`exchangerate.host` or similar) with a cached-last-known-rate offline fallback, disclosed exactly
  like the existing geolocation tools
- Loan/Mortgage/Compound-Interest Calculators (pure math, offline)
- Invoice Generator — a form that fills a `.docx`/PDF invoice template, literally reusing the
  existing PDF-generation and Resume-template-filler machinery
- Tip/Bill Splitter (pure math, a fun tiny one)

**Education & Reference**:
- Citation Generator (see §1.2)
- Flashcard Maker (manual, non-AI version — the AI one is §1.7's variant)
- Typing Speed Test (a fun, zero-risk, purely client-side page — good fit for "personal / small
  trusted group")
- Readability Score Checker (Flesch-Kincaid and similar, pure text statistics, offline)

**Accessibility Tools** — genuinely useful and cheap to build:
- Alt-Text Generator for images, using the existing AI runtime (or a local captioning model) with a
  clear "AI-generated, please review" label
- Color-Blindness Simulator (applies protanopia/deuteranopia/tritanopia matrices to an uploaded
  image — pure math filter, same shape as the existing Color Adjustment tool)
- PDF Tagging Helper (pairs with the PDF/UA checker in §1.1)

**Calendar & Time**:
- `.ics` Calendar File Generator (event details in, a downloadable/shareable calendar invite out)
- Countdown/Timer Page Generator — genuinely nice paired with QR: generate a shareable countdown
  page and a QR code that points at it, reusing phase 11's hosted-page infrastructure directly
- World Clock / Timezone Converter (pure `Intl`/`Temporal`-based math, offline)

**Fun & Personal** (low-risk, good fit for a small trusted group):
- "Your Year in OneStop" — a personal usage wrap-up page built entirely from a signed-in user's own
  History data (favorite category, tools run, minutes saved) — see §7 for the visual treatment
- A small pack of decision tools: random picker, dice roller, coin flip, team shuffler — trivial to
  build, genuinely used by a "small trusted group" more than a stranger would expect

---

## Part 2 — Platform-level features (bigger than one tool)

- **Global Command Palette (⌘K / Ctrl+K).** Type-to-jump to any tool, category, workflow, or
  history entry from anywhere in the app, plus quick actions ("New workflow", "Toggle theme").
  Buildable with **zero new dependencies** on top of the search index `packages/tool-registry/src`
  already builds for `/tools` — it's a modal wrapping the same `search.ts` the Tools page already
  calls. (`cmdk`, MIT, ~5 KB, is a fine optional shortcut if a from-scratch version feels like too
  much UI work — but the existing "no library" discipline suggests trying vanilla first.)
- **Browser extension** ("Send to OneStop" right-click menu on images/links/selected text, opens
  the right tool pre-filled). A Manifest V3 extension is free to build; sideloading it unpacked (for
  personal/small-group use, exactly this app's stated audience) costs nothing — only *listing* it
  on the Chrome Web Store has a one-time $5 fee, so that stays opt-in/skippable, never required.
- **Cross-platform desktop launcher.** `OneStop.exe`/`launcher/OneStopLauncher.cs` today is a
  Windows-only C# tray app. A **Tauri** shell (Rust, MIT/Apache-2.0, free, and far lighter than
  Electron — a few MB versus 100+) would give macOS and Linux the same "double-click, tray icon,
  opens in a window" experience the Windows launcher already provides, still pointed at the same
  local `next start` server. Genuinely additive, not a redesign of the existing launcher.
- **Personal automation API.** A scoped, user-generated personal access token (shown once, revocable
  in Settings) so a signed-in user's *own* scripts/cron jobs can call `POST /api/tools/run` from
  outside the browser — still going through the same registry, same validation, same rate limit.
  Strictly additive to the existing session-cookie auth, never a replacement for it.
- **Outbound notifications via `ntfy.sh`.** A free, open-source (Apache-2.0), no-account-needed push
  notification relay — an opt-in alternative/companion to the in-app bell for "your automation
  finished" pings that reach a phone even with the tab closed, without standing up a push
  infrastructure of OneStop's own. (Native Web Push via VAPID keys, already on the backlog in
  `versionTwo.md`, is the zero-third-party alternative — worth having both as options.)
- **Shareable read-only result links.** A time-boxed, unguessable link to a specific job's result
  (reusing the temp-file retention window that already exists), so a signed-in user can hand a
  result to someone without an account — closely related to, and could reuse, phase 11's existing
  hosted-page infrastructure for dynamic QR content pages.
- **A dedicated `/automations` page** (already on the `versionTwo.md` backlog) — worth calling out
  here too because it's the natural home for the personal-analytics and notification-history ideas
  in this doc to live alongside it.
- **i18n scaffold.** Nothing in the app is Internet-required to be English-only — the AI intent
  detector and rule planner are (per `docs/PROGRESS.md`), but the *UI strings* could be extracted to
  a resource file today with no new dependency (a plain lookup object keyed by locale), leaving
  translation itself as a someday-task rather than an architectural blocker.

---

## Part 3 — AI Assistant: the next tier, still zero paid/Anthropic dependency

1. **Local speech-to-text and text-to-speech as first-class assistant I/O**, not just as tools:
   a microphone button in `/assistant` using **`whisper.cpp`** for input, and Piper TTS to read
   replies aloud — both already justified as standalone tools in §1.5, so this is "wire the same
   local binaries into the chat UI too," not new infrastructure. The browser's own built-in
   **Web Speech API** (`SpeechRecognition`) is an even cheaper first step for dictation — zero
   binaries, zero dependency, works today in Chromium — with `whisper.cpp` as the offline/quality
   upgrade path exactly like Ollama-vs-hosted-AI already works for chat.
2. **In-browser AI via WebGPU/WASM (Transformers.js, Apache-2.0, from Hugging Face).** Small models
   (a few hundred MB) can run *directly in the visitor's browser tab* — genuinely $0, genuinely
   offline after the first load, no server round trip at all. This is a third tier below "Ollama
   installed" and "hosted API with a key": for light tasks (short summarization, simple
   classification, small embeddings) it needs *nothing installed* and *no key*, which is the purest
   possible expression of `CLAUDE.md`'s free-first principle. Best framed as a fallback that
   activates automatically when neither Ollama nor a hosted key is configured, rather than a fourth
   thing the user has to choose.
3. **Local embeddings + retrieval for "Ask Your Files."** A small local embedding model (also
   Transformers.js-capable, or Ollama's embedding models like `nomic-embed-text`) indexes a signed-in
   user's document history so the assistant can answer "what did that contract I uploaded last month
   say about termination" with a real citation back to the source file — a genuine differentiator,
   and it's the natural foundation under §1.7's "Ask Your Files" tool.
4. **Vision-model support for image questions.** Ollama already serves small vision models (e.g.
   `llava`, `moondream`) — "what's in this photo" or "read the text in this screenshot" becomes just
   another model name in the existing provider runtime, no new provider integration.
5. **Plan preview with a real diff, before running.** The assistant already plans, confirms, then
   runs — showing the *actual* option values it picked for each step (not just tool names) before
   execution would make multi-step chains easier to trust, especially ones the built-in rule planner
   assembles without a model at all.
6. **Saved personas / response style.** "Always answer tersely," "explain like I'm new to this,"
   stored per account in the existing `UserSettings` row — a settings feature, not an AI feature.

---

## Part 4 — Free integrations worth adding (all opt-in, all disclosed)

| Service | What it's for | Why it's genuinely free | Offline behavior |
|---|---|---|---|
| `whisper.cpp` | Local speech-to-text (§1.5, §3.1) | MIT license, runs as a local binary exactly like FFmpeg | N/A — it *is* the offline path |
| Piper TTS | Local text-to-speech (§1.2, §1.5, §3.1) | MIT license, local binary | N/A — offline by nature |
| `sql.js` | In-browser/local SQLite (§1.3) | MIT license, WASM, no server DB | N/A — fully local |
| Transformers.js | In-browser small-model AI (§3.2) | Apache-2.0, runs client-side | Degrades to "not supported on this device" on very old hardware, never breaks the rest of the app |
| HaveIBeenPwned k-anonymity API | Breach checking (§1.10) | Free, no key, privacy-preserving by design (k-anonymity) | Tool clearly marked Internet-required, same §22 pattern as existing lookups |
| `exchangerate.host` (or equivalent free/keyless rate API) | Currency conversion (§1.10) | Free tier, no mandatory key | Falls back to last-cached rate with a visible "may be stale" notice |
| Open-Meteo | A Weather Lookup utility (pairs naturally with the existing Location/Coordinates Lookup tools) | Fully free, no API key required, ever | Internet-required tool, disclosed like the rest of §13's lookups |
| `ntfy.sh` | Push notifications for automations (§2) | Free, open-source, no account needed | Purely additive to the existing in-app bell, which still works with zero network dependency |
| Web Push (VAPID) | Native browser push, no third party at all | Built into every modern browser, zero cost | The truly zero-dependency alternative to `ntfy.sh` |
| OpenStreetMap tile server | Map rendering for Photo Map Viewer (§1.4) and any future map UI | Free for reasonable personal use under OSM's tile usage policy | Internet-required, degrades to "no map preview" while EXIF data itself stays readable offline |

Nothing here introduces a mandatory network dependency. Every row is either a local binary/library
(the majority) or an opt-in Internet-required tool disclosed exactly the way phase 17's existing
lookups already are.

---

## Part 5 — Architecture & performance upgrades

- **Web Workers for heavy client-side compute.** Once `sql.js`, perceptual hashing, or in-browser
  Transformers.js models are doing real work in the tab, moving that work off the main thread keeps
  the UI (including the particle field/pointer effects already in place) from stuttering.
- **Client-side pre-resize before upload.** For image tools, downscaling a huge photo in the browser
  (via `<canvas>`, no dependency) before it's even sent to `/api/tools/run` would cut upload time and
  server memory pressure — a genuine UX win on the "100 MB buffered upload" limitation the tech-debt
  log already flags.
- **`worker_threads` isolation for the Regex Tester** (already flagged in Known Issues) — worth
  reinforcing here because it's the one existing tool with a real, documented CPU-pinning risk from
  user-supplied input, and it's a small, contained fix.
- **A shared "compare two things" diff engine.** Compare PDFs (§existing), the new Data Diff Tool,
  and the new Text/Code Diff Viewer (§1.8) all want the same core: a generic diff module used three
  ways is more in the spirit of `CLAUDE.md` §7 ("prefer small, composable functions") than three
  bespoke implementations.
- **IndexedDB-cached registry for instant offline tool browsing.** `/tools` already works offline
  once the PWA shell is cached, but caching the registry's *search index* in IndexedDB (refreshed on
  every online visit) would make search itself instant on a cold PWA launch rather than waiting on
  whatever the service worker's cache strategy currently resolves to.
- **A real job queue, still no new infrastructure.** If long jobs (a 10-minute encode, a 60-page OCR
  run) ever get proper progress-driven UI beyond the polling store, a `better-sqlite3`- or even
  file-backed queue inside the same Node process (no Redis, no external broker) keeps the
  "one logical backend" promise from `CLAUDE.md` §2.3 intact.

---

## Part 6 — Security, privacy & accessibility upgrades

- **TOTP-based 2FA** for account sign-in (`otpauth`-style local secret + `speakeasy`-equivalent
  verification, both free/MIT) — no SMS provider, no cost, and it's the natural sibling of the new
  TOTP Tester tool in §1.10.
- **Passkeys / WebAuthn.** Built into every modern browser and OS (Windows Hello, Touch ID) at zero
  cost — a genuinely free, phishing-resistant alternative to passwords that fits `CLAUDE.md` §2.4's
  "simple auth" mandate without adding a third-party auth provider.
- **Client-side E2E encryption for opt-in cloud storage.** `CLAUDE.md` §2.5 already says cloud
  storage must be opt-in; when a user does opt in, encrypting the file in the browser with the Web
  Crypto API before it ever reaches the server (so OneStop itself can't read it) is a strictly
  stronger privacy story, for zero infrastructure cost.
- **An account security audit log** ("signed in from a new device," "password changed") — small
  Postgres table, same pattern as `Notification`, no new service.
- **Dyslexia-friendly font toggle and a high-contrast theme preset** (ties directly into the new
  theme-preset system in Part 7) — genuinely cheap, genuinely useful, zero dependency beyond an
  open-license font like OpenDyslexic if desired (or skip the custom font and ship the spacing/
  contrast adjustments alone, which need nothing extra at all).
- **A "reduced data" mode** — skips the particle field, blurs/lazy-loads preview thumbnails, useful
  on a metered connection; extends the pattern `prefers-reduced-motion` already established.

---

## Part 7 — A cool UI: design vision

### Where the identity is today

The app already has real design DNA: a "black lacquer" dark theme and "polished chrome" light theme
built from layered CSS gradients (no images), a moving metallic sheen on the wordmark, a
pointer-reactive particle field behind every page, a spotlight-on-hover glow on cards, and a 3D
CSS-transform tool-orbit on the landing page — all shipped with **zero motion/UI libraries**. That's
worth naming explicitly, because the strongest version of "a cool UI" here is one that *extends* that
identity rather than replacing it with something generic.

Call the next stage **"Command Deck"** — the idea that a tool this broad (206+ tools) should feel
less like a form-per-page utility site and more like a cockpit: fast to navigate by keyboard, dense
with useful information without feeling cluttered, and quietly premium in the same polished-metal
language it already speaks. Inspiration worth studying (all free to look at, nothing to license or
copy — just the *shape* of the ideas): **Linear** and **Raycast** for command-palette-first
navigation and restrained motion; **Arc browser** and **Warp terminal** for playful-but-controlled
gradients and command bars; **Vercel's dashboard** and **Stripe's docs** for how a dark, dense UI
stays legible; **Notion** for the bento-grid home-page idea below.

### Concrete pieces

1. **The Command Palette (⌘K).** Described functionally in Part 2 — visually, it should feel like
   the existing card glow effect, but modal: a frosted panel over a dimmed, still-visible background
   (the particle field kept faintly alive behind it, not fully paused, so the app never feels
   "frozen"), results grouped by Tools / Workflows / History / Actions, arrow-key navigable, Enter to
   commit. This single feature does more for "feels like a cool, fast product" than any visual
   flourish.

2. **Home page as a bento grid**, replacing (or offered as a toggle alongside) the current
   Landing/Dashboard split: a large "Ask OneStop" panel top-left (keeps today's behavior — types go
   straight to the assistant), a medium "recent/favorite tools" panel, a medium "recent jobs" strip
   for signed-in users, and small tiles for each of the 8 category groups that visually *tilt toward
   the cursor* the same way `ToolOrbit.tsx`'s cards already do on the landing page today — so the
   3D-tilt interaction the app has already built becomes a home-wide pattern instead of a one-off
   landing flourish.

3. **Tools directory: live preview on hover.** Instead of (or beside) the current text-only card,
   a tool card that's hovered for a beat shows a tiny animated illustration of what it does — an
   inline SVG/CSS animation (a page rotating for Rotate PDF, a bar shrinking for Compress, a QR code
   assembling pixel-by-pixel) rather than a screenshot or stock asset. Cheap to build (a handful of
   reusable SVG micro-animations shared across similar tools by category), zero licensing risk, zero
   hosting cost, and it turns browsing 206 tools into something closer to browsing an app store than
   scanning a spec sheet.

4. **Workflow builder as a real node canvas.** Today's linear step-list is honest and simple (and
   `CLAUDE.md` explicitly keeps workflows *linear*, no branching — that constraint should stay). The
   *visual* upgrade, though: render that same linear chain as connected node cards on a canvas —
   file in on the left, each tool a card with its live thumbnail/icon, an animated flow-line pulsing
   left-to-right while a run is in progress (using the existing progress-store percentages from the
   fourth owner pass), success/fail states colored per node. **React Flow** (MIT) is the
   well-trodden library for this if a from-scratch canvas is too much surface area; given the
   "linear only" constraint, a much lighter custom flexbox-with-connector-lines implementation is
   also realistic and keeps the zero-new-dependency streak alive.

5. **Tool pages: before/after where it's visual.** For image/PDF-page/video-frame tools, a
   split-pane or draggable-divider before/after preview (think the classic "drag to compare" image
   slider) instead of only a download link at the end — makes the result feel immediate and
   trustworthy. Pure CSS `clip-path` + a drag handle, no dependency.

6. **Theme presets, not just dark/light.** The existing token system (`packages/ui/src/tokens.ts` →
   `themeCss()`) already generates CSS variables from a palette — adding presets ("Terminal Green" for
   a hacker-console feel, "Paper/Sepia" for a calmer reading mode on text-heavy tools, "High
   Contrast" for accessibility per Part 6) is *data*, not new plumbing: a few more palette objects
   feeding the exact same generator that already produces the two current themes.

7. **Micro-interactions with restraint.** A subtle "success" moment (a brief particle burst using the
   *existing* `PointerField` canvas rather than a new confetti library) when a batch job or workflow
   completes; a gentle magnetic pull on primary buttons on hover (a few lines of CSS transform, no
   library); toasts that slide in from the same direction the header lives, so they never feel like
   they came from nowhere.

8. **"Your Year in OneStop"** (from §1.10) as a genuinely designed moment, not just a stats table — a
   full-bleed, story-like scroll (à la Spotify Wrapped, but self-hosted and built from real History
   data the app already has) showing top categories, tools run, an estimated time saved, presented
   with the same brand-gradient sheen the wordmark already uses. Entirely canvas/SVG, entirely free,
   and it's the kind of feature that makes a personal/small-group tool feel loved rather than merely
   functional.

9. **Mobile-specific polish.** Bottom sheets instead of centered modals for actions on narrow
   viewports (a CSS media-query swap on the existing modal component, not a new one), swipe-left on a
   History row to reveal "Run again"/"Delete," and PWA **app shortcuts** (the `shortcuts` field in
   `manifest.json` — a long-press on the installed icon jumps straight to "New workflow" or "Ask
   OneStop") — a zero-cost manifest addition on top of the PWA work phase 18 already shipped.

10. **Empty and error states worth looking at.** Every "no history yet" / "no results" / offline
    state gets a small inline-SVG illustration in the brand's own polished-metal line style (drawn
    once per state, reused everywhere) instead of plain text — costs nothing (no stock-art licensing,
    no image hosting) and is one of the highest-perceived-polish-per-hour investments a UI pass can
    make.

### What this deliberately avoids

No component library swap (Tailwind + the existing hand-built `packages/ui` stays), no heavy
animation framework (Framer Motion etc. — the current CSS-and-Canvas approach already proves it
isn't needed), and nothing that requires an external design tool, paid font license, or stock-asset
subscription. Every visual idea above is either pure CSS/SVG/Canvas or, at most, a small MIT-licensed
library named explicitly so it can be evaluated against the "does this earn its weight" bar the
project has clearly already been applying.

---

## Part 8 — Suggested reading order for whoever picks this up

Not a commitment, just a sensible on-ramp:

1. **`whisper.cpp` Auto-Subtitle + Piper TTS** (§1.5) — two local binaries, same integration shape
   as FFmpeg/yt-dlp/LibreOffice already use, and they unlock the Meeting Summarizer (§1.7) and
   voice-in/voice-out assistant (§3.1) ideas for free once they exist.
2. **Command Palette** (§2, §7.1) — the single highest UX-value-per-hour item in this whole document,
   and it needs no new dependency.
3. **`sql.js` SQL Query Runner + Data Diff Tool** (§1.3, §1.8) — two genuinely differentiated data
   tools from one small, well-known WASM library.
4. **Theme presets** (§7.6) — almost free, given the token system already exists.
5. Everything else in Part 1, roughly in the order a real user would ask for it.

---

*This document is a brainstorm, written from a full read of the current repo on 2026-09-28. It
carries no authority over `docs/build/`, `CLAUDE.md`, or `docs/PROGRESS.md` — if anything here is
picked up for real, it should be scoped into a proper build file and logged in `PROGRESS.md` the same
way every phase before it was.*
