// Core PDF tools (05-pdf-tools-core.md) and advanced PDF tools (06-pdf-tools-advanced.md).
//
// Importing this module registers every PDF executor with the tool registry, following the
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

import { ADD_PAGE_NUMBERS_TOOL_ID, addPageNumbersExecutor } from "./pageNumbers.ts";
import { ADD_WATERMARK_TOOL_ID, addWatermarkExecutor } from "./watermark.ts";
import { COMPARE_PDFS_TOOL_ID, comparePdfsExecutor } from "./compare.ts";
import { FILL_FORM_TOOL_ID, fillFormExecutor } from "./fillForm.ts";
import {
  EDIT_METADATA_TOOL_ID,
  editMetadataExecutor,
  REMOVE_METADATA_TOOL_ID,
  removeMetadataExecutor,
} from "./metadata.ts";
import { OCR_PDF_TOOL_ID, ocrPdfExecutor } from "./ocr.ts";
import { PROTECT_PDF_TOOL_ID, protectPdfExecutor } from "./protect.ts";
import { SIGN_PDF_TOOL_ID, signPdfExecutor } from "./sign.ts";
import { PDF_TO_HTML_TOOL_ID, pdfToHtmlExecutor } from "./toHtml.ts";
import {
  PDF_TO_EXCEL_TOOL_ID,
  PDF_TO_POWERPOINT_TOOL_ID,
  PDF_TO_WORD_TOOL_ID,
  pdfToExcelExecutor,
  pdfToPowerPointExecutor,
  pdfToWordExecutor,
} from "./toOffice.ts";
import { PDF_TO_PDFA_TOOL_ID, pdfToPdfAExecutor } from "./toPdfA.ts";
import { UNPROTECT_PDF_TOOL_ID, unprotectPdfExecutor } from "./unprotect.ts";

export * from "./document.ts";
export * from "./errors.ts";
export * from "./render.ts";
export * from "./zip.ts";
export * from "./layout.ts";
export { embedUnicodeFont } from "./fonts.ts";
export { checkPdfA, convertToPdfA, srgbIccProfile, unembeddedFonts } from "./toPdfA.ts";
export { openOcrEngine, ocrLanguagePath } from "./ocr.ts";
export { diffDocuments, lcsDiff } from "./compare.ts";
export { listFields, parseFieldValues } from "./fillForm.ts";
export { buildXmp, readProperties, stripMetadata, writeProperties } from "./metadata.ts";
export { isPdfEncrypted } from "./unprotect.ts";
export { createSelfSignedIdentity } from "./sign.ts";

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

/** Every tool 06-pdf-tools-advanced.md owns, in the order the build file lists them. */
export const PDF_ADVANCED_EXECUTORS = [
  [PDF_TO_PDFA_TOOL_ID, pdfToPdfAExecutor],
  [PDF_TO_HTML_TOOL_ID, pdfToHtmlExecutor],
  [ADD_WATERMARK_TOOL_ID, addWatermarkExecutor],
  [ADD_PAGE_NUMBERS_TOOL_ID, addPageNumbersExecutor],
  [PROTECT_PDF_TOOL_ID, protectPdfExecutor],
  [UNPROTECT_PDF_TOOL_ID, unprotectPdfExecutor],
  [SIGN_PDF_TOOL_ID, signPdfExecutor],
  [FILL_FORM_TOOL_ID, fillFormExecutor],
  [EDIT_METADATA_TOOL_ID, editMetadataExecutor],
  [REMOVE_METADATA_TOOL_ID, removeMetadataExecutor],
  [COMPARE_PDFS_TOOL_ID, comparePdfsExecutor],
  [OCR_PDF_TOOL_ID, ocrPdfExecutor],
  [PDF_TO_WORD_TOOL_ID, pdfToWordExecutor],
  [PDF_TO_EXCEL_TOOL_ID, pdfToExcelExecutor],
  [PDF_TO_POWERPOINT_TOOL_ID, pdfToPowerPointExecutor],
] as const;

for (const [id, executor] of PDF_ADVANCED_EXECUTORS) registerExecutor(id, executor);
