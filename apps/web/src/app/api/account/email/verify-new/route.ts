// POST /api/account/email/verify-new — step two of an email change (account settings).
//
// Checks the code sent to the *new* address and, only then, moves the account to it.
import { confirmNewEmail, getPrisma } from "@onestop/api";
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
  if (!userId) return fail(401, "AUTH_REQUIRED", "Sign in to change your email.");

  try {
    const user = await confirmNewEmail(userId, str(body, "code"), prisma);
    return ok({ user, message: "Your email address has been changed." });
  } catch (err) {
    return toErrorResponse(err, "api/account/email/verify-new");
  }
}
