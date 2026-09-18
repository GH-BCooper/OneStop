// Options for the developer & file utilities (12-dev-utility-tools.md).
//
// These tools are small, so most of the work here is making the defaults the obvious ones: a
// formatter formats (it does not minify), a password is long and mixed, a checksum is SHA-256,
// and a ZIP is compressed. Nothing here needs a value before it will run except the Regex
// Tester's pattern, which is the tool.
import type {
  BooleanOption,
  ClientOption,
  NumberOption,
  SelectOption,
  TextOption,
  ToolOption,
} from "./options";

function choice(value: string, label: string) {
  return { value, label };
}

// ---- formatters ---------------------------------------------------------------------------------

const formatMode: SelectOption = {
  id: "mode",
  type: "select",
  label: "Result",
  default: "format",
  choices: [choice("format", "Pretty-print (readable)"), choice("minify", "Minify (smallest)")],
};

const indent: NumberOption = {
  id: "indent",
  type: "number",
  label: "Indent",
  default: 2,
  min: 1,
  max: 8,
  unit: "spaces",
  showWhen: { option: "mode", equals: ["format"] },
};

const useTabs: BooleanOption = {
  id: "tabs",
  type: "boolean",
  label: "Indent with tabs",
  default: false,
  showWhen: { option: "mode", equals: ["format"] },
};

const printWidth: NumberOption = {
  id: "printWidth",
  type: "number",
  label: "Wrap lines at",
  default: 80,
  min: 40,
  max: 200,
  unit: "characters",
  showWhen: { option: "mode", equals: ["format"] },
};

const formatterOptions: ToolOption[] = [formatMode, indent, useTabs, printWidth];

// ---- hashing ------------------------------------------------------------------------------------

const algorithm: SelectOption = {
  id: "algorithm",
  type: "select",
  label: "Algorithm",
  default: "sha256",
  choices: [
    choice("sha256", "SHA-256 (recommended)"),
    choice("sha512", "SHA-512"),
    choice("sha384", "SHA-384"),
    choice("sha1", "SHA-1 (legacy)"),
    choice("md5", "MD5 (legacy)"),
    choice("crc32", "CRC-32 (quick check)"),
    choice("all", "All of them"),
  ],
  help: "MD5 and SHA-1 are fine for spotting a changed file, but not for anything security-related.",
};

const digest: SelectOption = {
  id: "digest",
  type: "select",
  label: "Show as",
  default: "hex",
  choices: [
    choice("hex", "Hexadecimal"),
    choice("base64", "Base64"),
    choice("base64url", "Base64 (URL-safe)"),
  ],
};

// ---- archives -----------------------------------------------------------------------------------

const compressionLevel: SelectOption = {
  id: "level",
  type: "select",
  label: "Compression",
  default: "normal",
  choices: [
    choice("store", "None (fastest, just bundles)"),
    choice("fast", "Light"),
    choice("normal", "Normal"),
    choice("maximum", "Maximum (slowest)"),
  ],
};

const archiveNameOption: TextOption = {
  id: "archiveName",
  type: "text",
  label: "Archive name",
  default: "",
  placeholder: "archive",
  help: "Leave blank to name it after the file, or “archive” for a set.",
};

