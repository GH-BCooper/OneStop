// POST /api/account/delete/confirm — the actual, irreversible deletion (account settings).
// Requires the code `/api/account/delete` emailed, so a stolen or left-open session alone cannot
// destroy the account.
import { confirmAccountDeletion, getPrisma } from "@onestop/api";
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
  if (!userId) return fail(401, "AUTH_REQUIRED", "Sign in to delete your account.");

  try {
    await confirmAccountDeletion(userId, str(body, "code"), prisma);
    return ok({ message: "Your account has been deleted." });
  } catch (err) {
    return toErrorResponse(err, "api/account/delete/confirm");
  }
}
