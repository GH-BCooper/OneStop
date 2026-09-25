// The document-shaped AI tools (Features §11.8–§11.13): AI OCR, Document Analyzer, PDF
// Summarizer, Ask Questions About a File, Extract Information, Unstructured → Structured
// (16-ai-assistant.md).
//
// Every one of them reuses work that already exists rather than re-implementing it: OCR delegates
// to phase 06's Tesseract engine, the PDF summarizer reads text with phase 05's extractor, and
// the answering tool sits on `ragContext.ts`. The model is the layer on top, never the only way
// in — each tool still produces a real result with no runtime configured, and says which engine
// produced it.
import { getExecutor, getTool, type Executor } from "@onestop/tool-registry";
import type { ExecContext, FileRef, OutputFile } from "@onestop/types";
import sharp from "sharp";
import {
  baseName,
  documentText,
  optBool,
  optString,
  parseSelection,
  plural,
  readSingleDoc,
  readTextInput,
  textFile,
  type DocInput,
} from "../documents/common.ts";
import { extractPdfText } from "../pdf/toText.ts";
import { openOcrEngine } from "../pdf/ocr.ts";
import {
  AI_REQUIRED_MESSAGE,
  BUILTIN_NOTE,
  aiUnsupported,
  cleanAnswer,
  clip,
  complete,
  jsonOutput,
  methodOf,
  runAi,
} from "./common.ts";
import { parseJsonObject } from "./intent.ts";
import { answerFromText, NO_ANSWER } from "./ragContext.ts";
import { summariseText } from "./textTools.ts";

// ---- AI OCR (§11.8) -------------------------------------------------------------------------------

export const AI_OCR_TOOL_ID = "ai-ocr";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif"]);

/** Reads text off one image with the local Tesseract engine phase 06 already ships. */
async function ocrImage(
  bytes: Uint8Array,
  language: string,
  signal?: AbortSignal,
): Promise<string> {
  // Tesseract wants a plain raster; sharp also normalises orientation and strips oddities.
  const png = await sharp(Buffer.from(bytes)).rotate().png().toBuffer();
  const engine = await openOcrEngine(language);
  try {
    signal?.throwIfAborted();
    const { text } = await engine.recognize(png);
    return text;
  } finally {
    await engine.close();
  }
}

export const aiOcrExecutor: Executor = async (input, options, ctx) =>
  runAi(AI_OCR_TOOL_ID, async () => {
    if (!Array.isArray(input) || input.length === 0)
      throw aiUnsupported("Choose an image or PDF first.");
    const language = optString(options, "language", "eng");
    const tidy = optBool(options, "tidy", true);

    const files: FileRef[] = input;
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    const images = files.filter((f) =>
      IMAGE_EXTS.has(f.name.split(".").pop()?.toLowerCase() ?? ""),
    );
    if (pdfs.length === 0 && images.length === 0) {
      throw aiUnsupported("AI OCR reads images and PDFs. Choose one of those.");
    }

    const parts: { name: string; text: string }[] = [];

    // PDFs go straight through phase 06's OCR PDF tool — the same engine, the same options, no
    // second implementation to keep in step.
    if (pdfs.length > 0) {
      const tool = getTool("ocr-pdf");
      if (!tool) throw aiUnsupported("The OCR engine is not available on this server.");
      const result = await getExecutor(tool)(pdfs, { output: "txt", language }, ctx);
      if (!result.ok) return result;
      for (const file of result.files ?? []) {
        if (file.name.endsWith(".txt")) {
          parts.push({ name: baseName(file.name), text: new TextDecoder().decode(file.bytes) });
        }
      }
    }

    for (const ref of images) {
      if (!ctx) throw aiUnsupported("This tool could not read your file. Please try again.");
      const bytes = await ctx.readFile(ref);
      parts.push({
        name: baseName(ref.name),
        text: await ocrImage(bytes, language, ctx.signal),
      });
    }

    const raw = parts
      .map((p) => p.text)
      .join("\n\n")
      .trim();
    if (raw === "") {
      return {
        ok: true,
        output: { text: "", runtime: null },
        summary: "No text was found in that file.",
        files: [],
      };
    }

    // The "AI" half: a model tidies the recognised text. Without one the raw OCR is the answer,
    // which is exactly phase 06's behaviour — never a failure.
    let text = raw;
    let runtime: string | null = null;
    if (tidy) {
      const answered = await complete(
        [
          {
            role: "system",
            content:
              "You clean up OCR output. Rejoin words broken across lines, restore paragraphs, and fix obvious character mis-reads (rn/m, 0/O, 1/l). Change nothing else: never reword, never summarise, never add anything. Return only the cleaned text.",
          },
          { role: "user", content: clip(raw).text },
        ],
        "auto",
        options,
        { temperature: 0, maxTokens: 3000, ...(ctx?.signal ? { signal: ctx.signal } : {}) },
      );
      if (answered) {
        text = cleanAnswer(answered.text);
        runtime = answered.runtime;
      }
    }

    const outputs: OutputFile[] = parts.map((part) =>
      textFile(`${part.name}-ocr.txt`, parts.length === 1 ? text : part.text),
    );
    return {
      ok: true,
      output: { text, runtime, characters: text.length },
      summary: [
        `Read ${plural(text.length, "character")} from ${plural(parts.length, "file")}.`,
        runtime ? `Tidied with ${runtime}.` : tidy ? BUILTIN_NOTE : null,
      ]
        .filter(Boolean)
        .join(" "),
      files: outputs,
    };
  });

