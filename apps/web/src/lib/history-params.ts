// The query-string contract for history (14-history-favorites.md), shared by the API route, the
// page and the client component so a guest's IndexedDB is filtered exactly like Postgres.
import { CATEGORIES, GROUPS, tools } from "@onestop/tool-registry";
import type { HistoryFilter, JobStatus } from "@onestop/types";

export const HISTORY_STATUSES: JobStatus[] = [
  "success",
  "failed",
  "processing",
  "validating",
  "pending",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface HistoryParams extends HistoryFilter {
  /** The category or group id the user picked, kept so the select can show it again. */
  category: string;
}

/** True when the id names a registry category or one of the eight home groups. */
export function isCategoryId(id: string): boolean {
  return GROUPS.some((g) => g.id === id) || CATEGORIES.some((c) => c.id === id);
}

/** Every tool id inside a category or group. Empty for an id the registry does not know. */
export function toolIdsInCategory(id: string): string[] {
  const group = GROUPS.find((g) => g.id === id);
  const categories = group ? new Set<string>(group.categories) : new Set<string>([id]);
  return tools.filter((t) => categories.has(t.category)).map((t) => t.id);
}

/** Parses `/history` query params, dropping anything that is not a value we recognise. */
export function parseHistoryParams(
  sp: Record<string, string | string[] | undefined> | URLSearchParams,
): HistoryParams {
  const one = (key: string): string => {
    if (sp instanceof URLSearchParams) return sp.get(key) ?? "";
    const value = sp[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const category = one("category");
  const toolId = one("tool");
  const status = one("status");
  const from = one("from");
  const to = one("to");
  const page = Number.parseInt(one("page"), 10);
  return {
    category: isCategoryId(category) ? category : "",
    ...(tools.some((t) => t.id === toolId) ? { toolId } : {}),
    ...(isCategoryId(category) && !toolId ? { toolIds: toolIdsInCategory(category) } : {}),
    ...(HISTORY_STATUSES.includes(status as JobStatus) ? { status: status as JobStatus } : {}),
    ...(DATE_RE.test(from) ? { from } : {}),
    ...(DATE_RE.test(to) ? { to } : {}),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** The inverse, so the page can push the current filters back onto the URL. */
export function historyQueryString(params: HistoryParams): string {
  const sp = new URLSearchParams();
  if (params.category) sp.set("category", params.category);
  if (params.toolId) sp.set("tool", params.toolId);
  if (params.status) sp.set("status", params.status);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const query = sp.toString();
  return query ? `?${query}` : "";
}
