"use client";

// The Home page's "Popular tools" row (14-history-favorites.md).
//
// Phase 03 ordered this by a hand-set `popularity` number on each registry entry. Real usage now
// leads that ordering (`useUsage` merges this device's runs with the account's), and the editorial
// number only breaks ties - so a fresh install still shows a sensible list.
import { searchTools, toolHref, tools } from "@onestop/tool-registry";
import Link from "next/link";
import { useMemo } from "react";
import { useFavorites } from "@/lib/use-favorites";
import { useUsage } from "@/lib/use-usage";

export function PopularTools({ count = 8 }: { count?: number }) {
  const { counts } = useUsage();
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
    <section aria-labelledby="popular-heading" className="flex flex-col gap-4">
      <h2 id="popular-heading" className="text-xl font-semibold">
        Popular tools
      </h2>
      <ul className="flex flex-wrap gap-2">
        {popular.map((t) => (
          <li key={t.id}>
            <Link
              href={toolHref(t)}
              className="inline-block rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-primary hover:text-primary"
            >
              {t.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
