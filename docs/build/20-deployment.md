# Phase 20 — Deployment & Final Documentation

## Objective
Finalize local development docs, document a genuinely free hosted deployment path, and produce the launch-ready README matching the Final Product Definition in master plan §27.

## Depends On
All phases 01–19

## Scope — In
- **Local dev docs:** completed `.env.example`, `docker compose up` instructions for optional local Postgres, `npm run dev`, and clear install instructions for every local binary dependency accumulated across phases (FFmpeg — required; LibreOffice, Tesseract, Ollama — required or optional per what earlier phases decided, documented accurately per PROGRESS.md's Decisions Log).
- **Free-tier hosted deployment guide:** a concrete, tested path using only free tiers — e.g. Vercel or Netlify for `apps/web`, Render/Railway/Fly.io free tier for `apps/api` (if split out), Supabase or Neon free Postgres. Explicitly note that free-tier quotas and provider policies can change over time, and that the app's config is env-driven specifically so it's portable to a different free provider without code changes.
- **Ollama setup instructions** for users who want local AI, including a note on minimum practical hardware (from what was logged in phase 16).
- **Final QA checklist** mirroring master plan §26/§27: confirm every "Keep" item is present and every "Avoid" item was in fact avoided (no microservices, no billing, no mandatory paid APIs, no permanent large-file storage, no complex workflow branching, no separate native mobile codebase yet).
- Finalize `README.md` end to end: what OneStop is, quick start (local), hosted deployment, feature list, architecture diagram (can reuse the ASCII diagram from master plan §26), contribution/build-doc pointer to `CLAUDE.md` and `docs/build/`.

## Scope — Out
- No CI/CD pipeline complexity beyond an optional, simple GitHub Actions workflow running `npm run verify` — not required, but fine if trivial to add.
- No multi-region infrastructure, no paid tiers, no native mobile app.

## Modules / Files
`README.md` (final), `docs/DEPLOYMENT.md`, `docs/LOCAL_SETUP.md`.

## Acceptance Criteria
- [ ] A fresh clone, following only the README, gets a working local instance running within a reasonable amount of time.
- [ ] A hosted deployment following `docs/DEPLOYMENT.md`, using only free-tier services, is reachable over HTTPS and fully functional (with AI features running on Ollama if the host supports it, or clearly documented as unavailable on a given free host if it doesn't have the resources — never silently broken).
- [ ] The §26/§27 final QA checklist is fully checked off, with any deliberate deviation logged in PROGRESS.md.
- [ ] `CLAUDE.md` and `PROGRESS.md` are referenced from the README so any future contributor (human or Claude Code) knows where to start.

## Test Cases
- Manual/documented run-through: fresh machine (or fresh Docker container) → follow README exactly → app runs.
- Manual/documented run-through: follow `docs/DEPLOYMENT.md` exactly on the chosen free hosts → app is reachable and functional online.

## Notes
This is the last phase. Once complete, update PROGRESS.md's phase table to reflect all 20 phases as Complete (or Complete (see notes) with honest caveats), and leave a closing summary under "Next Up" describing what a first real feature addition after launch should probably look at first (likely: expanding AI-tool quality, or adding more external-recommendation entries).
