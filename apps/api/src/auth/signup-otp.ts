// Email-verified sign-up (13-auth-database.md).
//
// Signing up is two steps, and the account only exists after the second:
//   1. `requestSignupCode` validates the form, stores the *pending* sign-up (name, bcrypt hash of the
//      password, HMAC of a random 6-digit code) and returns the code for the caller to email.
//   2. `verifySignupCode` checks the code the person typed back and only then creates the user.
//
// A six-digit code is a small search space, so it is never stored in clear (HMAC with the server
// secret), a code allows only a handful of wrong guesses, it expires quickly, and a new one cannot
// be requested in a tight loop. Nothing here is a login - the caller signs the person in afterwards.
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { requirePrisma, type PrismaClient } from "../db/client.ts";
import { normalizeEmail, validateEmail, validateName } from "./emails.ts";
import { hashPassword, validatePasswordStrength } from "./passwords.ts";
import { AuthError, toPublicUser, type PublicUser } from "./users.ts";

export const SIGNUP_CODE_TTL_MINUTES = 10;
export const SIGNUP_CODE_LENGTH = 6;
export const SIGNUP_MAX_ATTEMPTS = 5;
/** Minimum gap between two codes for the same address. */
export const SIGNUP_RESEND_SECONDS = 30;

export function generateSignupCode(): string {
  return String(randomInt(0, 10 ** SIGNUP_CODE_LENGTH)).padStart(SIGNUP_CODE_LENGTH, "0");
}

function secret(env: NodeJS.ProcessEnv = process.env): string {
  return env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim() || "onestop-dev-signup-secret";
}

/** HMAC of the code, bound to the address so one address's hash cannot be replayed for another. */
export function hashSignupCode(email: string, code: string): string {
  return createHmac("sha256", secret())
    .update(`${normalizeEmail(email)}:${code}`)
    .digest("hex");
}

function codesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface SignupCodeInput {
  name: string;
  email: string;
  password: string;
}

export interface SignupCodeRequest {
  /** The clear code - to be emailed once and then forgotten. */
  code: string;
  email: string;
  expiresAt: Date;
}

/**
 * Validates a sign-up and stores it as pending. Throws `AuthError` with a short, user-safe message
 * for a bad field, an address that already has an account, or a code requested too soon.
 */
export async function requestSignupCode(
  input: SignupCodeInput,
  prisma: PrismaClient = requirePrisma(),
  options: { now?: () => number } = {},
): Promise<SignupCodeRequest> {
  const now = options.now ?? Date.now;
  const nameProblem = validateName(input.name);
  if (nameProblem) throw new AuthError("INVALID_INPUT", nameProblem, "name");
  const emailProblem = validateEmail(input.email);
  if (emailProblem) throw new AuthError("INVALID_INPUT", emailProblem, "email");
  const passwordProblem = validatePasswordStrength(input.password);
  if (passwordProblem) throw new AuthError("INVALID_INPUT", passwordProblem, "password");

  const email = normalizeEmail(input.email);
  if (await prisma.user.findUnique({ where: { email } })) {
    throw new AuthError(
      "EMAIL_TAKEN",
      "That email already has an account. Sign in, or reset your password.",
      "email",
    );
  }

  const pending = await prisma.signupOtp.findUnique({ where: { email } });
  if (pending) {
    const waitMs = pending.createdAt.getTime() + SIGNUP_RESEND_SECONDS * 1000 - now();
    if (waitMs > 0) {
      throw new AuthError(
        "INVALID_INPUT",
        `A code was just sent. You can ask for another in ${Math.ceil(waitMs / 1000)} seconds.`,
        "email",
      );
    }
  }

  const code = generateSignupCode();
  const expiresAt = new Date(now() + SIGNUP_CODE_TTL_MINUTES * 60_000);
  const data = {
    name: input.name.trim(),
    passwordHash: await hashPassword(input.password),
    codeHash: hashSignupCode(email, code),
    attempts: 0,
    expiresAt,
    createdAt: new Date(now()),
  };
  await prisma.signupOtp.upsert({ where: { email }, create: { email, ...data }, update: data });
  return { code, email, expiresAt };
}

/** Drops a pending sign-up whose email could not be sent, so the person can simply try again. */
export async function discardSignupCode(
  email: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<void> {
  await prisma.signupOtp.deleteMany({ where: { email: normalizeEmail(email) } });
}

const WRONG_CODE = "That code isn't right. Check the email and try again.";
const EXPIRED_CODE = "That code has expired. Go back and request a new one.";
const TOO_MANY = "Too many wrong codes. Go back and request a new one.";

/**
 * Checks the typed code and, when it matches, creates the account and clears the pending row.
 * Throws `AuthError` (field `code`) for a wrong, expired or exhausted code.
 */
export async function verifySignupCode(
  emailInput: string,
  codeInput: string,
  prisma: PrismaClient = requirePrisma(),
  options: { now?: () => number } = {},
): Promise<PublicUser> {
  const now = options.now ?? Date.now;
  const email = normalizeEmail(emailInput);
  const code = codeInput.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${SIGNUP_CODE_LENGTH}}$`).test(code)) {
    throw new AuthError(
      "INVALID_INPUT",
      `Enter the ${SIGNUP_CODE_LENGTH}-digit code from the email.`,
      "code",
    );
  }

  const pending = await prisma.signupOtp.findUnique({ where: { email } });
  if (!pending) throw new AuthError("INVALID_INPUT", EXPIRED_CODE, "code");
  if (pending.expiresAt.getTime() <= now()) {
    await prisma.signupOtp.delete({ where: { email } }).catch(() => null);
    throw new AuthError("INVALID_INPUT", EXPIRED_CODE, "code");
  }
  if (pending.attempts >= SIGNUP_MAX_ATTEMPTS)
    throw new AuthError("INVALID_INPUT", TOO_MANY, "code");

  if (!codesMatch(pending.codeHash, hashSignupCode(email, code))) {
    await prisma.signupOtp.update({ where: { email }, data: { attempts: { increment: 1 } } });
    throw new AuthError("INVALID_INPUT", WRONG_CODE, "code");
  }

  // Someone may have finished a Google sign-in for this address while the code was in the post.
  if (await prisma.user.findUnique({ where: { email } })) {
    await prisma.signupOtp.delete({ where: { email } }).catch(() => null);
    throw new AuthError(
      "EMAIL_TAKEN",
      "That email already has an account. Sign in, or reset your password.",
      "email",
    );
  }

  const row = await prisma.user.create({
    data: {
      email,
      name: pending.name,
      passwordHash: pending.passwordHash,
      // The person just proved they can read this mailbox.
      emailVerified: new Date(now()),
      settings: { create: {} },
    },
  });
  await prisma.signupOtp.delete({ where: { email } }).catch(() => null);
  return toPublicUser(row as Parameters<typeof toPublicUser>[0]);
}
