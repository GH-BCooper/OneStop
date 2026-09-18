// Background Blur (Features 6.11) — the deterministic version the build file allows: a portrait
// ("focus") blur that keeps a feathered ellipse around the subject sharp, or a blur of the whole
// image. True subject detection arrives with a local model (see model.ts); when one is set up,
// "Detect the subject" uses its cut-out as the sharp region.
import type { Executor } from "@onestop/tool-registry";
import sharp from "sharp";
import {
  eachImage,
  encode,
  open,
  optEnum,
  optNumber,
  outFile,
  outputName,
  sameFormat,
  type ImageInput,
} from "./common.ts";
import { getImageModelRuntime, modelRequiredError, runModel } from "./model.ts";

export const BLUR_TOOL_ID = "background-blur";

const MODES = ["focus", "subject", "whole"] as const;
const FOCUS = ["center", "top", "bottom", "left", "right"] as const;

export interface BlurOptions {
  mode?: (typeof MODES)[number];
  /** 1–100: blur radius as a share of the image size. */
  strength?: number;
  /** Size of the sharp area, % of the image. */
  focusSize?: number;
  focus?: (typeof FOCUS)[number];
}

/** A feathered white ellipse on black: white = keep sharp. */
function focusMask(
  width: number,
  height: number,
  sizePct: number,
  focus: (typeof FOCUS)[number],
): Buffer {
  const rx = (width * sizePct) / 200;
  const ry = (height * sizePct) / 200;
  const cx = focus === "left" ? rx : focus === "right" ? width - rx : width / 2;
  const cy = focus === "top" ? ry : focus === "bottom" ? height - ry : height / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><radialGradient id="g" cx="${cx}" cy="${cy}" r="1" gradientUnits="userSpaceOnUse"
        gradientTransform="translate(${cx} ${cy}) scale(${rx} ${ry}) translate(${-cx} ${-cy})">
        <stop offset="0.7" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </radialGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`,
  );
}

export async function blurBackground(
  image: ImageInput,
  { mode = "focus", strength = 30, focusSize = 60, focus = "center" }: BlurOptions = {},
): Promise<Buffer> {
  const { width, height } = image;
  const sigma = Math.max(0.5, (Math.max(width, height) * strength) / 2500);
  const format = sameFormat(image);
  if (mode === "whole") return encode(open(image).blur(sigma), format, { quality: 92 });

  const sharpPng = await open(image).ensureAlpha().png().toBuffer();
  let keep: Buffer;
  if (mode === "subject") {
    const runtime = getImageModelRuntime();
    if (!runtime) throw modelRequiredError();
    // The model's cut-out: its alpha is exactly the subject.
    const cutout = await runModel(runtime, "remove-background", sharpPng, {});
    keep = await sharp(cutout).resize(width, height, { fit: "fill" }).png().toBuffer();
  } else {
    // Keep the original's own alpha, multiplied by the focus ellipse.
    keep = await sharp(sharpPng)
      .composite([{ input: focusMask(width, height, focusSize, focus), blend: "dest-in" }])
      .png()
      .toBuffer();
  }
  const blurred = open(image).blur(sigma);
  return encode(blurred.composite([{ input: keep }]), format, { quality: 92 });
}

export const blurExecutor: Executor = eachImage(
  BLUR_TOOL_ID,
  async (image, options) => {
    const mode = optEnum(options, "mode", MODES, "focus");
    const bytes = await blurBackground(image, {
      mode,
      strength: optNumber(options, "strength", 30, { min: 1, max: 100 }),
      focusSize: optNumber(options, "focusSize", 60, { min: 10, max: 100 }),
      focus: optEnum(options, "focus", FOCUS, "center"),
    });
    const format = sameFormat(image);
    return {
      file: outFile(outputName(image, "blurred", format), format, bytes),
      note:
        mode === "whole"
          ? "Blurred the whole image."
          : mode === "subject"
            ? "Blurred everything except the detected subject."
            : "Kept the focus area sharp and blurred the rest.",
    };
  },
  { verb: "Blurred", zipStem: "blurred-images" },
);
