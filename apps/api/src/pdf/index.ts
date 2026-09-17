// Core PDF tools (05-pdf-tools-core.md).
//
// Importing this module registers all eleven executors with the tool registry, following the
// phase-04 pattern: the registry never imports these files, they register themselves.
import { registerExecutor } from "@onestop/tool-registry";

import { COMPRESS_PDF_TOOL_ID, compressPdfExecutor } from "./compress.ts";
import { DELETE_PDF_PAGES_TOOL_ID, deletePdfPagesExecutor } from "./deletePages.ts";
import { EXTRACT_PDF_PAGES_TOOL_ID, extractPdfPagesExecutor } from "./extractPages.ts";
import { MERGE_PDF_TOOL_ID, mergePdfExecutor } from "./merge.ts";
import { REORDER_PDF_PAGES_TOOL_ID, reorderPdfPagesExecutor } from "./reorderPages.ts";
import { REPAIR_PDF_TOOL_ID, repairPdfExecutor } from "./repair.ts";
import { RESIZE_PDF_TOOL_ID, resizePdfExecutor } from "./resize.ts";
import { ROTATE_PDF_PAGES_TOOL_ID, rotatePdfPagesExecutor } from "./rotate.ts";
import { SPLIT_PDF_TOOL_ID, splitPdfExecutor } from "./split.ts";
import { PDF_TO_IMAGES_TOOL_ID, pdfToImagesExecutor } from "./toImages.ts";
import { PDF_TO_TEXT_TOOL_ID, pdfToTextExecutor } from "./toText.ts";

export * from "./document.ts";
export * from "./errors.ts";
export * from "./render.ts";
export * from "./zip.ts";

export {
  compressPdfBytes,
  compressPdfExecutor,
  repackPdf,
  COMPRESS_PDF_TOOL_ID,
} from "./compress.ts";
export { deletePdfPagesExecutor, DELETE_PDF_PAGES_TOOL_ID } from "./deletePages.ts";
export {
  copySelectedPages,
  extractPdfPagesExecutor,
  EXTRACT_PDF_PAGES_TOOL_ID,
} from "./extractPages.ts";
export { mergePdfExecutor, MERGE_PDF_TOOL_ID } from "./merge.ts";
export { reorderPdfPagesExecutor, REORDER_PDF_PAGES_TOOL_ID } from "./reorderPages.ts";
export { repairPdfExecutor, salvageBytes, REPAIR_PDF_TOOL_ID } from "./repair.ts";
export { resizePdfExecutor, targetSize, PAGE_SIZES, RESIZE_PDF_TOOL_ID } from "./resize.ts";
export { rotatePdfPagesExecutor, ROTATE_PDF_PAGES_TOOL_ID } from "./rotate.ts";
export { splitGroups, splitPdfExecutor, SPLIT_PDF_TOOL_ID } from "./split.ts";
export { renderPdfPages, pdfToImagesExecutor, PDF_TO_IMAGES_TOOL_ID } from "./toImages.ts";
export { extractPdfText, pdfToTextExecutor, PDF_TO_TEXT_TOOL_ID } from "./toText.ts";

/** Every tool this phase owns, in the order the build file lists them. */
export const PDF_CORE_EXECUTORS = [
  [PDF_TO_IMAGES_TOOL_ID, pdfToImagesExecutor],
  [PDF_TO_TEXT_TOOL_ID, pdfToTextExecutor],
  [MERGE_PDF_TOOL_ID, mergePdfExecutor],
  [SPLIT_PDF_TOOL_ID, splitPdfExecutor],
  [EXTRACT_PDF_PAGES_TOOL_ID, extractPdfPagesExecutor],
  [DELETE_PDF_PAGES_TOOL_ID, deletePdfPagesExecutor],
  [REORDER_PDF_PAGES_TOOL_ID, reorderPdfPagesExecutor],
  [ROTATE_PDF_PAGES_TOOL_ID, rotatePdfPagesExecutor],
  [COMPRESS_PDF_TOOL_ID, compressPdfExecutor],
  [RESIZE_PDF_TOOL_ID, resizePdfExecutor],
  [REPAIR_PDF_TOOL_ID, repairPdfExecutor],
] as const;

for (const [id, executor] of PDF_CORE_EXECUTORS) registerExecutor(id, executor);
