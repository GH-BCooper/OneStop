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

export const GRAMMAR_CHECKER_TOOL_ID = "grammar-checker";
export const TEXT_FORMATTER_TOOL_ID = "text-formatter";
export const DOCUMENT_SUMMARIZER_TOOL_ID = "document-summarizer";
export const DOCUMENT_TRANSLATOR_TOOL_ID = "document-translator";

const MAX_TEXT = 2_000_000;

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
export async function translateDocx(
  bytes: Uint8Array,
  translate: (text: string) => string,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const parts = Object.keys(zip.files).filter((n) =>
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n),
  );
  for (const part of parts) {
    const xml = await zip.file(part)!.async("string");
    zip.file(
      part,
      xml.replace(
        /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g,
        (_, open: string, t: string, close: string) =>
          `${open.includes("xml:space") ? open : open.replace("<w:t", '<w:t xml:space="preserve"')}${escapeXml(translate(decodeXml(t)))}${close}`,
      ),
    );
  }
  return savePackage(zip);
}

export const documentTranslatorExecutor: Executor = async (input, options, ctx) =>
  runDocTool(DOCUMENT_TRANSLATOR_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx);
    const from = optEnum(options, "from", GLOSSARY_LANGUAGES, "en");
    const to = optEnum(options, "to", GLOSSARY_LANGUAGES, "es");
    if (from === to) throw unsupported("Choose two different languages.");
    const stats: TranslationStats = { words: 0, translated: 0 };
    const translate = (t: string) => translateText(t, from, to, stats);
    let out: OutputFile;
    const stem = `${baseName(file.ref.name)}-${to}`;
    if (file.ext === "txt") {
      const text = await documentText(file);
      guardSize(text);
      out = textFile(`${stem}.txt`, translate(text));
    } else {
      const { bytes } = await ensureOoxml(file, "docx", ctx?.signal);
      out = {
        name: `${stem}.docx`,
        mimeType: MIME.docx,
        bytes: await translateDocx(bytes, translate),
      };
    }
    if (stats.words === 0) throw unsupported("This document has no text to translate.");
    const coverage = Math.round((stats.translated / stats.words) * 100);
    const note = `Translated with OneStop's built-in offline dictionary: word by word, so expect a rough, literal result; ${stats.words - stats.translated} words it doesn't know were left unchanged.`;
    return {
      ok: true,
      output: {
        from,
        to,
        words: stats.words,
        translated: stats.translated,
        coveragePercent: coverage,
        note: `${note} ${AI_UPGRADE_NOTE}`,
      },
      summary: `${LANGUAGE_NAMES[from]} → ${LANGUAGE_NAMES[to]}: translated ${stats.translated} of ${plural(stats.words, "word")} (${coverage}%). ${note} ${AI_UPGRADE_NOTE}`,
      files: [out],
    };
  });
