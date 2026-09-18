// Text Formatter engine (Features 2.13) — 07-word-ppt-tools.md. Pure string functions.

export type CaseMode = "none" | "sentence" | "lower" | "upper" | "title" | "capitalize";
export type BlankLines = "keep" | "single" | "remove";

export interface FormatOptions {
  case?: CaseMode;
  trimLines?: boolean;
  collapseSpaces?: boolean;
  blankLines?: BlankLines;
  /** Join hard-wrapped lines inside a paragraph into one line. */
  unwrap?: boolean;
  tabsToSpaces?: boolean;
  straightQuotes?: boolean;
  lineEndings?: "lf" | "crlf";
}

const SMALL_WORDS = new Set(
  "a an and as at but by en for if in nor of on or per the to via vs with from into onto over up".split(
    " ",
  ),
);

export function titleCase(text: string): string {
  return text.replace(/[^\s]+/g, (word, offset: number) => {
    const lower = word.toLowerCase();
    const first = offset === 0 || /[:.!?]\s*$/.test(text.slice(0, offset));
    if (!first && SMALL_WORDS.has(lower.replace(/[^a-z]/g, ""))) return lower;
    if (/[A-Z].*[A-Z]/.test(word) && word !== word.toUpperCase()) return word; // iPhone, McDonald
    return lower.replace(
      /^([^\p{L}]*)(\p{L})/u,
      (_, pre: string, ch: string) => pre + ch.toUpperCase(),
    );
  });
}

export function sentenceCase(text: string): string {
  const lower = text.toLowerCase();
  return lower
    .replace(
      /(^\s*|[.!?]\s+|\n\s*)(\p{L})/gu,
      (_, pre: string, ch: string) => pre + ch.toUpperCase(),
    )
    .replace(/\bi\b/g, "I");
}

export function formatText(input: string, options: FormatOptions = {}): string {
  const {
    case: mode = "none",
    trimLines = true,
    collapseSpaces = true,
    blankLines = "single",
    unwrap = false,
    tabsToSpaces = false,
    straightQuotes = false,
    lineEndings = "lf",
  } = options;
  let text = input.replace(/\r\n?/g, "\n").replaceAll(String.fromCharCode(0xa0), " ");
  if (tabsToSpaces) text = text.replace(/\t/g, "    ");
  if (straightQuotes) {
    text = text.replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"');
  }
  let lines = text.split("\n");
  if (collapseSpaces)
    lines = lines.map((l) => l.replace(/(\S)[ \t]{2,}/g, (_, c: string) => `${c} `));
  if (trimLines) lines = lines.map((l) => l.trim());
  text = lines.join("\n");
  if (unwrap) {
    text = text
      .split(/\n\s*\n/)
      .map((p) => p.replace(/-\n(?=\p{Ll})/gu, "").replace(/\s*\n\s*/g, " "))
      .join("\n\n");
  }
  if (blankLines === "single") text = text.replace(/\n{3,}/g, "\n\n");
  if (blankLines === "remove") text = text.replace(/\n{2,}/g, "\n");
  text = text.replace(/^\n+|\n+$/g, "");
  switch (mode) {
    case "lower":
      text = text.toLowerCase();
      break;
    case "upper":
      text = text.toUpperCase();
      break;
    case "title":
      text = text.split("\n").map(titleCase).join("\n");
      break;
    case "capitalize":
      text = text.replace(
        /\p{L}[\p{L}'’]*/gu,
        (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase(),
      );
      break;
    case "sentence":
      text = sentenceCase(text);
      break;
    default:
      break;
  }
  text += "\n";
  return lineEndings === "crlf" ? text.replace(/\n/g, "\r\n") : text;
}
