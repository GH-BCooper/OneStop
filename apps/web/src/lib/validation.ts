// Client-side form validation for the auth pages.
// The server re-validates everything (apps/api/src/auth); this is only for fast feedback.

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export const PASSWORD_MIN_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | undefined {
  if (!email.trim()) return "Enter your email address.";
  if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address.";
  return undefined;
}

export function validatePassword(password: string): string | undefined {
  if (!password) return "Enter a password.";
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  return undefined;
}

function compact<K extends string>(errors: Record<K, string | undefined>): FieldErrors<K> {
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) as FieldErrors<K>;
}

export function validateLogin(v: { email: string; password: string }) {
  return compact({
    email: validateEmail(v.email),
    password: v.password ? undefined : "Enter your password.",
  });
}

export function validateSignup(v: {
  name: string;
  email: string;
  password: string;
  confirm: string;
}) {
  return compact({
    name: v.name.trim() ? undefined : "Enter your name.",
    email: validateEmail(v.email),
    password: validatePassword(v.password),
    confirm: v.confirm === v.password ? undefined : "Passwords don't match.",
  });
}

export function validateResetRequest(v: { email: string }) {
  return compact({ email: validateEmail(v.email) });
}

export function validateNewPassword(v: { password: string; confirm: string }) {
  return compact({
    password: validatePassword(v.password),
    confirm: v.confirm === v.password ? undefined : "Passwords don't match.",
  });
}

export function validateVerifyCode(v: { code: string }) {
  return compact({
    code: /^\d{6}$/.test(v.code.trim()) ? undefined : "Enter the 6-digit code from the email.",
  });
}

export function validatePasswordChange(v: {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}) {
  return compact({
    currentPassword: v.currentPassword ? undefined : "Enter your current password.",
    newPassword: validatePassword(v.newPassword),
    confirm: v.confirm === v.newPassword ? undefined : "Passwords don't match.",
  });
}
