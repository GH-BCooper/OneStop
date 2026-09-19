// The /status page's data, derived from the registry and nothing else (18-pwa-offline.md).
//
// Phase 02 shipped a placeholder that listed categories with hand-written words. This module reads
// the real `offline` and `network` flags - `offline` is set by the registry loader from its
// VERIFIED_OFFLINE list, so a tool appears here as offline-capable only once an offline test for it
// passes (CLAUDE.md §8). Pure and synchronous, so the page renders on the server and the test suite
// can cross-check it against the registry directly.
import { CATEGORIES, GROUPS, toolHref, tools, type ToolMeta } from "@onestop/tool-registry";

/** How one tool behaves without a network. */
export type OfflineClass =
  /** Proven to work with no network at all (registry `offline: true`). */
  | "offline"
  /** Needs the Internet by definition - a platform, a registry, a hosted model. */
  | "online-only"
  /** Runs locally, but has no passing offline test yet, so nothing is promised. */
  | "unverified";

export function offlineClass(tool: Pick<ToolMeta, "offline" | "network">): OfflineClass {
  if (tool.offline) return "offline";
  if (tool.network === "required") return "online-only";
  return "unverified";
}

export const OFFLINE_CLASS_LABELS: Record<OfflineClass, string> = {
  offline: "Works offline",
  "online-only": "Needs the Internet",
  unverified: "Not verified offline",
};

export interface ToolOfflineRow {
  id: string;
  name: string;
  href: string;
  offlineClass: OfflineClass;
  network: ToolMeta["network"];
  /** A model the user has to run themselves, when the tool can use one. */
  localModel: ToolMeta["localModel"];
}

/** How much of a category survives with no network. */
export type CategoryAvailability = "full" | "partial" | "none";

export interface OfflineSummary {
  id: string;
  name: string;
  total: number;
  offline: number;
  onlineOnly: number;
  unverified: number;
  availability: CategoryAvailability;
  tools: ToolOfflineRow[];
}

export interface GroupOfflineSummary extends OfflineSummary {
  icon: string;
  /** The registry categories inside this catalogue group. */
  categories: OfflineSummary[];
}

function availabilityOf(offline: number, total: number): CategoryAvailability {
  if (total === 0 || offline === 0) return "none";
  return offline === total ? "full" : "partial";
}

function summarize(id: string, name: string, list: readonly ToolMeta[]): OfflineSummary {
  const rows: ToolOfflineRow[] = list
    .map((tool) => ({
      id: tool.id,
      name: tool.name,
      href: toolHref(tool),
      offlineClass: offlineClass(tool),
      network: tool.network,
      localModel: tool.localModel,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const count = (kind: OfflineClass) => rows.filter((r) => r.offlineClass === kind).length;
  const offline = count("offline");
  return {
    id,
    name,
    total: rows.length,
    offline,
    onlineOnly: count("online-only"),
    unverified: count("unverified"),
    availability: availabilityOf(offline, rows.length),
    tools: rows,
  };
}

/** One summary per registry category (12 of them), in registry order. */
export function categoryOfflineSummaries(all: readonly ToolMeta[] = tools): OfflineSummary[] {
  return CATEGORIES.map((category) =>
    summarize(
      category.id,
      category.name,
      all.filter((t) => t.category === category.id),
    ),
  );
}

/** One summary per catalogue group (master plan §4's 8 cards), each with its categories inside. */
export function groupOfflineSummaries(all: readonly ToolMeta[] = tools): GroupOfflineSummary[] {
  const byCategory = new Map(categoryOfflineSummaries(all).map((s) => [s.id, s]));
  return GROUPS.map((group) => {
    const base = summarize(
      group.id,
      group.name,
      all.filter((t) => group.categories.includes(t.category)),
    );
    return {
      ...base,
      icon: group.icon,
      categories: group.categories.flatMap((id) => {
        const summary = byCategory.get(id);
        return summary ? [summary] : [];
      }),
    };
  });
}

export interface OfflineTotals {
  total: number;
  offline: number;
  onlineOnly: number;
  unverified: number;
  /** Whole percent of the catalogue proven to work offline. */
  offlinePercent: number;
}

export function offlineTotals(all: readonly ToolMeta[] = tools): OfflineTotals {
  const summary = summarize("all", "All tools", all);
  return {
    total: summary.total,
    offline: summary.offline,
    onlineOnly: summary.onlineOnly,
    unverified: summary.unverified,
    offlinePercent: summary.total === 0 ? 0 : Math.round((summary.offline / summary.total) * 100),
  };
}
