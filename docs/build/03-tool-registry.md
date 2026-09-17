# Phase 03 — Tool Registry & Generic Tool Framework

## Objective
Build the single source of truth for every tool in the app (master plan §13), the generic tool-page framework (§20's UX pattern), and wire the All Tools / category pages (§6) and Home page's category cards to real registry data.

## Depends On
01-foundation.md, 02-ui-shell.md

## Scope — In
- `packages/tool-registry` with a typed schema and one entry per tool named anywhere in the Feature & Tool List document (all ~230 tools across every category) — **as stubs is fine here**; the executor logic itself is added in phases 05–17. The point of this phase is that every tool has a real id, route, category, and metadata entry, with zero gaps.
- A loader that validates the registry at build/start time (no duplicate ids/slugs, all required fields present).
- A search/filter/sort module: search by natural text, name, keyword; filter by category/subcategory and by `offline`/`online`/`ai`/`file` tags; sort by name/popularity/recent.
- `/tools` page (search + filters + sort, per §6), `/tools/[category]` pages, and `/tools/[category]/[slug]` generic tool page implementing the UX state machine from §20: empty → selected → validating → processing → success → failed → offline/unavailable → unsupported input.
- A stub `Executor` interface and a working "echo/identity" executor wired to one real tool end-to-end, to prove the plumbing before phases 05+ add real logic.
- Home page category cards and popular/recent tools now read from the registry (recent/popularity can be a static counter until phase 14 wires real history).

## Scope — Out
- No real file processing (all non-demo executors remain stubs that show a clear "not yet implemented" state — never silently no-op as if it worked).
- No AI-based/semantic search — keyword matching only for now.

## Modules / Files
`packages/tool-registry/{schema.ts, entries/*.ts (one file per category), loader.ts, search.ts}`; `apps/web/app/tools/**`; `apps/web/components/tools/{ToolCard, ToolPage, ToolStateMachine}`.

## Interfaces
```ts
interface ToolMeta {
  id: string;            // e.g. "pdf-to-word"
  slug: string;           // route segment
  name: string;
  category: "pdf" | "documents" | "data" | "images" | "audio" | "video"
          | "online-media" | "qr" | "ai" | "dev-utility" | "network" | "file-utility";
  inputTypes: string[];
  outputTypes: string[];
  execution: "local" | "remote";
  offline: boolean;       // must not be true until an offline test passes (enforced in phase 19)
  supportsBatch: boolean;
  requiresAuth: boolean;
  keywords: string[];
  description: string;
}
type Executor = (input: FileRef | unknown, options: Record<string, unknown>) => Promise<ExecResult>;
```

## Acceptance Criteria
- [ ] Every tool named in the Feature & Tool List document has exactly one registry entry, one route, and appears on its category page.
- [ ] Registry loader fails loudly (build error) on duplicate ids/slugs or missing required fields.
- [ ] `/tools` search returns correct results for the §21 examples: "make a pdf from images" → Image to PDF; "remove background" → Background Removal; "compress my video" → Video Compression; "convert csv to json" → CSV to JSON.
- [ ] Generic tool page renders all 8 states from §20 (can be triggered via the stub executor for testing).
- [ ] Every tool not yet implemented clearly shows "Coming in a later phase" rather than a broken or fake-success state.

## Test Cases
- Registry contract test: loop over every registry entry, assert route exists and category page includes it.
- Search relevance unit tests for the four §21 examples above, plus 3–4 more of your own.
- State machine test: simulate each of the 8 states and assert correct UI for each.

## Notes
This phase is the most important one to get exhaustively complete — every later "add tool X" phase is just filling in the `Executor` for an id that must already exist here. If you find a tool in the Feature doc you're unsure how to categorize, log it under "Open Questions" in PROGRESS.md rather than guessing silently.