// ---- AI Document Analyzer (§11.9) ------------------------------------------------------------------

export const AI_DOCUMENT_ANALYZER_TOOL_ID = "ai-document-analyzer";

const FOCUS_PROMPTS: Record<string, string> = {
  overview:
    "Say what this document is, who it is for, and what it says. End with the three points that matter most.",
  structure:
    "Describe how the document is organised: its sections, their order, and roughly how long each is.",
  actions:
    "List every action, deadline, date and obligation the document states, and who it falls on.",
  risks:
    "List the things in this document that a careful reader should question, check or worry about.",
};

/** The offline analysis: real structural facts, no guessing. */
export function describeStructure(text: string): Record<string, number | string> {
  const lines = text.split("\n");
  const words = text.split(/\s+/).filter(Boolean);
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim() !== "");
  const headings = lines.filter(
    (l) => l.trim() !== "" && l.trim().length < 80 && /^[A-Z0-9][^.!?]*$/.test(l.trim()),
  );
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  return {
    words: words.length,
    characters: text.length,
    paragraphs: paragraphs.length,
    sentences: sentences.length,
    likelyHeadings: headings.length,
    averageSentenceWords: sentences.length
      ? Math.round((words.length / sentences.length) * 10) / 10
      : 0,
    readingMinutes: Math.max(1, Math.round(words.length / 220)),
  };
}

export const aiDocumentAnalyzerExecutor: Executor = async (input, options, ctx) =>
  runAi(AI_DOCUMENT_ANALYZER_TOOL_ID, async () => {
    const { text, name } = await readTextInput(input, ctx, ctx?.signal);
    if (text.trim() === "") throw aiUnsupported("That document has no readable text.");
    const focus = optString(options, "focus", "overview");
    const method = methodOf(options);
    const stats = describeStructure(text);

    const answered = await complete(
      [
        {
          role: "system",
          content:
            "You analyse one document for a reader who has not read it. Use only what the document says. Never invent a fact, a figure or a date. Be concrete and brief.",
        },
        {
          role: "user",
          content: `${FOCUS_PROMPTS[focus] ?? FOCUS_PROMPTS.overview}\n\n${clip(text).text}`,
        },
      ],
      method,
      options,
      { temperature: 0.2, maxTokens: 1200, ...(ctx?.signal ? { signal: ctx.signal } : {}) },
    );

    if (!answered && method === "ai") throw aiUnsupported(AI_REQUIRED_MESSAGE);

    const analysis = answered
      ? cleanAnswer(answered.text)
      : (
          await summariseText(
            text,
            { ...options, method: "builtin" },
            {
              title: name,
              ...(ctx?.signal ? { signal: ctx.signal } : {}),
            },
          )
        ).summary;

    const report = [
      `Analysis of ${name}`,
      "",
      ...Object.entries(stats).map(([key, value]) => `${key}: ${value}`),
      "",
      analysis,
      ...(answered ? [] : ["", BUILTIN_NOTE]),
    ].join("\n");

    return {
      ok: true,
      output: { stats, analysis, runtime: answered?.runtime ?? null },
      summary: answered
        ? `Analysed ${plural(Number(stats.words), "word")} with ${answered.runtime}.`
        : `Analysed ${plural(Number(stats.words), "word")}. ${BUILTIN_NOTE}`,
      files: [textFile(`${name}-analysis.txt`, report)],
    };
  });

