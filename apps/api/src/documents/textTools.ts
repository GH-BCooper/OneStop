// Grammar Checker (2.12), Text Formatter (2.13), Document Summarizer (2.14) and Document Translator
// (2.11) — 07-word-ppt-tools.md. The engines live in ./text; these are the executors around them.
//
// All four produce a real result offline today, with no AI. The three whose best version needs a
// language model (grammar, summary, translation) say so in their summary via AI_UPGRADE_NOTE;
// phase 16 upgrades the engines behind the same options and outputs.
import JSZip from "jszip";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  AI_UPGRADE_NOTE,
  baseName,
  documentText,
  ensureOoxml,
  MIME,
  optBool,
  optEnum,
  optString,
  plural,
  readSingleDoc,
  readTextInput,
  runDocTool,
  textFile,
  unsupported,
} from "./common.ts";
import { decodeXml, escapeXml, savePackage } from "./ooxml.ts";
import { formatText, type BlankLines, type CaseMode } from "./text/formatter.ts";
import { applyFixes, checkGrammar, type GrammarIssue } from "./text/grammar.ts";
import { GLOSSARY_LANGUAGES, LANGUAGE_NAMES } from "./text/glossary.ts";
import { summarize } from "./text/summarize.ts";
import { translateText, type TranslationStats } from "./text/translate.ts";
import {
  getTextModelRuntime,
  TEXT_LANGUAGES,
  textLanguageLabel,
  type TextModelRuntime,
  type TextTranslateParams,
} from "./text/runtime.ts";

export const GRAMMAR_CHECKER_TOOL_ID = "grammar-checker";
export const TEXT_FORMATTER_TOOL_ID = "text-formatter";
export const DOCUMENT_SUMMARIZER_TOOL_ID = "document-summarizer";
export const DOCUMENT_TRANSLATOR_TOOL_ID = "document-translator";

const MAX_TEXT = 2_000_000;

const AI_RUNTIME_REQUIRED =
  "Set up Ollama for fully offline AI, or add a free API key in Settings, then try again.";

type GlossaryCode = (typeof GLOSSARY_LANGUAGES)[number];

function guardSize(text: string): void {
  if (text.length > MAX_TEXT) {
    throw unsupported("This text is too long to process in one go. Split it into smaller parts.");
  }
}

// ---- Grammar Checker --------------------------------------------------------------------------

function reportLine(issue: GrammarIssue): string {
  const fix = issue.suggestions.length
    ? ` → ${issue.suggestions.map((s) => `"${s}"`).join(" / ")}`
    : "";
  return `Line ${issue.line}, col ${issue.column} [${issue.kind}] "${issue.text}": ${issue.message}${fix}`;
}

export const grammarCheckerExecutor: Executor = async (input, options, ctx) =>
  runDocTool(GRAMMAR_CHECKER_TOOL_ID, async () => {
    const { text, name } = await readTextInput(input, ctx, ctx?.signal);
    guardSize(text);
    const issues = checkGrammar(text, {
      spelling: optBool(options, "spelling", true),
      style: optBool(options, "style", true),
    });
    const output = optEnum(options, "output", ["both", "report", "corrected"] as const, "both");
    const counts = { spelling: 0, grammar: 0, punctuation: 0, style: 0 };
    for (const i of issues) counts[i.kind] += 1;
    const { text: corrected, applied } = applyFixes(text, issues);
    const files: OutputFile[] = [];
    if (output !== "corrected") {
      const report = [
        `Grammar check — ${plural(issues.length, "issue")} found`,
        `Spelling: ${counts.spelling}  Grammar: ${counts.grammar}  Punctuation: ${counts.punctuation}  Style: ${counts.style}`,
        "",
        ...(issues.length ? issues.map(reportLine) : ["No problems found."]),
        "",
        AI_UPGRADE_NOTE,
      ].join("\n");
      files.push(textFile(`${name}-grammar-report.txt`, `${report}\n`));
    }
    if (output !== "report") files.push(textFile(`${name}-corrected.txt`, corrected));
    return {
      ok: true,
      output: {
        issues: issues
          .slice(0, 200)
          .map(({ kind, line, column, text: t, message, suggestions }) => ({
            kind,
            line,
            column,
            text: t,
            message,
            suggestions,
          })),
        counts,
        autoFixed: applied,
        note: AI_UPGRADE_NOTE,
      },
      summary: issues.length
        ? `Found ${plural(issues.length, "issue")} (${counts.spelling} spelling, ${counts.grammar} grammar, ${counts.punctuation} punctuation, ${counts.style} style); ${applied} fixed automatically in the corrected copy. ${AI_UPGRADE_NOTE}`
        : `No problems found. ${AI_UPGRADE_NOTE}`,
      files,
    };
  });

