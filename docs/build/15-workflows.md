# Phase 15 — Workflows

## Objective
Build the Workflow system: a reusable, ordered chain of OneStop tools with typed input/output validation, a run engine that reuses the phase 04 file pipeline per step, and batch processing across multiple files.

## Depends On
03-tool-registry.md through 14-history-favorites.md (workflows need real tools to chain and real persistence to save)

## Scope — In
- `Workflow` data model (per master plan §16: id, userId, name, description, steps, timestamps) — schema table already exists from phase 13; this phase adds the real logic.
- `/workflows` (list), `/workflows/new` (builder), `/workflows/[id]` (edit/run) pages.
- Workflow builder: ordered list of steps, each referencing a registry tool id + its options; validate that each step's output type is compatible with the next step's input type (reject incompatible chains at build time with a clear message, not at run time).
- Run engine: executes each step via the existing pipeline from phase 04, passing validated output forward, with per-step and overall progress reporting.
- Batch processing: run one workflow (or a single tool) across N input files, sequentially or with bounded concurrency, with per-file progress and a per-file success/fail result at the end.
- Implement the four example workflows from master plan §8 as either seed templates or verified test cases: Images → PDF → Compress; PDF → OCR → Translate → PDF; CSV → Clean → Excel; Image → Remove Background → Resize → WebP.

## Scope — Out (explicit non-goal, per master plan §8/§26)
- No branching or conditional logic in workflows — keep it a straight ordered chain for now. Only revisit this if a genuine, specific need comes up later, and treat that as a new phase, not a silent scope-creep here.

## Modules / Files
`apps/api/workflows/{model.ts, validate.ts, run.ts, batch.ts}`; `apps/web/app/workflows/**`; `apps/web/components/workflows/{WorkflowBuilder.tsx, StepEditor.tsx}`.

## Acceptance Criteria
- [ ] All four example workflows from §8 run end-to-end successfully (the translate step in "PDF → OCR → Translate → PDF" may use the phase 07 non-AI translation fallback if phase 16 isn't done yet — note this dependency explicitly rather than blocking).
- [ ] Building a workflow with an incompatible step chain (e.g. Image tool output feeding directly into an Audio-only tool) is rejected at build time with a specific, useful error.
- [ ] Batch mode correctly processes N files through the same workflow/tool and reports per-file success/failure without one failure aborting the whole batch.
- [ ] Saved workflows persist and can be edited/re-run later.

## Test Cases
- End-to-end test for each of the four §8 example workflows.
- Invalid-chain test: attempt to build a workflow with mismatched step types, confirm rejection with a clear message.
- Batch test: 5 files, 1 deliberately invalid → confirm 4 succeed and 1 reports a specific failure, rather than the whole batch aborting.
- Persistence test: save a workflow, reload the page, confirm it's still there and editable.

## Notes
If the Translate step's quality is limited because phase 16 isn't built yet, log this clearly in PROGRESS.md as a "Known Issue" so it isn't forgotten once phase 16 lands with a better translator.
