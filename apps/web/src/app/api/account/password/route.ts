// POST /api/account/password - change the password of the signed-in user (13-auth-database.md).
// The current password must be supplied, so a borrowed session cannot lock the owner out.
import { changePassword, getPrisma } from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, str, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", "Sign in to change your password.");
  try {
    await changePassword(userId, str(body, "currentPassword"), str(body, "newPassword"), prisma);
    return ok({ message: "Your password has been changed." });
  } catch (err) {
    return toErrorResponse(err, "api/account/password");
  }
}
