// Image Compressor (Features 6.5): re-encodes with a quality target, optionally downsizing and
// changing format. A result that comes out larger than the original is never handed back.
import type { Executor } from "@onestop/tool-registry";
import {
  eachImage,
  encode,
  formatBytes,
  open,
  optEnum,
  optNumber,
  outFile,
  outputName,
  sameFormat,
  type ImageFormat,
  type ImageInput,
} from "./common.ts";

export const COMPRESS_TOOL_ID = "image-compressor";

const FORMATS = ["same", "jpg", "webp", "avif", "png"] as const;

export interface CompressOptions {
  quality?: number;
  format?: (typeof FORMATS)[number];
  maxSide?: number;
}

export async function compressImage(
  image: ImageInput,
  { quality = 75, format = "same", maxSide = 0 }: CompressOptions,
): Promise<{ bytes: Uint8Array; format: ImageFormat; kept: boolean }> {
  const target: ImageFormat = format === "same" ? sameFormat(image) : format;
  const shrink = maxSide > 0 && Math.max(image.width, image.height) > maxSide;
  let pipeline = open(image, { animated: true });
  if (shrink) pipeline = pipeline.resize(maxSide, maxSide, { fit: "inside" });
  const bytes = await encode(pipeline, target, {
    quality,
    palette: target === "png",
    effort: "max",
  });
  // Same format, same size, and nothing gained: the original is the better file.
  if (target === image.format && !shrink && bytes.length >= image.bytes.length) {
    return { bytes: image.bytes, format: target, kept: true };
  }
  return { bytes, format: target, kept: false };
}

export const compressExecutor: Executor = eachImage(
  COMPRESS_TOOL_ID,
  async (image, options) => {
    const { bytes, format, kept } = await compressImage(image, {
      quality: optNumber(options, "quality", 75, { min: 1, max: 100 }),
      format: optEnum(options, "format", FORMATS, "same"),
      maxSide: optNumber(options, "maxSide", 0, { min: 0, max: 20000 }),
    });
    const before = image.bytes.length;
    const saved = before > 0 ? Math.round((1 - bytes.length / before) * 100) : 0;
    return {
      file: outFile(outputName(image, "compressed", format), format, bytes),
      note: kept
        ? `"${image.ref.name}" is already well optimised, so it was kept as it was.`
        : `${formatBytes(before)} → ${formatBytes(bytes.length)} (${saved >= 0 ? `${saved}% smaller` : `${-saved}% larger`}).`,
    };
  },
  { verb: "Compressed", zipStem: "compressed-images" },
);
