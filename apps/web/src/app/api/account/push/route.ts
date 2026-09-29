// Outbound push notifications via ntfy (21-roadmap-expansion.md, roadmap §2).
//
//   GET    /api/account/push - the current setting (topic included, since it is the user's own)
//   PUT    /api/account/push - { enabled, topic, server?, types? } saves it
//   POST   /api/account/push - sends a test message to the saved topic
//   DELETE /api/account/push - forgets it entirely
//
// Opt-in and clearly disclosed: the title and body of a notification leave this machine when it is
// on. The in-app bell keeps working either way, with no network at all.
import {
  NTFY_DEFAULT_SERVER,
  getPrisma,
  getUserSettings,
  isValidTopic,
  readNtfyPreference,
  updateUserSettings,
  sendNtfy,
} from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to set up push notifications.";
const PREF_KEY = "ntfy";

async function load(userId: string, prisma: ReturnType<typeof getPrisma>) {
  const settings = await getUserSettings(userId, prisma!);
  return { settings, ntfy: readNtfyPreference(settings.preferences) };
}

export async function GET(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const { ntfy } = await load(userId, prisma);
    return ok({ push: ntfy, defaultServer: NTFY_DEFAULT_SERVER });
  } catch (err) {
    return toErrorResponse(err, "api/account/push");
  }
}

export async function PUT(request: Request): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!isValidTopic(topic)) {
    return fail(
      400,
      "INVALID_INPUT",
      "A topic is 6–64 letters, numbers, hyphens or underscores. Pick something unguessable — anyone who knows it can read your notifications.",
    );
  }
  try {
    const { settings } = await load(userId, prisma);
    await updateUserSettings(
      userId,
      {
        preferences: {
          ...settings.preferences,
          [PREF_KEY]: {
            enabled: body.enabled === true,
            topic,
            ...(typeof body.server === "string" && body.server.trim() !== "" ? { server: body.server.trim() } : {}),
            ...(Array.isArray(body.types) ? { types: body.types.filter((t) => typeof t === "string").slice(0, 8) } : {}),
          },
        },
      },
      prisma,
    );
    return ok({ saved: true });
  } catch (err) {
    return toErrorResponse(err, "api/account/push");
  }
}

export async function POST(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const { ntfy } = await load(userId, prisma);
    if (!ntfy) return fail(400, "INVALID_INPUT", "Save a topic first.");
    const result = await sendNtfy(
      { ...ntfy, enabled: true },
      {
        title: "OneStop test notification",
        body: "If you can read this on your phone, push notifications are wired up correctly.",
        tags: ["white_check_mark"],
      },
    );
    return result.sent
      ? ok({ sent: true })
      : fail(502, "FAILED", result.reason ?? "The test message could not be delivered.");
  } catch (err) {
    return toErrorResponse(err, "api/account/push");
  }
}

export async function DELETE(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const { settings } = await load(userId, prisma);
    const next = { ...settings.preferences };
    delete next[PREF_KEY];
    await updateUserSettings(userId, { preferences: next }, prisma);
    return ok({ removed: true });
  } catch (err) {
    return toErrorResponse(err, "api/account/push");
  }
}
