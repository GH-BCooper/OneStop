// Outbound push notifications via ntfy (21-roadmap-expansion.md, roadmap §2 and §4).
//
// `ntfy.sh` is a free, Apache-2.0, account-free publish/subscribe relay: you pick an unguessable
// topic name, subscribe a phone to it, and a plain HTTP POST reaches that phone with the tab closed.
// It is *purely additive*: the in-app bell already works with zero network, and nothing here is on
// by default. A failure to deliver is logged and swallowed, never allowed to fail the job that
// triggered it — an automation that ran fine must not report as broken because a phone was offline.
//
// Disclosure matters here (CLAUDE.md §2.1): the title and body of a notification leave the machine,
// so the UI says so plainly and the topic is treated as a secret, since anyone who knows a topic
// name can read it. A self-hosted ntfy server is supported with one env var, for anyone who would
// rather not use the public one.
import { requirePrisma, type PrismaClient } from "../db/index.ts";

export const NTFY_DEFAULT_SERVER = "https://ntfy.sh";

/** Where a per-user ntfy topic lives: inside the existing `UserSettings.preferences` JSON blob. */
export const NTFY_PREFERENCE_KEY = "ntfy";

export interface NtfyPreference {
  enabled: boolean;
  /** The topic name. Treated as a secret: anyone who knows it can read the messages. */
  topic: string;
  /** A self-hosted server, or the public one. */
  server?: string;
  /** Only send for these notification types; empty means all of them. */
  types?: string[];
}

export function ntfyServer(preference: Pick<NtfyPreference, "server">): string {
  const raw = (preference.server ?? process.env.NTFY_SERVER ?? NTFY_DEFAULT_SERVER).trim();
  const cleaned = raw.replace(/\/+$/, "");
  // Only http(s), and never a bare hostname that could be read as a path.
  return /^https?:\/\/[^\s/]+/.test(cleaned) ? cleaned : NTFY_DEFAULT_SERVER;
}

/** ntfy topics are path segments, so anything that is not one is refused rather than escaped. */
export function isValidTopic(topic: string): boolean {
  return /^[A-Za-z0-9_-]{6,64}$/.test(topic);
}

export function readNtfyPreference(preferences: unknown): NtfyPreference | null {
  if (!preferences || typeof preferences !== "object") return null;
  const raw = (preferences as Record<string, unknown>)[NTFY_PREFERENCE_KEY];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<NtfyPreference>;
  if (typeof value.topic !== "string" || !isValidTopic(value.topic)) return null;
  return {
    enabled: value.enabled === true,
    topic: value.topic,
    ...(typeof value.server === "string" ? { server: value.server } : {}),
    ...(Array.isArray(value.types) ? { types: value.types.filter((t): t is string => typeof t === "string") } : {}),
  };
}

export interface OutboundMessage {
  title: string;
  body?: string | null;
  /** Turned into an ntfy "view" action the phone can tap. */
  link?: string | null;
  type?: string;
  priority?: "min" | "low" | "default" | "high" | "urgent";
  tags?: string[];
}

export interface SendResult {
  sent: boolean;
  /** Why it was not sent, for the caller's log and for the "test" button's message. */
  reason?: string;
}

const TIMEOUT_MS = 10_000;

/** Posts one message to a topic. Never throws: delivery is best-effort by design. */
export async function sendNtfy(
  preference: NtfyPreference,
  message: OutboundMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  if (!preference.enabled) return { sent: false, reason: "Push notifications are switched off." };
  if (!isValidTopic(preference.topic)) return { sent: false, reason: "That topic name is not valid." };
  if (message.type && preference.types && preference.types.length > 0 && !preference.types.includes(message.type)) {
    return { sent: false, reason: "This notification type is not one you asked to be pushed." };
  }
  const server = ntfyServer(preference);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetchImpl(`${server}/${preference.topic}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        // Headers, not JSON: ntfy's simplest form, and it keeps the body as the literal message.
        // Non-ASCII has to be encoded, because HTTP headers are latin-1 only.
        Title: encodeHeader(message.title.slice(0, 200)),
        Priority: message.priority ?? "default",
        Tags: (message.tags ?? ["onestop"]).join(","),
        ...(message.link ? { Actions: `view, Open in OneStop, ${message.link}` } : {}),
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: (message.body ?? message.title).slice(0, 2000),
    });
    if (!response.ok) {
      return { sent: false, reason: `The notification server refused it (HTTP ${response.status}).` };
    }
    return { sent: true };
  } catch (err) {
    console.error("[automation:ntfy] delivery failed", err);
    return {
      sent: false,
      reason: controller.signal.aborted
        ? "The notification server did not answer in time."
        : "The notification server could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** ntfy reads RFC 2047 encoded-words in its header fields, which is how a non-ASCII title survives. */
export function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * The bridge: after an in-app notification is written, mirror it outward when the user opted in.
 * Called by `pushNotification`, so every existing caller gets push for free without knowing about it.
 */
export async function mirrorToPush(
  userId: string,
  message: OutboundMessage,
  prisma: PrismaClient = requirePrisma(),
): Promise<SendResult> {
  let preference: NtfyPreference | null;
  try {
    const row = (await prisma.userSettings.findUnique({
      where: { userId },
      select: { preferences: true },
    })) as { preferences: unknown } | null;
    preference = readNtfyPreference(row?.preferences);
  } catch (err) {
    console.error("[automation:ntfy] could not read the push preference", err);
    return { sent: false, reason: "The push preference could not be read." };
  }
  if (!preference?.enabled) return { sent: false, reason: "Push notifications are switched off." };
  return sendNtfy(preference, message);
}
