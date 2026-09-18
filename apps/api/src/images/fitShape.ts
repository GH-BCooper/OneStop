// Fit Image to Square (Features 6.25) and Fit Image to Circle (6.26), each with the five modes
// the Features list names:
//
//   fill     – cover the square, cropping the overflow (smart crop keeps the subject)
//   contain  – the whole image, padded with a background colour
//   stretch  – the whole image, distorted to the square
//   repeat   – the whole image, with copies tiled into the empty space
//   blur     – the whole image over a blurred, enlarged copy of itself
//
// The circle tool builds the same square and then cuts it to a circle with a transparent outside.
import type { Executor } from "@onestop/tool-registry";
import sharp, { type OverlayOptions } from "sharp";
import {
  assertOutputSize,
  eachImage,
  encode,
  MAX_INPUT_PIXELS,
  open,
  optEnum,
  optNumber,
  optString,
  outFile,
  outputName,
  parseColor,
  sameFormat,
  WHITE,
  type ImageInput,
  type Rgba,
} from "./common.ts";

export const FIT_SQUARE_TOOL_ID = "fit-image-to-square";
export const FIT_CIRCLE_TOOL_ID = "fit-image-to-circle";

export const FIT_MODES = ["fill", "contain", "stretch", "repeat", "blur"] as const;
export type FitMode = (typeof FIT_MODES)[number];

export interface FitOptions {
  mode?: FitMode;
  /** Side of the square in px; 0 = automatic (the longer side, or shorter for "fill"). */
  size?: number;
  /** Padding colour for "contain" (may be transparent). */
  background?: string;
  /** Circle only: outline width in px and colour. */
  border?: number;
  borderColor?: string;
}

function squareSide(image: ImageInput, mode: FitMode, size: number): number {
  const auto =
    mode === "fill" ? Math.min(image.width, image.height) : Math.max(image.width, image.height);
  const side = size > 0 ? size : Math.min(auto, 4096);
  assertOutputSize(side, side);
  return side;
}

