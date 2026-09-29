// Personal access tokens (21-roadmap-expansion.md, roadmap §2).
//
//   GET  /api/account/tokens - this user's tokens, newest first (never the token itself)
//   POST /api/account/tokens - { name, expiresInDays? } creates one and returns it exactly once
//
// A token lets the owner's own scripts call POST /api/tools/run from outside the browser. It is
// additive to session-cookie auth, and acts only as its owner.
import { AccessTokenError, createAccessToken, getPrisma, listAccessTokens } from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to manage access tokens.";

export async function GET(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    return ok({ tokens: await listAccessTokens(userId, prisma) });
  } catch (err) {
    return toErrorResponse(err, "api/account/tokens");
  }
}

export async function POST(request: Request): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  try {
    const expires = body.expiresInDays;
    const { record, token } = await createAccessToken(
      userId,
      {
        name: typeof body.name === "string" ? body.name : "",
        expiresInDays: typeof expires === "number" ? expires : null,
      },
      prisma,
    );
    // The only time the token itself is ever sent anywhere.
    return ok({ token, record, once: true }, 201);
  } catch (err) {
    if (err instanceof AccessTokenError) return fail(err.status, "INVALID_INPUT", err.message);
    return toErrorResponse(err, "api/account/tokens");
  }
}
