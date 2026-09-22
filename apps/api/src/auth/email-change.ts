// Changing the email on a signed-in account (account settings; issue: emails must be provably
// owned before a change takes effect).
//
// Two codes, not one: the first proves the person still controls the *current* mailbox (so a
// hijacked session alone cannot move the account to an attacker's address), the second proves they
// control the *new* one (so a typo can never lock the account out). The address only changes once
// both have been entered. Nothing here sends mail - callers do that with the code this returns, the
// same split as `signup-otp.ts`.
import { requirePrisma, type PrismaClient } from "../db/client.ts";
import { normalizeEmail, validateEmail } from "./emails.ts";
import { AuthError, toPublicUser, type PublicUser } from "./users.ts";
import {
  generateOtpCode,
  hashOtpCode,
  isWellFormedOtp,
  normalizeOtpInput,
  otpCodesMatch,
} from "./otp.ts";

export const EMAIL_CHANGE_CODE_TTL_MINUTES = 10;
export const EMAIL_CHANGE_MAX_ATTEMPTS = 5;
/** Minimum gap between two "start a change" requests for the same account. */
export const EMAIL_CHANGE_RESEND_SECONDS = 30;

function currentContext(userId: string): string {
  return `${userId}:email-change:current`;
}
function newContext(userId: string): string {
  return `${userId}:email-change:new`;
}

export interface EmailChangeStart {
  code: string;
  currentEmail: string;
  expiresAt: Date;
}

/**
 * Starts a change: validates the new address, stores the pending request and returns the code to
 * email to the account's *current* address. Throws `AuthError` for a bad address, one already in
 * use, one identical to the current address, or a restart requested too soon.
 */
export async function requestEmailChange(
  userId: string,
  newEmailInput: string,
  prisma: PrismaClient = requirePrisma(),
  options: { now?: () => number } = {},
): Promise<EmailChangeStart> {
  const now = options.now ?? Date.now;
  const emailProblem = validateEmail(newEmailInput);
  if (emailProblem) throw new AuthError("INVALID_INPUT", emailProblem, "newEmail");
  const newEmail = normalizeEmail(newEmailInput);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError("NOT_FOUND", "That account no longer exists.");
  if (newEmail === normalizeEmail(user.email)) {
    throw new AuthError(
      "INVALID_INPUT",
      "That is already this account's email address.",
      "newEmail",
    );
  }
  if (await prisma.user.findUnique({ where: { email: newEmail } })) {
    throw new AuthError("EMAIL_TAKEN", "That email already has an account.", "newEmail");
  }

  const pending = await prisma.emailChangeRequest.findUnique({ where: { userId } });
  if (pending) {
    const waitMs = pending.createdAt.getTime() + EMAIL_CHANGE_RESEND_SECONDS * 1000 - now();
    if (waitMs > 0) {
      throw new AuthError(
        "INVALID_INPUT",
        `A code was just sent. You can ask for another in ${Math.ceil(waitMs / 1000)} seconds.`,
        "newEmail",
      );
    }
  }

  const code = generateOtpCode();
  const expiresAt = new Date(now() + EMAIL_CHANGE_CODE_TTL_MINUTES * 60_000);
  const data = {
    newEmail,
    currentCodeHash: hashOtpCode(currentContext(userId), code),
    currentVerifiedAt: null,
    newCodeHash: null,
    attempts: 0,
    expiresAt,
    createdAt: new Date(now()),
  };
  await prisma.emailChangeRequest.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return { code, currentEmail: user.email, expiresAt };
}

const WRONG_CODE = "That code isn't right. Check the email and try again.";
const EXPIRED_CODE = "That code has expired. Start the email change again.";
const TOO_MANY = "Too many wrong codes. Start the email change again.";

export interface EmailChangeStepTwo {
  code: string;
  newEmail: string;
  expiresAt: Date;
}

/**
 * Checks the code sent to the *current* address. On success, issues the second code (for the new
 * address) and returns it for the caller to send. Throws `AuthError` (field `code`) otherwise.
 */
