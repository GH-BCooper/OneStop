// Input/output type helpers shared by the tool page, search and (later) workflow validation.
import type { ToolMeta } from "./schema";

/** Type families usable in inputTypes/outputTypes, expanded to concrete extensions. */
export const TYPE_FAMILIES: Record<string, string[]> = {
  image: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif", "heic", "avif"],
  audio: ["mp3", "wav", "aac", "flac", "ogg", "m4a", "opus", "wma"],
  video: ["mp4", "webm", "mov", "mkv", "avi", "m4v", "wmv", "flv"],
};

/** Input kinds that are typed/pasted rather than uploaded. */
export const NON_FILE_TYPES = ["text", "url"] as const;

export type InputKind = "file" | "text" | "url" | "none";

export function expandTypes(types: readonly string[]): string[] {
  return [...new Set(types.flatMap((t) => TYPE_FAMILIES[t] ?? [t]))];
}

/** The type family an extension belongs to ("jpg" → "image"), or the extension itself. */
export function familyOf(type: string): string {
  const t = type.toLowerCase();
  if (t === "jpeg") return "image";
  if (t === "yml") return "yaml";
  if (t === "doc" || t === "docx") return "word";
  if (t === "xls" || t === "xlsx") return "excel";
  if (t === "ppt" || t === "pptx") return "powerpoint";
  for (const [family, exts] of Object.entries(TYPE_FAMILIES)) {
    if (family === t || exts.includes(t)) return family;
  }
  return t;
}

export function fileInputTypes(tool: Pick<ToolMeta, "inputTypes">): string[] {
  return tool.inputTypes.filter((t) => !(NON_FILE_TYPES as readonly string[]).includes(t));
}

/** Primary input control for a tool page. Files win when a tool accepts both. */
export function inputKind(tool: Pick<ToolMeta, "inputTypes">): InputKind {
  if (tool.inputTypes.length === 0) return "none";
  if (fileInputTypes(tool).length > 0) return "file";
  return tool.inputTypes.includes("url") ? "url" : "text";
}

/** Value for an <input type="file" accept>; undefined means any file. */
export function acceptAttribute(tool: Pick<ToolMeta, "inputTypes">): string | undefined {
  const types = fileInputTypes(tool);
  if (types.length === 0 || types.includes("any")) return undefined;
  return expandTypes(types)
    .map((ext) => `.${ext}`)
    .join(",");
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

export function acceptsFileName(tool: Pick<ToolMeta, "inputTypes">, fileName: string): boolean {
  const types = fileInputTypes(tool);
  if (types.includes("any")) return true;
  const ext = extensionOf(fileName);
  return ext !== "" && expandTypes(types).includes(ext);
}

/** Short human label for a list of types, e.g. ["jpg","png"] → "JPG, PNG". */
export function typeLabel(types: readonly string[]): string {
  if (types.length === 0) return "Nothing";
  return types.map((t) => (t === "any" ? "Any file" : t.toUpperCase())).join(", ");
}
