// Password reset, step two (13-auth-database.md).
//
//   GET  /api/auth/reset/confirm?token=... - is this link still usable? (so the page can say so
//                                            before the visitor types a new password)
//   POST /api/auth/reset/confirm           - spend the token and set the new password.
import {
  checkResetToken,
  getPrisma,
  RESET_TOKEN_MESSAGES,
  resetPasswordWithToken,
} from "@onestop/api";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, str, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  try {
    const check = await checkResetToken(token, prisma);
    return ok({
      valid: check.valid,
      ...(check.valid ? {} : { reason: RESET_TOKEN_MESSAGES[check.problem ?? "UNKNOWN"] }),
    });
  } catch (err) {
    return toErrorResponse(err, "api/auth/reset/confirm");
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  try {
    const { email } = await resetPasswordWithToken(
      str(body, "token"),
      str(body, "password"),
      prisma,
    );
    // The address comes back so the browser can sign the person straight in with the new password.
    return ok({ message: "Your password has been changed.", email });
  } catch (err) {
    return toErrorResponse(err, "api/auth/reset/confirm");
  }
}
