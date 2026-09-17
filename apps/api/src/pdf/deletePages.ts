// Delete PDF Pages (Features 1.11) — remove unwanted pages, keep the rest in order.
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
import { runPdfTool, unsupported } from "./errors.ts";
import { copySelectedPages } from "./extractPages.ts";

export const DELETE_PDF_PAGES_TOOL_ID = "delete-pdf-pages";

export const deletePdfPagesExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(DELETE_PDF_PAGES_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const doc = await loadPdf(file.bytes);
    const pageCount = doc.getPageCount();

    const spec = optString(options, "pages").trim();
    if (spec === "") throw unsupported("Enter the pages to delete, for example 2 or 4-6.");
    const remove = new Set(parsePageSelection(spec, pageCount));

    const keep = Array.from({ length: pageCount }, (_, i) => i + 1).filter((n) => !remove.has(n));
    if (keep.length === 0) {
      throw unsupported("That would delete every page. Leave at least one page in the PDF.");
    }

    const out = await copySelectedPages(doc, keep);
    const bytes = await savePdf(out);
    return {
      ok: true,
      output: { deleted: [...remove], remaining: keep.length, sourcePageCount: pageCount },
      summary: `Deleted ${remove.size} page${remove.size === 1 ? "" : "s"}; ${keep.length} remain.`,
      files: [{ name: outputName(file.ref.name, "trimmed"), mimeType: PDF_MIME, bytes }],
    };
  });
