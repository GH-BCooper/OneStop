// DELETE /api/account/tokens/:id — revoke one personal access token (roadmap §2).
import { getPrisma, revokeAccessToken } from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", "Sign in to manage access tokens.");
  const { id } = await params;
  try {
    const revoked = await revokeAccessToken(userId, id, prisma);
    if (!revoked) return fail(404, "NOT_FOUND", "That token does not exist, or is already revoked.");
    return ok({ revoked: true });
  } catch (err) {
    return toErrorResponse(err, "api/account/tokens/[id]");
  }
}
