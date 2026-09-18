// Markdown conversion (12-dev-utility-tools.md §12.8-12.9).
//
// `marked` does the parsing (CommonMark + GitHub tables/strikethrough/task lists). Rendering to
// HTML is marked's own; plain text and Word are walked from marked's token tree here, so the
// three outputs always agree about what the document says.
//
// Raw HTML inside the Markdown is passed through only when the user asks for it. By default
// `<script>`, `<style>`, `<iframe>`, `<object>`/`<embed>`, `javascript:` URLs and `on*` handlers
// are removed: a converted page is often opened straight in a browser, and OneStop should not be
// the thing that turns a downloaded note into a running script.
import type { Executor } from "@onestop/tool-registry";
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { Lexer, marked, type Token, type Tokens } from "marked";
import {
  MIME,
  optBool,
  optEnum,
  readTextSource,
  runUtilTool,
  safeStem,
  textFile,
} from "./common.ts";

export type MarkdownTarget = "html" | "txt" | "docx";

export interface MarkdownOptions {
  /** Keep raw HTML found in the Markdown exactly as written. */
  rawHtml?: boolean;
  /** Treat a single newline as a line break (GitHub comment style). */
  breaks?: boolean;
  /** Wrap the HTML fragment in a complete document with a title and minimal styling. */
  fullDocument?: boolean;
  title?: string;
}

// ---- HTML -------------------------------------------------------------------------------------

