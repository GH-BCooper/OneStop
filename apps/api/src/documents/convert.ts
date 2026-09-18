// Word/Document/PowerPoint conversions (07-word-ppt-tools.md): → PDF, → images, → text, → HTML,
// → Excel.
//
// Everything to PDF goes through the shared `officeToPdf` (06-pdf-tools-advanced.md): LibreOffice
// when installed, otherwise OneStop's built-in converter with a notice that layout may differ —
// never an error for .docx/.pptx/.odt/.rtf/.txt. Images are the PDF rendered with pdf.js.
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { renderPdfPages } from "../pdf/toImages.ts";
import { packageOutputs } from "../pdf/inputs.ts";
import { officeToPdf, type OfficeSource } from "../shared/office-convert.ts";
import { cellValue } from "../shared/office/fromPdf.ts";
import {
  baseName,
  docxText,
  ensureOoxml,
  escapeHtml,
  MIME,
  optEnum,
  optNumber,
  plural,
  readDocInputs,
  readSingleDoc,
  runDocTool,
  textFile,
  unsupported,
} from "./common.ts";

export const WORD_TO_PDF_TOOL_ID = "word-to-pdf";
export const DOCUMENT_TO_PDF_TOOL_ID = "document-to-pdf";
export const POWERPOINT_TO_PDF_TOOL_ID = "powerpoint-to-pdf";
export const DOCUMENT_TO_IMAGES_TOOL_ID = "document-to-images";
export const POWERPOINT_TO_IMAGES_TOOL_ID = "powerpoint-to-images";
export const WORD_TO_TEXT_TOOL_ID = "word-to-text";
export const WORD_TO_HTML_TOOL_ID = "word-to-html";
export const WORD_TO_EXCEL_TOOL_ID = "word-to-excel";

const ENGINES = ["auto", "builtin"] as const;
const PACKAGING = ["zip", "files"] as const;

function sourceFor(ext: string): OfficeSource {
  const known: OfficeSource[] = ["docx", "doc", "odt", "rtf", "txt", "pptx", "ppt", "odp"];
  if ((known as string[]).includes(ext)) return ext as OfficeSource;
  throw unsupported("This file type is not supported.");
}

function toPdfExecutor(toolId: string, noun: string): Executor {
  return async (input, options, ctx) =>
    runDocTool(toolId, async () => {
      const files = await readDocInputs(input, ctx, { what: noun });
      const engine = optEnum(options, "engine", ENGINES, "auto");
      const outputs: OutputFile[] = [];
      const notices = new Set<string>();
      const engines = new Set<string>();
      for (const file of files) {
        const result = await officeToPdf(file.bytes, sourceFor(file.ext), {
          engine,
          ...(ctx?.signal ? { signal: ctx.signal } : {}),
        });
        if (result.notice) notices.add(result.notice);
        engines.add(result.engine);
        outputs.push({
          name: `${baseName(file.ref.name)}.pdf`,
          mimeType: MIME.pdf,
          bytes: result.bytes,
        });
      }
      const packaging = optEnum(options, "packaging", PACKAGING, "zip");
      return {
        ok: true,
        output: {
          files: files.length,
          engine: [...engines].join(", "),
          notice: [...notices][0] ?? null,
        },
        summary: `Converted ${plural(files.length, noun)} to PDF.${notices.size ? ` ${[...notices].join(" ")}` : ""}`,
        files: packageOutputs(outputs, `${baseName(files[0]!.ref.name)}-pdf.zip`, packaging),
      };
    });
}

export const wordToPdfExecutor = toPdfExecutor(WORD_TO_PDF_TOOL_ID, "document");
export const documentToPdfExecutor = toPdfExecutor(DOCUMENT_TO_PDF_TOOL_ID, "document");
export const powerPointToPdfExecutor = toPdfExecutor(POWERPOINT_TO_PDF_TOOL_ID, "presentation");

function toImagesExecutor(toolId: string, noun: "page" | "slide"): Executor {
  return async (input, options, ctx) =>
    runDocTool(toolId, async () => {
      const file = await readSingleDoc(input, ctx, noun === "slide" ? "presentation" : "document");
      const format = optEnum(options, "format", ["png", "jpg"] as const, "png");
      const dpi = optNumber(options, "dpi", noun === "slide" ? 96 : 150, { min: 36, max: 300 });
      const quality = optNumber(options, "quality", 85, { min: 10, max: 100 }) / 100;
      const pdf = await officeToPdf(file.bytes, sourceFor(file.ext), {
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      });
      const pages = await renderPdfPages(pdf.bytes, {
        pages: typeof options.pages === "string" ? options.pages : "",
        format,
        dpi,
        quality,
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      });
      const stem = baseName(file.ref.name);
      const width = Math.max(2, String(pages.length).length);
      const images: OutputFile[] = pages.map((p) => ({
        name: `${stem}-${noun}-${String(p.pageNumber).padStart(width, "0")}.${format}`,
        mimeType: format === "png" ? MIME.png : MIME.jpg,
        bytes: p.bytes,
      }));
      const packaging = optEnum(options, "packaging", PACKAGING, "zip");
      return {
        ok: true,
        output: {
          images: images.length,
          format,
          dpi,
          engine: pdf.engine,
          notice: pdf.notice ?? null,
        },
        summary: `Exported ${plural(images.length, noun)} as ${format.toUpperCase()}.${pdf.notice ? ` ${pdf.notice}` : ""}`,
        files: packageOutputs(images, `${stem}-${noun}s.zip`, packaging),
      };
    });
}

