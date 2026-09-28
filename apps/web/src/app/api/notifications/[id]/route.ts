// One notification (post-V1 automation pass; see /versionTwo.md).
//
//   PATCH /api/notifications/:id - mark it read ({ read: true })
import { getPrisma, markNotificationRead } from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(_request: Request, { params }: Params): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", "Sign in to see your notifications.");
  try {
    const { id } = await params;
    const found = await markNotificationRead(userId, id, prisma);
    if (!found) return fail(404, "NOT_FOUND", "That notification does not exist.");
    return ok({ read: true });
  } catch (err) {
    return toErrorResponse(err, "api/notifications/:id");
  }
}