const DANGEROUS_BLOCK = /<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi;
const DANGEROUS_SELF = /<(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi;
const EVENT_ATTR = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL =
  /\s(href|src|action)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi;

/** Removes the parts of raw HTML that could execute when the result is opened in a browser. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(DANGEROUS_BLOCK, "")
    .replace(DANGEROUS_SELF, "")
    .replace(EVENT_ATTR, "")
    .replace(JS_URL, ' $1="#"');
}

const PAGE_CSS =
  "body{max-width:46rem;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui,sans-serif}" +
  "pre{background:#f4f4f5;padding:1rem;overflow:auto;border-radius:.5rem}" +
  "code{font-family:ui-monospace,monospace}" +
  "table{border-collapse:collapse}td,th{border:1px solid #d4d4d8;padding:.4rem .6rem}" +
  "blockquote{margin:0;padding-left:1rem;border-left:4px solid #d4d4d8;color:#52525b}";

export function markdownToHtml(source: string, options: MarkdownOptions = {}): string {
  const body = marked.parse(source, {
    gfm: true,
    breaks: options.breaks ?? false,
    async: false,
  }) as string;
  const safe = options.rawHtml ? body : sanitizeHtml(body);
  if (!options.fullDocument) return safe.trimEnd() + "\n";
  const title = escapeHtml(options.title ?? "Document");
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${title}</title>\n<style>${PAGE_CSS}</style>\n</head>\n<body>\n` +
    `${safe.trimEnd()}\n</body>\n</html>\n`
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- plain text -------------------------------------------------------------------------------

/** Inline text of a token tree: formatting markers drop away, link text stays. */
function inlineText(tokens: Token[] | undefined): string {
  if (!tokens) return "";
  return tokens
    .map((t) => {
      const any = t as Tokens.Generic & { tokens?: Token[]; text?: string; href?: string };
      switch (t.type) {
        case "text":
        case "codespan":
        case "html":
          return any.tokens ? inlineText(any.tokens) : (any.text ?? "");
        case "escape":
          return any.text ?? "";
        case "br":
          return "\n";
        case "link":
          return any.href && any.href !== inlineText(any.tokens)
            ? `${inlineText(any.tokens)} (${any.href})`
            : inlineText(any.tokens);
        case "image":
          return inlineText(any.tokens) || (any.text ?? "");
        default:
          return any.tokens ? inlineText(any.tokens) : (any.text ?? "");
      }
    })
    .join("");
}

export function markdownToText(source: string): string {
  const lines: string[] = [];
  walkBlocks(Lexer.lex(source), lines, 0);
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

function walkBlocks(tokens: Token[], out: string[], depth: number): void {
  const pad = "  ".repeat(depth);
  for (const token of tokens) {
    const t = token as Tokens.Generic & {
      tokens?: Token[];
      items?: Tokens.ListItem[];
      text?: string;
      depth?: number;
      ordered?: boolean;
      start?: number;
      header?: Tokens.TableCell[];
      rows?: Tokens.TableCell[][];
    };
    switch (token.type) {
      case "heading":
        out.push(`${pad}${inlineText(t.tokens)}`, "");
        break;
      case "paragraph":
        out.push(`${pad}${inlineText(t.tokens)}`, "");
        break;
      case "code":
        for (const line of (t.text ?? "").split("\n")) out.push(`${pad}    ${line}`);
        out.push("");
        break;
      case "blockquote":
        for (const line of blockLines(t.tokens ?? [], depth)) out.push(`${pad}> ${line}`);
        out.push("");
        break;
      case "list": {
        let n = t.start && t.start > 0 ? t.start : 1;
        for (const item of t.items ?? []) {
          const marker = t.ordered ? `${n++}.` : "-";
          const body = blockLines(item.tokens ?? [], 0);
          const check = item.task ? (item.checked ? "[x] " : "[ ] ") : "";
          out.push(`${pad}${marker} ${check}${body[0] ?? ""}`);
          for (const extra of body.slice(1)) out.push(`${pad}   ${extra}`);
          n = t.ordered ? n : n;
        }
        out.push("");
        break;
      }
      case "table": {
        const header = (t.header ?? []).map((c) => inlineText(c.tokens));
        out.push(`${pad}${header.join(" | ")}`);
        out.push(`${pad}${header.map((h) => "-".repeat(Math.max(3, h.length))).join(" | ")}`);
        for (const row of t.rows ?? []) {
          out.push(`${pad}${row.map((c) => inlineText(c.tokens)).join(" | ")}`);
        }
        out.push("");
        break;
      }
      case "hr":
        out.push(`${pad}${"-".repeat(40)}`, "");
        break;
      case "space":
        break;
      case "html":
        break; // raw HTML has no plain-text meaning
      default:
        if (t.tokens) walkBlocks(t.tokens, out, depth);
        else if (t.text) out.push(`${pad}${t.text}`, "");
    }
  }
}

function blockLines(tokens: Token[], depth: number): string[] {
  const buf: string[] = [];
  walkBlocks(tokens, buf, depth);
  while (buf.length > 0 && buf[buf.length - 1] === "") buf.pop();
  return buf;
}

// ---- Word -------------------------------------------------------------------------------------

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
}

function inlineRuns(
  tokens: Token[] | undefined,
  style: RunStyle = {},
): (TextRun | ExternalHyperlink)[] {
  if (!tokens) return [];
  const runs: (TextRun | ExternalHyperlink)[] = [];
  for (const token of tokens) {
    const t = token as Tokens.Generic & { tokens?: Token[]; text?: string; href?: string };
    switch (token.type) {
      case "strong":
        runs.push(...inlineRuns(t.tokens, { ...style, bold: true }));
        break;
      case "em":
        runs.push(...inlineRuns(t.tokens, { ...style, italics: true }));
        break;
      case "del":
        runs.push(...inlineRuns(t.tokens, { ...style, strike: true }));
        break;
      case "codespan":
        runs.push(run(decodeEntities(t.text ?? ""), { ...style, code: true }));
        break;
      case "br":
        runs.push(new TextRun({ break: 1 }));
        break;
      case "link": {
        const children = inlineRuns(t.tokens, style).filter(
          (r): r is TextRun => r instanceof TextRun,
        );
        runs.push(
          new ExternalHyperlink({
            children: children.length > 0 ? children : [run(t.href ?? "", style)],
            link: t.href ?? "",
          }),
        );
        break;
      }
      case "image":
        runs.push(run(t.text ?? "", { ...style, italics: true }));
        break;
      case "escape":
        runs.push(run(t.text ?? "", style));
        break;
      case "html":
        break;
      default:
        if (t.tokens) runs.push(...inlineRuns(t.tokens, style));
        else if (t.text) runs.push(run(decodeEntities(t.text), style));
    }
  }
  return runs;
}

function run(text: string, style: RunStyle): TextRun {
  return new TextRun({
    text,
    ...(style.bold ? { bold: true } : {}),
    ...(style.italics ? { italics: true } : {}),
    ...(style.strike ? { strike: true } : {}),
    ...(style.code ? { font: "Consolas" } : {}),
  });
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function docxBlocks(tokens: Token[], depth = 0): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const token of tokens) {
    const t = token as Tokens.Generic & {
      tokens?: Token[];
      items?: Tokens.ListItem[];
      text?: string;
      depth?: number;
      ordered?: boolean;
      header?: Tokens.TableCell[];
      rows?: Tokens.TableCell[][];
    };
    switch (token.type) {
      case "heading":
        out.push(
          new Paragraph({
            heading: HEADINGS[Math.min((t.depth ?? 1) - 1, 5)]!,
            children: inlineRuns(t.tokens),
          }),
        );
        break;
      case "paragraph":
        out.push(new Paragraph({ children: inlineRuns(t.tokens) }));
        break;
      case "code":
        for (const line of (t.text ?? "").split("\n")) {
          out.push(
            new Paragraph({
              shading: { fill: "F4F4F5" },
              children: [new TextRun({ text: line, font: "Consolas", size: 20 })],
            }),
          );
        }
        break;
      case "blockquote":
        for (const block of docxBlocks(t.tokens ?? [], depth)) {
          if (block instanceof Paragraph) out.push(block);
        }
        break;
      case "list": {
        for (const item of t.items ?? []) {
          const [first, ...rest] = item.tokens ?? [];
          const lead = first ? inlineRuns((first as Tokens.Generic).tokens ?? [first]) : [];
          out.push(
            new Paragraph({
              ...(t.ordered ? { numbering: undefined } : {}),
              bullet: { level: Math.min(depth, 4) },
              children:
                item.task && item.checked !== undefined
                  ? [run(item.checked ? "[x] " : "[ ] ", {}), ...lead]
                  : lead,
            }),
          );
          out.push(...docxBlocks(rest, depth + 1));
        }
        break;
      }
      case "table": {
        const header = new TableRow({
          tableHeader: true,
          children: (t.header ?? []).map(
            (c) =>
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.LEFT,
                    children: inlineRuns(c.tokens, { bold: true }),
                  }),
                ],
              }),
          ),
        });
        const rows = (t.rows ?? []).map(
          (row) =>
            new TableRow({
              children: row.map(
                (c) =>
                  new TableCell({ children: [new Paragraph({ children: inlineRuns(c.tokens) })] }),
              ),
            }),
        );
        out.push(
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] }),
        );
        out.push(new Paragraph({ text: "" }));
        break;
      }
      case "hr":
        out.push(
          new Paragraph({
            border: { bottom: { style: "single", size: 6, color: "D4D4D8" } },
            children: [],
          }),
        );
        break;
      case "space":
      case "html":
        break;
      default:
        if (t.tokens) out.push(...docxBlocks(t.tokens, depth));
        else if (t.text) out.push(new Paragraph({ text: t.text }));
    }
  }
  return out;
}

