// Rotate PDF Pages (Features 1.13).
//
// Rotation is a page attribute, not a content transform: adding to the existing /Rotate value is
// both lossless and instant, and it keeps any rotation the document already had.
import { degrees } from "@cantoo/pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import {
  loadPdf,
  optNumber,
  optString,
  outputName,
  parsePageSelection,
  PDF_MIME,
  readSinglePdf,
  savePdf,
} from "./document.ts";
import { runPdfTool, unsupported } from "./errors.ts";

export const ROTATE_PDF_PAGES_TOOL_ID = "rotate-pdf-pages";

const ALLOWED_ANGLES = [90, 180, 270] as const;

export const rotatePdfPagesExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(ROTATE_PDF_PAGES_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const angle = optNumber(options, "angle", 90);
    if (!(ALLOWED_ANGLES as readonly number[]).includes(angle)) {
      throw unsupported("Choose a rotation of 90, 180 or 270 degrees.");
    }

    const doc = await loadPdf(file.bytes);
    const selected = parsePageSelection(optString(options, "pages"), doc.getPageCount());

    for (const pageNumber of selected) {
      const page = doc.getPage(pageNumber - 1);
      const current = page.getRotation().angle;
      page.setRotation(degrees((((current + angle) % 360) + 360) % 360));
    }

    const bytes = await savePdf(doc);
    return {
      ok: true,
      output: { angle, pages: selected, pageCount: doc.getPageCount() },
      summary: `Rotated ${selected.length} page${selected.length === 1 ? "" : "s"} by ${angle}°.`,
      files: [{ name: outputName(file.ref.name, "rotated"), mimeType: PDF_MIME, bytes }],
    };
  });
