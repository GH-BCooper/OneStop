// POST /api/account/email/verify-current — step one of an email change (account settings).
//
// Checks the code sent to the account's *current* address and, on success, emails the second code
// to the new address. The address itself does not change until `/verify-new` also succeeds.
import {
  canDeliverMail,
  confirmCurrentEmail,
  discardEmailChange,
  emailChangeNewEmail,
  EMAIL_CHANGE_CODE_TTL_MINUTES,
  getPrisma,
  MAIL_NOT_CONFIGURED_MESSAGE,
  sendMail,
} from "@onestop/api";
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
  if (!canDeliverMail()) return fail(503, "MAIL_UNAVAILABLE", MAIL_NOT_CONFIGURED_MESSAGE);

  try {
    const step = await confirmCurrentEmail(userId, str(body, "code"), prisma);
    const result = await sendMail({
      to: step.newEmail,
      ...emailChangeNewEmail(step.code, step.expiresAt),
    });
    if (!result.delivered) {
      await discardEmailChange(userId, prisma);
      return fail(
        502,
        "MAIL_FAILED",
        "We couldn't send the verification email to the new address. Start again.",
      );
    }
    return ok({
      expiresInMinutes: EMAIL_CHANGE_CODE_TTL_MINUTES,
      message: `We sent a 6-digit code to ${step.newEmail}.`,
    });
  } catch (err) {
    return toErrorResponse(err, "api/account/email/verify-current");
  }
}
