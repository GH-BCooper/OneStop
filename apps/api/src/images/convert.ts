// Format conversion (Features 6.1, 6.6–6.10): Image Format Converter, the three two-way
// converters, Image → GIF and Image → PDF.
//
// Transparency survives whenever the target can hold it (PNG, WebP, GIF, TIFF, AVIF); JPG and BMP
// are flattened onto the chosen background. Animated GIF/WebP keep their frames between the two.
import type { Executor } from "@onestop/tool-registry";
import { PDFDocument } from "@cantoo/pdf-lib";
import sharp from "sharp";
import { MIME as DOC_MIME } from "../documents/common.ts";
import {
  ALPHA_FORMATS,
  assertOutputSize,
  baseName,
  eachImage,
  encode,
  open,
  optBool,
  optEnum,
  optNumber,
  optString,
  outFile,
  outputName,
  packageFiles,
  parseColor,
  plural,
  readImages,
  runImageTool,
  throwIfAborted,
  unsupported,
  WHITE,
  type ImageFormat,
  type ImageInput,
} from "./common.ts";

export const FORMAT_CONVERTER_TOOL_ID = "image-format-converter";
export const IMAGE_TO_GIF_TOOL_ID = "image-to-gif";
export const IMAGE_TO_PDF_TOOL_ID = "image-to-pdf";

const TARGETS = ["jpg", "png", "webp", "gif", "bmp", "tiff", "avif"] as const;

export interface ConvertOptions {
  quality?: number;
  /** Background for JPG/BMP (transparency is flattened onto it). */
  background?: string;
}

/** Converts one image; the pure core the converters, workflows and the assistant share. */
export async function convertImage(
  image: ImageInput,
  to: ImageFormat,
  { quality = 90, background = "#ffffff" }: ConvertOptions = {},
): Promise<Buffer> {
  const animated = to === "gif" || to === "webp";
  const bg = parseColor(background, WHITE);
  return encode(open(image, { animated }), to, {
    quality,
    background: bg.alpha === 0 ? WHITE : bg,
  });
}

function note(image: ImageInput, to: ImageFormat): string | undefined {
  if (image.hasAlpha && !ALPHA_FORMATS.includes(to)) {
    return `${to.toUpperCase()} can't store transparency, so transparent areas were filled with the background colour.`;
  }
  if (image.animated && to !== "gif" && to !== "webp") {
    return `${to.toUpperCase()} can't store animation, so only the first frame was kept.`;
  }
  return undefined;
}

export const formatConverterExecutor: Executor = eachImage(
  FORMAT_CONVERTER_TOOL_ID,
  async (image, options) => {
    const to = optEnum(options, "format", TARGETS, "png");
    const bytes = await convertImage(image, to, {
      quality: optNumber(options, "quality", 90, { min: 1, max: 100 }),
      background: optString(options, "background", "#ffffff"),
    });
    const extra = note(image, to);
    return {
      file: outFile(outputName(image, "", to), to, bytes),
      ...(extra ? { note: extra } : {}),
    };
  },
  { verb: "Converted", zipStem: "converted-images" },
);

/**
 * JPG ↔ PNG, JPG ↔ WebP, PNG ↔ WebP: each file goes to "the other" format of the pair. A file in
 * neither format is refused rather than guessed at.
 */
function pairConverter(id: string, a: ImageFormat, b: ImageFormat): Executor {
  return eachImage(
    id,
    async (image, options) => {
      const from = image.format;
      if (from !== a && from !== b) {
        throw unsupported(
          `"${image.ref.name}" is not a ${a.toUpperCase()} or ${b.toUpperCase()} file. Use the Image Format Converter for other formats.`,
        );
      }
      const to = from === a ? b : a;
      const bytes = await convertImage(image, to, {
        quality: optNumber(options, "quality", 90, { min: 1, max: 100 }),
        background: optString(options, "background", "#ffffff"),
      });
      const extra = note(image, to);
      return {
        file: outFile(outputName(image, "", to), to, bytes),
        ...(extra ? { note: extra } : {}),
      };
    },
    { verb: "Converted", zipStem: "converted-images" },
  );
}

export const jpgPngExecutor = pairConverter("jpg-png-converter", "jpg", "png");
export const jpgWebpExecutor = pairConverter("jpg-webp-converter", "jpg", "webp");
export const pngWebpExecutor = pairConverter("png-webp-converter", "png", "webp");

// ---- Image → GIF ------------------------------------------------------------------------------

export interface GifOptions {
  /** ms per frame. */
  delay?: number;
  loop?: boolean;
  /** Frame width in px; 0 = the first image's width (capped at 1200). */
  width?: number;
  background?: string;
}

/**
 * One image → a GIF (animation kept if it had one); several → an animated GIF, one frame each,
 * all letterboxed to the first frame's shape.
 */
export async function imagesToGif(
  images: ImageInput[],
  { delay = 800, loop = true, width = 0, background = "#ffffff" }: GifOptions = {},
  signal?: AbortSignal,
): Promise<Buffer> {
  const first = images[0]!;
  if (images.length === 1) {
    return encode(
      open(first, { animated: true }),
      "gif",
      first.animated ? {} : { delay, loop: loop ? 0 : 1 },
    );
  }
  const w = width > 0 ? width : Math.min(1200, first.width);
  const h = Math.max(1, Math.round((first.height * w) / first.width));
  assertOutputSize(w, h * images.length);
  const bg = parseColor(background, WHITE);
  const frames: Buffer[] = [];
  for (const image of images) {
    throwIfAborted(signal);
    frames.push(
      await open(image)
        .resize(w, h, { fit: "contain", background: bg })
        .flatten({ background: bg.alpha === 0 ? WHITE : bg })
        .png()
        .toBuffer(),
    );
  }
  const joined = sharp(frames, { join: { animated: true } });
  return joined.gif({ delay: frames.map(() => delay), loop: loop ? 0 : 1, effort: 7 }).toBuffer();
}

