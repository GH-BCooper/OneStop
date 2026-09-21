// POST /api/auth/signup - step one of email-verified sign-up (13-auth-database.md).
//
// Nothing is created here. The form is validated, the sign-up is parked as pending, and a 6-digit
// code is emailed to the address. The account only comes into existence when that code is sent to
// `/api/auth/signup/verify`, so an address the person cannot read can never become an account.
import {
  canDeliverMail,
  discardSignupCode,
  getPrisma,
  MAIL_NOT_CONFIGURED_MESSAGE,
  requestSignupCode,
  SIGNUP_CODE_TTL_MINUTES,
  sendMail,
  signupCodeEmail,
} from "@onestop/api";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, str, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");

  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  // Nothing about the person is looked at yet: a server that cannot send email says so first.
  if (!canDeliverMail()) return fail(503, "MAIL_UNAVAILABLE", MAIL_NOT_CONFIGURED_MESSAGE);

  try {
    const pending = await requestSignupCode(
      { name: str(body, "name"), email: str(body, "email"), password: str(body, "password") },
      prisma,
    );
    const result = await sendMail({
      to: pending.email,
      ...signupCodeEmail(pending.code, pending.expiresAt),
    });
    if (!result.delivered) {
      // Drop the parked sign-up so the person can simply try again straight away.
      await discardSignupCode(pending.email, prisma);
      return fail(
        502,
        "MAIL_FAILED",
        "We couldn't send the verification email. Check the address and try again in a moment.",
      );
    }
    return ok({
      email: pending.email,
      expiresInMinutes: SIGNUP_CODE_TTL_MINUTES,
      // Only `console` (a developer's machine with no mail provider) needs the UI to say more.
      transport: result.transport,
      message: `We sent a 6-digit code to ${pending.email}.`,
    });
  } catch (err) {
    return toErrorResponse(err, "api/auth/signup");
  }
}
