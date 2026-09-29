"use client";

// The global command palette (21-roadmap-expansion.md, roadmap §2 and §7.1).
//
// ⌘K / Ctrl+K from anywhere. A frosted panel over a dimmed page with the particle field still
// faintly alive behind it — the app should never feel frozen — results grouped by Tools / Workflows /
// History / Go to / Actions, arrow keys to move, Enter to commit, Escape to close.
//
// Zero new dependencies: the searching is `paletteResults`, which wraps the same registry index the
// /tools page uses, and the panel is plain CSS. Everything it needs offline is already in the bundle,
// so the palette keeps working with no network at all.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  groupResults,
  isPaletteShortcut,
  paletteResults,
  type CommandItem,
  type PaletteSource,
} from "@/lib/command-palette";
import { applyTextPreferences, readTextPreferences } from "@/lib/appearance";
import { readLocalFavorites } from "@/lib/favorites";
import { readRecentTools } from "@/lib/recent-tools";
import { readLocalWorkflows } from "@/lib/workflows";
import { readLocalHistory } from "@/lib/localHistory";
import { applyTheme } from "./ThemeToggle";

export const PALETTE_OPEN_EVENT = "onestop:open-palette";

/** Lets anything in the app open the palette without prop-drilling a setter through the tree. */
export function openCommandPalette(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PALETTE_OPEN_EVENT));
}

function Chip({ children }: { children: string }) {
  return (
    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] leading-none text-fg-muted">
      {children}
    </span>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [source, setSource] = useState<PaletteSource>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const listId = useId();

  // The palette closes on navigation, so it never lingers over the page it just opened.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isPaletteShortcut(event)) {
        event.preventDefault();
        setOpen((was) => !was);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_OPEN_EVENT, onOpen);
    };
  }, []);

  // The visitor's own data is loaded when the palette first opens, not on every page load.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    let live = true;
    const load = async () => {
      const [history] = await Promise.all([readLocalHistory().catch(() => [])]);
      if (!live) return;
      setSource({
        favoriteIds: readLocalFavorites(),
        recentIds: readRecentTools(),
        workflows: readLocalWorkflows().map((w) => ({ id: w.id, name: w.name, steps: w.steps })),
        history: history.slice(0, 20).map((e) => ({ id: e.id, toolId: e.toolId, createdAt: e.createdAt, summary: e.summary })),
      });
    };
    void load();
    // Focus after paint, or the browser can steal it back while the dialog is still mounting.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [open]);

  const items = useMemo(() => paletteResults(query, source), [query, source]);
  const groups = useMemo(() => groupResults(items), [items]);

  useEffect(() => {
    setActive((current) => (current >= items.length ? 0 : current));
  }, [items.length]);

  const run = useCallback(
    (item: CommandItem) => {
      if (item.href) {
        setOpen(false);
        router.push(item.href);
        return;
      }
      switch (item.action) {
        case "toggle-theme": {
          const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
          applyTheme(next);
          break;
        }
        case "toggle-data-saver":
          applyTextPreferences({ dataSaver: !readTextPreferences().dataSaver });
          break;
        case "new-workflow":
          setOpen(false);
          router.push("/workflows/new");
          return;
        case "open-settings":
          setOpen(false);
          router.push("/settings");
          return;
        default:
          break;
      }
      setOpen(false);
    },
    [router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      setActive((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
      return;
    }
    if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      setActive((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(0, items.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = items[active];
      if (item) run(item);
    }
  };

  // Keep the highlighted row in view when the arrow keys walk past the edge of the list. Scrolling
  // is a nicety, not the feature, so an environment without `scrollIntoView` (jsdom, and some older
  // browsers) simply does not scroll rather than breaking the palette.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (typeof row?.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  let index = -1;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh] sm:pt-[16vh]">
      {/* Dimmed, not blacked out: the particle field stays faintly visible behind the panel. */}
      <button
        type="button"
        aria-label="Close the command palette"
        className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-surface/95 shadow-[var(--os-card-shadow)] backdrop-blur-xl"
        style={{ backgroundImage: "var(--os-surface-sheen)" }}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <span aria-hidden="true" className="text-fg-muted">
            ⌘
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search tools, workflows, history…"
            aria-label="Search tools, workflows, history and actions"
            aria-controls={listId}
            aria-activedescendant={items[active] ? `${listId}-${items[active]!.id}` : undefined}
            role="combobox"
            aria-expanded="true"
            autoComplete="off"
            spellCheck={false}
            className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-fg-muted"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-muted sm:block">
            esc
          </kbd>
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto py-1">
          {items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-fg-muted">
              Nothing matched “{query}”. Try a file type (“pdf”), a verb (“compress”) or a tool name.
            </p>
          )}
          {groups.map((group) => (
            <div key={group.group}>
              <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
                {group.group}
              </p>
              {group.items.map((item) => {
                index += 1;
                const isActive = index === active;
                const rowIndex = index;
                const inner = (
                  <>
                    <span aria-hidden="true" className="w-5 shrink-0 text-center">
                      {item.icon ?? "•"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.label}</span>
                      {item.detail && <span className="block truncate text-xs text-fg-muted">{item.detail}</span>}
                    </span>
                    {(item.badges ?? []).map((badge) => (
                      <Chip key={badge}>{badge}</Chip>
                    ))}
                  </>
                );
                const className = `flex w-full items-center gap-2 px-3 py-2 text-left ${
                  isActive ? "bg-surface-muted" : "hover:bg-surface-muted/60"
                }`;
                return item.href ? (
                  <Link
                    key={item.id}
                    id={`${listId}-${item.id}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    href={item.href}
                    className={className}
                    onMouseEnter={() => setActive(rowIndex)}
                    onClick={() => setOpen(false)}
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={item.id}
                    id={`${listId}-${item.id}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    type="button"
                    className={className}
                    onMouseEnter={() => setActive(rowIndex)}
                    onClick={() => run(item)}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <p className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-fg-muted">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span className="ml-auto">{items.length} result{items.length === 1 ? "" : "s"}</span>
        </p>
      </div>
    </div>
  );
}