export const imageToGifExecutor: Executor = (input, options, ctx) =>
  runImageTool(IMAGE_TO_GIF_TOOL_ID, async () => {
    const images = await readImages(input, ctx, { max: 200 });
    const ordered =
      optEnum(options, "order", ["selected", "name"] as const, "selected") === "name"
        ? [...images].sort((x, y) =>
            x.ref.name.localeCompare(y.ref.name, undefined, { numeric: true }),
          )
        : images;
    const bytes = await imagesToGif(
      ordered,
      {
        delay: optNumber(options, "delay", 800, { min: 20, max: 10000 }),
        loop: optBool(options, "loop", true),
        width: optNumber(options, "width", 0, { min: 0, max: 2000 }),
        background: optString(options, "background", "#ffffff"),
      },
      ctx?.signal,
    );
    const name = ordered.length === 1 ? outputName(ordered[0]!, "", "gif") : "animation.gif";
    return {
      ok: true,
      output: { frames: ordered.length, size: bytes.length },
      summary:
        ordered.length === 1
          ? `Converted "${ordered[0]!.ref.name}" to GIF.`
          : `Made an animated GIF from ${plural(ordered.length, "image")}.`,
      files: [outFile(name, "gif", bytes)],
    };
  });

// ---- Image → PDF ------------------------------------------------------------------------------

/** Paper sizes in PDF points (1/72 in), portrait. */
const PAPER: Record<string, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
};
const SIZES = ["fit", "a4", "letter", "legal", "a3", "a5"] as const;
const ORIENTATIONS = ["auto", "portrait", "landscape"] as const;

export interface ImagesToPdfOptions {
  size?: (typeof SIZES)[number];
  orientation?: (typeof ORIENTATIONS)[number];
  /** Points. */
  margin?: number;
}

/** Embeds images one per page. JPGs go in untouched; everything else as lossless PNG. */
export async function imagesToPdf(
  images: ImageInput[],
  { size = "fit", orientation = "auto", margin = 0 }: ImagesToPdfOptions = {},
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setProducer("OneStop");
  doc.setCreator("OneStop Image → PDF");
  for (const image of images) {
    throwIfAborted(signal);
    // Upright JPGs are embedded byte for byte; rotated ones and other formats are re-encoded.
    const exifOrientation =
      image.format === "jpg" ? ((await sharp(image.source).metadata()).orientation ?? 1) : 1;
    const embedded =
      image.format === "jpg" && exifOrientation === 1
        ? await doc.embedJpg(image.bytes)
        : image.format === "jpg" || image.format === "heic"
          ? await doc.embedJpg(await encode(open(image), "jpg", { quality: 92 }))
          : await doc.embedPng(await encode(open(image), "png"));
    // Image pixels at 96 DPI → points, so "fit" pages come out at the photo's natural size.
    const imgW = (image.width * 72) / 96;
    const imgH = (image.height * 72) / 96;
    let pageW: number;
    let pageH: number;
    if (size === "fit") {
      pageW = imgW + margin * 2;
      pageH = imgH + margin * 2;
    } else {
      const [pw, ph] = PAPER[size]!;
      const landscape =
        orientation === "landscape" || (orientation === "auto" && image.width > image.height);
      [pageW, pageH] = landscape ? [ph, pw] : [pw, ph];
    }
    const boxW = Math.max(1, pageW - margin * 2);
    const boxH = Math.max(1, pageH - margin * 2);
    const scale = Math.min(boxW / imgW, boxH / imgH, size === "fit" ? 1 : Infinity);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const page = doc.addPage([pageW, pageH]);
    page.drawImage(embedded, {
      x: (pageW - drawW) / 2,
      y: (pageH - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  }
  return doc.save();
}

export const imageToPdfExecutor: Executor = (input, options, ctx) =>
  runImageTool(IMAGE_TO_PDF_TOOL_ID, async () => {
    const images = await readImages(input, ctx, { max: 500 });
    const ordered =
      optEnum(options, "order", ["selected", "name"] as const, "selected") === "name"
        ? [...images].sort((x, y) =>
            x.ref.name.localeCompare(y.ref.name, undefined, { numeric: true }),
          )
        : images;
    const pdfOptions: ImagesToPdfOptions = {
      size: optEnum(options, "size", SIZES, "fit"),
      orientation: optEnum(options, "orientation", ORIENTATIONS, "auto"),
      margin: optNumber(options, "margin", 0, { min: 0, max: 144 }),
    };
    const separate =
      optEnum(options, "output", ["single", "separate"] as const, "single") === "separate";
    const files = [];
    if (separate && ordered.length > 1) {
      for (const image of ordered) {
        files.push({
          name: `${baseName(image.ref.name)}.pdf`,
          mimeType: DOC_MIME.pdf,
          bytes: await imagesToPdf([image], pdfOptions, ctx?.signal),
        });
      }
    } else {
      const name = ordered.length === 1 ? `${baseName(ordered[0]!.ref.name)}.pdf` : "images.pdf";
      files.push({
        name,
        mimeType: DOC_MIME.pdf,
        bytes: await imagesToPdf(ordered, pdfOptions, ctx?.signal),
      });
    }
    return {
      ok: true,
      output: { pages: ordered.length, files: files.length },
      summary:
        separate && ordered.length > 1
          ? `Made ${plural(files.length, "PDF")}, one per image.`
          : `Made a ${plural(ordered.length, "page")} PDF.`,
      files: packageFiles(files, options, "images-pdf"),
    };
  });
