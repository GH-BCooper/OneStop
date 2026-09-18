// Keyword search, filters and sorting over the registry (03-tool-registry.md, master §6 and §21).
// Deliberately non-AI: tokens are normalized (plurals, "compressor" → "compress", synonyms), scored
// against name/keywords/types/description, and "X to Y" / "Y from X" phrasing boosts tools whose
// input and output types run in that direction. 16-ai-assistant.md can reuse `scoreTool`.
import { familyOf, inputKind } from "./io";
import { CATEGORIES, GROUPS, type ToolMeta } from "./schema";

export const TOOL_TAGS = ["offline", "online", "ai", "file", "image"] as const;
export type ToolTag = (typeof TOOL_TAGS)[number];

export const SORT_KEYS = ["relevance", "name", "popularity", "recent"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "my",
  "me",
  "i",
  "we",
  "our",
  "your",
  "to",
  "from",
  "into",
  "as",
  "of",
  "for",
  "and",
  "or",
  "in",
  "on",
  "with",
  "by",
  "this",
  "that",
  "these",
  "those",
  "some",
  "please",
  "make",
  "want",
  "need",
  "can",
  "could",
  "how",
  "do",
  "does",
  "it",
  "its",
  "is",
  "are",
  "be",
  "using",
  "use",
  "via",
  "help",
  "turn",
  "get",
  "one",
  "tool",
  "tools",
  "online",
  "free",
  "change",
]);

/** Word forms that should match each other. Applied after lowercasing and plural stripping. */
const LEMMAS: Record<string, string> = {
  compression: "compress",
  compressor: "compress",
  compressed: "compress",
  compressing: "compress",
  conversion: "convert",
  converter: "convert",
  converting: "convert",
  converted: "convert",
  removal: "remove",
  remover: "remove",
  removing: "remove",
  delete: "remove",
  erase: "remove",
  merger: "merge",
  merging: "merge",
  combine: "merge",
  join: "merge",
  splitter: "split",
  splitting: "split",
  generator: "generate",
  generation: "generate",
  create: "generate",
  creator: "generate",
  trimmer: "trim",
  trimming: "trim",
  cutter: "trim",
  resizer: "resize",
  resizing: "resize",
  cropper: "crop",
  cropping: "crop",
  formatter: "format",
  formatting: "format",
  beautify: "format",
  beautifier: "format",
  validator: "validate",
  validation: "validate",
  validating: "validate",
  extractor: "extract",
  extraction: "extract",
  extracting: "extract",
  detector: "detect",
  detection: "detect",
  enhancer: "enhance",
  enhancement: "enhance",
  upscaler: "upscale",
  upscaling: "upscale",
  denoiser: "denoise",
  sharpening: "sharpen",
  sharpener: "sharpen",
  drafter: "draft",
  rewriter: "rewrite",
  summarizer: "summarize",
  summary: "summarize",
  summarise: "summarize",
  translator: "translate",
  translation: "translate",
  analyzer: "analyze",
  analyser: "analyze",
  analysis: "analyze",
  checker: "check",
  encoder: "encode",
  encoding: "encode",
  decoder: "decode",
  decoding: "decode",
  tester: "test",
  testing: "test",
  viewer: "view",
  editor: "edit",
  editing: "edit",
  normalizer: "normalize",
  cleaner: "clean",
  transformer: "transform",
  rotation: "rotate",
  rotating: "rotate",
  scanner: "scan",
  scanning: "scan",
  lookup: "lookup",
  signature: "sign",
  // Synonyms for file types and subjects.
  images: "image",
  photo: "image",
  picture: "image",
  pic: "image",
  img: "image",
  jpeg: "jpg",
  docx: "word",
  doc: "word",
  xlsx: "excel",
  xls: "excel",
  spreadsheet: "excel",
  pptx: "powerpoint",
  ppt: "powerpoint",
  presentation: "powerpoint",
  slide: "powerpoint",
  yml: "yaml",
  txt: "text",
  md: "markdown",
  movie: "video",
  clip: "video",
  song: "audio",
  sound: "audio",
  music: "audio",
  bg: "background",
  shrink: "compress",
  smaller: "compress",
  unzip: "extract",
  wifi: "wi-fi",
  colour: "color",
};

