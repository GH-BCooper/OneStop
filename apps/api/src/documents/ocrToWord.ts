// OCR → Word (Features 2.10) — 07-word-ppt-tools.md.
//
// Reuses phase 06's local OCR engine (tesseract.js, English model from node_modules — no network).
// A PDF is rendered page by page at 300 DPI; a photo is normalised to PNG with @napi-rs/canvas.
// The recognised text becomes an editable .docx: one section per page, paragraphs rebuilt from the
// OCR line breaks, optionally with the original page image above the text for checking.
import { Document, ImageRun, Packer, Paragraph, TextRun, type ISectionOptions } from "docx";
import type { Executor } from "@onestop/tool-registry";
import { looksLikePdf } from "../pdf/document.ts";
import { openOcrEngine } from "../pdf/ocr.ts";
import { renderPdfPages } from "../pdf/toImages.ts";
import {
  baseName,
  MIME,
  optBool,
  optString,
  plural,
  readSingleDoc,
  runDocTool,
  unsupported,
} from "./common.ts";

export const OCR_TO_WORD_TOOL_ID = "ocr-to-word";

interface PageImage {
  png: Uint8Array;
  width: number;
  height: number;
}

async function imageToPng(bytes: Uint8Array): Promise<PageImage> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  let image: Awaited<ReturnType<typeof loadImage>>;
  try {
    image = await loadImage(Buffer.from(bytes));
  } catch (err) {
    throw unsupported("This image could not be read. Try a PNG or JPG file.", err);
  }
  // Tesseract reads small text far better with some resolution to work with.
  const scale = Math.max(1, Math.min(3, 1600 / Math.max(image.width, image.height)));
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return { png: await canvas.encode("png"), width, height };
}

/** OCR line breaks → paragraphs: blank lines separate paragraphs, other breaks are soft wraps. */
export function ocrParagraphs(text: string, keepLines: boolean): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) =>
      keepLines
        ? p.trim()
        : p
            .replace(/-\n(?=\p{Ll})/gu, "")
            .replace(/\s*\n\s*/g, " ")
            .trim(),
    )
    .filter(Boolean);
}

export const ocrToWordExecutor: Executor = async (input, options, ctx) =>
  runDocTool(OCR_TO_WORD_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx, "file");
    const includeImage = optBool(options, "includeImage", false);
    const keepLines = optBool(options, "keepLines", false);
    let pages: PageImage[];
    if (file.ext === "pdf" || looksLikePdf(file.bytes)) {
      const rendered = await renderPdfPages(file.bytes, {
        pages: optString(options, "pages"),
        dpi: 300,
        format: "png",
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      });
      pages = rendered.map((p) => ({ png: p.bytes, width: p.width, height: p.height }));
    } else {
      pages = [await imageToPng(file.bytes)];
    }

    const engine = await openOcrEngine("eng");
    const sections: ISectionOptions[] = [];
    let confidence = 0;
    let words = 0;
    try {
      for (const page of pages) {
        if (ctx?.signal?.aborted) throw new Error("aborted");
        const result = await engine.recognize(page.png);
        confidence += result.confidence;
        words += result.words.length;
        const children: Paragraph[] = [];
        if (includeImage) {
          const width = 600;
          children.push(
            new Paragraph({
              children: [
                new ImageRun({
                  type: "png",
                  data: page.png,
                  transformation: { width, height: Math.round((page.height / page.width) * width) },
                }),
              ],
            }),
          );
        }
        for (const text of ocrParagraphs(result.text, keepLines)) {
          const lines = text.split("\n");
          children.push(
            new Paragraph({
              children: lines.map(
                (line, i) => new TextRun({ text: line, ...(i > 0 ? { break: 1 } : {}) }),
              ),
            }),
          );
        }
        if (children.length === 0) children.push(new Paragraph({ children: [] }));
        sections.push({ children });
      }
    } finally {
      await engine.close();
    }
    if (words === 0) {
      throw unsupported(
        "No text was recognised. Try a sharper, straighter scan with dark text on a light background.",
      );
    }
    const doc = new Document({
      creator: "OneStop",
      title: baseName(file.ref.name),
      sections,
    });
    const bytes = new Uint8Array(await Packer.toBuffer(doc));
    const avg = Math.round(confidence / pages.length);
    return {
      ok: true,
      output: { pages: pages.length, words, confidence: avg },
      summary: `Recognised ${plural(words, "word")} on ${plural(pages.length, "page")} (average confidence ${avg}%). Check names and numbers — OCR can misread them.`,
      files: [{ name: `${baseName(file.ref.name)}.docx`, mimeType: MIME.docx, bytes }],
    };
  });
