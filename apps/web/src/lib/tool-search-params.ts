// Query-string contract for /tools, shared by the server page and the client explorer.
import {
  CATEGORIES,
  GROUPS,
  SORT_KEYS,
  TOOL_TAGS,
  type SortKey,
  type ToolTag,
} from "@onestop/tool-registry";

export interface ExplorerParams {
  q: string;
  category: string;
  sub: string;
  tags: ToolTag[];
  sort: SortKey | "";
}

/** Parses /tools query params, dropping anything that isn't a known value. */
export function parseExplorerParams(
  sp: Record<string, string | string[] | undefined>,
): ExplorerParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const category = one(sp.category);
  const validCategory =
    GROUPS.some((g) => g.id === category) || CATEGORIES.some((c) => c.id === category);
  const sort = one(sp.sort);
  return {
    q: one(sp.q).slice(0, 200),
    category: validCategory ? category : "",
    sub: validCategory ? one(sp.sub) : "",
    tags: one(sp.tags)
      .split(",")
      .filter((t): t is ToolTag => (TOOL_TAGS as readonly string[]).includes(t)),
    sort: (SORT_KEYS as readonly string[]).includes(sort) ? (sort as SortKey) : "",
  };
}
