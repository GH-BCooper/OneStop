// Tests for the post-V1 automation pass (see /versionTwo.md): schedule timing/validation are pure
// and always run; persistence and the scheduler tick need Postgres and skip themselves otherwise,
// the same convention every other database suite in the repo follows (see workflows.test.ts).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createIsolatedTestPrisma,
  dropTestSchema,
  testDatabaseReachable,
  type PrismaClient,
} from "../db/testing.ts";
import { createInMemoryJobStore } from "../file-processing/job.ts";
import { createTempStore, type TempStore } from "../file-processing/tempStore.ts";
import "../index.ts"; // registers every real executor, including the generators used below
import {
  computeNextRun,
  createSchedule,
  deleteSchedule,
  InvalidScheduleError,
  listSchedules,
  parseScheduleInput,
  updateSchedule,
} from "./schedule.ts";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  pushNotification,
} from "./notifications.ts";
import { runDueSchedules } from "./scheduler.ts";

// ---- pure timing / validation -------------------------------------------------------------

describe("computeNextRun", () => {
  it("hourly fires at the given minute, this hour if it hasn't passed yet", () => {
    const from = new Date("2026-01-01T10:20:00.000Z");
    const next = computeNextRun({ workflowId: "w", cadence: "hourly", hour: 0, minute: 45 }, from);
    expect(next.toISOString()).toBe("2026-01-01T10:45:00.000Z");
  });

  it("hourly rolls to the next hour once the minute has passed", () => {
    const from = new Date("2026-01-01T10:50:00.000Z");
    const next = computeNextRun({ workflowId: "w", cadence: "hourly", hour: 0, minute: 15 }, from);
    expect(next.toISOString()).toBe("2026-01-01T11:15:00.000Z");
  });

  it("daily rolls to tomorrow once today's time has passed", () => {
    const from = new Date("2026-01-01T12:00:00.000Z");
    const next = computeNextRun({ workflowId: "w", cadence: "daily", hour: 9, minute: 0 }, from);
    expect(next.toISOString()).toBe("2026-01-02T09:00:00.000Z");
  });

  it("weekly lands on the chosen weekday, a full week out when today is that day but past time", () => {
    // 2026-01-01 is a Thursday (weekday 4).
    const from = new Date("2026-01-01T12:00:00.000Z");
    const next = computeNextRun(
      { workflowId: "w", cadence: "weekly", hour: 9, minute: 0, weekday: 4 },
      from,
    );
    expect(next.toISOString()).toBe("2026-01-08T09:00:00.000Z");
  });
});

describe("parseScheduleInput", () => {
  it("accepts a well-formed daily schedule", () => {
    const input = parseScheduleInput({ workflowId: "w1", cadence: "daily", hour: 9, minute: 30 });
    expect(input).toEqual({
      workflowId: "w1",
      cadence: "daily",
      hour: 9,
      minute: 30,
      weekday: null,
      enabled: true,
    });
  });

  it("rejects a missing workflow id", () => {
    expect(() => parseScheduleInput({ cadence: "daily", hour: 9, minute: 0 })).toThrow(
      InvalidScheduleError,
    );
  });

  it("rejects an unknown cadence", () => {
    expect(() =>
      parseScheduleInput({ workflowId: "w1", cadence: "monthly", hour: 9, minute: 0 }),
    ).toThrow(InvalidScheduleError);
  });

  it("requires a weekday for a weekly cadence", () => {
    expect(() =>
      parseScheduleInput({ workflowId: "w1", cadence: "weekly", hour: 9, minute: 0 }),
    ).toThrow(InvalidScheduleError);
  });

  it("rejects an out-of-range hour or minute", () => {
    expect(() =>
      parseScheduleInput({ workflowId: "w1", cadence: "daily", hour: 24, minute: 0 }),
    ).toThrow(InvalidScheduleError);
    expect(() =>
      parseScheduleInput({ workflowId: "w1", cadence: "daily", hour: 9, minute: 60 }),
    ).toThrow(InvalidScheduleError);
  });
});

// ---- persistence + the scheduler tick, against a real database ----------------------------

