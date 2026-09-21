// POST /api/auth/signup/verify - step two of email-verified sign-up (13-auth-database.md).
//
// The person typed back the code from their email. Only when it matches is the account created;
// signing in afterwards is a separate call to Auth.js from the browser.
import { getPrisma, verifySignupCode } from "@onestop/api";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, str, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");

  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);

  try {
    const user = await verifySignupCode(str(body, "email"), str(body, "code"), prisma);
    return ok({ user }, 201);
  } catch (err) {
    return toErrorResponse(err, "api/auth/signup/verify");
  }
}
