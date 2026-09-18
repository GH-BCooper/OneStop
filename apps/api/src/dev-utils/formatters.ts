// HTML / CSS / JavaScript formatting and minifying (12-dev-utility-tools.md §12.5-12.7).
//
// Formatting is Prettier used as a library, so the result matches what the repo's own formatter
// would produce and no reimplementation of a language's layout rules is needed. Minifying is
// ours, because Prettier deliberately has no minify mode:
//   - CSS and HTML minify properly (a scanner that respects strings, comments and the elements
//     whose whitespace is significant).
//   - JavaScript is only ever *compacted* — comments and indentation go, line structure stays.
//     A real JS minifier has to understand ASI, regex-vs-division and scope to rename safely;
//     getting that subtly wrong would silently break someone's file, which is far worse than a
//     slightly larger one. The tool says exactly this in its summary.
import type { Executor } from "@onestop/tool-registry";
import * as prettier from "prettier";
import {
  MIME,
  optEnum,
  optNumber,
  optBool,
  readTextSource,
  runUtilTool,
  safeStem,
  textFile,
  unsupported,
  bytesLabel,
} from "./common.ts";

export type Lang = "html" | "css" | "js";

const LABEL: Record<Lang, string> = { html: "HTML", css: "CSS", js: "JavaScript" };

/** Prettier chooses a parser per dialect; the file's own extension is the better hint. */
function parserFor(lang: Lang, ext: string): string {
  if (lang === "css") {
    if (ext === "scss") return "scss";
    if (ext === "less") return "less";
    return "css";
  }
  if (lang === "js") {
    if (ext === "ts" || ext === "tsx" || ext === "mts" || ext === "cts") return "babel-ts";
    return "babel";
  }
  if (ext === "vue") return "vue";
  return "html";
}

export interface FormatOptions {
  indent?: number;
  useTabs?: boolean;
  printWidth?: number;
}

/** Pretty-prints source with Prettier, turning its syntax errors into a message with a position. */
export async function formatSource(
  source: string,
  lang: Lang,
  ext = "",
  options: FormatOptions = {},
): Promise<string> {
  try {
    return await prettier.format(source, {
      parser: parserFor(lang, ext),
      tabWidth: options.indent ?? 2,
      useTabs: options.useTabs ?? false,
      printWidth: options.printWidth ?? 80,
      endOfLine: "lf",
    });
  } catch (err) {
    throw syntaxError(err, lang);
  }
}

function syntaxError(err: unknown, lang: Lang): Error {
  const e = err as { message?: string; loc?: { start?: { line?: number; column?: number } } };
  const line = e?.loc?.start?.line;
  const column = e?.loc?.start?.column;
  const first = (e?.message ?? "").split("\n")[0]!.trim();
  const where = line ? ` at line ${line}${column ? `, column ${column}` : ""}` : "";
  return unsupported(
    `This ${LABEL[lang]} could not be parsed${where}. Fix the syntax and try again.`,
    first,
  );
}

// ---- minifying --------------------------------------------------------------------------------

interface Span {
  text: string;
  kind: "code" | "string" | "comment";
}

/** CSS split into code, string and comment spans, so minifying never touches a literal. */
export function scanCss(source: string): Span[] {
  const spans: Span[] = [];
  let buf = "";
  const flush = () => {
    if (buf) spans.push({ text: buf, kind: "code" });
    buf = "";
  };
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]!;
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      flush();
      spans.push({ text: source.slice(i, stop), kind: "comment" });
      i = stop - 1;
    } else if (c === '"' || c === "'") {
      const stop = endOfString(source, i, c);
      flush();
      spans.push({ text: source.slice(i, stop), kind: "string" });
      i = stop - 1;
    } else {
      buf += c;
    }
  }
  flush();
  return spans;
}

function endOfString(source: string, start: number, quote: string): number {
  for (let i = start + 1; i < source.length; i += 1) {
    const c = source[i]!;
    if (c === "\\") i += 1;
    else if (c === quote) return i + 1;
    else if (c === "\n" && quote !== "`") return i + 1; // unterminated: stop at the line end
  }
  return source.length;
}

export function minifyCss(source: string): string {
  let out = "";
  for (const span of scanCss(source)) {
    if (span.kind === "comment") continue;
    if (span.kind === "string") {
      out += span.text;
      continue;
    }
    out += span.text
      .replace(/\s+/g, " ")
      .replace(/\s*([{}:;,>~+])\s*/g, "$1")
      .replace(/;\}/g, "}");
  }
  return out.trim();
}

const HTML_VERBATIM = /<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

