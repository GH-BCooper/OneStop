// Image Color Adjustment (Features 6.22): brightness, contrast, saturation, hue, warmth and a few
// one-click looks. Every slider is -100…100 with 0 meaning "unchanged", so the same values mean
// the same thing here, in the Basic Image Editor and to the AI assistant.
import type { Executor } from "@onestop/tool-registry";
import type { Sharp } from "sharp";
import {
  eachImage,
  encode,
  open,
  optEnum,
  optNumber,
  outFile,
  outputName,
  sameFormat,
} from "./common.ts";

export const COLOR_ADJUST_TOOL_ID = "image-color-adjustment";

export const EFFECTS = ["none", "grayscale", "sepia", "invert", "vintage", "cool", "warm"] as const;
export type Effect = (typeof EFFECTS)[number];

export interface ColorAdjustments {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  /** Degrees, -180…180. */
  hue?: number;
  /** -100 (cooler, bluer) … 100 (warmer, more orange). */
  warmth?: number;
  effect?: Effect;
}

/** True when the adjustments would leave the image unchanged. */
export function isNeutral(a: ColorAdjustments): boolean {
  return (
    !a.brightness &&
    !a.contrast &&
    !a.saturation &&
    !a.hue &&
    !a.warmth &&
    (a.effect ?? "none") === "none"
  );
}

/** Applies colour adjustments to a pipeline (shared with the Basic Image Editor). */
export function applyColor(pipeline: Sharp, a: ColorAdjustments): Sharp {
  let p = pipeline;
  const brightness = 1 + (a.brightness ?? 0) / 100;
  const saturation = Math.max(0, 1 + (a.saturation ?? 0) / 100);
  const hue = Math.round(a.hue ?? 0);
  if (brightness !== 1 || saturation !== 1 || hue !== 0) {
    p = p.modulate({ brightness: Math.max(0.01, brightness), saturation, hue });
  }
  if (a.contrast) {
    // Pivot around mid-grey: out = k·in + 128·(1 − k).
    const k = a.contrast > 0 ? 1 + a.contrast / 50 : 1 + a.contrast / 100;
    p = p.linear(k, 128 * (1 - k));
  }
  if (a.warmth) {
    const t = a.warmth / 100;
    p = p.linear([1 + 0.12 * t, 1, 1 - 0.12 * t], [8 * t, 0, -8 * t]);
  }
  switch (a.effect ?? "none") {
    case "grayscale":
      p = p.grayscale().toColourspace("srgb");
      break;
    case "sepia":
      p = p.recomb([
        [0.393, 0.769, 0.189],
        [0.349, 0.686, 0.168],
        [0.272, 0.534, 0.131],
      ]);
      break;
    case "invert":
      p = p.negate({ alpha: false });
      break;
    case "vintage":
      p = p
        .recomb([
          [0.6, 0.35, 0.1],
          [0.2, 0.7, 0.1],
          [0.15, 0.25, 0.55],
        ])
        .linear(0.9, 20);
      break;
    case "cool":
      p = p.linear([0.92, 1, 1.1], [-6, 0, 10]);
      break;
    case "warm":
      p = p.linear([1.1, 1.02, 0.9], [10, 2, -8]);
      break;
    case "none":
      break;
  }
  return p;
}

export function readColorOptions(options: Record<string, unknown>): ColorAdjustments {
  const slider = (key: string) => optNumber(options, key, 0, { min: -100, max: 100 });
  return {
    brightness: slider("brightness"),
    contrast: slider("contrast"),
    saturation: slider("saturation"),
    hue: optNumber(options, "hue", 0, { min: -180, max: 180 }),
    warmth: slider("warmth"),
    effect: optEnum(options, "effect", EFFECTS, "none"),
  };
}

export const colorAdjustExecutor: Executor = eachImage(
  COLOR_ADJUST_TOOL_ID,
  async (image, options) => {
    const adjustments = readColorOptions(options);
    const format = sameFormat(image);
    const bytes = await encode(applyColor(open(image), adjustments), format, { quality: 92 });
    return {
      file: outFile(outputName(image, "adjusted", format), format, bytes),
      ...(isNeutral(adjustments)
        ? { note: "All adjustments were at 0, so the colours are unchanged." }
        : {}),
    };
  },
  { verb: "Adjusted", zipStem: "adjusted-images" },
);
