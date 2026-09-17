# Phase 13 — Auth & Database

## Objective
Stand up real PostgreSQL persistence (master plan §16 data model) and real authentication (email/password + Google OAuth + password reset, per §9), replacing the in-memory Job store from phase 04 with durable storage.

## Depends On
01-foundation.md through 04-file-core.md

## Scope — In
- Prisma schema for `User`, `Job`, `Workflow` (table only — logic in phase 15), `UserSettings`, matching master plan §16 exactly (no raw file binaries in Postgres).
- Auth.js (NextAuth) with a Credentials provider (email/password, hashed via argon2 or bcrypt — never plaintext, never reversible encryption) and a Google OAuth provider.
- Password reset flow: token-based, emailed to the user. Use a free-tier transactional email option (e.g. Resend free tier) or, for pure local/dev use, log the reset link to the console/dev UI instead of requiring an email provider — document both paths and let the user pick via env config.
- Wire `/auth/login`, `/auth/signup`, `/auth/reset-password`, and `/account` (basic profile) to real backend calls.
- Session handling and basic route protection for pages that need a signed-in user (history sync, saved workflows, etc. — enforced fully starting phase 14).
- Migrate the phase 04 in-memory Job store to Postgres via Prisma, keeping the same `Job` interface so calling code doesn't change.

## Scope — Out
- No role/permission system beyond "signed in or not" (master plan explicitly avoids complex authorization).
- No billing/subscription logic.

## Modules / Files
`packages/types/db.ts` (Prisma-generated types re-exported), `prisma/schema.prisma`, `apps/api/auth/*`, `apps/web/app/auth/**` wired to real forms, `apps/web/app/account/page.tsx`.

## Interfaces
Use the exact fields from master plan §16 for `User`, `Job`, `Workflow`, `UserSettings` — do not add fields not needed yet; extend later if a real need appears.

## Acceptance Criteria
- [ ] Sign up with email/password creates a `User` row with a securely hashed password (verify it's not plaintext or trivially reversible by inspecting the DB directly).
- [ ] Login works with correct credentials, fails with a clear message for incorrect ones.
- [ ] Google OAuth completes a full sign-in round trip.
- [ ] Password reset: request → token emailed or logged → reset with token → old password no longer works.
- [ ] Guest (unauthenticated) users can still use all public tools — auth is never required to use a tool, only to persist history/workflows across sessions (per master plan §9).
- [ ] Job creation now persists across a server restart.

## Test Cases
- Signup/login/logout integration test.
- Password hashing test: confirm the stored value is a hash, not the raw password.
- Reset-token expiry test: an expired token is rejected.
- Guest-access test: an unauthenticated request to a public tool still succeeds.
- Migration test: create a job, restart the dev server (or equivalent), confirm the job is still retrievable.

## Notes
Log your final choices in PROGRESS.md: which free Postgres host you're targeting (Supabase/Neon/Railway/local), and which email path (real provider vs. dev-console-log) you implemented, and whether both are supported via env config.
