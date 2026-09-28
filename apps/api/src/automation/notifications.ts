// Notifications: real, account-visible events (post-V1 automation pass; see /versionTwo.md).
//
// Written only by things that actually happened to this account — today, only automation runs
// (`scheduler.ts`). Deliberately not decorative: the third owner pass explicitly deferred a
// notification bell because nothing real existed to show it. This does.
import type { AppNotification, NotificationType } from "@onestop/types";
import { requirePrisma, type PrismaClient } from "../db/client.ts";

/** Rows kept per account — old notifications are pruned past this so the list stays fast. */
export const MAX_NOTIFICATIONS_PER_USER = 200;

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** This user's notifications, newest first. */
export async function listNotifications(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
  limit = 40,
): Promise<{ notifications: AppNotification[]; unreadCount: number }> {
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }],
      take: limit,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { notifications: (rows as NotificationRow[]).map(toNotification), unreadCount };
}

/** Writes one notification and prunes anything past `MAX_NOTIFICATIONS_PER_USER` for that user. */
export async function pushNotification(
  userId: string,
  input: { type: NotificationType; title: string; body?: string | null; link?: string | null },
  prisma: PrismaClient = requirePrisma(),
): Promise<void> {
  await prisma.notification.create({
    data: {
      userId,
      type: input.type,
      title: input.title.slice(0, 200),
      body: input.body ? input.body.slice(0, 500) : null,
      link: input.link ?? null,
    },
  });
  const stale = await prisma.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }],
    skip: MAX_NOTIFICATIONS_PER_USER,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.notification.deleteMany({
      where: { id: { in: (stale as { id: string }[]).map((r) => r.id) } },
    });
  }
}

export async function markNotificationRead(
  userId: string,
  id: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<boolean> {
  const { count } = await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return count > 0;
}

export async function markAllNotificationsRead(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
