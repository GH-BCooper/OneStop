// The search half of the global command palette (21-roadmap-expansion.md, roadmap §2 and §7.1).
//
// Kept out of the component so it can be tested without a DOM, and so it reads from exactly the same
// `searchTools` index the /tools page already uses — the palette adds no second source of truth and
// no new dependency (`cmdk` was considered and not needed).
import { searchTools, toolHref, tools, GROUPS, type ToolMeta } from "@onestop/tool-registry";
import { primaryNav } from "./nav";

export type CommandGroup = "Tools" | "Workflows" | "History" | "Go to" | "Actions";

export interface CommandItem {
  id: string;
  group: CommandGroup;
  label: string;
  /** One short line under the label: the tool's description, a workflow's steps, a date. */
  detail?: string;
  /** Emoji or single character shown in the leading slot. */
  icon?: string;
  href?: string;
  /** For quick actions that do something instead of navigating. */
  action?: "toggle-theme" | "new-workflow" | "toggle-data-saver" | "open-settings";
  /** Flags rendered as small chips (Offline, Needs internet, Favourite). */
  badges?: string[];
  keywords?: string[];
}

export interface PaletteSource {
  /** Saved workflows, when the app has loaded them. */
  workflows?: { id: string; name: string; steps?: { toolId: string }[] }[];
  /** Recent history entries, newest first. */
  history?: { id: string; toolId: string; createdAt: string; summary?: string | null }[];
  favoriteIds?: readonly string[];
  recentIds?: readonly string[];
}

const QUICK_ACTIONS: CommandItem[] = [
  { id: "action:new-workflow", group: "Actions", label: "New workflow", icon: "🔁", action: "new-workflow", keywords: ["create", "chain", "build"] },
  { id: "action:toggle-theme", group: "Actions", label: "Toggle light / dark", icon: "◐", action: "toggle-theme", keywords: ["theme", "dark", "light", "appearance"] },
  { id: "action:toggle-data-saver", group: "Actions", label: "Toggle reduced data mode", icon: "📉", action: "toggle-data-saver", keywords: ["data saver", "metered", "battery", "motion"] },
  { id: "action:settings", group: "Actions", label: "Open settings", icon: "⚙️", action: "open-settings", keywords: ["preferences", "theme", "ai", "account"] },
];

function navItems(): CommandItem[] {
  const pages: CommandItem[] = primaryNav.map((item) => ({
    id: `nav:${item.href}`,
    group: "Go to" as const,
    label: item.label,
    href: item.href,
    ...(item.icon ? { icon: item.icon } : {}),
  }));
  const extras: CommandItem[] = [
    { id: "nav:/", group: "Go to", label: "Home", href: "/", icon: "🏠" },
    { id: "nav:/settings", group: "Go to", label: "Settings", href: "/account?tab=personal", icon: "⚙️" },
    { id: "nav:/account", group: "Go to", label: "About & account", href: "/account?tab=app", icon: "👤" },
    { id: "nav:/status", group: "Go to", label: "Status & offline", href: "/status", icon: "📶", keywords: ["offline", "connection", "ffmpeg", "diagnostics"] },
  ];
  const categories: CommandItem[] = GROUPS.map((group) => ({
    id: `nav:/tools/${group.id}`,
    group: "Go to" as const,
    label: group.name,
    detail: "Tool category",
    href: `/tools/${group.id}`,
    icon: group.icon,
  }));
  return [...pages, ...extras, ...categories];
}

function toolItem(tool: ToolMeta, favourite: boolean): CommandItem {
  const badges: string[] = [];
  if (favourite) badges.push("Favourite");
  if (tool.offline) badges.push("Works offline");
  else if (tool.network === "required") badges.push("Needs internet");
  return {
    id: `tool:${tool.id}`,
    group: "Tools",
    label: tool.name,
    detail: tool.description,
    href: toolHref(tool),
    icon: GROUPS.find((g) => g.categories.includes(tool.category))?.icon ?? "🧰",
    badges,
    keywords: tool.keywords,
  };
}

