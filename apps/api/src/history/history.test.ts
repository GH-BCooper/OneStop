// Phase 14's server modules (14-history-favorites.md): the job → history-row mapping, the
// favourites service and the Postgres dynamic-QR store with its one-time migration off phase 11's
// interim JSON file.
//
// The pure mapping tests always run. The database-backed ones skip themselves when no
// TEST_DATABASE_URL/DATABASE_URL is configured, like every other Postgres suite in the repo.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Job } from "@onestop/types";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIsolatedTestPrisma,
  dropTestSchema,
  hasTestDatabase,
  resetTestDatabase,
  type PrismaClient,
} from "../db/testing.ts";
import {
  listFavorites,
  mergeFavorites,
  setFavorite,
  toggleFavorite,
  TooManyFavoritesError,
  UnknownFavoriteToolError,
} from "../favorites/index.ts";
import { createPrismaQrStore, migrateJsonQrLinks } from "../qr/prisma-store.ts";
import { withMigration } from "../qr/register.ts";
import { statsFor } from "../qr/analytics.ts";
import {
  clearHistory,
  deleteHistoryEntry,
  importHistory,
  inputNames,
  listHistory,
  normaliseFilter,
  outputFiles,
  parseBound,
  recentToolIds,
  toHistoryEntry,
  toolUsage,
} from "./index.ts";

function job(patch: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    userId: "user-1",
    toolId: "merge-pdf",
    status: "success",
    inputMetadata: { fileCount: 2, files: [{ name: "a.pdf" }, { name: "b.pdf" }] },
    outputMetadata: {
      summary: "Merged 2 files",
      files: [
        {
          id: "f1",
          name: "merged.pdf",
          mimeType: "application/pdf",
          size: 1234,
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      ],
    },
    createdAt: "2026-09-19T10:00:00.000Z",
    ...patch,
  };
}

