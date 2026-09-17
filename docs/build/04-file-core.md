# Phase 04 — File Core (Upload, Validation, Jobs, Pipeline)

## Objective
Implement the File Processing Pipeline from master plan §14: upload/validation, temp file lifecycle with auto-delete, the Job model, and a working end-to-end pipeline — proven with one real (not stub) tool.

## Depends On
01-foundation.md, 02-ui-shell.md, 03-tool-registry.md

## Scope — In
- Upload/drop-zone component wired into the generic tool page from phase 03.
- File validation: MIME type, extension, and size limits (configurable per tool via registry `inputTypes`), sanitized filenames/paths (reject path traversal attempts, e.g. `../../etc/passwd`).
- Temp storage with a retention timer that deletes files after a short, configurable window (default suggestion: 30–60 minutes) — deletion must happen even if the job fails or the user abandons the tab.
- In-memory Job store for now (`Job` type per master plan §16), designed behind an interface so phase 13 can swap in Postgres without touching callers.
- The pipeline itself: select/upload → validate → create job → detect execution mode (local vs remote, from registry) → process → validate output → show result → optional download → delete temp data.
- One real executor (pick a simple offline tool, e.g. a basic image resize or a no-op file passthrough) wired fully end-to-end through this pipeline as proof.

## Scope — Out
- No cloud/object storage (explicitly opt-in later, not in initial scope per master plan §26).
- No batch processing (phase 15).
- No persistence across server restarts (that's what phase 13 is for).

## Modules / Files
`apps/api/file-processing/{validate.ts, tempStore.ts, job.ts, pipeline.ts}`; `apps/web/components/tools/UploadZone.tsx`.

## Interfaces
```ts
type JobStatus = "pending" | "validating" | "processing" | "success" | "failed";
interface Job {
  id: string;
  userId: string | null;   // null = guest/local job
  toolId: string;
  status: JobStatus;
  inputMetadata: Record<string, unknown>;
  outputMetadata: Record<string, unknown> | null;
  createdAt: string;
}
interface FileValidationResult { valid: boolean; reason?: string; }
```

## Acceptance Criteria
- [ ] Uploading a file that's the wrong type shows the exact-style message from §22: "This file type is not supported."
- [ ] Uploading an oversized file shows: "The file is too large for local processing. Try a smaller file."
- [ ] A filename containing path traversal characters is rejected/sanitized before touching the filesystem.
- [ ] Temp files are actually gone from disk after the retention window, including after a failed job.
- [ ] The one real end-to-end tool works fully through the UI: upload → process → download result.

## Test Cases
- Unit: reject bad MIME, reject oversized file, reject/sanitize a malicious filename.
- Integration: happy path (valid file → success → downloadable result) and failure path (processing throws → job marked failed → temp file still cleaned up) for the demo tool.
- Timing test: confirm temp file removal actually fires after the configured retention window (can shorten the window in test config).

## Notes
Reiterate master plan §15 here: never execute an uploaded file, always sanitize paths, keep secrets in env vars. This phase is where those rules get enforced in code for the first time — get it right here since every tool phase after this reuses this pipeline.
