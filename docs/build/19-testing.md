# Phase 19 — Testing Hardening

## Objective
Close every testing gap across the whole app per master plan §23, and enforce the rule that no tool is marked `offline: true` in the registry without a passing offline test proving it.

## Depends On
Every phase 01–18 (this phase audits the entire codebase built so far)

## Scope — In
- Audit unit test coverage for every processor/utility module built in phases 05–17; fill obvious gaps.
- Integration tests for every API endpoint that doesn't already have one.
- **Tool-Contract test suite:** for every entry in the tool registry, assert it maps to a real, non-stub executor. This test should have been *failing* for not-yet-built tools throughout earlier phases — by the end of this phase it must be fully green, meaning every one of the ~230 tools from the Feature & Tool List has a working implementation, not a stub.
- **Offline-flag enforcement:** for every registry entry with `offline: true`, there must be a corresponding automated test that runs that tool with network access disabled and asserts success. Add a CI-style check that fails the build if a tool is flagged offline but has no such test.
- Workflow tests: the four §8 example workflows, plus at least 2 more of your own combining tools across different categories.
- Authentication tests: full signup/login/OAuth/reset coverage (should mostly already exist from phase 13 — audit and fill gaps).
- Browser/E2E tests (Playwright recommended) for the top user journeys: upload+convert a PDF, run a saved workflow, sign up and log in, install the app as a PWA, use the AI Assistant for a multi-tool request (the §7.1 example).

## Scope — Out
- No new features — this phase is pure hardening. If you find a genuine functional gap (not just a missing test), log it in PROGRESS.md's "Known Issues" and fix it if small, or flag it for the user's attention if not.

## Modules / Files
`tests/contract/tool-registry.test.ts`, `tests/offline/*`, `tests/e2e/*` (Playwright), plus filled-in unit/integration tests throughout `apps/api/**` and `apps/web/**`.

## Acceptance Criteria
- [ ] `npm run verify` (lint + typecheck + unit + integration + contract tests) passes clean.
- [ ] Tool-Contract test is 100% green — every registry entry has a real executor.
- [ ] Every `offline: true` registry entry has a passing dedicated offline test; any tool that can't actually prove this gets its flag corrected to `false` (or `requiresLocalModel`/whatever flag fits) rather than left inaccurate.
- [ ] E2E suite covers all five journeys listed above and passes.
- [ ] PROGRESS.md lists, with reasons, any tool still marked experimental or with reduced quality (e.g. the phase 07 fallback translator if phase 16's upgrade wasn't fully wired into every call site).

## Test Cases
This phase's "test cases" are the tests themselves — treat the Acceptance Criteria above as the checklist for what must exist and pass.

## Notes
This is the phase most likely to surface uncomfortable truths (a tool everyone assumed worked but doesn't, a flag that's wrong). Don't paper over a failing contract test by loosening it — fix the underlying tool or honestly downgrade its registry flags and document why.