export const UTILITY_TOOL_OPTIONS: Record<string, ToolOption[]> = {
  // ---- Developer / Utility (Features §12) ----
  "html-formatter": [
    ...formatterOptions,
    {
      id: "keepComments",
      type: "boolean",
      label: "Keep comments when minifying",
      default: false,
      showWhen: { option: "mode", equals: ["minify"] },
    },
  ],
  "css-formatter": formatterOptions,
  "javascript-formatter": formatterOptions,

  "markdown-converter": [
    {
      id: "target",
      type: "select",
      label: "Convert to",
      default: "html",
      choices: [
        choice("html", "HTML"),
        choice("txt", "Plain text"),
        choice("docx", "Word (.docx)"),
      ],
    },
    {
      id: "fullDocument",
      type: "boolean",
      label: "Complete HTML page",
      default: true,
      help: "Off gives just the fragment, to paste into an existing page.",
      showWhen: { option: "target", equals: ["html"] },
    },
    {
      id: "breaks",
      type: "boolean",
      label: "Single newline starts a new line",
      default: false,
      help: "How GitHub comments behave. Off follows standard Markdown, where a blank line starts a paragraph.",
      showWhen: { option: "target", equals: ["html"] },
    },
    {
      id: "rawHtml",
      type: "boolean",
      label: "Keep raw HTML",
      default: false,
      help: "Off removes script, style and frame tags from the Markdown — safer if you will open the result in a browser.",
      showWhen: { option: "target", equals: ["html"] },
    },
  ],
  "markdown-to-html": [
    {
      id: "fullDocument",
      type: "boolean",
      label: "Complete HTML page",
      default: true,
      help: "Off gives just the fragment, to paste into an existing page.",
    },
    { id: "breaks", type: "boolean", label: "Single newline starts a new line", default: false },
    {
      id: "rawHtml",
      type: "boolean",
      label: "Keep raw HTML",
      default: false,
      help: "Off removes script, style and frame tags from the Markdown.",
    },
  ],

  "base64-encoder": [
    {
      id: "variant",
      type: "select",
      label: "Alphabet",
      default: "standard",
      choices: [
        choice("standard", "Standard (+ and /)"),
        choice("urlsafe", "URL-safe (- and _, no padding)"),
      ],
    },
    {
      id: "wrap",
      type: "number",
      label: "Wrap lines at",
      default: 0,
      min: 0,
      max: 200,
      unit: "characters",
      help: "0 keeps it on one line. 64 or 76 is what email and PEM files use.",
    },
    {
      id: "dataUrl",
      type: "boolean",
      label: "As a data: URL",
      default: false,
      help: "Adds the data:<type>;base64, prefix so it can be pasted straight into HTML or CSS.",
    },
  ],
  "base64-decoder": [
    {
      id: "output",
      type: "select",
      label: "Give me",
      default: "auto",
      choices: [
        choice("auto", "Text or a file, whichever it is"),
        choice("text", "Text"),
        choice("file", "A file to download"),
      ],
    },
    {
      id: "fileName",
      type: "text",
      label: "File name",
      default: "",
      placeholder: "decoded",
      showWhen: { option: "output", equals: ["file", "auto"] },
    },
  ],

  ...Object.fromEntries(
    ["url-encoder", "url-decoder"].map((id) => [
      id,
      [
        {
          id: "mode",
          type: "select",
          label: "Style",
          default: "component",
          choices: [
            choice("component", "One value (encodes / ? & = too)"),
            choice("uri", "A whole URL (keeps its structure)"),
            choice("form", "Form data (spaces become +)"),
          ],
        },
        {
          id: "perLine",
          type: "boolean",
          label: "Treat each line separately",
          default: false,
        },
      ] as ToolOption[],
    ]),
  ),

  "uuid-generator": [
    {
      id: "version",
      type: "select",
      label: "Kind",
      default: "v4",
      choices: [
        choice("v4", "Version 4 — random"),
        choice("v7", "Version 7 — time-ordered (sorts by when it was made)"),
        choice("nil", "Nil UUID — all zeroes"),
      ],
    },
    { id: "count", type: "number", label: "How many", default: 1, min: 1, max: 1000 },
    { id: "uppercase", type: "boolean", label: "Uppercase", default: false },
    { id: "noHyphens", type: "boolean", label: "Without hyphens", default: false },
    { id: "braces", type: "boolean", label: "In {braces}", default: false },
  ],

  "password-generator": [
    {
      id: "length",
      type: "number",
      label: "Length",
      default: 20,
      min: 4,
      max: 128,
      unit: "characters",
    },
    { id: "count", type: "number", label: "How many", default: 1, min: 1, max: 100 },
    { id: "lower", type: "boolean", label: "Lower-case letters", default: true },
    { id: "upper", type: "boolean", label: "Upper-case letters", default: true },
    { id: "digits", type: "boolean", label: "Digits", default: true },
    { id: "symbols", type: "boolean", label: "Symbols", default: true },
    {
      id: "avoidAmbiguous",
      type: "boolean",
      label: "Avoid look-alike characters",
      default: false,
      help: "Leaves out l, I, 1, O, 0 and friends — useful for a password you will read aloud or retype.",
    },
  ],

  "hash-generator": [
    algorithm,
    digest,
    {
      id: "hmacKey",
      type: "text",
      label: "HMAC key (optional)",
      default: "",
      secret: true,
      help: "Fill this in to sign the text with a shared secret instead of hashing it plainly.",
    },
  ],

  "timestamp-converter": [
    {
      id: "unit",
      type: "select",
      label: "A number means",
      default: "auto",
      choices: [
        choice("auto", "Work it out from the size"),
        choice("seconds", "Seconds since 1970"),
        choice("milliseconds", "Milliseconds since 1970"),
      ],
    },
    {
      id: "timeZone",
      type: "client",
      source: "timeZone",
      label: "Your time zone",
      default: "",
      help: "Taken from your browser, so “local time” below is really yours.",
    } satisfies ClientOption,
  ],

  "regex-tester": [
    {
      id: "pattern",
      type: "text",
      label: "Regular expression",
      default: "",
      placeholder: "\\b(\\w+)@(\\w+\\.\\w+)\\b",
      help: "Without the surrounding slashes.",
    },
    {
      id: "flags",
      type: "text",
      label: "Flags",
      default: "g",
      placeholder: "gim",
      help: "g = every match, i = ignore case, m = ^ and $ per line, s = . matches newlines, u = Unicode.",
    },
    {
      id: "mode",
      type: "select",
      label: "Also show",
      default: "match",
      choices: [
        choice("match", "Just the matches"),
        choice("replace", "The text with replacements"),
        choice("split", "The text split on each match"),
      ],
    },
    {
      id: "replacement",
      type: "text",
      label: "Replace each match with",
      default: "",
      placeholder: "$1 at $2",
      help: "$1, $2 are the capture groups; $& is the whole match.",
      showWhen: { option: "mode", equals: ["replace"] },
    },
    {
      id: "limit",
      type: "number",
      label: "Stop after",
      default: 500,
      min: 1,
      max: 5000,
      unit: "matches",
    },
  ],

  "user-agent-viewer": [
    {
      id: "userAgent",
      type: "client",
      source: "userAgent",
      label: "Your user-agent string",
      default: "",
      help: "Read from your browser. Nothing is sent anywhere else.",
    } satisfies ClientOption,
  ],

  // ---- File Utilities (Features §14) ----
  "file-compressor": [
    { ...compressionLevel, default: "maximum" },
    { ...archiveNameOption, placeholder: "compressed" },
  ],
  "zip-creator": [compressionLevel, archiveNameOption],
  "zip-extractor": [
    {
      id: "only",
      type: "text",
      label: "Only these types",
      default: "",
      placeholder: "jpg, png",
      help: "Leave blank for everything in the archive.",
    },
    {
      id: "limit",
      type: "number",
      label: "At most",
      default: 200,
      min: 1,
      max: 1000,
      unit: "files",
    },
  ],
  "file-merger": [
    {
      id: "order",
      type: "select",
      label: "Join in",
      default: "name",
      choices: [
        choice("name", "Name order (part1, part2, part10…)"),
        choice("given", "The order I added them"),
      ],
    },
    {
      id: "outputName",
      type: "text",
      label: "Result name",
      default: "",
      placeholder: "taken from the parts",
    },
  ],
  "file-splitter": [
    {
      id: "by",
      type: "select",
      label: "Split by",
      default: "size",
      choices: [choice("size", "Part size"), choice("count", "Number of parts")],
    },
    {
      id: "partSize",
      type: "number",
      label: "Part size",
      default: 10,
      min: 0.01,
      max: 2048,
      step: 0.5,
      unit: "MB",
      showWhen: { option: "by", equals: ["size"] },
    },
    {
      id: "parts",
      type: "number",
      label: "Number of parts",
      default: 2,
      min: 2,
      max: 999,
      showWhen: { option: "by", equals: ["count"] },
    },
  ],
  "file-type-converter": [
    {
      id: "target",
      type: "select",
      label: "Convert to",
      default: "pdf",
      choices: [
        choice("pdf", "PDF"),
        choice("docx", "Word (.docx)"),
        choice("xlsx", "Excel (.xlsx)"),
        choice("pptx", "PowerPoint (.pptx)"),
        choice("csv", "CSV"),
        choice("json", "JSON"),
        choice("xml", "XML"),
        choice("yaml", "YAML"),
        choice("html", "HTML"),
        choice("txt", "Plain text"),
        choice("png", "PNG"),
        choice("jpg", "JPG"),
        choice("webp", "WebP"),
        choice("gif", "GIF"),
        choice("mp3", "MP3"),
        choice("wav", "WAV"),
        choice("mp4", "MP4"),
        choice("webm", "WebM"),
      ],
      help: "OneStop picks the tool that does this conversion and runs it for you.",
    },
  ],
  "metadata-remover": [
    {
      id: "authors",
      type: "boolean",
      label: "Also remove author names",
      default: true,
      help: "Names left on comments and tracked changes in Office documents.",
    },
  ],
  "checksum-generator": [
    algorithm,
    digest,
    {
      id: "expected",
      type: "text",
      label: "Check against (optional)",
      default: "",
      placeholder: "paste the published checksum",
      help: "Paste a checksum from a download page and OneStop will tell you whether the file matches.",
    },
  ],
  "duplicate-file-detector": [
    {
      id: "listKeepers",
      type: "boolean",
      label: "Also list the files with no duplicate",
      default: true,
    },
  ],
};
