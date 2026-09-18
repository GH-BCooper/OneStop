// Normalising and checking email addresses for the auth flows (13-auth-database.md).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMAIL_MAX_LENGTH = 254;

/** Lower-cased and trimmed, so `A@B.com` and `a@b.com` are one account. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): string | undefined {
  const value = email.trim();
  if (!value) return "Enter your email address.";
  if (value.length > EMAIL_MAX_LENGTH) return "That email address is too long.";
  if (!EMAIL_RE.test(value)) return "Enter a valid email address.";
  return undefined;
}

export const NAME_MAX_LENGTH = 80;

export function validateName(name: string): string | undefined {
  const value = name.trim();
  if (!value) return "Enter your name.";
  if (value.length > NAME_MAX_LENGTH) return "That name is too long.";
  return undefined;
}
