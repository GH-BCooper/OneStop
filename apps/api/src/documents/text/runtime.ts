// The text-model interface for phase 07's document tools (07-word-ppt-tools.md).
//
// Phase 07 shipped Document Translator on a built-in offline glossary and said the better version
// arrives with a language model. Phase 16 owns the model runtime; phase 19's audit recorded that
// nothing ever connected the two, so `document-translator` stayed word-by-word.
//
// This is that connection, in the same shape phase 09 used for images (`images/model.ts`): this
// module defines the contract and owns nothing else, the AI module registers an implementation at
// import time, and the document tools keep working with no runtime at all.
//
//   method "auto"    – the model when one is reachable, otherwise the glossary (and says so)
//   method "ai"      – the model only; without one, the "needs an AI runtime" message
//   method "builtin" – never touches a model
//
// A runtime is either fully local (Ollama) or a free hosted API the user opted into with their own
// key; `local` says which, so a caller can tell the user where their text went.

/** Every language the model path offers. The built-in glossary covers only the first six. */
export const TEXT_LANGUAGES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ro: "Romanian",
  sv: "Swedish",
  tr: "Turkish",
  ru: "Russian",
  uk: "Ukrainian",
  ar: "Arabic",
  hi: "Hindi",
  te: "Telugu",
  ta: "Tamil",
  zh: "Chinese (Simplified)",
  ja: "Japanese",
  ko: "Korean",
};

export function textLanguageLabel(code: string): string {
  return TEXT_LANGUAGES[code] ?? code;
}

export interface TextModelTranslation {
  text: string;
  /** Shown to the user, e.g. "Ollama (llama3.2)". */
  runtime: string;
  /** True when the model ran on this machine and the text never left it. */
  local: boolean;
}

export interface TextTranslateParams {
  from: string;
  to: string;
  /** Per-run credentials the user supplied in the tool's options (never stored). */
  credentials?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * What phase 16 implements. `translate` returns null when no runtime is reachable and the caller
 * should fall back to the built-in glossary; it throws only when a runtime was reached and failed.
 */
export interface TextModelRuntime {
  readonly name: string;
  translate(text: string, params: TextTranslateParams): Promise<TextModelTranslation | null>;
  /** True when a runtime is configured at all, without making a network call. */
  available(): boolean;
}

let runtime: TextModelRuntime | null = null;

/** Registers (or, with null, removes) the text model runtime. Returns the previous one. */
export function setTextModelRuntime(next: TextModelRuntime | null): TextModelRuntime | null {
  const previous = runtime;
  runtime = next;
  return previous;
}

export function getTextModelRuntime(): TextModelRuntime | null {
  return runtime;
}
