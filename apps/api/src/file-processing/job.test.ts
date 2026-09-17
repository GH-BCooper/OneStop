import { describe, expect, it } from "vitest";
import {
  canTransition,
  createInMemoryJobStore,
  InvalidJobTransitionError,
  JobNotFoundError,
} from "./job.ts";

describe("in-memory job store", () => {
  it("creates a guest job in the pending state", async () => {
    const jobs = createInMemoryJobStore();
    const job = await jobs.create({ toolId: "merge-pdf", inputMetadata: { fileCount: 2 } });
    expect(job).toMatchObject({
      toolId: "merge-pdf",
      userId: null,
      status: "pending",
      outputMetadata: null,
      inputMetadata: { fileCount: 2 },
    });
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(job.createdAt))).toBe(false);
    expect(await jobs.get(job.id)).toEqual(job);
  });

  it("walks the happy path and records output metadata", async () => {
    const jobs = createInMemoryJobStore();
    const job = await jobs.create({ toolId: "file-metadata-viewer", userId: "user-1" });
    await jobs.update(job.id, { status: "validating" });
    await jobs.update(job.id, { status: "processing" });
    const done = await jobs.update(job.id, {
      status: "success",
      outputMetadata: { files: [{ name: "a.json" }] },
    });
    expect(done.status).toBe("success");
    expect(done.outputMetadata).toEqual({ files: [{ name: "a.json" }] });
    expect(done.userId).toBe("user-1");
  });

  it("refuses transitions that make no sense", async () => {
    expect(canTransition("pending", "processing")).toBe(false);
    expect(canTransition("success", "failed")).toBe(false);
    expect(canTransition("failed", "failed")).toBe(true);
    expect(canTransition("validating", "failed")).toBe(true);

    const jobs = createInMemoryJobStore();
    const job = await jobs.create({ toolId: "merge-pdf" });
    await expect(jobs.update(job.id, { status: "success" })).rejects.toBeInstanceOf(
      InvalidJobTransitionError,
    );
  });

  it("reports a missing job rather than inventing one", async () => {
    const jobs = createInMemoryJobStore();
    expect(await jobs.get("nope")).toBeUndefined();
    await expect(jobs.update("nope", { status: "failed" })).rejects.toBeInstanceOf(
      JobNotFoundError,
    );
  });

  it("lists newest first and filters by user, tool and status", async () => {
    const jobs = createInMemoryJobStore();
    const a = await jobs.create({ toolId: "merge-pdf", userId: "u1" });
    const b = await jobs.create({ toolId: "split-pdf", userId: null });
    expect((await jobs.list()).map((j) => j.id)).toEqual([b.id, a.id]);
    expect((await jobs.list({ userId: "u1" })).map((j) => j.id)).toEqual([a.id]);
    expect((await jobs.list({ toolId: "split-pdf" })).map((j) => j.id)).toEqual([b.id]);
    expect(await jobs.list({ status: "success" })).toEqual([]);
    expect(await jobs.list({ limit: 1 })).toHaveLength(1);
  });

  it("hands out copies, so a caller cannot mutate the store", async () => {
    const jobs = createInMemoryJobStore();
    const job = await jobs.create({ toolId: "merge-pdf" });
    job.status = "success";
    expect((await jobs.get(job.id))?.status).toBe("pending");
  });

  it("drops the oldest jobs past its cap", async () => {
    const jobs = createInMemoryJobStore({ maxJobs: 2 });
    const first = await jobs.create({ toolId: "a" });
    await jobs.create({ toolId: "b" });
    await jobs.create({ toolId: "c" });
    expect(await jobs.get(first.id)).toBeUndefined();
    expect(await jobs.list()).toHaveLength(2);
  });

  it("deletes and clears", async () => {
    const jobs = createInMemoryJobStore();
    const job = await jobs.create({ toolId: "merge-pdf" });
    expect(await jobs.delete(job.id)).toBe(true);
    expect(await jobs.delete(job.id)).toBe(false);
    await jobs.create({ toolId: "merge-pdf" });
    await jobs.clear();
    expect(await jobs.list()).toEqual([]);
  });
});
