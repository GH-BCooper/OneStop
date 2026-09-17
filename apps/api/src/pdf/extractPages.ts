// Extract PDF Pages (Features 1.10) — copy selected pages into a new PDF.
import { PDFDocument } from "pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import {
  loadPdf,
  optString,
  outputName,
  parsePageSelection,
  PDF_MIME,
  readSinglePdf,
  savePdf,
} from "./document.ts";
import { runPdfTool } from "./errors.ts";

export const EXTRACT_PDF_PAGES_TOOL_ID = "extract-pdf-pages";

/** Shared by Extract and Delete: build a new document from a list of 1-based page numbers. */
export async function copySelectedPages(
  source: PDFDocument,
  pages: number[],
): Promise<PDFDocument> {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    source,
    pages.map((n) => n - 1),
  );
  for (const page of copied) out.addPage(page);
  out.setProducer("OneStop");
  out.setCreationDate(new Date());
  return out;
}

export const extractPdfPagesExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(EXTRACT_PDF_PAGES_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const doc = await loadPdf(file.bytes);
    const pages = parsePageSelection(optString(options, "pages"), doc.getPageCount());

    const out = await copySelectedPages(doc, pages);
    const bytes = await savePdf(out);
    return {
      ok: true,
      output: { pages, pageCount: pages.length, sourcePageCount: doc.getPageCount() },
      summary: `Extracted ${pages.length} of ${doc.getPageCount()} pages.`,
      files: [{ name: outputName(file.ref.name, "pages"), mimeType: PDF_MIME, bytes }],
    };
  });
