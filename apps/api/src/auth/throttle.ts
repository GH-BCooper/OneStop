// Brute-force and mail-bombing limits for the account endpoints.
//
// In memory, per server process - the same trade-off `shared/rate-limit.ts` documents: exactly right
// for a personal instance, and a few extra guesses per instance on a multi-instance deploy. Only
// FAILED sign-ins are counted, so someone who types their password right is never slowed down, and
// a correct sign-in clears that address's failures.
import {
  clearRate,
  peekRate,
  recordHit,
  consumeRate,
  type RateLimit,
} from "../shared/rate-limit.ts";

const MINUTE = 60_000;

/** Wrong passwords tolerated for one email address before it is paused. */
export const LOGIN_FAILS_PER_EMAIL: RateLimit = { limit: 10, windowMs: 15 * MINUTE };
/** Wrong passwords tolerated from one address, across every email it tries. */
export const LOGIN_FAILS_PER_IP: RateLimit = { limit: 40, windowMs: 15 * MINUTE };
/** One reset (or sign-up) email per address per minute; the rest are answered but not sent. */
export const MAIL_COOLDOWN: RateLimit = { limit: 1, windowMs: MINUTE };
/** Emails one caller may trigger per hour, whoever they are addressed to. */
export const MAIL_PER_IP: RateLimit = { limit: 10, windowMs: 60 * MINUTE };

const emailKey = (email: string) => `login:e:${email.trim().toLowerCase().slice(0, 254)}`;
const ipKey = (ip: string | null) => `login:ip:${ip ?? "local"}`;

/** Seconds a sign-in attempt must wait, or null when it may proceed. */
export function loginBlockedFor(email: string, ip: string | null): number | null {
  const waits = [
    peekRate(emailKey(email), LOGIN_FAILS_PER_EMAIL),
    peekRate(ipKey(ip), LOGIN_FAILS_PER_IP),
  ].filter((w): w is number => w !== null);
  return waits.length > 0 ? Math.max(...waits) : null;
}

export function recordLoginFailure(email: string, ip: string | null): void {
  recordHit(emailKey(email), LOGIN_FAILS_PER_EMAIL);
  recordHit(ipKey(ip), LOGIN_FAILS_PER_IP);
}

export function clearLoginFailures(email: string): void {
  clearRate(emailKey(email));
}

/**
 * Whether an email may be sent for `email` on behalf of `ip` right now.
 * `"cooldown"` means "answer as if it worked, send nothing" (so the endpoint still cannot be used to
 * learn who has an account); `"blocked"` means the caller has asked for too many and gets a 429.
 */
export function mailRequestVerdict(
  kind: "reset" | "signup",
  email: string,
  ip: string | null,
): { verdict: "ok" } | { verdict: "cooldown" } | { verdict: "blocked"; retryAfterSeconds: number } {
  const perIp = consumeRate(`mail:ip:${ip ?? "local"}`, MAIL_PER_IP);
  if (perIp !== null) return { verdict: "blocked", retryAfterSeconds: perIp };
  const perEmail = consumeRate(
    `mail:${kind}:${email.trim().toLowerCase().slice(0, 254)}`,
    MAIL_COOLDOWN,
  );
  return perEmail === null ? { verdict: "ok" } : { verdict: "cooldown" };
}
