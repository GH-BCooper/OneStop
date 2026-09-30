// Tool metadata contract (03-tool-registry.md, master plan §13).
import type { ExecContext, ExecResult, FileRef } from "@onestop/types";

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
  "security",
  "finance",
  "education",
  "time",
  "fun",
] as const;
export type ToolCategory = (typeof CATEGORY_IDS)[number];

/** Build phases that implement tools (file prefix in docs/build/). */
export type ToolPhase =
  "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12" | "16" | "17" | "21" | "22";

/**
 * Planned network needs. This is design intent, not a verified capability:
 * `offline` stays false until an offline test passes (enforced for real in phase 19).
 */
export type NetworkNeed = "none" | "optional" | "required";

/**
 * Whether a tool can use a local AI model (09-image-tools.md). "optional": it has a built-in
 * method and uses the model when one is configured; "required": it does nothing useful without
 * one. Absent means the tool never uses a model. The model runtime itself is 16-ai-assistant.md.
 */
export type LocalModelNeed = "optional" | "required";

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
  localModel?: LocalModelNeed;
}

/**
 * How every tool is run. `ctx` is supplied by the phase-04 pipeline (file bytes, job id,
 * cancellation); executors that only need metadata can ignore it.
 */
export type Executor = (
  input: FileRef[] | string | null,
  options: Record<string, unknown>,
  ctx?: ExecContext,
) => Promise<ExecResult>;

export interface CategoryInfo {
  id: ToolCategory;
  name: string;
  group: GroupId;
}

export type GroupId =
  | "pdf"
  | "documents"
  | "data"
  | "images"
  | "media"
  | "qr"
  | "ai"
  | "utilities"
  | "security"
  | "everyday";

export interface GroupInfo {
  id: GroupId;
  name: string;
  icon: string;
  /** One line saying what lives here, for the home tiles and the assistant. */
  blurb: string;
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
  { id: "security", name: "Security & Privacy", group: "security" },
  { id: "finance", name: "Finance & Math", group: "everyday" },
  { id: "education", name: "Education & Reference", group: "everyday" },
  { id: "time", name: "Calendar & Time", group: "everyday" },
  { id: "fun", name: "Fun & Personal", group: "everyday" },
];

export const GROUPS: GroupInfo[] = [
  {
    id: "pdf",
    name: "PDF",
    icon: "📄",
    blurb: "Merge, split, compress, sign, OCR, redact and convert PDFs.",
    categories: ["pdf"],
  },
  {
    id: "documents",
    name: "Documents, Word & PowerPoint",
    icon: "📝",
    blurb: "Word and PowerPoint conversion, citations, résumés and Markdown.",
    categories: ["documents"],
  },
  {
    id: "data",
    name: "Excel, CSV & Data",
    icon: "📊",
    blurb: "CSV, Excel, JSON and XML: clean, convert, pivot, chart and compare.",
    categories: ["data"],
  },
  {
    id: "images",
    name: "Images",
    icon: "🖼️",
    blurb: "Resize, compress, convert, remove backgrounds and batch-edit photos.",
    categories: ["images"],
  },
  {
    id: "media",
    name: "Audio & Video",
    icon: "🎬",
    blurb: "Convert, trim, merge and caption audio and video; save online media.",
    categories: ["audio", "video", "online-media"],
  },
  {
    id: "qr",
    name: "QR",
    icon: "🔳",
    blurb: "QR codes and barcodes, static or dynamic, with a scanner and analytics.",
    categories: ["qr"],
  },
  {
    id: "ai",
    name: "AI",
    icon: "✨",
    blurb: "Summarise, translate, rewrite and analyse, on local or free-tier AI.",
    categories: ["ai"],
  },
  {
    id: "utilities",
    name: "Utilities & Developer",
    icon: "🛠️",
    blurb: "JSON, hashes, regex, DNS, SSL, cron, diffs and other developer helpers.",
    categories: ["dev-utility", "network", "file-utility"],
  },
  {
    id: "security",
    name: "Security & Privacy",
    icon: "🛡️",
    blurb: "Password strength, one-time codes, file encryption and breach checks.",
    categories: ["security"],
  },
  {
    id: "everyday",
    name: "Everyday, Money & Fun",
    icon: "🎲",
    blurb: "Loans, currency, invoices, flashcards, countdowns and more.",
    categories: ["finance", "education", "time", "fun"],
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
  "21": "21-roadmap-expansion.md",
  "22": "22-everyday-utilities.md",
};

/** Items in docs/OneStop_Features.md that are platform features, not registry tools. */
export interface PlatformFeature {
  name: string;
  route: string;
  phase: string;
  sources: string[];
}
