// Image Watermark (Features 6.18): a text or logo watermark in one of nine positions or tiled
// across the image, at a chosen size (share of the image width), opacity and angle.
//
// For a logo, upload it together with the photos and it is used as the LAST file — the same
// "upload it with the document" convention as phase 06's PDF watermark.
import type { Executor } from "@onestop/tool-registry";
import sharp, { type OverlayOptions } from "sharp";
import {
  BLACK,
  countLabel,
  encode,
  open,
  optEnum,
  optNumber,
  optString,
  outFile,
  outputName,
  packageFiles,
  parseColor,
  readImages,
  runImageTool,
  sameFormat,
  throwIfAborted,
  unsupported,
  WHITE,
  withOpacity,
  type ImageInput,
} from "./common.ts";
import { POSITIONS, renderStamp, type Position } from "./text.ts";

export const WATERMARK_TOOL_ID = "image-watermark";

const KINDS = ["text", "logo"] as const;
const PLACEMENTS = [...POSITIONS, "tile"] as const;
type Placement = (typeof PLACEMENTS)[number];

export interface WatermarkOptions {
  kind?: (typeof KINDS)[number];
  text?: string;
  /** Required for kind "logo". */
  logo?: ImageInput;
  position?: Placement;
  /** Width of the watermark as % of the image width. */
  size?: number;
  /** 1–100. */
  opacity?: number;
  /** Degrees, clockwise. */
  angle?: number;
  color?: string;
}

/** Top-left of a `w`×`h` stamp placed at `position` with a margin. */
export function placeAt(
  position: Position,
  img: { width: number; height: number },
  w: number,
  h: number,
  margin: number,
): { left: number; top: number } {
  const [v, hz] =
    position === "center" ? ["middle", "center"] : (position.split("-") as [string, string]);
  const left =
    hz === "left" ? margin : hz === "right" ? img.width - w - margin : (img.width - w) / 2;
  const top =
    v === "top" ? margin : v === "bottom" ? img.height - h - margin : (img.height - h) / 2;
  return { left: Math.round(Math.max(0, left)), top: Math.round(Math.max(0, top)) };
}

async function stampFor(
  image: ImageInput,
  opts: WatermarkOptions,
): Promise<{ png: Buffer; width: number; height: number }> {
  const targetWidth = Math.max(8, (image.width * (opts.size ?? 30)) / 100);
  let png: Buffer;
  if (opts.kind === "logo") {
    if (!opts.logo)
      throw unsupported("Upload your logo together with the images — it is used as the last file.");
    png = await open(opts.logo)
      .resize({ width: Math.round(targetWidth) })
      .ensureAlpha()
      .png()
      .toBuffer();
  } else {
    const text = (opts.text ?? "").trim();
    if (!text) throw unsupported("Enter the watermark text.");
    const color = parseColor(opts.color ?? "#ffffff", WHITE);
    const light = color.r * 0.3 + color.g * 0.59 + color.b * 0.11 > 128;
    // A thin contrasting outline keeps the text readable on both light and dark areas.
    const stamp = await renderStamp({
      text,
      width: targetWidth,
      color,
      stroke: {
        color: light ? { ...BLACK, alpha: 0.35 } : { ...WHITE, alpha: 0.35 },
        width: Math.max(1, targetWidth / 160),
      },
    });
    png = stamp.png;
  }
  let p = withOpacity(sharp(png), (opts.opacity ?? 40) / 100);
  if (opts.angle)
    p = sharp(await p.png().toBuffer()).rotate(opts.angle, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  const { data, info } = await p.png().toBuffer({ resolveWithObject: true });
  // Never larger than the image itself.
  if (info.width > image.width || info.height > image.height) {
    const fitted = await sharp(data)
      .resize(image.width, image.height, { fit: "inside" })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { png: fitted.data, width: fitted.info.width, height: fitted.info.height };
  }
  return { png: data, width: info.width, height: info.height };
}

export async function watermarkImage(image: ImageInput, opts: WatermarkOptions): Promise<Buffer> {
  const stamp = await stampFor(image, opts);
  const margin = Math.round(Math.min(image.width, image.height) * 0.03);
  let layer: OverlayOptions;
  if ((opts.position ?? "bottom-right") === "tile") {
    // Pad the stamp so tiles have breathing room, then let sharp repeat it.
    const gapX = Math.round(stamp.width * 0.3);
    const gapY = Math.round(stamp.height * 0.6);
    const tile = await sharp(stamp.png)
      .extend({
        top: gapY,
        bottom: gapY,
        left: gapX,
        right: gapX,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    layer = { input: tile, tile: true, gravity: "northwest" };
  } else {
    layer = {
      input: stamp.png,
      ...placeAt(opts.position as Position, image, stamp.width, stamp.height, margin),
    };
  }
  return encode(open(image).composite([layer]), sameFormat(image), { quality: 92 });
}

export const watermarkExecutor: Executor = (input, options, ctx) =>
  runImageTool(WATERMARK_TOOL_ID, async () => {
    const kind = optEnum(options, "kind", KINDS, "text");
    const images = await readImages(input, ctx, { min: kind === "logo" ? 2 : 1, max: 51 });
    const logo = kind === "logo" ? images.pop() : undefined;
    const opts: WatermarkOptions = {
      kind,
      text: optString(options, "text", "© OneStop"),
      ...(logo ? { logo } : {}),
      position: optEnum(options, "position", PLACEMENTS, "bottom-right"),
      size: optNumber(options, "size", 30, { min: 2, max: 100 }),
      opacity: optNumber(options, "opacity", 40, { min: 1, max: 100 }),
      angle: optNumber(options, "angle", 0, { min: -180, max: 180 }),
      color: optString(options, "color", "#ffffff"),
    };
    const files = [];
    for (const image of images) {
      throwIfAborted(ctx?.signal);
      const format = sameFormat(image);
      files.push(
        outFile(
          outputName(image, "watermarked", format),
          format,
          await watermarkImage(image, opts),
        ),
      );
    }
    return {
      ok: true,
      output: { images: files.map((f) => ({ name: f.name, size: f.bytes.length })) },
      summary: `Watermarked ${countLabel(files.length)}${logo ? ` with "${logo.ref.name}"` : ""}.`,
      files: packageFiles(files, options, "watermarked-images"),
    };
  });
