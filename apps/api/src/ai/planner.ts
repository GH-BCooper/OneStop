// Steps two to four of master plan §7.2: tool discovery, input/permission validation, and the
// execution plan (16-ai-assistant.md).
//
// The hard rule of this phase lives here: **a plan may only name tool ids that exist in
// `@onestop/tool-registry`, and the whole chain is re-checked with the same `validateWorkflow`
// the Workflows page and `POST /api/workflows/run` use.** A model cannot get around it, because
// the model's answer is never trusted as a plan — it is parsed, filtered id by id, and then put
// through the same gate as a hand-built workflow. Anything it names that does not exist is
// dropped into `rejected`, logged, and shown to the user rather than quietly "fixed".
//
// There are two planners and they are both first-class:
//
//   * the **rule planner** works with no model at all. It splits the request into clauses, maps
//     each clause to a ranked list of registry tools, then searches for an ordering that is
//     type-compatible end to end. This is what makes "the app remains 100% functional with no
//     external AI API configured" true even when Ollama is not installed either.
//   * the **model planner** asks the configured runtime for JSON. It is tried first when a
//     runtime answers, and it falls back to the rule planner whenever its answer is unusable.
import {
  acceptsFileName,
  compatibleTypes,
  describeIssues,
  fileInputTypes,
  getTool,
  getToolOptions,
  inputKind,
  scoreTool,
  tools,
  validateWorkflow,
  type ToolMeta,
  type ToolOption,
} from "@onestop/tool-registry";
import type { ExecutionPlan, ExecutionStep, PlanRejection } from "@onestop/types";
import { parseJsonObject } from "./intent.ts";
import { AiError, chat, type ChatMessage } from "./modelRuntime.ts";
import type { AiCredentials, AiRuntimeConfig } from "./providers.ts";

export const MAX_PLAN_STEPS = 6;

/** A tool the planner may use. Stubs and demos are never planned: they cannot actually run. */
export function plannableTools(): ToolMeta[] {
  return tools.filter((t) => t.status === "available" && t.id !== "ai-assistant");
}

// ---- clause splitting ---------------------------------------------------------------------------

const CONNECTORS =
  /\s*(?:[,;]\s*)?\b(?:and\s+then|then|after\s+that|afterwards|next|finally|lastly|followed\s+by)\b\s*/gi;

const ACTIONY =
  /\b(convert|turn|change|make|merge|combine|join|split|compress|shrink|reduce|rotate|resize|scale|crop|extract|pull|remove|delete|drop|strip|encrypt|decrypt|unlock|protect|password|watermark|sign|ocr|scan|read|flatten|zip|unzip|archive|bundle|encode|decode|hash|checksum|format|tidy|validate|check|clean|dedupe|deduplicate|translate|summari[sz]e|rewrite|generate|create|add|number|trim|cut|upscale|enhance|sharpen|denoise|blur|flip|mirror|qr)\b/i;

/** Splits a request into the clauses a user would call "steps". Never returns an empty list. */
export function splitClauses(request: string): string[] {
  const normalised = request
    .replace(/\r/g, "")
    .replace(/^\s*\d+[.)]\s*/gm, "\n")
    .replace(/\n+/g, "\n");
  const rough = normalised
    .split("\n")
    .flatMap((line) => line.split(CONNECTORS))
    .flatMap((part) => part.split(/,\s*(?=\w)/))
    .map((part) =>
      part
        .trim()
        .replace(/^(?:and|then|also|please)\s+/i, "")
        .trim(),
    )
    .filter((part) => part !== "");

  // A fragment with no verb of its own ("the first 2 pages") belongs to the clause before it.
  const clauses: string[] = [];
  for (const part of rough) {
    if (clauses.length > 0 && !ACTIONY.test(part)) {
      clauses[clauses.length - 1] = `${clauses[clauses.length - 1]}, ${part}`;
    } else {
      clauses.push(part);
    }
  }
  return clauses.length > 0 ? clauses : [request.trim()];
}

// ---- option extraction --------------------------------------------------------------------------