export async function confirmCurrentEmail(
  userId: string,
  codeInput: string,
  prisma: PrismaClient = requirePrisma(),
  options: { now?: () => number } = {},
): Promise<EmailChangeStepTwo> {
  const now = options.now ?? Date.now;
  const code = normalizeOtpInput(codeInput);
  if (!isWellFormedOtp(code)) {
    throw new AuthError("INVALID_INPUT", "Enter the 6-digit code from the email.", "code");
  }

  const pending = await prisma.emailChangeRequest.findUnique({ where: { userId } });
  if (!pending) throw new AuthError("INVALID_INPUT", EXPIRED_CODE, "code");
  if (pending.expiresAt.getTime() <= now()) {
    await prisma.emailChangeRequest.delete({ where: { userId } }).catch(() => null);
    throw new AuthError("INVALID_INPUT", EXPIRED_CODE, "code");
  }
  if (pending.attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
    throw new AuthError("INVALID_INPUT", TOO_MANY, "code");
  }
  if (!otpCodesMatch(pending.currentCodeHash, hashOtpCode(currentContext(userId), code))) {
    await prisma.emailChangeRequest.update({
      where: { userId },
      data: { attempts: { increment: 1 } },
    });
    throw new AuthError("INVALID_INPUT", WRONG_CODE, "code");
  }

  const newCode = generateOtpCode();
  const expiresAt = new Date(now() + EMAIL_CHANGE_CODE_TTL_MINUTES * 60_000);
  await prisma.emailChangeRequest.update({
    where: { userId },
    data: {
      currentVerifiedAt: new Date(now()),
      newCodeHash: hashOtpCode(newContext(userId), newCode),
      attempts: 0,
      expiresAt,
    },
  });
  return { code: newCode, newEmail: pending.newEmail, expiresAt };
}

/**
 * Checks the code sent to the *new* address and, on success, moves the account to it. Throws
 * `AuthError` (field `code`) for a wrong, expired or exhausted code, or if the current address has
 * not been confirmed yet.
 */
export async function confirmNewEmail(
  userId: string,
  codeInput: string,
  prisma: PrismaClient = requirePrisma(),
  options: { now?: () => number } = {},
): Promise<PublicUser> {
  const now = options.now ?? Date.now;
  const code = normalizeOtpInput(codeInput);
  if (!isWellFormedOtp(code)) {
    throw new AuthError("INVALID_INPUT", "Enter the 6-digit code from the email.", "code");
  }

  const pending = await prisma.emailChangeRequest.findUnique({ where: { userId } });
  if (!pending || !pending.currentVerifiedAt || !pending.newCodeHash) {
    throw new AuthError("INVALID_INPUT", EXPIRED_CODE, "code");
  }
  if (pending.expiresAt.getTime() <= now()) {
    await prisma.emailChangeRequest.delete({ where: { userId } }).catch(() => null);
    throw new AuthError("INVALID_INPUT", EXPIRED_CODE, "code");
  }
  if (pending.attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
    throw new AuthError("INVALID_INPUT", TOO_MANY, "code");
  }
  if (!otpCodesMatch(pending.newCodeHash, hashOtpCode(newContext(userId), code))) {
    await prisma.emailChangeRequest.update({
      where: { userId },
      data: { attempts: { increment: 1 } },
    });
    throw new AuthError("INVALID_INPUT", WRONG_CODE, "code");
  }

  if (await prisma.user.findUnique({ where: { email: pending.newEmail } })) {
    await prisma.emailChangeRequest.delete({ where: { userId } }).catch(() => null);
    throw new AuthError("EMAIL_TAKEN", "That email already has an account.", "newEmail");
  }

  const row = await prisma.user.update({
    where: { id: userId },
    data: { email: pending.newEmail, emailVerified: new Date(now()) },
  });
  await prisma.emailChangeRequest.delete({ where: { userId } }).catch(() => null);
  return toPublicUser(row as Parameters<typeof toPublicUser>[0]);
}

/** Drops a pending email change, e.g. after an email failed to send, or the person cancels. */
export async function discardEmailChange(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<void> {
  await prisma.emailChangeRequest.deleteMany({ where: { userId } });
}
