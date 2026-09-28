// Client for the account's notifications (post-V1 automation pass; see /versionTwo.md).
//
// Notifications only exist for signed-in accounts — they are written by the automation scheduler,
// which only ever acts on an account workflow (see `lib/schedules.ts`). A guest has nothing to
// poll, so `useNotifications` (the one caller of this file) simply does not call it when signed out.
import type { AppNotification } from "@onestop/types";

interface ApiResponse {
  ok?: boolean;
  notifications?: unknown;
  unreadCount?: number;
  error?: { message?: string };
}

async function call(url: string, init?: RequestInit): Promise<ApiResponse> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok) throw new Error(body.error?.message ?? "That could not be completed.");
  return body;
}

function asNotification(value: unknown): AppNotification | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;
  return {
    id: row.id,
    type: typeof row.type === "string" ? (row.type as AppNotification["type"]) : "system",
    title: row.title,
    body: typeof row.body === "string" ? row.body : null,
    link: typeof row.link === "string" ? row.link : null,
    read: row.read === true,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
  };
}

export async function fetchNotifications(): Promise<{
  notifications: AppNotification[];
  unreadCount: number;
}> {
  const body = await call("/api/notifications");
  const notifications = Array.isArray(body.notifications)
    ? body.notifications.map(asNotification).filter((n): n is AppNotification => n !== null)
    : [];
  return { notifications, unreadCount: body.unreadCount ?? 0 };
}

export async function markNotificationRead(id: string): Promise<void> {
  await call(`/api/notifications/${encodeURIComponent(id)}`, { method: "PATCH" });
}

export async function markAllNotificationsRead(): Promise<void> {
  await call("/api/notifications/read-all", { method: "POST" });
}
