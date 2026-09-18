// Compress Documents (Features 2.9) and Compress Presentation (5.7) — 07-word-ppt-tools.md.
//
// Almost all of a .docx/.pptx's size is its pictures. Each picture is decoded with @napi-rs/canvas,
// downscaled to a sensible maximum (the size it is *shown* at is stored separately, so the layout
// does not change) and re-encoded — as JPEG unless it has transparency. A picture is only replaced
// when the new one is genuinely smaller, unused parts are dropped, and the package is re-zipped at
// maximum compression. The result is returned only if it beats the original.
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { packageOutputs } from "../pdf/inputs.ts";
import {
  baseName,
  ensureOoxml,
  MIME,
  optEnum,
  plural,
  readDocInputs,
  runDocTool,
} from "./common.ts";
import {
  openPackage,
  readContentTypes,
  removeUnreachableParts,
  renameParts,
  savePackage,
  uniquePartName,
  writeContentTypes,
} from "./ooxml.ts";

export const COMPRESS_DOCUMENTS_TOOL_ID = "compress-documents";
export const COMPRESS_PRESENTATION_TOOL_ID = "compress-presentation";

export type CompressLevel = "light" | "balanced" | "strong";

const LEVELS: Record<CompressLevel, { maxSide: number; quality: number } | null> = {
  light: null,
  balanced: { maxSide: 1920, quality: 80 },
  strong: { maxSide: 1280, quality: 62 },
};

const MEDIA = /(^|\/)media\/[^/]+\.(png|jpe?g|bmp|tiff?)$/i;

export interface CompressResult {
  bytes: Uint8Array;
  images: number;
  before: number;
  after: number;
}

export async function compressOoxml(
  bytes: Uint8Array,
  level: CompressLevel,
  label: string,
  signal?: AbortSignal,
): Promise<CompressResult> {
  const zip = await openPackage(bytes, label);
  const settings = LEVELS[level];
  let images = 0;
  const renames = new Map<string, string>();
  if (settings) {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const taken = new Set<string>();
    for (const name of Object.keys(zip.files).filter((n) => MEDIA.test(n))) {
      if (signal?.aborted) throw new Error("aborted");
      const data = await zip.file(name)!.async("uint8array");
      let image: Awaited<ReturnType<typeof loadImage>>;
      try {
        image = await loadImage(Buffer.from(data));
      } catch {
        continue; // unreadable or exotic picture: leave it exactly as it is
      }
      const scale = Math.min(1, settings.maxSide / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      let alpha = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i]! < 255) {
          alpha = true;
          break;
        }
      }
      const isJpeg = /\.jpe?g$/i.test(name);
      let encoded: Uint8Array;
      if (alpha) {
        if (scale === 1) continue; // PNG with transparency at full size: nothing lossless to gain
        encoded = await canvas.encode("png");
      } else {
        if (!isJpeg) {
          // Paint on white so any fully-opaque PNG converts cleanly.
          const flat = createCanvas(width, height);
          const flatCtx = flat.getContext("2d");
          flatCtx.fillStyle = "#ffffff";
          flatCtx.fillRect(0, 0, width, height);
          flatCtx.drawImage(canvas, 0, 0);
          encoded = await flat.encode("jpeg", settings.quality);
        } else encoded = await canvas.encode("jpeg", settings.quality);
      }
      if (encoded.length >= data.length * 0.95) continue;
      zip.file(name, encoded);
      images += 1;
      if (!alpha && !isJpeg) {
        const target = uniquePartName(zip, name.replace(/\.[^./]+$/, ".jpeg"), taken);
        taken.add(target);
        renames.set(name, target);
      }
    }
  }
  if (renames.size > 0) {
    await renameParts(zip, renames);
    const ct = await readContentTypes(zip);
    if (!ct.defaults.has("jpeg")) ct.defaults.set("jpeg", "image/jpeg");
    writeContentTypes(zip, ct);
  }
  await removeUnreachableParts(zip);
  const out = await savePackage(zip, 9);
  return {
    bytes: out.length < bytes.length ? out : bytes,
    images,
    before: bytes.length,
    after: Math.min(out.length, bytes.length),
  };
}

function kb(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function compressor(toolId: string, to: "docx" | "pptx", noun: string): Executor {
  return async (input, options, ctx) =>
    runDocTool(toolId, async () => {
      const files = await readDocInputs(input, ctx, { what: noun });
      const level = optEnum(options, "level", ["light", "balanced", "strong"] as const, "balanced");
      const outputs: OutputFile[] = [];
      let before = 0;
      let after = 0;
      let images = 0;
      for (const file of files) {
        const { bytes } = await ensureOoxml(file, to, ctx?.signal);
        const result = await compressOoxml(
          bytes,
          level,
          to === "docx" ? "Word" : "PowerPoint",
          ctx?.signal,
        );
        before += file.bytes.length;
        after += result.after;
        images += result.images;
        outputs.push({
          name: `${baseName(file.ref.name)}-compressed.${to}`,
          mimeType: MIME[to],
          bytes: result.bytes,
        });
      }
      const saved = before > 0 ? Math.round((1 - after / before) * 100) : 0;
      const packaging = optEnum(options, "packaging", ["zip", "files"] as const, "zip");
      return {
        ok: true,
        output: { before, after, savedPercent: saved, imagesOptimized: images, level },
        summary:
          saved > 0
            ? `Reduced ${plural(files.length, noun)} from ${kb(before)} to ${kb(after)} (${saved}% smaller, ${plural(images, "picture")} optimized).`
            : `This ${noun} is already well optimized — it could not be made smaller${level !== "strong" ? '. Try the "Strong" level' : ""}.`,
        files: packageOutputs(outputs, `${baseName(files[0]!.ref.name)}-compressed.zip`, packaging),
      };
    });
}

export const compressDocumentsExecutor = compressor(COMPRESS_DOCUMENTS_TOOL_ID, "docx", "document");
export const compressPresentationExecutor = compressor(
  COMPRESS_PRESENTATION_TOOL_ID,
  "pptx",
  "presentation",
);
