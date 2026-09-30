"use client";

// The AI Assistant's chat history — a collapsible list of past threads (ChatGPT-style), kept on
// this device only (see `lib/assistant-threads.ts`). Renaming, pinning and deleting all act
// straight on localStorage and broadcast `THREADS_CHANGED`, which is what keeps this list, and any
// other tab open on `/assistant`, in sync without a server round trip.
import { Modal } from "@onestop/ui";
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

  if (collapsed) {
    return (
      // On a phone the collapsed rail is a slim row above the chat, not a 48 px strip beside it.
      <div className="flex shrink-0 items-center gap-2 max-md:flex-row md:w-12 md:flex-col md:border-r md:border-border md:py-1">
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
    );
  }

  return (
    <>
      {/* On a phone the open list is a drawer laid over the chat (see below); this keeps the chat
          exactly where the collapsed rail had it (a row's height), so opening the list does not shift the page. */}
      <div aria-hidden="true" className="h-9 shrink-0 md:hidden" />
      <div className="flex w-64 shrink-0 flex-col gap-2 border-r border-border pr-3 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:min-h-72 max-md:rounded-lg max-md:border max-md:bg-surface max-md:p-3 max-md:shadow-xl">
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

        <ul className="flex flex-col gap-0.5 overflow-y-auto" data-testid="assistant-thread-list">
          {threads.length === 0 && (
            <li className="px-2 py-3 text-sm text-fg-muted">No chats yet.</li>
          )}
          {threads.map((thread) => (
            <li key={thread.id} className="group relative">
              {renaming?.id === thread.id ? (
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
              ) : (
                <Link
                  href={`/assistant/${thread.id}`}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-2 text-sm ${
                    activeId === thread.id
                      ? "bg-surface-muted text-fg"
                      : "text-fg-muted hover:bg-surface-muted hover:text-fg"
                  }`}
                >
                  {thread.pinned && (
                    <span aria-hidden="true" title="Pinned">
                      📌
                    </span>
                  )}
                  <span className="flex-1 truncate">{thread.title}</span>
                  <button
                    type="button"
                    aria-label={`Chat options for ${thread.title}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenuFor((id) => (id === thread.id ? null : thread.id));
                    }}
                    className="rounded px-1.5 text-fg-muted opacity-0 hover:bg-surface hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    ⋯
                  </button>
                </Link>
              )}

              {menuFor === thread.id && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-10 mt-1 flex w-40 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-lg"
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
            </li>
          ))}
        </ul>

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
      </div>
    </>
  );
}