/** Plain substring matching for the non-tool groups; the tool index does its own smarter scoring. */
function matches(haystack: (string | undefined)[], needle: string): boolean {
  if (needle === "") return true;
  const text = haystack.filter(Boolean).join(" ").toLowerCase();
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

export const PALETTE_LIMITS = { tools: 8, workflows: 4, history: 4, nav: 5, actions: 4 } as const;

/**
 * The palette's results for a query, grouped and capped. With no query it shows the visitor's own
 * recent tools and favourites rather than an arbitrary list, which is what makes an empty palette
 * immediately useful.
 */
export function paletteResults(query: string, source: PaletteSource = {}): CommandItem[] {
  const trimmed = query.trim();
  const favourites = new Set(source.favoriteIds ?? []);
  const out: CommandItem[] = [];

  if (trimmed === "") {
    const recent = (source.recentIds ?? [])
      .map((id) => tools.find((t) => t.id === id))
      .filter((t): t is ToolMeta => Boolean(t))
      .slice(0, 5)
      .map((t) => ({ ...toolItem(t, favourites.has(t.id)), detail: "Recently used" }));
    const starred = [...favourites]
      .map((id) => tools.find((t) => t.id === id))
      .filter((t): t is ToolMeta => Boolean(t))
      .filter((t) => !(source.recentIds ?? []).includes(t.id))
      .slice(0, 4)
      .map((t) => toolItem(t, true));
    out.push(...recent, ...starred);
  } else {
    const found = searchTools(tools, {
      query: trimmed,
      sort: "relevance",
      ...(source.recentIds ? { recentIds: source.recentIds } : {}),
      ...(source.favoriteIds ? { favoriteIds: source.favoriteIds } : {}),
    }).slice(0, PALETTE_LIMITS.tools);
    out.push(...found.map((t) => toolItem(t, favourites.has(t.id))));
  }

  for (const workflow of source.workflows ?? []) {
    if (out.filter((i) => i.group === "Workflows").length >= PALETTE_LIMITS.workflows) break;
    if (!matches([workflow.name, "workflow"], trimmed)) continue;
    const stepNames = (workflow.steps ?? [])
      .map((s) => tools.find((t) => t.id === s.toolId)?.name ?? s.toolId)
      .slice(0, 3);
    out.push({
      id: `workflow:${workflow.id}`,
      group: "Workflows",
      label: workflow.name,
      detail: stepNames.length > 0 ? stepNames.join(" → ") : "No steps yet",
      href: `/workflows/${workflow.id}`,
      icon: "🔁",
    });
  }

  for (const entry of source.history ?? []) {
    if (out.filter((i) => i.group === "History").length >= PALETTE_LIMITS.history) break;
    const tool = tools.find((t) => t.id === entry.toolId);
    const label = tool?.name ?? entry.toolId;
    if (!matches([label, entry.summary ?? "", "history"], trimmed)) continue;
    out.push({
      id: `history:${entry.id}`,
      group: "History",
      label,
      detail: `${new Date(entry.createdAt).toLocaleString()}${entry.summary ? ` · ${entry.summary.slice(0, 60)}` : ""}`,
      href: `/history?entry=${encodeURIComponent(entry.id)}`,
      icon: "🕘",
    });
  }

  out.push(...navItems().filter((item) => matches([item.label, item.detail, ...(item.keywords ?? [])], trimmed)).slice(0, PALETTE_LIMITS.nav));
  out.push(...QUICK_ACTIONS.filter((item) => matches([item.label, ...(item.keywords ?? [])], trimmed)).slice(0, PALETTE_LIMITS.actions));
  return out;
}

export const PALETTE_GROUP_ORDER: CommandGroup[] = ["Tools", "Workflows", "History", "Go to", "Actions"];

/** Results grouped for rendering, in a fixed order, empty groups dropped. */
export function groupResults(items: CommandItem[]): { group: CommandGroup; items: CommandItem[] }[] {
  return PALETTE_GROUP_ORDER.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter(
    (g) => g.items.length > 0,
  );
}

/** Whether a keyboard event should open the palette: Ctrl+K, ⌘K, or Ctrl+/. */
export function isPaletteShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  if (event.altKey) return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  return event.key.toLowerCase() === "k" || event.key === "/";
}
