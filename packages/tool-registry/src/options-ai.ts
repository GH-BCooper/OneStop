// Options for the AI tools (16-ai-assistant.md). Split out of options.ts for the same reason as
// the data/image/media files: one screenful per phase.
//
// Two of them appear on every AI tool and neither is typed by the user on the page:
// `aiProvider` and `aiKey` are `client` options, the same mechanism phase 12 introduced for "what
// browser am I?" — a value only the browser knows. Here the value is the runtime the user picked
// in Settings and, for a hosted free tier, the key they entered there. It travels with the
// request and is never stored: `redactOptionValues` strips the key before a job is recorded.
import type { ToolOption } from "./options";

/** Attached to every AI tool so a page run uses the same runtime the Settings page shows. */
export const AI_RUNTIME_OPTIONS: ToolOption[] = [
  {
    id: "aiProvider",
    type: "client",
    source: "aiProvider",
    label: "AI runtime",
    default: "",
    visible: false,
  },
  {
    id: "aiKey",
    type: "client",
    source: "aiKey",
    label: "AI key",
    default: "",
    visible: false,
  },
];

/** "Use AI, use the built-in offline method, or use AI when it is available." */
export const AI_METHOD_OPTION: ToolOption = {
  id: "method",
  type: "select",
  label: "Method",
  default: "auto",
  choices: [
    { value: "auto", label: "AI when available, otherwise the built-in method" },
    { value: "ai", label: "AI only" },
    { value: "builtin", label: "Built-in offline method only" },
  ],
  help: "The built-in method never needs a model, a key or the internet.",
};

const length: ToolOption = {
  id: "length",
  type: "select",
  label: "Length",
  default: "medium",
  choices: [
    { value: "short", label: "Short (2–4 sentences)" },
    { value: "medium", label: "Medium (a paragraph)" },
    { value: "long", label: "Long (several paragraphs)" },
  ],
};

const style: ToolOption = {
  id: "style",
  type: "select",
  label: "Shape",
  default: "paragraph",
  choices: [
    { value: "paragraph", label: "Flowing paragraphs" },
    { value: "bullets", label: "Bullet points" },
  ],
};

const tone: ToolOption = {
  id: "tone",
  type: "select",
  label: "Tone",
  default: "neutral",
  choices: [
    { value: "neutral", label: "Neutral" },
    { value: "friendly", label: "Friendly" },
    { value: "formal", label: "Formal" },
    { value: "direct", label: "Direct and brief" },
    { value: "apologetic", label: "Apologetic" },
    { value: "enthusiastic", label: "Enthusiastic" },
  ],
};

/**
 * Languages the AI Translator offers. The first six match phase 07's offline dictionary, so the
 * built-in fallback can still answer for those; the rest need a model and say so.
 */
export const AI_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "ro", label: "Romanian" },
  { value: "sv", label: "Swedish" },
  { value: "tr", label: "Turkish" },
  { value: "ru", label: "Russian" },
  { value: "uk", label: "Ukrainian" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "te", label: "Telugu" },
  { value: "ta", label: "Tamil" },
  { value: "zh", label: "Chinese (Simplified)" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
];

/** The six the offline dictionary covers (07-word-ppt-tools.md). */
export const OFFLINE_LANGUAGES = ["en", "es", "fr", "de", "it", "pt"];

function withRuntime(options: ToolOption[]): ToolOption[] {
  return [...options, ...AI_RUNTIME_OPTIONS];
}