export function minifyHtml(source: string, { comments = false } = {}): string {
  const pieces: { text: string; verbatim: boolean }[] = [];
  let last = 0;
  for (const m of source.matchAll(HTML_VERBATIM)) {
    pieces.push({ text: source.slice(last, m.index), verbatim: false });
    pieces.push({ text: m[0], verbatim: true });
    last = m.index + m[0].length;
  }
  pieces.push({ text: source.slice(last), verbatim: false });

  const parts: string[] = [];
  for (const piece of pieces) {
    if (piece.verbatim) {
      // Minify the CSS/JS inside <style>/<script>, but never touch <pre>/<textarea>.
      parts.push(minifyEmbedded(piece.text));
      continue;
    }
    let text = piece.text;
    if (!comments) text = text.replace(/<!--(?!\[if)[\s\S]*?-->/g, "");
    parts.push(text.replace(/\s+/g, " ").replace(/>\s+</g, "><"));
  }
  return parts.join("").trim();
}

function minifyEmbedded(block: string): string {
  const open = block.indexOf(">");
  const closeAt = block.lastIndexOf("</");
  if (open === -1 || closeAt === -1 || closeAt < open) return block;
  const tag = block.slice(0, open + 1);
  const body = block.slice(open + 1, closeAt);
  const close = block.slice(closeAt);
  if (/^<style\b/i.test(tag)) return `${tag}${minifyCss(body)}${close}`;
  if (/^<script\b/i.test(tag) && !/\stype\s*=\s*["']?(?!text\/javascript|module)/i.test(tag)) {
    return `${tag}${compactJs(body)}${close}`;
  }
  return block;
}

/**
 * Strips JavaScript comments and leading indentation without joining lines. The scanner tracks
 * strings, template literals and the regex-literal-vs-division ambiguity so nothing inside a
 * literal is removed; line structure is preserved so automatic semicolon insertion cannot change
 * the meaning of the file.
 */
export function compactJs(source: string): string {
  let out = "";
  let prevSignificant = "";
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? source.length : nl - 1;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const block = source.slice(i, end === -1 ? source.length : end + 2);
      i = end === -1 ? source.length : end + 1;
      // A block comment spanning lines still ends the line, or ASI could change.
      if (block.includes("\n")) out += "\n";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const stop = endOfString(source, i, c);
      out += source.slice(i, stop);
      prevSignificant = c;
      i = stop - 1;
      continue;
    }
    if (c === "/" && regexAllowedAfter(prevSignificant)) {
      const stop = endOfRegex(source, i);
      if (stop > i + 1) {
        out += source.slice(i, stop);
        prevSignificant = "/";
        i = stop - 1;
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) prevSignificant = c;
  }
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
}

const REGEX_MAY_FOLLOW = "(,=:[!&|?{};+-*%~^<>";

function regexAllowedAfter(prev: string): boolean {
  return prev === "" || REGEX_MAY_FOLLOW.includes(prev);
}

function endOfRegex(source: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < source.length; i += 1) {
    const c = source[i]!;
    if (c === "\\") i += 1;
    else if (c === "\n")
      return start + 1; // not a regex after all
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      let j = i + 1;
      while (j < source.length && /[a-z]/i.test(source[j]!)) j += 1;
      return j;
    }
  }
  return start + 1;
}

// ---- executors --------------------------------------------------------------------------------

const EXT: Record<Lang, string> = { html: "html", css: "css", js: "js" };
const MIME_FOR: Record<Lang, string> = { html: MIME.html, css: MIME.css, js: MIME.js };

const JS_COMPACT_NOTE =
  " JavaScript is compacted (comments and indentation removed) rather than fully minified — " +
  "renaming variables cannot be done safely without a full compiler.";

export function formatterExecutor(lang: Lang, toolId: string): Executor {
  return (input, options, ctx) =>
    runUtilTool(toolId, async () => {
      const src = await readTextSource(input, ctx, LABEL[lang], { stem: "code" });
      const mode = optEnum(options, "mode", ["format", "minify"] as const, "format");
      const indent = optNumber(options, "indent", 2, { min: 1, max: 8 });
      const useTabs = optBool(options, "tabs", false);
      const printWidth = optNumber(options, "printWidth", 80, { min: 40, max: 200 });

      let result: string;
      let note = "";
      if (mode === "format") {
        result = await formatSource(src.text, lang, src.ext, { indent, useTabs, printWidth });
      } else {
        // Parse first even when minifying, so broken input fails with a position rather than
        // being silently mangled into something that still looks like output.
        await formatSource(src.text, lang, src.ext, { indent, useTabs, printWidth });
        if (lang === "css") result = minifyCss(src.text);
        else if (lang === "html") {
          result = minifyHtml(src.text, { comments: optBool(options, "keepComments", false) });
        } else {
          result = compactJs(src.text);
          note = JS_COMPACT_NOTE;
        }
      }

      const before = new TextEncoder().encode(src.text).length;
      const after = new TextEncoder().encode(result).length;
      const name = `${safeStem(src.name, "code")}${mode === "minify" ? ".min" : ""}.${EXT[lang]}`;
      const delta =
        mode === "minify" && before > 0
          ? ` (${bytesLabel(before)} → ${bytesLabel(after)}, ${Math.max(0, Math.round((1 - after / before) * 100))}% smaller)`
          : "";
      return {
        ok: true,
        output: { language: LABEL[lang], mode, bytesBefore: before, bytesAfter: after, result },
        summary: `${mode === "format" ? "Formatted" : "Minified"} ${LABEL[lang]}${delta}.${note}`,
        files: [textFile(name, MIME_FOR[lang], result)],
      };
    });
}

export const htmlFormatterExecutor = formatterExecutor("html", "html-formatter");
export const cssFormatterExecutor = formatterExecutor("css", "css-formatter");
export const javascriptFormatterExecutor = formatterExecutor("js", "javascript-formatter");
