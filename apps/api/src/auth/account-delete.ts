// Deleting a signed-in account (account settings; issue: one click deleted an account outright).
//
// Deletion is irreversible, so it needs the same emailed-code proof of mailbox ownership as an
// email change: a stolen or left-open session alone is not enough to destroy the account.
import { requirePrisma, type PrismaClient } from "../db/client.ts";
import { deleteAccount } from "./users.ts";
import {
  generateOtpCode,
  hashOtpCode,
  isWellFormedOtp,
  normalizeOtpInput,
  otpCodesMatch,
} from "./otp.ts";
import { AuthError } from "./users.ts";

export const ACCOUNT_DELETE_CODE_TTL_MINUTES = 10;
export const ACCOUNT_DELETE_MAX_ATTEMPTS = 5;
export const ACCOUNT_DELETE_RESEND_SECONDS = 30;

function context(userId: string): string {
  return `${userId}:account-delete`;
}

export interface AccountDeleteStart {
  code: string;
  email: string;
  expiresAt: Date;
}

/** Starts a deletion: stores the pending code and returns it for the caller to email. */
export async function requestAccountDeletion(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
  options: { now?: () => number } = {},
): Promise<AccountDeleteStart> {
  const now = options.now ?? Date.now;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError("NOT_FOUND", "That account no longer exists.");

  const pending = await prisma.accountDeleteOtp.findUnique({ where: { userId } });
  if (pending) {
    const waitMs = pending.createdAt.getTime() + ACCOUNT_DELETE_RESEND_SECONDS * 1000 - now();
    if (waitMs > 0) {
      throw new AuthError(
        "INVALID_INPUT",
        `A code was just sent. You can ask for another in ${Math.ceil(waitMs / 1000)} seconds.`,
      );
    }
  }

  const code = generateOtpCode();
  const expiresAt = new Date(now() + ACCOUNT_DELETE_CODE_TTL_MINUTES * 60_000);
  const data = {
    codeHash: hashOtpCode(context(userId), code),
    attempts: 0,
    expiresAt,
    createdAt: new Date(now()),
  };
  await prisma.accountDeleteOtp.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return { code, email: user.email, expiresAt };
}

const WRONG_CODE = "That code isn't right. Check the email and try again.";
const EXPIRED_CODE = "That code has expired. Ask for a new one.";
const TOO_MANY = "Too many wrong codes. Ask for a new one.";

/** Checks the code and, on success, permanently deletes the account. */
export async function confirmAccountDeletion(
  userId: string,
  codeInput: string,
  prisma: PrismaClient = requirePrisma(),
  options: { now?: () => number } = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const code = normalizeOtpInput(codeInput);
  if (!isWellFormedOtp(code)) {
    throw new AuthError("INVALID_INPUT", "Enter the 6-digit code from the email.", "code");
  }

  const pending = await prisma.accountDeleteOtp.findUnique({ where: { userId } });
  if (!pending) throw new AuthError("INVALID_INPUT", EXPIRED_CODE, "code");
  if (pending.expiresAt.getTime() <= now()) {
    await prisma.accountDeleteOtp.delete({ where: { userId } }).catch(() => null);
    throw new AuthError("INVALID_INPUT", EXPIRED_CODE, "code");
  }
  if (pending.attempts >= ACCOUNT_DELETE_MAX_ATTEMPTS) {
    throw new AuthError("INVALID_INPUT", TOO_MANY, "code");
  }
  if (!otpCodesMatch(pending.codeHash, hashOtpCode(context(userId), code))) {
    await prisma.accountDeleteOtp.update({
      where: { userId },
      data: { attempts: { increment: 1 } },
    });
    throw new AuthError("INVALID_INPUT", WRONG_CODE, "code");
  }

  // Cascades to the otp row itself, so no separate cleanup is needed.
  await deleteAccount(userId, prisma);
}

/** Drops a pending deletion, e.g. after the email failed to send, or the person cancels. */
export async function discardAccountDeletion(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<void> {
  await prisma.accountDeleteOtp.deleteMany({ where: { userId } });
}
