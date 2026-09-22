// An in-memory progress store for long-running runs (tool jobs, workflows, batches).
//
// The pipeline stays a single synchronous request/response (04-file-core.md) — no job queue, no
// polling architecture change. Instead, the browser hands the run a random `progressToken` up
// front and polls `GET /api/progress/:token` on the side while the original POST is still in
// flight; the pipeline/workflow engine write their stage updates in here as they happen. Purely
// additive: nothing reads this store to decide anything, so a caller that never polls loses
// nothing.
export interface ProgressState {
  percent: number;
  label: string;
  done: boolean;
  updatedAt: number;
}

/** Entries older than this are swept, in case a caller never downloads its result. */
const TTL_MS = 10 * 60_000;

const store = new Map<string, ProgressState>();

function sweep(now: number): void {
  for (const [token, state] of store) {
    if (now - state.updatedAt > TTL_MS) store.delete(token);
  }
}

export function setProgress(token: string | null | undefined, percent: number, label: string): void {
  if (!token) return;
  store.set(token, {
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    label,
    done: false,
    updatedAt: Date.now(),
  });
  sweep(Date.now());
}

/** Marks a run finished. `ok` decides whether the bar completes to 100% or freezes where it was. */
export function endProgress(token: string | null | undefined, ok: boolean): void {
  if (!token) return;
  const prev = store.get(token);
  store.set(token, {
    percent: ok ? 100 : (prev?.percent ?? 0),
    label: prev?.label ?? "Done",
    done: true,
    updatedAt: Date.now(),
  });
}

export function getProgress(token: string): ProgressState | undefined {
  return store.get(token);
}

/** Test seam: drops all tracked progress. */
export function clearAllProgress(): void {
  store.clear();
}
