"use client";

import { getTool, toolHref } from "@onestop/tool-registry";
import Link from "next/link";
import { FavoriteButton } from "@/components/tools/FavoriteButton";
import { useFavorites } from "@/lib/use-favorites";
import { useUsage } from "@/lib/use-usage";

function EmptyTools({ kind }: { kind: "favourites" | "recent" }) {
  const favourite = kind === "favourites";
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface/70 px-4 py-4">
      <p className="text-sm font-medium">{favourite ? "No favourites yet" : "Nothing here yet"}</p>
      <p className="mt-1 text-sm text-fg-muted">
        {favourite
          ? "Star tools you use often and they’ll appear here."
          : "Your recently used tools will appear here."}
      </p>
      {favourite && (
        <Link
          href="/tools"
          className="mt-3 inline-flex text-sm font-medium text-primary hover:underline"
        >
          Browse tools →
        </Link>
      )}
    </div>
  );
}

function LoadingTools({ label }: { label: string }) {
  return (
    <div aria-live="polite" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <span className="sr-only">Loading {label}…</span>
      <div className="h-16 animate-pulse rounded-xl bg-surface-muted" />
      <div className="h-16 animate-pulse rounded-xl bg-surface-muted" />
    </div>
  );
}

export function RecentTools() {
  const { favorites, synced, loading: favoritesLoading } = useFavorites();
  const { recent, loading: usageLoading } = useUsage();
  const starred = favorites.filter((id) => getTool(id) !== undefined).slice(0, 6);
  const used = recent.filter((id) => getTool(id) && !starred.includes(id)).slice(0, 5);

  return (
    <div className="flex flex-col gap-7">
      <section
        id="quick-access"
        aria-labelledby="favorites-heading"
        className="flex flex-col gap-3 scroll-mt-20"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 id="favorites-heading" className="text-xl font-semibold tracking-tight">
              Quick access
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              {synced ? "Your account favourites" : "Your favourites on this device"}
            </p>
          </div>
          <Link href="/tools" className="shrink-0 text-sm font-medium text-primary hover:underline">
            Manage <span aria-hidden="true">→</span>
          </Link>
        </div>
        {favoritesLoading ? (
          <LoadingTools label="favourites" />
        ) : starred.length === 0 ? (
          <EmptyTools kind="favourites" />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {starred.map((id) => {
              const tool = getTool(id)!;
              return (
                <li key={id} className="min-w-0">
                  <div className="group flex h-full items-center gap-2 rounded-xl border border-border bg-surface p-2 shadow-sm transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary">
                    <Link
                      href={toolHref(tool)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted"
                      >
                        ✦
                      </span>
                      <span className="truncate">{tool.name}</span>
                    </Link>
                    <FavoriteButton toolId={tool.id} toolName={tool.name} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        id="recent-tools"
        aria-labelledby="recent-heading"
        className="flex flex-col gap-3 scroll-mt-20"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 id="recent-heading" className="text-xl font-semibold tracking-tight">
              Recently used
            </h2>
            <p className="mt-1 text-sm text-fg-muted">Pick up where you left off.</p>
          </div>
          <Link
            href="/history"
            className="shrink-0 text-sm font-medium text-primary hover:underline"
          >
            View all <span aria-hidden="true">→</span>
          </Link>
        </div>
        {usageLoading ? (
          <LoadingTools label="recent tools" />
        ) : used.length === 0 ? (
          <EmptyTools kind="recent" />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {used.map((id, index) => {
              const tool = getTool(id)!;
              return (
                <li key={id}>
                  <Link
                    href={toolHref(tool)}
                    aria-label={tool.name}
                    className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 shadow-sm transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-lg"
                    >
                      ✦
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{tool.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-fg-muted">
                        {tool.category.replaceAll("-", " ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-fg-muted">
                      {index === 0 ? "Latest" : `${index + 1} ago`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