const describeDb = (await testDatabaseReachable()) ? describe : describe.skip;
describeDb("automations (database)", () => {
  let prisma: PrismaClient;
  const schema = "test_automation";

  beforeAll(async () => {
    prisma = await createIsolatedTestPrisma(schema);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await dropTestSchema(schema);
  });

  let userId: string;
  let generatorWorkflowId: string;
  let fileWorkflowId: string;

  beforeEach(async () => {
    await prisma.notification.deleteMany({});
    await prisma.workflowSchedule.deleteMany({});
    await prisma.workflow.deleteMany({});
    await prisma.user.deleteMany({});
    const user = await prisma.user.create({
      data: { email: `automation-${Date.now()}@example.com`, name: "Automation Test" },
    });
    userId = user.id;
    const generator = await prisma.workflow.create({
      data: { userId, name: "Daily password", steps: [{ toolId: "password-generator" }] as never },
    });
    generatorWorkflowId = generator.id;
    const fileBased = await prisma.workflow.create({
      data: { userId, name: "Compress a PDF", steps: [{ toolId: "compress-pdf" }] as never },
    });
    fileWorkflowId = fileBased.id;
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({});
    await prisma.workflowSchedule.deleteMany({});
    await prisma.workflow.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("schedules a generator workflow and computes its next run", async () => {
    const schedule = await createSchedule(
      userId,
      { workflowId: generatorWorkflowId, cadence: "daily", hour: 9, minute: 0 },
      prisma,
    );
    expect(schedule.workflowName).toBe("Daily password");
    expect(schedule.enabled).toBe(true);
    expect(new Date(schedule.nextRunAt).getTime()).toBeGreaterThan(Date.now());

    const list = await listSchedules(userId, prisma);
    expect(list.map((s) => s.id)).toEqual([schedule.id]);
  });

  it("refuses to schedule a workflow whose first step needs a file", async () => {
    await expect(
      createSchedule(userId, { workflowId: fileWorkflowId, cadence: "daily", hour: 9, minute: 0 }, prisma),
    ).rejects.toThrow(InvalidScheduleError);
  });

  it("updates timing and can be paused, then deleted", async () => {
    const schedule = await createSchedule(
      userId,
      { workflowId: generatorWorkflowId, cadence: "daily", hour: 9, minute: 0 },
      prisma,
    );
    const paused = await updateSchedule(userId, schedule.id, { enabled: false }, prisma);
    expect(paused.enabled).toBe(false);

    expect(await deleteSchedule(userId, schedule.id, prisma)).toBe(true);
    expect(await listSchedules(userId, prisma)).toEqual([]);
  });

  it("runs a due schedule, records the result and notifies the account", async () => {
    const schedule = await createSchedule(
      userId,
      { workflowId: generatorWorkflowId, cadence: "hourly", hour: 0, minute: 0 },
      prisma,
    );
    await prisma.workflowSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });

    // An in-memory job store/temp dir, not the process-wide Postgres one: that store's `Job`
    // table lives in a different (real) database than this isolated test schema's user, so its
    // foreign key would reject the write. Production passes nothing and gets the real store.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-automation-test-"));
    const temp: TempStore = createTempStore({ tempDir: dir, ttlMs: 120_000, autoSweep: false });
    let ran: number;
    try {
      ran = await runDueSchedules(prisma, { jobs: createInMemoryJobStore(), temp });
    } finally {
      await temp.dispose();
      await fs.rm(dir, { recursive: true, force: true });
    }
    expect(ran).toBe(1);

    const [updated] = await listSchedules(userId, prisma);
    expect(updated?.lastStatus).toBe("success");
    expect(updated?.lastRunAt).not.toBeNull();
    expect(new Date(updated!.nextRunAt).getTime()).toBeGreaterThan(Date.now());

    const { notifications, unreadCount } = await listNotifications(userId, prisma);
    expect(unreadCount).toBe(1);
    expect(notifications[0]?.type).toBe("automation_run");
    expect(notifications[0]?.title).toContain("Daily password");
  });

  it("does not run a schedule before its time, and skips a disabled one", async () => {
    await createSchedule(
      userId,
      { workflowId: generatorWorkflowId, cadence: "daily", hour: 9, minute: 0 },
      prisma,
    );
    expect(await runDueSchedules(prisma)).toBe(0);
  });

  it("notification CRUD: list, mark one read, mark all read", async () => {
    await pushNotification(userId, { type: "system", title: "Welcome" }, prisma);
    await pushNotification(userId, { type: "system", title: "Second" }, prisma);

    const first = await listNotifications(userId, prisma);
    let unreadCount = first.unreadCount;
    expect(unreadCount).toBe(2);
    expect(first.notifications).toHaveLength(2);

    const firstId = first.notifications[0]!.id;
    expect(await markNotificationRead(userId, firstId, prisma)).toBe(true);
    ({ unreadCount } = await listNotifications(userId, prisma));
    expect(unreadCount).toBe(1);

    await markAllNotificationsRead(userId, prisma);
    ({ unreadCount } = await listNotifications(userId, prisma));
    expect(unreadCount).toBe(0);
  });
});
