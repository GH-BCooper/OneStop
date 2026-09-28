// Client for scheduled workflow automations (post-V1 automation pass; see /versionTwo.md).
//
// Automations only exist for account workflows (no device/guest path — a recurring run has to
// happen with nobody present, so it needs a server-side workflow row).
import type { ScheduleCadence, WorkflowSchedule, WorkflowScheduleInput } from "@onestop/types";

interface ApiResponse {
  ok?: boolean;
  schedule?: unknown;
  schedules?: unknown;
  error?: { message?: string };
}

async function call(url: string, init?: RequestInit): Promise<ApiResponse> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok) throw new Error(body.error?.message ?? "That could not be saved.");
  return body;
}

function asSchedule(value: unknown): WorkflowSchedule | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.workflowId !== "string") return null;
  return {
    id: row.id,
    userId: typeof row.userId === "string" ? row.userId : "",
    workflowId: row.workflowId,
    workflowName: typeof row.workflowName === "string" ? row.workflowName : "Workflow",
    cadence: (row.cadence as ScheduleCadence) ?? "daily",
    hour: typeof row.hour === "number" ? row.hour : 9,
    minute: typeof row.minute === "number" ? row.minute : 0,
    weekday: typeof row.weekday === "number" ? row.weekday : null,
    enabled: row.enabled !== false,
    lastRunAt: typeof row.lastRunAt === "string" ? row.lastRunAt : null,
    lastStatus:
      row.lastStatus === "success" || row.lastStatus === "failed" ? row.lastStatus : null,
    nextRunAt: typeof row.nextRunAt === "string" ? row.nextRunAt : new Date().toISOString(),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
  };
}

export async function fetchSchedules(): Promise<WorkflowSchedule[]> {
  const body = await call("/api/automations/schedules");
  return Array.isArray(body.schedules)
    ? body.schedules.map(asSchedule).filter((s): s is WorkflowSchedule => s !== null)
    : [];
}

export async function createSchedule(input: WorkflowScheduleInput): Promise<WorkflowSchedule> {
  const body = await call("/api/automations/schedules", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const schedule = asSchedule(body.schedule);
  if (!schedule) throw new Error("That could not be saved.");
  return schedule;
}

export async function updateSchedule(
  id: string,
  patch: Partial<WorkflowScheduleInput>,
): Promise<WorkflowSchedule> {
  const body = await call(`/api/automations/schedules/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const schedule = asSchedule(body.schedule);
  if (!schedule) throw new Error("That could not be saved.");
  return schedule;
}

export async function deleteSchedule(id: string): Promise<void> {
  await call(`/api/automations/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
}
