# 21 — Roadmap Expansion

Scope file for the wave of work taken from `docs/OneStop_Future_Roadmap.md`. Everything here is
built under the same non-negotiables as every phase before it (`CLAUDE.md` §2): free-first,
local-first, no new mandatory dependency, no Claude/Anthropic anywhere, one registry entry per tool.

## Scope

### 1. New tools (roadmap Part 1)

All of them get exactly one registry entry, options in `packages/tool-registry/src/options-*.ts`,
an executor registered by its owning `apps/api/src` module, and a test.

- **PDF** (`apps/api/src/pdf/`): Redaction, Bookmark Editor, Chapter Splitter, Booklet Layout,
  Table Extractor, Accessibility (PDF/UA) Checker, Visual Diff, Form Designer.
- **Word / PowerPoint** (`apps/api/src/documents/`): Track Changes Cleaner, Markdown → Word,
  Word → Markdown, Citation Formatter, Resume Template Filler, Markdown → Slides.
- **Data** (`apps/api/src/data/`): Pivot Table Builder, Chart Generator, Data Diff,
  JSON Schema Generator, Sample Data Generator.
- **Images** (`apps/api/src/images/`): Colour Palette Extractor, ASCII Art, Favicon Set Generator,
  Social Preset Resizer, Collage Maker, Batch Renamer, Sprite Sheet Generator, Near-Duplicate
  Finder (pHash), Colour-Blindness Simulator, Vectorizer, Photo Map Viewer.
- **Audio / Video** (`apps/api/src/media/`): Silence Trimmer, Podcast Chapter Marker, Waveform
  Video, Text-to-Speech Reader (Piper, optional local binary), Auto-Subtitle Generator
  (whisper.cpp, optional local binary), Video Stabilizer, Video Contact Sheet, Subtitle Burner.
- **QR / barcodes** (`apps/api/src/qr/`): Barcode Generator (Code 128 / EAN-13 / UPC-A, hand-rolled),
  Batch QR Generator, Logo QR Code.
- **AI** (`apps/api/src/ai/`): Flashcard Generator, Code Explainer, Resume Matcher, Alt-Text
  Generator, Meeting Summarizer — all on the existing four-provider runtime.
- **Developer / utility** (`apps/api/src/dev-utils/`): JWT Decoder, Colour Converter, Cron
  Expression Builder, Text Diff Viewer, Case Converter, Unit Converter, Lorem Ipsum Generator,
  API Request Tester, Secrets Scanner, Readability Score Checker.
- **Network** (`apps/api/src/network/`): SSL Certificate Checker, HTTP Security Header Grader,
  Sitemap & robots Validator, Email MX Validator, Weather Lookup.
- **New categories** (`apps/api/src/toolkit/`): Security & Privacy (Password Strength Meter, TOTP,
  Diceware, File Encryptor/Decryptor, Breach Check), Finance & Math (Loan, Compound Interest, Tip
  Splitter, Currency Converter, Invoice Generator), Education (Flashcard Maker, Typing Speed Test),
  Calendar & Time (World Clock, Calendar Event `.ics`, Countdown Page), Fun (Decision Maker,
  Year in OneStop).

### 2. Platform features (roadmap Part 2)

- Global command palette (⌘K / Ctrl+K) over the existing registry search index, zero new deps.
- Shareable read-only result links, reusing the temp-file retention window.
- Personal access tokens for `POST /api/tools/run` from the user's own scripts.
- Outbound notifications via `ntfy.sh` (opt-in, disclosed, additive to the in-app bell).
- PWA app shortcuts in the manifest.

### 3. Architecture (roadmap Part 5)

- One shared diff engine (`packages/diff`) used by Compare PDFs, Data Diff and Text Diff.
- IndexedDB-cached registry search index for instant offline browsing.
- Client-side pre-resize before upload for image tools.

### 4. Security, privacy, accessibility (roadmap Part 6)

- Dyslexia-friendly text toggle, high-contrast theme preset, reduced-data mode.
- Client-side AES-GCM file encryption tool (Web Crypto, never leaves the device).

### 5. UI (roadmap Part 7)

- Theme presets (Lacquer, Chrome, Terminal Green, Paper, High Contrast) from the existing
  `tokens.ts` generator — data, not new plumbing.
- Bento-grid home tiles with the existing cursor-tilt interaction.
- Before/after compare slider on image and PDF-page results.
- Inline-SVG empty/error-state illustrations.
- Success particle burst reusing `PointerField`.
- Mobile bottom sheets and swipe actions.

## Acceptance criteria

- Every new tool has one registry entry, options with usable defaults, a registered executor and a
  test; `npm run verify` passes (lint, typecheck, tests, offline-coverage ledger).
- No new runtime dependency in `apps/web`, `apps/api` or `packages/*`.
- Optional local binaries (whisper.cpp, Piper) degrade to a clear "not installed" message and are
  reported on `/status`; nothing else in the app breaks without them.
- Every Internet-required tool is flagged `network: "required"` / `execution: "remote"` and says so
  in the UI; offline tools are only flagged `offline: true` once their trapped-network test passes.
- The command palette opens on ⌘K/Ctrl+K from every page and needs no network.
- Theme presets apply without a flash on reload and keep WCAG AA contrast for body text.

## Test cases

- Registry contract: new categories and groups are covered; every Features item is owned once.
- Per-module unit tests for every new executor, including the failure paths users can hit.
- Offline suites (trapped `fetch`/`http`/`https`) for every tool claiming `offline: true`.
- Web tests: command palette keyboard flow, theme-preset persistence, compare slider, bento home.
