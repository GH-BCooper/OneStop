// Automations: scheduled workflow runs and the notifications they (and only they) generate.
// Post-V1 automation pass — see /versionTwo.md. Schedules only exist for account workflows: a
// recurring run has to happen with nobody present, so it needs a server-side workflow row to
// point at, not a device-only one.
export type ScheduleCadence = "hourly" | "daily" | "weekly";

/** A recurring "run this workflow on its own" rule, as `/automations` and a workflow page show it. */
export interface WorkflowSchedule {
  id: string;
  userId: string;
  workflowId: string;
  workflowName: string;
  cadence: ScheduleCadence;
  /** 0-23, evaluated in server (UTC) time — the UI labels it explicitly as UTC. */
  hour: number;
  /** 0-59. */
  minute: number;
  /** 0 (Sunday) - 6 (Saturday). Only meaningful, and only present, for "weekly". */
  weekday: number | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: "success" | "failed" | null;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowScheduleInput {
  workflowId: string;
  cadence: ScheduleCadence;
  hour: number;
  minute: number;
  weekday?: number | null;
  enabled?: boolean;
}

export type NotificationType = "automation_run" | "automation_failed" | "system";

/** A real event for the account — written only by things that actually happened (never decorative). */
export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}
