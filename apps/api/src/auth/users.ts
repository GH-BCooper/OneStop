// Account creation, sign-in checks and profile updates (13-auth-database.md).
//
// Every function here is a plain async function over Prisma: the Next.js routes and the Auth.js
// callbacks call these, never Prisma directly.
import { requirePrisma, type PrismaClient } from "../db/client.ts";
import { normalizeEmail, validateEmail, validateName } from "./emails.ts";
import { hashPassword, validatePasswordStrength, verifyPassword } from "./passwords.ts";

/** What the app is allowed to know about a user. Never includes the password hash. */
export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  createdAt: string;
  /** True when the account can sign in with a password (false for Google-only accounts). */
  hasPassword: boolean;
}

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  passwordHash: string | null;
  createdAt: Date;
};

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    createdAt: row.createdAt.toISOString(),
    hasPassword: row.passwordHash !== null,
  };
}

export class AuthError extends Error {
  constructor(
    readonly code:
      "INVALID_INPUT" | "EMAIL_TAKEN" | "INVALID_CREDENTIALS" | "NOT_FOUND" | "NO_PASSWORD",
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

/** Creates an email/password account. Throws `AuthError` with a short, user-safe message. */
export async function signUp(
  input: SignUpInput,
  prisma: PrismaClient = requirePrisma(),
): Promise<PublicUser> {
  const nameProblem = validateName(input.name);
  if (nameProblem) throw new AuthError("INVALID_INPUT", nameProblem, "name");
  const emailProblem = validateEmail(input.email);
  if (emailProblem) throw new AuthError("INVALID_INPUT", emailProblem, "email");
  const passwordProblem = validatePasswordStrength(input.password);
  if (passwordProblem) throw new AuthError("INVALID_INPUT", passwordProblem, "password");

  const email = normalizeEmail(input.email);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // The account may exist from a Google sign-in; either way, adding a password here without
    // proving ownership of the mailbox would be an account takeover. Point at the reset flow.
    throw new AuthError(
      "EMAIL_TAKEN",
      "That email already has an account. Sign in, or reset your password.",
      "email",
    );
  }

  const row = await prisma.user.create({
    data: {
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      settings: { create: {} },
    },
  });
  return toPublicUser(row as UserRow);
}

/** Checks an email/password pair. Returns the user, or throws a single generic AuthError. */
export async function verifyCredentials(
  email: string,
  password: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<PublicUser> {
  const generic = new AuthError("INVALID_CREDENTIALS", "That email or password is incorrect.");
  if (validateEmail(email) || !password) throw generic;
  const row = (await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  })) as UserRow | null;
  const ok = await verifyPassword(password, row?.passwordHash ?? null);
  if (!row || !ok) throw generic;
  return toPublicUser(row);
}

export async function findUserById(
  id: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<PublicUser | null> {
  const row = (await prisma.user.findUnique({ where: { id } })) as UserRow | null;
  return row ? toPublicUser(row) : null;
}

export async function findUserByEmail(
  email: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<PublicUser | null> {
  const row = (await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  })) as UserRow | null;
  return row ? toPublicUser(row) : null;
}

/** Updates the display name. The email is the account key, so it is not editable here. */
export async function updateProfile(
  userId: string,
  patch: { name?: string },
  prisma: PrismaClient = requirePrisma(),
): Promise<PublicUser> {
  if (patch.name !== undefined) {
    const problem = validateName(patch.name);
    if (problem) throw new AuthError("INVALID_INPUT", problem, "name");
  }
  const row = (await prisma.user
    .update({
      where: { id: userId },
      data: { ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) },
    })
    .catch(() => null)) as UserRow | null;
  if (!row) throw new AuthError("NOT_FOUND", "That account no longer exists.");
  return toPublicUser(row);
}

/** Changes the password of a signed-in user, after checking the current one. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<void> {
  const row = (await prisma.user.findUnique({ where: { id: userId } })) as UserRow | null;
  if (!row) throw new AuthError("NOT_FOUND", "That account no longer exists.");
  if (!row.passwordHash) {
    throw new AuthError(
      "NO_PASSWORD",
      "This account signs in with Google. Use \u201cForgot password\u201d to add one.",
      "currentPassword",
    );
  }
  if (!(await verifyPassword(currentPassword, row.passwordHash))) {
    throw new AuthError("INVALID_CREDENTIALS", "That password is incorrect.", "currentPassword");
  }
  const problem = validatePasswordStrength(newPassword);
  if (problem) throw new AuthError("INVALID_INPUT", problem, "newPassword");
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}

/** Deletes the account and everything that cascades from it (jobs are unlinked, not deleted). */
export async function deleteAccount(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch(() => null);
}
