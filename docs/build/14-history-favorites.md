# Phase 14 — History, Favorites & Settings Sync

## Objective
Build the real `/history` page, favorites/recently-used tools, and cross-device settings sync for signed-in users — while keeping guest/local history fully functional via IndexedDB.

## Depends On
13-auth-database.md

## Scope — In
- `/history` page: paginated list of past jobs, filterable by tool/category/date/status, with re-download/re-run affordances.
- Favorite tools (toggle per tool, persisted per user) and "recently used" (auto-tracked from job history) — both feed back into the Home page and All Tools sort/popularity features built as placeholders in phase 02/03.
- `UserSettings` (theme, preferred AI mode, other small prefs) now persists to Postgres for signed-in users; guests keep using `localStorage`/IndexedDB from phase 02, with a "sign in to sync your settings across devices" prompt.
- Migrate the interim local-storage-backed Dynamic QR/Analytics data from phase 11 to real Postgres-backed storage for signed-in users (guests keep local-only dynamic QR, clearly labeled as device-local).
- Guest local history stored in IndexedDB, with a "sign in to save your history" prompt, and a one-time import path if a guest signs up (merge local history into their new account — optional nice-to-have, not required).

## Scope — Out
- No cross-user sharing/collaboration features.

## Modules / Files
`apps/web/app/history/page.tsx`, `apps/api/history/*`, `apps/api/favorites/*`, `apps/web/lib/localHistory.ts` (IndexedDB wrapper for guests).

## Acceptance Criteria
- [ ] Signed-in user's job history persists and is visible on `/history`, paginated, filterable.
- [ ] Guest history works entirely client-side with no account and no network call for the history feature itself.
- [ ] Toggling a favorite persists correctly and appears on the Home page's popular/recent section.
- [ ] Theme/preferences set while signed in are visible after logging in from a different browser/session.
- [ ] Dynamic QR codes created by a signed-in user survive after migrating off the phase-11 local-storage interim store.

## Test Cases
- Integration test: create several jobs as a signed-in user, confirm `/history` lists and filters them correctly.
- Guest test: use a tool without signing in, confirm history appears via IndexedDB and disappears if local storage is cleared (expected guest behavior — document this clearly in the UI).
- Favorites test: toggle on/off, confirm persistence and Home page reflection.
- Settings sync test: change theme while logged in on session A, confirm it appears on session B (same account).

## Notes
This phase is a good checkpoint to confirm the whole registry's "popularity" and "recent" sort options (built as stubs in phase 03) now reflect real usage data.
