// POST /api/auth/signup - create an email/password account (13-auth-database.md).
//
// The password is hashed with bcrypt before it reaches the database; nothing here ever stores or
// logs it. Signing in afterwards is a separate call to Auth.js from the browser.
import { getPrisma, signUp } from "@onestop/api";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, str, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");

  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);

  try {
    const user = await signUp(
      { name: str(body, "name"), email: str(body, "email"), password: str(body, "password") },
      prisma,
    );
    return ok({ user }, 201);
  } catch (err) {
    return toErrorResponse(err, "api/auth/signup");
  }
}