const ORDINALS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  first: 1,
  second: 2,
  third: 3,
};

function count(text: string): number | null {
  const digits = text.match(/\b(\d{1,4})\b/);
  if (digits) return Number(digits[1]);
  const word = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  return word ? (ORDINALS[word[1]!.toLowerCase()] ?? null) : null;
}

/** "the first 2 pages" → "1-2"; "page 3" → "3"; "pages 2-5" → "2-5"; "the last page" → "last". */
export function pageSpec(text: string): string | null {
  const range = text.match(/\bpages?\s*(\d+)\s*(?:-|–|to|through)\s*(\d+)/i);
  if (range) return `${range[1]}-${range[2]}`;
  if (/\blast\s+(page|slide)\b/i.test(text)) return "last";
  if (/\bfirst\s+(page|slide)\b/i.test(text) && !/\bfirst\s+\d/i.test(text)) return "1";
  const firstN = text.match(/\bfirst\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (firstN) {
    const n = count(firstN[1]!) ?? 1;
    return n <= 1 ? "1" : `1-${n}`;
  }
  const single = text.match(/\bpages?\s*(\d+)\b/i);
  if (single) return single[1]!;
  if (/\bodd\b/i.test(text)) return "odd";
  if (/\beven\b/i.test(text)) return "even";
  return null;
}

function compressionLevel(text: string): string | null {
  if (/\b(hard|strong|aggressive|smallest|as small as possible|maximum)\b/i.test(text))
    return "strong";
  if (/\b(light|lossless|gentle|slight)\b/i.test(text)) return "light";
  return null;
}

/** Fills options for a chosen tool from the clause's own words. Unknown option ids are dropped. */
export function optionsFromClause(tool: ToolMeta, clause: string): Record<string, unknown> {
  const declared = getToolOptions(tool.id);
  const byId = new Map(declared.map((o) => [o.id, o] as const));
  const out: Record<string, unknown> = {};

  const pages = pageSpec(clause);
  if (pages && byId.has("pages")) out.pages = pages;

  const level = compressionLevel(clause);
  if (level && byId.get("level")?.type === "select") {
    const choices = (byId.get("level") as { choices: { value: string }[] }).choices;
    if (choices.some((c) => c.value === level)) out.level = level;
  }

  const degrees = clause.match(/\b(90|180|270)\b/);
  if (degrees && byId.has("angle")) out.angle = degrees[1];

  const width = clause.match(/\b(\d{2,5})\s*(?:px|pixels)?\s*(?:wide|width)\b/i);
  if (width && byId.has("width")) out.width = Number(width[1]);

  return sanitiseOptions(tool, out);
}

/**
 * Keeps only option ids the registry declares for this tool, and only primitive values. This is
 * the same defence `parseSteps` gives a saved workflow: nothing a model writes reaches an
 * executor as a nested object or an unknown key.
 */
export function sanitiseOptions(
  tool: Pick<ToolMeta, "id">,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const declared = new Map(getToolOptions(tool.id).map((o) => [o.id, o] as const));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    const option = declared.get(key);
    if (!option) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue;
    }
    if (!allowedValue(option, value)) continue;
    out[key] = value;
  }
  return out;
}

function allowedValue(option: ToolOption, value: string | number | boolean): boolean {
  switch (option.type) {
    case "select":
      return option.choices.some((c) => c.value === String(value));
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) && n >= option.min && n <= option.max;
    }
    case "boolean":
      return typeof value === "boolean" || value === "true" || value === "false";
    case "text":
      return typeof value === "string" && value.length <= 2000;
    default:
      // Signature, image and client values are never planned: they come from the page.
      return false;
  }
}

// ---- clause → candidate tools ---------------------------------------------------------------------

interface Matcher {
  re: RegExp;
  /** Registry ids, best first. Ids that do not exist are ignored, never invented. */
  ids: string[];
}

/**
 * Hand-written routes for the phrasings people actually use. They exist so the assistant is
 * predictable without a model; the registry search below catches everything else.
 */
