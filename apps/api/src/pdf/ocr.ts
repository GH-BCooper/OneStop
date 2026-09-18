// OCR PDF (Features 1.26) — make a scanned PDF searchable, fully locally.
//
// Engine: tesseract.js (Tesseract compiled to WebAssembly, Apache-2.0) with the English LSTM
// model from `@tesseract.js-data/eng`, read from node_modules — no download, no cloud API, no
// system binary. Each page is rendered with pdf.js, recognised, and the words are laid back over
// the *original* page as invisible text, so the scan keeps its exact look but can be searched,
// selected and copied. Pages that already have a text layer are left alone by default.
import { PDFDocument } from "@cantoo/pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  baseName,
  loadPdf,
  optBool,
  optEnum,
  optNumber,
  optString,
  outputName,
  parsePageSelection,
  PDF_MIME,
  readSinglePdf,
  savePdf,
  throwIfAborted,
} from "./document.ts";
import { PdfToolError, runPdfTool } from "./errors.ts";
import { embedUnicodeFont } from "./fonts.ts";
import { plural } from "./inputs.ts";
import { pageText, renderPage, withPdfJs } from "./render.ts";
import { drawInvisibleWords, type PlacedWord } from "./textLayer.ts";
import { findPackageDir } from "../shared/node-modules.ts";
import path from "node:path";

export const OCR_PDF_TOOL_ID = "ocr-pdf";

const OUTPUTS = ["both", "pdf", "txt"] as const;

export interface OcrWord {
  text: string;
  confidence: number;
  /** Pixel box in the rendered image, origin top-left. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrPageResult {
  text: string;
  confidence: number;
  words: OcrWord[];
}

interface TesseractWorker {
  recognize(
    image: Buffer,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ): Promise<{ data: TesseractData }>;
  terminate(): Promise<unknown>;
}
interface TesseractData {
  text: string;
  confidence: number;
  blocks?:
    | {
        paragraphs: {
          lines: {
            words: {
              text: string;
              confidence: number;
              bbox: { x0: number; y0: number; x1: number; y1: number };
            }[];
          }[];
        }[];
      }[]
    | null;
}

/** Directory holding `<lang>.traineddata.gz`. OCR_LANG_PATH overrides the bundled English model. */
export function ocrLanguagePath(): string | null {
  if (process.env.OCR_LANG_PATH) return process.env.OCR_LANG_PATH;
  const dir = findPackageDir("@tesseract.js-data/eng", "4.0.0_best_int");
  return dir ? path.join(dir, "4.0.0_best_int") : null;
}

/** Opens an OCR engine for one job. Always `close()` it — the worker is a real thread. */
export async function openOcrEngine(language = "eng"): Promise<{
  recognize(png: Uint8Array): Promise<OcrPageResult>;
  close(): Promise<void>;
}> {
  const langPath = ocrLanguagePath();
  if (!langPath) {
    throw new PdfToolError(
      "FAILED",
      "OCR is not set up on this server (the English language data is missing). Run npm install and try again.",
    );
  }
  const { createWorker } = (await import("tesseract.js")) as unknown as {
    createWorker(
      lang: string,
      oem: number,
      options: Record<string, unknown>,
    ): Promise<TesseractWorker>;
  };
  let worker: TesseractWorker;
  try {
    worker = await createWorker(language, 1, {
      langPath,
      gzip: true,
      cacheMethod: "none",
      errorHandler: (err: unknown) => console.error("[pdf:ocr] worker error", err),
    });
  } catch (err) {
    throw new PdfToolError("FAILED", "The OCR engine could not start. Please try again.", err);
  }
  return {
    async recognize(png) {
      const { data } = await worker.recognize(Buffer.from(png), {}, { text: true, blocks: true });
      const words: OcrWord[] = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            for (const word of line.words) {
              if (word.text.trim() === "") continue;
              words.push({ text: word.text, confidence: word.confidence, ...word.bbox });
            }
          }
        }
      }
      return { text: data.text.trim(), confidence: data.confidence, words };
    },
    async close() {
      await worker.terminate().catch(() => undefined);
    },
  };
}

