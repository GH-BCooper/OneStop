// Marks every one of the account's notifications read (post-V1 automation pass; see /versionTwo.md).
//
//   POST /api/notifications/read-all
import { getPrisma, markAllNotificationsRead } from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", "Sign in to see your notifications.");
  try {
    await markAllNotificationsRead(userId, prisma);
    return ok({ read: true });
  } catch (err) {
    return toErrorResponse(err, "api/notifications/read-all");
  }
}
