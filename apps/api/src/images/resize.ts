// Image Resizer (Features 6.3): exact pixels, a percentage, or a longest-side limit.
import type { Executor } from "@onestop/tool-registry";
import {
  assertOutputSize,
  eachImage,
  encode,
  open,
  optBool,
  optEnum,
  optNumber,
  outFile,
  outputName,
  sameFormat,
  unsupported,
  type ImageInput,
} from "./common.ts";

export const RESIZE_TOOL_ID = "image-resizer";

const MODES = ["pixels", "percent", "longest"] as const;
const FITS = ["contain", "cover", "fill"] as const;

export interface ResizeOptions {
  mode?: (typeof MODES)[number];
  /** 0 = work it out from the other side and the aspect ratio. */
  width?: number;
  height?: number;
  percent?: number;
  longest?: number;
  fit?: (typeof FITS)[number];
  noEnlarge?: boolean;
}

/** Target size for an image; pure so tests and the editor can reuse it. */
export function resizeTarget(
  src: { width: number; height: number },
  {
    mode = "pixels",
    width = 0,
    height = 0,
    percent = 50,
    longest = 1920,
    fit = "contain",
    noEnlarge = false,
  }: ResizeOptions,
): { width: number; height: number } {
  let w: number;
  let h: number;
  if (mode === "percent") {
    w = (src.width * percent) / 100;
    h = (src.height * percent) / 100;
  } else if (mode === "longest") {
    const scale = longest / Math.max(src.width, src.height);
    w = src.width * scale;
    h = src.height * scale;
  } else {
    if (width <= 0 && height <= 0) throw unsupported("Enter a width, a height, or both.");
    if (width > 0 && height > 0) {
      if (fit === "contain") {
        const scale = Math.min(width / src.width, height / src.height);
        w = src.width * scale;
        h = src.height * scale;
      } else {
        w = width;
        h = height;
      }
    } else if (width > 0) {
      w = width;
      h = (src.height * width) / src.width;
    } else {
      h = height;
      w = (src.width * height) / src.height;
    }
  }
  if (noEnlarge && (w > src.width || h > src.height)) {
    const scale = Math.min(src.width / w, src.height / h);
    w *= scale;
    h *= scale;
  }
  const out = { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
  assertOutputSize(out.width, out.height);
  return out;
}

export async function resizeImage(
  image: ImageInput,
  opts: ResizeOptions,
): Promise<{ bytes: Buffer; width: number; height: number }> {
  const target = resizeTarget(image, opts);
  const boxed = opts.mode === "pixels" && (opts.width ?? 0) > 0 && (opts.height ?? 0) > 0;
  // "contain" is already baked into the target size; only "cover" needs sharp to crop.
  const fit = boxed && opts.fit === "cover" ? "cover" : "fill";
  const pipeline = open(image, { animated: true }).resize(target.width, target.height, {
    fit,
    position: "attention",
    kernel: "lanczos3",
  });
  const bytes = await encode(pipeline, sameFormat(image), { quality: 92 });
  return { bytes, ...target };
}

export const resizeExecutor: Executor = eachImage(
  RESIZE_TOOL_ID,
  async (image, options) => {
    const { bytes, width, height } = await resizeImage(image, {
      mode: optEnum(options, "mode", MODES, "pixels"),
      width: optNumber(options, "width", 0, { min: 0, max: 20000 }),
      height: optNumber(options, "height", 0, { min: 0, max: 20000 }),
      percent: optNumber(options, "percent", 50, { min: 1, max: 1000 }),
      longest: optNumber(options, "longest", 1920, { min: 1, max: 20000 }),
      fit: optEnum(options, "fit", FITS, "contain"),
      noEnlarge: optBool(options, "noEnlarge", false),
    });
    const format = sameFormat(image);
    return {
      file: outFile(outputName(image, `${width}x${height}`, format), format, bytes),
      note: `${image.width} × ${image.height} → ${width} × ${height} px.`,
    };
  },
  { verb: "Resized", zipStem: "resized-images" },
);
