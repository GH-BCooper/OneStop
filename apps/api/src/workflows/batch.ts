// Batch processing (15-workflows.md): run one workflow — or one tool, which is a one-step
// workflow — across N input files.
//
// The contract that matters is isolation: one bad file reports its own specific failure and the
// other N-1 still finish. Nothing here aborts the batch.
import type { BatchFileResult, BatchProgress, BatchRunResult, WorkflowStep } from "@onestop/types";
import { sanitizeFileName } from "../file-processing/validate.ts";
import type { PipelineFileInput } from "../file-processing/pipeline.ts";
import { runWorkflow, type WorkflowRunDeps } from "./run.ts";

/** Bounded on purpose: each worker holds a file's bytes and may spawn FFmpeg or Tesseract. */
export const MAX_BATCH_CONCURRENCY = 4;
export const DEFAULT_BATCH_CONCURRENCY = 2;

export interface BatchRunInput {
  steps: WorkflowStep[];
  /** One entry per input file; each is run through the whole chain on its own. */
  files: PipelineFileInput[];
  workflowId?: string | null;
  name?: string;
  userId?: string | null;
  /** 1 = strictly sequential. Clamped to `MAX_BATCH_CONCURRENCY`. */
  concurrency?: number;
}

export interface BatchRunDeps extends WorkflowRunDeps {
  onFileProgress?: (progress: BatchProgress) => void;
}

export function clampConcurrency(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return DEFAULT_BATCH_CONCURRENCY;
  return Math.min(MAX_BATCH_CONCURRENCY, Math.max(1, Math.floor(value)));
}

/** Runs one chain over one file, catching anything the engine did not. */
async function runOne(
  file: PipelineFileInput,
  input: BatchRunInput,
  deps: BatchRunDeps,
): Promise<BatchFileResult> {
  const startedAt = Date.now();
  const name = sanitizeFileName(file.name);
  try {
    const result = await runWorkflow(
      {
        steps: input.steps,
        files: [file],
        workflowId: input.workflowId ?? null,
        ...(input.name === undefined ? {} : { name: input.name }),
        userId: input.userId ?? null,
      },
      deps,
    );
    return {
      name,
      ok: result.ok,
      files: result.files,
      steps: result.steps,
      error: result.error,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    // The engine is written not to throw; if it ever does, that is this one file's problem only.
    console.error(`[batch] unexpected failure on ${name}`, err);
    return {
      name,
      ok: false,
      files: [],
      steps: [],
      error: "This file could not be processed. Please try again.",
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Runs the chain once per file, with at most `concurrency` files in flight. Results come back in
 * the order the files were given, whatever order they actually finished in.
 */
export async function runBatch(
  input: BatchRunInput,
  deps: BatchRunDeps = {},
): Promise<BatchRunResult> {
  const startedAt = Date.now();
  const { onFileProgress, ...runDeps } = deps;
  const files = input.files;
  const results: BatchFileResult[] = new Array<BatchFileResult>(files.length);
  const limit = clampConcurrency(input.concurrency);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const file = files[index];
      if (!file) return;
      onFileProgress?.({
        fileIndex: index,
        fileCount: files.length,
        name: sanitizeFileName(file.name),
        status: "running",
      });
      const result = await runOne(file, input, runDeps);
      results[index] = result;
      onFileProgress?.({
        fileIndex: index,
        fileCount: files.length,
        name: result.name,
        status: result.ok ? "success" : "failed",
      });
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, files.length) }, () => worker()));

  const finished = results.filter((r): r is BatchFileResult => r !== undefined);
  return {
    total: finished.length,
    succeeded: finished.filter((r) => r.ok).length,
    failed: finished.filter((r) => !r.ok).length,
    results: finished,
    durationMs: Date.now() - startedAt,
  };
}