/** The image scaled to fit inside `side` (as PNG, keeping alpha) with its size. */
async function contained(
  image: ImageInput,
  side: number,
): Promise<{ png: Buffer; width: number; height: number }> {
  const scale = Math.min(side / image.width, side / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const png = await open(image).resize(width, height, { fit: "fill" }).png().toBuffer();
  return { png, width, height };
}

function canvas(side: number, background: Rgba) {
  return sharp({
    create: { width: side, height: side, channels: 4, background },
    limitInputPixels: MAX_INPUT_PIXELS,
  });
}

/** Builds the square as a PNG buffer; the pure core both tools share. */
export async function fitToSquare(
  image: ImageInput,
  { mode = "contain", size = 0, background = "#ffffff" }: FitOptions = {},
): Promise<{ png: Buffer; side: number }> {
  const side = squareSide(image, mode, size);
  switch (mode) {
    case "fill": {
      const png = await open(image)
        .resize(side, side, { fit: "cover", position: "attention" })
        .png()
        .toBuffer();
      return { png, side };
    }
    case "stretch": {
      const png = await open(image).resize(side, side, { fit: "fill" }).png().toBuffer();
      return { png, side };
    }
    case "contain": {
      const fg = await contained(image, side);
      const png = await canvas(side, parseColor(background, WHITE))
        .composite([
          {
            input: fg.png,
            left: Math.round((side - fg.width) / 2),
            top: Math.round((side - fg.height) / 2),
          },
        ])
        .png()
        .toBuffer();
      return { png, side };
    }
    case "repeat": {
      // Tile copies outward from a centred one so the pattern is symmetric.
      const fg = await contained(image, side);
      const x0 = Math.round((side - fg.width) / 2);
      const y0 = Math.round((side - fg.height) / 2);
      const layers: OverlayOptions[] = [];
      const startX = x0 - Math.ceil(x0 / fg.width) * fg.width;
      const startY = y0 - Math.ceil(y0 / fg.height) * fg.height;
      for (let y = startY; y < side; y += fg.height) {
        for (let x = startX; x < side; x += fg.width) {
          // sharp rejects overlays that start off-canvas; crop the copy instead.
          const cropL = Math.max(0, -x);
          const cropT = Math.max(0, -y);
          const w = Math.min(fg.width - cropL, side - Math.max(0, x));
          const h = Math.min(fg.height - cropT, side - Math.max(0, y));
          if (w <= 0 || h <= 0) continue;
          const piece =
            cropL === 0 && cropT === 0 && w === fg.width && h === fg.height
              ? fg.png
              : await sharp(fg.png)
                  .extract({ left: cropL, top: cropT, width: w, height: h })
                  .png()
                  .toBuffer();
          layers.push({ input: piece, left: Math.max(0, x), top: Math.max(0, y) });
        }
      }
      const png = await canvas(side, WHITE).composite(layers).png().toBuffer();
      return { png, side };
    }
    case "blur": {
      const fg = await contained(image, side);
      const backdrop = await open(image)
        .resize(side, side, { fit: "cover" })
        .blur(Math.max(4, side / 40))
        .modulate({ brightness: 0.85 })
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
      const png = await sharp(backdrop)
        .composite([
          {
            input: fg.png,
            left: Math.round((side - fg.width) / 2),
            top: Math.round((side - fg.height) / 2),
          },
        ])
        .png()
        .toBuffer();
      return { png, side };
    }
  }
}

/** Cuts a square PNG to a circle (transparent outside), with an optional outline. */
export async function cutCircle(
  square: Buffer,
  side: number,
  border = 0,
  borderColor = "#ffffff",
): Promise<Buffer> {
  const r = side / 2;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`,
  );
  const layers: OverlayOptions[] = [{ input: mask, blend: "dest-in" }];
  if (border > 0) {
    const c = parseColor(borderColor, WHITE);
    const w = Math.min(border, r);
    const ring = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><circle cx="${r}" cy="${r}" r="${r - w / 2}" fill="none" stroke="rgb(${c.r},${c.g},${c.b})" stroke-opacity="${c.alpha}" stroke-width="${w}"/></svg>`,
    );
    layers.push({ input: ring });
  }
  // Two passes: dest-in must be applied before the ring is drawn on top.
  const cut = await sharp(square).ensureAlpha().composite([layers[0]!]).png().toBuffer();
  if (layers.length === 1) return cut;
  return sharp(cut).composite([layers[1]!]).png().toBuffer();
}

function readFitOptions(options: Record<string, unknown>): FitOptions {
  return {
    mode: optEnum(options, "mode", FIT_MODES, "contain"),
    size: optNumber(options, "size", 0, { min: 0, max: 8000 }),
    background: optString(options, "background", "#ffffff"),
    border: optNumber(options, "border", 0, { min: 0, max: 500 }),
    borderColor: optString(options, "borderColor", "#ffffff"),
  };
}

const MODE_LABEL: Record<FitMode, string> = {
  fill: "filled (cropped to fit)",
  contain: "contained with padding",
  stretch: "stretched",
  repeat: "tiled",
  blur: "over a blurred background",
};

export const fitSquareExecutor: Executor = eachImage(
  FIT_SQUARE_TOOL_ID,
  async (image, options) => {
    const opts = readFitOptions(options);
    const { png, side } = await fitToSquare(image, opts);
    const transparent =
      opts.mode === "contain" && parseColor(opts.background ?? "", WHITE).alpha < 1;
    const format = sameFormat(image, { needsAlpha: transparent || image.hasAlpha });
    const bytes = format === "png" ? png : await encode(sharp(png), format, { quality: 92 });
    return {
      file: outFile(outputName(image, "square", format), format, bytes),
      note: `${side} × ${side} px, ${MODE_LABEL[opts.mode!]}.`,
    };
  },
  { verb: "Squared", zipStem: "square-images" },
);

export const fitCircleExecutor: Executor = eachImage(
  FIT_CIRCLE_TOOL_ID,
  async (image, options) => {
    const opts = readFitOptions(options);
    const { png, side } = await fitToSquare(image, opts);
    const bytes = await cutCircle(png, side, opts.border, opts.borderColor);
    return {
      file: outFile(outputName(image, "circle", "png"), "png", bytes),
      note: `${side} px circle, ${MODE_LABEL[opts.mode!]}.`,
    };
  },
  { verb: "Circled", zipStem: "circle-images" },
);