/** Families recognised as conversion endpoints when parsing "X to Y" phrasing. */
const TYPE_TERMS = new Set([
  "pdf",
  "word",
  "excel",
  "powerpoint",
  "csv",
  "json",
  "xml",
  "yaml",
  "image",
  "audio",
  "video",
  "gif",
  "html",
  "text",
  "markdown",
  "qr",
  "zip",
  "jpg",
  "png",
  "webp",
  "mp3",
  "mp4",
  "wav",
  "aac",
  "flac",
  "webm",
]);

export function normalizeToken(raw: string): string {
  let t = raw.toLowerCase();
  const direct = LEMMAS[t];
  if (direct) return direct;
  if (t.length > 3 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 3 && t.endsWith("s") && !/(ss|us|is)$/.test(t)) t = t.slice(0, -1);
  return LEMMAS[t] ?? t;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []).map(normalizeToken);
}

function terms(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t));
}

/** Family used for direction matching; also collapses specific formats ("mp3" → "audio"). */
function endpointFamily(term: string): string {
  const f = familyOf(term);
  return f === "txt" ? "text" : f === "md" ? "markdown" : f;
}

interface Direction {
  source?: string;
  target?: string;
}

export function parseDirection(query: string): Direction {
  const tokens = tokenize(query);
  const typeAt = tokens.map((t) => (TYPE_TERMS.has(t) ? t : null));
  const firstTypeAfter = (i: number) => typeAt.slice(i + 1).find((t) => t !== null) ?? undefined;
  const lastTypeBefore = (i: number) =>
    typeAt
      .slice(0, i)
      .filter((t) => t !== null)
      .at(-1) ?? undefined;

  const fromIdx = tokens.indexOf("from");
  if (fromIdx >= 0) {
    const source = firstTypeAfter(fromIdx);
    let target = lastTypeBefore(fromIdx);
    if (!target && source) {
      const srcIdx = typeAt.indexOf(source, fromIdx + 1);
      target = firstTypeAfter(srcIdx);
    }
    return { source, target };
  }
  const toIdx = tokens.findIndex((t) => t === "to" || t === "into" || t === "as");
  if (toIdx >= 0) return { source: lastTypeBefore(toIdx), target: firstTypeAfter(toIdx) };
  return {};
}

interface IndexedTool {
  tool: ToolMeta;
  name: Set<string>;
  nameCount: number;
  nameKey: string;
  keywords: Set<string>;
  phrases: string[];
  types: Set<string>;
  from: Set<string>;
  to: Set<string>;
  category: Set<string>;
  description: Set<string>;
}

const indexCache = new WeakMap<ToolMeta, IndexedTool>();

function indexTool(tool: ToolMeta): IndexedTool {
  const cached = indexCache.get(tool);
  if (cached) return cached;
  const nameTerms = terms(tool.name);
  const from = new Set(tool.inputTypes.map(endpointFamily));
  const to = new Set(tool.outputTypes.map(endpointFamily));
  const category = CATEGORIES.find((c) => c.id === tool.category);
  const indexed: IndexedTool = {
    tool,
    name: new Set(nameTerms),
    nameCount: new Set(nameTerms).size,
    nameKey: nameTerms.join(" "),
    keywords: new Set(tool.keywords.flatMap(terms)),
    phrases: tool.keywords.map((k) => terms(k).join(" ")).filter((p) => p.includes(" ")),
    types: new Set([
      ...from,
      ...to,
      ...[...tool.inputTypes, ...tool.outputTypes].map(normalizeToken),
    ]),
    from,
    to,
    category: new Set(terms(`${tool.category} ${category?.name ?? ""} ${tool.subcategory}`)),
    description: new Set(terms(tool.description)),
  };
  indexCache.set(tool, indexed);
  return indexed;
}

/** Relevance of a tool for a free-text query; 0 means no match. */
export function scoreTool(tool: ToolMeta, query: string): number {
  const qTerms = [...new Set(terms(query))];
  if (qTerms.length === 0) return 0;
  const ix = indexTool(tool);

  let score = 0;
  let matched = 0;
  let nameHits = 0;
  for (const term of qTerms) {
    let best = 0;
    if (ix.name.has(term)) {
      best = 10;
      nameHits++;
    } else if (ix.keywords.has(term)) best = 6;
    else if (ix.types.has(term)) best = 4;
    else if (ix.category.has(term)) best = 3;
    else if (ix.description.has(term)) best = 2;
    else if (term.length >= 4 && [...ix.name].some((n) => n.startsWith(term))) best = 5;
    if (best > 0) matched++;
    score += best;
  }
  if (matched === 0) return 0;

  const qKey = qTerms.join(" ");
  if (qKey === ix.nameKey) score += 20;
  for (const phrase of ix.phrases) if (qKey.includes(phrase)) score += 4;
  score += 5 * (nameHits / Math.max(ix.nameCount, 1));
  // Penalise queries where most terms found nothing on this tool.
  score *= matched / qTerms.length;

  const { source, target } = parseDirection(query);
  if (source && target) {
    const s = endpointFamily(source);
    const t = endpointFamily(target);
    if (ix.from.has(s) && ix.to.has(t)) score += 12;
    else if (ix.from.has(t) && ix.to.has(s)) score -= 12;
  }
  return Math.max(score, 0);
}

