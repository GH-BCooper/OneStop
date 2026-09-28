# OneStop — Version Two

Log of the post-V1 upgrade passes on branch `newVersion`. Newest first. Every entry keeps the
same promise as `CLAUDE.md`: **$0 mandatory cost**, local-first by default, no unregistered tool,
no Claude/Anthropic dependency anywhere in the app.

---

## Pass 6 — Automations, real notifications (2026-09-28)

Scope for this session, as directed: focus on automations. Full detail lives in
`docs/PROGRESS.md`; this is the short version.

### What shipped

- **Scheduled workflow automations.** A saved (account) workflow can be set to run on its own —
  hourly, daily, or weekly at a chosen time. New `WorkflowSchedule` table, CRUD API
  (`/api/automations/schedules`), and an "Automate" panel on a workflow's own page
  (`AutomatePanel.tsx`).
- **Real notifications.** A bell in the header (signed-in only) shows what an automation actually
  did — ran, or failed and why — with unread counts and mark-as-read. New `Notification` table,
  `/api/notifications`. Not decorative: nothing writes a notification except a real automation
  event, on purpose (a bell with nothing behind it was explicitly rejected in an earlier pass).
- **The scheduler itself.** An in-process timer (`apps/api/src/automation/scheduler.ts`), ticking
  every 60s — no cron package, no external cron SaaS, no new paid or free-tier-metered service.
  Zero new dependencies. On a serverless host with no persistent process to tick on, a due
  automation instead runs opportunistically the next time any signed-in user's browser hits
  `/api/notifications` — degraded timing, not degraded correctness. Documented in
  `docs/DEPLOYMENT.md`.
- **AI Assistant can build automations.** New agent action `schedule_workflow` — ask it to
  "automate my password generator to run every morning" and it wires up the schedule through the
  same API, validated the same way, subject to the same eligibility rule.

### The one real limitation, and why

An automation only accepts a **one-step workflow whose tool needs no file or typed input** (a
generator: Password Generator, UUID Generator, etc.). Reason: nobody is present when it fires to
supply a file, and the shared chain validator (`packages/tool-registry/src/workflows.ts`,
deliberately, and covered by an existing test) always requires a *multi-step* workflow's first
tool to accept a file — that rule belongs to the interactive builder and isn't safe to weaken for
this feature. Rather than loosen a tested, load-bearing rule, the scheduler runs a single step
directly through the pipeline, bypassing workflow-chain validation entirely, and `createSchedule`
enforces the one-step/no-input shape up front so nobody can build an automation that could never
succeed. A file-input automation (e.g. "watch a folder and compress every PDF that lands in it")
is a natural next step — candidate for the next pass, most likely as a client-side, fully local
feature using the File System Access API rather than anything server-side (see Backlog).

### Free-of-cost check

No new npm dependency. No new external service, paid or otherwise. The scheduler is a
`setInterval` in the existing Node process; notifications and schedules are two small Postgres
tables on the same free-tier database every other feature already uses.

### Tests

`apps/api/src/automation/automation.test.ts` — 15 tests: pure cadence-math and input-validation
tests (always run), plus database-backed CRUD, eligibility rejection, a real end-to-end scheduled
run (asserts the notification it produces), and notification mark-read/mark-all-read (skip
themselves with no Postgres configured, like every other DB suite in this repo). Full repo
`lint`/`typecheck`/existing suites re-verified green after the change.

### Backlog (not built this session — logged per `CLAUDE.md` §9, not silently dropped)

- **Watched-folder automation.** Let a signed-in *or guest* user point at a local folder (File
  System Access API — Chromium-only, free, fully client-side, no server involvement) and
  auto-run a workflow on new files. Would cover the file-based case the scheduler above cannot.
- **Multi-step scheduled workflows.** Needs its own input, not zero input — e.g. "always run
  against the last file this chain produced" or a stored default input — deliberately left out
  rather than guessed at.
- A dedicated `/automations` page listing every schedule in one place (today: one per workflow's
  own page). Straightforward, just not done yet.
- Native OS/browser push notifications (Web Notifications API) alongside the in-app bell.

---

*(Earlier passes — theme, auth hardening, progress bars, the agentic assistant, the all-tools
sweep — are already recorded in `docs/PROGRESS.md`, which remains the authoritative phase-by-phase
log per `CLAUDE.md` §5. This file exists specifically so "what's new in v2" doesn't require reading
that whole history.)*
