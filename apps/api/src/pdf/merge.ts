// Merge PDF (Features 1.8) — combine several PDFs into one.
//
// pdf-lib's `copyPages` carries each page's own MediaBox across, so mixing A4, Letter and
// landscape pages in one document works without any scaling.
import { PDFDocument } from "@cantoo/pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import { unsupported } from "./errors.ts";
import {
  baseName,
  loadPdf,
  optEnum,
  PDF_MIME,
  readPdfInputs,
  savePdf,
  throwIfAborted,
  type PdfInput,
} from "./document.ts";
import { runPdfTool } from "./errors.ts";

export const MERGE_PDF_TOOL_ID = "merge-pdf";

const ORDERS = ["selected", "name", "name-desc"] as const;

function sortInputs(files: PdfInput[], order: (typeof ORDERS)[number]): PdfInput[] {
  if (order === "selected") return files;
  const sorted = [...files].sort((a, b) =>
    a.ref.name.localeCompare(b.ref.name, undefined, { numeric: true, sensitivity: "base" }),
  );
  return order === "name-desc" ? sorted.reverse() : sorted;
}

export const mergePdfExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(MERGE_PDF_TOOL_ID, async () => {
    const files = await readPdfInputs(input, ctx, { min: 1 });
    if (files.length < 2) {
      throw unsupported("Choose at least two PDF files to merge.");
    }
    const ordered = sortInputs(files, optEnum(options, "order", ORDERS, "selected"));

    const merged = await PDFDocument.create();
    const sources: { name: string; pages: number }[] = [];
    for (const file of ordered) {
      throwIfAborted(ctx?.signal);
      const doc = await loadPdf(file.bytes);
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      for (const page of pages) merged.addPage(page);
      sources.push({ name: file.ref.name, pages: doc.getPageCount() });
    }
    merged.setTitle(baseName(ordered[0]!.ref.name));
    merged.setProducer("OneStop");
    merged.setCreationDate(new Date());

    const bytes = await savePdf(merged);
    const name = `${baseName(ordered[0]!.ref.name)}-merged.pdf`;
    return {
      ok: true,
      output: { pageCount: merged.getPageCount(), sources },
      summary: `Merged ${ordered.length} PDFs into one document of ${merged.getPageCount()} pages.`,
      files: [{ name, mimeType: PDF_MIME, bytes }],
    };
  });
