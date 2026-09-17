// PDF → Text (Features 1.5) — pull the plain text out of a PDF.
//
// This reads the text layer only. A scanned PDF has no text layer, so instead of returning an
// empty file it says so and points at OCR PDF (06-pdf-tools-advanced.md).
import type { Executor } from "@onestop/tool-registry";
import {
  baseName,
  optEnum,
  optString,
  parsePageSelection,
  readSinglePdf,
  throwIfAborted,
} from "./document.ts";
import { runPdfTool, unsupported } from "./errors.ts";
import { pageText, withPdfJs } from "./render.ts";

export const PDF_TO_TEXT_TOOL_ID = "pdf-to-text";

const LAYOUTS = ["plain", "page-markers"] as const;

export interface ExtractedPageText {
  page: number;
  text: string;
}

/** Extracts the text of the selected pages. Shared with phase 06 (PDF → Word / HTML). */
export async function extractPdfText(
  bytes: Uint8Array,
  { pages, signal }: { pages?: string; signal?: AbortSignal } = {},
): Promise<ExtractedPageText[]> {
  return withPdfJs(bytes, async (doc) => {
    const selected = parsePageSelection(pages, doc.numPages);
    const out: ExtractedPageText[] = [];
    for (const page of selected) {
      throwIfAborted(signal);
      out.push({ page, text: await pageText(doc, page) });
    }
    return out;
  });
}

export const pdfToTextExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(PDF_TO_TEXT_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const layout = optEnum(options, "layout", LAYOUTS, "page-markers");

    const pages = await extractPdfText(file.bytes, {
      pages: optString(options, "pages"),
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
    });

    const characters = pages.reduce((sum, p) => sum + p.text.length, 0);
    if (characters === 0) {
      throw unsupported(
        "No text was found — this PDF looks like a scan. Use OCR PDF to read it instead.",
      );
    }

    const body =
      layout === "plain"
        ? pages.map((p) => p.text).join("\n\n")
        : pages.map((p) => `--- Page ${p.page} ---\n${p.text}`).join("\n\n");
    const bytes = new TextEncoder().encode(body.endsWith("\n") ? body : `${body}\n`);

    const words = body.split(/\s+/).filter(Boolean).length;
    return {
      ok: true,
      output: {
        pageCount: pages.length,
        characters,
        words,
        preview: body.slice(0, 2000),
        emptyPages: pages.filter((p) => p.text.trim() === "").map((p) => p.page),
      },
      summary: `Extracted ${words} words from ${pages.length} page${pages.length === 1 ? "" : "s"}.`,
      files: [{ name: `${baseName(file.ref.name)}.txt`, mimeType: "text/plain", bytes }],
    };
  });
