import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTempStore, isTempFileId, type TempStore } from "./tempStore.ts";

const created: TempStore[] = [];
const dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-temp-test-"));
  dirs.push(dir);
  return dir;
}

function store(options: Parameters<typeof createTempStore>[0] = {}): TempStore {
  const s = createTempStore({ autoSweep: false, ...options });
  created.push(s);
  return s;
}

const bytes = (text: string) => new TextEncoder().encode(text);

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

afterEach(async () => {
  for (const s of created.splice(0)) await s.dispose();
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("temp store", () => {
  it("stores and reads a file back, keeping the name as metadata only", async () => {
    const dir = await makeDir();
    const temp = store({ tempDir: dir, ttlMs: 60_000 });
    const record = await temp.put({ name: "../../etc/passwd", bytes: bytes("hello") });

    expect(record.name).toBe("passwd");
    expect(isTempFileId(record.id)).toBe(true);
    expect(record.size).toBe(5);
    // The path is the random id, never the user's name.
    expect(await exists(path.join(dir, record.id))).toBe(true);
    expect(await exists(path.join(dir, "passwd"))).toBe(false);
    expect(new TextDecoder().decode(await temp.read(record.id))).toBe("hello");
  });

  it("writes files that are readable and writable by the owner only", async () => {
    const dir = await makeDir();
    const temp = store({ tempDir: dir });
    const record = await temp.put({ name: "a.txt", bytes: bytes("x") });
    const stat = await fs.stat(path.join(dir, record.id));
    expect(stat.isFile()).toBe(true);
    // No execute bit, on any platform that reports one.
    expect(stat.mode & 0o111).toBe(0);
  });

  it("refuses to turn anything but its own ids into a path", async () => {
    const temp = store({ tempDir: await makeDir() });
    for (const id of ["../../etc/passwd", "..", "abc", ""]) {
      expect(isTempFileId(id)).toBe(false);
      await expect(temp.delete(id)).resolves.toBe(false);
      await expect(temp.read(id)).rejects.toThrow();
    }
  });

  it("deletes a file on request", async () => {
    const dir = await makeDir();
    const temp = store({ tempDir: dir });
    const record = await temp.put({ name: "a.txt", bytes: bytes("x") });
    expect(await temp.delete(record.id)).toBe(true);
    expect(await exists(path.join(dir, record.id))).toBe(false);
    expect(await temp.get(record.id)).toBeUndefined();
    expect(temp.list()).toHaveLength(0);
  });

  it("expires a file once its retention window closes", async () => {
    const dir = await makeDir();
    let clock = 1_000;
    const temp = store({ tempDir: dir, ttlMs: 5_000, now: () => clock });
    const record = await temp.put({ name: "a.txt", bytes: bytes("x") });

    clock += 4_999;
    expect(await temp.get(record.id)).toBeDefined();

    clock += 2;
    expect(await temp.sweep()).toBe(1);
    expect(await exists(path.join(dir, record.id))).toBe(false);
    expect(await temp.get(record.id)).toBeUndefined();
  });

  it("actually removes the file from disk after the configured window, unattended", async () => {
    const dir = await makeDir();
    const temp = createTempStore({ tempDir: dir, ttlMs: 40, sweepIntervalMs: 10 });
    created.push(temp);
    const record = await temp.put({ name: "abandoned.txt", bytes: bytes("left behind") });
    expect(await exists(path.join(dir, record.id))).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(await exists(path.join(dir, record.id))).toBe(false);
    expect(temp.list()).toHaveLength(0);
  });

  it("honours a per-file retention override", async () => {
    let clock = 0;
    const temp = store({ tempDir: await makeDir(), ttlMs: 60_000, now: () => clock });
    const short = await temp.put({ name: "a.txt", bytes: bytes("x"), ttlMs: 10 });
    const long = await temp.put({ name: "b.txt", bytes: bytes("y") });
    clock = 50;
    expect(await temp.sweep()).toBe(1);
    expect(await temp.get(short.id)).toBeUndefined();
    expect(await temp.get(long.id)).toBeDefined();
  });

  it("purges files a previous process left behind", async () => {
    const dir = await makeDir();
    const first = store({ tempDir: dir, ttlMs: 60_000 });
    const record = await first.put({ name: "a.txt", bytes: bytes("x") });
    expect(await exists(path.join(dir, record.id))).toBe(true);

    // A fresh store in the same directory stands in for a restarted server.
    const second = store({ tempDir: dir, ttlMs: 60_000 });
    await second.put({ name: "b.txt", bytes: bytes("y") });
    expect(await exists(path.join(dir, record.id))).toBe(false);
  });

  it("deletes everything it knows about when disposed", async () => {
    const dir = await makeDir();
    const temp = store({ tempDir: dir });
    const a = await temp.put({ name: "a.txt", bytes: bytes("x") });
    const b = await temp.put({ name: "b.txt", bytes: bytes("y") });
    await temp.dispose();
    expect(await exists(path.join(dir, a.id))).toBe(false);
    expect(await exists(path.join(dir, b.id))).toBe(false);
  });
});
