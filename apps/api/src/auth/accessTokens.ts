// Personal access tokens (21-roadmap-expansion.md, roadmap §2).
//
// So a signed-in user's *own* scripts and cron jobs can call `POST /api/tools/run` from outside the
// browser. Strictly additive to the existing session-cookie auth, never a replacement: a token acts
// as its owner, goes through the same registry, the same validation and the same rate limit, and it
// cannot do anything the owner could not do in the UI.
//
// Storage: only a SHA-256 hash of the token is kept, so a leaked database row cannot be replayed.
// The token itself is shown exactly once, at creation — the same bargain every other system makes,
// and the UI says so. SHA-256 rather than bcrypt is right here (unlike for passwords): the token is
// 256 bits of CSPRNG output, so there is nothing to brute-force and the check has to be fast.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { requirePrisma, type PrismaClient } from "../db/index.ts";

export const TOKEN_PREFIX = "osk_";
export const MAX_TOKENS_PER_USER = 20;
/** Long enough that guessing is hopeless, short enough to paste into a shell. */
const TOKEN_BYTES = 32;

export interface AccessTokenRecord {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** `osk_` plus 43 base64url characters. The prefix makes a leaked token recognisable in a log. */
export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, TOKEN_PREFIX.length + 6) };
}

export function looksLikeAccessToken(value: string): boolean {
  return /^osk_[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

/** Pulls a token out of an Authorization header or the `X-OneStop-Token` header. */
export function tokenFromHeaders(headers: {
  get(name: string): string | null;
}): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (match && looksLikeAccessToken(match[1]!)) return match[1]!;
  }
  const direct = headers.get("x-onestop-token");
  if (direct && looksLikeAccessToken(direct)) return direct.trim();
  return null;
}

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

function toRecord(row: TokenRow): AccessTokenRecord {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export async function listAccessTokens(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<AccessTokenRecord[]> {
  const rows = (await prisma.accessToken.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, name: true, prefix: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true },
  })) as TokenRow[];
  return rows.map(toRecord);
}

export class AccessTokenError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AccessTokenError";
  }
}

export async function createAccessToken(
  userId: string,
  { name, expiresInDays }: { name: string; expiresInDays?: number | null },
  prisma: PrismaClient = requirePrisma(),
): Promise<{ record: AccessTokenRecord; token: string }> {
  const cleanName = name.trim().slice(0, 60);
  if (cleanName === "") throw new AccessTokenError("Give the token a name, so you know what it is for later.", 400);
  const live = await prisma.accessToken.count({ where: { userId, revokedAt: null } });
  if (live >= MAX_TOKENS_PER_USER) {
    throw new AccessTokenError(`You already have ${MAX_TOKENS_PER_USER} active tokens. Revoke one first.`, 400);
  }
  if (expiresInDays !== undefined && expiresInDays !== null && (!Number.isFinite(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650)) {
    throw new AccessTokenError("An expiry has to be between 1 and 3650 days.", 400);
  }
  const { token, hash, prefix } = generateToken();
  const row = (await prisma.accessToken.create({
    data: {
      userId,
      name: cleanName,
      tokenHash: hash,
      prefix,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
    },
    select: { id: true, name: true, prefix: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true },
  })) as TokenRow;
  return { record: toRecord(row), token };
}

export async function revokeAccessToken(
  userId: string,
  id: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<boolean> {
  const { count } = await prisma.accessToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count > 0;
}

export interface TokenIdentity {
  userId: string;
  tokenId: string;
  name: string;
}

/**
 * Resolves a presented token to its owner, or null. Expired and revoked tokens resolve to null, and
 * `lastUsedAt` is updated so a user can see which of their tokens is actually in use — and spot one
 * that is being used when it should not be.
 */
export async function verifyAccessToken(
  token: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<TokenIdentity | null> {
  if (!looksLikeAccessToken(token)) return null;
  const hash = hashToken(token.trim());
  const row = (await prisma.accessToken.findUnique({
    where: { tokenHash: hash },
    select: { id: true, userId: true, name: true, expiresAt: true, revokedAt: true, tokenHash: true },
  })) as { id: string; userId: string; name: string; expiresAt: Date | null; revokedAt: Date | null; tokenHash: string } | null;
  if (!row) return null;
  // The lookup was by unique hash, so this only guards against a database that folds case or
  // otherwise matches loosely; it costs nothing and removes the doubt.
  const presented = Buffer.from(hash, "utf8");
  const stored = Buffer.from(row.tokenHash, "utf8");
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  await prisma.accessToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return { userId: row.userId, tokenId: row.id, name: row.name };
}