export const ocrPdfExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(OCR_PDF_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const output = optEnum(options, "output", OUTPUTS, "both");
    const dpi = optNumber(options, "dpi", 300, { min: 100, max: 400 });
    const skipText = optBool(options, "skipText", true);
    const language = optEnum(options, "language", ["eng"] as const, "eng");

    const source = await loadPdf(file.bytes);
    const selected = parsePageSelection(optString(options, "pages"), source.getPageCount());
    const out = await PDFDocument.create();
    const font = await embedUnicodeFont(out);
    const copied = await out.copyPages(source, source.getPageIndices());

    const engine = await openOcrEngine(language);
    const texts: { page: number; text: string }[] = [];
    let recognised = 0;
    let skipped = 0;
    let confidenceSum = 0;
    try {
      await withPdfJs(file.bytes, async (pdf) => {
        for (let n = 1; n <= source.getPageCount(); n += 1) {
          throwIfAborted(ctx?.signal);
          const original = copied[n - 1]!;
          if (!selected.includes(n)) {
            out.addPage(original);
            continue;
          }
          const existing = await pageText(pdf, n);
          if (skipText && existing.replace(/\s/g, "").length >= 20) {
            out.addPage(original);
            texts.push({ page: n, text: existing });
            skipped += 1;
            continue;
          }
          const rendered = await renderPage(pdf, n, { dpi, format: "png", maxPixels: 6000 });
          const result = await engine.recognize(rendered.bytes);
          recognised += 1;
          confidenceSum += result.confidence;
          texts.push({ page: n, text: result.text });

          const scale = rendered.width / rendered.pointWidth;
          const rotation = source.getPage(n - 1).getRotation().angle % 360;
          let page = original;
          let toPoint: (w: OcrWord) => PlacedWord;
          if (rotation === 0) {
            out.addPage(page);
            const box = page.getCropBox();
            toPoint = (w) => ({
              text: w.text,
              x: box.x + w.x0 / scale,
              y: box.y + box.height - w.y1 / scale,
              width: (w.x1 - w.x0) / scale,
              height: (w.y1 - w.y0) / scale,
            });
          } else {
            // A turned page: rebuild it upright from the render so the words line up exactly.
            page = out.addPage([rendered.pointWidth, rendered.pointHeight]);
            const image = await out.embedPng(rendered.bytes);
            page.drawImage(image, {
              x: 0,
              y: 0,
              width: rendered.pointWidth,
              height: rendered.pointHeight,
            });
            toPoint = (w) => ({
              text: w.text,
              x: w.x0 / scale,
              y: rendered.pointHeight - w.y1 / scale,
              width: (w.x1 - w.x0) / scale,
              height: (w.y1 - w.y0) / scale,
            });
          }
          drawInvisibleWords(page, font, result.words.map(toPoint));
        }
      });
    } finally {
      await engine.close();
    }

    const fullText = texts.map((t) => `--- Page ${t.page} ---\n${t.text}`).join("\n\n");
    const words = texts.reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
    const files: OutputFile[] = [];
    if (output !== "txt") {
      files.push({
        name: outputName(file.ref.name, "ocr"),
        mimeType: PDF_MIME,
        bytes: await savePdf(out),
      });
    }
    if (output !== "pdf") {
      files.push({
        name: `${baseName(file.ref.name)}-ocr.txt`,
        mimeType: "text/plain",
        bytes: new TextEncoder().encode(`${fullText}\n`),
      });
    }
    const confidence = recognised ? Math.round(confidenceSum / recognised) : null;
    return {
      ok: true,
      output: {
        recognised,
        skipped,
        words,
        confidence,
        language,
        preview: fullText.slice(0, 2000),
      },
      summary:
        recognised === 0
          ? `Every selected page already had text, so nothing needed OCR (${plural(skipped, "page")} kept).`
          : `Recognised ${plural(words, "word")} on ${plural(recognised, "page")}` +
            (confidence !== null ? ` (average confidence ${confidence}%).` : "."),
      files,
    };
  });
