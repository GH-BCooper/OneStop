// Password hashing (13-auth-database.md).
//
// bcrypt via `bcryptjs`: a pure-JS implementation, so there is no native build step on any
// platform and nothing to pay for. The stored value is a salted, one-way bcrypt hash - never the
// password, never anything reversible (master plan §15). The file-integrity hashes in
// `dev-utils/hashing.ts` are deliberately NOT used here: they are fast by design, which is the
// opposite of what a password needs.
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

/** Work factor. 12 is ~250 ms on a typical laptop: slow for an attacker, fine for a login. */
export const BCRYPT_COST = 12;

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt only reads the first 72 bytes; reject longer input instead of silently truncating. */
export const PASSWORD_MAX_LENGTH = 72;

export function validatePasswordStrength(password: string): string | undefined {
  if (!password) return "Enter a password.";
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_LENGTH)
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  return undefined;
}

export async function hashPassword(password: string): Promise<string> {
  const problem = validatePasswordStrength(password);
  if (problem) throw new Error(problem);
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Verification. When the account does not exist or has no password (Google-only sign-up), the
 * same amount of bcrypt work is still done, so an unknown email and a wrong password take the
 * same time and neither reveals which accounts exist.
 */
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!password) return false;
  try {
    if (!hash) {
      await bcrypt.hash(randomUUID(), BCRYPT_COST);
      return false;
    }
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/** True when the value looks like a bcrypt hash rather than a password someone stored raw. */
export function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value);
}