export const AI_TOOL_OPTIONS: Record<string, ToolOption[]> = {
  "ai-email-drafter": withRuntime([
    {
      id: "purpose",
      type: "text",
      label: "What is the email for?",
      default: "",
      multiline: true,
      placeholder: "Ask the supplier for an updated invoice; mention the order is two weeks late",
      help: "Bullet points are fine. Leave blank to use the text or file you uploaded.",
    },
    {
      id: "recipient",
      type: "text",
      label: "Who is it to?",
      default: "",
      placeholder: "the supplier's accounts team",
    },
    tone,
    {
      id: "emailLength",
      type: "select",
      label: "Length",
      default: "medium",
      choices: [
        { value: "short", label: "Short (3–4 lines)" },
        { value: "medium", label: "Medium" },
        { value: "long", label: "Detailed" },
      ],
    },
    { id: "signOff", type: "text", label: "Sign off as", default: "", placeholder: "Your name" },
  ]),

  "ai-text-generator": withRuntime([
    {
      id: "format",
      type: "select",
      label: "Shape",
      default: "paragraph",
      choices: [
        { value: "paragraph", label: "Paragraphs" },
        { value: "bullets", label: "Bullet points" },
        { value: "outline", label: "Outline" },
        { value: "list", label: "Numbered list" },
      ],
    },
    tone,
    length,
  ]),

  "ai-text-rewriter": withRuntime([
    {
      id: "goal",
      type: "select",
      label: "Rewrite to be",
      default: "clearer",
      choices: [
        { value: "clearer", label: "Clearer" },
        { value: "shorter", label: "Shorter" },
        { value: "longer", label: "More detailed" },
        { value: "formal", label: "More formal" },
        { value: "friendly", label: "Friendlier" },
        { value: "simple", label: "Simpler (plain English)" },
      ],
    },
    {
      id: "keepMeaning",
      type: "boolean",
      label: "Keep every fact and number unchanged",
      default: true,
    },
  ]),

  "ai-summarizer": withRuntime([length, style, AI_METHOD_OPTION]),

  "ai-grammar-checker": withRuntime([
    {
      id: "output",
      type: "select",
      label: "Results",
      default: "both",
      choices: [
        { value: "both", label: "Report and corrected copy" },
        { value: "report", label: "Report only" },
        { value: "corrected", label: "Corrected copy only" },
      ],
    },
    AI_METHOD_OPTION,
  ]),

  "ai-translator": withRuntime([
    {
      id: "from",
      type: "select",
      label: "From",
      default: "auto",
      choices: [{ value: "auto", label: "Detect automatically" }, ...AI_LANGUAGES],
    },
    {
      id: "to",
      type: "select",
      label: "To",
      default: "es",
      choices: AI_LANGUAGES,
      help: "The built-in offline fallback only covers English, Spanish, French, German, Italian and Portuguese.",
    },
    AI_METHOD_OPTION,
  ]),

  "ai-ocr": withRuntime([
    {
      id: "language",
      type: "select",
      label: "Language of the text",
      default: "eng",
      choices: [
        { value: "eng", label: "English" },
        { value: "spa", label: "Spanish" },
        { value: "fra", label: "French" },
        { value: "deu", label: "German" },
      ],
      help: "Languages other than English need their Tesseract data installed on the server.",
    },
    {
      id: "tidy",
      type: "boolean",
      label: "Let AI tidy the recognised text",
      default: true,
      help: "Fixes line breaks and obvious mis-reads. Off gives the raw OCR output.",
    },
  ]),

  "ai-document-analyzer": withRuntime([
    {
      id: "focus",
      type: "select",
      label: "Focus on",
      default: "overview",
      choices: [
        { value: "overview", label: "Overview — what this document is and says" },
        { value: "structure", label: "Structure — sections, headings, length" },
        { value: "actions", label: "Actions, dates and obligations" },
        { value: "risks", label: "Risks and things to check" },
      ],
    },
    AI_METHOD_OPTION,
  ]),

  "ai-pdf-summarizer": withRuntime([
    length,
    style,
    {
      id: "pages",
      type: "text",
      label: "Pages",
      default: "",
      placeholder: "all",
      help: "Leave blank for the whole PDF. Accepts 1-3, 5, 9-.",
    },
    AI_METHOD_OPTION,
  ]),

  "ask-questions-about-a-file": withRuntime([
    {
      id: "question",
      type: "text",
      label: "Your question",
      default: "",
      multiline: true,
      placeholder: "What is the notice period in this contract?",
    },
    {
      id: "showSources",
      type: "boolean",
      label: "Show the passages the answer came from",
      default: true,
    },
    AI_METHOD_OPTION,
  ]),

  "extract-information": withRuntime([
    {
      id: "fields",
      type: "text",
      label: "Fields to pull out",
      default: "",
      placeholder: "invoice number, date, total, supplier",
      help: "Comma-separated. Leave blank and OneStop extracts the obvious ones (dates, emails, amounts, phone numbers).",
    },
    AI_METHOD_OPTION,
  ]),

  "unstructured-to-structured-data": withRuntime([
    {
      id: "format",
      type: "select",
      label: "Output",
      default: "json",
      choices: [
        { value: "json", label: "JSON" },
        { value: "csv", label: "CSV" },
      ],
    },
    {
      id: "columns",
      type: "text",
      label: "Columns",
      default: "",
      placeholder: "name, email, city",
      help: "Leave blank to let OneStop work them out from the text.",
    },
    AI_METHOD_OPTION,
  ]),

  "ai-image-generator": [
    {
      id: "prompt",
      type: "text",
      label: "Describe the image",
      default: "",
      multiline: true,
      placeholder: "a watercolour of a lighthouse at dawn",
    },
    {
      id: "size",
      type: "select",
      label: "Size",
      default: "512",
      choices: [
        { value: "512", label: "512 × 512" },
        { value: "768", label: "768 × 768" },
        { value: "1024", label: "1024 × 1024" },
      ],
    },
    { id: "count", type: "number", label: "How many", default: 1, min: 1, max: 4 },
    {
      id: "seed",
      type: "number",
      label: "Seed",
      default: 0,
      min: 0,
      max: 2147483647,
      help: "0 picks a new one each time.",
    },
  ],

  "ai-image-editor": [
    {
      id: "prompt",
      type: "text",
      label: "Describe the change",
      default: "",
      multiline: true,
      placeholder: "make the sky stormy",
    },
    {
      id: "strength",
      type: "number",
      label: "How much to change",
      default: 55,
      min: 5,
      max: 95,
      unit: "%",
    },
  ],

  "ai-background-object-removal": [
    {
      id: "target",
      type: "select",
      label: "Remove",
      default: "background",
      choices: [
        { value: "background", label: "The background" },
        { value: "object", label: "An object I mark" },
      ],
    },
    // The object rectangle uses the same percentage options as phase 09's Object Removal, because
    // this tool hands the work to exactly that code when no AI model is configured.
    {
      id: "left",
      type: "number",
      label: "Area left edge",
      default: 40,
      min: 0,
      max: 100,
      unit: "%",
      help: "Mark the object with a box, measured in % of the image from its top-left corner.",
      showWhen: { option: "target", equals: ["object"] },
    },
    {
      id: "top",
      type: "number",
      label: "Area top edge",
      default: 40,
      min: 0,
      max: 100,
      unit: "%",
      showWhen: { option: "target", equals: ["object"] },
    },
    {
      id: "width",
      type: "number",
      label: "Area width",
      default: 20,
      min: 1,
      max: 100,
      unit: "%",
      showWhen: { option: "target", equals: ["object"] },
    },
    {
      id: "height",
      type: "number",
      label: "Area height",
      default: 20,
      min: 1,
      max: 100,
      unit: "%",
      showWhen: { option: "target", equals: ["object"] },
    },
    {
      id: "tolerance",
      type: "number",
      label: "Colour tolerance",
      default: 15,
      min: 1,
      max: 60,
      help: "Built-in method: how different a pixel can be from the background colour and still be removed.",
      showWhen: { option: "target", equals: ["background"] },
    },
    AI_METHOD_OPTION,
  ],
};
