// Starting (and cancelling) an email change (account settings).
//
//   POST   /api/account/email - validates the new address and emails a code to the *current* one.
//   DELETE /api/account/email - cancels a pending change.
//
// The address itself only changes once both `/verify-current` and `/verify-new` have succeeded.
import {
  canDeliverMail,
  discardEmailChange,
  emailChangeCurrentEmail,
  EMAIL_CHANGE_CODE_TTL_MINUTES,
  getPrisma,
  MAIL_NOT_CONFIGURED_MESSAGE,
  requestEmailChange,
  sendMail,
} from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, str, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to change your email.";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  if (!canDeliverMail()) return fail(503, "MAIL_UNAVAILABLE", MAIL_NOT_CONFIGURED_MESSAGE);

  try {
    const pending = await requestEmailChange(userId, str(body, "newEmail"), prisma);
    const result = await sendMail({
      to: pending.currentEmail,
      ...emailChangeCurrentEmail(pending.code, pending.expiresAt),
    });
    if (!result.delivered) {
      await discardEmailChange(userId, prisma);
      return fail(
        502,
        "MAIL_FAILED",
        "We couldn't send the verification email. Try again in a moment.",
      );
    }
    return ok({
      expiresInMinutes: EMAIL_CHANGE_CODE_TTL_MINUTES,
      message: `We sent a 6-digit code to ${pending.currentEmail}.`,
    });
  } catch (err) {
    return toErrorResponse(err, "api/account/email");
  }
}

export async function DELETE(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  await discardEmailChange(userId, prisma);
  return ok({ message: "Email change cancelled." });
}