// ---- AI PDF Summarizer (§11.10) ---------------------------------------------------------------------

export const AI_PDF_SUMMARIZER_TOOL_ID = "ai-pdf-summarizer";

export const aiPdfSummarizerExecutor: Executor = async (input, options, ctx) =>
  runAi(AI_PDF_SUMMARIZER_TOOL_ID, async () => {
    const file: DocInput = await readSingleDoc(input, ctx, "PDF");
    if (file.ext !== "pdf")
      throw aiUnsupported("Choose a PDF. For other files use the AI Summarizer.");
    const pages = await extractPdfText(file.bytes, ctx?.signal ? { signal: ctx.signal } : {});
    const spec = optString(options, "pages").trim();
    const wanted =
      spec === "" ? pages.map((_, i) => i + 1) : parseSelection(spec, pages.length, "page");
    const selected = wanted.map((n) => pages[n - 1]).filter(Boolean);
    const text = selected
      .map((p) => p!.text)
      .join("\n\n")
      .trim();
    if (text === "") {
      throw aiUnsupported(
        "No text was found — this PDF looks like a scan. Run OCR PDF or AI OCR first.",
      );
    }

    const name = baseName(file.ref.name);
    const outcome = await summariseText(text, options, {
      title: name,
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
    });
    return {
      ok: true,
      output: {
        summary: outcome.summary,
        pages: selected.length,
        runtime: outcome.runtime,
        note: outcome.note,
      },
      summary: [
        `Summarised ${plural(selected.length, "page")}${outcome.runtime ? ` with ${outcome.runtime}` : ""}.`,
        outcome.note,
      ]
        .filter(Boolean)
        .join(" "),
      files: [textFile(`${name}-summary.txt`, outcome.summary)],
    };
  });

// ---- Ask Questions About a File (§11.11) -------------------------------------------------------------

export const ASK_QUESTIONS_TOOL_ID = "ask-questions-about-a-file";

export const askQuestionsExecutor: Executor = async (input, options, ctx) =>
  runAi(ASK_QUESTIONS_TOOL_ID, async () => {
    const question = optString(options, "question").trim();
    if (question === "") throw aiUnsupported("Type the question you want answered.");
    const file = await readSingleDoc(input, ctx, "file");
    const text = await documentText(file, ctx?.signal);
    if (text.trim() === "") throw aiUnsupported("That file has no readable text to answer from.");

    const method = methodOf(options);
    const result = await answerFromText(text, question, {
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
      ...(method === "builtin" ? { extractiveOnly: true } : {}),
      credentials: {
        provider: optString(options, "aiProvider") || null,
        apiKey: optString(options, "aiKey") || null,
      },
    });
    if (result.extractive && method === "ai") throw aiUnsupported(AI_REQUIRED_MESSAGE);

    const name = baseName(file.ref.name);
    const showSources = optBool(options, "showSources", true);
    const body = [
      `Q: ${question}`,
      "",
      `A: ${result.answer}`,
      ...(showSources && result.excerpts.length > 0
        ? ["", "From the document:", ...result.excerpts.map((e, i) => `[${i + 1}] ${e}`)]
        : []),
      ...(result.extractive ? ["", BUILTIN_NOTE] : []),
    ].join("\n");

    return {
      ok: true,
      output: {
        question,
        answer: result.answer,
        cited: result.cited,
        excerpts: showSources ? result.excerpts : [],
        truncated: result.truncated,
        runtime: result.runtime,
      },
      summary:
        result.answer === NO_ANSWER
          ? "The document does not appear to answer that."
          : `Answered from ${plural(result.excerpts.length, "passage")}${result.runtime ? ` with ${result.runtime.model}` : `. ${BUILTIN_NOTE}`}`,
      files: [textFile(`${name}-answer.txt`, body)],
    };
  });

