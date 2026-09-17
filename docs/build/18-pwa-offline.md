# Phase 18 — PWA & Real Offline/Online UX

## Objective
Turn the app into an installable PWA and replace every "static/placeholder" offline indicator from earlier phases with real, registry-driven offline capability detection.

## Depends On
02-ui-shell.md through 17-online-media-network-tools.md (needs the full registry and every tool's real `offline` flag to be accurate)

## Scope — In
- `manifest.json` + icon set for installability.
- Service worker (Workbox recommended) caching the app shell and offline-capable tool assets so the app itself loads even with no connection.
- Real offline/online detection: `navigator.onLine` plus an actual connectivity check (e.g. a lightweight ping), driving the Home page indicator and the `/status` page.
- `/status` page: lists every tool category with its aggregate offline capability, sourced live from the registry's `offline` flags (built in phase 03, made accurate tool-by-tool in phases 05–17).
- Verify camera-based QR scanning (phase 11) still works correctly when the app is running installed/standalone.
- Every online-only tool, when offline, shows the exact blocked-state UX from master plan §22 instead of erroring.

## Scope — Out
- No native mobile wrapper/app — explicitly deferred per master plan §19 ("only after the web application is stable").

## Modules / Files
`apps/web/public/manifest.json`, `apps/web/public/icons/*`, `apps/web/service-worker.ts` (or Workbox config), `apps/web/app/status/page.tsx`, `apps/web/lib/connectivity.ts`.

## Acceptance Criteria
- [ ] App passes a basic Lighthouse PWA installability audit.
- [ ] With the network simulated offline (e.g. via browser devtools), the app shell still loads, and every tool whose registry entry says `offline: true` still works correctly.
- [ ] Every tool whose registry entry says `offline: false` shows the correct blocked message when offline, rather than hanging or crashing.
- [ ] `/status` accurately reflects real per-category offline capability, not the phase-02 placeholder.
- [ ] QR scanning via camera works in installed/standalone PWA mode, not just in a regular browser tab.

## Test Cases
- Lighthouse PWA audit run and passing score documented.
- Offline-mode E2E test: toggle network off, run one offline tool (should succeed) and one online-only tool (should show the blocked message), confirm the rest of the UI stays responsive throughout.
- `/status` test: cross-check its output against the actual registry `offline` flags for a sample of tools across different categories.

## Notes
This phase is a good forcing function to catch any tool from phases 05–17 that was marked `offline: true` in the registry but doesn't actually work offline — treat any such mismatch as a bug to fix now, and log it in PROGRESS.md if you have to defer the fix.
