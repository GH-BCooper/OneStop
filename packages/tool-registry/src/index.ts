// The Tool Registry: the single source of truth for every OneStop tool (master plan §13).
// Importing this module validates every entry; an invalid registry throws at build/start time.
import { aiTools } from "./entries/ai";
import { dataTools } from "./entries/data";
import { documentTools } from "./entries/documents";
import { imageTools } from "./entries/images";
import { audioTools, onlineMediaTools, videoTools } from "./entries/media";
import { pdfTools } from "./entries/pdf";
import { qrTools } from "./entries/qr";
import { devTools, fileUtilityTools, networkTools } from "./entries/utilities";
import { loadRegistry } from "./loader";
import { PLATFORM_FEATURES } from "./platform";
import {
  CATEGORIES,
  GROUPS,
  type CategoryInfo,
  type GroupInfo,
  type ToolCategory,
  type ToolMeta,
} from "./schema";

export * from "./schema";
export * from "./io";
export * from "./search";
export * from "./options";
export * from "./input-hints";
export * from "./notices";
export { loadRegistry, validateEntry, RegistryError, VERIFIED_OFFLINE } from "./loader";
export {
  getExecutor,
  hasExecutor,
  registerExecutor,
  echoExecutor,
  stubExecutor,
} from "./executors";
export { PLATFORM_FEATURES } from "./platform";
export { slugify } from "./define";

export const tools: readonly ToolMeta[] = loadRegistry(
  [
    ...pdfTools,
    ...documentTools,
    ...dataTools,
    ...imageTools,
    ...audioTools,
    ...videoTools,
    ...onlineMediaTools,
    ...qrTools,
    ...aiTools,
    ...devTools,
    ...networkTools,
    ...fileUtilityTools,
  ],
  PLATFORM_FEATURES,
);

export function getTool(id: string): ToolMeta | undefined {
  return tools.find((t) => t.id === id);
}

export function getToolByRoute(category: string, slug: string): ToolMeta | undefined {
  return tools.find((t) => t.category === category && t.slug === slug);
}

export function toolHref(tool: Pick<ToolMeta, "category" | "slug">): string {
  return `/tools/${tool.category}/${tool.slug}`;
}

export function getCategory(id: string): CategoryInfo | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function getGroup(id: string): GroupInfo | undefined {
  return GROUPS.find((g) => g.id === id);
}

export function toolsInCategory(id: ToolCategory): ToolMeta[] {
  return tools.filter((t) => t.category === id);
}

/** Tools for a category page: a registry category id or a catalogue group id. */
export function toolsForCatalogPage(id: string): ToolMeta[] {
  const group = getGroup(id);
  if (group) return tools.filter((t) => group.categories.includes(t.category));
  return getCategory(id) ? toolsInCategory(id as ToolCategory) : [];
}

export function subcategoriesOf(id: string): string[] {
  return [...new Set(toolsForCatalogPage(id).map((t) => t.subcategory))];
}

export function popularTools(limit = 8): ToolMeta[] {
  return [...tools].sort((a, b) => b.popularity - a.popularity).slice(0, limit);
}
export * from "./workflows";
export * from "./workflow-templates";
