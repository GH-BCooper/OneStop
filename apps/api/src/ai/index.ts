// The AI module (16-ai-assistant.md).
//
// Importing this module does three things, in the phase-04 pattern: it registers every AI tool's
// executor with the registry, it registers the local image-model runtime phase 09 asked for when
// one is configured, and it exports the assistant pipeline for the API routes.
import { registerExecutor, type Executor } from "@onestop/tool-registry";

import {
  AI_DOCUMENT_ANALYZER_TOOL_ID,
  AI_OCR_TOOL_ID,
  AI_PDF_SUMMARIZER_TOOL_ID,
  ASK_QUESTIONS_TOOL_ID,
  EXTRACT_INFORMATION_TOOL_ID,
  UNSTRUCTURED_TO_STRUCTURED_TOOL_ID,
  aiDocumentAnalyzerExecutor,
  aiOcrExecutor,
  aiPdfSummarizerExecutor,
  askQuestionsExecutor,
  extractInformationExecutor,
  unstructuredToStructuredExecutor,
} from "./docTools.ts";
import {
  AI_BACKGROUND_OBJECT_REMOVAL_TOOL_ID,
  AI_IMAGE_EDITOR_TOOL_ID,
  AI_IMAGE_GENERATOR_TOOL_ID,
  aiBackgroundObjectRemovalExecutor,
  aiImageEditorExecutor,
  aiImageGeneratorExecutor,
} from "./imageTools.ts";
import { registerImageRuntime } from "./imageRuntime.ts";
import { registerTextRuntime } from "./textRuntime.ts";
import {
  AI_EMAIL_DRAFTER_TOOL_ID,
  AI_GRAMMAR_CHECKER_TOOL_ID,
  AI_SUMMARIZER_TOOL_ID,
  AI_TEXT_GENERATOR_TOOL_ID,
  AI_TEXT_REWRITER_TOOL_ID,
  AI_TRANSLATOR_TOOL_ID,
  aiEmailDrafterExecutor,
  aiGrammarCheckerExecutor,
  aiSummarizerExecutor,
  aiTextGeneratorExecutor,
  aiTextRewriterExecutor,
  aiTranslatorExecutor,
} from "./textTools.ts";

export * from "./providers.ts";
export * from "./modelRuntime.ts";
export * from "./intent.ts";
export * from "./planner.ts";
export * from "./executor.ts";
export * from "./ragContext.ts";
export * from "./recommendations.ts";
export * from "./assistant.ts";
export * from "./common.ts";
export * from "./imageRuntime.ts";
export * from "./textRuntime.ts";
export { describeStructure, extractByPattern, parseKeyValueBlocks, ocrImage } from "./docTools.ts";
export { summariseText } from "./textTools.ts";

export const ASSISTANT_TOOL_ID = "ai-assistant";

/**
 * The catalogue entry for the assistant is a signpost, not a tool: the assistant needs a
 * conversation and a plan the user approves, which a single-shot tool run cannot give it. Running
 * it through the pipeline says so instead of failing with a generic message.
 */
const assistantSignpostExecutor: Executor = async () => ({
  ok: false,
  code: "UNSUPPORTED_INPUT",
  message: "Open the AI Assistant at /assistant — it plans the steps with you before running them.",
});

/** Every tool this phase owns, in the order the Feature list gives them. */
export const AI_EXECUTORS: [string, Executor][] = [
  [ASSISTANT_TOOL_ID, assistantSignpostExecutor],
  [AI_EMAIL_DRAFTER_TOOL_ID, aiEmailDrafterExecutor],
  [AI_TEXT_GENERATOR_TOOL_ID, aiTextGeneratorExecutor],
  [AI_TEXT_REWRITER_TOOL_ID, aiTextRewriterExecutor],
  [AI_SUMMARIZER_TOOL_ID, aiSummarizerExecutor],
  [AI_GRAMMAR_CHECKER_TOOL_ID, aiGrammarCheckerExecutor],
  [AI_TRANSLATOR_TOOL_ID, aiTranslatorExecutor],
  [AI_OCR_TOOL_ID, aiOcrExecutor],
  [AI_DOCUMENT_ANALYZER_TOOL_ID, aiDocumentAnalyzerExecutor],
  [AI_PDF_SUMMARIZER_TOOL_ID, aiPdfSummarizerExecutor],
  [ASK_QUESTIONS_TOOL_ID, askQuestionsExecutor],
  [EXTRACT_INFORMATION_TOOL_ID, extractInformationExecutor],
  [UNSTRUCTURED_TO_STRUCTURED_TOOL_ID, unstructuredToStructuredExecutor],
  [AI_IMAGE_GENERATOR_TOOL_ID, aiImageGeneratorExecutor],
  [AI_IMAGE_EDITOR_TOOL_ID, aiImageEditorExecutor],
  [AI_BACKGROUND_OBJECT_REMOVAL_TOOL_ID, aiBackgroundObjectRemovalExecutor],
];

for (const [id, executor] of AI_EXECUTORS) registerExecutor(id, executor);

// Phase 09's model-capable image tools pick this up through `getImageModelRuntime()`. With no
// `AI_IMAGE_URL` set it registers nothing and every one of them keeps its built-in method.
registerImageRuntime();

// Phase 07's Document Translator picks this up through `getTextModelRuntime()`. With no runtime
// reachable it falls back to the built-in glossary, exactly as it did before phase 16.
registerTextRuntime();