export async function markdownToDocx(source: string, title: string): Promise<Uint8Array> {
  const children = docxBlocks(Lexer.lex(source));
  const doc = new Document({
    title,
    sections: [{ children: children.length > 0 ? children : [new Paragraph({ text: "" })] }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

// ---- executors --------------------------------------------------------------------------------

const TARGET_MIME: Record<MarkdownTarget, string> = {
  html: MIME.html,
  txt: MIME.txt,
  docx: MIME.docx,
};

function markdownExecutor(toolId: string, fixedTarget?: MarkdownTarget): Executor {
  return (input, options, ctx) =>
    runUtilTool(toolId, async () => {
      const src = await readTextSource(input, ctx, "Markdown", { stem: "document" });
      const target =
        fixedTarget ?? optEnum(options, "target", ["html", "txt", "docx"] as const, "html");
      const stem = safeStem(src.name, "document");
      const rawHtml = optBool(options, "rawHtml", false);
      const breaks = optBool(options, "breaks", false);
      const fullDocument = optBool(options, "fullDocument", true);

      if (target === "docx") {
        const bytes = await markdownToDocx(src.text, stem);
        return {
          ok: true,
          output: { target, characters: src.text.length },
          summary: `Converted Markdown to a Word document (${bytes.length} bytes).`,
          files: [{ name: `${stem}.docx`, mimeType: TARGET_MIME.docx, bytes }],
        };
      }

      const result =
        target === "txt"
          ? markdownToText(src.text)
          : markdownToHtml(src.text, { rawHtml, breaks, fullDocument, title: stem });
      const stripped =
        target === "html" && !rawHtml && /<(script|iframe|object|embed)\b/i.test(src.text);
      return {
        ok: true,
        output: { target, characters: src.text.length, result },
        summary:
          target === "txt"
            ? "Converted Markdown to plain text."
            : `Rendered Markdown as ${fullDocument ? "a complete HTML page" : "an HTML fragment"}.${
                stripped
                  ? " Script and frame tags in the source were removed; turn on “Keep raw HTML” to keep them."
                  : ""
              }`,
        files: [textFile(`${stem}.${target}`, TARGET_MIME[target], result)],
      };
    });
}

export const markdownConverterExecutor = markdownExecutor("markdown-converter");
export const markdownToHtmlExecutor = markdownExecutor("markdown-to-html", "html");
