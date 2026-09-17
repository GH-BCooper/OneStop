// Compact authoring helper for registry entries. Fills the defaults every entry shares so each
// entries/*.ts file stays a readable list; the loader still validates the expanded result.
import type { NetworkNeed, ToolCategory, ToolMeta, ToolPhase, ToolStatus } from "./schema";

export interface ToolSpec {
  name: string;
  /** Defaults to a slug derived from `name`. Used as both `id` and route `slug`. */
  slug?: string;
  /** "section.item" references into docs/OneStop_Features.md. */
  src: string[];
  in: string[];
  out: string[];
  desc: string;
  kw?: string[];
  batch?: boolean;
  auth?: boolean;
  net?: NetworkNeed;
  phase?: ToolPhase;
  sub?: string;
  pop?: number;
  status?: ToolStatus;
}

export interface CategoryDefaults {
  phase: ToolPhase;
  sub: string;
  net?: NetworkNeed;
}

/** "PDF → Word" → "pdf-to-word", "Wi-Fi → QR" → "wi-fi-to-qr". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[→↔]/g, " to ")
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function defineCategory(
  category: ToolCategory,
  defaults: CategoryDefaults,
  specs: ToolSpec[],
): ToolMeta[] {
  return specs.map((s) => {
    const slug = s.slug ?? slugify(s.name);
    const network = s.net ?? defaults.net ?? "none";
    return {
      id: slug,
      slug,
      name: s.name,
      category,
      subcategory: s.sub ?? defaults.sub,
      inputTypes: s.in,
      outputTypes: s.out,
      execution: network === "required" ? "remote" : "local",
      // Never true here: only the loader's VERIFIED_OFFLINE list may turn it on.
      offline: false,
      network,
      supportsBatch: s.batch ?? false,
      requiresAuth: s.auth ?? false,
      keywords: s.kw ?? [],
      description: s.desc,
      phase: s.phase ?? defaults.phase,
      status: s.status ?? "stub",
      popularity: s.pop ?? 10,
      sources: s.src,
    };
  });
}
