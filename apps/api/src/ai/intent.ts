// Step one of master plan §7.2's pipeline: intent detection.
//
// Rules first, model second — and that order is deliberate. The rules alone are enough to route
// every phrasing the acceptance tests use, so the assistant behaves identically whether or not a
// model is running; the model is asked only when the rules are unsure, and its answer is still
// forced back into the same four kinds. A model can never invent a fifth kind, and it can never
// turn "run a tool" into "run something else".
import type { AssistantIntent, AssistantIntentKind } from "@onestop/types";
import { AiError, chat, type ChatMessage } from "./modelRuntime.ts";
import type { AiCredentials } from "./providers.ts";

/** Things OneStop has no tool for and never will within this build (master plan §7.3). */
const OUT_OF_SCOPE = [
  /\b3d\s*(model|print|render|mesh)/i,
  /\bcad\b|\bblender\b|\bautocad\b/i,
  /\btrain (a|my|the) (model|ai|llm)\b/i,
  /\b(video|film|movie) editing timeline\b/i,
  /\bwrite (me )?(an? )?(app|website|program|script|code)\b/i,
  /\bsend (an? )?(email|sms|message)\b/i,
  /\bbook (a )?(flight|hotel|ticket)\b/i,
  /\bpost (this |it )?(to|on) (twitter|x|instagram|facebook|linkedin)\b/i,
  /\bsign (me )?(up|in) (to|for)\b/i,
  /\bbrowse the (web|internet)\b/i,
  /\bscrape\b/i,
  /\bspreadsheet macro|vba\b/i,
  /\banimate\b/i,
  /\bdeepfake|face swap\b/i,
  /\btranscribe (this )?(audio|video|podcast|recording)\b/i,
  /\bspeech.to.text\b|\bvoice.over\b|\btext.to.speech\b/i,
];

const QUESTION_STARTERS =
  /^(what|who|when|where|why|how|which|does|do|is|are|can|could|should|did|was|were|tell me|explain|summari[sz]e what|according to)\b/i;

const ABOUT_A_FILE =
  /\b(in|from|of|about|inside|within)\s+(the|this|my|that|attached|uploaded)?\s*(file|document|pdf|doc|docx|spreadsheet|csv|text|report|paper|contract|invoice|page)/i;

const GENERATE_VERBS =
  /\b(write|draft|compose|generate|rewrite|rephrase|paraphrase|proofread|translate|summari[sz]e|shorten|expand|make it (shorter|longer|formal|casual))\b/i;

/** "list all the pdf tools", "how many image tools do you have", "what qr tools are there". */
const CATALOGUE_RE =
  /\b(list|show|display|name)\b[^.?!]*\btools?\b|\bhow many\b[^.?!]*\btools?\b|\b(what|which)\b[^.?!]*\btools?\b|\ball (of )?(the |your )?tools\b|\btools? (do you have|are there|exist|are available|can (you|onestop) use)\b/i;

/** "list my workflows", "what are my favourite tools", "show my favourites" — the client's own
 *  saved-workflow / starred-tool lists, not the registry, but still a plain listing rather than
 *  something to run (see `catalogue.ts`). */
const MY_LISTS_RE =
  /\b(my|the)\b[^.?!]*\bworkflows?\b|\bworkflows?\b[^.?!]*\b(do i have|have i saved|are there|do i (use|run)|did i (use|run)|have i (used|run))\b|\b(favou?rite|starred|frequently used|most used|recently used|often used)\b[^.?!]*\bworkflows?\b|\bfavou?rites?\b/i;

const TOOL_VERBS =
  /\b(convert|merge|split|compress|rotate|resize|crop|extract|remove|delete|encrypt|decrypt|watermark|sign|ocr|scan|flatten|unlock|protect|zip|unzip|archive|encode|decode|hash|format|validate|clean|deduplicate|transcode|trim)\b/i;

/** "what is OneStop", "who made you", "give me a description of OneStop" — meta questions about
 *  the app or assistant itself. These are conversation, not a file task, even with no question
 *  word and no attached file; an explicit TOOL_VERBS match still wins (e.g. "convert this with
 *  OneStop"). */
const ABOUT_ONESTOP_RE = /\bonestop\b/i;

export const LOW_CONFIDENCE = 0.4;

