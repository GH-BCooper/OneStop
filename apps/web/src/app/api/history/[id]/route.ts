// One history entry (14-history-favorites.md).
//
//   GET    /api/history/:id - the entry, if it is this user's
//   DELETE /api/history/:id - forget it
import { deleteHistoryEntry, getHistoryEntry, getPrisma } from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to see the history saved to your account.";
const GONE = "That entry is no longer in your history.";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const { id } = await params;
    const entry = await getHistoryEntry(userId, id, prisma);
    // Someone else's entry answers exactly like a missing one, so the route never confirms that
    // an id exists on another account.
    if (!entry) return fail(404, "NOT_FOUND", GONE);
    return ok({ entry });
  } catch (err) {
    return toErrorResponse(err, "api/history/:id");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const { id } = await params;
    const removed = await deleteHistoryEntry(userId, id, prisma);
    if (!removed) return fail(404, "NOT_FOUND", GONE);
    return ok({ removed: true });
  } catch (err) {
    return toErrorResponse(err, "api/history/:id");
  }
}
