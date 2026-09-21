// Cross-device settings for the signed-in user (14-history-favorites.md).
//
//   GET   /api/settings - theme, preferred AI runtime and the small extras
//   PATCH /api/settings - change any of them
//
// A guest keeps the same preferences in localStorage (phase 02's theme key and the store below),
// and the Settings page offers to sign in so they follow the account instead. The columns are
// phase 13's `UserSettings`; this phase only starts writing to them.
import { getPrisma, getUserSettings, updateUserSettings } from "@onestop/api";
import type { ThemePreference } from "@onestop/types";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to sync your settings across devices.";
const THEMES: ThemePreference[] = ["light", "dark", "system"];
/** Keys the free-form `preferences` column accepts, so a client cannot fill it with anything. */
export const PREFERENCE_KEYS = [
  "aiSource",
  "defaultDownload",
  "confirmBeforeDelete",
  "saveHistory",
  "reduceMotion",
] as const;

/** Only known keys, and only small scalar values, ever reach the JSON column. */
export function cleanPreferences(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PREFERENCE_KEYS) {
    const item = source[key];
    if (typeof item === "boolean" || typeof item === "number") out[key] = item;
    else if (typeof item === "string") out[key] = item.slice(0, 100);
  }
  return out;
}

export async function GET(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    return ok({ settings: await getUserSettings(userId, prisma) });
  } catch (err) {
    return toErrorResponse(err, "api/settings");
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);

  const theme = typeof body.theme === "string" ? (body.theme as ThemePreference) : undefined;
  if (theme !== undefined && !THEMES.includes(theme)) {
    return fail(400, "INVALID_INPUT", "That is not a theme OneStop knows.", "theme");
  }
  try {
    const current = await getUserSettings(userId, prisma);
    const settings = await updateUserSettings(
      userId,
      {
        ...(theme ? { theme } : {}),
        ...("preferredAI" in body
          ? { preferredAI: typeof body.preferredAI === "string" ? body.preferredAI : null }
          : {}),
        // A patch merges: sending one preference never clears the others.
        ...("preferences" in body
          ? { preferences: { ...current.preferences, ...cleanPreferences(body.preferences) } }
          : {}),
      },
      prisma,
    );
    return ok({ settings });
  } catch (err) {
    return toErrorResponse(err, "api/settings");
  }
}
