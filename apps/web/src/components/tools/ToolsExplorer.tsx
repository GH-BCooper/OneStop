"use client";

import {
  CATEGORIES,
  GROUPS,
  searchTools,
  SORT_KEYS,
  subcategoriesOf,
  TOOL_TAGS,
  tools,
  type SortKey,
  type ToolTag,
} from "@onestop/tool-registry";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { readRecentTools } from "@/lib/recent-tools";
import { type ExplorerParams } from "@/lib/tool-search-params";
import { ToolCard } from "./ToolCard";

const tagLabels: Record<ToolTag, string> = {
  offline: "Offline",
  online: "Online",
  ai: "AI",
  file: "File",
  image: "Image",
};

const sortLabels: Record<SortKey, string> = {
  relevance: "Relevance",
  name: "Name",
  popularity: "Popularity",
  recent: "Recently used",
};

const fieldClass =
  "h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-sm text-fg focus-visible:outline-2 focus-visible:outline-ring";

function toQueryString(p: ExplorerParams): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.category) sp.set("category", p.category);
  if (p.sub) sp.set("sub", p.sub);
  if (p.tags.length) sp.set("tags", p.tags.join(","));
  if (p.sort) sp.set("sort", p.sort);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function ToolsExplorer({ initial }: { initial: ExplorerParams }) {
  const router = useRouter();
  const [params, setParams] = useState(initial);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => setRecentIds(readRecentTools()), []);

  const update = (patch: Partial<ExplorerParams>) => {
    const next = { ...params, ...patch };
    setParams(next);
    router.replace(`/tools${toQueryString(next)}`, { scroll: false });
  };

  const results = useMemo(
    () =>
      searchTools(tools, {
        query: params.q,
        category: params.category || undefined,
        subcategory: params.sub || undefined,
        tags: params.tags,
        sort: params.sort || undefined,
        recentIds,
      }),
    [params, recentIds],
  );
  const subcategories = params.category ? subcategoriesOf(params.category) : [];

  return (
    <div className="flex flex-col gap-4">
      <div role="search" className="flex flex-col gap-3">
        <label htmlFor="tools-search" className="sr-only">
          Search tools
        </label>
        <input
          id="tools-search"
          type="search"
          value={params.q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Search tools, e.g. convert csv to json"
          className="h-12 w-full min-w-0 rounded-lg border border-border bg-surface px-4 text-base text-fg placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-ring"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="tools-category" className="text-sm font-medium">
              Category
            </label>
            <select
              id="tools-category"
              className={fieldClass}
              value={params.category}
              onChange={(e) => update({ category: e.target.value, sub: "" })}
            >
              <option value="">All categories</option>
              {GROUPS.map((g) =>
                g.categories.length === 1 ? (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ) : (
                  <optgroup key={g.id} label={g.name}>
                    <option value={g.id}>All {g.name}</option>
                    {g.categories.map((id) => (
                      <option key={id} value={id}>
                        {CATEGORIES.find((c) => c.id === id)?.name}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="tools-sub" className="text-sm font-medium">
              Subcategory
            </label>
            <select
              id="tools-sub"
              className={fieldClass}
              value={params.sub}
              disabled={subcategories.length < 2}
              onChange={(e) => update({ sub: e.target.value })}
            >
              <option value="">All subcategories</option>
              {subcategories.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="tools-sort" className="text-sm font-medium">
              Sort by
            </label>
            <select
              id="tools-sort"
              className={fieldClass}
              value={params.sort || (params.q ? "relevance" : "popularity")}
              onChange={(e) => update({ sort: e.target.value as SortKey })}
            >
              {SORT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {sortLabels[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Tags</legend>
          {TOOL_TAGS.map((tag) => {
            const on = params.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  update({
                    tags: on ? params.tags.filter((t) => t !== tag) : [...params.tags, tag],
                  })
                }
                className={`rounded-full border px-3 py-1 text-sm ${
                  on ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface"
                }`}
              >
                {tagLabels[tag]}
              </button>
            );
          })}
        </fieldset>
      </div>

      <p className="text-sm text-fg-muted" aria-live="polite">
        {results.length} {results.length === 1 ? "tool" : "tools"}
        {params.q ? ` matching “${params.q}”` : ""}
      </p>

      {results.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-fg-muted">
          No tools match. Try different words, or ask the AI Assistant.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Tools">
          {results.map((t) => (
            <li key={t.id}>
              <ToolCard tool={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