export const documentToImagesExecutor = toImagesExecutor(DOCUMENT_TO_IMAGES_TOOL_ID, "page");
export const powerPointToImagesExecutor = toImagesExecutor(POWERPOINT_TO_IMAGES_TOOL_ID, "slide");

// ---- Word → Text ------------------------------------------------------------------------------

export const wordToTextExecutor: Executor = async (input, _options, ctx) =>
  runDocTool(WORD_TO_TEXT_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx);
    const { bytes } = await ensureOoxml(file, "docx", ctx?.signal);
    const text = await docxText(bytes);
    if (text === "") throw unsupported("This document has no text to extract.");
    const words = text.split(/\s+/).filter(Boolean).length;
    return {
      ok: true,
      output: { characters: text.length, words, preview: text.slice(0, 500) },
      summary: `Extracted ${plural(words, "word")} of text.`,
      files: [textFile(`${baseName(file.ref.name)}.txt`, `${text}\n`)],
    };
  });

// ---- Word → HTML ------------------------------------------------------------------------------

const HTML_STYLE = `body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6;color:#1f2328;background:#fff;margin:0}
main{max-width:46rem;margin:0 auto;padding:2rem 1rem}
img{max-width:100%;height:auto}
table{border-collapse:collapse;margin:1rem 0}
td,th{border:1px solid #d0d7de;padding:.35rem .6rem;vertical-align:top}
@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}td,th{border-color:#30363d}a{color:#58a6ff}}`;

export async function docxToHtml(
  bytes: Uint8Array,
  { title, images }: { title: string; images: boolean },
): Promise<{ html: string; warnings: number }> {
  let result: { value: string; messages: unknown[] };
  try {
    result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      images ? {} : { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
    );
  } catch (err) {
    throw unsupported("This Word document could not be read. It may be damaged.", err);
  }
  // Links keep http(s)/mailto/in-page targets only; the CSP below blocks scripts regardless.
  const body = result.value
    .replace(/<img src=""[^>]*\/?>/g, "")
    .replace(/href="(?!https?:|mailto:|#)[^"]*"/gi, 'href="#"');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${HTML_STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
  return { html, warnings: result.messages.length };
}

export const wordToHtmlExecutor: Executor = async (input, options, ctx) =>
  runDocTool(WORD_TO_HTML_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx);
    const { bytes } = await ensureOoxml(file, "docx", ctx?.signal);
    const images = optEnum(options, "images", ["embed", "omit"] as const, "embed") === "embed";
    const { html } = await docxToHtml(bytes, { title: baseName(file.ref.name), images });
    return {
      ok: true,
      output: { bytes: html.length, images },
      summary: `Converted to a self-contained HTML page${images ? " with images embedded" : ""}.`,
      files: [
        {
          name: `${baseName(file.ref.name)}.html`,
          mimeType: MIME.html,
          bytes: new TextEncoder().encode(html),
        },
      ],
    };
  });

// ---- Word → Excel -----------------------------------------------------------------------------

function htmlText(fragment: string): string {
  return fragment
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Tables in a .docx as rows of cell text (nested tables are flattened into their cell). */
export async function docxTables(bytes: Uint8Array): Promise<string[][][]> {
  let html: string;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }));
  } catch (err) {
    throw unsupported("This Word document could not be read. It may be damaged.", err);
  }
  const tables: string[][][] = [];
  // Outermost tables only: walk <table> / </table> with a depth counter.
  const re = /<(\/?)table\b[^>]*>/g;
  let depth = 0;
  let start = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (!m[1]) {
      if (depth === 0) start = re.lastIndex;
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        const inner = html.slice(start, m.index);
        const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
          [...row[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => htmlText(c[1]!)),
        );
        if (rows.some((r) => r.some((c) => c !== ""))) tables.push(rows);
      }
    }
  }
  return tables;
}

export const wordToExcelExecutor: Executor = async (input, options, ctx) =>
  runDocTool(WORD_TO_EXCEL_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx);
    const { bytes } = await ensureOoxml(file, "docx", ctx?.signal);
    const mode = optEnum(options, "content", ["tables", "all"] as const, "tables");
    const tables = await docxTables(bytes);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "OneStop";
    let rows = 0;
    const addSheet = (name: string, data: string[][], header: boolean) => {
      const sheet = workbook.addWorksheet(name.slice(0, 31));
      for (const r of data) sheet.addRow(r.map((c) => cellValue(c)));
      if (header && data.length > 1) sheet.getRow(1).font = { bold: true };
      sheet.columns.forEach((col, i) => {
        const longest = Math.max(8, ...data.map((r) => (r[i] ?? "").split("\n")[0]!.length));
        col.width = Math.min(60, longest + 2);
      });
      rows += data.length;
    };
    tables.forEach((t, i) => addSheet(`Table ${i + 1}`, t, true));
    let note = "";
    if (mode === "all" || tables.length === 0) {
      const text = await docxText(bytes);
      const lines = text.split("\n").filter((l) => l.trim() !== "");
      if (tables.length === 0 && lines.length === 0) {
        throw unsupported("This document has no tables or text to move into Excel.");
      }
      addSheet(
        "Text",
        lines.map((l) => [l]),
        false,
      );
      if (tables.length === 0) note = " No tables were found, so each paragraph became a row.";
    }
    const out = new Uint8Array(await workbook.xlsx.writeBuffer());
    return {
      ok: true,
      output: { tables: tables.length, rows },
      summary: `Moved ${plural(tables.length, "table")} (${plural(rows, "row")}) into Excel.${note}`,
      files: [{ name: `${baseName(file.ref.name)}.xlsx`, mimeType: MIME.xlsx, bytes: out }],
    };
  });
