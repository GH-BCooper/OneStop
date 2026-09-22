// A small shared helper for the emailed-code checks used across auth flows (13-auth-database.md;
// sign-up verification, email change, account deletion). Never stores a code in clear: only its
// HMAC, bound to a context string so one flow's code can never be replayed against another.
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_CODE_LENGTH = 6;

export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, "0");
}

function secret(env: NodeJS.ProcessEnv = process.env): string {
  return env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim() || "onestop-dev-signup-secret";
}

/** HMAC of the code, bound to `context` (e.g. `${userId}:email-change:current`). */
export function hashOtpCode(context: string, code: string): string {
  return createHmac("sha256", secret()).update(`${context}:${code}`).digest("hex");
}

export function otpCodesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function normalizeOtpInput(code: string): string {
  return code.replace(/\s+/g, "");
}

export function isWellFormedOtp(code: string): boolean {
  return new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test(code);
}
