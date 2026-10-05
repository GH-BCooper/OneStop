"use client";

import { searchTools, toolHref, tools } from "@onestop/tool-registry";
import Link from "next/link";
import { useMemo } from "react";
import { useFavorites } from "@/lib/use-favorites";
import { useUsage } from "@/lib/use-usage";

export function PopularTools({ count = 8 }: { count?: number }) {
  const { counts, loading } = useUsage();
  const { favorites } = useFavorites();
  const popular = useMemo(
    () =>
      searchTools(tools, { sort: "popularity", usageCounts: counts, favoriteIds: favorites }).slice(
        0,
        count,
      ),
    [counts, favorites, count],
  );

  return (
    <section aria-labelledby="popular-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="popular-heading" className="text-xl font-semibold tracking-tight">
          Popular tools
        </h2>
        <p className="mt-1 text-sm text-fg-muted">Reliable shortcuts for common tasks.</p>
      </div>
      {loading ? (
        <div aria-live="polite" className="grid grid-cols-2 gap-2">
          <span className="sr-only">Loading popular tools…</span>
          <div className="h-10 animate-pulse rounded-lg bg-surface-muted" />
          <div className="h-10 animate-pulse rounded-lg bg-surface-muted" />
        </div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {popular.map((tool) => (
            <li key={tool.id}>
              <Link
                href={toolHref(tool)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:border-primary hover:bg-surface-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span aria-hidden="true">✦</span>
                {tool.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