/** The rule-based pass. Always returns something; `confidence` says how sure it is. */
export function detectIntentRules(
  request: string,
  { hasFiles = false }: { hasFiles?: boolean } = {},
): AssistantIntent {
  const text = request.trim();
  const base = { request: text, source: "rules" as const };

  if (text === "") {
    return { ...base, kind: "unsupported", confidence: 1, needsFiles: false };
  }
  if (OUT_OF_SCOPE.some((re) => re.test(text))) {
    return { ...base, kind: "unsupported", confidence: 0.9, needsFiles: false };
  }

  const toolish = TOOL_VERBS.test(text);
  const questionish = QUESTION_STARTERS.test(text) || text.endsWith("?");
  const generative = GENERATE_VERBS.test(text);

  // "list all the pdf tools", "how many image tools do you have" — asking about OneStop's own
  // catalogue, not asking it to run anything. An explicit action verb ("compress", "convert", …)
  // always wins over the word "tool" showing up in the sentence.
  if (!toolish && (CATALOGUE_RE.test(text) || MY_LISTS_RE.test(text))) {
    return { ...base, kind: "catalogue", confidence: 0.9, needsFiles: false };
  }

  // "What is OneStop", "who made you", "give me a description of OneStop" — a question about the
  // app or assistant itself, never a file task.
  if (!toolish && ABOUT_ONESTOP_RE.test(text)) {
    return { ...base, kind: "chat", confidence: 0.9, needsFiles: false };
  }

  // "What does the contract say about termination?" — a question *about* an uploaded file is RAG,
  // not a tool chain, even when it mentions a PDF.
  if (questionish && (hasFiles || ABOUT_A_FILE.test(text)) && !toolish) {
    return { ...base, kind: "question", confidence: 0.85, needsFiles: true };
  }
  if (toolish) {
    return { ...base, kind: "tool-chain", confidence: questionish ? 0.6 : 0.85, needsFiles: true };
  }
  if (generative) {
    return { ...base, kind: "generate", confidence: 0.75, needsFiles: false };
  }
  if (questionish) {
    // A question with no file in play and no explicit "write/summarise/translate" verb (already
    // ruled out above) is small talk or general knowledge, not a OneStop task - "chat", not
    // "generate". `question` is reserved for RAG over an attached file.
    return {
      ...base,
      kind: hasFiles ? "question" : "chat",
      confidence: 0.5,
      needsFiles: hasFiles,
    };
  }
  // Nothing matched. With files in hand a tool chain is the better guess, but say it is a guess;
  // with none, there is nothing to run at all, so it is treated as conversation.
  return {
    ...base,
    kind: hasFiles ? "tool-chain" : "chat",
    confidence: 0.3,
    needsFiles: hasFiles,
  };
}

const KINDS: AssistantIntentKind[] = [
  "tool-chain",
  "question",
  "generate",
  "chat",
  "catalogue",
  "unsupported",
];

const INTENT_SYSTEM = [
  "You classify a request for OneStop, a local file-and-document toolbox.",
  'Answer with JSON only: {"kind":"...","confidence":0.0}',
  "kind must be exactly one of:",
  '  "tool-chain"  — run OneStop tools on the user\'s files (convert, merge, compress, OCR, resize…)',
  '  "question"    — answer a question about the content of an uploaded file',
  '  "generate"    — produce or rework text with the model alone (write, rewrite, translate, summarise)',
  '  "chat"        — plain conversation: greetings, small talk, general questions with nothing to run',
  '  "catalogue"   — asking what OneStop\'s own tools are, or the user\'s own saved workflows/favourite tools (counts, "list the pdf tools", "what tools do you have", "list my workflows", "my favourite tools")',
  '  "unsupported" — OneStop cannot do this at all (3D modelling, sending email, browsing the web…)',
  "confidence is 0 to 1. Never add prose, never add other keys.",
].join("\n");

/**
 * Intent detection with the model as a tie-breaker. Falls back to the rules on any AI failure,
 * so a missing or rate-limited runtime never stops the assistant from answering.
 */
export async function detectIntent(
  request: string,
  options: {
    hasFiles?: boolean;
    /** Recent turns of the same chat, oldest first - lets the model tell "what did I just ask"
     *  apart from a genuine question about an attached file, instead of guessing from one line. */
    history?: ChatMessage[];
    credentials?: AiCredentials;
    signal?: AbortSignal;
  } = {},
): Promise<AssistantIntent> {
  const rules = detectIntentRules(request, { hasFiles: options.hasFiles ?? false });
  if (rules.confidence >= 0.7 || rules.request === "") return rules;

  const recap = (options.history ?? [])
    .slice(-6)
    .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
    .join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: INTENT_SYSTEM },
    {
      role: "user",
      content: [
        recap ? `Recent conversation (for context only):\n${recap}\n` : null,
        `Files attached: ${options.hasFiles ? "yes" : "no"}`,
        `Request: ${request.trim().slice(0, 2000)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
  try {
    const { text } = await chat(
      messages,
      {
        json: true,
        temperature: 0,
        maxTokens: 120,
        // Only a tie-breaker for the rules: never worth more than a few seconds of the user's wait.
        budgetMs: 8_000,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      options.credentials ?? {},
    );
    const parsed = parseJsonObject(text);
    const kind = KINDS.find((k) => k === parsed?.kind);
    if (!kind) return rules;
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : 0.7;
    return {
      request: rules.request,
      kind,
      confidence: Math.min(1, Math.max(0, confidence)),
      needsFiles: kind === "question" || kind === "tool-chain",
      source: "model",
    };
  } catch (err) {
    if (!(err instanceof AiError)) console.error("[ai/intent] unexpected failure", err);
    return rules;
  }
}

/**
 * Reads the first JSON object out of a model answer. Models wrap JSON in prose and code fences
 * often enough that this is the normal path, not an edge case.
 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate; an unparseable answer is a normal model failure, not a crash.
    }
  }
  return null;
}
