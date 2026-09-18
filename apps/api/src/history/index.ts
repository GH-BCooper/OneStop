// Persisted job history for signed-in users (14-history-favorites.md).
//
// Guests keep their history in IndexedDB on the device (`apps/web/src/lib/localHistory.ts`) and
// never touch this module - that is the whole point of the guest path: no account, no network.
//
// Everything here is a direct Prisma query rather than a `JobStore` call, because history needs
// what the store's `list()` deliberately does not offer: a total count, date bounds and an
// offset. The store contract stays small; this module owns the read model.
import type { HistoryEntry, HistoryFilter, HistoryPage, Job, JobStatus } from "@onestop/types";
import { requirePrisma, type PrismaClient } from "../db/client.ts";
import { toHistoryEntry } from "./entry.ts";

export { inputNames, outputFiles, toHistoryEntry } from "./entry.ts";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
/** Ceiling on one import from a guest's device, so a signup cannot flood the table. */
export const MAX_IMPORT_ENTRIES = 500;

const STATUSES = new Set<JobStatus>(["pending", "validating", "processing", "success", "failed"]);

type JobRow = {
  id: string;
  userId: string | null;
  toolId: string;
  status: string;
  inputMetadata: unknown;
  outputMetadata: unknown;
  createdAt: Date;
};

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    userId: row.userId,
    toolId: row.toolId,
    status: row.status as JobStatus,
    inputMetadata: asMetadata(row.inputMetadata),
    outputMetadata:
      row.outputMetadata === null || row.outputMetadata === undefined
        ? null
        : asMetadata(row.outputMetadata),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Parses a bound. A plain date means the whole day, so `to=2026-09-19` includes that day. */
export function parseBound(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (dateOnly && endOfDay) parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}

/** Normalises whatever arrived on the query string into a filter the query can trust. */
export function normaliseFilter(filter: HistoryFilter = {}): HistoryFilter & {
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const requested = Math.floor(filter.pageSize ?? DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requested));
  const { status, ...rest } = filter;
  return {
    ...rest,
    ...(status && STATUSES.has(status) ? { status } : {}),
    page,
    pageSize,
  };
}

function whereFor(userId: string, filter: HistoryFilter) {
  const from = parseBound(filter.from, false);
  const to = parseBound(filter.to, true);
  return {
    userId,
    // A single tool wins over a category list; an empty `toolIds` means "a category holding no
    // tools", which must match nothing rather than everything - hence the explicit empty `in`.
    ...(filter.toolId
      ? { toolId: filter.toolId }
      : filter.toolIds
        ? { toolId: { in: filter.toolIds } }
        : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
  };
}

/** One page of a user's history, newest first. */
export async function listHistory(
  userId: string,
  filter: HistoryFilter = {},
  prisma: PrismaClient = requirePrisma(),
): Promise<HistoryPage> {
  const { page, pageSize, ...rest } = normaliseFilter(filter);
  const where = whereFor(userId, rest);
  const [total, rows] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    entries: (rows as JobRow[]).map((row) => toHistoryEntry(toJob(row))),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** One entry, or undefined when it is not this user's. */
export async function getHistoryEntry(
  userId: string,
  id: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<HistoryEntry | undefined> {
  const row = await prisma.job.findFirst({ where: { id, userId } });
  return row ? toHistoryEntry(toJob(row as JobRow)) : undefined;
}

/** Deletes one entry. Returns false when it does not exist or belongs to someone else. */
export async function deleteHistoryEntry(
  userId: string,
  id: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<boolean> {
  const { count } = await prisma.job.deleteMany({ where: { id, userId } });
  return count > 0;
}

/** Deletes everything this user has run. Returns how many rows went. */
export async function clearHistory(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<number> {
  const { count } = await prisma.job.deleteMany({ where: { userId } });
  return count;
}

/**
 * How many times this user has run each tool, newest data included. Feeds the registry's
 * "popularity" and "recently used" sorts, which phase 03 left as hand-set numbers.
 */
export async function toolUsage(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<Record<string, number>> {
  const rows = await prisma.job.groupBy({
    by: ["toolId"],
    where: { userId },
    _count: { toolId: true },
  });
  const counts: Record<string, number> = {};
  for (const row of rows as { toolId: string; _count: { toolId: number } }[]) {
    counts[row.toolId] = row._count.toolId;
  }
  return counts;
}

/** The tools this user ran most recently, newest first. */
export async function recentToolIds(
  userId: string,
  limit = 12,
  prisma: PrismaClient = requirePrisma(),
): Promise<string[]> {
  // `distinct` keeps the first row per tool, and the ordering makes that the newest one.
  const rows = await prisma.job.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    distinct: ["toolId"],
    take: Math.max(1, Math.min(50, limit)),
    select: { toolId: true },
  });
  return (rows as { toolId: string }[]).map((r) => r.toolId);
}

/** One entry a guest kept on their device, as the import endpoint accepts it. */
export interface ImportableEntry {
  toolId: string;
  status: JobStatus;
  createdAt: string;
  summary?: string | null;
  inputs?: string[];
}

/**
 * Merges a guest's device history into their new account (the build file's optional import path).
 *
 * Only metadata crosses over - the files themselves were deleted from the server long ago, so an
 * imported row is a record of "you ran this", never a download. Entries already imported are
 * skipped by matching tool + timestamp, so running the import twice is harmless.
 */
export async function importHistory(
  userId: string,
  entries: ImportableEntry[],
  prisma: PrismaClient = requirePrisma(),
): Promise<{ imported: number; skipped: number }> {
  const usable = entries
    .filter((e) => typeof e?.toolId === "string" && e.toolId.trim() !== "")
    .slice(0, MAX_IMPORT_ENTRIES);
  if (usable.length === 0) return { imported: 0, skipped: 0 };

  const existing = await prisma.job.findMany({
    where: { userId, toolId: { in: [...new Set(usable.map((e) => e.toolId))] } },
    select: { toolId: true, createdAt: true },
  });
  const seen = new Set(
    (existing as { toolId: string; createdAt: Date }[]).map(
      (r) => `${r.toolId}@${r.createdAt.toISOString()}`,
    ),
  );

  let imported = 0;
  let skipped = 0;
  for (const entry of usable) {
    const at = new Date(entry.createdAt);
    const createdAt = Number.isNaN(at.getTime()) ? new Date() : at;
    const key = `${entry.toolId}@${createdAt.toISOString()}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    await prisma.job.create({
      data: {
        userId,
        toolId: entry.toolId,
        status: STATUSES.has(entry.status) ? entry.status : "success",
        createdAt,
        inputMetadata: {
          imported: true,
          fileCount: entry.inputs?.length ?? 0,
          files: (entry.inputs ?? []).map((name) => ({ name, size: 0, type: "" })),
        } as never,
        outputMetadata: {
          summary: entry.summary ?? null,
          files: [],
          imported: true,
        } as never,
      },
    });
    imported += 1;
  }
  return { imported, skipped };
}
