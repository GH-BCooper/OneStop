"use client";

// Recurring automation for one saved workflow (post-V1 automation pass; see /versionTwo.md).
//
// Only offered for a one-step workflow whose tool needs no file or typed input (a generator) —
// that is the only kind of chain that can ever succeed with nobody present to supply an input or
// run later steps, and the server enforces the same rule (`automation/schedule.ts`), so this
// panel simply doesn't appear for a chain that could never be scheduled successfully.
import { getTool, inputKind } from "@onestop/tool-registry";
import type { ScheduleCadence, WorkflowSchedule, WorkflowStep } from "@onestop/types";
import { Badge, Button, Card } from "@onestop/ui";
import { useEffect, useState } from "react";
import { createSchedule, deleteSchedule, fetchSchedules, updateSchedule } from "@/lib/schedules";

const selectClasses =
  "h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-fg " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function describe(schedule: WorkflowSchedule): string {
  const time = `${pad(schedule.hour)}:${pad(schedule.minute)} UTC`;
  if (schedule.cadence === "hourly") return `Every hour, at :${pad(schedule.minute)}`;
  if (schedule.cadence === "daily") return `Every day at ${time}`;
  return `Every ${WEEKDAYS[schedule.weekday ?? 0]} at ${time}`;
}

export interface AutomatePanelProps {
  workflowId: string;
  steps: WorkflowStep[];
}

export function AutomatePanel({ workflowId, steps }: AutomatePanelProps) {
  const firstTool = steps[0] ? getTool(steps[0].toolId) : undefined;
  const eligible = steps.length === 1 && firstTool !== undefined && inputKind(firstTool) === "none";

  const [schedule, setSchedule] = useState<WorkflowSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cadence, setCadence] = useState<ScheduleCadence>("daily");
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [weekday, setWeekday] = useState(1);

  useEffect(() => {
    if (!eligible) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void fetchSchedules()
      .then((all) => {
        if (cancelled) return;
        setSchedule(all.find((s) => s.workflowId === workflowId) ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId, eligible]);

  if (!eligible) return null;
  if (loading) return null;

  const onCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await createSchedule({ workflowId, cadence, hour, minute, weekday });
      setSchedule(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be automated.");
    } finally {
      setSaving(false);
    }
  };

  const onToggle = async () => {
    if (!schedule) return;
    setSaving(true);
    try {
      setSchedule(await updateSchedule(schedule.id, { enabled: !schedule.enabled }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!schedule) return;
    setSaving(true);
    try {
      await deleteSchedule(schedule.id);
      setSchedule(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be removed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Automate</h2>
        <Badge tone="neutral">runs on its own</Badge>
      </div>
      {schedule ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{describe(schedule)}</p>
          <p className="text-sm text-fg-muted">
            {schedule.lastRunAt
              ? `Last ran ${new Date(schedule.lastRunAt).toLocaleString()} — ${schedule.lastStatus}`
              : "Has not run yet."}{" "}
            Next: {new Date(schedule.nextRunAt).toLocaleString()}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={saving} onClick={() => void onToggle()}>
              {schedule.enabled ? "Pause" : "Resume"}
            </Button>
            <Button size="sm" variant="danger" disabled={saving} onClick={() => void onDelete()}>
              Remove automation
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted">
            Run this workflow by itself, on a schedule — a real notification appears when it runs.
            Times are server time (shown as UTC).
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="automate-cadence" className="text-sm font-medium">
                How often
              </label>
              <select
                id="automate-cadence"
                className={selectClasses}
                value={cadence}
                onChange={(e) => setCadence(e.target.value as ScheduleCadence)}
              >
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            {cadence === "weekly" ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="automate-weekday" className="text-sm font-medium">
                  Day
                </label>
                <select
                  id="automate-weekday"
                  className={selectClasses}
                  value={weekday}
                  onChange={(e) => setWeekday(Number(e.target.value))}
                >
                  {WEEKDAYS.map((day, i) => (
                    <option key={day} value={i}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {cadence !== "hourly" ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="automate-hour" className="text-sm font-medium">
                  Hour (UTC)
                </label>
                <select
                  id="automate-hour"
                  className={selectClasses}
                  value={hour}
                  onChange={(e) => setHour(Number(e.target.value))}
                >
                  {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                    <option key={h} value={h}>
                      {pad(h)}:00
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label htmlFor="automate-minute" className="text-sm font-medium">
                  Minute
                </label>
                <select
                  id="automate-minute"
                  className={selectClasses}
                  value={minute}
                  onChange={(e) => setMinute(Number(e.target.value))}
                >
                  {[0, 15, 30, 45].map((m) => (
                    <option key={m} value={m}>
                      :{pad(m)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div>
            <Button size="sm" disabled={saving} onClick={() => void onCreate()}>
              Automate this workflow
            </Button>
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
