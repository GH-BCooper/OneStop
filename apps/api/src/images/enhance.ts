// Image Enhancer (Features 6.15), Image Sharpening (6.16) and Image Denoiser (6.17).
//
// Each has a built-in method made of classic filters — auto-levels + local contrast + a touch of
// colour and sharpness; unsharp masking; median + light blur — and uses a local model instead
// when one is configured (model.ts).
import { open, optEnum, optNumber, type ImageInput } from "./common.ts";
import { aiExecutor, type AiToolSpec } from "./aiTool.ts";

export const ENHANCE_TOOL_ID = "image-enhancer";
export const SHARPEN_TOOL_ID = "image-sharpening";
export const DENOISE_TOOL_ID = "image-denoiser";

const LEVELS = ["light", "medium", "strong"] as const;
type Level = (typeof LEVELS)[number];
const LEVEL_STRENGTH: Record<Level, number> = { light: 0.33, medium: 0.66, strong: 1 };

function level(options: Record<string, unknown>): Level {
  return optEnum(options, "strength", LEVELS, "medium");
}

export async function enhanceBuiltin(image: ImageInput, strength: Level): Promise<Buffer> {
  const s = {
    light: { cut: 0.5, sat: 1.04, sigma: 0.6, slope: 1.5 },
    medium: { cut: 1, sat: 1.1, sigma: 0.9, slope: 2 },
    strong: { cut: 2, sat: 1.18, sigma: 1.2, slope: 3 },
  }[strength];
  const tile = Math.max(8, Math.round(Math.min(image.width, image.height) / 8));
  return open(image)
    .normalise({ lower: s.cut, upper: 100 - s.cut })
    .clahe({ width: tile, height: tile, maxSlope: s.slope })
    .modulate({ saturation: s.sat })
    .sharpen({ sigma: s.sigma, m1: 0.5, m2: 1.2 })
    .png()
    .toBuffer();
}

/** amount 1–100 → an unsharp mask from subtle to strong. */
export async function sharpenBuiltin(image: ImageInput, amount: number): Promise<Buffer> {
  const t = Math.max(1, Math.min(100, amount)) / 100;
  return open(image)
    .sharpen({ sigma: 0.5 + 2 * t, m1: 0.5 + t, m2: 1 + 4 * t })
    .png()
    .toBuffer();
}

export async function denoiseBuiltin(image: ImageInput, strength: Level): Promise<Buffer> {
  const s = {
    light: { median: 3, blur: 0 },
    medium: { median: 3, blur: 0.5 },
    strong: { median: 5, blur: 0.8 },
  }[strength];
  let p = open(image).median(s.median);
  if (s.blur > 0) p = p.blur(s.blur);
  return p.png().toBuffer();
}

export const enhanceSpec: AiToolSpec = {
  id: ENHANCE_TOOL_ID,
  task: "enhance",
  verb: "Enhanced",
  suffix: "enhanced",
  params: (_image, options) => ({ strength: LEVEL_STRENGTH[level(options)] }),
  builtin: async (image, options) => ({ bytes: await enhanceBuiltin(image, level(options)) }),
};

export const sharpenSpec: AiToolSpec = {
  id: SHARPEN_TOOL_ID,
  task: "sharpen",
  verb: "Sharpened",
  suffix: "sharpened",
  params: (_image, options) => ({
    strength: optNumber(options, "amount", 50, { min: 1, max: 100 }) / 100,
  }),
  builtin: async (image, options) => ({
    bytes: await sharpenBuiltin(image, optNumber(options, "amount", 50, { min: 1, max: 100 })),
  }),
};

export const denoiseSpec: AiToolSpec = {
  id: DENOISE_TOOL_ID,
  task: "denoise",
  verb: "Denoised",
  suffix: "denoised",
  params: (_image, options) => ({ strength: LEVEL_STRENGTH[level(options)] }),
  builtin: async (image, options) => ({ bytes: await denoiseBuiltin(image, level(options)) }),
};

export const enhanceExecutor = aiExecutor(enhanceSpec);
export const sharpenExecutor = aiExecutor(sharpenSpec);
export const denoiseExecutor = aiExecutor(denoiseSpec);
