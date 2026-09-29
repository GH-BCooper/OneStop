// Shareable read-only result links (21-roadmap-expansion.md, roadmap §2).
//
// A time-boxed, unguessable link to one job's result, so a signed-in user can hand a finished file
// to someone without an account. Two rules make this safe rather than a quiet privacy hole:
//
//  1. A share can never outlive the temp files it points at. The retention window that already
//     deletes those files is the ceiling, so a link cannot promise a file that is no longer there.
//  2. The slug is 160 bits of CSPRNG output and is never derived from the job id, so a share cannot
//     be guessed from a job someone already knows about, and revoking it is immediate.
//
// An optional passphrase can be added on top. It is hashed with the app's existing password hasher
// rather than a bespoke one, so there is one place that knows how to store a secret.
import { randomBytes } from "node:crypto";
import { requirePrisma, type PrismaClient } from "../db/index.ts";

export const MAX_SHARE_DAYS = 30;
export const DEFAULT_SHARE_HOURS = 24;
export const MAX_SHARES_PER_USER = 100;

export interface SharedResultRecord {
  id: string;
  slug: string;
  jobId: string;
  title: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  hasPassphrase: boolean;
  /** Relative, because the absolute origin is the caller's to add. */
  path: string;
}

interface ShareRow {
  id: string;
  slug: string;
  jobId: string;
  title: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  viewCount: number;
  lastViewedAt: Date | null;
  secretHash: string | null;
}

export function sharePath(slug: string): string {
  return `/s/${slug}`;
}

function toRecord(row: ShareRow): SharedResultRecord {
  return {
    id: row.id,
    slug: row.slug,
    jobId: row.jobId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
    hasPassphrase: row.secretHash !== null,
    path: sharePath(row.slug),
  };
}

const SELECT = {
  id: true,
  slug: true,
  jobId: true,
  title: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  viewCount: true,
  lastViewedAt: true,
  secretHash: true,
} as const;

export class ShareError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ShareError";
  }
}

export function generateSlug(): string {
  return randomBytes(20).toString("base64url");
}

export async function listShares(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<SharedResultRecord[]> {
  const rows = (await prisma.sharedResult.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }],
    take: MAX_SHARES_PER_USER,
    select: SELECT,
  })) as ShareRow[];
  return rows.map(toRecord);
}

export interface CreateShareInput {
  jobId: string;
  title?: string | null;
  hours?: number;
  passphrase?: string | null;
  /** The moment the job's temp files are deleted, when the caller knows it. */
  filesExpireAt?: Date | null;
}

export async function createShare(
  userId: string,
  input: CreateShareInput,
  prisma: PrismaClient = requirePrisma(),
): Promise<SharedResultRecord> {
  const job = (await prisma.job.findFirst({
    where: { id: input.jobId, userId },
    select: { id: true, createdAt: true },
  })) as { id: string; createdAt: Date } | null;
  if (!job) throw new ShareError("That result is not one of yours, or it no longer exists.", 404);

  const hours = Math.min(MAX_SHARE_DAYS * 24, Math.max(1, Math.round(input.hours ?? DEFAULT_SHARE_HOURS)));
  let expiresAt = new Date(Date.now() + hours * 3_600_000);
  // Rule 1: never promise a file for longer than the retention window keeps it.
  if (input.filesExpireAt && input.filesExpireAt.getTime() < expiresAt.getTime()) {
    expiresAt = input.filesExpireAt;
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new ShareError("This result's files have already been cleaned up, so there is nothing to share.", 400);
  }

  const live = await prisma.sharedResult.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (live >= MAX_SHARES_PER_USER) {
    throw new ShareError(`You already have ${MAX_SHARES_PER_USER} active links. Revoke one first.`, 400);
  }

  let secretHash: string | null = null;
  if (input.passphrase && input.passphrase.trim() !== "") {
    if (input.passphrase.length < 4) throw new ShareError("A passphrase needs at least 4 characters.", 400);
    const { hashPassword } = await import("../auth/index.ts");
    secretHash = await hashPassword(input.passphrase);
  }

  const row = (await prisma.sharedResult.create({
    data: {
      slug: generateSlug(),
      userId,
      jobId: job.id,
      title: input.title?.trim().slice(0, 120) || null,
      secretHash,
      expiresAt,
    },
    select: SELECT,
  })) as ShareRow;
  return toRecord(row);
}

export async function revokeShare(
  userId: string,
  id: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<boolean> {
  const { count } = await prisma.sharedResult.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count > 0;
}

export type ShareLookup =
  | { ok: true; share: SharedResultRecord }
  | { ok: false; reason: "missing" | "expired" | "revoked" | "passphrase" };

/**
 * Resolves a slug for a visitor who may be nobody at all. Every failure returns the same shape, and
 * the caller shows the same page for "missing" and "revoked" so a wrong slug cannot be used to test
 * whether a share ever existed.
 */
export async function resolveShare(
  slug: string,
  passphrase: string | null,
  prisma: PrismaClient = requirePrisma(),
): Promise<ShareLookup> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(slug)) return { ok: false, reason: "missing" };
  const row = (await prisma.sharedResult.findUnique({ where: { slug }, select: SELECT })) as ShareRow | null;
  if (!row) return { ok: false, reason: "missing" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (row.secretHash) {
    if (!passphrase) return { ok: false, reason: "passphrase" };
    const { verifyPassword } = await import("../auth/index.ts");
    if (!(await verifyPassword(passphrase, row.secretHash))) return { ok: false, reason: "passphrase" };
  }
  await prisma.sharedResult
    .update({ where: { id: row.id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } })
    .catch(() => undefined);
  return { ok: true, share: toRecord(row) };
}

/** Housekeeping: drop rows whose window has passed, so the table does not grow without bound. */
export async function pruneExpiredShares(
  before: Date = new Date(Date.now() - 7 * 86_400_000),
  prisma: PrismaClient = requirePrisma(),
): Promise<number> {
  const { count } = await prisma.sharedResult.deleteMany({ where: { expiresAt: { lt: before } } });
  return count;
}
