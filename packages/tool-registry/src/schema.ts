// Tool metadata contract (03-tool-registry.md, master plan §13).
import type { ExecResult, FileRef } from "@onestop/types";

export const CATEGORY_IDS = [
  "pdf",
  "documents",
  "data",
  "images",
  "audio",
  "video",
  "online-media",
  "qr",
  "ai",
  "dev-utility",
  "network",
  "file-utility",
] as const;
export type ToolCategory = (typeof CATEGORY_IDS)[number];

/** Build phases that implement tools (file prefix in docs/build/). */
export type ToolPhase = "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12" | "16" | "17";

/**
 * Planned network needs. This is design intent, not a verified capability:
 * `offline` stays false until an offline test passes (enforced for real in phase 19).
 */
export type NetworkNeed = "none" | "optional" | "required";

/** `stub` = executor not built yet; `demo` = wired to the phase-03 echo executor. */
export type ToolStatus = "stub" | "demo" | "available";

export interface ToolMeta {
  id: string;
  slug: string;
  name: string;
  category: ToolCategory;
  /** Section of docs/OneStop_Features.md the tool is listed under, e.g. "Word / Document". */
  subcategory: string;
  /**
   * File extensions or type families ("image", "audio", "video", "any") the tool accepts, or the
   * non-file kinds "text" / "url". Empty means the tool needs no input (e.g. UUID Generator).
   */
  inputTypes: string[];
  outputTypes: string[];
  execution: "local" | "remote";
  offline: boolean;
  network: NetworkNeed;
  supportsBatch: boolean;
  requiresAuth: boolean;
  keywords: string[];
  description: string;
  phase: ToolPhase;
  status: ToolStatus;
  /** Static popularity counter (0–100) until 14-history-favorites.md records real usage. */
  popularity: number;
  /** "section.item" references into docs/OneStop_Features.md, e.g. ["3.7", "4.4"]. */
  sources: string[];
}

export type Executor = (
  input: FileRef[] | string | null,
  options: Record<string, unknown>,
) => Promise<ExecResult>;

export interface CategoryInfo {
  id: ToolCategory;
  name: string;
  group: GroupId;
}

export type GroupId = "pdf" | "documents" | "data" | "images" | "media" | "qr" | "ai" | "utilities";

export interface GroupInfo {
  id: GroupId;
  name: string;
  icon: string;
  categories: ToolCategory[];
}

/** The 12 registry categories, grouped under master plan §4's 8 catalogue groups. */
export const CATEGORIES: CategoryInfo[] = [
  { id: "pdf", name: "PDF", group: "pdf" },
  { id: "documents", name: "Word & PowerPoint", group: "documents" },
  { id: "data", name: "Excel, CSV & Data", group: "data" },
  { id: "images", name: "Images", group: "images" },
  { id: "audio", name: "Audio", group: "media" },
  { id: "video", name: "Video", group: "media" },
  { id: "online-media", name: "Online Media", group: "media" },
  { id: "qr", name: "QR", group: "qr" },
  { id: "ai", name: "AI", group: "ai" },
  { id: "dev-utility", name: "Developer", group: "utilities" },
  { id: "network", name: "Network & Info", group: "utilities" },
  { id: "file-utility", name: "File Utilities", group: "utilities" },
];

export const GROUPS: GroupInfo[] = [
  { id: "pdf", name: "PDF", icon: "📄", categories: ["pdf"] },
  { id: "documents", name: "Documents, Word & PowerPoint", icon: "📝", categories: ["documents"] },
  { id: "data", name: "Excel, CSV & Data", icon: "📊", categories: ["data"] },
  { id: "images", name: "Images", icon: "🖼️", categories: ["images"] },
  {
    id: "media",
    name: "Audio & Video",
    icon: "🎬",
    categories: ["audio", "video", "online-media"],
  },
  { id: "qr", name: "QR", icon: "🔳", categories: ["qr"] },
  { id: "ai", name: "AI", icon: "✨", categories: ["ai"] },
  {
    id: "utilities",
    name: "Utilities & Developer",
    icon: "🛠️",
    categories: ["dev-utility", "network", "file-utility"],
  },
];

export const PHASE_FILES: Record<ToolPhase, string> = {
  "05": "05-pdf-tools-core.md",
  "06": "06-pdf-tools-advanced.md",
  "07": "07-word-ppt-tools.md",
  "08": "08-excel-csv-data-tools.md",
  "09": "09-image-tools.md",
  "10": "10-audio-video-tools.md",
  "11": "11-qr-tools.md",
  "12": "12-dev-utility-tools.md",
  "16": "16-ai-assistant.md",
  "17": "17-online-media-network-tools.md",
};

/** Items in docs/OneStop_Features.md that are platform features, not registry tools. */
export interface PlatformFeature {
  name: string;
  route: string;
  phase: string;
  sources: string[];
}
