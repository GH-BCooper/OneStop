// The Postgres job store and the fallback that keeps tools working when it is unreachable
// (13-auth-database.md). The Postgres half skips itself when no database is configured.
import type { Job } from "@onestop/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryJobStore, JobNotFoundError, type JobStore } from "../file-processing/job.ts";
import { createPrismaJobStore, createResilientJobStore } from "./job-store.ts";
import {
  createIsolatedTestPrisma,
  createTestPrisma,
  dropTestSchema,
  testDatabaseReachable,
  resetTestDatabase,
} from "./testing.ts";
import type { PrismaClient } from "./client.ts";

// A configured-but-not-running Postgres skips these tests rather than failing them, which is
// the promise `db/testing.ts` makes. Top-level await: the probe has to finish before `describe`.
const describeDb = (await testDatabaseReachable()) ? describe : describe.skip;

const SCHEMA = "test_job_store";

describeDb("Postgres job store", () => {
  let prisma: PrismaClient;
  let store: JobStore;

  beforeAll(async () => {
    prisma = await createIsolatedTestPrisma(SCHEMA);
    store = createPrismaJobStore(prisma);
  });
  beforeEach(() => resetTestDatabase(prisma));
  afterAll(async () => {
    await prisma.$disconnect();
    await dropTestSchema(SCHEMA);
  });

  it("round-trips a job through the phase-04 contract", async () => {
    const job = await store.create({ toolId: "merge-pdf", inputMetadata: { files: 3 } });
    expect(job).toMatchObject({ toolId: "merge-pdf", status: "pending", userId: null });
    expect(job.inputMetadata).toEqual({ files: 3 });
    expect(Date.parse(job.createdAt)).not.toBeNaN();

    expect(await store.get(job.id)).toMatchObject({ id: job.id, status: "pending" });
    expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });

  it("enforces the same status transitions as the in-memory store", async () => {
    const job = await store.create({ toolId: "split-pdf" });
    await store.update(job.id, { status: "validating" });
    const done = await store.update(job.id, {
      status: "processing",
      outputMetadata: { pages: 2 },
    });
    expect(done.status).toBe("processing");
    await store.update(job.id, { status: "success" });
    await expect(store.update(job.id, { status: "processing" })).rejects.toThrow(
      /cannot go from "success"/,
    );
    await expect(store.update("00000000-0000-0000-0000-000000000000", {})).rejects.toBeInstanceOf(
      JobNotFoundError,
    );
  });

  it("filters and orders the list newest first", async () => {
    const a = await store.create({ toolId: "merge-pdf", userId: null });
    const user = await prisma.user.create({
      data: { email: "jobs@example.com", name: "Jobs" },
    });
    const b = await store.create({ toolId: "compress-pdf", userId: user.id });
    await store.update(b.id, { status: "validating" });

    const all = await store.list();
    expect(all.map((j: Job) => j.id)).toEqual([b.id, a.id]);
    expect(await store.list({ userId: user.id })).toHaveLength(1);
    expect(await store.list({ userId: null })).toHaveLength(1);
    expect(await store.list({ toolId: "merge-pdf" })).toHaveLength(1);
    expect(await store.list({ status: "validating" })).toHaveLength(1);
    expect(await store.list({ limit: 1 })).toHaveLength(1);
  });

  it("survives a new client, which is what surviving a restart means", async () => {
    const job = await store.create({ toolId: "rotate-pdf", inputMetadata: { pages: [1] } });
    // A brand new connection, exactly as a restarted server would open.
    const second = createTestPrisma(SCHEMA);
    try {
      const reread = await createPrismaJobStore(second).get(job.id);
      expect(reread).toMatchObject({ id: job.id, toolId: "rotate-pdf" });
      expect(reread?.inputMetadata).toEqual({ pages: [1] });
    } finally {
      await second.$disconnect();
    }
  });

  it("deletes and clears", async () => {
    const job = await store.create({ toolId: "merge-pdf" });
    expect(await store.delete(job.id)).toBe(true);
    expect(await store.delete(job.id)).toBe(false);
    await store.create({ toolId: "merge-pdf" });
    await store.clear();
    expect(await store.list()).toHaveLength(0);
  });
});

describe("resilient job store", () => {
  function connectionError() {
    return Object.assign(new Error("Can't reach database server at localhost:5432"), {
      code: "P1001",
    });
  }

  function failingStore(err: () => unknown): JobStore {
    const fail = async () => {
      throw err();
    };
    return {
      create: fail,
      get: fail,
      update: fail,
      list: fail,
      delete: fail,
      clear: fail,
    } as unknown as JobStore;
  }

  it("uses Postgres while it answers", async () => {
    const primary = createInMemoryJobStore();
    const fallback = createInMemoryJobStore();
    const store = createResilientJobStore(primary, fallback);
    const job = await store.create({ toolId: "merge-pdf" });
    expect(await primary.get(job.id)).toBeDefined();
    expect(await fallback.list()).toHaveLength(0);
  });

  it("falls back to memory when the database is unreachable, so tools keep working", async () => {
    const fallback = createInMemoryJobStore();
    const degraded: unknown[] = [];
    const store = createResilientJobStore(failingStore(connectionError), fallback, {
      onDegrade: (err) => degraded.push(err),
    });
    const job = await store.create({ toolId: "merge-pdf" });
    expect(job.toolId).toBe("merge-pdf");
    expect(degraded).toHaveLength(1);
    // The next calls skip Postgres entirely rather than stalling on it again.
    expect(await store.get(job.id)).toMatchObject({ id: job.id });
    expect(degraded).toHaveLength(1);
  });

  it("retries Postgres once the degraded window has passed", async () => {
    let clock = 0;
    const degraded: unknown[] = [];
    const store = createResilientJobStore(failingStore(connectionError), createInMemoryJobStore(), {
      retryAfterMs: 1000,
      now: () => clock,
      onDegrade: (err) => degraded.push(err),
    });
    await store.create({ toolId: "a" });
    clock = 500;
    await store.create({ toolId: "b" });
    expect(degraded).toHaveLength(1);
    clock = 1500;
    await store.create({ toolId: "c" });
    expect(degraded).toHaveLength(2);
  });

  it("reports a patched status when the job only ever existed in Postgres", async () => {
    const store = createResilientJobStore(failingStore(connectionError), createInMemoryJobStore(), {
      onDegrade: () => {},
    });
    const updated = await store.update("a-job-from-postgres", { status: "success" });
    expect(updated).toMatchObject({ id: "a-job-from-postgres", status: "success" });
  });

  it("does not hide a real bug behind the fallback", async () => {
    const boom = () => new Error("column does not exist");
    const store = createResilientJobStore(failingStore(boom), createInMemoryJobStore(), {
      onDegrade: () => {},
    });
    await expect(store.create({ toolId: "merge-pdf" })).rejects.toThrow(/column does not exist/);
  });

  it("logs once, with a message that does not blame the user", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createResilientJobStore(failingStore(connectionError), createInMemoryJobStore());
    await store.create({ toolId: "merge-pdf" });
    expect(String(error.mock.calls[0]?.[0])).toMatch(/Postgres is unreachable/);
    error.mockRestore();
  });
});
