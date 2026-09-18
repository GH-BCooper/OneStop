// Turning a stored Job into a history row (14-history-favorites.md).
//
// The pipeline already writes everything `/history` needs onto the job (04-file-core.md):
// `inputMetadata.files` for the row's subtitle and `outputMetadata.files` for the re-download
// links. This module is the one place that knows how to read that metadata back, so the web app
// never has to guess at the shape.
import type { HistoryEntry, HistoryFile, Job, JobStatus } from "@onestop/types";

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Input file names, or a single "text" pseudo-input for the tools that take typed input. */
export function inputNames(job: Job): string[] {
  const meta = job.inputMetadata;
  const files = Array.isArray(meta.files) ? meta.files : [];
  const names = files
    .map((f) => (f && typeof f === "object" ? str((f as { name?: unknown }).name) : null))
    .filter((n): n is string => n !== null);
  if (names.length > 0) return names;
  const textLength = num(meta.textLength);
  return textLength > 0 ? [`${textLength} characters of text`] : [];
}

/** Output files as history shows them. Empty when a run produced only JSON on the page. */
export function outputFiles(job: Job): HistoryFile[] {
  const files = Array.isArray(job.outputMetadata?.files) ? job.outputMetadata.files : [];
  const result: HistoryFile[] = [];
  for (const raw of files) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Record<string, unknown>;
    const id = str(f.id);
    const name = str(f.name);
    if (!id || !name) continue;
    result.push({
      id,
      name,
      mimeType: str(f.mimeType) ?? "application/octet-stream",
      size: num(f.size),
      expiresAt: str(f.expiresAt) ?? new Date(0).toISOString(),
    });
  }
  return result;
}

/** Maps a job onto the row shape `/history` renders. */
export function toHistoryEntry(job: Job): HistoryEntry {
  const failed = job.status === "failed";
  return {
    id: job.id,
    toolId: job.toolId,
    status: job.status as JobStatus,
    createdAt: job.createdAt,
    summary: str(job.outputMetadata?.summary),
    inputs: inputNames(job),
    outputs: outputFiles(job),
    error: failed ? str(job.outputMetadata?.message) : null,
    scope: "account",
  };
}
