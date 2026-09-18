// Word & PowerPoint tools (07-word-ppt-tools.md).
//
// Importing this module registers every executor with the tool registry, following the phase-04
// pattern: the registry never imports these files, they register themselves.
import { registerExecutor } from "@onestop/tool-registry";

import {
  COMPRESS_DOCUMENTS_TOOL_ID,
  COMPRESS_PRESENTATION_TOOL_ID,
  compressDocumentsExecutor,
  compressPresentationExecutor,
} from "./compress.ts";
import {
  DOCUMENT_TO_IMAGES_TOOL_ID,
  DOCUMENT_TO_PDF_TOOL_ID,
  documentToImagesExecutor,
  documentToPdfExecutor,
  POWERPOINT_TO_IMAGES_TOOL_ID,
  POWERPOINT_TO_PDF_TOOL_ID,
  powerPointToImagesExecutor,
  powerPointToPdfExecutor,
  WORD_TO_EXCEL_TOOL_ID,
  WORD_TO_HTML_TOOL_ID,
  WORD_TO_PDF_TOOL_ID,
  WORD_TO_TEXT_TOOL_ID,
  wordToExcelExecutor,
  wordToHtmlExecutor,
  wordToPdfExecutor,
  wordToTextExecutor,
} from "./convert.ts";
import { DOCUMENT_METADATA_TOOL_ID, documentMetadataExecutor } from "./metadata.ts";
import { OCR_TO_WORD_TOOL_ID, ocrToWordExecutor } from "./ocrToWord.ts";
import {
  EXTRACT_SLIDES_TOOL_ID,
  extractSlidesExecutor,
  MERGE_PRESENTATIONS_TOOL_ID,
  mergePresentationsExecutor,
  POWERPOINT_TO_TEXT_TOOL_ID,
  powerPointToTextExecutor,
  REARRANGE_SLIDES_TOOL_ID,
  rearrangeSlidesExecutor,
  REMOVE_SLIDES_TOOL_ID,
  removeSlidesExecutor,
  SPLIT_PRESENTATION_TOOL_ID,
  splitPresentationExecutor,
} from "./powerpoint.ts";
import {
  DOCUMENT_SUMMARIZER_TOOL_ID,
  DOCUMENT_TRANSLATOR_TOOL_ID,
  documentSummarizerExecutor,
  documentTranslatorExecutor,
  GRAMMAR_CHECKER_TOOL_ID,
  grammarCheckerExecutor,
  TEXT_FORMATTER_TOOL_ID,
  textFormatterExecutor,
} from "./textTools.ts";
import {
  MERGE_DOCUMENTS_TOOL_ID,
  mergeDocumentsExecutor,
  SPLIT_DOCUMENTS_TOOL_ID,
  splitDocumentsExecutor,
} from "./wordStructure.ts";

export { checkGrammar, applyFixes } from "./text/grammar.ts";
export { formatText } from "./text/formatter.ts";
export { summarize } from "./text/summarize.ts";
export { translateText } from "./text/translate.ts";
export { mergeDocx, splitDocx } from "./wordStructure.ts";
export { keepSlides, mergeDecks, openDeck, slideTexts } from "./slides.ts";
export { compressOoxml } from "./compress.ts";
export {
  readOoxmlMetadata,
  readOdtMetadata,
  stripOoxmlMetadata,
  stripOdtMetadata,
} from "./metadata.ts";
export { documentText } from "./common.ts";

/** Every tool this phase owns, in the order the build file lists them. */
export const DOCUMENT_EXECUTORS = [
  [WORD_TO_PDF_TOOL_ID, wordToPdfExecutor],
  [WORD_TO_EXCEL_TOOL_ID, wordToExcelExecutor],
  [WORD_TO_TEXT_TOOL_ID, wordToTextExecutor],
  [WORD_TO_HTML_TOOL_ID, wordToHtmlExecutor],
  [DOCUMENT_TO_PDF_TOOL_ID, documentToPdfExecutor],
  [DOCUMENT_TO_IMAGES_TOOL_ID, documentToImagesExecutor],
  [MERGE_DOCUMENTS_TOOL_ID, mergeDocumentsExecutor],
  [SPLIT_DOCUMENTS_TOOL_ID, splitDocumentsExecutor],
  [COMPRESS_DOCUMENTS_TOOL_ID, compressDocumentsExecutor],
  [OCR_TO_WORD_TOOL_ID, ocrToWordExecutor],
  [DOCUMENT_TRANSLATOR_TOOL_ID, documentTranslatorExecutor],
  [GRAMMAR_CHECKER_TOOL_ID, grammarCheckerExecutor],
  [TEXT_FORMATTER_TOOL_ID, textFormatterExecutor],
  [DOCUMENT_SUMMARIZER_TOOL_ID, documentSummarizerExecutor],
  [DOCUMENT_METADATA_TOOL_ID, documentMetadataExecutor],
  [POWERPOINT_TO_PDF_TOOL_ID, powerPointToPdfExecutor],
  [POWERPOINT_TO_IMAGES_TOOL_ID, powerPointToImagesExecutor],
  [POWERPOINT_TO_TEXT_TOOL_ID, powerPointToTextExecutor],
  [MERGE_PRESENTATIONS_TOOL_ID, mergePresentationsExecutor],
  [SPLIT_PRESENTATION_TOOL_ID, splitPresentationExecutor],
  [COMPRESS_PRESENTATION_TOOL_ID, compressPresentationExecutor],
  [EXTRACT_SLIDES_TOOL_ID, extractSlidesExecutor],
  [REARRANGE_SLIDES_TOOL_ID, rearrangeSlidesExecutor],
  [REMOVE_SLIDES_TOOL_ID, removeSlidesExecutor],
] as const;

for (const [id, executor] of DOCUMENT_EXECUTORS) registerExecutor(id, executor);
