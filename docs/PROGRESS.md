# OneStop — Progress Tracker

**For Claude Code:** update this file at the end of every phase, before starting the next one. Keep entries short and factual. If you deviate from a build file's spec, say what and why here — don't just leave it undocumented in code. This file (plus `CLAUDE.md`) should be enough for a fresh Claude Code session with no other memory to know exactly where to pick up.

---

## Phase Status

| #   | File                             | Status               | Completed On | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | -------------------------------- | -------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | 01-foundation.md                 | Complete             | 2026-09-17   | npm workspaces, Next.js 16, Node↔Python bridge, optional Docker Postgres. All acceptance criteria verified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 02  | 02-ui-shell.md                   | Complete             | 2026-09-17   | Tailwind v4 shell, 15 routes, theme tokens, 6 base components. 72 unit/component tests + 66 real-browser checks (375/768/1440) pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 03  | 03-tool-registry.md              | Complete             | 2026-09-17   | 206 registry entries covering every Features item; validating loader; search/filters/sort; /tools, category and generic tool pages.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 04  | 04-file-core.md                  | Complete             | 2026-09-17   | Upload validation, temp store with auto-delete, Job model, pipeline + 3 API routes; File Metadata Viewer runs for real end to end. 218 unit + 83 real-browser checks pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 05  | 05-pdf-tools-core.md             | Complete             | 2026-09-18   | All 11 core PDF tools real and registered; per-tool Options mechanism added to the registry + tool page; 306 unit + 83 real-browser checks pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 06  | 06-pdf-tools-advanced.md         | Complete             | 2026-09-18   | All 15 advanced PDF tools real, registered and offline-verified; shared `office-convert` (LibreOffice optional); 339 unit + 84 real-browser checks pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 07  | 07-word-ppt-tools.md             | Complete             | 2026-09-18   | All 24 Word/PowerPoint tools real, registered and offline-verified; OOXML merge/split/slide surgery; local grammar/summary/translation. 388 unit + 84 real-browser checks pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 08  | 08-excel-csv-data-tools.md       | Complete             | 2026-09-18   | All 30 Excel/CSV/data tools real, registered and offline-verified; typed round trips, located validator errors, 50k-row smoke test. 435 unit + 84 real-browser checks pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 09  | 09-image-tools.md                | Complete             | 2026-09-18   | All 27 image tools real, registered and offline-verified (PDF → Image is phase 05’s); 5+5 fit modes; local-AI interface with built-in fallbacks. 475 unit + 89 real-browser checks pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 10  | 10-audio-video-tools.md          | Complete             | 2026-09-18   | All 27 audio/video tools real, registered and offline-verified via local FFmpeg 9.0; own SRT/VTT/ASS engine; one FFmpeg-missing message. 535 unit + 93 real-browser checks pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 11  | 11-qr-tools.md                   | Complete             | 2026-09-18   | All 15 QR tools real: offline generation and decoding (qrcode + jsQR), every payload convention proved by decoding it back, in-browser camera scanning, dynamic codes and hosted pages on an interim JSON store. 605 unit + 93 real-browser checks pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 12  | 12-dev-utility-tools.md          | Complete             | 2026-09-18   | All 25 developer & file utilities real and fully offline: Prettier-backed HTML/CSS/JS formatting, Markdown to HTML/text/Word, Base64 & URL codecs, CSPRNG UUID/password generation, hashes and checksums with published test vectors, timestamp and regex testing, user-agent viewing, ZIP create/extract, compress, split/merge, metadata removal, duplicate detection, and a File Type Converter that routes to earlier phases instead of reimplementing them. 697 unit + 99 real-browser checks pass.                                                                                                                                                                                                                           |
| 13  | 13-auth-database.md              | Complete             | 2026-09-19   | Real Postgres via Prisma (master plan section 16 tables plus the three Auth.js needs), Auth.js v5 with email/password (bcrypt, cost 12) and Google OAuth, single-use hashed reset tokens delivered by console/Resend/SMTP, a wired `/account`, and the phase-04 job store moved onto Postgres behind the same interface. The app still runs with no database at all. 748 unit + 103 real-browser checks pass.                                                                                                                                                                                                                                                                                                                      |     |
| 14  | 14-history-favorites.md          | Complete             | 2026-09-19   | Real `/history` (paginated, filterable) for signed-in users out of Postgres and for guests out of IndexedDB with no network call; favourite tools per account or per device; `/settings` syncing theme, AI runtime and preferences through `UserSettings`; phase 11 interim dynamic-QR JSON file migrated into Postgres; registry "popularity"/"recently used" now derived from real usage. 800 unit + 108 real-browser checks pass.                                                                                                                                                                                                                                                                                               |
| 15  | 15-workflows.md                  | Complete             | 2026-09-19   | Workflow model, build-time chain validation, run engine and batch mode; `/workflows`, `/workflows/new`, `/workflows/[id]` with a live-validating builder and a runner; the four master plan section 8 examples ship as templates and run end to end in the tests. Workflows work for guests (device storage) and for signed-in users (Postgres). 842 unit + 112 real-browser checks pass.                                                                                                                                                                                                                                                                                                                                          |     |
| 16  | 16-ai-assistant.md               | Complete             | 2026-09-19   | `/assistant` with the full master plan section 7.2 pipeline (intent -> discovery -> validation -> plan -> execute -> validate outputs -> result); a four-provider free model runtime (Ollama local by default, Groq/OpenRouter/Google AI Studio free tiers with the user's own key); all 16 AI tools registered and working, each with a built-in offline method or a clear statement of what it needs; curated Free/Paid external recommendations; a local image-model runtime for phase 09's model-capable tools. The section 7.1 example plans and runs end to end with no AI configured at all. 829 unit checks pass; a new real-browser suite drives the assistant against a server with every AI setting deliberately empty. |
| 17  | 17-online-media-network-tools.md | Complete             | 2026-09-19   | All 16 tools built: the seven Online Media tools on a local yt-dlp wrapper (with the required legal notice visible on every one of their pages) and the nine Network/Information lookups on Node's own `dns`, a from-scratch WHOIS port-43 client, an offline IP->country database built from the five RIRs' public statistics, an optional MaxMind reader for city level, and an SSRF-guarded fetch. Spotify is metadata only, permanently, and a test asserts no audio code path exists. 940 unit + 105 real-browser checks pass.                                                                                                                                                                                                |
| 18  | 18-pwa-offline.md                | Complete             | 2026-09-19   | Installable PWA: manifest + generated icon set, a hand-written service worker (4 caching rules, no new dependency), an `/offline` fallback, and real three-state connectivity (`online` / `limited` / `offline`) verified by two probes rather than `navigator.onLine`. `/status` is now registry-driven - 206 tools, 172 offline, 18 Internet-only, 16 unverified - plus a live panel and a server dependency table. 40 new unit tests and 12 real-browser checks pass; `node scripts/pwa-audit.mjs` reports 26/26 installability checks.                                                                                                                                                                                         |     |
| 19  | 19-testing.md                    | Complete             | 2026-09-19   | Hardening only, no new tools. One gate: `npm run verify` (lint + typecheck + 1,014 unit/integration/contract checks + the offline-flag check). New tool-contract suite proves all 206 registry entries map to a real, non-stub executor; new offline ledger proves all 172 `offline: true` tools really ran with the network trapped (172/172) and fails the build otherwise; three cross-category workflows added to phase 15's four §8 examples; Google OAuth covered for the first time - which found and fixed a real bug (the Auth.js adapter could not create a Google user); a five-journey E2E suite; GitHub Actions `verify` workflow. The flaky-under-load question is settled (`maxWorkers: "50%"`).                    |
| 20  | 20-deployment.md                 | Complete (see notes) | 2026-09-19   | Final `README.md`, `docs/LOCAL_SETUP.md` and `docs/DEPLOYMENT.md`; the §26/§27 QA checklist signed off below. Also closed the backlog phase 19 handed over: `document-translator` now runs on phase 16's model runtime (glossary fallback intact), `POST /api/tools/run` has a per-caller rate limit, and the E2E suite runs as one command against one shared server (`npm run test:e2e:shared`). Three of the four manual checklist items are now verified and two of them automated; five real defects were found by doing so. **See notes:** no hosted instance has actually been deployed - that step needs accounts outside this repository; see "Still open after this phase".                                              |     |

Status values to use: `Not started` → `In progress` → `Complete`. If a phase is complete but with a known gap, use `Complete (see notes)` and explain in Notes / Known Issues below — never mark something Complete that silently doesn't meet its acceptance criteria.

---

## Post-V1: production fix and redesign pass (2026-09-20)

The owner deployed V1 (commit `b7a0538`) to Render + Neon themselves and reported it back broken:
sign-up failed and every tool run failed, both with a generic "Something went wrong". Root cause,
found by reading the two routes' error handling and `docs/DEPLOYMENT.md` §2: Render had
`DATABASE_URL` set, but `npm run db:deploy` (`prisma migrate deploy`) was a documented _manual_
step that was never run against the new Neon database — so the connection worked but every table
was missing, and both signup (writes `User`) and every tool run (writes a `Job` row unconditionally
once a database is configured) hit the same raw, uncaught Prisma error. Fixed at the root:
`npm run build` now runs `scripts/maybe-migrate.mjs` (skips cleanly with no `DATABASE_URL`), so a
deploy can no longer ship half-configured. This is a code fix; it only takes effect once Render
redeploys off `main`.

Alongside the fix, the owner asked for a large UX pass in the same session: real logo + a
"royal purple/silver" theme applied via the existing token system, password show/hide + live
mismatch warnings everywhere, a back button (root layout, hidden on `/`), a file/image preview
modal wired into `UploadZone`, an `/account` split into Personal/App tabs with drag-and-drop
avatar upload (stored as a resized `data:` URL, not a binary column — same pattern already used
for signature pads), a dropdown account menu, and a Home page split into a signed-out marketing
Landing page and a signed-in/no-accounts-configured Dashboard. The AI Assistant became a real chat
transcript (multi-turn, still plan-then-confirm, never bypassing the tool registry) and gained a
genuine "chat" intent (`ai/intent.ts`, `ai/assistant.ts`) so small talk gets a conversational reply
from the existing model runtime instead of "OneStop cannot do that" — no new AI provider, still
Ollama/Groq/OpenRouter/Google AI Studio only (CLAUDE.md §2.8).

**Deviation, logged per CLAUDE.md §9 rather than guessed silently:** the request for a signed-out
visitor's navbar/page ("don't give them any functionality... just the logo and title along with
sign in") is in real tension with master plan §9 ("Guest/local users can still use public tools")
and the guest-mode engineering built across phases 04–17 (IndexedDB history/favourites, no-auth
tool runs, the rate limiter's anonymous-caller path). Implemented conservatively: a signed-out
visitor gets the minimal header and the marketing Landing page **only when this instance has
accounts configured at all** (so an instance with no database, where nobody can ever sign in,
keeps the full nav it always had); a direct link to any tool still works for a guest exactly as
before, since removing that would be a regression against an explicit, repeatedly-tested product
guarantee, not a redesign of it. See **Open Questions** below.

Also scoped down deliberately: item 14's "notifications" in a dashboard topbar was not built. There
is no notification-generating system anywhere in the app (no queue, no async job completion event a
user isn't already looking at), and a bell icon with nothing real behind it would be decorative
rather than functional. The dashboard's "Recent activity" panel (`RecentJobs`, already real) covers
the same need honestly; a real notification source is a fair candidate for a future "Next Up" item
if one is ever needed.

---

## Post-V1: second owner pass (2026-09-22)

The owner used the Render deployment and asked for fifteen changes in one message. All are in, in
both the deployed and the local app (same code). What was found and decided, in the order asked:

1. **Name change did not reach the header.** The header reads the name from the session cookie and
   nothing refreshed it. The profile page now announces the change to the header immediately
   (`lib/profile-events.ts`) and brings the cookie up to date behind it; the `jwt` callback reads the
   new name back from the database instead of trusting the client. Auth.js silently ignores an
   `update()` made while the session is still loading, which is why the sync waits for it.
2. **Sign out went to `localhost:10000`.** Auth.js built its redirect from the internal address
   behind Render's proxy. Sign-out now clears the session and sends the browser to a _relative_ `/`
   (`lib/sign-out.ts`), and repeats the sign-out if a session read that was already in flight
   revived the cookie (found in the real-browser run). `applyPublicAuthUrl` also points Auth.js at
   `RENDER_EXTERNAL_URL` when the configured URL is missing or `localhost`.
3. **Emails.** Sign-up and reset now send real email. The mailer gained a **Brevo** HTTPS transport
   (Render's free tier blocks SMTP, so SMTP alone cannot work there), tries every configured
   transport in order, and derives the SMTP sender from the account. Reset links are built from
   `RENDER_EXTERNAL_URL`/`APP_URL`, never the request's `Host` header (that would allow a
   password-reset-poisoning attack). Saving the new password signs the person in and lands on `/`.
4. **Sign-in landed on `/account`.** It was the bounce from a signed-out `/account` carrying
   `?next=/account`. That redirect no longer carries `next`, and `landingAfterSignIn` never returns
   an `/account` or `/auth` path.
5. **Email-verified sign-up.** New `SignupOtp` table (migration `20260922090000_signup_otp`, applied
   by the build's `maybe-migrate` step). `POST /api/auth/signup` only stores a pending sign-up and
   emails a 6-digit code; `POST /api/auth/signup/verify` creates the account. The code is stored as
   an HMAC, expires in 10 minutes, allows 5 wrong guesses and 1 resend per 30 seconds.
6. / 11. **Assistant screen.** The provider/disclosure block is gone. When nothing can answer it
   shows one line: "AI assistant is out of service right now. Check your app settings for issue
   remediation." Failures no longer say anything about Ollama or keys.
7. **Header** is fixed: `overflow-x: hidden` on `<html>`/`<body>` had turned them into scroll
   containers, which breaks `position: sticky`. Now `overflow-x: clip`.
8. **Home buttons swapped** (see Open Questions for the interpretation).
9. **Working notices** while the assistant is planning or running ("Figuring out…", "Processing…",
   "Preparing…", "Last-minute changes…", and more), rotating every ~2 s.
10. **"No AI runtime is available" on Render** was a real bug, not a missing key: the chat path turned
    _every_ AI failure (a rejected key, a rate limit, a timeout) into that Ollama-install message.
    Failures are now distinguished, and a failing provider hands the request to the next.
    12.-14. **AI service settings.** Settings has "Use OneStop AI service (available/unavailable)" versus
    "Use your own AI service provider". The first uses only the server's keys; the second only the
    visitor's (Ollama / Groq / OpenRouter / Gemini, key auto-filled from this browser, kept in
    `localStorage` only, never sent to the account). Availability is a real, cached check (a
    zero-cost `models`/`auth/key` request, or Ollama's port), and **Check connection** now really tests
    the key instead of only reporting that one exists. Ollama is dimmed out when the server cannot
    reach one (always, on a hosted instance). Requests go to the visitor's pick first (own) or a
    random provider (hosted), falling through the rest; when all are used up the answer is "Out of
    credits. Visit <link> to increase your credits usage."
11. **Theme.** Purple/blue removed. Dark is black lacquer with cool steel highlights; light is
    polished chrome with champagne glints; graphite and platinum are the accents. Derived from the
    two reference images' measured colours and built from layered CSS gradients (no image is used),
    with matching card sheen/shadow and button sheen. `themeColor`, the manifest and the icon
    background follow.

A testing hazard found on the way: the suite loads `.env`, and the local `.env` holds a working SMTP
login, so the new sign-up tests briefly **sent real email through it** (a few messages to
`example.com` addresses, which cannot be delivered). `tests/setup/env.ts` now pins the mail
transport to the console for every test.

**Still needs a human (needs the Render dashboard, which this repository cannot reach):** set
`BREVO_API_KEY` and `MAIL_FROM` (or `RESEND_API_KEY`, or `SMTP_URL` on a paid instance) on the
Render service. Until then sign-up and password reset answer "Email delivery is not set up on this
server yet". See `docs/DEPLOYMENT.md` §5.1.

---

## Post-V1: third owner pass (2026-09-22)

The owner reported the AI Assistant still not answering on Render even with `GROQ_API_KEY`,
`OPENROUTER_API_KEY` and `GOOGLE_AI_API_KEY` set, plus four account-security/UX asks. All fixed, in
both the deployed and the local app (same code).

1. **Root cause of the assistant being "out of service" with real keys configured:** two of the
   three hosted providers' hardcoded `defaultModel`s had gone stale since this was last built —
   OpenRouter's free `meta-llama/llama-3.3-70b-instruct:free` no longer exists in OpenRouter's
   catalogue (confirmed live against `GET /api/v1/models`), and Google's `gemini-2.0-flash` has
   been shut down (confirmed against Google's own docs). Every chat call to either provider failed
   with a plain "could not complete that request" / 404, which the assistant's chat path collapses
   into the one generic out-of-service line (by design — see item 10 of the previous pass) so the
   real cause never reached the UI or the logs distinctly. Groq's `llama-3.3-70b-versatile` was
   still fine. Fixed in `apps/api/src/ai/providers.ts`: OpenRouter now defaults to
   `google/gemma-4-31b-it:free` (confirmed live: supports `response_format`, which the intent
   detector and planner rely on for JSON mode); Google now defaults to `gemini-flash-latest`, a
   rolling alias Google documents specifically so this class of bug stops recurring — a hardcoded
   dated model id will go stale again, an alias will not. Verified against the real Groq and
   Gemini live runtimes in `apps/api/src/ai/live.test.ts` (see item 4 below) and, for OpenRouter,
   against the live model-catalogue endpoint (no OpenRouter key was available to run a live chat
   call against it here — worth a follow-up live check with a real key).
2. **API keys were shared across accounts on the same browser.** `onestop-ai-keys` in `localStorage`
   was one flat, unscoped key — signing out and into a different account on the same browser handed
   the new account the previous one's saved keys. Fixed in `lib/preferences.ts`: keys are now stored
   under `onestop-ai-keys:<userId>` (`onestop-ai-keys:guest` when signed out), switched by a new
   `setAiKeyScope()` that a small always-mounted `AiKeyScopeSync` component
   (`components/auth/SessionProvider.tsx`) calls whenever the session's user id changes. A one-time,
   best-effort migration moves the old flat value onto whichever scope is active the first time it
   is read post-upgrade (the common single-account-per-browser case), then deletes it, so it can
   never be read twice. `preferredAI` (which provider, not the key itself) was left unscoped: it is
   not a credential and already syncs per-account through `UserSettings` in Postgres.
3. **Email change now requires two OTP codes, not a free edit.** New Prisma model
   `EmailChangeRequest` (migration `20260922120000_email_change_and_delete_otp`). Starting a change
   (`POST /api/account/email`) emails a 6-digit code to the _current_ address; entering it
   (`POST /api/account/email/verify-current`) emails a second code to the _new_ address; only
   entering that (`POST /api/account/email/verify-new`) moves the account's email. Both codes are
   HMAC-bound to the account id and step, never stored in clear, expire in 10 minutes, allow 5 wrong
   guesses and a 30-second resend gap — the same shape as the existing sign-up OTP
   (`apps/api/src/auth/signup-otp.ts`), factored out into a shared `apps/api/src/auth/otp.ts` so all
   three OTP flows (sign-up, email change, account deletion) hash codes the same way.
4. **Account deletion now requires an emailed OTP.** New Prisma model `AccountDeleteOtp`, same
   migration as above. `DELETE /api/account` (the old one-click endpoint) is gone; deleting is now
   `POST /api/account/delete` (emails the code) then `POST /api/account/delete/confirm` (checks it,
   then actually deletes). `apps/web/src/test/auth-api.test.ts` was updated to exercise the new
   two-step flow instead of the old single call.
5. **Birthday field.** Added `birthday DateTime?` to `User` (same migration), a `YYYY-MM-DD` field
   in `PublicUser` (`packages/types/src/db.ts`), and `validateBirthday` in `auth/users.ts` (a real
   calendar date, not in the future). It lives in the Profile form next to Name and only changes
   when "Save profile" is submitted, same as Name always has.
6. **Test fallout, found and fixed while verifying #1 live:** `ai/live.test.ts` calls `chat()` and
   `getAiStatus()` with no credentials, intending to test only a locally running Ollama — but on a
   dev machine whose `.env` also carries real Groq/OpenRouter/Gemini keys (this one does), the
   provider shuffle in `availableConfigs()` is free to try a hosted provider first. Before this
   session that was invisible because the stale hosted model ids in #1 made those calls fail
   anyway, silently falling through to Ollama; fixing #1 made the hosted providers genuinely work,
   which surfaced the test's hidden nondeterminism. Pinned every call in that file to
   `{ provider: "ollama" }` so it tests what its own header comment says it tests, independent of
   whatever else happens to be configured locally.

No migration needed a live database to write by hand — `prisma generate` was run against the schema
to refresh the generated client's types, but there is no local Postgres running in this environment
to also apply it; `scripts/maybe-migrate.mjs` (already wired into `npm run build`) applies it on the
next Render deploy the same way the two migrations before it were applied.

**Open follow-up, not blocking:** the OpenRouter model-id fix (#1) was verified against the live
model catalogue and its declared parameter support, but not against a live chat completion (no
OpenRouter key was available in this environment). Worth a quick live check with a real key before
calling that leg fully proven — if `google/gemma-4-31b-it:free` also goes stale later, the fix is
the same: re-check `GET https://openrouter.ai/api/v1/models` for a current `:free` model that lists
`response_format` in `supported_parameters`.

---

## Post-V1: fourth owner pass — real progress bars (2026-09-22)

The owner asked for a percentage progress bar on any conversion, media manipulation or workflow run
(the workflow runner screenshot showed only a static "Running…" button with no indication of how
far along it was). The pipeline is deliberately still one synchronous request/response
(04-file-core.md) — no job queue, no polling architecture rewrite — so this was built as a small,
additive side channel rather than a restructure, to avoid risking the ~950 passing tests across 20
already-complete phases:

- **`apps/api/src/progress/store.ts`** (new): an in-memory `Map<token, {percent, label, done}>`,
  swept after 10 minutes. The browser generates a random `progressToken` before it starts a run,
  sends it alongside the existing `POST /api/tools/run` / `POST /api/workflows/run` body, and polls
  the new `GET /api/progress/:token` every 400ms *while that POST is still in flight*. Nothing
  reads the store to decide anything — a caller that never polls loses nothing, so this could not
  regress an existing test, and none did.
- **Stage-based percentage for every tool** (`runPipeline` in `file-processing/pipeline.ts`): 5%
  preparing → 15% validating → 30% processing start → (25-90% executor-reported, see below) → 92%
  saving the result → 100% done, or frozen at whatever it reached on failure. This alone covers all
  206 registry tools with real (not fake/animated) stage transitions, since it needs zero per-tool
  changes.
- **Real fractional progress for FFmpeg-backed tools**: `ExecContext` gained an optional
  `reportProgress(fraction: 0-1)`. `ffmpegCheck.ts`'s one shared spawn function now parses FFmpeg's
  own `time=HH:MM:SS.ss` stderr lines against the input's known duration and calls it. Wired through
  the two shared encode functions everything else calls — `encodeVideo` (convertVideo.ts) and
  `encodeAudio` (convertAudio.ts) — so all 7 video-encode tools (converter, compressor, resizer,
  resolution, quality, rotate, to-mp4/webm) and all 9 audio-encode tools (converter, compressor,
  the four fixed-format converters, video-to-mp3) get genuine, live, sub-file percentages for free.
  `eachMedia`'s per-file context also grew a `total` (file count), and `scaledProgress(ctx)` in
  `media/common.ts` scales one file's 0-1 fraction into its slice of a multi-file job.
  **Deliberately not wired** (logged rather than silently skipped, per CLAUDE.md §9): trim, merge,
  normalize, subtitles, waveform, extract-audio/frames and video-to-gif call `runFfmpeg` directly
  rather than through the two shared encoders; they still get the honest stage-based percentage
  above, just not FFmpeg's own sub-progress. Worth revisiting if those specifically feel slow.
- **Workflows and batch runs** get real step/file-based percentages from their existing (already
  built in phase 15, never before wired to anything) `onProgress`/`onFileProgress` callbacks in
  `run.ts`/`batch.ts` — the route handler turns "step 2 of 4 running" into a percent and a label and
  writes it to the same store. Sub-step FFmpeg fractions are not composed into a workflow's overall
  percent (would need threading `progressToken` through every step's inner `runPipeline` call and
  rescaling) — out of scope for this pass, same reasoning as above.
- **Frontend**: `lib/useProgress.ts` (new) is the one polling hook, used by `ToolPage.tsx` (covers
  every generic tool page — one integration point, all 206 tools) and `WorkflowRunner.tsx` (the
  component in the owner's screenshot). `ToolStateMachine.tsx`'s progress bar now renders a real
  `width: {percent}%` fill and a label line when progress data has arrived, falling back to the
  original indeterminate pulse only until the first poll lands (so `role="progressbar"` keeps
  existing for the one test that already asserts it).
- Not touched: the AI Assistant's tool-execution UI. It already has its own rotating
  "Figuring out… / Processing… / Preparing…" notices from the third UX pass and wasn't part of what
  was asked (conversions, media manipulation, workflows); worth wiring to the same store later if
  the owner wants it there too.

Typecheck, lint and the full unit suite were run after this change with no failures or new skips.

---

## Post-V1: fifth owner pass — agentic assistant, all-tools sweep, motion (2026-09-26, branch `newVersion`)

- **Agentic assistant** (`apps/api/src/ai/agent.ts`, `POST /api/assistant/agent`, NDJSON stream). One
  loop over the ordinary `chat()`: the model may `search_tools`, `tool_info`, `run_tool` (typed text
  and/or files), `run_workflow` (steps feed each other), `read_file`, `create_workflow`, `open_page`,
  `favorite`, `final`. Every action is validated against the registry (unknown / non-available ids
  refused, page links allow-listed, options filtered to the ids the registry declares) and runs
  through `runPipeline`, so CLAUDE.md §2.6 still holds: no shell, no unregistered tool. Likely tools
  are matched *before* the first model call (fewer round trips, real option ids in the prompt), old
  tool results are shortened (free-tier tokens-per-minute), and the model must use a tool whenever
  one applies (no invented passwords/hashes). Workflows and stars are applied client-side so a
  guest's device-only lists still work. With no AI reachable (or any `AI_*` error) the chat falls
  back to the existing rule planner + confirm/run flow, so the app still works with nothing set up.
- **Bug fixed:** the first message of a new chat was lost ("That request was interrupted") because
  `router.push` to the new thread URL remounted `AssistantView` mid-request. The URL is now set with
  the History API and the thread id is read from `usePathname()`, so the component stays mounted.
  `updateTurn` no longer saves inside a state updater (React "setState in render" warning).
- **Every-tool sweep:** `tests/e2e/all-tools.e2e.test.ts` builds real fixtures (text, CSV, JSON, XML,
  YAML, XLSX, DOCX, PPTX, multi-page PDF, encrypted PDF, PNG/JPG/WebP/GIF, MP3/WAV/MP4 incl. a
  subtitled MP4, ZIP, SRT, QR image) and runs all 205 available tools through `runPipeline`
  (`npm run test:e2e -- tests/e2e/all-tools.e2e.test.ts`, ~5 min, needs FFmpeg and LibreOffice env
  as in `.env`). Result: everything runs; only tools that need the outside world (YouTube/Instagram
  via yt-dlp, a local Stable Diffusion server for the two AI image tools, a fillable-form PDF) may
  refuse — and they must refuse politely. Two real bugs found and fixed: `.yaml` uploads sent as
  `application/x-yaml` were rejected; AI OCR on an image with no text failed with "result is empty".
- **UI:** a pointer-reactive particle field behind every page (`components/fx/PointerField.tsx`),
  a spotlight that follows the cursor across every `Card` (`.os-glow`), a CSS-3D cube + orbiting
  category cards on the landing page that tilt toward the mouse (`ToolOrbit.tsx`), page/answer
  entrance motion, code-fence + table rendering in assistant replies. All of it stops on hidden
  tabs, is off under `prefers-reduced-motion`, and uses no library.
- **Tests:** the two long-standing `shell.test.tsx` failures (`/workflows/demo-1`) were the page
  assuming `searchParams` is always given; it now tolerates its absence. Full suite green.

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

- **04 — Execution moved server-side.** Every tool now runs through one endpoint, `POST /api/tools/run` (multipart), which calls `runPipeline`. The tool page no longer calls `getExecutor` in the browser: the client checks are a fast, friendly pre-filter and the server revalidates everything. This is what makes MIME/size/path validation a real boundary rather than a suggestion.
- **04 — Executors register themselves; the registry never imports them.** `registerExecutor(id, fn)` was added to `packages/tool-registry/src/executors.ts`; real processing lives in `apps/api/src/file-processing/executors/` and registers at import time of `@onestop/api`. The registry stays free of `node:` imports so it can still be bundled for the browser. Phases 05-17 should follow this pattern.
- **04 — The pipeline owns the filesystem; executors only see bytes.** `Executor` gained an optional third argument, `ExecContext` (`jobId`, `readFile(ref)`, `signal`), and `ExecResult` gained `files: OutputFile[]`. A tool never receives or builds a path, and `readFile` refuses any temp id that does not belong to the running job.
- **04 — Temp files are named by random UUID, never by the uploaded filename.** The sanitised name is metadata only, so a hostile name cannot influence a path at all. `isTempFileId` gates every id before it becomes a path, which is also what makes `/api/files/:id` traversal-proof.
- **04 — Three independent guarantees of deletion:** the pipeline deletes inputs in a `finally` (so a failed or timed-out job still cleans up), an unref'd sweeper deletes anything past `TEMP_FILE_TTL_MINUTES` (default 60) even if the user abandons the tab, and a store created in a fresh process purges leftovers from a previous one. Results survive until downloaded or until the window closes.
- **04 — Validation is three checks, all required:** sanitised filename, size against `MAX_UPLOAD_MB` (default 100; 4x that per request, at most 50 files), and extension against both the declared MIME type and the file's own magic bytes. A generic browser MIME (`application/octet-stream`, or empty) never rejects on its own; a `.pdf` carrying PNG bytes does.
- **04 — Jobs stay in memory** behind the `JobStore` interface (`create/get/update/list/delete/clear`), with a state-transition guard and a 500-job cap. Phase 13 swaps the implementation in via `setJobStore`; no caller changes.
- **04 — Executors get a 120 s timeout** (`DEFAULT_EXECUTION_TIMEOUT_MS`) through an `AbortController`; a tool that hangs fails its job and still cleans up.
- **05 — PDF stack: `pdf-lib` + `pdf.js` + `@napi-rs/canvas`, all local, all free.** `pdf-lib` does the structural work (merge/split/extract/delete/reorder/rotate/resize and every re-save); `pdfjs-dist` (legacy build) reads page content; `@napi-rs/canvas` gives pdf.js a Node canvas via a prebuilt binary, so there is no node-gyp build and no system library to install. PyMuPDF was not needed — the build file allows it "if Node libraries struggle", and they did not.
- **05 — pdf.js is configured to be inert and offline:** `isEvalSupported: false`, `enableXfa: false`, `disableStream`/`disableAutoFetch`, and standard fonts/CMaps/WASM/ICC loaded from `node_modules/pdfjs-dist` by filesystem path. That path is found by walking up from the module and the working directory, **not** with `require.resolve` — once Next bundles the module the bundler's `require` returns a module id, not a path. This failed only under `next start`, never in tests, which is worth remembering.
- **05 — `pdfjs-dist`, `@napi-rs/canvas` and `pdf-lib` are listed in `serverExternalPackages`** in `apps/web/next.config.ts`: the canvas binary and pdf.js's asset lookups must not be bundled.
- **05 — Compression is two strategies, and the smaller one wins.** "Light" is lossless (copy every page into a fresh document, drop metadata, object streams); "Balanced"/"Strong" re-render each page as a JPEG at 120/80 DPI. The result is returned only if it is genuinely smaller than the input, and the summary says plainly when text stopped being selectable.
- **05 — Repair PDF tries four strategies in order:** strict parse, tolerant parse, byte salvage (trim junk before `%PDF` and after the last `%%EOF`), then rasterised recovery through pdf.js. Each is a real attempt, and the summary names which one worked.
- **05 — Tool options live in the registry** (`packages/tool-registry/src/options.ts`, `TOOL_OPTIONS`), not in page code: `select` / `text` / `number` / `boolean` plus a declarative `showWhen` equality condition. `ToolOptions.tsx` renders whatever the registry declares and sends only the _visible_ values, so phases 15/16 can discover what a tool accepts from the same source of truth.
- **05 — `offline` is now derived, never authored.** `loadRegistry` sets `offline: true` for the ids in `VERIFIED_OFFLINE` and for no others, so an entry cannot claim it. The eleven PDF tools earned it through an offline test that runs each of them with `fetch`, `http.get/request` and `https.get/request` replaced by traps that throw.

- **06 — `pdf-lib` was replaced by its maintained fork `@cantoo/pdf-lib` everywhere** (a drop-in: same API, all 63 phase-05 tests pass unchanged). It adds standard-security encryption (AES-256 default, AES-128 option; RC4 refused) and decryption with a known password, which is what Password Protect / Remove Password need. `loadPdf(bytes, { password })` now decrypts; without a password an encrypted file is still refused with the phase-05 message, and a wrong password gets its own message ("That password is not correct for this PDF…"). pdf.js `withPdfJs` gained the same `password` option.
- **06 — OCR path: JavaScript (`tesseract.js` 7, Apache-2.0), not Python.** Tesseract compiled to WASM runs in a Node worker thread with the English LSTM model from `@tesseract.js-data/eng`, read from `node_modules` — no download, no system binary, no cloud API. Python/pytesseract was rejected because it needs a separately installed Tesseract binary. `OCR_LANG_PATH` can point at extra `.traineddata.gz` files; the UI offers English only today.
- **06 — LibreOffice is truly optional, not required for full function.** `apps/api/src/shared/office-convert.ts` is the single Office ⇄ PDF interface: `officeToPdf` prefers LibreOffice when found (`LIBREOFFICE_PATH`, PATH, default install folders) and otherwise uses built-in converters (docx via mammoth, xlsx via exceljs, pptx via its XML, txt), returning a `notice` that fidelity may be lower; `.doc/.xls/.ppt/OpenDocument` without LibreOffice fail with "needs LibreOffice… install it free from libreoffice.org, or save as .docx". `pdfToOffice` uses the built-in converters by default (they produce real editable structure; LibreOffice's PDF import makes Draw frames) and LibreOffice only when asked (PDF → Word "Converter" option). A LibreOffice that is present but fails also falls back. It is spawned with `shell: false`, a throwaway profile, a timeout and a scratch dir that is always removed. LibreOffice is only needed for higher-fidelity layout and for the legacy/OpenDocument formats.
- **06 — Office libraries:** `docx` (write .docx), `exceljs` (read/write .xlsx), `pptxgenjs` (write .pptx), `mammoth` (read .docx), `jszip` (read .pptx). All MIT/BSD, pure JS. Phases 07/08 should reuse them through `office-convert.ts` rather than adding parallel ones.
- **06 — Fonts:** text OneStop draws (watermarks, page numbers, OCR/PDF-A text layers, form appearances, Office → PDF) uses the Liberation Sans TTFs that ship inside `pdfjs-dist/standard_fonts`, embedded as ~6 KB subsets via `fontkit` 2 (`@pdf-lib/fontkit` crashes subsetting these files). So Cyrillic/Greek/Polish text works, and embedded fonts satisfy PDF/A.
- **06 — Sign PDF's certificate is self-signed and says so.** Optional "seal": a fresh RSA-2048 key and X.509 certificate per signing (Node crypto + `node-forge`), PKCS#7 detached SHA-256 via `@signpdf/signpdf`, over a ByteRange placeholder written with `@cantoo/pdf-lib` classes (`@signpdf/placeholder-pdf-lib` would pull the old `pdf-lib` back in). The test verifies the signature with forge and shows tampering breaks it. The summary tells the user readers will show an unverified identity.
- **06 — PDF/A target is PDF/A-2b**, checked by our own `checkPdfA` (header + binary comment, trailer ID, no encryption, uncompressed XMP with `pdfaid` part/conformance matching `/Info`, GTS_PDFA1 output intent with a valid ICC profile, every font embedded, no JavaScript/embedded files/XFA/NeedAppearances/forbidden actions or annotations, annotations set to print, no LZW). The sRGB ICC profile is _generated_ (~500 bytes) rather than committed. Pages whose fonts are not embedded are rebuilt as images with an invisible, embedded-font text layer, so the result conforms and stays searchable. The summary reports the check's verdict honestly.
- **06 — Passwords and drawn signatures never reach the job record.** Found in the `next start` smoke test: `inputMetadata.options` echoed the password in plaintext (and phase 13 would have persisted it). `redactOptionValues` (tool registry) now replaces `secret` text options with `[redacted]` and signatures with `[signature]` before the pipeline stores options; the executor still receives the real values.
- **06 — Registry option types grew:** text options can be `secret` (password field) or `multiline` (textarea), and a new `signature` type renders a pointer-events drawing pad (`SignaturePad.tsx`) whose value is a PNG data URL the server strictly re-decodes (PNG/JPEG magic bytes, ≤3 MB).

- **07 — Word/PowerPoint structure is edited as OOXML, not round-tripped.** Merge/Split Documents and every slide tool work directly on the package XML (`apps/api/src/documents/ooxml.ts`: rels, content types, `PartCopier`, `renameParts`, `removeUnreachableParts`). Round-tripping through HTML or pptxgenjs would lose formatting, headers, themes and pictures. **Merge Documents** appends each document as its own _section_ (keeps page setup, headers/footers), imports missing styles, renumbers list definitions, imports footnotes/endnotes with fresh ids, copies pictures/charts/links with fresh relationship ids, and drops comment anchors. **Merge Presentations** copies each extra deck's slides _with_ their layouts, masters and theme (fresh master/layout ids); the first deck's slide size wins (the summary says so when they differ).
- **07 — "Renumbers remaining slides" is done three ways:** the `sldIdLst` is rebuilt in the new order, slide parts are renamed `slide1.xml…slideN.xml`, and every slide-number field's cached text (slides and notes) is rewritten. Sections and custom shows that would point at removed/reordered slides are dropped, `docProps/app.xml` gets the new slide count, and orphaned slides/notes/media are deleted.
- **07 — Grammar Checker (for phase 16):** `nspell` + `dictionary-en` (Hunspell en-US, read from node_modules by path) for spelling; OneStop's own rules for repeated words, a/an, lower-case "i", sentence capitals, punctuation spacing, "could of"/"more then"-type errors and ~45 common misspellings; `write-good` for style (passive voice, weasel words, wordiness, clichés). Only rule-based fixes are auto-applied to the corrected copy; dictionary suggestions stay in the report. All MIT/BSD, offline. Engine: `documents/text/grammar.ts` `checkGrammar(text, {spelling, style})`.
- **07 — Summarizer (for phase 16):** local extractive TF-IDF — each sentence is scored by how central its terms are to the whole document (tf × document frequency × idf, length-normalised), with bonuses for title-word overlap and early position; the top k (short/medium/long) are returned in original order, plus key terms. Engine: `documents/text/summarize.ts` `summarize(text, {length, title})`.
- **07 — Translator (for phase 16):** no practical offline MT package exists for Node without a large model download, so the default is a built-in 6-language glossary (en/es/fr/de/it/pt, ~230 phrase and word rows, phrases matched first, case and punctuation preserved). It is honest about quality: the summary reports coverage and says the result is rough and literal. `.docx` is translated in place (`w:t` runs in body/headers/footers/notes), so layout survives. Engine: `documents/text/translate.ts` `translateText(text, from, to)`. Phase 16 should put an LLM (Ollama, or a free hosted model with the user's key) behind these three functions; the tools' options and outputs need not change.
- **07 — New built-in converters:** `.rtf` (own RTF reader: groups, hex and Unicode escapes, skipped destinations) and `.odt` (`content.xml` headings/paragraphs) were added to `officeToPdf`'s built-in list, so Document → PDF works fully offline for docx/odt/rtf/txt. Only binary `.doc`/`.ppt` still need LibreOffice; without it they fail with the same actionable message as phase 06.
- **07 — Compression:** pictures are decoded with `@napi-rs/canvas`, downscaled (Balanced 1920 px, Strong 1280 px) and re-encoded — opaque PNG/BMP/TIFF become JPEG (renamed; relationships and content types updated), transparent PNGs stay PNG. A picture is replaced only if it shrinks by more than 5%, unreachable parts are dropped, the package is re-zipped at level 9, and the original is returned if nothing got smaller. Light is lossless.
- **07 — File-or-text tools.** Grammar Checker and Text Formatter accept a file _or_ pasted text. `acceptsTypedText(tool)` (registry `io.ts`) marks them; the generic tool page shows an "…or paste text instead" box under the upload zone, and the pipeline's shape check accepts `text` for them (saying "Choose a file or enter some text first." when both are empty).
- **08 — One table model for every data tool.** `apps/api/src/data/common.ts` defines `Table` (headers, typed rows, and provenance: each row's source row number and each column's source column). Every reader (CSV, Excel sheet, JSON records, XML records) produces one and every writer consumes one, so there are 30 tools but only 5 readers and 5 writers. Provenance is what lets messages say "Row 12, column C (\"Email\")" and lets Excel results keep the formatting of the rows that survive a clean.
- **08 — Typing rules (shared by CSV and XML):** a value becomes a number only if it is unambiguous: no leading zeros, and integers within 2^53. So "007", "02139" and 20-digit ids stay text. `true`/`false` become booleans. ISO dates become real `Date`s _only_ when the target has a date type (Excel); in JSON/CSV/XML they stay ISO text. Excel dates come out as `2024-01-15` (UTC midnight) or `2024-01-15T10:30:00Z`. Formulas come out as their saved result; a formula with no cached result is reported, not silently blanked.
- **08 — Libraries:** `papaparse` (CSV, parsed row by row with `step`), `fast-xml-parser` 5 (validation + parsing), `js-yaml` 5 (safe core schema), `ajv` 8 + `ajv-formats` (JSON Schema drafts 07/2019-09/2020-12), and `exceljs`/`docx` reused from phase 06. All MIT, pure JS, offline. SheetJS was not used: the npm build is stale and `exceljs` was already a dependency.
- **08 — JSON errors come from OneStop's own locating scanner** (`scanJson`). Values are parsed with native `JSON.parse`; only on failure (or for schema line mapping / duplicate-key detection) does a small strict reader walk the text, giving messages like "Line 3, column 1: Trailing comma before '}' — remove the comma after the last property." It recognises trailing commas, single quotes, unquoted keys, missing commas, unclosed brackets, comments, NaN/undefined/True, bad escapes and raw line breaks in strings.
- **08 — XML safety:** any `<!ENTITY` declaration is refused before parsing (entity-expansion bombs), and a single-root check was added because `fast-xml-parser`'s validator accepts `<a/><b/>`. The XML formatter tokenises instead of round-tripping a parse tree, so comments, CDATA, PIs and entity references come through byte-for-byte.
- **08 — CSV output guards against formula injection by default** ("Protect against formula injection", on): text starting with `=` or `@`, or `+`/`-` followed by a letter or `(`, gets a leading `'`. Numbers and phone numbers like `+44 20…` are untouched. CSV → CSV tools (merger/splitter) never escape, since they must write back exactly what they read.
- **08 — Validators succeed with a report.** "This file has problems" is the tool working, so JSON/XML/Data Validator return `ok` with the findings in the summary and a JSON report. Only unreadable input is a failed job. Conversions still fail with the located message.
- **09 — Image engine: `sharp` 0.35 (libvips, prebuilt binaries, Apache-2.0)**, already installed by Next and now an explicit `@onestop/api` dependency. Text (Add Text, Watermark, Meme, the editor caption) is drawn with `@napi-rs/canvas` in the Liberation fonts from `pdfjs-dist`, not with sharp/Pango, so output is identical on every OS and fully offline. New deps: `exif-reader` (MIT, EXIF parsing) and `heic-decode` (ISC, wraps `libheif-js` WASM, LGPL) for HEIC input. All listed in `serverExternalPackages`.
- **09 — Format coverage:** sharp reads/writes JPG, PNG, WebP, GIF (animated), TIFF, AVIF. BMP isn't in sharp's prebuilt libvips, so `images/bmp.ts` is OneStop's own reader (1/4/8/16/24/32-bit, bit-fields) and writer (24-bit, or 32-bit with alpha). HEIC is decoded via WASM; it cannot be written (the HEVC encoder is patent-encumbered), so "same format" output for HEIC is JPG. Formats are sniffed from magic bytes; the extension is only a tie-breaker.
- **09 — Safety:** every decode is capped at 120 megapixels (`limitInputPixels`; decompression-bomb test with a forged PNG header), every output at 100 megapixels, colours are parsed from a whitelist (hex / a short name list / transparent) before going into SVG, and nothing leaves the process.
- **09 — Local AI model interface** (`apps/api/src/images/model.ts`): `ImageModelRuntime { name, supports(task), run(task, png, params) }` with tasks `remove-background | inpaint | upscale | enhance | sharpen | denoise`, registered by phase 16 via `setImageModelRuntime`. Every model-capable tool has a `method` option: `auto` (model if configured, else built-in, and the summary says which), `ai` (model only; without one → exactly "This feature needs a local AI model. Enable one in Settings."), `builtin`. `runModel` checks the model's output is a real image of sane size, so a broken model is a clear failure, never a fake success. Registry: new optional `ToolMeta.localModel: "optional" | "required"` (validated by the loader, shown as an "AI optional" badge); the seven model-capable image tools are `optional` because each has a built-in method.
- **09 — Built-in (non-AI) methods:** Background Removal flood-fills a plain background inwards from the edges with a soft edge, and refuses (pointing to the local model) when the border is too busy; Object Removal fills a marked rectangle by onion-peel inpainting plus smoothing; Upscaler is Lanczos + unsharp mask; Enhancer is auto-levels + CLAHE + saturation + sharpen; Sharpening is an unsharp mask; Denoiser is median + light blur; Background Blur keeps a feathered focus ellipse sharp (or, with a model, the detected subject).
- **09 — Remove Image Metadata is lossless for JPEG and PNG:** metadata segments/chunks are cut out byte-for-byte (JFIF, Adobe and, by default, the ICC profile are kept), so pixels are identical. A JPEG with an EXIF rotation is re-encoded upright first (once the tag is gone nothing would rotate it); other formats are re-encoded without metadata.

- **10 - FFmpeg is spawned directly, not through `fluent-ffmpeg`.** The build file suggests `fluent-ffmpeg`, but that package was archived in May 2025 and is only a string builder over the same CLI. `media/ffmpegCheck.ts` spawns `ffmpeg`/`ffprobe` itself with `shell: false`, fixed argument arrays, a timeout, `AbortSignal` kill and `-protocol_whitelist file` on every input - the same shape as phase 06's LibreOffice wrapper, with one fewer dependency. **Phase 10 adds no npm dependencies at all.**
- **10 - FFmpeg is required, and detected once.** `findFfmpeg()` checks `FFMPEG_PATH`/`FFPROBE_PATH`, then PATH, then the usual install folders per OS (including the winget Links folder on Windows); both binaries must be present. The result is cached per process, `media/index.ts` logs one warning at startup when it is missing, and every tool that needs it fails with exactly `FFMPEG_MISSING_MESSAGE` ("FFmpeg is required for audio/video tools - see setup instructions." plus the per-OS install commands). `ffmpegStatus()` is what phase 18's `/status` should show. Tested against **FFmpeg 9.0-full_build (gyan.dev) on Windows 11**, installed with `winget install Gyan.FFmpeg` following the README's own instructions.
- **10 - Media tools get a 10-minute executor timeout** (`executorTimeoutMs` in `pipeline.ts`, `MEDIA_TIMEOUT_SECONDS`, capped at 1 hour); every other tool keeps 120 s. Re-encoding a real video legitimately takes minutes, and the 120 s cap would have failed honest jobs.
- **10 - FFmpeg never opens anything but the one file it is given.** Inputs are copied into a fresh `onestop-media-*` scratch directory as `in-<n>.<ext>` (extension whitelisted by regex), FFmpeg runs with that directory as its cwd, every `-i` is preceded by `-protocol_whitelist file`, uploads whose first bytes look like a playlist (`#EXTM3U`, `ffconcat`, MPD, `[playlist]`) are refused, and a probe reporting a referencing demuxer (hls/concat/dash/image2/lavfi...) is refused too. That closes the classic "playlist disguised as a video reads /etc/passwd" path. Merging uses the concat _filter_, never the concat demuxer, for the same reason.
- **10 - Subtitles are OneStop's own engine, not FFmpeg's.** `media/subtitles.ts` reads and writes SRT, WebVTT and ASS/SSA in pure TypeScript (cue model in milliseconds; `<i>/<b>/<u>` kept, VTT classes/voices/NOTE/STYLE and ASS override tags handled; UTF-8/UTF-16/Windows-1252 decoding), so Subtitle Conversion works **with no FFmpeg at all** and SRT -> VTT -> SRT is lossless. Subtitle Extraction uses FFmpeg only to pull a track out (normalised to SRT), then formats it with the same writer; image-based tracks (PGS/VobSub) are refused with an explanation rather than producing empty text.
- **10 - Conversions copy streams when they can.** `canRemux` knows which codecs each container accepts, so MKV (H.264/AAC) -> MP4 is an instant, lossless remux; anything else re-encodes (x264 `veryfast` / VP9 `realtime` / MPEG-4 for AVI) and the summary says which happened. Video Trimmer offers the same choice as "Fast" (stream copy, keyframe-accurate) vs "Exactly where I said".
- **10 - Volume Normalizer is two-pass EBU R128 `loudnorm`** (measure, then a linear gain onto -14/-16/-23 LUFS with a true-peak ceiling), with a simple `volumedetect` + `volume` peak mode as the alternative. The test measures the output and asserts it lands within 1.5 LU of the target.
- **10 - The waveform is computed, not drawn by FFmpeg.** FFmpeg decodes to mono 16-bit PCM at a rate chosen to stay under 20 M samples; OneStop reduces that to min/max peaks per column and renders its own SVG (three styles), rasterised to PNG with sharp. `output.files[].peaks` returns the same array, so a frontend - or phase 15/16 - can draw it itself.

- **11 - Two new dependencies, both offline and permissively licensed:** `qrcode` (MIT) for the module matrix only, and `jsqr` (Apache-2.0) for decoding. Neither touches the network. All drawing is OneStop's own: `qr/generate.ts` renders the matrix to SVG by hand and to PNG with `@napi-rs/canvas` (already a phase-06 dependency), which is what makes dot/rounded modules, custom finder patterns and a centre logo possible through one code path for both formats.
- **11 - A QR code counts as valid only if it can be read back.** Every generating tool is tested by decoding its own output (SVG results rasterised with sharp first), across all eight content types, plus a logo'd code, an inverted code and a 128 px code. The decoder retries a photographed code as supplied, high-contrast, sharpened, thresholded, rotated 90/180/270, inverted and enlarged, so a real phone photo decodes.
- **11 - Dense codes are enlarged rather than shipped unreadable.** `minimumSizeFor()` raises the requested size to at least 3 px per module, so a version-40 payload (177 modules) is never returned as an unscannable 512 px image. The summary reports the size actually used.
- **11 - Payload conventions live in one file** (`qr/formats.ts`): `WIFI:` with proper escaping, vCard 3.0 with RFC 6350 escaping and 75-octet line folding, `mailto:`/`tel:`/`sms:`/`geo:`, plus a parser that names what a scanned code holds. Both directions are tested, and the same module is what phase 16's assistant should call.
- **11 - Only http(s) is ever encoded or redirected to.** A QR code is opened by a phone the instant it is scanned, so `buildUrl`, the hosted-page links and the `PATCH /api/qr/links/:id` destination all refuse `javascript:`, `data:` and any other scheme (master plan 15).
- **11 - Colour pairs are checked before anything is rendered.** Below a 3:1 contrast ratio the tool refuses with a plain explanation instead of producing a code no phone can read, and a logo automatically raises error correction to Q or H so the covered modules stay recoverable.
- **11 - Camera scanning never uploads anything.** `QRScanner.tsx` uses `BarcodeDetector` where the browser has it and jsQR everywhere else, decoding frames in the page; the stream is stopped on unmount. Every `getUserMedia` rejection maps to its own actionable sentence ("Camera access is needed to scan...", "No camera was found...", "The camera is already in use..."), tested with a mocked denial.
- **11 - Scan analytics are deliberately thin:** a timestamp, a coarse device family derived from the user-agent (iOS/Android/Windows/macOS/Linux/other) and the referrer's host. No IP address, no full user-agent string, and at most the 500 most recent scans per code.

- **12 - No new runtime dependency beyond `prettier` and `marked`.** The build file names Prettier (as a library), `jszip`, a Markdown parser and the Web Crypto API. `jszip` was already an `@onestop/api` dependency from phase 07; `prettier` was already in the repo as a dev tool and is now also an api dependency, so the formatters produce exactly what `npm run format` would; `marked` is the Markdown parser. `docx` (phase 07) builds the Word output.
- **12 - `node:crypto`, not `crypto.subtle`.** The build file suggests Web Crypto for hashing and secure randomness. Web Crypto has no MD5 at all - by design - and the same build file requires MD5 "for legacy compatibility labeling", so `node:crypto`'s `createHash`/`createHmac` do the hashing and `randomUUID`/`randomBytes`/`randomInt` the randomness. Both are the platform CSPRNG; `Math.random` appears nowhere, and a test proves it by making `Math.random` throw while a password is generated. MD5, SHA-1 and CRC-32 are labelled in the UI as integrity-only.
- **12 - JavaScript is compacted, never minified.** Prettier has no minify mode, and a hand-written JS minifier has to understand ASI, regex-vs-division and scope to rename safely; getting that subtly wrong silently corrupts someone's file. The JS "minify" mode therefore strips comments and indentation with a literal-aware scanner and keeps line structure, and the summary says so in as many words. CSS and HTML do minify properly (strings, comments, `<pre>`/`<textarea>` respected; embedded `<style>`/`<script>` minified in place).
- **12 - A new registry option type, `client`.** Its value is filled in by the browser from `navigator` / `Intl` - `userAgent`, `timeZone` or `locale` - because the executor runs on the server and cannot know them. Used by the User-Agent Viewer (the whole tool) and the Timestamp Converter (so "local time" is really the user's). It is declared in the registry like every other option, so the generic tool page still holds no per-tool knowledge and phases 15/16 can supply the same values headlessly. The page shows the value read-only rather than taking it silently (`apps/web/src/components/tools/ClientValue.tsx`).
- **12 - Two tools deliberately delegate instead of implementing.** **File Type Converter** asks the registry which available tool turns this extension into the requested one (preferring an exact output-type match, then popularity) and runs that tool's executor with its own defaults plus the right `format` value; **Metadata Remover** routes images to phase 09, PDFs to phase 06, Word/ODT to phase 07 and the remaining OOXML formats through the documents module's `stripOoxmlMetadata`. Tools that accept `any` are never a route, or they would match every request. This is CLAUDE.md §7 taken literally: one conversion, one implementation.
- **12 - The Regex Tester screens the pattern before running it.** A nested quantifier (`(a+)+`) is refused with an explanation rather than executed, the sample is capped at 256 KB, and matching stops at a match limit and a wall-clock budget. Node cannot interrupt a running regex, so the screen is the real defence; see Known Issues for the residual risk.

---

- **13 - Postgres host: whatever `DATABASE_URL` points at; the dev machine used a throwaway local cluster.** `docker-compose.yml` (Postgres 17, port 5432) stays the documented local option and Neon/Supabase/Railway the hosted ones - nothing in the code knows which. The dev machine already had a Postgres 15 service on 5432 whose superuser password nobody has, and the Docker daemon was not running, so the phase was built and tested against a scratch cluster on port 55433 (`initdb` + `pg_ctl`). Only `.env` (untracked) names it.
- **13 - Prisma 7 with the `pg` driver adapter.** Prisma 7 removed `url` from `datasource`: the CLI reads it from `prisma.config.ts` and the client from `new PrismaPg(...)`. The generated client is TypeScript under `apps/api/src/db/generated` (gitignored, excluded from lint/typecheck/prettier) and `npm run build` regenerates it first. Note for later phases: the schema is passed to the **adapter**, not in the URL.
- **13 - Passwords: bcrypt via `bcryptjs`, cost 12.** Pure JS, so no native build on any platform, and the build file allows bcrypt or argon2. `apps/api/src/dev-utils/hashing.ts` is deliberately untouched - those are fast file-integrity hashes and would be the wrong tool here.
- **13 - Sessions are JWTs, not database rows.** Auth.js's Credentials provider requires the JWT strategy anyway; it also means a guest request never costs a database round trip. The `sessions` table exists because the Prisma adapter's type surface needs it, and stays empty (a password reset clears it regardless).
- **13 - Reset email: three free paths, console by default.** With nothing configured the link is written to the server console (fully local, nothing to sign up for); `RESEND_API_KEY` uses Resend's free tier over plain `fetch` (no dependency); `SMTP_URL` uses `nodemailer` if it is installed (optional dependency, never required). Chosen by `MAIL_TRANSPORT` or by whichever key is present.
- **13 - Accounts are optional, everywhere.** With no `DATABASE_URL` the app still boots, every tool runs, jobs are kept in memory, and the auth pages say accounts are switched off instead of failing. With a database that then goes away, `createResilientJobStore` falls back to memory for 30 s at a time rather than taking running tools down.
- **13 - The repo-root `.env` is loaded by `apps/web/next.config.ts`.** Next only reads the `.env` beside the app it runs, but the repository documents a single root `.env`; the config loads it without overriding anything the shell or host already set.
- **13 - Database tests isolate themselves by schema.** Vitest runs files in parallel, so each database-touching file creates its own Postgres schema, applies `prisma/migrations` into it and drops it afterwards. Without a database (`TEST_DATABASE_URL`/`DATABASE_URL` unset) those suites skip and the rest of the suite still passes.

- **14 - History is one shape, two stores.** `HistoryEntry`/`HistoryPage` (in `@onestop/types`) are returned identically by `/api/history` for a signed-in user and by `apps/web/src/lib/localHistory.ts` for a guest, so `HistoryView` renders both with one component and a `scope: "account" | "device"` badge. The guest path never calls the server at all - the build file asks for exactly that, and the unit and e2e tests both assert `fetch` was not called.
- **14 - Guest history lives in IndexedDB, keyed by a random id, capped at 200 entries.** Every read and write degrades to "no history" rather than throwing when IndexedDB is missing or blocked (private mode, locked-down browser), exactly like phase 02's localStorage helpers. A write resolves on the transaction's `oncomplete`, not the request's `onsuccess`: resolving on the latter let a caller navigate to `/history` and open a fresh connection before the commit landed.
- **14 - History reads go straight to Prisma, not through `JobStore`.** `list()` deliberately offers no total, date bounds or offset, and widening that interface for one screen would push paging into every implementation. `apps/api/src/history/` owns the read model; the store contract is unchanged.
- **14 - A favourite is only a registry id.** `favorites(userId, toolId)` stores nothing about the tool, an id the registry does not know is refused on write and filtered on read, and the ceiling is 300 per account. Guests keep the same list in `localStorage`, and a one-time import merges it into the account.
- **14 - Settings sync is last-write-wins, per field, and the account leads.** `/settings` shows the device's values immediately (no network), then applies the account's when they arrive - unless the visitor has already changed something, which a `touched` ref guards, so a slow response can never undo a fresh choice. `preferences` accepts only a known key list, so a client cannot fill the JSON column with anything it likes.
- **14 - "system" is a theme preference, not a theme.** Phase 02's `onestop-theme` keeps holding the _resolved_ light/dark that the pre-paint script needs; the preference itself lives in `onestop-theme-preference`, and choosing "system" removes the resolved key so the OS setting takes over on the next load.
- **14 - Dynamic QR moved to Postgres behind the unchanged `QrStore` interface.** `registerQrStoreFactory` (mirroring phase 13's job-store seam) returns the Prisma store when `DATABASE_URL` is set and the interim JSON file otherwise, so an instance with no database keeps resolving the codes it already has. Scans became their own table (`qr_scans`), so "scans in the last 7 days" is a real query and the retained window is enforced by deletion rather than by rewriting a whole file. `ownerToken` on the interface is now the user id; the name was kept rather than churn phases 11/13.
- **14 - The interim QR file is migrated once, lazily, and archived rather than deleted.** The first store call copies `qr-links.json` in (skipping ids already present, so it is idempotent) and renames the file to `.migrated`; that rename is what stops it running again. A code's 10-character id survives, because that id is what was printed into every existing poster. The old `ownerToken` was a random cookie value, not a user id, so migrated codes are ownerless and keep resolving for everyone - which is what they already did.
- **14 - `popularity` and `recently used` are derived from real runs.** `searchTools` gained `usageCounts` (real runs lead; phase 03's hand-set number breaks ties, so a fresh install still orders sensibly), `favoriteIds` (starred tools float to the top of whatever sort is chosen) and `favoritesOnly`. `useUsage` merges this device's IndexedDB counts with the account's `/api/usage` counts, so a guest gets a useful ordering and a signed-in user gets theirs on every device.
- **14 - `@/lib/auth-config` was split out of `@/auth`.** `authIsConfigured`/`googleIsConfigured`/`authSecret` read environment variables and nothing else, but importing them from `@/auth` pulled Auth.js and the whole `@onestop/api` barrel (sharp, pdfjs, tesseract) into the root layout and every auth page. `@/auth` re-exports them, so there is still exactly one definition.

---

- **15 - Chain validation lives in the registry, not in the API.** `packages/tool-registry/src/workflows.ts` holds `validateWorkflow`/`compatibleTypes`; `apps/api/src/workflows/validate.ts` re-exports it. Both sides need the same rules - the server validates every save and every run, and the browser's builder has to reject an impossible chain as you type, with no round trip. The same reasoning moved the four example workflows to `packages/tool-registry/src/workflow-templates.ts`. The registry stays free of `node:` imports, so both still bundle for the browser.
- **15 - Compatibility rule: one shared file type is enough.** Step N+1 must accept at least one of the file types step N declares it produces, after type families (`image`, `audio`, `video`) are expanded and with `any` accepting everything. That is what makes "OCR PDF -> Document Translator" legal (they share `txt`) while "Background Removal -> Audio Converter" is rejected by name and by type. A chain's first step must take files, and a non-final step must declare at least one output type.
- **15 - A workflow step is an ordinary `runPipeline` call.** The engine adds only the wiring between steps: it re-reads the previous step's stored output and hands on the files the next tool can read. So every step is validated, size-checked, timed out and written to `/history` exactly as if the tool had been run from its own page, and a workflow gets nothing a single tool does not already have.
- **15 - Intermediate step outputs are kept, not deleted.** They expire on the temp store's normal retention window like any other result, and keeping them lets the run panel offer a per-step download, which is what makes a failing chain debuggable. No new retention rule was introduced.
- **15 - Guests get workflows too.** Saving to an account needs Postgres; saving to `localStorage` needs nothing, and _running_ a workflow never needs an account. `apps/web/src/lib/workflows.ts` presents both stores as the same `Workflow[]`, exactly as phase 14 did for history and favourites.
- **15 - Batch is bounded at 4 concurrent files (default 2).** Each worker holds a file's bytes and may spawn FFmpeg or Tesseract; `concurrency: 1` is strictly sequential. Results come back in input order however they finished, and one file's failure is recorded against that file alone.
- **15 - `testDatabaseReachable()` was added to `apps/api/src/db/testing.ts`.** `hasTestDatabase()` only says a connection string is configured, so a developer with one in `.env` and no server running saw every database suite _fail_ instead of skip - the opposite of what that module promises. All six database suites now gate on a short TCP probe (top-level await) instead.

- **16 - The planner works with no model at all, and that is the primary path.** `planWithRules` splits the request into clauses, maps each clause to ranked registry tools, then searches for an ordering whose types actually chain. The model planner (`planWithModel`) is tried first when a runtime answers and falls back to the rules whenever its answer is unusable. This is what makes "the app remains 100% functional with no external AI API configured" a property of the code rather than a hope - the acceptance test for master plan section 7.1 passes on a machine with no Ollama, no keys and no internet.
- **16 - Master plan section 7.1's example is reordered, deliberately.** Written literally ("PDF -> Excel, remove pages 1-2, compress") the second step would hand a PDF tool a spreadsheet, so the chain cannot run. The planner searches for a compatible ordering, produces `Delete PDF Pages (1-2) -> PDF to Excel -> File Compressor`, and says in the explanation that it changed the order and why. Reordering is a last resort: the search prefers the user's own order and only moves a clause when leaving it in place has no compatible answer.
- **16 - Hand-written clause routes beat registry search.** `candidatesFor` tries a table of phrasings first ("remove ... pages" -> Delete PDF Pages) and only widens to `scoreTool` when nothing matched. Letting search compete directly was measurably wrong: "remove the first 2 pages" also scores against Metadata Remover, and an assistant that confidently does the wrong thing is worse than one that says it cannot.
- **16 - The assistant's plan is an ordinary workflow.** `executePlan` re-validates every tool id against the registry and runs the chain through phase 15's `runWorkflow`, which runs each step through phase 04's pipeline. So an AI-planned step is validated, size-checked, job-tracked, timed out and history-logged exactly like a tool a human clicked, and there is no second execution path to audit. The AI cannot express "run a command" - only "run tool X" - which is CLAUDE.md section 2.6 enforced by structure rather than by prompt.
- **16 - The allow-list is checked twice.** Once where the plan is built (`parsePlanAnswer` drops unknown ids into `rejected` and logs them) and again immediately before execution (`assertPlanIsRunnable`), because a plan also arrives over HTTP from the browser. A rejected id is named to the user rather than silently retried into something else.
- **16 - Planning and running are two endpoints.** `POST /api/assistant/plan` takes the request and the file _names_ only - no bytes move - and `POST /api/assistant/run` takes the approved plan plus the files. The user reads the plan before anything is uploaded, which is also what makes the "does not hallucinate a fake tool" criterion visible rather than theoretical.
- **16 - A user-supplied API key lives in the browser, never in Postgres.** `preferredAI` (which runtime) syncs to `UserSettings` as phase 14 built it; the key itself is kept in `localStorage` per provider and travels only as the `x-onestop-ai-key` header on the request that needs it. A key is a credential (CLAUDE.md section 2.6, section 10) and syncing it to an account or a query string would be the wrong default. For tool pages the same value arrives through two new `client` options (`aiProvider`, `aiKey`), reusing phase 12's "a value only the browser knows" mechanism; `redactOptionValues` strips the key before the job is recorded.
- **16 - Every AI tool has a `method` of auto | ai | builtin**, copied from phase 09's model-capable image tools. "auto" uses the model when one answers and the offline engine otherwise, saying which; "ai" is the only setting that ever fails for want of a runtime. AI Summarizer falls back to phase 07's extractive `summarize()`, AI Grammar Checker to `checkGrammar()`, AI Translator to the offline dictionary, AI OCR to phase 06's Tesseract, and Ask Questions About a File to an extractive answer built from the document's own sentences.
- **16 - Retrieval is TF-IDF over text chunks, with no new dependency.** No vector database, no embedding service. `ragContext.ts` chunks on paragraph/sentence boundaries, scores chunks against the question, and fits the best ones into a context budget the caller sets (6000 characters by default, because small local models have small context windows). Good enough for the documents a personal toolbox sees, free, and offline.
- **16 - Provider failures are distinguished, not merged.** `AI_UNAVAILABLE` (nothing configured or the local server is down) is the only one that falls through to another provider or to the offline path; `AI_RATE_LIMIT`, `AI_AUTH`, `AI_TIMEOUT` and `AI_FAILED` are shown to the user as themselves, because the action they call for differs. A free tier's 429 becomes "Groq's free tier rate limit was reached. Try again in about 17 seconds." and never a generic failure or a crash.
- **16 - The local image runtime is a client, not a model.** `AI_IMAGE_URL` points at the user's own Stable Diffusion server speaking the AUTOMATIC1111 HTTP API; OneStop bundles and downloads nothing. It is off by default, so the AI Image Generator/Editor say exactly what they need, and every phase-09 model-capable tool keeps its built-in method. This is the `ImageModelRuntime` phase 09 asked phase 16 to register.

- **17 - yt-dlp is found, never bundled**, exactly like FFmpeg: `YTDLP_PATH`, then PATH, then the usual install folders. When it is missing every online media tool fails with one install message naming the free ways to get it, and nothing else in the app notices. It is spawned with `shell: false`, a fixed argument array, `--no-exec`, `--no-playlist`, `--max-downloads 1`, `--ignore-config`, `--restrict-filenames`, a download into a fresh scratch directory that is always removed, a timeout and kill-on-cancel. The URL is one argv element and is validated (scheme, platform host, no credentials, printable ASCII only) before it gets there.
- **17 - IP -> country is a bundled offline database, not an API.** `scripts/build-geoip.mjs` downloads the five RIRs' own `delegated-<rir>-latest` statistics - public, free, no account, no key - merges them and writes `apps/api/src/network/data/ipv4-country.bin` (142,930 rows) and `ipv6-country.bin` (68,911 rows), plus `countries.ts` with ISO names, regions and centroids from mledoze/countries (ODbL). A lookup is a binary search over a typed array, so **IP Geolocation makes no network call at all** and is in `VERIFIED_OFFLINE`. This is what the build file's "rather than a paid geolocation API, to avoid both cost and rate-limit fragility" asks for; country level is the honest ceiling of that data, and every answer says so rather than inventing a city.
- **17 - City level is an opt-in local file, still free.** `GEOIP_MMDB` points at a GeoLite2 City database the operator downloaded themselves, and `mmdb.ts` reads the MaxMind DB format directly rather than adding a dependency. It is never required, and a missing or unreadable file falls back to the bundled tables with a log line. The reader is tested against MaxMind's own published test database (`fixtures/GeoIP2-City-Test.mmdb`, 22 KB), which is how we know it decodes 24/28/32-bit records, pointers and IPv4-in-IPv6 correctly.
- **17 - WHOIS is twenty lines of `node:net`, not a package.** RFC 3912 is one line over TCP port 43; a dependency would only wrap that. IANA is asked for the **TLD** (that is the record carrying the referral), then the registry named there is asked for the name itself, at most two referrals deep, and only hosts that resolve to public addresses are contacted. A registry that publishes no WHOIS server at all (Nominet's `.uk`) is reported as that fact rather than as a failure, and IANA's TLD record is never passed off as the domain's own.
- **17 - Geocoding is Nominatim (OpenStreetMap)**, the standard free, key-less geocoder, called with a real identifying User-Agent and at most one request a second, as its usage policy requires. `NOMINATIM_URL` points it at a self-hosted instance instead. A 429 or 403 becomes "the free map service is busy", never a crash.
- **17 - One SSRF gate for every outbound request** (`network/ssrf.ts`): http/https only, no credentials, a blocked-port list, resolve the host and refuse every address that is not publicly routable, re-run all of that on each redirect, cap redirects, cap the response size and cap the time. This is the surface phase 16's hand-off note flagged, and it is one module so no tool can forget a rule.
- **17 - The per-IP rate limit five phases asked for now exists**, in the smallest useful form: an in-memory per-tool, per-caller bucket (20 lookups a minute, 8 downloads a minute). No Redis, no new infrastructure. `ExecContext` gained `clientIp`, filled by `/api/tools/run` from `x-forwarded-for`/`x-real-ip` and treated as untrusted - it is reported or counted, never used to decide whether something is allowed.
- **17 - Notices live in the registry** (`packages/tool-registry/src/notices.ts`), so the tool page renders exactly the words the run summary and the downloaded report repeat. That keeps the generic tool page free of per-tool knowledge, the same rule phases 03 and 11 set.
- **17 - The DNS resolver falls back to public servers when the machine has none it can use.** A system running a local stub resolver hands c-ares `127.0.0.1`, which it cannot query, and DNS Lookup would report "no Internet" on a perfectly connected machine - which is exactly what happens on the dev machine. When the only configured servers are loopback, 1.1.1.1/8.8.8.8/9.9.9.9 are used instead; the answer always names the server that was asked, and `DNS_SERVERS` overrides it.
- **18 - Service worker is hand-written, not Workbox.** The build file recommends Workbox; the whole policy is four rules (precached shell, cache-first hashed assets, stale-while-revalidate pages, network-only `/api`), which is ~250 lines of plain JS in `apps/web/public/sw.js` and needs no dependency, no build step and no generated file in git. It is served as-is from `/public`, and `self.__sw` lets the unit suite run the real file in a fake worker scope.
- **18 - "Offline" is three states, not two.** OneStop processes files on the server, so "no Internet" and "no OneStop" are different situations: `online` (both reachable), `limited` (the app answers but its uplink is down - every local tool still works, only `network: "required"` tools are blocked) and `offline` (the app itself is unreachable - only what the service worker cached). `navigator.onLine` is used only as a negative hint; the positive answer comes from `/api/ping` and `/api/connectivity`.
- **18 - The Internet check is a server-side HEAD to a captive-portal endpoint** (`connectivitycheck.gstatic.com/generate_204`, then `cloudflare.com/cdn-cgi/trace`), cached for 10 seconds and overridable with `CONNECTIVITY_CHECK_URL`. It is the _server's_ uplink that decides an online-only tool's fate, because the server makes that tool's request. No payload, no key, no account; /status names the endpoint so the outbound request is disclosed.
- **18 - Icons are generated from one inline SVG** by `node scripts/build-icons.mjs` (sharp, already a phase-09 dependency) and the PNGs are committed. No design tool, no icon service, and the mark can be regenerated at any size.
- **18 - Installability is audited by `scripts/pwa-audit.mjs`, not Lighthouse.** Lighthouse's installability audit is a fixed checklist, and the script checks every item over HTTP against `next start` (26 checks) with no Chrome download, no npx fetch and no account. The live registration, the caches and offline behaviour are covered in a real browser by `tests/e2e/pwa.e2e.test.ts`.

- **19 - One command is the gate: `npm run verify`** (lint -> typecheck -> the whole test suite -> the offline-flag check). It is what the new GitHub Actions workflow runs, and what phase 20 should run before a deploy. `npm test` on its own no longer proves the offline claims, because the check that reconciles them runs after the suite.
- **19 - The offline flag is enforced by a ledger, not by trust.** `tests/offline/coverage.ts` + `tests/offline/expected.ts` + `scripts/check-offline-coverage.mjs`. The contract suite records what the registry _claims_ (`_expected.json`, straight from the loaded registry, so it cannot drift from `VERIFIED_OFFLINE`); each phase's offline suite records what it _proved_, on its last line, after its assertions - so a suite that fails or skips records nothing. The script reconciles the two and exits non-zero on any gap. Vitest runs files in separate workers, which is why the ledger is files on disk rather than a shared variable.
- **19 - A skipped prerequisite is a failure, not an excuse.** If the media suite skips because FFmpeg is missing, 27 tools are left claiming `offline: true` with nothing behind them and `verify` fails. That is the honest outcome, so `node scripts/fetch-ffmpeg.mjs` was added to make it fixable in one command: it downloads the official free static build into `.tools/` (git-ignored), and `tests/setup/env.ts` points the suite at it only when no system FFmpeg exists. The app itself is unchanged - it still looks at `FFMPEG_PATH`, then `PATH`, then the usual install folders.
- **19 - The "flaky under load" question phases 08/10/14/17/18 kept deferring is settled: `maxWorkers: "50%"`.** Vitest defaults to one worker per core; this suite spawns FFmpeg and LibreOffice, holds Postgres connections and imports the whole `@onestop/api` barrel into jsdom, so at full width the machine is oversubscribed and the failures that follow are timeouts, not defects. Half width costs about a fifth of the wall clock and makes the run deterministic. Raising timeouts was rejected: it would have hidden the saturation instead of removing it.
- **19 - The test suite loads `.env`** (`tests/setup/env.ts`). A configured-but-unused local Postgres previously meant ~50 database tests silently skipped on the developer's own machine, which is the opposite of what a test run should do.
- **19 - CI is GitHub Actions, free tier only** (`.github/workflows/verify.yml`): Postgres as a service container and `apt-get install ffmpeg`, so the database and media suites really run there rather than skipping. No secrets, no paid service.

- **20 - `document-translator` now goes through phase 16's model runtime**, via a new contract in `apps/api/src/documents/text/runtime.ts` that the AI module implements (`ai/textRuntime.ts`) and registers at import time. This is deliberately the same shape phase 09 used for the image model (`images/model.ts` + `registerImageRuntime`): phase 07 defines what it needs and depends on nothing in phase 16, so the tool keeps working with no AI at all. Phase 19 named this the first thing worth doing after phase 20; it turned out to belong _in_ it, because "the §8 workflow translates word-by-word" is a quality gap the Final Product Definition would not survive.
- **20 - Batched, marker-delimited model translation, with a per-passage retry.** Segments are collected out of the DOCX first, batched to ~2,000 characters, and sent with `<<<n>>>` markers so the model keeps the runs apart. A batch whose markers come back wrong is retried one passage at a time (no protocol at all for a single passage, which small local models handle reliably); only a runtime that answers nothing falls back to the glossary. This was not theory - a 3B model failed the marker protocol on the first real run, which is what the retry path exists for.
- **20 - The per-caller rate limit lives in `apps/api/src/shared/rate-limit.ts`**, moved out of `network/common.ts` (which now delegates to it) so an HTTP route can use the same buckets as a tool. `POST /api/tools/run` allows 120 runs per 60 seconds per caller by default (`RUN_RATE_LIMIT`, `RUN_RATE_WINDOW_SECONDS`), counted before the body is read. In-memory, per process - CLAUDE.md §3 rules out Redis, and one free instance is one process. Phases 04, 12, 13 and 16 all logged this; phase 19 left the decision to phase 20.
- **20 - `npm run test:e2e:shared` is the E2E command.** One `next start`, one migrated database schema handed to both sides through `E2E_SCHEMA`, and the server's console written to a file named by `E2E_SERVER_LOG` so the password-reset test can still read the link. Two files keep their own server because their whole point is a server started differently - `pwa.e2e.test.ts` (connectivity probe pointed at a closed port) and `assistant.e2e.test.ts` (every AI provider pointed nowhere, so a developer's own Ollama cannot make its "no runtime" assertions pass). They run as a second pass, so it is still one command.
- **20 - Live suites instead of a manual checklist.** `ai/live.test.ts`, `shared/libreoffice.live.test.ts` and `online-media/live.test.ts` each skip themselves when the thing they test is not installed, so they are green everywhere and real where it counts. CI now installs LibreOffice and yt-dlp so two of them run there too. The live _download_ additionally needs `ONESTOP_LIVE_DOWNLOAD=1`, because `17-online-media-network-tools.md` forbids real downloads in CI.
- **20 - Hosting is documented as two routes, not one.** `docs/DEPLOYMENT.md` recommends a container host (Render/Railway/Fly) because FFmpeg, yt-dlp and LibreOffice cannot exist on a serverless free tier, and documents Vercel/Netlify honestly as "the document, data, image and utility tools" rather than pretending the media tools will work there. Neither is in the code: both are the same repository with different environment variables.
- **20 - Local AI is documented as unavailable on every free host.** Ollama needs several GB of RAM and no free tier has it. Rather than leave that implicit, `DEPLOYMENT.md` §6 states it and gives the two honest options (leave AI off, or use a free hosted API key). This satisfies the acceptance criterion's "clearly documented as unavailable on a given free host - never silently broken".

- **Post-V1 (progress bars) - a polled in-memory store, not a job queue or a streamed response.** The pipeline stays a single synchronous request/response on purpose (04-file-core.md's whole point). A `progressToken` generated client-side and polled via `GET /api/progress/:token` while the original `POST` is in flight was the smallest change that made percentages real without touching the request/response contract 20 phases of tests already depend on. `PipelineDeps`/streaming the POST response itself were considered and rejected for that reason.

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

- **04 — Paths:** the build file says `apps/api/file-processing/*`; following phases 01-03 these live at `apps/api/src/file-processing/*` (`config.ts`, `validate.ts`, `tempStore.ts`, `job.ts`, `pipeline.ts`, `executors/file-metadata.ts`, `index.ts`). `UploadZone.tsx` is where the build file puts it, under `src/`.
- **04 — Files beyond the listed modules:** `config.ts` (env-driven limits, so nothing reads `process.env` twice), the three route handlers `apps/web/src/app/api/{tools/run,files/[id],jobs/[id]}/route.ts`, and the shared contracts in `@onestop/types` (`Job`, `JobStatus`, `ExecContext`, `OutputFile`, `OutputFileRef`, `FileValidationResult`, `ERROR_MESSAGES`, `DEFAULT_MAX_UPLOAD_*`).
- **04 — The demo tool is `file-metadata-viewer`, upgraded from the phase-03 echo to real processing.** The build file suggested an image resize or a passthrough; an image resize would have meant a new dependency (sharp), so instead the tool reads the actual bytes out of the temp store and returns SHA-256/MD5 checksums, magic-byte format detection (flagging an extension that lies about its content), a hex preview and text statistics, plus a downloadable JSON report. `echoExecutor` is still the registry's browser-side default for that id, which is why the phase-03 registry test is unchanged.
- **04 — `ToolState` gained `files`** and the success panel renders one download link per result file (`data-testid="result-download"`), falling back to the old JSON-blob download when a tool returns no files. `REJECT` is now also accepted from `processing`, so a server-side "This file type is not supported." lands in the `unsupported` state instead of the generic failure state.
- **04 — `apps/web/tsconfig.json` gained `allowImportingTsExtensions`** and `@onestop/api` was added to `transpilePackages`, because `@onestop/api` ships TypeScript source with explicit `.ts` imports (phase 01 decision). `packages/types` gained `"lib": ["ES2022", "DOM"]` for `AbortSignal` in the shared contracts.
- **04 — Offline detection for remote tools is a pipeline input (`deps.online`), not a probe.** The pipeline never reaches out to check connectivity; the browser's `navigator.onLine` still drives the UI, and phase 18 can feed a real server-side signal in.
- **05 — Paths:** the build file says `apps/api/pdf/{merge.ts, …}`; following phases 01–04 these live at `apps/api/src/pdf/*`. Files beyond the eleven listed modules: `document.ts` (shared load / page-selection / option helpers), `errors.ts` (`PdfToolError`, and the one place a thrown error becomes an `ExecResult`), `render.ts` (pdf.js + canvas), `zip.ts`, `fixtures.ts` (test-only), `index.ts` (registration), plus `packages/tool-registry/src/options.ts` and `apps/web/src/components/tools/ToolOptions.tsx`.
- **05 — Split PDF and PDF → Images return a ZIP by default.** The registry already declared `zip` as a Split output; handing back forty download links is worse than one archive, so both tools pack multiple results with a small store-only ZIP writer (`apps/api/src/pdf/zip.ts`, no dependency — PDFs and PNG/JPEGs are already compressed, so "stored" costs nothing). A "Separate downloads" option turns it off. 12-dev-utility-tools.md can reuse the writer and add real deflate.
- **05 — Merge PDF asks for at least two files** rather than silently copying one.
- **05 — Reorder PDF Pages keeps the pages you leave out.** `3,1` on a five-page PDF gives `3,1,2,4,5`, so a partial order can never lose pages.
- **05 — Rotate is relative and additive** (it adds to each page's existing `/Rotate`), so rotating twice behaves the way a user expects.
- **05 — PDF → Text refuses a scan instead of returning an empty file**, pointing at OCR PDF (phase 06).
- **05 — A corrupt PDF whose `%PDF` header is not at byte 0 is rejected by phase 04's magic-byte validation before Repair PDF sees it.** That is the right security boundary, so it was left alone; Repair PDF still handles leading junk for any file that reaches it, and the realistic corruption cases (broken xref, truncation, trailing junk) all recover.
- **05 — Phase-04-era tests were updated, not deleted:** the registry's "exactly one demo tool" assertion now lists the twelve working tools and also asserts every `available` tool comes from a built phase, and the NOT_IMPLEMENTED API test moved from `merge-pdf` to `pdf-to-word` (phase 06).

- **06 — Paths:** the build file says `apps/api/pdf/*.ts` and `apps/api/shared/office-convert.ts`; following phases 01–05 these live at `apps/api/src/pdf/*` and `apps/api/src/shared/office-convert.ts`. Both metadata tools share `metadata.ts`; the three PDF → Office executors are in `toOffice.ts`. Files beyond the listed modules: `pdf/{fonts,inputs,layout,placement,textLayer,title}.ts`, `shared/{libreoffice,node-modules}.ts`, `shared/office/{fromPdf,toPdf,flowPdf}.ts`, `apps/web/src/components/tools/SignaturePad.tsx`, and `advanced.test.ts`.
- **06 — Only PDF → Office executors are registered this phase.** `office-convert.ts` already implements Word/Excel/PowerPoint → PDF (needed for the round-trip criterion, and tested), but the Word → PDF, Excel → PDF and PowerPoint → PDF _tools_ stay stubs for phases 07/08 to register on top of it, per CLAUDE.md §5.
- **06 — Input types changed:** Sign PDF and Add Watermark accept `pdf, png, jpg, jpeg` with `supportsBatch` (the image rides along with the PDF; files are sorted by magic bytes, not names). Compare PDFs is now a two-file (batch) tool. Watermark and Remove Metadata output `zip` for several PDFs; Fill PDF Forms can output `txt` (the field list).
- **06 — Fill PDF Forms is two-step through one tool:** run with no values → it lists every field (name, type, choices) and returns a ready-to-edit `Field = value` template; run with values (lines or JSON) → fills, optionally flattens. A per-file dynamic form UI would need an inspect endpoint the generic tool page does not have; this keeps one contract for the UI, Workflows (15) and the Assistant (16).
- **06 — Compare PDFs does both text and visual comparison:** an HTML report (line-level LCS diff with word-level highlights, strict CSP, no script) and a copy of the changed PDF with differing regions highlighted (pixel diff at 72 DPI). The user orders the files original-first.
- **06 — PDF → HTML has three layouts:** Exact (page image + transparent selectable text, default), Reflowable (headings/paragraphs) and positioned text only. Output is one self-contained file with a `default-src 'none'` CSP; all PDF text is HTML-escaped (tested with an `<img onerror>` payload).
- **06 — PDF → PowerPoint defaults to "Exact" slides** (page image, text in speaker notes) because a PDF has no slide structure; "Editable" puts each line in its own text box. PDF → Word defaults to editable text; "Exact" embeds page pictures. Text-based modes refuse a scan with a pointer to OCR PDF rather than producing an empty document.
- **06 — Phase-04/05-era tests that used phase-06 tools as "not built yet" examples** now use `ocr-to-word` (phase 07) instead; the registry test's list of available tools includes the 15 new ones. A real-browser e2e check draws a signature on the pad and downloads the signed PDF.

- **07 — Paths:** the build file names no modules; everything lives in `apps/api/src/documents/` (`common`, `ooxml`, `convert`, `wordStructure`, `slides`, `powerpoint`, `compress`, `metadata`, `ocrToWord`, `textTools`, `text/{grammar,formatter,summarize,translate,glossary}`, `fixtures`, `index`) plus `apps/api/src/shared/office/{rtf,odt}.ts`.
- **07 — Registry entries adjusted:** Document Translator's `network` is now `none` (the default engine is fully local; phase 16 may add an optional online engine and set it back to `optional`). Grammar Checker also accepts doc/odt/rtf; Document Summarizer accepts odt/rtf; Document → Images accepts txt; Compress Presentation supports batch; Document Metadata can output `.odt`.
- **07 — Libraries:** the build file suggests `docx` for reading `.docx`, but it only writes, so reading uses `mammoth` (text/HTML) and direct XML via `jszip`; `docx` writes new documents (OCR → Word). New dependencies: `nspell`, `dictionary-en`, `write-good` (free, offline; listed in `serverExternalPackages`).
- **07 — Split Documents** splits at headings (level 1–3, default Heading 1) or at page/section breaks ("auto" tries headings first); parts are named after their heading. Split Presentation splits every N slides or by ranges.
- **07 — Document Metadata** "remove" also anonymises the names on comments and tracked changes (option, on by default), removes the preview thumbnail, `custom.xml`, the template path and revision-session ids, and re-reads the cleaned file before returning it — if anything descriptive survived, the tool fails instead of claiming success.
- **07 — Tests that used `ocr-to-word` as the "not built yet" example** now use `ai-pdf-summarizer` (phase 16).

- **08 — Paths:** the build file says `apps/api/data/{excel,csv,json,xml,yaml,clean,validate,transform}.ts`; following earlier phases they live in `apps/api/src/data/`, with those eight plus `common.ts` (table model, typing, errors), `columns.ts` (column references by name/letter/number), `tabular.ts` (CSV-or-Excel in, same kind out), `convert.ts` (all conversion + formatter executors), `spreadsheet.ts` (mergers/splitters), `index.ts` and `data.test.ts`. Registry options for the 30 tools are in `packages/tool-registry/src/options-data.ts`, spread into `TOOL_OPTIONS`.
- **08 — Registry:** `defineCategory` defaults gained an optional `status`, so both phase-08 categories are marked `available` once instead of on 30 lines. No input/output types changed.
- **08 — Tool behaviours worth knowing:** cleaners return the same kind of file they were given (CSV → CSV, Excel → Excel) and copy Excel cell styles for surviving rows. Duplicate Row Remover compares chosen columns (or all), can ignore case/extra spaces, keeps first or last, and names the removed rows. Empty Row/Column Remover removes a column only if its header was blank too, unless "also remove named empty columns" is set. Excel Merger either keeps every sheet (a whole-sheet copy: formulas, styles, merges) or stacks rows with columns matched by name. Splitters split by sheet, row count, number of parts or column value, and a ZIP is returned for multiple results. Column/Row Transformer does rename / choose & reorder / delete / split / merge / sort / transpose. Spreadsheet Formatter styles an Excel sheet in place (formulas survive) or builds one from CSV. Data Validator takes plain-language rules (`Email: required, email`, `Age: integer, min=0`, `Status: in=a|b`, `ID: unique`, `pattern=`) plus automatic checks (ragged CSV rows, stray text in numeric columns).
- **08 — The performance test measures CPU time, not wall-clock.** 50,000 rows through dedupe + CSV→JSON + CSV→Excel take ~3 s alone. Under `npm test` the other test files run in parallel and wall-clock reached 19 s, so the 10 s budget is asserted on `process.cpuUsage()`, with a 45 s wall-clock backstop. `tests/lint.test.ts` ("passes on the real scaffold") got a 120 s timeout because type-aware linting of the whole repo now exceeds the global 30 s.

- **09 — Paths:** the build file says `apps/api/images/*.ts`; following earlier phases they live in `apps/api/src/images/`. Sharpen and Denoise share `enhance.ts` with Enhance (same shape, ~20 lines each) instead of separate `sharpen.ts`/`denoise.ts`; the six model-capable tools share `aiTool.ts`. Extra files: `common.ts` (decode/encode, colours, packaging, errors), `bmp.ts`, `text.ts` (canvas text), `model.ts`, `index.ts`, `images.test.ts`. Options: `packages/tool-registry/src/options-images.ts`. Real-browser checks: `tests/e2e/images.e2e.test.ts`.
- **09 — The build file's "offline: maybe" for AI tools became `localModel: "optional"`** (not `requiresLocalModel: true`): every one of them has a working built-in method, so none requires a model and all seven are genuinely offline-verified. `"required"` exists in the schema for a future tool with no fallback.
- **09 — Tool behaviours worth knowing:** batch tools return one ZIP by default ("Separate downloads" option). Animation is kept by Resize, Compress, Convert (GIF↔WebP), Flip, right-angle Rotate and Remove Metadata; compositing tools use the first frame. The Compressor never returns a file larger than the original (it hands the original back and says so). The three pair converters (JPG↔PNG etc.) send each file to "the other" format and refuse files in neither. Watermark's logo is the last uploaded file (same convention as phase 06's PDF watermark). Image → PDF embeds JPGs byte-for-byte; page size "Same as each image" uses 96 DPI. Fit to Square/Circle "automatic" size is the longer side (shorter for Fill), capped at 4096. Positions and regions are in % of the image, so the same values work at any resolution and in workflows.
- **09 — Basic Image Editor is option-driven, not a canvas UI:** crop (edge trims) → rotate → flip → resize → colour/effects → mark an area (box, circle, highlight, blur or pixelate) → caption, in one pass, reusing the other tools' building blocks. An interactive drag-to-crop/draw canvas on the tool page would be a UI layer on top of the same executor.
- **09 — Test-harness note:** `images.test.ts` sets `sharp.concurrency(1)`, because libvips threads saturating the machine pushed phase 08's CPU-time budget over (10.5 s vs 10 s) when the files ran in parallel.

- **10 - Paths:** the build file says `apps/api/media/{convertAudio.ts, ...}`; following earlier phases they live in `apps/api/src/media/`, with all eleven listed modules (`convertAudio`, `convertVideo`, `trim`, `merge`, `extractAudio`, `extractFrames`, `subtitles`, `waveform`, `normalize`, `metadata`, `ffmpegCheck`) plus `common.ts` (scratch dir, probing, encoder settings, `eachMedia`), `fixtures.ts` (test-only), `index.ts` and `media.test.ts`. Options: `packages/tool-registry/src/options-media.ts`. Real-browser checks: `tests/e2e/media.e2e.test.ts`.
- **10 - No new npm dependencies** (see the Decisions Log entry on `fluent-ffmpeg`). `sharp` (phase 09) rasterises the waveform SVG; the ZIP writer comes from phase 05.
- **10 - Fixtures are generated, not committed:** `fixtures.ts` builds tones (`aevalsrc`, so the amplitude is exact) and clips (`testsrc`/`smptebars` plus a tone) with FFmpeg itself, so the repo holds no binary media and the tests are self-contained. The media suite skips with a clear message when FFmpeg is absent, except the pure-TypeScript parts (subtitles, time parsing, filter builders, registry), which always run.
- **10 - Phase-04 upload validation was extended** for media: MIME types for `wma/wmv/flv/srt/vtt/ass/ssa`, and magic-byte signatures for raw MPEG audio frames (`ff fb/fa/f3/f2/e3/e2` - an MP3 without an ID3 tag was being rejected), ADTS/ADIF AAC, FLV and the ASF GUID.
- **10 - Tool behaviours worth knowing:** batch tools return one ZIP by default ("Separate downloads" option). The Audio and Video compressors never return something bigger than the input - they hand the original back and say so; Change Video Resolution does the same when the file is already smaller than the target (upscaling is opt-in). Resolution targets apply to the _short_ side, so vertical videos work. Video Merger matches the first clip's size and frame rate, letterboxes rather than stretches, and generates silence for a clip with no sound so nothing drifts. Extract Audio copies the track out untouched when the codec suits a container (AAC -> M4A, Opus -> .opus, PCM -> WAV...). Extract Frames caps at 300 frames and seeks accurately per frame. Video -> GIF caps at 60 s and builds a per-clip palette. Audio Metadata's "edit" mode is `-c copy`, so the audio is bit-identical; raw ADTS `.aac` says plainly that it cannot hold tags.
- **10 - Rotation is a re-encode.** FFmpeg can rewrite the display matrix losslessly, but only for MP4/MOV; one consistent behaviour (with a quality option defaulting to High) was judged simpler than a mode that silently works for only some containers.

- **11 - Paths:** the build file says `apps/api/qr/{generate,formats,dynamic,analytics}.ts` and `apps/web/components/qr/*`; following earlier phases these live in `apps/api/src/qr/` (all four listed modules plus `decode.ts`, `store.ts`, `common.ts`, `tools.ts`, `index.ts`, `qr.test.ts`) and `apps/web/src/components/qr/` (`QRScanner.tsx`, `QRLandingPage.tsx`, plus `DynamicQRManager.tsx` for the editing list). Options: `packages/tool-registry/src/options-qr.ts`. Browser tests: `apps/web/src/test/qr.test.tsx`.
- **11 - The interim store is a server-side JSON file, not IndexedDB.** The build file suggests local storage as the interim store, but a dynamic QR code is resolved on the _server_ (`/q/<id>` has to redirect a phone that has never visited the app), so browser storage cannot back it at all. `qr/store.ts` keeps one JSON file under `QR_DATA_DIR` (default `.onestop-data/qr-links.json`, gitignored), written atomically write-then-rename, with row-shaped records so the phase-14 migration to Postgres is a copy rather than a redesign. **Exactly what is interim: dynamic destinations, hosted page content (attachments inlined as data URLs, 2 MB each / 8 MB per page), ownership (`ownerToken`, always null for now) and every scan record.** The QR images themselves, payload building and decoding are final.
- **11 - `requiresAuth` is off for the four dynamic tools, temporarily.** The registry marked Dynamic QR Code, Custom QR Landing Page, QR Code Analytics and QR Code -> Content Page `auth: true`, and the phase-04 pipeline refuses any such tool while every session is a guest - so they could not have been built or tested at all. They keep `network: "required"`. TODO(13-auth-database.md): restore `auth: true` and key `ownerToken` to the real user id. The pipeline's auth rule is still covered, by a test that flips the flag on another tool for the length of the test.
- **11 - "Image -> QR" and "Audio -> QR" cannot put a real file inside a code** (the format holds about 2 KB). They embed the file as a data URL when it genuinely fits and otherwise create a hosted page and encode its short URL; a "How to store it" option makes the choice explicit, and asking to embed something too large fails with the size in the message rather than silently switching.
- **11 - Two small generic additions rather than per-tool UI:** a new `image` option type (a logo picked in the browser and passed as a data URL, like the phase-06 signature pad, and redacted from job records) and `packages/tool-registry/src/input-hints.ts`, which labels a tool's one text box ("Network name (SSID)" instead of "Text input"). Both live in the registry, so the generic tool page still holds no per-tool knowledge. The result panel now previews image outputs, which every QR tool and phase 09 benefit from.
- **11 - Route additions:** `/q/[id]` (resolve, count the scan, then redirect or render the hosted page), `GET /api/qr/links` and `PATCH`/`DELETE /api/qr/links/[id]`. The scanner page mounts the camera panel above the normal upload form; the dynamic tools mount the manager below it.

- **12 - Paths:** the build file says `apps/api/dev-utils/{formatters,validators,encoders,generators,hashing,timestamps,regex,userAgent,fileMeta,zip,fileOps,duplicateDetector}.ts`; following earlier phases these live in `apps/api/src/dev-utils/`, with `markdown.ts` added (the build file lists Markdown conversion but gives it no file) and `common.ts`/`index.ts` as in phases 07-11. Options: `packages/tool-registry/src/options-utilities.ts`. Tests: `apps/api/src/dev-utils/dev-utils.test.ts`, `apps/web/src/test/client-option.test.tsx`, `tests/e2e/dev-utils.e2e.test.ts`.
- **12 - There is no `validators.ts`, on purpose.** The build file lists "JSON/XML Validator" (Features §12.2, §12.4) among this phase's tools, but those are the same tools as §4.14/§4.16 and phase 08 built them (`apps/api/src/data/validate.ts`), exactly as the phase-03 Open Questions entry decided. The same goes for the JSON and XML **formatters** (§12.1, §12.3). Phase 12 adds the HTML, CSS and JavaScript formatters only, and does not ship a second copy of the JSON/XML ones.
- **12 - The File Metadata Viewer was not rewritten either.** Phase 04 built it for real as the proof that the pipeline worked (`apps/api/src/file-processing/executors/file-metadata.ts`) and it already reports size, declared vs. sniffed format, checksums, first bytes and text statistics. Phase 12 only promotes it from `status: "demo"` to `"available"` in the registry and adds the **Metadata Remover** beside it; a test asserts there is no second implementation.
- **12 - ZIP tools use `jszip`, not phase 05's `createZip`.** The phase-05 writer stores entries uncompressed (deliberately - it packages PDFs and PNGs) and cannot read an archive at all. `apps/api/src/pdf/zip.ts` is still used by phases 05-11 and its `crc32` is reused here for the CRC-32 checksum option.
- **12 - Extraction flattens paths rather than recreating them.** The pipeline returns a flat list of downloads, so a nested entry name would be a lie; flattening to a safe base name (prefixed with its parent folder's name when there is one) also closes zip-slip in one place. Entries with no extension get `.bin` so phase 04's output validation accepts them, and an archive is refused above 5,000 entries or 512 MB expanded.

---

- **13 - Paths:** the build file names `packages/types/db.ts` and `apps/api/auth/*`; following phase 01's `src/` layout these are `packages/types/src/db.ts` and `apps/api/src/auth/*`, with the database module in `apps/api/src/db/*`. `packages/types/src/db.ts` is hand-written rather than re-exported Prisma output, so the shared types package stays free of generated code and safe in the browser bundle.
- **13 - Three extra tables beyond master plan section 16.** `accounts`, `sessions` and `verification_tokens` are required by the Auth.js Prisma adapter (Google sign-in stores its link in `accounts`), and `password_reset_tokens` is required by the reset flow the build file asks for. `User` gains `passwordHash` and `emailVerified` for the same reason. No other field was added.
- **13 - Route protection is in the page, not middleware.** `/account` redirects guests from its server component; middleware runs on the edge runtime, where the Node-only Prisma client cannot go.
- **14 - Paths:** the build file names `apps/api/history/*`, `apps/api/favorites/*` and `apps/web/lib/localHistory.ts`; following phase 01's `src/` layout these are `apps/api/src/history/*`, `apps/api/src/favorites/*` and `apps/web/src/lib/localHistory.ts`.
- **14 - The optional guest-history import was built, not skipped.** The build file calls it a nice-to-have. `/history` offers it to a signed-in visitor whenever this device still holds guest entries, and it merges the device's favourites at the same time. Only metadata crosses over: the result files were deleted from the server inside the retention window, long before the account existed, so an imported row is a record of "you ran this", never a download. It matches on tool + timestamp, so running it twice changes nothing.
- **14 - Three phase-02/03 placeholders were replaced while here**, because the build file's Notes section asks for exactly this checkpoint: Home's "Recent jobs" sample data is now real history (`apps/web/src/lib/mock-data.ts` is deleted), Home's "Popular tools" is usage-ordered, and the tool page's disabled **Save** button became a "Saved to history" link - every run is now recorded either way, so there is nothing left to save.
- **14 - `ToolPage` now checks the real session** for `requiresAuth`, finishing a phase-13 TODO it had left behind (13-auth-database.md wired the server side only).
- **14 - Hosted-page attachments stay inside the row**, as data URLs in the `page` JSONB column, with phase 11's 2 MB/8 MB caps. Phase 11 asked phase 14 to move them into the file store; that store deletes everything inside its retention window by design and a hosted page has to outlive it, so there is nothing to move them _to_ until someone builds a permanent blob store. Moving them off a hand-written JSON file and into Postgres does address the concern that was actually recorded - an unlocked file two processes could race on.
- **13 - Phase-11 follow-ups, partly done.** The session is now wired into `POST /api/tools/run`, `ExecContext` carries `userId`, a dynamic QR code made while signed in is owned by that user, and QR analytics / `GET /api/qr/links` filter by the signed-in user. The four dynamic QR tools keep `auth: false` (master plan section 9: guests may use public tools) and the QR store stays the interim JSON file - phase 11's own note assigns that migration to phase 14.

- **15 - Paths:** the build file names `apps/api/workflows/*` and `apps/web/components/workflows/*`; following phase 01's `src/` layout they are `apps/api/src/workflows/*` and `apps/web/src/components/workflows/*`. `validate.ts` and `templates.ts` exist there as thin re-exports of the registry modules that hold the logic (see the Decisions Log).
- **15 - Extra files beyond the build file's list:** `apps/api/src/workflows/index.ts` (barrel), `packages/types/src/workflows.ts` (the shared contract), `apps/web/src/lib/workflows.ts` (both client stores), `apps/web/src/components/workflows/{WorkflowsView,WorkflowEditor,WorkflowRunner}.tsx`, and the routes `GET/POST /api/workflows`, `GET/PUT/DELETE /api/workflows/:id`, `POST /api/workflows/run`.
- **15 - The placeholder `Workflow` type moved out of `packages/types/src/db.ts`** into `packages/types/src/workflows.ts`, now that it has a real step shape. Nothing imported the placeholder.
- **15 - The Translate step uses phase 07's offline dictionary translator**, as the build file allows. The chain runs end to end and the test proves the text really changes, but the quality is word-by-word and literal - see Known Issues.
- **15 - The four section-8 examples are both templates and tests.** They ship as one-click starting points in the builder and on the empty `/workflows` page, and `apps/api/src/workflows/workflows.test.ts` runs all four through the real executors, so a template that stops working fails the build rather than the user.
- **15 - A step whose tool takes one file at a time still works in a chain:** it runs once per carried file and the outputs are concatenated, rather than the chain refusing multi-file input.

- **16 - Paths:** the build file names `apps/api/ai/{intent,planner,executor,modelRuntime,ragContext,recommendations}.ts`; following phase 01's `src/` layout they are `apps/api/src/ai/*`. All six exist with those names. Extra files beside them: `providers.ts` (the four runtimes and how one is chosen), `common.ts` (the shared method/error plumbing), `assistant.ts` (the pipeline that ties intent to plan), `textTools.ts`, `docTools.ts`, `imageTools.ts` (the 15 AI tool executors), `imageRuntime.ts` (the phase-09 `ImageModelRuntime`) and `index.ts`.
- **16 - Extra files outside `apps/api/src/ai`:** `packages/types/src/ai.ts` (the shared contract), `packages/tool-registry/src/options-ai.ts` (the AI tools' options), `apps/web/src/components/assistant/{AssistantView,Recommendations}.tsx`, and the routes `POST /api/assistant/plan`, `POST /api/assistant/run`, `GET /api/assistant/status`.
- **16 - `ClientOption` gained the sources `aiProvider` and `aiKey`.** Phase 12 introduced `client` options for values only the browser knows; the chosen runtime and the user's own key are exactly that, so they reuse the mechanism instead of getting a special case in `ToolPage`. Both are `visible: false`, so nothing is rendered, and the key is redacted from job records.
- **16 - Phase 07's Summarizer, Translator and Grammar Checker were not rewritten.** The build file allows upgrading them in place; instead the AI-category tools (`ai-summarizer`, `ai-translator`, `ai-grammar-checker`) are the LLM versions and use phase 07's engines as their built-in fallback. That keeps one behaviour per tool id - a `document-summarizer` run is always the offline extractive summary, with no hidden dependence on whether a model happened to be reachable - and it is the conservative reading CLAUDE.md section 9 asks for when a build file leaves a choice open. See Known Issues for the `AI_UPGRADE_NOTE` wording.
- **16 - The `ai-assistant` registry entry has an executor that points at `/assistant`.** It is a signpost, not a runnable tool: the assistant needs a plan the user approves, which a single-shot pipeline run cannot give it. Its tool page links to the workspace, and the "Coming in a later phase" card there is gone.
- **16 - The AI Image tools are gated and say so.** `ai-image-generator` and `ai-image-editor` carry `localModel: "required"` and fail with a message naming `AI_IMAGE_URL` when no local image server is configured; `ai-background-object-removal` carries `localModel: "optional"` and delegates to phase 09's own Background Removal / Object Removal specs, so the built-in method is literally the same code. This is the "hardware-gated and explicitly optional/experimental" the build file asks for.
- **16 - No tool of this phase is in `VERIFIED_OFFLINE`.** Every AI tool can reach the network (that is the point of the hosted option), so `offline` stays false and `network: "optional"` describes them honestly. The offline _methods_ are tested; claiming `offline: true` for the tool would be the cheat CLAUDE.md section 8 forbids.

- **17 - Spotify audio downloading was deliberately excluded, permanently.** The build file calls it a hard non-goal: there is no legitimate way to take audio from Spotify without violating its terms, so Spotify Link Processing is metadata lookup only (track/album/artist/playlist/show/episode, from Spotify's own public oEmbed endpoint and the page's Open Graph tags - free, no account, no key). `spotifyInfo.ts` does not import the downloader, and a test asserts that against the source as well as against the registry. **This is not a "phase 2" item.** Only the user, with full awareness of the legal position, can change it.
- **17 - IP Geolocation is registered `network: "none"`, not `"required"`.** The build file files it under the Internet-dependent tools, but the implementation answers from the bundled registry tables, so claiming it needs the network would be inaccurate metadata - and CLAUDE.md section 7 makes the registry the source of truth. It and User-Agent Lookup (which parses a string the user pasted) are the only two phase-17 tools in `VERIFIED_OFFLINE`.
- **17 - The Quality Selectors take no options.** The build file lists "Quality Selector" beside each platform's MP3/MP4 tools; listing what a link offers is the whole job, and the id it prints is pasted into the download tools' "Exact format id" option. That avoids a second, divergent copy of the download form.
- **17 - `apps/api/online-media/` and `apps/api/network/` are `apps/api/src/online-media/` and `apps/api/src/network/`**, the same `src/` shift phase 02 recorded. `ipLookup.ts`/`userAgent.ts` from the build file's file list are `tools.ts` (all nine executors, which are small) plus `ipAddress.ts` (parsing and classification, shared with the SSRF gate); User-Agent Lookup reuses phase 12's parser rather than growing a second one.
- **17 - The "not-yet-implemented" tests had to change, because nothing is a stub any more.** Phase 17 was the last phase that adds tools, so `apps/web/src/test/file-core-api.test.ts` and the browser suite now assert the guarantee itself - every registry entry has a real executor, and the stub's own NOT_IMPLEMENTED shape - rather than clicking a tool that no longer exists in that state.
- **18 - Paths:** the build file names `apps/web/service-worker.ts` and `apps/web/lib/connectivity.ts`; following phase 01's `src/` layout, and because the worker must be served unbundled, they are `apps/web/public/sw.js` (plain JS, served as-is) and `apps/web/src/lib/connectivity.ts` (plus `use-connectivity.ts` for the shared monitor, `internet-check.ts` for the server probe, and `offline-status.ts` / `platform-status.ts` for /status).
- **18 - `manifest.json` gained shortcuts and a monochrome icon** beyond the build file's "manifest + icon set": four app shortcuts (All Tools, Assistant, Scan QR, Status), which cost nothing and are what makes the installed app worth installing.
- **18 - Two small fixes outside this phase's scope, both blocking its own verification:** `apps/api`'s test files used the DOM-only `RequestInfo` type, so `npm run typecheck` failed before this phase touched anything (now `Parameters<typeof fetch>[0]`), and phase 02's shell test asserted the _placeholder_ badge text "Connection status: online", which is now a verified state that starts as "Checking...".

- **19 - `npm run verify` is a new script the build file implies but never lists.** The acceptance criterion names it, so it exists; it is a chain of the scripts that already existed plus the offline check.
- **19 - The Tool-Contract suite lives at `tests/contract/tool-registry.test.ts`, outside every workspace.** The registry package deliberately knows nothing about `apps/api`, so only a test that imports both can see whether the two halves meet. It also does a behavioural sweep: every one of the 206 executors is called with no input, with the network trapped, and none may answer `NOT_IMPLEMENTED` - a stub answers that to everything, a real executor says what is actually wrong.
- **19 - "~230 tools" is 206 registry entries.** The build file's figure counts Features items; several items describe one tool from two angles and §15's eight workflow items are platform features, not tools. `registry.test.ts` already asserts the real invariant (every Features item claimed exactly once), so the contract suite only guards against the catalogue shrinking.
- **19 - The offline suites were not rewritten, only extended by one line each.** Nine suites (pdf-core, pdf-advanced, documents, data, images, media, qr, dev-utils, network) already ran every tool of their phase with `fetch` and `http/https.get/request` trapped. Re-authoring ~200 fixtures in `tests/offline/` would have duplicated them without proving anything more, so each suite instead records the ids it proved. `tests/offline/` holds the ledger and the reconciliation, which is the part that was genuinely missing.
- **19 - Three extra workflows, not two** (`tests/workflows/cross-category.test.ts`): Excel -> PDF -> Watermark -> Password (08 -> 05 -> 06), Image -> QR -> Resize -> WebP (11 -> 09) and CSV -> JSON -> formatted -> ZIP (08 -> 12). The four §8 examples each stay inside one family of tools; these cross phase boundaries, which is where a break would hide. Each is validated by the builder's own rules first, then run through the real executors and the real temp store.
- **19 - The five-journey E2E suite is additive** (`tests/e2e/journeys.e2e.test.ts`). The ten existing suites stay and remain the deep coverage; the new file walks the five journeys the build file names, in one browser against one server, so a regression that only appears when the pieces are used together has somewhere to fail.

- **20 - The phase did more than document.** `20-deployment.md`'s Scope is documentation and a QA checklist. Writing the QA checklist honestly meant actually running the four manual items, and three of them were runnable on this machine for the first time (Ollama, LibreOffice and yt-dlp are all now installed here). That found four real defects, which are fixed rather than logged - see the audit below. The build file's own Scope-Out (no CI complexity, no multi-region, no paid tiers, no native app) was respected.
- **20 - `document-translator`'s language list widened from six to twenty**, matching `ai-translator`, and it gained the standard `method` (auto / AI only / built-in) and AI-runtime options. The six-language list was a property of the glossary, not of the tool; with a model behind it, restricting the dropdown to six would have been the app lying about what it can do. Without a runtime, a language the glossary cannot reach fails with one sentence saying what to set up, exactly as `ai-translator` already did.
- **20 - `translateDocx` changed signature** from `(text: string) => string` to `(segments: string[]) => Promise<string[]> | string[]`. One model call per `<w:t>` run would be unusable, and runs split mid-sentence, so the batch has to be visible to the translator. The glossary path is one `.map()`.
- **20 - Four E2E test files were edited**, which phase 19 did not anticipate: three now connect to a caller-supplied schema instead of creating their own (creating one under a running server drops the tables out from under it), and two had a hard-coded port in a sign-out URL assertion that is now read from the live base URL. All of it is behaviour-preserving when each file runs on its own.

## Known Issues / Tech Debt

(Anything acceptance-criteria-adjacent that's deliberately deferred, with the reason and which phase should pick it up.)

- Only a few `.env.example` variables are used yet; most are placeholders documented for later phases (13, 04, 10, 16, 17). Each later phase should confirm/adjust its variables.
- **02:** Home search sends `/tools?q=…` but `/tools` ignores `q` until phase 03 adds registry search. Category/tool placeholder routes accept any slug (no 404) until phase 03 validates against the registry.
- **02:** "Continue with Google" is a disabled button and forms only validate client-side; phase 13 wires Auth.js.
- **03:** tool pages have no per-tool **Options** yet ("No options for this tool yet") — each tool phase adds its own. The result **Save** button is disabled until phase 14, and `requiresAuth` tools (dynamic QR, QR analytics, landing/content pages) always report "Sign in required" because there is no session until phase 13.
- **03:** `popularity` is a hand-set number per entry; phase 14 should derive it from real usage.
- **03:** the five fit modes of Fit Image to Square/Circle (fill, contain, stretch, repeat, blurred background) are modelled as options of one tool each, not separate tools — phase 09 must implement all five.
- No CI yet (out of scope for 01). Phase 19/20 can add a GitHub Actions workflow running `npm ci && npm run lint && npm run typecheck && npm test && npm run build`.

- **04:** every tool other than File Metadata Viewer still returns `NOT_IMPLEMENTED` - that is phases 05-17's job. Uploading to them is validated and cleaned up correctly, it simply does not process.
- **04:** jobs and temp files do not survive a server restart, and nothing links to `GET /api/jobs/:id` yet. Phase 13 persists jobs; phase 14 surfaces them.
- **04:** `userId` is always `null` (guest), so `requiresAuth` tools fail with `AUTH_REQUIRED` in the pipeline as well as the UI. Phase 13 wires the session into `POST /api/tools/run`.
- **04:** uploads are buffered fully in memory before being written (Next reads the whole multipart body anyway). Fine at the 100 MB default; if phase 10's video tools raise that limit, switch the route to a streaming parser.
- **04:** there is no per-IP or per-session rate limit on `POST /api/tools/run`. Acceptable for personal/small-group use; worth revisiting in phase 20 if the app is ever exposed publicly.
- **05:** Compress PDF's "Balanced"/"Strong" levels rasterise, which is the honest free/local trade-off — there is no pure-JS recompressor for the images already inside a PDF. A later phase could down-sample individual image XObjects with `sharp` (a likely phase-09 dependency) for a lossy-but-still-text mode.
- **05:** Resize PDF embeds each page as a form XObject, so a page with a non-zero `/Rotate` is embedded in its unrotated box and "auto" orientation reads the unrotated size. Rare in practice; worth fixing if it shows up.
- **05:** rendering is sequential, one page at a time, with a 10 000 px cap on either dimension. A 200-page scan at 300 DPI will approach the pipeline's 120 s executor timeout; phase 19 should decide whether long jobs need progress reporting rather than a bigger timeout.
- **05:** the ZIP writer stores entries uncompressed and has no ZIP64 support, so an archive above 4 GB is out of scope (the 100 MB upload ceiling makes that unreachable today).

- **06:** OCR offers English only in the UI. Other languages work if their `.traineddata.gz` is placed in `OCR_LANG_PATH`, but the option list is static; a later phase could list whatever models are present. OCR runs one page at a time (~2 s/page at 300 DPI), so a 60-page scan approaches the 120 s executor timeout — the same long-job question as phase 05.
- **06:** PDF → Excel's table detection is heuristic (columns from x-positions shared across a page). Clean, text-based tables convert well; merged cells, rotated text and tables drawn as images do not. PDF → Word keeps text, headings, emphasis and page breaks, but not columns, tables or images in editable mode.
- **06:** The built-in Office → PDF path (for phases 07/08) keeps text, headings, lists, tables and images, but not fonts, colours or exact layout; LibreOffice is the fidelity upgrade and is detected automatically.
- **06:** `checkPdfA` covers the core PDF/A-2b rules but is not veraPDF. Anyone needing certified archival output should also validate with veraPDF (free).
- **06:** The self-signed signature seal proves integrity, not identity. Accepting a user-supplied `.p12` certificate would be a small addition if ever wanted.
- **06:** `next build` reports three more "dynamic filesystem access causes tracing of the whole project" warnings (LibreOffice/PATH lookup, node_modules lookup), the same kind phase 05 already had. Harmless for self-hosting; phase 20 should revisit them if it uses standalone output.

- **07:** without LibreOffice (not installed on the dev machine), Word/PowerPoint → PDF/Images use phase 06's built-in layout, which keeps text, tables and pictures but not exact fonts or positions; the summary says so. `.doc`/`.ppt` need LibreOffice. The LibreOffice path is exercised in tests only as "missing" and "present but failing".
- **07:** Merge Documents drops comment anchors from appended documents (the comment text lives in their comments part). Merge Presentations drops the speaker notes of appended decks only when the first deck has no notes master.
- **07:** the offline translator is deliberately basic (word-by-word glossary); real quality needs phase 16. The grammar checker is English-only. OCR → Word is English-only and inherits phase 06's ~2 s/page speed (same long-job question).

- **08:** `.xls`/`.ods` need LibreOffice (converted to .xlsx first); without it they fail with the usual "install LibreOffice or save as .xlsx" message. Only the "missing" path is tested (LibreOffice isn't on the dev machine).
- **08:** the whole upload is in memory (phase 04's route buffers it anyway). CSV parsing is row by row, but the parsed table is held in full. That's fine at the 100 MB limit (50k rows ≈ 3 s), but a true streaming pipeline would need a streaming upload route first.
- **08:** XML Validator checks well-formedness only. No free, pure-JS XSD/DTD validator is worth depending on, and the report says so. The Data Validator's `date` rule accepts ISO, `dd/mm/yyyy`-style and month-name dates without checking which of day/month comes first.
- **08:** Excel → Word stops at 5,000 rows per sheet (the summary says how many were left out), to keep the document openable. Excel → PDF reuses phase 06's built-in sheet layout when LibreOffice is absent.
- **08:** rows-to-sheets transforms that move cells (transpose) drop the source formatting; sort keeps it per row.

- **09:** the AI path of the model-capable tools is exercised only through a stub runtime; phase 16 must register a real `ImageModelRuntime` (e.g. a local rembg / Real-ESRGAN / LaMa process; Ollama itself doesn't do image-to-image) and add the Settings screen the message points to. Until then `auto` always uses the built-in method.
- **09:** built-in Background Removal only handles plain, even backgrounds (it refuses busy ones rather than producing a bad cut-out); built-in Object Removal suits small objects on smooth backgrounds; large textured areas smear.
- **09:** HEIC is read-only and decoded in WASM (slower); the metadata viewer reports only basics for HEIC and BMP. The HEIC path is tested only with a corrupt file (no free HEIC encoder to make a fixture).
- **09:** text rendering covers Latin/Greek/Cyrillic (Liberation Sans); CJK, Arabic or emoji fall back to whatever sans-serif the canvas finds, which may be missing on a server.
- **08/09:** phase 08's 50k-row test (CPU budget 10 s) is flaky on the dev machine as of 2026-09-18: run alone, it measures 9.5–11 s of CPU on both the phase-08 commit and phase 09, so this is machine load, not a regression. The budget was left unchanged; phase 19 should decide whether to scale it or move it to a separate perf run.
- **03 resolved:** the five fit modes are implemented for both Fit to Square and Fit to Circle.

- **10:** long media jobs have no progress reporting - a 10-minute encode simply shows "Processing". Same long-job question as phases 05/06; phase 19 should decide whether jobs need progress events.
- **10:** uploads are still buffered in memory (phase 04), so a video is limited by `MAX_UPLOAD_MB` (default 100). Raising it for video means switching `POST /api/tools/run` to a streaming parser first, as phase 04 noted.
- **10:** WebM output uses VP9 at `-deadline realtime -cpu-used 8` for speed; a slower preset would give better quality per byte. AV1 is not offered (too slow in software). Hardware encoders (NVENC/QSV/VideoToolbox) are never used - software encoding is the portable, works-everywhere default.
- **10:** `.wma/.wmv/.flv` are read (and WMA can be written) but are not offered as conversion targets beyond WMA audio; a minimal FFmpeg build missing an encoder fails with a message pointing at a full build.
- **10:** Subtitle Extraction cannot handle image-based subtitle tracks (PGS/VobSub) - that needs OCR; phase 16 could route them through the phase-06 OCR engine.
- **10:** the waveform decodes the whole track into memory (at most 20 M samples, about 40 MB); a 3-hour recording is handled by lowering the sample rate rather than streaming.
- **08/10:** phase 08's 50k-row CPU budget was raised from 10 s to 15 s. The media tests spawn FFmpeg in parallel test files, and a saturated machine inflates even a process's own measured CPU time; the underlying work is unchanged (about 3 s alone). Phase 19 should still move this to a separate perf run.

- **11:** the interim JSON store has no file lock, so two server processes writing at the same instant could lose one change (a single `next start` is safe - writes inside one process are serialised, and every operation re-reads the file). Phase 14's Postgres migration removes this; until then, run one instance.
- **11:** hosted-page attachments are base64 data URLs inside that JSON file, which is why they are capped at 2 MB each and 8 MB per page. Phase 14 should move them into the file store and keep only a reference.
- **11:** a dynamic code encodes `<APP_URL>/q/<id>`, so codes made while `APP_URL` is still `http://localhost:3000` are useless once printed. `.env.example` now says so; phase 18's `/status` or phase 20 could warn when it still points at localhost.
- **11:** QR Code Analytics reports every code on the instance, because there is no session to filter by and the executor has no request context. Phase 13/14 should filter by user id.
- **11:** the camera scanner is covered by unit tests with a mocked `getUserMedia`; a real camera is not exercised anywhere (there isn't one on the dev machine or in CI). Phase 19 should decide whether that deserves a manual checklist entry.
- **11:** the decoder reads the first code in an image only. Scanning a sheet of several codes at once would need a tiling pass; nobody has asked for it.

- **12:** the Regex Tester still runs a user-supplied expression in the server process. The nested-quantifier screen catches the classic `(a+)+` shape, and the sample size, match limit and time budget bound the normal cases, but Node cannot interrupt a regex mid-match, so a pattern that is catastrophic in some other shape could still pin one CPU for a while. Running it in a `worker_threads` worker that can be terminated is the real fix; phase 19/20 should decide, alongside the per-IP rate limit phase 04 already flagged.
- **12:** JavaScript "minify" is really "compact" (see the Decisions Log). If genuine minification is ever wanted, it needs a real minifier as a dependency - `terser` is free and MIT-licensed - not a bigger regex.
- **12:** the ZIP tools hold the whole archive and every extracted file in memory, so extraction is bounded by `MAX_EXTRACTED_BYTES` (512 MB) and creation by phase 04's `MAX_UPLOAD_MB`. Streaming would need the streaming upload route phase 04 noted. No ZIP64 and no encrypted archives (jszip cannot read them); an encrypted archive fails with the generic "not a readable ZIP" message, which could be more specific.
- **12:** Metadata Remover covers images, PDF, Word/ODT, PowerPoint and Excel. Audio and video files are _not_ covered - phase 10's Audio Metadata Editor can clear tags, but wiring "clear everything" through it safely (and the fact that there is no video equivalent) was more than this phase's scope; the tool names the unsupported file rather than pretending. Worth revisiting whenever phase 15's workflows make chaining easy.
- **12:** File Type Converter passes the delegate its _default_ options plus the target format, so a conversion that needs a non-default setting (a specific sheet, a page range) has to be run from the tool itself. The summary always names the tool it used, so it is clear where to go.
- **12:** the `client` option type is filled in by the page. A tool must treat the value as untrusted like any other option - the User-Agent Viewer only ever parses it into strings and never uses it for a decision. Nothing today verifies it against the request headers, and phase 13 could cross-check if that ever matters.

---

- **13:** the Google OAuth round trip is **not** verified end to end - that needs a real Google Cloud project and the owner's credentials. The provider is only registered when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set (so no dead button), `allowDangerousEmailAccountLinking` is on so a Google sign-in joins an existing email account, and the adapter writes the `accounts` row. Someone with a Google project should do one manual sign-in; phase 19 should list it as a manual check.
- **13:** there is no rate limit on `/api/auth/signup`, `/api/auth/reset` or sign-in. bcrypt at cost 12 makes guessing slow and the reset endpoint answers identically for every address, but a public instance wants a per-IP limit - the same one phases 04 and 12 already flagged. Phase 19/20 should decide.
- **13:** email addresses are never verified. Signing up does not send a confirmation mail, and `emailVerified` stays null for credentials accounts. For a personal instance that is the honest trade; a public one would want it (the `verification_tokens` table is already there).
- **13:** `purgeExpiredResetTokens()` exists but nothing calls it on a schedule - tokens are single-use and time-limited, so stale rows are harmless, but phase 20 could run it at startup alongside the temp-file sweep.
- **13:** the generated Prisma client is gitignored, so a fresh clone must run `npm run db:generate` (or `npm run build`, which does it) before `npm run typecheck` will pass.
- **13:** `UserSettings` is stored and read but nothing edits it yet beyond the account page reporting the theme - phase 14 owns settings sync.

- **11 resolved (14):** the interim JSON store, its lack of a file lock, and the "run one instance" caveat are gone - dynamic QR codes, their scans and their hosted pages are Postgres rows now, migrated once on first use. QR Code Analytics already filtered by user id from phase 13.
- **13 resolved (14):** `UserSettings` is now read _and_ written, by `/settings` and `/api/settings`.
- **03 resolved (14):** `popularity` is no longer only a hand-set number - real run counts lead the sort, and "recently used" comes from history rather than from which pages were opened.

- **14:** guest history is per browser, per device, by design - clearing site data clears it, private mode may block IndexedDB entirely, and nothing about it is recoverable. The page says all of this; there is no fix, only the sign-in prompt.
- **14:** a history row older than the temp store's retention window (default 60 minutes) has no downloads left. The row lists the files it produced and says they have been deleted rather than offering a dead link. Keeping results longer would need the opt-in cloud storage master plan section 15 describes, which no phase owns yet.
- **14:** `/history` has no free-text search and no "re-run with the same options" - the filters are category, tool, status and date, and "Run again" opens the tool's page. The options were redacted before they were stored (phase 06), so a true re-run cannot be reconstructed from a job row; phase 15's workflows are the right home for that.
- **14:** the guest import is offered whenever device entries exist, so a visitor who signs in on a shared machine could import someone else's device history. It is metadata only and it is a button nobody has to press, but a public instance might prefer to drop the feature.
- **14:** `toolUsage` counts every job ever run by the account, with no decay, so an old favourite outranks a new one for a long time. A time window would be a one-line change if it ever feels wrong.
- **14:** hosted-page attachments are still base64 inside a JSONB column (see Deviations). They are capped at 2 MB each and 8 MB per page, so a page is bounded, but a permanent blob store would be better if hosted pages ever get real use.
- **14:** the unit suite's budgets were raised (`testTimeout` 30 s -> 60 s, a new `hookTimeout` of 30 s, and testing-library's `asyncUtilTimeout` 1 s -> 5 s). Nothing got slower: the heaviest cases are a jsdom render that first imports the whole `@onestop/api` barrel and a Postgres per-test reset, both seconds alone and several times that when all 33 files run at once. The same machine-load question phases 08/10 raised - phase 19 should decide whether these belong in a separate perf run.

- **15:** the Translate step in "PDF -> OCR -> Translate -> PDF" is phase 07's offline word-by-word dictionary translation, which is rough and literal. **Phase 16 should revisit this template once a real translator exists** - the build file asks for exactly this note.
- **15:** no branching or conditions, by design (build file Scope - Out, master plan sections 8 and 26). A workflow is a straight ordered chain; anything else is a new phase, not a quiet extension of this one.
- **15:** a workflow run has no live progress in the browser. The engine reports per-step and per-file progress through callbacks, and the run panel shows every step's outcome when it finishes, but the HTTP response is a single POST - streaming progress would need SSE or polling, which phase 16's assistant will want anyway.
- **15:** a guest's workflows live in `localStorage` and are not imported into an account on sign-up, unlike phase 14's history. The builder says so on save. An import would reuse the same pattern if it is ever wanted.
- **15:** options are validated against the registry's declared ids, choices and ranges, but `showWhen` is not evaluated when saving, so a workflow can carry a value for an option the tool ignores in that mode. Harmless - the executor ignores it, and the builder only shows the visible ones.

- **16:** the four provider integrations are tested against _mocked_ HTTP responses, not a live service. The Ollama, Groq, OpenRouter and Google request/response shapes were written from their public API documentation; this machine has no Ollama install and no free key, so a wire-format change at any provider would not be caught by the suite. Phase 19 or 20 should do one manual round trip per provider and record the result here. The local model this was designed against is **Ollama with `llama3.2` (3B)** - roughly 2 GB of RAM for the quantised build, comfortable on a modern laptop CPU; an 8B model (`llama3.1`) wants about 6 GB and is noticeably better at planning. Phase 20 should put both numbers in the README's minimum-specs section.
- **16:** the local image runtime (`AI_IMAGE_URL`) has never been exercised against a running Stable Diffusion server, for the same reason - no GPU here. The AUTOMATIC1111 endpoints (`/sdapi/v1/txt2img`, `/sdapi/v1/img2img`, `/sdapi/v1/extra-single-image`, `/rembg`) are written from that project's API, and a 404 on any of them produces a specific "check the API is enabled" message rather than a crash, but it is unverified. Anyone with a GPU should try it once.
- **16:** `AI_UPGRADE_NOTE` in `apps/api/src/documents/common.ts` still reads "Quality will improve once the AI Assistant is set up", which is now true in a narrower sense than it sounds: the phase-07 tools themselves do not change, their AI-category twins are the better version. The note was left alone rather than reworded blind across four tools; phase 19 should reword it to name the AI tool to open instead.
- **16:** the assistant has no streaming progress. The plan is one POST and the run is another, so a long chain shows "Running..." until it finishes. Phase 15 flagged the same gap for workflows and noted that SSE or polling would serve both; phase 18/19 should decide once, for both.
- **16:** there is no per-user rate limit on `/api/assistant/plan`. A planning call can reach a third-party API with the user's own key, so the cost of abuse falls on them rather than on OneStop, but it joins the per-IP limit that phases 04, 12 and 13 have all now asked for.
- **16:** the rule planner handles at most 6 clauses and its ordering search is exponential in that number. Six is already more than any request anyone has typed, and a longer one is refused with a clear message rather than hanging, but it is a hard ceiling rather than a graceful one.
- **16:** intent detection and the clause routes are English-only. A request in another language falls through to registry search, which is also English-keyed. Nothing about the architecture prevents other languages; nobody has asked.
- **16:** "Ask Questions About a File" reads the whole document into memory to chunk it, so it is bounded by the same upload limit as everything else, and its extractive fallback answers with the document's own sentences rather than a synthesised reply - correct, but blunter than a model's answer.
- **15 resolved (16):** the "PDF -> OCR -> Translate -> PDF" template's translate step. A real translator now exists (`ai-translator`), but the template was **left on the offline dictionary** on purpose: a template that silently needs a model configured would fail for the very visitor it is meant to help. The AI Translator is a tool the user can put in their own chain, and the builder offers it. Phase 19 should confirm that is the call we want.

- **17:** **yt-dlp is not installed on the dev machine**, so no real download has ever run here. The wrapper is tested through `setYtdlpRunner` (argument building, format selection, file collection, the size cap) and through ten stderr-to-message cases, exactly as the build file's Test Cases require, but the acceptance criterion "downloads and converts a real public test video, respecting quality selection" is **unmet on this machine** and needs one manual run by someone with yt-dlp and FFmpeg installed, on material they have the right to download. Phase 19 should put it on the manual checklist.
- **17:** the SSRF gate resolves the host, then `fetch` resolves it again to connect, so a DNS answer that changes between the two (classic rebinding) is not caught. Closing it means pinning the connection to the checked address, which needs a custom undici dispatcher. Everything else the hand-off note asked for is in place; phase 19/20 should decide whether the remaining window is worth the dependency.
- **17:** the rate limit is in memory and per process. Two `next start` instances behind a load balancer each get their own budget, and a restart forgets everything. That is the right size for a personal instance; anything public wants a shared store, and it joins the same question phases 04, 12, 13 and 16 raised.
- **17:** WHOIS output varies enormously between registries, so `parseWhois` is a best-effort extractor over about twenty label spellings. The full raw record is always returned beside it (and is in the downloaded report), so nothing is hidden when a field is missed. Registries that publish no WHOIS server (`.uk`) or redact everything behind a web form return that as the answer.
- **17:** `MAX_DOWNLOAD_MB` is read once at module load, so changing it needs a restart - and the download is held in memory before it reaches the temp store, the same buffering limit phases 04 and 10 flagged. A 512 MB default is comfortable; a streaming upload/download route would lift both at once.
- **17:** Instagram in practice often needs a signed-in session, so `YTDLP_COOKIES_FILE` exists for anyone who wants to supply their own. Without it many Reels answer "private, age-restricted or needs a sign-in", which is accurate rather than a bug. The legal notice applies to anything cookies unlock just the same.
- **17:** the geo tables are a snapshot (built 2026-09-19) and will drift as allocations move between registries. `node scripts/build-geoip.mjs` regenerates them, needs no account, and takes about a minute; phase 20 could mention it in the README.
- **17:** phase 16's external recommendations were checked and **nothing needed narrowing** - none of its curated topics (3D, transcription, TTS, design, timeline editing, e-signatures, OCR, translation, image generation, writing software) is something phase 17 now ships. New planner matchers were added instead, so "download this YouTube video as mp3" routes to `youtube-to-mp3` rather than at a local file.
- **17:** `apps/web/src/test/shell.test.tsx` failed twice in the full parallel run and passes alone in 20 s - the same machine-load flakiness phases 08, 10 and 14 recorded. The three E2E _files_ that fail need a Postgres on 127.0.0.1:55433, which this machine does not run; every test in them that can run passes.

- **18:** the service worker caches the app shell, not tool results. A tool run is a POST to `/api/tools/run` and its downloads live under `/api/files`, both network-only by design (a cached result would outlive the temp store's retention window, which CLAUDE.md section 5 sets deliberately). So with the _server_ unreachable, no tool runs at all - the cached pages render and every tool says so plainly. That is the shape of a server-side processing model, not a gap; the alternative is a WebAssembly copy of each processor in the browser, which no phase owns.
- **18:** `VERSION` in `sw.js` is bumped by hand. Assets are content-hashed so a stale chunk is impossible, and navigations are network-first so HTML is never stale for long, but the _shell precache_ only refreshes when that constant changes or the visitor clears it from /status. A build-id-stamped worker would automate it and needs the build step this phase deliberately avoided.
- **18:** the connectivity probe polls every 60 seconds while the tab is visible, and the server's answer is cached for 10 seconds, so a connection that returns is noticed within about a minute - immediately on the browser's own `online` event, on tab focus, or on "Check again". Nothing pushes; an SSE channel would, and phases 15 and 16 have both asked for one already for progress reporting. Phase 19/20 should decide once, for all three.
- **18:** the installability audit is the checklist, not Lighthouse itself (see the Decisions Log). Nobody has run real Lighthouse against this build, and no automated check covers the install _prompt_ appearing, which Chrome gates on its own engagement heuristics. Phase 20 should install it once by hand on a phone and on a desktop and record the result here.
- **18:** **camera QR scanning in the installed app is verified by code path, not by a real camera.** `cameraPreflight` now refuses an insecure context with a specific message, the `<video>` element carries the `playsInline`/`muted` attributes iOS standalone needs, and the scanner is otherwise unchanged - but this machine has no camera, and a fake device cannot prove a real installed-app permission flow. Phase 19 should put "install on a phone, scan a code" on the manual checklist. One real constraint to know: an installed PWA served over plain http from a LAN address has no secure context, so the camera cannot be opened at all - https or localhost only.
- **18:** the offline banner and the connection badge live in the root layout, so they render on every page including the `/q/[id]` hosted QR pages. Right for the app, slightly odd on a page a stranger opened from a poster; phase 19 could give hosted pages their own minimal chrome.
- **18:** `/status`'s dependency table probes the AI runtime on every visit, with a 2.5 s cap. With a configured-but-stopped Ollama the page takes that long to render. Caching it would make a "start Ollama, reload" loop misleading, so the cap was preferred to a cache.
- **18:** the unit suite's four failures in the full parallel run (`lint.test.ts`, the 50,000-row CSV budget, and two `/account` renders) all pass when their files run alone - the same machine-load flakiness phases 08, 10, 14 and 17 recorded. Same for E2E: `pwa.e2e.test.ts` passes alone and beside `shell.e2e.test.ts` (92 checks together), while a full `npm run test:e2e` that spawns ten `next start` servers times out inside the image and dev-utils files, and the three database-backed files still need a Postgres on 127.0.0.1:55433. Phase 19 owns the decision about splitting the heavy suites.

### 19 - the phase 19 audit

**Found and fixed (real defects, not missing tests):**

- **Google OAuth could never have worked.** `PrismaAdapter` passes the OAuth profile straight to `prisma.user.create`, and Auth.js calls the picture `image` while master plan §16 calls the column `avatar` - so the first-ever Google sign-in would have failed with "Unknown argument `image`". Nothing caught it because no test had ever exercised the adapter. `apps/web/src/auth.ts` now wraps the adapter (`onestopAdapter`) to translate that one field in each direction, and `apps/web/src/test/oauth.test.ts` proves it against a real Postgres schema. No migration was needed.
- **The `/account` and `/status` route smoke tests were unreliable by construction.** `/account` renders a guest card with no database and redirects to the login page with one, so the assertion depended on the developer's `.env`; `/status` probes FFmpeg, yt-dlp and the AI runtime while it renders. The smoke test now accepts a redirect as a legitimate outcome (asserting the target), and the worker cap removes the saturation that made the probes time out.
- **`file-metadata-viewer` was on `VERIFIED_OFFLINE` with no test behind it** - it belongs to phase 12 in the catalogue but is phase 04's executor, so it fell through the gap between the two suites. The offline check is what found it. It is now proved with the rest of phase 12.

**Tools with reduced quality or a prerequisite (the acceptance criterion's list).** None is marked experimental in the registry - every one of the 206 works - but these are the ones whose output or availability is knowingly below "best in class", each already detailed under its own phase above:

- **Document Translator (07) is still the offline glossary.** Phase 16 built `ai-translator` on the model runtime but did not route phase 07's `document-translator` through it, so a chain like the §8 "PDF -> OCR -> Translate -> PDF" workflow still translates word-by-word and says so in its summary. This is the exact case the build file predicted. Left as is - wiring it would be a feature, which this phase is not for - and it is the first thing worth doing after phase 20.
- **Grammar Checker (07) is English-only**; OCR (06) ships English only, other languages need a `.traineddata.gz` in `OCR_LANG_PATH`.
- **Compress PDF's stronger levels rasterise (05)**; PDF -> Excel/Word (06) use heuristics that suit clean, text-based documents; `checkPdfA` (06) is not veraPDF; Sign PDF (06) proves integrity, not identity.
- **Built-in Background Removal and Object Removal (09)** handle plain backgrounds and small objects; the AI path needs a local image model that is not bundled. Image Upscaler/Enhancer/Denoiser are conventional filters until one is configured.
- **Office fidelity (06/07/08) depends on LibreOffice**, which is optional and absent on this machine; `.doc`, `.ppt`, `.xls` and OpenDocument input need it outright.
- **Audio/video tools (10) need FFmpeg**, and the online media tools (17) need yt-dlp and the Internet. Both are declared prerequisites, not defects - `/status` reports them and every affected tool fails with one clear message.
- **XML Validator (08) checks well-formedness only**; Subtitle Extraction (10) cannot read image-based (PGS/VobSub) tracks; HEIC (09) is read-only.

**Manual checklist (things no automated test here can honestly cover).** Carry these into phase 20:

1. Install the PWA on a phone and scan a QR code with the real camera (this machine has none, and an installed PWA needs https or localhost for a secure context).
2. Run Lighthouse once against `next start` - `scripts/pwa-audit.mjs` covers the checklist, not Lighthouse itself.
3. Run a yt-dlp download on a machine that has yt-dlp installed.
4. Sign in with a real Google project once, end to end. The adapter, the provider registration and the session callbacks are now covered, but no test can stand in for Google's consent screen.

**Still open after this phase:**

- **The E2E suite is not run as one command.** `npm run test:e2e` spawns a `next start` per file - now eleven of them - and saturates the machine, exactly as phase 18 recorded. The files pass in small groups. Phase 20 should either run them sequentially against one shared server (`E2E_BASE_URL`) or split them in CI; the harness already supports it, and the new journeys file is written to be the one that always runs.
- **Long jobs still have no progress reporting** (phases 05, 06, 10 all raised it). A 10-minute encode or a 60-page OCR shows only "Processing". Not a testing gap, so it was left alone, but it is the oldest unanswered product question in this file.
- **No per-IP rate limit on `POST /api/tools/run`** (phase 04). Fine for personal use; phase 20 should decide before exposing the app publicly.

### 20 - the phase 20 audit

**Found and fixed (real defects, not missing documentation).** Every one of these was found by
running something that had never been run before on this machine, or in a way it had never been run:

- **`yt-dlp` metadata reads were broken against current yt-dlp.** `baseArgs()` carried
  `--max-downloads 1` on _every_ invocation, including `--dump-single-json --skip-download`.
  Current yt-dlp applies that cap before it prints, so the details read returned an empty string
  and `parseInfo` answered "The video details could not be read" for a perfectly good link - which
  is every Online Media tool's first step. The flag moved to `downloadArgs`, where it is the
  download guard it was always meant to be. `--no-call-home` went too: it is deprecated, does
  nothing but print a deprecation notice, and is slated to become a hard error. A regression test
  asserts neither may return to `baseArgs`. **Nothing caught this because the whole wrapper is
  proved through interface mocks, exactly as the build file requires.**
- **LibreOffice was installed on this machine the whole time and OneStop could not see it.** The
  locator checked `PATH` and the two `Program Files` paths only; the installer had put it in
  `D:\LibreOffice`, which it offers and people accept. Phases 06, 07, 08 and 19 all recorded
  "LibreOffice is absent on this machine" as a fact about the machine. It was a bug. The locator
  now also checks `%ProgramFiles%`/`%ProgramW6432%`/`%ProgramFiles(x86)%`/`%LOCALAPPDATA%` and the
  root of drives C-H; `LIBREOFFICE_PATH` still wins over all of it.
- **`npm run fetch:ffmpeg` produced an app that still said "FFmpeg is required".** The script
  unpacks a static build into `.tools/`, and `tests/setup/env.ts` points `FFMPEG_PATH` at it - but
  the app's own locator only ever checked the environment, `PATH` and the usual install folders. So
  the fallback the README offers anyone who cannot install FFmpeg system-wide worked for the test
  suite and for nobody else. `ffmpegCheck.ts` now walks up from the working directory to find
  `.tools/` (`next start` runs with its cwd in `apps/web`), as a last resort only - a system install
  still wins. Found by the shared-server E2E run, where the media suite failed for exactly this
  reason while the unit suite passed.
- **`document-translator` could not use an AI runtime at all** - the gap phase 19 documented. Fixed
  as described in the Decisions Log.
- **The marker protocol failed on a real 3B model on its first attempt.** The first implementation
  treated that as "no runtime" and fell back to the glossary, which would have made the whole
  feature invisible to anyone running a small local model - i.e. to most people. It now
  distinguishes "unreachable" from "mangled" and retries mangled batches one passage at a time.

**The manual checklist phase 19 handed over (four items), plus phase 16's "never tested against
a live service" gap, which became runnable at the same time:**

1. **Lighthouse - done.** `npx lighthouse@12` against `next start` on the production build:
   **Performance 96, Accessibility 100, Best Practices 100, SEO 100.** (Lighthouse 12 removed the
   PWA category entirely; `node scripts/pwa-audit.mjs` remains the installability check, 26/26.)
   Only remaining performance notes are render-blocking CSS and unused JavaScript in the Next.js
   bundle - framework-level, not a defect.
2. **A real yt-dlp download - done, and automated.** `online-media/live.test.ts` reads real
   metadata and downloads a real Creative Commons video from the Internet Archive (not a platform
   whose terms of service this repo has to reason about). Gated behind `ONESTOP_LIVE_DOWNLOAD=1`
   so it never fires in CI or by accident. This is what found the `--max-downloads` defect.
3. **A real local AI round trip - done, and automated.** `ai/live.test.ts` runs against a real
   Ollama: the status the UI shows, one chat through the real provider adapter, `ai-summarizer`
   end to end, and `document-translator` on the model path. It skips itself when Ollama is not
   running. Phase 16's "tested against mocked HTTP, never a live service" is now closed for
   Ollama. **The three hosted providers (Groq, OpenRouter, Google AI Studio) are still mock-only**
   - each needs a free account and a key this machine does not have. Their request/response shapes
     come from the providers' public documentation.
4. **Install the PWA on a phone and scan a real QR code - still owed.** This machine has no camera
   and no phone attached to it, and no automated test can stand in for either. Everything
   automatable about installability passes (`scripts/pwa-audit.mjs` 26/26, Lighthouse above, the
   `journeys` install-criteria check); the camera path is verified by code path only.
5. **A real Google sign-in - still owed.** It needs a real Google Cloud project and the repo
   owner's own credentials. The adapter (including phase 19's `image`/`avatar` translation), the
   provider registration and the session callbacks are all covered by tests; nothing can stand in
   for Google's consent screen.

**The gates, at the end of this phase:**

- `npm run verify`: lint + typecheck + **1,031 passing checks** (2 skipped: the live yt-dlp
  download, which needs `ONESTOP_LIVE_DOWNLOAD=1`) + **172/172 offline tools proved offline**.
- `npm run test:e2e:shared`: **11 files, 135 real-browser checks, green as one command** - 9 against
  the shared server, then `pwa` and `assistant` on their own.
- `node scripts/pwa-audit.mjs`: **26/26** installability checks.
- Lighthouse: **96 / 100 / 100 / 100**.

**Also closed this phase, from "Still open after phase 19":**

- **The E2E suite is one command again.** `npm run test:e2e:shared`: **11 files, 135 checks, green**
  (9 files against the shared server, then `pwa` and `assistant` on their own). See the Decisions Log.
- **No per-IP rate limit on `POST /api/tools/run`.** Now there is one, with a test.

**Still open after this phase** (nothing blocking; these are the honest remainder):

- **Long jobs still have no progress reporting.** A ten-minute encode or a sixty-page OCR shows
  only "Processing". Raised by phases 05, 06 and 10 and still the oldest unanswered _product_
  question in this file - it needs a UI decision, not a fix.
- **The three hosted AI providers have never made a live call** (see item 3 above).
- **The phone/camera and Google sign-in items above.**
- **No hosted instance has actually been deployed.** `20-deployment.md`'s second acceptance
  criterion asks for a free-tier deployment reachable over HTTPS. `docs/DEPLOYMENT.md` documents
  both routes concretely and every choice in it is an environment variable rather than code, but
  performing the deploy means creating accounts on Render/Neon under the owner's name, which is
  outside this repository and is the owner's to do. The parts that can be proved here are:
  `npm run build` succeeds (206 tool pages prerendered), `npm start` serves it, and §7 of
  `DEPLOYMENT.md` is the post-deploy checklist to run against the URL once it exists.

**Re-verified on 2026-09-19, after the phase was written**, from a clean tree, to confirm the
numbers above are current and not a snapshot: `npm run verify` exits 0 - lint, typecheck,
**1,031 passed / 2 skipped** (the skips are the `ONESTOP_LIVE_DOWNLOAD=1` yt-dlp suite), and
**172/172 offline tools proved offline** across 9 suites. `npm run build` exits 0.

## §26/§27 Final QA checklist

Master plan §26 "Keep" - every item present:

| Keep                        | Where                                                      | Status |
| --------------------------- | ---------------------------------------------------------- | ------ |
| PDF/document conversion     | 26 PDF + 24 document tools                                 | Yes    |
| Spreadsheet/data conversion | 30 data tools                                              | Yes    |
| Image tools                 | 27 tools                                                   | Yes    |
| Media tools                 | 27 audio/video tools (FFmpeg)                              | Yes    |
| QR tools                    | 15 tools, incl. dynamic codes                              | Yes    |
| Utility tools               | 25 developer/file utilities                                | Yes    |
| AI Assistant                | `/assistant`, full §7.2 pipeline                           | Yes    |
| Workflows                   | `/workflows`, builder + runner + batch                     | Yes    |
| History                     | `/history`, Postgres or IndexedDB                          | Yes    |
| Authentication              | Auth.js, email/password + Google                           | Yes    |
| Offline support             | 172 of 206 tools, proved with the network trapped          | Yes    |
| PWA                         | manifest, service worker, `/offline`, 26/26 installability | Yes    |
| External recommendations    | phase 16, `/assistant`                                     | Yes    |

Master plan §26 "Avoid initially" - every item avoided:

| Avoid                           | Status                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Microservices                   | One Next.js app; `apps/api` is a library it imports, not a service                                                       |
| Complex roles                   | No roles at all. A user is a user                                                                                        |
| Billing / subscriptions         | None. No payment code anywhere                                                                                           |
| Enterprise administration       | No admin surface                                                                                                         |
| Multi-region infrastructure     | One instance, one Postgres                                                                                               |
| Mandatory paid APIs             | None. Every provider is free-tier or local, and all are optional                                                         |
| Permanent file storage          | Temp only: inputs deleted when a job ends, results after a TTL, a sweeper for abandoned tabs. No file binary in Postgres |
| Complicated workflow branching  | Linear chains only                                                                                                       |
| Separate native mobile codebase | None. The PWA is the mobile story                                                                                        |

Master plan §27 "The product should be" - every clause:

| Clause                                                   | Evidence                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| easy to run on localhost                                 | `npm install && npm run dev`. `docs/LOCAL_SETUP.md`                                                            |
| deployable on free-tier hosting                          | `docs/DEPLOYMENT.md`, two routes, all config in env vars                                                       |
| useful without Internet for all feasible local tools     | 172 of 206, each proved offline by a test that traps the network                                               |
| graceful when Internet-only features are unavailable     | 18 Internet-only tools, each with the §22 message; `/status` reports the state; the `pwa` E2E suite asserts it |
| free to build and operate at the intended scale          | No paid dependency exists in the repo                                                                          |
| simple enough to maintain as a single project            | One repo, one app, one database, one registry                                                                  |
| structured so Claude Code can implement it incrementally | 20 build files, this tracker, `CLAUDE.md`                                                                      |

## Open Questions

(Anything ambiguous that needs a decision from the user rather than a guess.)

- **Open (2026-09-22):** "Replace the buttons: 'Search tools' and 'Ask OneStop AI'" was read as
  _swap their places_ - "Ask OneStop AI" now sits beside the search box and hands over whatever was typed;
  "Search tools" sits underneath. If a different replacement was meant (new labels, icons, a different
  layout), say which.
- **Open (2026-09-22):** the third-party-service disclosure was removed from the assistant screen as
  asked, which CLAUDE.md §2.1 says must be shown in the UI. It is kept where the choice is made: Settings
  shows the "Heads up" disclosure for OneStop's service and for each hosted provider. Confirm that is
  enough.
- **Resolved (2026-09-22):** the random provider pick is gone. OneStop's own service now tries its
  runtimes in a fixed order - Ollama, Groq, Google, OpenRouter - and moves to the next one whenever
  a runtime is missing, rate-limited or failing; a runtime that is out of credits is pushed to the
  back for a minute as before. Picking your own provider now means _that provider only_: no silent
  fallback onto another of your keys. The random order made every request land somewhere different
  and made "why is it always OpenRouter?" impossible to answer.
- **Open (2026-09-22):** "Replace the buttons" is now read as: the home box is a message to the
  assistant. Enter (or "Ask OneStop AI") sends it straight to the AI Assistant, which starts
  planning immediately rather than leaving a draft in the composer; "Search tools" underneath still
  searches the catalogue.
- _(none open)_. **Resolved (03):** the phase-02 category question, as described in the Decisions Log. Two judgement calls were made the conservative way and are worth a glance: JSON/XML Formatter & Validator are filed under **Excel, CSV & Data** (phase 08 owns them; **resolved (12)** - phase 12 does not repeat them, it adds only the HTML/CSS/JS formatters), and "User-Agent Viewer" (12.20, shows your own browser) is kept as a separate tool from "User-Agent Lookup" (13.6, parses any UA string). **Resolved (02):** the master plan and the feature list are now in the repo as `docs/OneStop_MasterDoc.md` and `docs/OneStop_Features.md`. Phase 02 was checked against them: routes match master §3.1, Home matches §5, nav order matches Features §18 ("§18" in `02-ui-shell.md` means the Features doc, not master §18, which covers hosting). Home category cards now use master §4's 8 categories, with counts taken from the Features list.
- **Open (post-V1 redesign):** should a signed-out visitor ever be blocked from _directly_ opening a tool page (not just from seeing it in the nav)? The current implementation keeps direct guest tool access working everywhere, per master plan §9, and only simplifies the nav/home page for a signed-out visitor. If the owner actually wants tool pages themselves gated behind sign-in, that is a real product decision (and a bigger, riskier change - it touches the rate limiter, history, and every tool page's tests) that needs an explicit yes rather than a redesign-session guess.

---

## Maintenance log

### 2026-09-22 — AI runtimes: fixed model chains, fixed provider order, direct send from Home

Every hosted runtime's default model had been retired by its provider, so `/api/assistant/status`
said "available" (the key checks still passed) while every actual completion failed. That is why
the assistant appeared broken while the Settings page looked healthy.

- **Model fallback chains.** `AiProviderInfo` gained `fallbackModels`, and `chat()` now walks a
  provider's whole chain before moving to the next provider. A retired (`404`/`400` "no such
  model", now its own `AI_MODEL` code), overloaded or model-level rate-limited model hands over to
  the next model of the same provider; a rejected key or an unreachable host still moves the whole
  provider on. Current defaults: Groq `openai/gpt-oss-120b`, Google `gemini-3.5-flash`, OpenRouter
  `z-ai/glm-5.2:free`. Setting `GROQ_MODEL`/`OPENROUTER_MODEL`/`GOOGLE_AI_MODEL`/`OLLAMA_MODEL`
  still pins one model and deliberately disables the chain.
- **Ollama uses what is pulled.** The liveness probe already lists the machine's models; `chat()`
  now picks the best of ours that is actually pulled, or whatever is pulled if none of ours is, and
  the Settings check reports that model instead of complaining about a name.
- **Fixed provider order** (see Open Questions) and **own-provider means only that provider**.
- **Home box sends.** `?q=` on `/assistant` is now sent as a real message instead of pre-filling the
  composer, and the query string is dropped so a refresh does not repeat it.
- **Settings:** a show/hide (eye) control on the API key field.

Verified live against Groq, Google and OpenRouter with real keys, and against a local Ollama, in
both hosted and own-provider modes.

### 2026-09-22 — Assistant can list/count OneStop's own tools

"Can you list me all the pdf tools?" used to fall through to `unsupported` (the model, when asked,
correctly said no *tool* does that — it's an informational request, not a job to run — so the
assistant answered with the external-recommendations panel instead of just answering from its own
registry).

- New `catalogue` `AssistantIntentKind`. Detected entirely by rules (`CATALOGUE_RE` in
  `apps/api/src/ai/intent.ts`) — "list/show/what/which ... tools", "how many ... tools", "all the
  tools" — with an explicit action verb (`compress`, `convert`, …) always winning first, so a real
  tool-chain request that happens to say "tool" is never hijacked.
- `apps/api/src/ai/catalogue.ts` builds the answer straight from `@onestop/tool-registry`'s
  `GROUPS`/`toolsForCatalogPage`/`toolHref` — no model call, so it's instant, free and fully
  offline, same as the registry itself (CLAUDE.md §2). A keyword match narrows to one catalogue
  group (pdf/documents/data/images/media/qr/ai/utilities); no match lists all 8 with counts.
- `AssistantPlan` gained a `catalogue: ToolCatalogueAnswer | null` field; the web app renders it
  with the new `ToolCatalogue` component — each tool and each group is a real `next/link` straight
  to its page, never a made-up name.

## Next Up

**All 20 phases are complete.** `docs/build/` is finished; there is no next phase file.

What a first real feature addition should look at, in the order it would pay off:

1. ~~**Progress reporting for long jobs.**~~ **Done** in the fourth owner pass above: a polled
   progress store gives every tool run, workflow and batch a real percentage, with genuine
   FFmpeg-level sub-progress for the video/audio tools that go through `encodeVideo`/`encodeAudio`.
   Left for later, not a defect: the handful of media tools that call `runFfmpeg` directly (trim,
   merge, normalize, subtitles, waveform, extract-audio/frames, video-to-gif) only get the coarser
   stage-based percentage, and workflow/batch runs don't compose a step's own FFmpeg sub-progress
   into the overall bar. The AI Assistant's execution UI wasn't wired to this store either.
2. **AI-tool quality, now that there is a real runtime to test against.** `ai/live.test.ts` is the
   opening: phase 16's tools were all written against mocks, and a live suite is what turns
   "the prompt looks right" into "the output is right". The summarizer and the assistant's planner
   are the two worth measuring first. One live round trip per hosted provider is still owed.
3. **More external-recommendation entries** (phase 16). Cheap, useful, and the honest answer for
   the handful of jobs OneStop should not try to do itself.
4. **A second, less obvious candidate:** the built-in image model paths (background removal, object
   removal, upscaling) are conventional filters until someone configures a local image model. With
   Ollama now proven to work here, wiring a local image runtime is a contained piece of work with a
   visible result.

Nothing in the list is a defect. Everything in `docs/build/` that was specified was built, and the
§26/§27 checklist above is signed off item by item.
