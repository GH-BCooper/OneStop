// The automation scheduler (post-V1 automation pass; see /versionTwo.md).
//
// Deliberately the simplest thing that works, matching the pattern `progress/store.ts` already
// set: an in-process tick, no queue, no new dependency (no cron package, no external cron SaaS —
// CLAUDE.md §2.1/§2.3). This needs a persistent Node process (Render/Railway/Fly — see
// docs/DEPLOYMENT.md), not a serverless function host; `kickScheduler` (called from the
// notifications route) is a best-effort second trigger so a schedule still fires eventually even
// if the interval never got to start in a given deployment target.
import { isDatabaseConfigured, requirePrisma, type PrismaClient } from "../db/client.ts";
import { runPipeline, type PipelineDeps } from "../file-processing/pipeline.ts";
import { parseSteps } from "../workflows/model.ts";
import { computeNextRun } from "./schedule.ts";
import { pushNotification } from "./notifications.ts";

const TICK_MS = 60_000;

interface DueRow {
  id: string;
  userId: string;
  cadence: string;
  hour: number;
  minute: number;
  weekday: number | null;
  workflow: { id: string; name: string; steps: unknown };
}

/**
 * Runs every automation whose `nextRunAt` has passed. Exported so a test can call it directly.
 * `runDeps` lets a test point the pipeline at an in-memory job store/temp dir instead of the
 * process-wide Postgres-backed one (whose `Job.userId` foreign key would otherwise point at a
 * different, real database than an isolated test schema's user) — production never passes it.
 *
 * Runs the workflow's one step through `runPipeline` directly rather than through
 * `runWorkflow`/`validateWorkflow` — the shared chain validator always requires a *multi-step*
 * workflow's first tool to accept a file (a deliberate, tested rule of the interactive builder;
 * see `schedule.ts`'s `createSchedule`), which an unattended, input-less generator never can.
 * `createSchedule` already only ever allows a one-step, no-input workflow to be scheduled at all.
 */
export async function runDueSchedules(
  prisma: PrismaClient = requirePrisma(),
  runDeps: PipelineDeps = {},
): Promise<number> {
  const now = new Date();
  const due = (await prisma.workflowSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    include: { workflow: { select: { id: true, name: true, steps: true } } },
  })) as DueRow[];

  for (const row of due) {
    const step = parseSteps(row.workflow.steps)[0];
    let ok: boolean;
    let message: string | null;
    try {
      if (!step) {
        ok = false;
        message = "This workflow no longer has a step to run.";
      } else {
        // The step's own execution timeout (pipeline.ts's DEFAULT_EXECUTION_TIMEOUT_MS) applies
        // exactly as it would for a click on the tool's own page.
        const outcome = await runPipeline(
          { toolId: step.toolId, userId: row.userId, files: [], options: step.options ?? {} },
          runDeps,
        );
        ok = outcome.ok;
        message = outcome.error?.message ?? null;
      }
    } catch (err) {
      console.error(`[automation] schedule ${row.id} failed to run`, err);
      ok = false;
      message = "It could not be run.";
    }

    const next = computeNextRun(
      {
        workflowId: row.workflow.id,
        cadence: row.cadence as never,
        hour: row.hour,
        minute: row.minute,
        weekday: row.weekday,
      },
      now,
    );
    await prisma.workflowSchedule.update({
      where: { id: row.id },
      data: { lastRunAt: now, lastStatus: ok ? "success" : "failed", nextRunAt: next },
    });
    await pushNotification(
      row.userId,
      ok
        ? {
            type: "automation_run",
            title: `"${row.workflow.name}" ran automatically`,
            body: "It completed successfully.",
            link: `/workflows/${row.workflow.id}`,
          }
        : {
            type: "automation_failed",
            title: `"${row.workflow.name}" automation failed`,
            body: message ?? "It could not be completed.",
            link: `/workflows/${row.workflow.id}`,
          },
      prisma,
    );
  }
  return due.length;
}

let started = false;

/** Starts the tick once per server process. Safe to call more than once (e.g. dev hot-reload). */
export function startScheduler(): void {
  const globals = globalThis as { __onestopScheduler?: boolean };
  if (started || globals.__onestopScheduler) return;
  started = true;
  globals.__onestopScheduler = true;
  if (!isDatabaseConfigured()) return; // No database, no accounts, nothing to schedule.
  const tick = () => {
    runDueSchedules().catch((err) => console.error("[automation] scheduler tick failed", err));
  };
  setInterval(tick, TICK_MS).unref?.();
  tick();
}

let lastKick = 0;
/** Best-effort second trigger for hosts where a background interval may not run reliably. */
export function kickScheduler(): void {
  const now = Date.now();
  if (!isDatabaseConfigured() || now - lastKick < TICK_MS) return;
  lastKick = now;
  runDueSchedules().catch((err) => console.error("[automation] scheduler kick failed", err));
}