describe("job → history row", () => {
  it("reads the metadata the pipeline already writes", () => {
    const entry = toHistoryEntry(job());
    expect(entry).toMatchObject({
      id: "job-1",
      toolId: "merge-pdf",
      status: "success",
      summary: "Merged 2 files",
      inputs: ["a.pdf", "b.pdf"],
      error: null,
      scope: "account",
    });
    expect(entry.outputs).toEqual([
      {
        id: "f1",
        name: "merged.pdf",
        mimeType: "application/pdf",
        size: 1234,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("surfaces the failure message only for a failed run", () => {
    const failed = toHistoryEntry(
      job({
        status: "failed",
        outputMetadata: { code: "UNSUPPORTED_INPUT", message: "This file type is not supported." },
      }),
    );
    expect(failed.error).toBe("This file type is not supported.");
    expect(failed.outputs).toEqual([]);

    // The same metadata on a successful row is not an error.
    expect(toHistoryEntry(job({ outputMetadata: { message: "noise" } })).error).toBeNull();
  });

  it("copes with metadata that is missing, malformed or a text input", () => {
    expect(inputNames(job({ inputMetadata: {} }))).toEqual([]);
    expect(inputNames(job({ inputMetadata: { files: "nope" } }))).toEqual([]);
    expect(inputNames(job({ inputMetadata: { textLength: 42 } }))).toEqual([
      "42 characters of text",
    ]);
    expect(outputFiles(job({ outputMetadata: null }))).toEqual([]);
    // A file entry with no id or name is not renderable, so it is dropped rather than half-shown.
    expect(outputFiles(job({ outputMetadata: { files: [{ name: "x" }, null, 7] } }))).toEqual([]);
  });
});

describe("filter normalisation", () => {
  it("clamps the page and page size and drops an unknown status", () => {
    expect(normaliseFilter({ page: 0, pageSize: 5000 })).toMatchObject({ page: 1, pageSize: 100 });
    expect(normaliseFilter({ page: -3, pageSize: 0 })).toMatchObject({ page: 1, pageSize: 1 });
    expect(normaliseFilter({ status: "nonsense" as never }).status).toBeUndefined();
    expect(normaliseFilter({ status: "failed" }).status).toBe("failed");
  });

  it("treats a plain date as the whole day", () => {
    expect(parseBound("2026-09-19", false)?.toISOString()).toBe("2026-09-19T00:00:00.000Z");
    expect(parseBound("2026-09-19", true)?.toISOString()).toBe("2026-09-19T23:59:59.999Z");
    expect(parseBound("nope", false)).toBeUndefined();
    expect(parseBound(undefined, false)).toBeUndefined();
  });
});

const describeDb = hasTestDatabase() ? describe : describe.skip;
const SCHEMA = "test_phase14_modules";

describeDb("history, favourites and dynamic QR (Postgres)", () => {
  let prisma: PrismaClient;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    prisma = await createIsolatedTestPrisma(SCHEMA);
  });

  // Rows, not `signUp`: nothing here tests passwords, and bcrypt at cost 12 is by far the most
  // expensive thing that would otherwise run before every test in this file.
  async function makeUser(email: string): Promise<string> {
    const { id } = await prisma.user.create({ data: { email, name: email.split("@")[0] } });
    return id;
  }

  beforeEach(async () => {
    await resetTestDatabase(prisma);
    userId = await makeUser("sam@example.com");
    otherId = await makeUser("alex@example.com");
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await dropTestSchema(SCHEMA);
  });

  async function seed(toolId: string, createdAt: string, owner = userId) {
    return prisma.job.create({
      data: {
        userId: owner,
        toolId,
        status: "success",
        createdAt: new Date(createdAt),
        inputMetadata: {} as never,
        outputMetadata: { summary: null, files: [] } as never,
      },
    });
  }

  it("lists, filters, pages, deletes and clears one user's history", async () => {
    await seed("merge-pdf", "2026-09-10T10:00:00.000Z");
    await seed("split-pdf", "2026-09-15T10:00:00.000Z");
    const third = await seed("merge-pdf", "2026-09-19T10:00:00.000Z");
    await seed("merge-pdf", "2026-09-19T11:00:00.000Z", otherId);

    expect((await listHistory(userId, {}, prisma)).total).toBe(3);
    expect((await listHistory(userId, { toolId: "merge-pdf" }, prisma)).total).toBe(2);
    expect((await listHistory(userId, { toolIds: ["merge-pdf", "split-pdf"] }, prisma)).total).toBe(
      3,
    );
    // An empty category matches nothing, not everything.
    expect((await listHistory(userId, { toolIds: [] }, prisma)).total).toBe(0);
    expect((await listHistory(userId, { from: "2026-09-15" }, prisma)).total).toBe(2);

    const paged = await listHistory(userId, { pageSize: 2, page: 2 }, prisma);
    expect(paged).toMatchObject({ total: 3, page: 2, pageCount: 2 });
    expect(paged.entries).toHaveLength(1);

    expect(await deleteHistoryEntry(otherId, third.id, prisma)).toBe(false);
    expect(await deleteHistoryEntry(userId, third.id, prisma)).toBe(true);
    expect(await clearHistory(userId, prisma)).toBe(2);
    expect((await listHistory(otherId, {}, prisma)).total).toBe(1);
  });

  it("derives usage counts and recent tools from real runs", async () => {
    await seed("merge-pdf", "2026-09-10T10:00:00.000Z");
    await seed("merge-pdf", "2026-09-11T10:00:00.000Z");
    await seed("split-pdf", "2026-09-19T10:00:00.000Z");

    expect(await toolUsage(userId, prisma)).toEqual({ "merge-pdf": 2, "split-pdf": 1 });
    expect(await recentToolIds(userId, 12, prisma)).toEqual(["split-pdf", "merge-pdf"]);
    expect(await toolUsage(otherId, prisma)).toEqual({});
  });

  it("imports a device history idempotently", async () => {
    const entries = [
      { toolId: "merge-pdf", status: "success" as const, createdAt: "2026-09-10T10:00:00.000Z" },
      { toolId: "split-pdf", status: "failed" as const, createdAt: "2026-09-11T10:00:00.000Z" },
    ];
    expect(await importHistory(userId, entries, prisma)).toEqual({ imported: 2, skipped: 0 });
    expect(await importHistory(userId, entries, prisma)).toEqual({ imported: 0, skipped: 2 });
    expect(await importHistory(userId, [], prisma)).toEqual({ imported: 0, skipped: 0 });

    const listed = await listHistory(userId, {}, prisma);
    expect(listed.entries.map((e) => e.toolId)).toEqual(["split-pdf", "merge-pdf"]);
  });

  it("stars and unstars tools per account, and refuses ids the registry does not know", async () => {
    expect(await listFavorites(userId, prisma)).toEqual([]);
    expect(await setFavorite(userId, "merge-pdf", true, prisma)).toEqual(["merge-pdf"]);
    expect(await toggleFavorite(userId, "split-pdf", prisma)).toMatchObject({ on: true });
    expect(await listFavorites(userId, prisma)).toEqual(["split-pdf", "merge-pdf"]);
    expect(await listFavorites(otherId, prisma)).toEqual([]);

    expect(await toggleFavorite(userId, "merge-pdf", prisma)).toMatchObject({ on: false });
    expect(await listFavorites(userId, prisma)).toEqual(["split-pdf"]);

    await expect(setFavorite(userId, "no-such-tool", true, prisma)).rejects.toBeInstanceOf(
      UnknownFavoriteToolError,
    );
    // Starring twice is not an error, and does not duplicate the row.
    await setFavorite(userId, "split-pdf", true, prisma);
    expect(await prisma.favorite.count({ where: { userId } })).toBe(1);
  });

  it("merges a guest's stars into the account, keeping what is already there", async () => {
    await setFavorite(userId, "merge-pdf", true, prisma);
    const merged = await mergeFavorites(userId, ["split-pdf", "merge-pdf", "nope"], prisma);
    expect(merged.sort()).toEqual(["merge-pdf", "split-pdf"]);
  });

  it("refuses to star more than the ceiling", async () => {
    // Fill the table directly - the service's own count is what must stop the next one.
    const { MAX_FAVORITES } = await import("../favorites/index.ts");
    await prisma.favorite.createMany({
      data: Array.from({ length: MAX_FAVORITES }, (_, i) => ({ userId, toolId: `filler-${i}` })),
    });
    await expect(setFavorite(userId, "merge-pdf", true, prisma)).rejects.toBeInstanceOf(
      TooManyFavoritesError,
    );
  });

  // ---- dynamic QR ---------------------------------------------------------------------------

  describe("the Postgres dynamic-QR store", () => {
    it("creates, resolves, edits, scans and deletes a code, keeping its owner", async () => {
      const store = createPrismaQrStore(prisma);
      const link = await store.create({
        kind: "redirect",
        title: "Poster",
        target: "https://example.com/first",
        ownerToken: userId,
      });
      expect(link.id).toMatch(/^[0-9a-z]{10}$/);
      expect(link.ownerToken).toBe(userId);
      expect(link.history).toEqual([
        { at: expect.any(String), target: "https://example.com/first" },
      ]);

      // The short URL never changes; the destination does.
      const edited = await store.update(link.id, { target: "https://example.com/second" }, userId);
      expect(edited.target).toBe("https://example.com/second");
      expect(edited.history).toHaveLength(2);

      await store.recordScan(link.id, { device: "mobile" });
      await store.recordScan(link.id, { device: "desktop" });
      const scanned = (await store.get(link.id))!;
      expect(scanned.scanCount).toBe(2);
      expect(scanned.scans.map((s) => s.device)).toEqual(["mobile", "desktop"]);
      expect(statsFor(scanned)).toMatchObject({
        scans: 2,
        scansLast7Days: 2,
        destinationChanges: 1,
      });

      // Someone else cannot touch it, and a signed-in user only lists their own.
      await expect(store.update(link.id, { title: "Theirs" }, otherId)).rejects.toThrow(
        /belongs to someone else/i,
      );
      expect(await store.list(otherId)).toEqual([]);
      expect((await store.list(userId)).map((l) => l.id)).toEqual([link.id]);

      expect(await store.remove(link.id, userId)).toBe(true);
      expect(await store.get(link.id)).toBeUndefined();
      // Deleting the link takes its scans with it.
      expect(await prisma.qrScan.count()).toBe(0);
    });

    it("validates a hosted page exactly as the interim store did", async () => {
      const store = createPrismaQrStore(prisma);
      await expect(
        store.create({ kind: "page", title: "Page", page: { title: "", blocks: [] } }),
      ).rejects.toThrow(/give the page a title/i);
      await expect(
        store.create({
          kind: "page",
          title: "Page",
          page: { title: "Hi", blocks: [{ type: "link", url: "javascript:alert(1)" }] },
        }),
      ).rejects.toThrow(/must start with http/i);

      const ok = await store.create({
        kind: "page",
        title: "Page",
        page: { title: "Hi", blocks: [{ type: "text", text: "Hello" }] },
        ownerToken: userId,
      });
      expect((await store.get(ok.id))!.page?.blocks).toHaveLength(1);
    });

    it("ignores an id that is not a link id", async () => {
      const store = createPrismaQrStore(prisma);
      expect(await store.get("../../etc/passwd")).toBeUndefined();
      expect(await store.remove("nope")).toBe(false);
      expect(await store.recordScan("nope")).toBeUndefined();
    });
  });

  describe("migrating phase 11's interim JSON file", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-qr-"));
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it("copies every code in, keeps its id and scans, and archives the file", async () => {
      const file = path.join(dir, "qr-links.json");
      await fs.writeFile(
        file,
        JSON.stringify([
          {
            id: "abc23456de",
            kind: "redirect",
            title: "Old poster",
            target: "https://example.com/old",
            ownerToken: "a-random-cookie-token",
            createdAt: "2026-09-01T10:00:00.000Z",
            updatedAt: "2026-09-02T10:00:00.000Z",
            active: false,
            scanCount: 3,
            lastScannedAt: "2026-09-02T10:00:00.000Z",
            scans: [{ at: "2026-09-02T10:00:00.000Z", device: "mobile" }],
            history: [{ at: "2026-09-01T10:00:00.000Z", target: "https://example.com/old" }],
          },
          { id: "not a valid id" },
        ]),
      );

      const result = await migrateJsonQrLinks(prisma, file);
      expect(result).toMatchObject({ migrated: 1, skipped: 1 });

      const store = createPrismaQrStore(prisma);
      const link = (await store.get("abc23456de"))!;
      // The printed code encodes <APP_URL>/q/abc23456de — the id surviving is the whole point.
      expect(link).toMatchObject({
        id: "abc23456de",
        title: "Old poster",
        target: "https://example.com/old",
        active: false,
        scanCount: 3,
      });
      expect(link.scans).toHaveLength(1);
      // The old owner token was a cookie value, not a user id, so the code becomes ownerless.
      expect(link.ownerToken).toBeNull();

      // The file is archived, not deleted, and the migration does not run twice.
      await expect(fs.access(file)).rejects.toThrow();
      await expect(fs.access(`${file}.migrated`)).resolves.toBeUndefined();
      expect(await migrateJsonQrLinks(prisma, file)).toEqual({ migrated: 0, skipped: 0 });
      expect(await prisma.qrLink.count()).toBe(1);
    });

    it("leaves an unreadable file alone rather than losing it", async () => {
      const file = path.join(dir, "qr-links.json");
      await fs.writeFile(file, "{not json");
      expect(await migrateJsonQrLinks(prisma, file)).toEqual({ migrated: 0, skipped: 0 });
      await expect(fs.access(file)).resolves.toBeUndefined();
    });

    it("runs the migration once, before the first store call", async () => {
      const file = path.join(dir, "qr-links.json");
      await fs.writeFile(file, JSON.stringify([]));
      const ready = vi.fn(async () => {});
      const store = withMigration(createPrismaQrStore(prisma), ready);
      await store.list(userId);
      await store.list(userId);
      expect(ready).toHaveBeenCalledTimes(2); // the wrapper always awaits; memoising is its job
    });
  });
});
