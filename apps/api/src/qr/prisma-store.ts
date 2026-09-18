// The Postgres-backed dynamic-QR store (14-history-favorites.md).
//
// Phase 11 kept dynamic codes in one JSON file under the data directory, with a note asking this
// phase to move them into the database. The row shape was written to make that a copy rather than
// a redesign, so this file implements the same `QrStore` contract against Prisma:
//
//   * `ownerToken` is now the signed-in user id (null for a guest, and for every code made before
//     accounts existed - those keep resolving, they simply have no owner).
//   * scans are their own table instead of an array, so the file can no longer grow without bound
//     and "scans in the last 7 days" is a real query.
//   * a code's history of destinations stays a JSON column: it is small, append-only and only
//     ever read whole.
//
// Hosted-page attachments are still data URLs inside the `page` column. They were capped at 2 MB
// each / 8 MB per page while the store was a file and the caps stay, because a hosted page has to
// outlive the temp-file store's retention window and there is no permanent blob store yet. See
// PROGRESS.md.
import fs from "node:fs/promises";
import type { PrismaClient } from "../db/client.ts";
import { unsupported } from "./formats.ts";
import {
  isQrLinkId,
  MAX_LINKS,
  MAX_SCANS_KEPT,
  newLinkId,
  validatePage,
  type CreateQrLinkInput,
  type QrLink,
  type QrPage,
  type QrScan,
  type QrStore,
  type UpdateQrLinkInput,
} from "./store.ts";

type LinkRow = {
  id: string;
  userId: string | null;
  kind: string;
  title: string;
  target: string | null;
  page: unknown;
  active: boolean;
  scanCount: number;
  lastScannedAt: Date | null;
  history: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ScanRow = { at: Date; device: string | null; referrer: string | null };

function toHistory(value: unknown): { at: string; target: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const { at, target } = row as { at?: unknown; target?: unknown };
    return typeof at === "string" && typeof target === "string" ? [{ at, target }] : [];
  });
}

function toLink(row: LinkRow, scans: ScanRow[] = []): QrLink {
  return {
    id: row.id,
    kind: row.kind === "page" ? "page" : "redirect",
    title: row.title,
    ...(row.target ? { target: row.target } : {}),
    ...(row.page ? { page: row.page as QrPage } : {}),
    ownerToken: row.userId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    active: row.active,
    scanCount: row.scanCount,
    lastScannedAt: row.lastScannedAt ? row.lastScannedAt.toISOString() : null,
    scans: scans.map((s) => ({
      at: s.at.toISOString(),
      ...(s.device ? { device: s.device } : {}),
      ...(s.referrer ? { referrer: s.referrer } : {}),
    })),
    history: toHistory(row.history),
  };
}

/** The most recent scans of one link, oldest first - the order phase 11's analytics expects. */
async function loadScans(prisma: PrismaClient, linkId: string): Promise<ScanRow[]> {
  const rows = await prisma.qrScan.findMany({
    where: { linkId },
    orderBy: { at: "desc" },
    take: MAX_SCANS_KEPT,
    select: { at: true, device: true, referrer: true },
  });
  return (rows as ScanRow[]).reverse();
}