export function toolTags(tool: ToolMeta): ToolTag[] {
  const tags: ToolTag[] = [];
  if (tool.network !== "required") tags.push("offline");
  if (tool.network !== "none") tags.push("online");
  if (tool.category === "ai") tags.push("ai");
  if (inputKind(tool) === "file") tags.push("file");
  const families = [...tool.inputTypes, ...tool.outputTypes].map(familyOf);
  if (tool.category === "images" || families.includes("image")) tags.push("image");
  return tags;
}

export interface SearchOptions {
  query?: string;
  /** A registry category id or a catalogue group id (e.g. "media"). */
  category?: string;
  subcategory?: string;
  tags?: readonly ToolTag[];
  sort?: SortKey;
  /** Most-recent-first tool ids, used by `sort: "recent"`. */
  recentIds?: readonly string[];
  /**
   * Real run counts per tool id (14-history-favorites.md). When given, they lead the popularity
   * sort and the hand-set `popularity` number only breaks ties - so the ordering reflects what
   * this user actually uses, and a tool nobody has run keeps its editorial rank.
   */
  usageCounts?: Readonly<Record<string, number>>;
  /** Starred tool ids. When given, favourites sort ahead of everything else.  */
  favoriteIds?: readonly string[];
  /** Restricts the results to `favoriteIds`. */
  favoritesOnly?: boolean;
}

export function matchesCategory(tool: ToolMeta, category: string): boolean {
  if (tool.category === category) return true;
  return GROUPS.find((g) => g.id === category)?.categories.includes(tool.category) ?? false;
}

export function searchTools(tools: readonly ToolMeta[], options: SearchOptions = {}): ToolMeta[] {
  const query = options.query?.trim() ?? "";
  const tags = options.tags ?? [];
  const scores = new Map<ToolMeta, number>();

  const filtered = tools.filter((tool) => {
    if (options.category && !matchesCategory(tool, options.category)) return false;
    if (options.subcategory && tool.subcategory !== options.subcategory) return false;
    if (options.favoritesOnly && !(options.favoriteIds ?? []).includes(tool.id)) return false;
    if (tags.length > 0) {
      const own = toolTags(tool);
      if (!tags.every((t) => own.includes(t))) return false;
    }
    if (query) {
      const score = scoreTool(tool, query);
      if (score <= 0) return false;
      scores.set(tool, score);
    }
    return true;
  });

  const byName = (a: ToolMeta, b: ToolMeta) => a.name.localeCompare(b.name);
  const usage = options.usageCounts ?? {};
  const runs = (t: ToolMeta) => usage[t.id] ?? 0;
  const byPopularity = (a: ToolMeta, b: ToolMeta) =>
    runs(b) - runs(a) || b.popularity - a.popularity || byName(a, b);
  const sort = options.sort ?? (query ? "relevance" : "popularity");
  // Favourites float to the top of whatever ordering was asked for, rather than replacing it.
  const favorites = new Set(options.favoriteIds ?? []);
  const withFavorites = (compare: (a: ToolMeta, b: ToolMeta) => number) =>
    favorites.size === 0
      ? compare
      : (a: ToolMeta, b: ToolMeta) =>
          Number(favorites.has(b.id)) - Number(favorites.has(a.id)) || compare(a, b);

  switch (sort) {
    case "name":
      return filtered.sort(withFavorites(byName));
    case "popularity":
      return filtered.sort(withFavorites(byPopularity));
    case "recent": {
      const recent = options.recentIds ?? [];
      const rank = (t: ToolMeta) => {
        const i = recent.indexOf(t.id);
        return i < 0 ? Number.POSITIVE_INFINITY : i;
      };
      return filtered.sort(withFavorites((a, b) => rank(a) - rank(b) || byPopularity(a, b)));
    }
    case "relevance":
      return filtered.sort(
        withFavorites((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || byPopularity(a, b)),
      );
  }
}
