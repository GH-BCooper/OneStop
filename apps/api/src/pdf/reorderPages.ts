// Reorder PDF Pages (Features 1.12) — put the pages in a new order.
//
// The order is explicit ("3,1,2"); any page the user leaves out keeps its relative position at
// the end, so a partial order never silently loses pages.
import type { Executor } from "@onestop/tool-registry";
import {
  loadPdf,
  optEnum,
  optString,
  outputName,
  parsePageOrder,
  PDF_MIME,
  readSinglePdf,
  savePdf,
} from "./document.ts";
import { runPdfTool, unsupported } from "./errors.ts";
import { copySelectedPages } from "./extractPages.ts";

export const REORDER_PDF_PAGES_TOOL_ID = "reorder-pdf-pages";

const PRESETS = ["custom", "reverse"] as const;

export const reorderPdfPagesExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(REORDER_PDF_PAGES_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const doc = await loadPdf(file.bytes);
    const pageCount = doc.getPageCount();

    const preset = optEnum(options, "preset", PRESETS, "custom");
    const spec = preset === "reverse" ? "reverse" : optString(options, "order").trim();
    if (preset === "custom" && spec === "") {
      throw unsupported("Enter the new page order, for example 3,1,2.");
    }
    const order = parsePageOrder(spec, pageCount);

    if (pageCount === 1) {
      // Nothing to reorder, but re-saving keeps the tool's contract (a valid PDF out).
      const bytes = await savePdf(doc);
      return {
        ok: true,
        output: { order, pageCount },
        summary: "This PDF has a single page, so the order is unchanged.",
        files: [{ name: outputName(file.ref.name, "reordered"), mimeType: PDF_MIME, bytes }],
      };
    }

    const out = await copySelectedPages(doc, order);
    const bytes = await savePdf(out);
    return {
      ok: true,
      output: { order, pageCount: out.getPageCount() },
      summary: `Reordered ${out.getPageCount()} pages (${order.slice(0, 8).join(", ")}${order.length > 8 ? "…" : ""}).`,
      files: [{ name: outputName(file.ref.name, "reordered"), mimeType: PDF_MIME, bytes }],
    };
  });
