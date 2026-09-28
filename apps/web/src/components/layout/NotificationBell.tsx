"use client";

// A real notification bell (post-V1 automation pass; see /versionTwo.md). Only ever shows events
// that actually happened — today, an automation's own run or failure — never a decorative badge
// with nothing behind it (the third owner pass explicitly deferred this for that reason).
import { cn } from "@onestop/ui";
import type { AppNotification } from "@onestop/types";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications";

const POLL_MS = 30_000;

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/** Mounted by the header only when accounts are configured and a session exists. */
export function NotificationBell() {
  const { data: session, status } = useSession();
  const signedIn = Boolean(session?.user);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { notifications, unreadCount } = await fetchNotifications();
        if (!cancelled) {
          setItems(notifications);
          setUnread(unreadCount);
        }
      } catch {
        // Silent: a notification list is a convenience, never blocking.
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [signedIn]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (status === "loading" || !signedIn) return null;

  const onOpenItem = (item: AppNotification) => {
    setOpen(false);
    if (item.read) return;
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    setUnread((n) => Math.max(0, n - 1));
    void markNotificationRead(item.id).catch(() => {});
  };

  const onMarkAll = () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    void markAllNotificationsRead().catch(() => {});
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring",
          open && "bg-surface-muted",
        )}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-medium">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={onMarkAll}
                className="text-xs text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-fg-muted">
                No notifications yet. Automate a workflow on its page to start getting real updates
                here.
              </p>
            ) : (
              items.map((item) => {
                const row = (
                  <div
                    className={cn(
                      "flex flex-col gap-0.5 px-3 py-2 text-sm hover:bg-surface-muted",
                      !item.read && "bg-primary/5",
                    )}
                  >
                    <span className="font-medium">{item.title}</span>
                    {item.body && <span className="text-fg-muted">{item.body}</span>}
                    <span className="text-xs text-fg-muted">{timeAgo(item.createdAt)}</span>
                  </div>
                );
                return item.link ? (
                  <Link
                    key={item.id}
                    role="menuitem"
                    href={item.link}
                    onClick={() => onOpenItem(item)}
                    className="block"
                  >
                    {row}
                  </Link>
                ) : (
                  <button
                    key={item.id}
                    role="menuitem"
                    type="button"
                    onClick={() => onOpenItem(item)}
                    className="block w-full text-left"
                  >
                    {row}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
