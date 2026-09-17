# Phase 02 — UI Shell

## Objective
Build the app shell: global layout, primary navigation, theme system, responsive design, the Home page (per master plan §5), and empty stub pages for every route in §3.1.

## Depends On
01-foundation.md

## Scope — In
- Route stubs (can render placeholder content) for: `/`, `/assistant`, `/tools`, `/tools/[category]`, `/tools/[category]/[slug]`, `/workflows`, `/workflows/new`, `/workflows/[id]`, `/history`, `/account`, `/settings`, `/auth/login`, `/auth/signup`, `/auth/reset-password`, `/status`.
- Shared layout: header/nav (Home → AI Assistant → All Tools → Workflows → History → Account, per §18 of the master plan), responsive at mobile/tablet/desktop breakpoints.
- Dark/light theme with a toggle, persisted in `localStorage`, applied via CSS variables (design tokens in `packages/ui`).
- Home page per §5: large "What do you want to do?" search box, primary "Ask OneStop AI" button (routes to `/assistant`), category cards (static placeholder list of the 8 categories from §4 is fine — wired to the real registry in phase 03), popular/recent tools placeholder, recent jobs placeholder for signed-in users (static/mock for now), a small offline/online indicator (can be a static "Online" badge for now — real logic lands in phase 18).
- Base components in `packages/ui`: Button, Card, Input, Modal, Badge, Tabs.

## Scope — Out
- No real tool registry integration (category names/counts can be hardcoded).
- No auth logic — `/auth/*` pages just need working forms with client-side validation, no backend calls yet.
- No PWA manifest/service worker (phase 18).

## Modules / Files
`apps/web/app/**` route folders as listed above; `apps/web/components/layout/*` (Header, Nav, ThemeToggle, Footer); `packages/ui/*` base components; `packages/ui/tokens.ts` (color/spacing/typography tokens for both themes).

## Interfaces
```ts
type ThemeMode = "light" | "dark";
interface NavItem { label: string; href: string; icon?: string; }
```

## Acceptance Criteria
- [ ] Every route in §3.1 renders without a runtime error.
- [ ] Nav highlights the active route.
- [ ] Theme toggle switches instantly and persists across a page reload.
- [ ] Layout is usable (no horizontal scroll, no overlapping elements) at 375px, 768px, and 1440px widths.
- [ ] Home page shows all six elements listed in §5 of the master plan.
- [ ] "Ask OneStop AI" button navigates to `/assistant`.

## Test Cases
- Route smoke test: each route in the table returns a 200 / renders without throwing.
- Snapshot test for the nav component in both themes.
- Basic accessibility pass: every interactive element has an accessible name/label; images (if any placeholder icons) have alt text.
- Resize test at the three breakpoints above (visual or via testing-library viewport mocking).

## Notes
Keep all data here static/mocked. Phase 03 will replace the mocks with real registry data — don't over-invest in mock data structures that will just be thrown away; a plain array of `{name, count}` per category is enough.
