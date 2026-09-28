// Recurring workflow automations (post-V1 automation pass; see /versionTwo.md).
//
// A schedule only points at an account workflow — a recurring run has to happen with nobody
// present, so it needs a server-side `Workflow` row, never a device-only one. Cadence is a plain
// enum + hour/minute/weekday rather than a cron string: the UI is a simple picker, and
// `nextRunAt` is computed here in plain JS — no new dependency, no cron-string parsing surface.
import { getTool, inputKind } from "@onestop/tool-registry";
import type { ScheduleCadence, WorkflowSchedule, WorkflowScheduleInput } from "@onestop/types";
import { requirePrisma, type PrismaClient } from "../db/client.ts";
import { parseSteps } from "../workflows/model.ts";

export const CADENCES: ScheduleCadence[] = ["hourly", "daily", "weekly"];
/** Ceiling on how many schedules one account can keep — generous, keeps the scheduler tick cheap. */
export const MAX_SCHEDULES_PER_USER = 50;

export class InvalidScheduleError extends Error {
  readonly code = "UNSUPPORTED_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "InvalidScheduleError";
  }
}

export class ScheduleNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor() {
    super("That automation does not exist.");
    this.name = "ScheduleNotFoundError";
  }
}

export class TooManySchedulesError extends Error {
  readonly code = "UNSUPPORTED_INPUT";
  constructor() {
    super(`You can keep at most ${MAX_SCHEDULES_PER_USER} automations. Delete one first.`);
    this.name = "TooManySchedulesError";
  }
}

/** Parses and validates a create/update body. Throws `InvalidScheduleError` with one message. */
export function parseScheduleInput(body: Record<string, unknown>): WorkflowScheduleInput {
  const workflowId = typeof body.workflowId === "string" ? body.workflowId.trim() : "";
  if (workflowId === "") throw new InvalidScheduleError("Choose a workflow to automate.");
  const cadence = body.cadence;
  if (typeof cadence !== "string" || !CADENCES.includes(cadence as ScheduleCadence)) {
    throw new InvalidScheduleError("Choose how often it should run: hourly, daily or weekly.");
  }
  const hour = Number(body.hour);
  const minute = Number(body.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new InvalidScheduleError("Hour must be 0-23 (server time, shown as UTC).");
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new InvalidScheduleError("Minute must be 0-59.");
  }
  let weekday: number | null = null;
  if (cadence === "weekly") {
    weekday = Number(body.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new InvalidScheduleError("Choose a day of the week for a weekly automation.");
    }
  }
  const enabled = body.enabled !== false;
  return { workflowId, cadence: cadence as ScheduleCadence, hour, minute, weekday, enabled };
}

/**
 * The next moment (strictly after `from`) this cadence should fire, in UTC. Kept intentionally
 * simple: "hourly" fires every hour on `minute`, "daily" once a day at `hour:minute`, "weekly"
 * once a week on `weekday` at `hour:minute`. A missed tick (server was down) just runs once at
 * the next check — this is a convenience scheduler, not a guaranteed-delivery queue.
 */