export function createPrismaQrStore(prisma: PrismaClient): QrStore {
  async function hydrate(row: LinkRow): Promise<QrLink> {
    return toLink(row, await loadScans(prisma, row.id));
  }

  /** Refuses an edit to somebody else's code, exactly as the JSON store did. */
  function assertOwner(row: LinkRow, ownerToken?: string | null): void {
    if (ownerToken !== undefined && row.userId !== null && row.userId !== ownerToken) {
      throw unsupported("That QR code belongs to someone else.");
    }
  }

  return {
    async list(ownerToken?: string | null): Promise<QrLink[]> {
      const rows = (await prisma.qrLink.findMany({
        where: ownerToken ? { userId: ownerToken } : {},
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })) as LinkRow[];
      // The analytics tool only needs the retained scan window per link, so hydrate them all -
      // the list is bounded by MAX_LINKS and each link by MAX_SCANS_KEPT.
      return Promise.all(rows.map((row) => hydrate(row)));
    },

    async get(id: string): Promise<QrLink | undefined> {
      if (!isQrLinkId(id)) return undefined;
      const row = (await prisma.qrLink.findUnique({ where: { id } })) as LinkRow | null;
      return row ? hydrate(row) : undefined;
    },

    async create(input: CreateQrLinkInput): Promise<QrLink> {
      if ((await prisma.qrLink.count()) >= MAX_LINKS) {
        throw unsupported(
          "You have reached the limit of 2000 saved QR codes. Delete one you no longer need.",
        );
      }
      const now = new Date().toISOString();
      let id = newLinkId();
      while (await prisma.qrLink.findUnique({ where: { id }, select: { id: true } })) {
        id = newLinkId();
      }
      const row = (await prisma.qrLink.create({
        data: {
          id,
          userId: input.ownerToken ?? null,
          kind: input.kind,
          title: input.title.trim() || "Untitled QR code",
          target: input.target ?? null,
          page: (input.page ? validatePage(input.page) : null) as never,
          history: (input.target ? [{ at: now, target: input.target }] : []) as never,
        },
      })) as LinkRow;
      return toLink(row);
    },

    async update(
      id: string,
      patch: UpdateQrLinkInput,
      ownerToken?: string | null,
    ): Promise<QrLink> {
      const row = (await prisma.qrLink.findUnique({ where: { id } })) as LinkRow | null;
      if (!row) throw unsupported("That QR code no longer exists.");
      assertOwner(row, ownerToken);
      const now = new Date().toISOString();
      const history = toHistory(row.history);
      if (patch.target !== undefined && patch.target !== (row.target ?? undefined)) {
        history.push({ at: now, target: patch.target });
        if (history.length > 50) history.splice(0, history.length - 50);
      }
      const updated = (await prisma.qrLink.update({
        where: { id },
        data: {
          ...(patch.title !== undefined ? { title: patch.title.trim() || row.title } : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
          ...(patch.target !== undefined ? { target: patch.target } : {}),
          ...(patch.page !== undefined ? { page: validatePage(patch.page) as never } : {}),
          history: history as never,
        },
      })) as LinkRow;
      return hydrate(updated);
    },

    async remove(id: string, ownerToken?: string | null): Promise<boolean> {
      const row = (await prisma.qrLink.findUnique({ where: { id } })) as LinkRow | null;
      if (!row) return false;
      assertOwner(row, ownerToken);
      await prisma.qrLink.delete({ where: { id } });
      return true;
    },

    async recordScan(id: string, scan: Omit<QrScan, "at"> = {}): Promise<QrLink | undefined> {
      const exists = await prisma.qrLink.findUnique({ where: { id }, select: { id: true } });
      if (!exists) return undefined;
      const at = new Date();
      await prisma.qrScan.create({
        data: {
          linkId: id,
          at,
          device: scan.device ?? null,
          referrer: scan.referrer ?? null,
        },
      });
      const row = (await prisma.qrLink.update({
        where: { id },
        data: { scanCount: { increment: 1 }, lastScannedAt: at },
      })) as LinkRow;
      // Keep only the retained window, so a popular poster cannot grow the table without bound.
      const total = await prisma.qrScan.count({ where: { linkId: id } });
      if (total > MAX_SCANS_KEPT) {
        const stale = (await prisma.qrScan.findMany({
          where: { linkId: id },
          orderBy: { at: "asc" },
          take: total - MAX_SCANS_KEPT,
          select: { id: true },
        })) as { id: string }[];
        await prisma.qrScan.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
      }
      return hydrate(row);
    },

    async clear(): Promise<void> {
      await prisma.qrScan.deleteMany({});
      await prisma.qrLink.deleteMany({});
    },
  };
}

/** What one run of the interim-file migration did. */
export interface QrMigrationResult {
  migrated: number;
  skipped: number;
  /** The path the old file was renamed to, once it had been copied in. */
  archivedAs?: string;
}

/**
 * Copies phase 11's interim JSON file into Postgres, once.
 *
 * A code that already exists in the table is left alone, so running this twice changes nothing.
 * Afterwards the file is renamed to `<name>.migrated` rather than deleted: if anything went wrong
 * the data is still on disk, and the rename is what stops the migration running again.
 */
export async function migrateJsonQrLinks(
  prisma: PrismaClient,
  file: string,
): Promise<QrMigrationResult> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { migrated: 0, skipped: 0 };
    throw err;
  }

  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch (err) {
    console.error(`[qr] ${file} could not be parsed; leaving it in place`, err);
    return { migrated: 0, skipped: 0 };
  }
  const links = (Array.isArray(rows) ? rows : []).filter(
    (row): row is QrLink => Boolean(row) && typeof (row as QrLink).id === "string",
  );

  let migrated = 0;
  let skipped = 0;
  for (const link of links) {
    if (!isQrLinkId(link.id)) {
      skipped += 1;
      continue;
    }
    const existing = await prisma.qrLink.findUnique({
      where: { id: link.id },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    // The old owner token was a random cookie value, not a user id, so it cannot become a foreign
    // key: an imported code is ownerless and resolves for everyone, which is what it already did.
    await prisma.qrLink.create({
      data: {
        id: link.id,
        userId: null,
        kind: link.kind === "page" ? "page" : "redirect",
        title: link.title || "Untitled QR code",
        target: link.target ?? null,
        page: (link.page ?? null) as never,
        active: link.active !== false,
        scanCount: link.scanCount ?? 0,
        lastScannedAt: link.lastScannedAt ? new Date(link.lastScannedAt) : null,
        history: (link.history ?? []) as never,
        createdAt: link.createdAt ? new Date(link.createdAt) : new Date(),
        updatedAt: link.updatedAt ? new Date(link.updatedAt) : new Date(),
      },
    });
    const scans = (link.scans ?? []).slice(-MAX_SCANS_KEPT);
    for (const scan of scans) {
      await prisma.qrScan.create({
        data: {
          linkId: link.id,
          at: new Date(scan.at),
          device: scan.device ?? null,
          referrer: scan.referrer ?? null,
        },
      });
    }
    migrated += 1;
  }

  const archivedAs = `${file}.migrated`;
  await fs.rename(file, archivedAs);
  console.warn(
    `[qr] moved ${migrated} dynamic QR code(s) from ${file} into Postgres` +
      `${skipped > 0 ? ` (${skipped} already there)` : ""}; the old file is now ${archivedAs}.`,
  );
  return { migrated, skipped, archivedAs };
}