const MATCHERS: Matcher[] = [
  // 17-online-media-network-tools.md. These come first because "download this YouTube video as
  // mp3" would otherwise be caught by the generic "to mp3" rule below and routed at a local file.
  {
    re: /\byoutu\.?be\b|\byoutube\b/i,
    ids: ["youtube-to-mp4", "youtube-to-mp3", "youtube-quality-selector"],
  },
  {
    re: /\binstagram\b|\breels?\b/i,
    ids: ["instagram-reel-to-mp4", "instagram-reel-to-mp3", "instagram-quality-selector"],
  },
  { re: /\bspotify\b/i, ids: ["spotify-link-info"] },
  { re: /\bwhois\b|\bwho owns\b.*\bdomain\b|\bdomain owner\b/i, ids: ["whois-lookup"] },
  { re: /\bdns\b|\b(mx|txt|cname|nameserver)s?\b/i, ids: ["dns-lookup"] },
  {
    re: /\b(what|whats|what's)\s+(is\s+)?my\s+(public\s+)?ip\b|\bmy ip address\b/i,
    ids: ["public-ip-detector"],
  },
  {
    re: /\b(where|locate|location|country|geolocat\w*)\b.*\bip\b|\bip\b.*\b(location|country|geolocat\w*)\b/i,
    ids: ["ip-geolocation", "ip-address-lookup"],
  },
  {
    re: /\bip (address )?(lookup|info|details)\b|\blook up .*\bip\b/i,
    ids: ["ip-address-lookup"],
  },
  {
    re: /\b(coordinates|latitude|longitude|lat\/?lon|gps)\b/i,
    ids: ["coordinates-lookup", "location-lookup"],
  },
  { re: /\b(geocode|address to coordinates|find the place|where is)\b/i, ids: ["location-lookup"] },
  { re: /\buser[- ]agent\b/i, ids: ["user-agent-lookup", "user-agent-viewer"] },
  {
    re: /\b(website|site|url)\s+(info|information|details|headers|certificate|ssl)\b|\bcheck (a |this )?(website|site)\b/i,
    ids: ["website-information-lookup"],
  },
  {
    re: /\b(to|into|as)\s+excel\b|\bto\s+(xlsx|spreadsheet)\b|\bexcel\s+(file|sheet)\b/i,
    ids: ["pdf-to-excel", "word-to-excel", "csv-to-excel", "json-to-excel", "xml-to-excel"],
  },
  { re: /\b(to|into|as)\s+(word|docx)\b/i, ids: ["pdf-to-word", "ocr-to-word", "excel-to-word"] },
  { re: /\b(to|into|as)\s+(powerpoint|pptx|slides)\b/i, ids: ["pdf-to-powerpoint"] },
  { re: /\b(to|into|as)\s+(csv)\b/i, ids: ["excel-to-csv", "json-to-csv", "xml-to-csv"] },
  {
    re: /\b(to|into|as)\s+(json)\b/i,
    ids: ["csv-to-json", "excel-to-json", "xml-to-json", "yaml-to-json"],
  },
  { re: /\b(to|into|as)\s+(xml)\b/i, ids: ["json-to-xml", "csv-to-xml", "excel-to-xml"] },
  { re: /\b(to|into|as)\s+(yaml|yml)\b/i, ids: ["json-to-yaml"] },
  {
    re: /\b(to|into|as)\s+(pdf|pdfs)\b/i,
    ids: ["word-to-pdf", "image-to-pdf", "powerpoint-to-pdf", "excel-to-pdf"],
  },
  {
    re: /\b(to|into|as)\s+(text|txt|plain text)\b/i,
    ids: ["pdf-to-text", "word-to-text", "powerpoint-to-text"],
  },
  { re: /\b(to|into|as)\s+(html)\b/i, ids: ["pdf-to-html", "word-to-html", "markdown-to-html"] },
  {
    re: /\b(to|into|as)\s+(png)\b/i,
    ids: ["jpg-png-converter", "image-format-converter", "pdf-to-images"],
  },
  {
    re: /\b(to|into|as)\s+(jpe?g)\b/i,
    ids: ["jpg-png-converter", "image-format-converter", "pdf-to-images"],
  },
  {
    re: /\b(to|into|as)\s+(webp)\b/i,
    ids: ["jpg-webp-converter", "png-webp-converter", "image-format-converter"],
  },
  { re: /\b(to|into|as)\s+(gif)\b/i, ids: ["video-to-gif", "image-to-gif"] },
  { re: /\b(to|into|as)\s+(mp4)\b/i, ids: ["video-to-mp4", "video-converter"] },
  { re: /\b(to|into|as)\s+(mp3)\b/i, ids: ["video-to-mp3", "audio-to-mp3", "audio-converter"] },
  { re: /\b(to|into|as)\s+(wav)\b/i, ids: ["audio-to-wav", "audio-converter"] },
  {
    re: /\b(images?|pictures?)\s+(of|from)\b|\bto\s+images?\b/i,
    ids: ["pdf-to-images", "document-to-images", "powerpoint-to-images"],
  },

  { re: /\b(remove|delete|drop|get rid of|take out)\b.*\bpages?\b/i, ids: ["delete-pdf-pages"] },
  { re: /\b(extract|keep|pull out|take)\b.*\bpages?\b/i, ids: ["extract-pdf-pages", "split-pdf"] },
  { re: /\b(remove|delete|drop)\b.*\bslides?\b/i, ids: ["remove-slides"] },
  {
    re: /\bmerge|combine|join|put together\b/i,
    ids: [
      "merge-pdf",
      "merge-documents",
      "merge-presentations",
      "excel-merger",
      "csv-merger",
      "audio-merger",
      "video-merger",
      "file-merger",
    ],
  },
  {
    re: /\bsplit\b/i,
    ids: [
      "split-pdf",
      "split-documents",
      "split-presentation",
      "csv-splitter",
      "excel-splitter",
      "file-splitter",
    ],
  },
  { re: /\brotate\b/i, ids: ["rotate-pdf-pages", "rotate-image", "rotate-video"] },
  { re: /\bflip|mirror\b/i, ids: ["flip-image"] },
  {
    re: /\bcompress|shrink|make (it|them|this|the file) smaller|reduce (the )?(file )?size\b/i,
    ids: [
      "compress-pdf",
      "image-compressor",
      "compress-documents",
      "compress-presentation",
      "video-compressor",
      "audio-compressor",
      "file-compressor",
    ],
  },
  { re: /\b(zip|archive|bundle)\b/i, ids: ["zip-creator", "file-compressor"] },
  { re: /\bunzip|extract (the )?(zip|archive)\b/i, ids: ["zip-extractor"] },
  { re: /\bocr|read the text|searchable|scanned?\b/i, ids: ["ocr-pdf", "ai-ocr", "ocr-to-word"] },
  { re: /\bwatermark\b/i, ids: ["add-watermark-to-pdf", "image-watermark"] },
  { re: /\bpage numbers?\b/i, ids: ["add-page-numbers-to-pdf"] },
  { re: /\b(password|encrypt|protect)\b/i, ids: ["password-protect-pdf"] },
  { re: /\b(unlock|decrypt|remove the password)\b/i, ids: ["remove-pdf-password"] },
  { re: /\bsign\b/i, ids: ["sign-pdf"] },
  {
    re: /\b(strip|remove|clear)\b.*\b(metadata|exif)\b/i,
    ids: ["metadata-remover", "remove-pdf-metadata", "remove-image-metadata"],
  },
  {
    re: /\bresize|scale (it|them|down|up)|\b\d{2,5}\s*(px|pixels)\b/i,
    ids: ["image-resizer", "video-resizer", "resize-pdf"],
  },
  { re: /\bcrop\b/i, ids: ["image-cropper"] },
  {
    re: /\b(remove|delete|erase)\b.*\bbackgrounds?\b/i,
    ids: ["background-removal", "ai-background-object-removal"],
  },
  { re: /\bupscale|enlarge\b/i, ids: ["image-upscaler"] },
  {
    re: /\b(enhance|improve|sharpen|denoise)\b/i,
    ids: ["image-enhancer", "image-sharpening", "image-denoiser"],
  },
  { re: /\bqr\b/i, ids: ["qr-code-generator", "url-to-qr", "text-to-qr", "qr-code-scanner"] },
  { re: /\btrim|cut\b/i, ids: ["audio-trimmer", "video-trimmer"] },
  { re: /\b(extract|rip|get)\b.*\baudio\b/i, ids: ["extract-audio", "video-to-mp3"] },
  { re: /\bsubtitles?\b/i, ids: ["subtitle-extraction", "subtitle-conversion"] },
  { re: /\bsummari[sz]e\b/i, ids: ["ai-summarizer", "ai-pdf-summarizer", "document-summarizer"] },
  { re: /\btranslate\b/i, ids: ["ai-translator", "document-translator"] },
  { re: /\bgrammar|proofread|spell/i, ids: ["ai-grammar-checker", "grammar-checker"] },
  { re: /\brewrite|rephrase|paraphrase\b/i, ids: ["ai-text-rewriter"] },
  { re: /\bduplicates?\b/i, ids: ["duplicate-row-remover", "duplicate-file-detector"] },
  { re: /\bclean\b/i, ids: ["spreadsheet-cleaner", "empty-row-column-remover"] },
  { re: /\bvalidate\b/i, ids: ["json-validator", "xml-validator", "data-validator"] },
  { re: /\b(hash|checksum|sha|md5)\b/i, ids: ["hash-generator", "checksum-generator"] },
  { re: /\bbase64\b/i, ids: ["base64-encoder", "base64-decoder"] },
];

export interface ToolCandidate {
  tool: ToolMeta;
  options: Record<string, unknown>;
  rank: number;
  /** True when a hand-written route chose it, false when it came from registry search. */
  fromMatcher: boolean;
}

const MAX_CANDIDATES = 6;

/** Ranked registry tools that could serve one clause. Registry ids only, always. */
export function candidatesFor(clause: string, pool = plannableTools()): ToolCandidate[] {
  const byId = new Map(pool.map((t) => [t.id, t] as const));
  const seen = new Set<string>();
  const matched = new Set<string>();
  const picked: ToolMeta[] = [];

  for (const matcher of MATCHERS) {
    if (!matcher.re.test(clause)) continue;
    for (const id of matcher.ids) {
      const tool = byId.get(id);
      if (tool && !seen.has(id)) {
        seen.add(id);
        matched.add(id);
        picked.push(tool);
      }
    }
  }

  // Registry search fills the gaps — and is the only route for tools no matcher mentions.
  const scored = pool
    .map((tool) => ({ tool, score: scoreTool(tool, clause) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.tool.popularity - a.tool.popularity);
  for (const { tool } of scored) {
    if (picked.length >= MAX_CANDIDATES * 2) break;
    if (!seen.has(tool.id)) {
      seen.add(tool.id);
      picked.push(tool);
    }
  }

  return picked.slice(0, MAX_CANDIDATES * 2).map((tool, rank) => ({
    tool,
    options: optionsFromClause(tool, clause),
    rank,
    fromMatcher: matched.has(tool.id),
  }));
}

/** The matcher hits alone, when a clause has any. See `planWithRules` for why that matters. */
function preferredCandidates(list: ToolCandidate[]): ToolCandidate[] {
  const matched = list.filter((c) => c.fromMatcher);
  return matched.length > 0 ? matched : list;
}

// ---- ordering -------------------------------------------------------------------------------------

function acceptsAny(tool: ToolMeta, fileNames: string[]): boolean {
  if (fileNames.length === 0) return inputKind(tool) !== "file";
  return fileNames.some((name) => acceptsFileName(tool, name));
}

interface Ordered {
  steps: ExecutionStep[];
  tools: ToolMeta[];
  /** True when the clauses had to be reordered to make the chain type-compatible. */
  reordered: boolean;
}

/**
 * Finds an ordering of the clauses whose tools actually chain.
 *
 * This is what turns master plan §7.1's example into something that runs. Written literally
 * ("PDF → Excel, remove pages 1–2, compress") the second step would be handed a spreadsheet by a
 * PDF tool, so the chain is impossible; removing the pages *first* is the same request expressed
 * in an order the tools support. The search prefers the user's own order and only moves a clause
 * when leaving it in place has no compatible answer at all.
 */
export function orderPlan(
  clauseCandidates: ToolCandidate[][],
  fileNames: string[],
): Ordered | null {
  const n = clauseCandidates.length;
  if (n === 0) return null;
  const used = new Array<boolean>(n).fill(false);
  const chosen: ToolCandidate[] = [];
  const order: number[] = [];

  const fits = (candidate: ToolCandidate, previous: ToolMeta | undefined): boolean => {
    if (!previous) return acceptsAny(candidate.tool, fileNames);
    if (fileInputTypes(candidate.tool).length === 0) return false;
    return compatibleTypes(previous, candidate.tool).length > 0;
  };

  const walk = (depth: number): boolean => {
    if (depth === n) return true;
    const previous = chosen[chosen.length - 1]?.tool;
    for (let i = 0; i < n; i += 1) {
      if (used[i]) continue;
      for (const candidate of clauseCandidates[i]!) {
        if (!fits(candidate, previous)) continue;
        used[i] = true;
        chosen.push(candidate);
        order.push(i);
        if (walk(depth + 1)) return true;
        used[i] = false;
        chosen.pop();
        order.pop();
      }
    }
    return false;
  };

  // The search is exponential in the number of clauses; six is already more than any real
  // request, and `MAX_PLAN_STEPS` keeps it there.
  if (n > MAX_PLAN_STEPS) return null;
  if (!walk(0)) return null;

  return {
    steps: chosen.map((c) => ({ toolId: c.tool.id, options: c.options })),
    tools: chosen.map((c) => c.tool),
    reordered: order.some((clauseIndex, position) => clauseIndex !== position),
  };
}

// ---- the rule planner -------------------------------------------------------------------------

export interface PlanContext {
  request: string;
  fileNames: string[];
  credentials?: AiCredentials;
  signal?: AbortSignal;
}

export interface PlanResult {
  plan: ExecutionPlan | null;
  rejected: PlanRejection[];
  message: string | null;
  runtime: AiRuntimeConfig | null;
  source: "rules" | "model";
}

function describePlan(steps: ExecutionStep[], reordered: boolean): string {
  const names = steps.map((step, i) => {
    const tool = getTool(step.toolId)!;
    const detail = Object.entries(step.options)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(", ");
    return `${i + 1}. ${tool.name}${detail ? ` (${detail})` : ""}`;
  });
  const lead = reordered
    ? "Here is the plan. The steps are in a different order from your sentence so that each tool gets a file it can actually open:"
    : "Here is the plan:";
  return `${lead}\n${names.join("\n")}`;
}

/** The planner that needs no model at all. */
export function planWithRules(context: PlanContext): PlanResult {
  const clauses = splitClauses(context.request).slice(0, MAX_PLAN_STEPS);
  const candidates = clauses.map((clause) => candidatesFor(clause));
  const usable = candidates.filter((list) => list.length > 0);
  if (usable.length === 0) {
    return {
      plan: null,
      rejected: [],
      message: "No OneStop tool matches that request.",
      runtime: null,
      source: "rules",
    };
  }

  // Four passes, narrowest first. The hand-written routes go first on their own, because a
  // registry-search hit is a guess: "remove the first 2 pages" scores against Metadata Remover
  // too, and letting that compete with Delete PDF Pages is how an assistant ends up confidently
  // doing the wrong thing. Only when the confident answer cannot be chained at all does the
  // search widen, and only then are unrecognised clauses dropped.
  const preferred = candidates.map(preferredCandidates);
  const ordered =
    orderPlan(preferred, context.fileNames) ??
    orderPlan(candidates, context.fileNames) ??
    orderPlan(
      preferred.filter((l) => l.length > 0),
      context.fileNames,
    ) ??
    orderPlan(usable, context.fileNames);
  if (!ordered) {
    return {
      plan: null,
      rejected: [],
      message:
        "Those steps cannot be chained: one of the tools does not accept what the previous one produces.",
      runtime: null,
      source: "rules",
    };
  }

  const validation = validateWorkflow(ordered.steps);
  if (!validation.valid) {
    return {
      plan: null,
      rejected: [],
      message: describeIssues(validation.issues),
      runtime: null,
      source: "rules",
    };
  }
  return {
    plan: { steps: ordered.steps, explanation: describePlan(ordered.steps, ordered.reordered) },
    rejected: [],
    message: null,
    runtime: null,
    source: "rules",
  };
}

// ---- the model planner ------------------------------------------------------------------------

function optionSummary(tool: ToolMeta): string {
  const options = getToolOptions(tool.id);
  if (options.length === 0) return "";
  const described = options
    .filter((o) => o.type !== "signature" && o.type !== "image" && o.type !== "client")
    .slice(0, 6)
    .map((o) => {
      if (o.type === "select") return `${o.id}=${o.choices.map((c) => c.value).join("|")}`;
      if (o.type === "number") return `${o.id}=number ${o.min}-${o.max}`;
      if (o.type === "boolean") return `${o.id}=true|false`;
      return `${o.id}=text`;
    });
  return described.length > 0 ? ` options: ${described.join(", ")}` : "";
}

/** The shortlist of tools the model is allowed to choose from, as compact lines. */
export function toolCatalogue(request: string, limit = 40): ToolMeta[] {
  const pool = plannableTools();
  const scored = pool
    .map((tool) => ({ tool, score: scoreTool(tool, request) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, limit).map((s) => s.tool);
  const seen = new Set(picked.map((t) => t.id));
  // Always include the clause-level candidates: a multi-step request rarely scores every tool it
  // needs against the sentence as a whole.
  for (const clause of splitClauses(request)) {
    for (const candidate of candidatesFor(clause, pool).slice(0, 4)) {
      if (!seen.has(candidate.tool.id) && picked.length < limit + 20) {
        seen.add(candidate.tool.id);
        picked.push(candidate.tool);
      }
    }
  }
  return picked;
}

export function catalogueLines(list: ToolMeta[]): string {
  return list
    .map(
      (t) =>
        `- ${t.id}: ${t.name}. in: ${t.inputTypes.join("/") || "none"}; out: ${t.outputTypes.join("/")}.${optionSummary(t)}`,
    )
    .join("\n");
}

const PLANNER_SYSTEM = [
  "You plan work for OneStop, a local file toolbox. You do not do the work yourself.",
  "You may ONLY use tool ids from the list given to you. Never invent a tool id.",
  "The plan is a straight chain: each step receives the files the previous step produced, so the",
  "steps must be ordered so that every tool can open what the one before it produced — reorder the",
  "user's sentence when that is what makes it work.",
  `Use at most ${MAX_PLAN_STEPS} steps, and as few as will do the job.`,
  'Answer with JSON only: {"steps":[{"toolId":"...","options":{}}],"explanation":"one short paragraph"}',
  'If no listed tool can do it, answer {"steps":[],"explanation":"why not"}.',
  "Only use option keys shown for that tool. Never add prose outside the JSON.",
].join("\n");

interface RawStep {
  toolId?: unknown;
  options?: unknown;
}

/**
 * Turns a model answer into a plan, dropping every step whose tool id is not in the registry.
 * The dropped ids come back in `rejected` so the caller can log and show them — never silently
 * retried into something else (16-ai-assistant.md, Acceptance Criteria).
 */
export function parsePlanAnswer(text: string): {
  steps: ExecutionStep[];
  explanation: string;
  rejected: PlanRejection[];
} {
  const parsed = parseJsonObject(text);
  const rejected: PlanRejection[] = [];
  const steps: ExecutionStep[] = [];
  const raw = Array.isArray(parsed?.steps) ? (parsed.steps as RawStep[]) : [];
  for (const entry of raw.slice(0, MAX_PLAN_STEPS)) {
    const toolId = typeof entry?.toolId === "string" ? entry.toolId.trim() : "";
    if (toolId === "") continue;
    const tool = getTool(toolId);
    if (!tool) {
      rejected.push({ toolId, reason: "There is no such tool in the OneStop registry." });
      continue;
    }
    if (tool.status !== "available") {
      rejected.push({ toolId, reason: `${tool.name} is not ready to run yet.` });
      continue;
    }
    const options =
      entry?.options && typeof entry.options === "object" && !Array.isArray(entry.options)
        ? sanitiseOptions(tool, entry.options as Record<string, unknown>)
        : {};
    steps.push({ toolId: tool.id, options });
  }
  const explanation =
    typeof parsed?.explanation === "string" && parsed.explanation.trim() !== ""
      ? parsed.explanation.trim().slice(0, 1200)
      : "";
  return { steps, explanation, rejected };
}

/** Asks the configured runtime for a plan. Throws `AiError`; the caller decides what to do. */
export async function planWithModel(context: PlanContext): Promise<PlanResult> {
  const catalogue = toolCatalogue(context.request);
  const messages: ChatMessage[] = [
    { role: "system", content: PLANNER_SYSTEM },
    {
      role: "user",
      content: [
        `Available tools:\n${catalogueLines(catalogue)}`,
        context.fileNames.length > 0
          ? `\nFiles the user attached: ${context.fileNames.join(", ")}`
          : "\nThe user attached no files.",
        `\nRequest: ${context.request.slice(0, 4000)}`,
      ].join("\n"),
    },
  ];
  const { text, config } = await chat(
    messages,
    {
      json: true,
      temperature: 0,
      maxTokens: 700,
      budgetMs: 100_000,
      ...(context.signal ? { signal: context.signal } : {}),
    },
    context.credentials ?? {},
  );

  const { steps, explanation, rejected } = parsePlanAnswer(text);
  if (rejected.length > 0) {
    console.warn(
      `[ai/planner] rejected ${rejected.length} planned step(s) not in the registry: ${rejected
        .map((r) => r.toolId)
        .join(", ")}`,
    );
  }
  if (steps.length === 0) {
    return {
      plan: null,
      rejected,
      message: explanation || "No OneStop tool matches that request.",
      runtime: config,
      source: "model",
    };
  }
  const validation = validateWorkflow(steps);
  if (!validation.valid) {
    return {
      plan: null,
      rejected,
      message: describeIssues(validation.issues),
      runtime: config,
      source: "model",
    };
  }
  return {
    plan: { steps, explanation: explanation || describePlan(steps, false) },
    rejected,
    message: null,
    runtime: config,
    source: "model",
  };
}

/**
 * The planner the API route calls: model first when one answers, rules whenever it does not.
 *
 * A rate limit, a bad key or a timeout is *not* swallowed — those are re-thrown so the route can
 * tell the user exactly what happened. Only "there is no runtime" and "the model's answer was
 * unusable" fall through to the rule planner.
 */
export async function buildPlan(context: PlanContext): Promise<PlanResult> {
  let modelResult: PlanResult | null = null;
  try {
    modelResult = await planWithModel(context);
  } catch (err) {
    if (err instanceof AiError && err.code !== "AI_UNAVAILABLE") throw err;
    if (!(err instanceof AiError)) console.error("[ai/planner] model planning failed", err);
  }
  if (modelResult?.plan) return modelResult;

  const rules = planWithRules(context);
  if (rules.plan) {
    return {
      ...rules,
      rejected: [...(modelResult?.rejected ?? []), ...rules.rejected],
      runtime: modelResult?.runtime ?? null,
    };
  }
  return {
    plan: null,
    rejected: [...(modelResult?.rejected ?? []), ...rules.rejected],
    message: modelResult?.message ?? rules.message,
    runtime: modelResult?.runtime ?? null,
    source: modelResult ? "model" : "rules",
  };
}
