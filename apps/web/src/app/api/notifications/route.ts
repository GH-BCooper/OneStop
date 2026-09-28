// The account's notifications (post-V1 automation pass; see /versionTwo.md).
//
//   GET /api/notifications - the newest ones, plus the unread count
//
// Also gives the automation scheduler a second, best-effort chance to run due automations: on a
// host where the in-process interval (`automation/scheduler.ts`) may not survive between requests,
// a signed-in user simply loading the app is enough to keep their own automations moving.
import { getPrisma, kickScheduler, listNotifications } from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", "Sign in to see your notifications.");
  try {
    kickScheduler();
    const { notifications, unreadCount } = await listNotifications(userId, prisma);
    return ok({ notifications, unreadCount });
  } catch (err) {
    return toErrorResponse(err, "api/notifications");
  }
}
