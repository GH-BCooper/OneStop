// Meme Generator (Features 6.27): classic top and bottom captions — bold, upper-case, white with a
// black outline — sized to the image and shrunk to fit when the caption is long.
import type { Executor } from "@onestop/tool-registry";
import {
  BLACK,
  eachImage,
  encode,
  open,
  optBool,
  optNumber,
  optString,
  outFile,
  outputName,
  parseColor,
  sameFormat,
  unsupported,
  WHITE,
  type ImageInput,
} from "./common.ts";
import { renderTextLayer, type TextBlock } from "./text.ts";

export const MEME_TOOL_ID = "meme-generator";

export interface MemeOptions {
  top?: string;
  bottom?: string;
  /** Font size as % of the image height. */
  size?: number;
  uppercase?: boolean;
  color?: string;
}

export async function makeMeme(
  image: ImageInput,
  { top = "", bottom = "", size = 11, uppercase = true, color = "#ffffff" }: MemeOptions,
): Promise<Buffer> {
  if (top.trim() === "" && bottom.trim() === "")
    throw unsupported("Enter a top caption, a bottom caption, or both.");
  const px = Math.max(10, (image.height * size) / 100);
  const margin = Math.round(image.height * 0.03);
  const fill = parseColor(color, WHITE);
  const light = fill.r * 0.3 + fill.g * 0.59 + fill.b * 0.11 > 128;
  const common = {
    size: px,
    weight: "bold" as const,
    color: fill,
    stroke: { color: light ? BLACK : WHITE, width: Math.max(2, px / 7) },
    x: image.width / 2,
    align: "center" as const,
    maxWidth: image.width * 0.94,
    maxHeight: image.height * 0.3,
    lineHeight: 1.08,
  };
  const cap = (s: string) => (uppercase ? s.toLocaleUpperCase() : s);
  const blocks: TextBlock[] = [
    { ...common, text: cap(top), y: margin, valign: "top" },
    { ...common, text: cap(bottom), y: image.height - margin, valign: "bottom" },
  ];
  const layer = await renderTextLayer(image.width, image.height, blocks);
  return encode(open(image).composite([{ input: layer }]), sameFormat(image), { quality: 92 });
}

export const memeExecutor: Executor = eachImage(
  MEME_TOOL_ID,
  async (image, options) => {
    const bytes = await makeMeme(image, {
      top: optString(options, "top", ""),
      bottom: optString(options, "bottom", ""),
      size: optNumber(options, "size", 11, { min: 3, max: 30 }),
      uppercase: optBool(options, "uppercase", true),
      color: optString(options, "color", "#ffffff"),
    });
    const format = sameFormat(image);
    return { file: outFile(outputName(image, "meme", format), format, bytes) };
  },
  { verb: "Made a meme from", zipStem: "memes", max: 1 },
);
