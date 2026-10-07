"use client";

// The AI Assistant's chat history — a collapsible list of past threads (ChatGPT-style), kept on
// this device only (see `lib/assistant-threads.ts`). Renaming, pinning and deleting all act
// straight on localStorage and broadcast `THREADS_CHANGED`, which is what keeps this list, and any
// other tab open on `/assistant`, in sync without a server round trip.
import { Modal, cn } from "@onestop/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  deleteThread,
  readSidebarCollapsed,
  readThreads,
  renameThread,
  setThreadPinned,
  writeSidebarCollapsed,
  THREADS_CHANGED,
  type AssistantThread,
} from "@/lib/assistant-threads";

export function ThreadSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [deleting, setDeleting] = useState<AssistantThread | null>(null);

  useEffect(() => {
    setThreads(readThreads());
    setCollapsed(readSidebarCollapsed());
    const refresh = () => setThreads(readThreads());
    window.addEventListener(THREADS_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(THREADS_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Close mobile chat list dropdown on route change
  useEffect(() => {
    setMobileListOpen(false);
    setMenuFor(null);
  }, [pathname]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  const activeId = pathname?.startsWith("/assistant/")
    ? pathname.slice("/assistant/".length)
    : null;

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      writeSidebarCollapsed(!c);
      return !c;
    });
  };

  const handleMobileNewChat = () => {
    setMobileListOpen(false);
    if (pathname !== "/assistant") {
      router.push("/assistant");
    }
  };

  const renderThreadItem = (thread: AssistantThread, isMobile = false) => {
    const isRenaming = renaming?.id === thread.id;
    const isActive = activeId === thread.id;

    if (isRenaming) {
      return (
        <form
          className="flex items-center gap-1 px-1 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            renameThread(thread.id, renaming.value);
            setRenaming(null);
          }}
        >
          <input
            autoFocus
            value={renaming.value}
            onChange={(e) => setRenaming({ id: thread.id, value: e.target.value })}
            onBlur={() => {
              renameThread(thread.id, renaming.value);
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenaming(null);
            }}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          />
        </form>
      );
    }

    return (
      <div className="flex items-center">
        <Link
          href={`/assistant/${thread.id}`}
          onClick={(event) => {
            if (isActive) {
              event.preventDefault();
              return;
            }
            if (isMobile) setMobileListOpen(false);
          }}
          className={cn(
            "flex flex-1 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
            isActive
              ? "bg-primary/10 text-primary font-medium"
              : "text-fg-muted hover:bg-surface-muted hover:text-fg",
          )}
        >
          {thread.pinned && (
            <span aria-hidden="true" title="Pinned" className="text-xs">
              📌
            </span>
          )}
          <span className="flex-1 truncate">{thread.title}</span>
        </Link>
        <button
          type="button"
          aria-label={`Chat options for ${thread.title}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuFor((id) => (id === thread.id ? null : thread.id));
          }}
          className={cn(
            "rounded px-1.5 py-1 text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:opacity-100",
            isMobile
              ? "opacity-90"
              : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
          )}
        >
          ⋯
        </button>

        {menuFor === thread.id && (
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-1 flex w-40 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              className="px-3 py-2 text-left text-sm hover:bg-surface-muted"
              onClick={() => {
                setThreadPinned(thread.id, !thread.pinned);
                setMenuFor(null);
              }}
            >
              {thread.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              role="menuitem"
              className="px-3 py-2 text-left text-sm hover:bg-surface-muted"
              onClick={() => {
                setRenaming({ id: thread.id, value: thread.title });
                setMenuFor(null);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className="px-3 py-2 text-left text-sm text-danger hover:bg-surface-muted"
              onClick={() => {
                setDeleting(thread);
                setMenuFor(null);
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* -------------------- MOBILE VIEW (lg:hidden) -------------------- */}
      {/* Sub-navbar right below the original navbar across full width */}
      <div className="fixed inset-x-0 top-14 z-[80] border-y-2 border-border bg-surface/95 py-1.5 backdrop-blur-md lg:hidden">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4">
          {/* Button 1: New chat */}
          <button
            type="button"
            onClick={handleMobileNewChat}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-muted/60 px-3 py-2 text-sm font-medium text-fg shadow-sm hover:bg-surface-muted active:scale-[0.98] transition-all"
          >
            <span aria-hidden="true" className="text-base leading-none">
              ➕
            </span>
            <span>New chat</span>
          </button>

          {/* Button 2: List of chats / Close list of chats */}
          <button
            type="button"
            onClick={() => setMobileListOpen((open) => !open)}
            aria-expanded={mobileListOpen}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium shadow-sm active:scale-[0.98] transition-all",
              mobileListOpen
                ? "border-primary bg-primary/10 text-primary font-semibold"
                : "border-border bg-surface-muted/60 text-fg hover:bg-surface-muted",
            )}
          >
            <span aria-hidden="true" className="text-base leading-none">
              {mobileListOpen ? "▲" : "💬"}
            </span>
            <span>{mobileListOpen ? "Close list of chats" : "List of chats"}</span>
          </button>
        </div>

        {/* Dropdown list of chats with smooth drop-down (expand) and move-up (collapse) animation */}
        <div
          className={cn(
            "mx-auto grid w-full max-w-6xl overflow-hidden px-4 transition-all duration-300 ease-in-out",
            mobileListOpen
              ? "grid-rows-[1fr] opacity-100 mt-2"
              : "grid-rows-[0fr] opacity-0 mt-0 pointer-events-none",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="max-h-[60vh] overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-2xl">
              <div className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted border-b border-border mb-1 flex items-center justify-between">
                <span>Past Chats</span>
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-normal">
                  {threads.length}
                </span>
              </div>
              <ul className="flex flex-col gap-1" data-testid="assistant-mobile-thread-list">
                {threads.length === 0 && (
                  <li className="px-3 py-4 text-center text-sm text-fg-muted">No chats yet.</li>
                )}
                {threads.map((thread) => (
                  <li key={`mobile-${thread.id}`} className="group relative">
                    {renderThreadItem(thread, true)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* -------------------- DESKTOP VIEW (hidden lg:flex) -------------------- */}
      <aside aria-label="Chat history" className="hidden lg:flex shrink-0">
        {collapsed ? (
          <div className="flex w-12 flex-col items-center gap-2 border-r border-border py-1">
            <button
              type="button"
              aria-label="Expand chat history"
              onClick={toggleCollapsed}
              className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
            >
              <span aria-hidden="true">»</span>
            </button>
            <Link
              href="/assistant"
              aria-label="New chat"
              className="flex h-9 w-9 items-center justify-center rounded-md text-lg text-fg-muted hover:bg-surface-muted hover:text-fg"
            >
              <span aria-hidden="true">+</span>
            </Link>
          </div>
        ) : (
          <div className="flex w-64 flex-col gap-2 border-r border-border pr-3">
            <div className="flex items-center gap-1">
              <Link
                href="/assistant"
                className="flex-1 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface-muted"
              >
                + New chat
              </Link>
              <button
                type="button"
                aria-label="Collapse chat history"
                onClick={toggleCollapsed}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
              >
                <span aria-hidden="true">«</span>
              </button>
            </div>

            <ul
              className="flex flex-col gap-0.5 overflow-y-auto"
              data-testid="assistant-thread-list"
            >
              {threads.length === 0 && (
                <li className="px-2 py-3 text-sm text-fg-muted">No chats yet.</li>
              )}
              {threads.map((thread) => (
                <li key={thread.id} className="group relative">
                  {renderThreadItem(thread, false)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      {/* Delete confirmation modal */}
      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete chat?">
        <p className="text-sm text-fg-muted">
          “{deleting?.title}” will be permanently deleted from this device.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm hover:bg-surface-muted"
            onClick={() => setDeleting(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-danger-fg hover:opacity-90"
            onClick={() => {
              if (!deleting) return;
              const wasActive = activeId === deleting.id;
              deleteThread(deleting.id);
              setDeleting(null);
              if (wasActive) router.push("/assistant");
            }}
          >
            Delete
          </button>
        </div>
      </Modal>
    </>
  );
}