// ---- Text Formatter ---------------------------------------------------------------------------

export const textFormatterExecutor: Executor = async (input, options, ctx) =>
  runDocTool(TEXT_FORMATTER_TOOL_ID, async () => {
    const { text, name } = await readTextInput(input, ctx, ctx?.signal);
    guardSize(text);
    const formatted = formatText(text, {
      case: optEnum(
        options,
        "case",
        [
          "none",
          "sentence",
          "lower",
          "upper",
          "title",
          "capitalize",
        ] as const satisfies readonly CaseMode[],
        "none",
      ),
      blankLines: optEnum(
        options,
        "blankLines",
        ["keep", "single", "remove"] as const satisfies readonly BlankLines[],
        "single",
      ),
      trimLines: optBool(options, "trimLines", true),
      collapseSpaces: optBool(options, "collapseSpaces", true),
      unwrap: optBool(options, "unwrap", false),
      tabsToSpaces: optBool(options, "tabsToSpaces", false),
      straightQuotes: optBool(options, "straightQuotes", false),
      lineEndings: optEnum(options, "lineEndings", ["lf", "crlf"] as const, "lf"),
    });
    return {
      ok: true,
      output: { before: text.length, after: formatted.length, preview: formatted.slice(0, 1000) },
      summary: `Formatted ${plural(text.split(/\r?\n/).length, "line")} of text.`,
      files: [textFile(`${name}-formatted.txt`, formatted)],
    };
  });

// ---- Document Summarizer ----------------------------------------------------------------------

export const documentSummarizerExecutor: Executor = async (input, options, ctx) =>
  runDocTool(DOCUMENT_SUMMARIZER_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx);
    const text = await documentText(file, ctx?.signal);
    guardSize(text);
    const length = optEnum(options, "length", ["short", "medium", "long"] as const, "medium");
    const title = baseName(file.ref.name);
    const summary = summarize(text, { length, title });
    if (summary.totalSentences === 0) throw unsupported("This document has no text to summarize.");
    const body = [
      `Summary of ${file.ref.name}`,
      "",
      ...summary.sentences.map((s) => `• ${s}`),
      "",
      summary.keywords.length ? `Key terms: ${summary.keywords.join(", ")}` : "",
      "",
      `(${summary.sentences.length} of ${summary.totalSentences} sentences, chosen by a local extractive summarizer. ${AI_UPGRADE_NOTE})`,
    ].join("\n");
    return {
      ok: true,
      output: {
        summary: summary.sentences,
        keywords: summary.keywords,
        sentences: summary.totalSentences,
        note: AI_UPGRADE_NOTE,
      },
      summary: `Picked the ${plural(summary.sentences.length, "key sentence")} out of ${summary.totalSentences}. ${AI_UPGRADE_NOTE}`,
      files: [textFile(`${title}-summary.txt`, `${body}\n`)],
    };
  });

// ---- Document Translator ----------------------------------------------------------------------

/** Translates the visible text of a .docx in place (body, headers, footers, notes). */
/**
 * Rewrites every run of text in a DOCX through `translate`. The segments are collected first and
 * translated as one batch, because the model path needs to see whole paragraphs at once (and one
 * HTTP round trip per `<w:t>` would be unusable); the glossary path simply maps over them.
 */
export async function translateDocx(
  bytes: Uint8Array,
  translate: (segments: string[]) => Promise<string[]> | string[],
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const parts = Object.keys(zip.files).filter((n) =>
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n),
  );
  const xmlByPart = new Map<string, string>();
  const segments: string[] = [];
  const RUN = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
  for (const part of parts) {
    const xml = await zip.file(part)!.async("string");
    xmlByPart.set(part, xml);
    for (const match of xml.matchAll(RUN)) segments.push(decodeXml(match[2]!));
  }
  const translated = await translate(segments);
  let next = 0;
  for (const [part, xml] of xmlByPart) {
    zip.file(
      part,
      xml.replace(RUN, (_, open: string, original: string, close: string) => {
        const value = translated[next++] ?? decodeXml(original);
        const tag = open.includes("xml:space")
          ? open
          : open.replace("<w:t", '<w:t xml:space="preserve"');
        return `${tag}${escapeXml(value)}${close}`;
      }),
    );
  }
  return savePackage(zip);
}

// ---- Document Translator ----------------------------------------------------------------------

