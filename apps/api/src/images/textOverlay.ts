// Add Text to Image (Features 6.19): one text block, wrapped to fit, in one of nine positions or at
// an exact point, with optional outline, shadow and background box.
import type { Executor } from "@onestop/tool-registry";
import {
  BLACK,
  eachImage,
  encode,
  open,
  optBool,
  optEnum,
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
import {
  anchorFor,
  POSITIONS,
  renderTextLayer,
  type FontWeight,
  type Position,
  type TextBlock,
} from "./text.ts";

export const ADD_TEXT_TOOL_ID = "add-text-to-image";

const PLACEMENTS = [...POSITIONS, "custom"] as const;
const WEIGHTS = ["regular", "bold", "italic", "bold-italic"] as const;
const BOXES = ["none", "dark", "light"] as const;

export interface TextOverlayOptions {
  text: string;
  position?: (typeof PLACEMENTS)[number];
  /** Custom anchor, % of the image. */
  x?: number;
  y?: number;
  /** Font size as % of the image height. */
  size?: number;
  color?: string;
  weight?: FontWeight;
  outline?: boolean;
  shadow?: boolean;
  box?: (typeof BOXES)[number];
  opacity?: number;
}

/** The text block for an image of this size; shared with the Basic Image Editor. */
export function textBlockFor(
  image: { width: number; height: number },
  o: TextOverlayOptions,
): TextBlock {
  const size = Math.max(6, (image.height * (o.size ?? 8)) / 100);
  const margin = Math.round(Math.min(image.width, image.height) * 0.04);
  const anchor =
    o.position === "custom"
      ? {
          x: (image.width * (o.x ?? 50)) / 100,
          y: (image.height * (o.y ?? 50)) / 100,
          align: "center" as const,
          valign: "middle" as const,
        }
      : anchorFor((o.position ?? "bottom-center") as Position, image.width, image.height, margin);
  const color = parseColor(o.color ?? "#ffffff", WHITE);
  const light = color.r * 0.3 + color.g * 0.59 + color.b * 0.11 > 128;
  return {
    text: o.text,
    size,
    weight: o.weight ?? "bold",
    color,
    ...anchor,
    maxWidth: image.width - margin * 2,
    maxHeight: image.height - margin * 2,
    ...(o.outline
      ? { stroke: { color: light ? BLACK : WHITE, width: Math.max(1, size / 10) } }
      : {}),
    ...(o.shadow ? { shadow: true } : {}),
    ...(o.box && o.box !== "none"
      ? {
          box: {
            color: o.box === "dark" ? { ...BLACK, alpha: 0.55 } : { ...WHITE, alpha: 0.7 },
            padding: size * 0.35,
          },
        }
      : {}),
    opacity: (o.opacity ?? 100) / 100,
  };
}

export async function addTextToImage(image: ImageInput, o: TextOverlayOptions): Promise<Buffer> {
  if (o.text.trim() === "") throw unsupported("Enter the text to add.");
  const layer = await renderTextLayer(image.width, image.height, [textBlockFor(image, o)]);
  return encode(open(image).composite([{ input: layer }]), sameFormat(image), { quality: 92 });
}

export function readTextOptions(options: Record<string, unknown>, prefix = ""): TextOverlayOptions {
  const k = (key: string) => (prefix ? `${prefix}${key[0]!.toUpperCase()}${key.slice(1)}` : key);
  return {
    text: optString(options, k("text"), ""),
    position: optEnum(options, k("position"), PLACEMENTS, "bottom-center"),
    x: optNumber(options, k("x"), 50, { min: 0, max: 100 }),
    y: optNumber(options, k("y"), 50, { min: 0, max: 100 }),
    size: optNumber(options, k("size"), 8, { min: 1, max: 50 }),
    color: optString(options, k("color"), "#ffffff"),
    weight: optEnum(options, k("weight"), WEIGHTS, "bold"),
    outline: optBool(options, k("outline"), true),
    shadow: optBool(options, k("shadow"), false),
    box: optEnum(options, k("box"), BOXES, "none"),
    opacity: optNumber(options, k("opacity"), 100, { min: 1, max: 100 }),
  };
}

export const addTextExecutor: Executor = eachImage(
  ADD_TEXT_TOOL_ID,
  async (image, options) => {
    const bytes = await addTextToImage(image, readTextOptions(options));
    const format = sameFormat(image);
    return { file: outFile(outputName(image, "text", format), format, bytes) };
  },
  { verb: "Added text to", zipStem: "text-images" },
);