export function computeNextRun(input: WorkflowScheduleInput, from: Date = new Date()): Date {
  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  if (input.cadence === "hourly") {
    next.setUTCMinutes(input.minute);
    if (next <= from) next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }
  next.setUTCHours(input.hour, input.minute);
  if (input.cadence === "daily") {
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  // weekly
  const targetDay = input.weekday ?? 0;
  let deltaDays = (targetDay - next.getUTCDay() + 7) % 7;
  if (deltaDays === 0 && next <= from) deltaDays = 7;
  next.setUTCDate(next.getUTCDate() + deltaDays);
  return next;
}

interface ScheduleRow {
  id: string;
  userId: string;
  workflowId: string;
  cadence: string;
  hour: number;
  minute: number;
  weekday: number | null;
  enabled: boolean;
  lastRunAt: Date | null;
  lastStatus: string | null;
  nextRunAt: Date;
  createdAt: Date;
  updatedAt: Date;
  workflow: { name: string };
}

function toSchedule(row: ScheduleRow): WorkflowSchedule {
  return {
    id: row.id,
    userId: row.userId,
    workflowId: row.workflowId,
    workflowName: row.workflow.name,
    cadence: row.cadence as ScheduleCadence,
    hour: row.hour,
    minute: row.minute,
    weekday: row.weekday,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastStatus: row.lastStatus === "success" || row.lastStatus === "failed" ? row.lastStatus : null,
    nextRunAt: row.nextRunAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const include = { workflow: { select: { name: true } } } as const;

/** This user's automations, soonest-next-run first. */
export async function listSchedules(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<WorkflowSchedule[]> {
  const rows = await prisma.workflowSchedule.findMany({
    where: { userId },
    orderBy: [{ nextRunAt: "asc" }],
    include,
  });
  return (rows as ScheduleRow[]).map(toSchedule);
}

export async function createSchedule(
  userId: string,
  input: WorkflowScheduleInput,
  prisma: PrismaClient = requirePrisma(),
): Promise<WorkflowSchedule> {
  const owned = await prisma.workflow.findFirst({
    where: { id: input.workflowId, userId },
    select: { id: true, steps: true },
  });
  if (!owned) throw new InvalidScheduleError("That workflow does not exist in your account.");
  // Nobody is present to supply a file when this fires, and the shared chain validator
  // (`@onestop/tool-registry`'s `validateWorkflow`) always requires a *multi-step* workflow's
  // first tool to accept a file (packages/tool-registry/src/workflows.ts) — that rule is a
  // deliberate, tested part of the workflow builder (see workflows.test.ts) and is not something
  // this feature should weaken. So automation is scoped to what can genuinely run unattended
  // without going through that check at all: a single-step workflow whose one tool needs no
  // file or typed input (a generator - Password/UUID Generator, User-Agent Viewer, etc.), run
  // directly (`scheduler.ts` calls `runPipeline`, not `runWorkflow`).
  const steps = parseSteps(owned.steps);
  const firstTool = steps[0] ? getTool(steps[0].toolId) : undefined;
  if (steps.length !== 1 || !firstTool || inputKind(firstTool) !== "none") {
    throw new InvalidScheduleError(
      "Only a one-step workflow whose tool needs no file or typed input (a generator, like Password Generator or UUID Generator) can be automated — nobody is there to supply an input, or run later steps, when it runs on its own.",
    );
  }
  const count = await prisma.workflowSchedule.count({ where: { userId } });
  if (count >= MAX_SCHEDULES_PER_USER) throw new TooManySchedulesError();
  const row = await prisma.workflowSchedule.create({
    data: {
      userId,
      workflowId: input.workflowId,
      cadence: input.cadence,
      hour: input.hour,
      minute: input.minute,
      weekday: input.weekday ?? null,
      enabled: input.enabled ?? true,
      nextRunAt: computeNextRun(input),
    },
    include,
  });
  return toSchedule(row as ScheduleRow);
}

export async function updateSchedule(
  userId: string,
  id: string,
  patch: Partial<WorkflowScheduleInput>,
  prisma: PrismaClient = requirePrisma(),
): Promise<WorkflowSchedule> {
  const existing = await prisma.workflowSchedule.findFirst({ where: { id, userId } });
  if (!existing) throw new ScheduleNotFoundError();
  const merged: WorkflowScheduleInput = {
    workflowId: existing.workflowId,
    cadence: (patch.cadence ?? existing.cadence) as ScheduleCadence,
    hour: patch.hour ?? existing.hour,
    minute: patch.minute ?? existing.minute,
    weekday: patch.weekday !== undefined ? patch.weekday : existing.weekday,
    enabled: patch.enabled ?? existing.enabled,
  };
  const row = await prisma.workflowSchedule.update({
    where: { id },
    data: {
      cadence: merged.cadence,
      hour: merged.hour,
      minute: merged.minute,
      weekday: merged.cadence === "weekly" ? (merged.weekday ?? 0) : null,
      enabled: merged.enabled,
      nextRunAt: computeNextRun(merged),
    },
    include,
  });
  return toSchedule(row as ScheduleRow);
}

/** Deletes one automation. False when it does not exist or belongs to someone else. */
export async function deleteSchedule(
  userId: string,
  id: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<boolean> {
  const { count } = await prisma.workflowSchedule.deleteMany({ where: { id, userId } });
  return count > 0;
}