/**
 * How much text goes to the model in one call. Small enough to stay inside a small local model's
 * context with room for the answer, large enough that a normal page is one or two calls.
 */
const MODEL_BATCH_CHARS = 2000;

const marker = (i: number) => `<<<${i}>>>`;
const MARKER_LINE = /^<<<(\d+)>>>$/;

/** Segments worth sending to a model: anything with a letter in it. */
function isTranslatable(text: string): boolean {
  return /\p{L}/u.test(text);
}

/**
 * What one model call produced.
 *
 * "unreachable" and "mangled" are deliberately different things. No runtime at all means fall back
 * to the glossary; a runtime that answered but did not keep the markers means retry its segments
 * one at a time, which is a request small models handle reliably because it needs no protocol.
 */
type BatchOutcome =
  | { kind: "unreachable" }
  | { kind: "mangled"; runtime: string; local: boolean }
  | { kind: "ok"; values: Map<number, string>; runtime: string; local: boolean };

async function modelBatch(
  runtime: TextModelRuntime,
  indices: number[],
  segments: string[],
  params: TextTranslateParams,
): Promise<BatchOutcome> {
  // One segment needs no protocol at all: the answer *is* the translation.
  if (indices.length === 1) {
    const only = indices[0]!;
    const answered = await runtime.translate(segments[only]!, params);
    if (answered === null) return { kind: "unreachable" };
    const value = answered.text.trim();
    if (value === "") {
      return { kind: "mangled", runtime: answered.runtime, local: answered.local };
    }
    return {
      kind: "ok",
      values: new Map([[only, value]]),
      runtime: answered.runtime,
      local: answered.local,
    };
  }

  const payload = indices.map((i) => `${marker(i)}\n${segments[i]}`).join("\n");
  const answered = await runtime.translate(payload, params);
  if (answered === null) return { kind: "unreachable" };

  const values = new Map<number, string>();
  let current: number | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current !== null) values.set(current, buffer.join("\n").trim());
    buffer = [];
  };
  for (const line of answered.text.split(/\r?\n/)) {
    const found = MARKER_LINE.exec(line.trim());
    if (found) {
      flush();
      current = Number(found[1]);
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  // Every requested segment must have come back with something in it, or the batch is worthless.
  for (const i of indices) {
    const value = values.get(i);
    if (value === undefined || value === "") {
      return { kind: "mangled", runtime: answered.runtime, local: answered.local };
    }
  }
  return { kind: "ok", values, runtime: answered.runtime, local: answered.local };
}

interface ModelResult {
  segments: string[];
  runtime: string;
  local: boolean;
  /** Passages the model would not translate cleanly, which kept their original wording. */
  skipped: number;
}

/**
 * The model path. Returns null only when no runtime answered at all, so the caller falls back to
 * the glossary; a runtime that answers but mangles a batch costs that batch one retry, not the
 * document.
 */
async function translateWithModel(
  segments: string[],
  params: TextTranslateParams,
): Promise<ModelResult | null> {
  const runtime = getTextModelRuntime();
  if (runtime === null || !runtime.available()) return null;
  const out = [...segments];
  const todo = segments.map((_, i) => i).filter((i) => isTranslatable(segments[i]!));
  if (todo.length === 0) return null;

  const batches: number[][] = [];
  let batch: number[] = [];
  let size = 0;
  for (const i of todo) {
    const length = segments[i]!.length + 12;
    if (batch.length > 0 && size + length > MODEL_BATCH_CHARS) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(i);
    size += length;
  }
  if (batch.length > 0) batches.push(batch);

  let name: string | null = null;
  let local = true;
  let skipped = 0;
  for (const indices of batches) {
    params.signal?.throwIfAborted();
    const result = await modelBatch(runtime, indices, segments, params);
    if (result.kind === "unreachable") return null;
    if (result.kind === "mangled") {
      name ??= result.runtime;
      local = result.local;
      if (indices.length === 1) {
        skipped += 1;
        continue;
      }
      // Retry its segments one at a time, where no marker protocol is involved.
      for (const i of indices) {
        const single = await modelBatch(runtime, [i], segments, params);
        if (single.kind === "ok") {
          out[i] = single.values.get(i)!;
          name = single.runtime;
          local = single.local;
        } else if (single.kind === "unreachable") {
          return null;
        } else {
          skipped += 1;
        }
      }
      continue;
    }
    name = result.runtime;
    local = result.local;
    for (const [i, value] of result.values) out[i] = value;
  }
  if (name === null) return null;
  // A model that translated nothing at all is no better than no model.
  if (skipped === todo.length) return null;
  return { segments: out, runtime: name, local, skipped };
}

export const documentTranslatorExecutor: Executor = async (input, options, ctx) =>
  runDocTool(DOCUMENT_TRANSLATOR_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx);
    const from = optString(options, "from", "en");
    const to = optString(options, "to", "es");
    if (!TEXT_LANGUAGES[to] || (from !== "auto" && !TEXT_LANGUAGES[from])) {
      throw unsupported("That is not a language OneStop offers.");
    }
    if (from === to) throw unsupported("Choose two different languages.");
    const method = optEnum(options, "method", ["auto", "ai", "builtin"] as const, "auto");

    const stem = `${baseName(file.ref.name)}-${to}`;
    const isText = file.ext === "txt";
    let sourceText = "";
    let docx: Uint8Array | null = null;
    if (isText) {
      sourceText = await documentText(file);
      guardSize(sourceText);
    } else {
      docx = (await ensureOoxml(file, "docx", ctx?.signal)).bytes;
    }

    // ---- the model path, when one is reachable ---------------------------------------------
    if (method !== "builtin") {
      const params: TextTranslateParams = {
        from,
        to,
        credentials: options,
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      };
      let model: ModelResult | null = null;
      let modelBytes: Uint8Array | null = null;
      if (isText) {
        // Paragraphs, so the blank lines between them survive the round trip.
        const segments = sourceText.split(/(\n\s*\n)/);
        model = await translateWithModel(segments, params);
      } else {
        modelBytes = await translateDocx(docx!, async (all) => {
          model = await translateWithModel(all, params);
          return model === null ? all : model.segments;
        });
      }

      if (model !== null) {
        const done: ModelResult = model;
        const out: OutputFile = isText
          ? textFile(`${stem}.txt`, done.segments.join(""))
          : { name: `${stem}.docx`, mimeType: MIME.docx, bytes: modelBytes! };
        const where = done.local
          ? "It ran on this machine, so the document never left it."
          : "It ran on a hosted free-tier API, so the text was sent to that provider.";
        const partial =
          done.skipped > 0
            ? ` ${plural(done.skipped, "passage")} the model would not translate cleanly kept the original wording.`
            : "";
        return {
          ok: true,
          output: {
            from,
            to,
            engine: "model",
            runtime: done.runtime,
            local: done.local,
            skipped: done.skipped,
          },
          summary: `${from === "auto" ? "Detected language" : textLanguageLabel(from)} → ${textLanguageLabel(to)}: translated with ${done.runtime}. ${where}${partial}`,
          files: [out],
        };
      }
      if (method === "ai") throw unsupported(AI_RUNTIME_REQUIRED);
    }

    // ---- the built-in glossary, unchanged from phase 07 -------------------------------------
    const source = from === "auto" ? "en" : from;
    const offline = GLOSSARY_LANGUAGES as readonly string[];
    if (!offline.includes(source) || !offline.includes(to)) {
      throw unsupported(
        `Without an AI runtime OneStop only translates between ${offline
          .map((c) => LANGUAGE_NAMES[c as GlossaryCode])
          .join(", ")}. ${AI_RUNTIME_REQUIRED}`,
      );
    }
    const stats: TranslationStats = { words: 0, translated: 0 };
    const translate = (t: string) =>
      translateText(t, source as GlossaryCode, to as GlossaryCode, stats);
    const out: OutputFile = isText
      ? textFile(`${stem}.txt`, translate(sourceText))
      : {
          name: `${stem}.docx`,
          mimeType: MIME.docx,
          bytes: await translateDocx(docx!, (all) => all.map(translate)),
        };
    if (stats.words === 0) throw unsupported("This document has no text to translate.");
    const coverage = Math.round((stats.translated / stats.words) * 100);
    const note = `Translated with OneStop's built-in offline dictionary: word by word, so expect a rough, literal result; ${stats.words - stats.translated} words it doesn't know were left unchanged.`;
    return {
      ok: true,
      output: {
        from: source,
        to,
        engine: "glossary",
        words: stats.words,
        translated: stats.translated,
        coveragePercent: coverage,
        note: `${note} ${AI_UPGRADE_NOTE}`,
      },
      summary: `${LANGUAGE_NAMES[source as GlossaryCode]} → ${LANGUAGE_NAMES[to as GlossaryCode]}: translated ${stats.translated} of ${plural(stats.words, "word")} (${coverage}%). ${note} ${AI_UPGRADE_NOTE}`,
      files: [out],
    };
  });
