// The signed-in user's own profile (13-auth-database.md).
//
//   GET    /api/account - profile + settings + a small job count
//   PATCH  /api/account - change the display name or the stored preferences
//   DELETE /api/account - delete the account (guest jobs stay, unlinked)
import {
  deleteAccount,
  findUserById,
  getJobStore,
  getPrisma,
  getUserSettings,
  updateProfile,
  updateUserSettings,
} from "@onestop/api";
import type { ThemePreference } from "@onestop/types";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to see your account.";

export async function GET(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const user = await findUserById(userId, prisma);
    if (!user) return fail(404, "NOT_FOUND", "That account no longer exists.");
    const [settings, jobs] = await Promise.all([
      getUserSettings(userId, prisma),
      getJobStore().list({ userId, limit: 100 }),
    ]);
    return ok({ user, settings, jobCount: jobs.length });
  } catch (err) {
    return toErrorResponse(err, "api/account");
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const user =
      typeof body.name === "string"
        ? await updateProfile(userId, { name: body.name }, prisma)
        : await findUserById(userId, prisma);
    const settings =
      typeof body.theme === "string" || "preferredAI" in body
        ? await updateUserSettings(
            userId,
            {
              ...(typeof body.theme === "string" ? { theme: body.theme as ThemePreference } : {}),
              ...("preferredAI" in body
                ? { preferredAI: typeof body.preferredAI === "string" ? body.preferredAI : null }
                : {}),
            },
            prisma,
          )
        : await getUserSettings(userId, prisma);
    return ok({ user, settings });
  } catch (err) {
    return toErrorResponse(err, "api/account");
  }
}

export async function DELETE(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    await deleteAccount(userId, prisma);
    return ok({ message: "Your account has been deleted." });
  } catch (err) {
    return toErrorResponse(err, "api/account");
  }
}