// ---- Extract Information from Documents (§11.12) -------------------------------------------------------

export const EXTRACT_INFORMATION_TOOL_ID = "extract-information";

const PATTERNS: { field: string; re: RegExp }[] = [
  { field: "emails", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  {
    field: "phones",
    re: /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3,4}[\s-]?\d{3,4}(?:[\s-]?\d{2,4})?/g,
  },
  { field: "urls", re: /https?:\/\/[^\s<>"')]+/g },
  {
    field: "dates",
    re: /\b(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4})\b/gi,
  },
  {
    field: "amounts",
    re: /(?:[$£€₹]\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*(?:\.\d{2})?\s?(?:USD|EUR|GBP|INR)\b)/g,
  },
  { field: "percentages", re: /\b\d{1,3}(?:\.\d+)?\s?%/g },
];

/** The offline extractor: patterns only, so every value it reports is literally in the text. */
export function extractByPattern(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { field, re } of PATTERNS) {
    const found = [...new Set(text.match(re) ?? [])]
      .map((v) => v.trim())
      .filter((v) => v.length > 2)
      .slice(0, 100);
    if (found.length > 0) out[field] = found;
  }
  return out;
}

async function textFromInput(
  input: FileRef[] | string | null,
  options: Record<string, unknown>,
  ctx: ExecContext | undefined,
): Promise<{ text: string; name: string }> {
  if (typeof input === "string") return { text: input, name: "text" };
  const file = await readSingleDoc(input, ctx, "file");
  if (IMAGE_EXTS.has(file.ext)) {
    return {
      text: await ocrImage(file.bytes, optString(options, "language", "eng"), ctx?.signal),
      name: baseName(file.ref.name),
    };
  }
  return { text: await documentText(file, ctx?.signal), name: baseName(file.ref.name) };
}

export const extractInformationExecutor: Executor = async (input, options, ctx) =>
  runAi(EXTRACT_INFORMATION_TOOL_ID, async () => {
    const { text, name } = await textFromInput(input, options, ctx);
    if (text.trim() === "") throw aiUnsupported("That file has no readable text.");
    const fields = optString(options, "fields")
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f !== "")
      .slice(0, 30);
    const method = methodOf(options);

    const answered = await complete(
      [
        {
          role: "system",
          content: [
            "You extract structured data from a document.",
            "Answer with a single JSON object and nothing else.",
            "Use only values that appear verbatim in the text. Use null when a field is not present.",
            "Never guess a number, a name or a date.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            fields.length > 0
              ? `Extract these fields: ${fields.join(", ")}.`
              : "Extract the document's key fields (who, what, when, amounts, reference numbers).",
            "",
            clip(text).text,
          ].join("\n"),
        },
      ],
      method,
      options,
      {
        json: true,
        temperature: 0,
        maxTokens: 1200,
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      },
    );

    if (answered) {
      const parsed = parseJsonObject(answered.text);
      if (parsed) {
        return {
          ok: true,
          output: { fields: parsed, runtime: answered.runtime },
          summary: `Extracted ${plural(Object.keys(parsed).length, "field")} with ${answered.runtime}.`,
          files: [jsonOutput(`${name}-extracted.json`, parsed)],
        };
      }
    }
    if (method === "ai") throw aiUnsupported(AI_REQUIRED_MESSAGE);

    const found = extractByPattern(text);
    return {
      ok: true,
      output: { fields: found, runtime: null, note: BUILTIN_NOTE },
      summary: `Found ${plural(Object.values(found).flat().length, "value")} across ${plural(Object.keys(found).length, "field")}. ${BUILTIN_NOTE}`,
      files: [jsonOutput(`${name}-extracted.json`, found)],
    };
  });

