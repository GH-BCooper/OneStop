// Image Cropper (Features 6.4): an aspect ratio anchored to a side or found automatically
// ("smart" = libvips' attention strategy, which keeps the busiest region), an exact pixel box, or
// trims from each edge in percent.
import type { Executor } from "@onestop/tool-registry";
import {
  eachImage,
  encode,
  open,
  optEnum,
  optNumber,
  optString,
  outFile,
  outputName,
  sameFormat,
  unsupported,
  type ImageInput,
} from "./common.ts";

export const CROP_TOOL_ID = "image-cropper";

const MODES = ["aspect", "box", "percent"] as const;
const ANCHORS = ["smart", "center", "top", "bottom", "left", "right"] as const;
type Anchor = (typeof ANCHORS)[number];

export interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** "16:9", "4x5", "1.5" → width / height. */
export function parseRatio(text: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:[:x/×]\s*(\d+(?:\.\d+)?))?\s*$/i.exec(text);
  const a = m ? Number(m[1]) : NaN;
  const b = m?.[2] ? Number(m[2]) : 1;
  if (!(a > 0) || !(b > 0)) {
    throw unsupported(`"${text}" is not an aspect ratio. Use something like 16:9 or 1:1.`);
  }
  return a / b;
}

/** The largest box of the given ratio that fits, placed by `anchor` (smart is resolved by sharp). */
export function aspectBox(
  src: { width: number; height: number },
  ratio: number,
  anchor: Anchor,
): CropBox {
  let width = src.width;
  let height = Math.round(width / ratio);
  if (height > src.height) {
    height = src.height;
    width = Math.round(height * ratio);
  }
  width = Math.max(1, Math.min(src.width, width));
  height = Math.max(1, Math.min(src.height, height));
  let left = Math.round((src.width - width) / 2);
  let top = Math.round((src.height - height) / 2);
  if (anchor === "top") top = 0;
  if (anchor === "bottom") top = src.height - height;
  if (anchor === "left") left = 0;
  if (anchor === "right") left = src.width - width;
  return { left, top, width, height };
}

/** Clamps and checks a user-entered box against the image. */
export function checkBox(src: { width: number; height: number }, box: CropBox): CropBox {
  if (box.left >= src.width || box.top >= src.height) {
    throw unsupported(
      `The crop starts outside the image, which is ${src.width} × ${src.height} px.`,
    );
  }
  const width = Math.min(box.width, src.width - box.left);
  const height = Math.min(box.height, src.height - box.top);
  if (width < 1 || height < 1) {
    throw unsupported("The crop area is empty. Enter a width and height above 0.");
  }
  return { left: box.left, top: box.top, width, height };
}

export async function cropImage(
  image: ImageInput,
  options: Record<string, unknown>,
): Promise<{ bytes: Buffer; box: CropBox }> {
  const mode = optEnum(options, "mode", MODES, "aspect");
  const format = sameFormat(image);
  if (mode === "aspect") {
    const ratio = parseRatio(optString(options, "ratio", "1:1") || "1:1");
    const anchor = optEnum(options, "anchor", ANCHORS, "smart");
    const box = aspectBox(image, ratio, anchor);
    if (anchor === "smart") {
      const pipeline = open(image).resize(box.width, box.height, {
        fit: "cover",
        position: "attention",
      });
      return { bytes: await encode(pipeline, format), box };
    }
    return { bytes: await encode(open(image).extract(box), format), box };
  }
  let box: CropBox;
  if (mode === "percent") {
    const pct = (key: string, size: number) =>
      (optNumber(options, key, 0, { min: 0, max: 100 }) / 100) * size;
    const left = pct("left", image.width);
    const top = pct("top", image.height);
    box = {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(image.width - left - pct("right", image.width)),
      height: Math.round(image.height - top - pct("bottom", image.height)),
    };
  } else {
    box = {
      left: optNumber(options, "x", 0, { min: 0, max: 100000 }),
      top: optNumber(options, "y", 0, { min: 0, max: 100000 }),
      width: optNumber(options, "width", image.width, { min: 0, max: 100000 }),
      height: optNumber(options, "height", image.height, { min: 0, max: 100000 }),
    };
  }
  box = checkBox(image, box);
  return { bytes: await encode(open(image).extract(box), format), box };
}

export const cropExecutor: Executor = eachImage(
  CROP_TOOL_ID,
  async (image, options) => {
    const { bytes, box } = await cropImage(image, options);
    const format = sameFormat(image);
    return {
      file: outFile(outputName(image, "cropped", format), format, bytes),
      note: `Cropped to ${box.width} × ${box.height} px.`,
    };
  },
  { verb: "Cropped", zipStem: "cropped-images" },
);
