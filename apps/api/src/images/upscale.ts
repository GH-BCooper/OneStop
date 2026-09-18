// Image Upscaler (Features 6.14). Built-in: Lanczos resampling plus a light unsharp mask, which
// beats plain browser scaling; a local super-resolution model does better on real detail.
import { assertOutputSize, dimensions, open, optEnum, type ImageInput } from "./common.ts";
import { aiExecutor, type AiToolSpec } from "./aiTool.ts";

export const UPSCALE_TOOL_ID = "image-upscaler";

const SCALES = ["2", "3", "4"] as const;

export function upscaleFactor(options: Record<string, unknown>): number {
  return Number(optEnum(options, "scale", SCALES, "2"));
}

export async function upscaleBuiltin(image: ImageInput, scale: number): Promise<Buffer> {
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  assertOutputSize(width, height);
  return open(image)
    .resize(width, height, { kernel: "lanczos3", fit: "fill" })
    .sharpen({ sigma: 0.5 + 0.25 * scale, m1: 0.5, m2: 1.5 })
    .png()
    .toBuffer();
}

export const upscaleSpec: AiToolSpec = {
  id: UPSCALE_TOOL_ID,
  task: "upscale",
  verb: "Upscaled",
  suffix: "upscaled",
  params: (image, options) => {
    const scale = upscaleFactor(options);
    assertOutputSize(image.width * scale, image.height * scale);
    return { scale };
  },
  builtin: async (image, options) => ({
    bytes: await upscaleBuiltin(image, upscaleFactor(options)),
  }),
  describe: async (bytes, image) => {
    const { width, height } = await dimensions(bytes);
    return `${image.width} × ${image.height} → ${width} × ${height} px.`;
  },
};

export const upscaleExecutor = aiExecutor(upscaleSpec);
