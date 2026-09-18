// Password reset tokens (13-auth-database.md).
//
// The token the user receives is 32 random bytes, base64url-encoded. Only its SHA-256 hash is
// stored, so a leaked database cannot be replayed against the reset endpoint. Tokens are
// single-use and expire; requesting a new one invalidates the outstanding ones.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { requirePrisma, type PrismaClient } from "../db/client.ts";
import { normalizeEmail } from "./emails.ts";
import { hashPassword, validatePasswordStrength } from "./passwords.ts";
import { AuthError } from "./users.ts";

export const RESET_TOKEN_TTL_MINUTES = 60;

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}

/**
 * Compares two hex digests without leaking where they first differ. Named for tokens so it is
 * never confused with the file-integrity helper of the same idea in `dev-utils/hashing.ts`.
 */
export function tokenDigestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface ResetRequest {
  /** The raw token - shown once, either by email or (in dev) on the server console. */
  token: string;
  userId: string;
  email: string;
  expiresAt: Date;
}

/**
 * Issues a reset token for an email address, or returns null when no such account exists.
 * Callers must answer the same way either way: telling a stranger which emails have accounts is
 * an enumeration leak.
 */
export async function createPasswordReset(
  email: string,
  prisma: PrismaClient = requirePrisma(),
  options: { ttlMinutes?: number; now?: () => number } = {},
): Promise<ResetRequest | null> {
  const now = options.now ?? Date.now;
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user) return null;

  const { token, tokenHash } = generateResetToken();
  const expiresAt = new Date(now() + (options.ttlMinutes ?? RESET_TOKEN_TTL_MINUTES) * 60_000);
  // One live token per account: a new request retires the previous links.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date(now()) },
  });
  await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });
  return { token, userId: user.id, email: user.email, expiresAt };
}

export type ResetTokenProblem = "UNKNOWN" | "USED" | "EXPIRED";

export interface ResetTokenCheck {
  valid: boolean;
  problem?: ResetTokenProblem;
  userId?: string;
  email?: string;
}

/** Looks a token up without consuming it - used to decide whether to show the form. */
export async function checkResetToken(
  token: string,
  prisma: PrismaClient = requirePrisma(),
  options: { now?: () => number } = {},
): Promise<ResetTokenCheck> {
  const now = options.now ?? Date.now;
  if (!token.trim()) return { valid: false, problem: "UNKNOWN" };
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    include: { user: true },
  });
  if (!row || !tokenDigestsMatch(row.tokenHash, hashResetToken(token))) {
    return { valid: false, problem: "UNKNOWN" };
  }
  if (row.usedAt) return { valid: false, problem: "USED" };
  if (row.expiresAt.getTime() <= now()) return { valid: false, problem: "EXPIRED" };
  return { valid: true, userId: row.userId, email: row.user.email };
}

export const RESET_TOKEN_MESSAGES: Record<ResetTokenProblem, string> = {
  UNKNOWN: "That reset link is not valid. Request a new one.",
  USED: "That reset link has already been used. Request a new one.",
  EXPIRED: "That reset link has expired. Request a new one.",
};

/**
 * Consumes a token and sets the new password. Throws `AuthError` with a short message for an
 * unknown, used or expired token, or for a password that fails the strength check.
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
  prisma: PrismaClient = requirePrisma(),
  options: { now?: () => number } = {},
): Promise<{ userId: string; email: string }> {
  const now = options.now ?? Date.now;
  const problem = validatePasswordStrength(newPassword);
  if (problem) throw new AuthError("INVALID_INPUT", problem, "password");

  const check = await checkResetToken(token, prisma, { now });
  if (!check.valid || !check.userId) {
    throw new AuthError("INVALID_INPUT", RESET_TOKEN_MESSAGES[check.problem ?? "UNKNOWN"], "token");
  }

  const passwordHash = await hashPassword(newPassword);
  const tokenHash = hashResetToken(token);
  // Mark the token used in the same transaction as the password change, and only if it is still
  // unused, so two racing requests cannot both spend it.
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null },
      data: { usedAt: new Date(now()) },
    });
    if (consumed.count === 0) {
      throw new AuthError("INVALID_INPUT", RESET_TOKEN_MESSAGES.USED, "token");
    }
    await tx.user.update({ where: { id: check.userId }, data: { passwordHash } });
    // Any signed-in session that used the old password is no longer trusted.
    await tx.session.deleteMany({ where: { userId: check.userId } });
  });
  return { userId: check.userId, email: check.email ?? "" };
}

/** Housekeeping: drops tokens that are spent or long expired. Safe to call at any time. */
export async function purgeExpiredResetTokens(
  prisma: PrismaClient = requirePrisma(),
  options: { now?: () => number } = {},
): Promise<number> {
  const now = options.now ?? Date.now;
  const result = await prisma.passwordResetToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date(now()) } }, { usedAt: { not: null } }],
    },
  });
  return result.count;
}