// ---- Unstructured → Structured Data (§11.13) ----------------------------------------------------------

export const UNSTRUCTURED_TO_STRUCTURED_TOOL_ID = "unstructured-to-structured-data";

/** The offline parser: "Key: value" blocks separated by blank lines become rows. */
export function parseKeyValueBlocks(text: string): Record<string, string>[] {
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim() !== "");
  const rows: Record<string, string>[] = [];
  for (const block of blocks) {
    const row: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const match = line.match(/^\s*([\w][\w \-/]{0,40}?)\s*[:=]\s*(.+?)\s*$/);
      if (match) row[match[1]!.trim().toLowerCase().replace(/\s+/g, "_")] = match[2]!.trim();
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

function toCsv(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const escape = (value: unknown) => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => escape(r[c])).join(","))].join(
    "\n",
  );
}

export const unstructuredToStructuredExecutor: Executor = async (input, options, ctx) =>
  runAi(UNSTRUCTURED_TO_STRUCTURED_TOOL_ID, async () => {
    const { text, name } = await readTextInput(input, ctx, ctx?.signal);
    if (text.trim() === "") throw aiUnsupported("Enter or upload the text to structure.");
    const format = optString(options, "format", "json") === "csv" ? "csv" : "json";
    const columns = optString(options, "columns")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c !== "")
      .slice(0, 30);
    const method = methodOf(options);

    let rows: Record<string, unknown>[] = [];
    let runtime: string | null = null;

    const answered = await complete(
      [
        {
          role: "system",
          content: [
            "You turn messy text into a table.",
            'Answer with a single JSON object: {"rows":[{...},{...}]}, and nothing else.',
            "Every row uses the same keys. Use only values present in the text; use null when a value is missing.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            columns.length > 0
              ? `Use exactly these columns: ${columns.join(", ")}.`
              : "Work out sensible columns.",
            "",
            clip(text).text,
          ].join("\n"),
        },
      ],
      method,
      options,
      {
        json: true,
        temperature: 0,
        maxTokens: 2000,
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      },
    );

    if (answered) {
      const parsed = parseJsonObject(answered.text);
      const candidate = Array.isArray(parsed?.rows) ? parsed.rows : null;
      if (candidate) {
        rows = candidate.filter(
          (r): r is Record<string, unknown> =>
            Boolean(r) && typeof r === "object" && !Array.isArray(r),
        );
        runtime = answered.runtime;
      }
    }
    if (rows.length === 0) {
      if (method === "ai") throw aiUnsupported(AI_REQUIRED_MESSAGE);
      rows = parseKeyValueBlocks(text);
      runtime = null;
    }
    if (rows.length === 0) {
      throw aiUnsupported(
        'No table could be found in that text. Try the AI method, or format the text as "Field: value" lines.',
      );
    }

    const file =
      format === "csv"
        ? {
            name: `${name}-structured.csv`,
            mimeType: "text/csv; charset=utf-8",
            bytes: new TextEncoder().encode(`${toCsv(rows)}\n`),
          }
        : jsonOutput(`${name}-structured.json`, rows);

    return {
      ok: true,
      output: {
        rows: rows.slice(0, 200),
        rowCount: rows.length,
        runtime,
        note: runtime ? null : BUILTIN_NOTE,
      },
      summary: `Built ${plural(rows.length, "row")}${runtime ? ` with ${runtime}` : `. ${BUILTIN_NOTE}`}`,
      files: [file],
    };
  });

export { ocrImage };
