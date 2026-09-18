// Text drawing for the image tools (Add Text, Watermark, Meme Generator, Basic Image Editor).
//
// `sharp` can render text through Pango, but only with whatever fonts the host happens to have,
// so the same job would look different on Windows, a Linux container and a phone. Instead text is
// drawn with @napi-rs/canvas (already used by phases 06–07) in the Liberation fonts pdf.js ships
// (SIL OFL), giving identical, offline output everywhere; the transparent layer is then
// composited with sharp.
import path from "node:path";
import type { SKRSContext2D } from "@napi-rs/canvas";
import { findPackageDir } from "../shared/node-modules.ts";
import { cssColor, type Rgba } from "./common.ts";

export const FONT_FAMILY = "OneStop Sans";
export type FontWeight = "regular" | "bold" | "italic" | "bold-italic";

const FILES: Record<FontWeight, string> = {
  regular: "LiberationSans-Regular.ttf",
  bold: "LiberationSans-Bold.ttf",
  italic: "LiberationSans-Italic.ttf",
  "bold-italic": "LiberationSans-BoldItalic.ttf",
};

let registered: Promise<boolean> | null = null;

async function canvasModule() {
  return import("@napi-rs/canvas");
}

/** Registers the bundled fonts once. Falls back to the system sans-serif if they are missing. */
async function ensureFonts(): Promise<boolean> {
  registered ??= (async () => {
    const { GlobalFonts } = await canvasModule();
    const dir = findPackageDir("pdfjs-dist", "standard_fonts");
    if (!dir) return false;
    let ok = true;
    for (const file of Object.values(FILES)) {
      ok =
        Boolean(
          GlobalFonts.registerFromPath(path.join(dir, "standard_fonts", file), FONT_FAMILY),
        ) && ok;
    }
    return ok;
  })();
  return registered;
}

export function fontSpec(size: number, weight: FontWeight): string {
  const style = weight.includes("italic") ? "italic " : "";
  const bold = weight.startsWith("bold") ? "bold " : "";
  return `${style}${bold}${Math.max(1, Math.round(size))}px "${FONT_FAMILY}", sans-serif`;
}

/** Greedy word wrap; words longer than the line are broken by character. Keeps explicit newlines. */
export function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      if (ctx.measureText(word).width <= maxWidth) {
        line = word;
        continue;
      }
      // A single word wider than the line: break it by character.
      for (const ch of word) {
        if (ctx.measureText(line + ch).width > maxWidth && line) {
          lines.push(line);
          line = ch;
        } else line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

export interface TextBlock {
  text: string;
  /** Font size in px. */
  size: number;
  weight?: FontWeight;
  color: Rgba;
  /** Outline colour and width (px); omit for none. */
  stroke?: { color: Rgba; width: number };
  /** Filled box behind the text. */
  box?: { color: Rgba; padding: number };
  shadow?: boolean;
  /** Anchor point inside the layer. */
  x: number;
  y: number;
  align: HAlign;
  valign: VAlign;
  /** Wrap width in px (default: the whole layer minus margins). */
  maxWidth?: number;
  /** Shrinks the font until the block fits in this many px of height. */
  maxHeight?: number;
  lineHeight?: number;
  /** Degrees, clockwise, around the anchor. */
  angle?: number;
  opacity?: number;
}

/** Draws text blocks on a transparent layer of the given size and returns it as PNG. */
export async function renderTextLayer(
  width: number,
  height: number,
  blocks: TextBlock[],
): Promise<Buffer> {
  await ensureFonts();
  const { createCanvas } = await canvasModule();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  for (const block of blocks) drawBlock(ctx, width, block);
  return canvas.toBuffer("image/png");
}

/** Lays a block out (wrapping and shrinking as needed) without drawing it. */
export function layoutBlock(
  ctx: SKRSContext2D,
  layerWidth: number,
  block: TextBlock,
): { lines: string[]; size: number; lineGap: number } {
  const maxWidth = Math.max(10, block.maxWidth ?? layerWidth * 0.94);
  const lineHeight = block.lineHeight ?? 1.18;
  let size = block.size;
  for (;;) {
    ctx.font = fontSpec(size, block.weight ?? "regular");
    const lines = wrapText(ctx, block.text, maxWidth - (block.box ? block.box.padding * 2 : 0));
    const total = lines.length * size * lineHeight;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const tooTall = block.maxHeight !== undefined && total > block.maxHeight;
    if ((!tooTall && widest <= maxWidth) || size <= 6)
      return { lines, size, lineGap: size * lineHeight };
    size = Math.max(6, size * 0.92);
  }
}

function drawBlock(ctx: SKRSContext2D, layerWidth: number, block: TextBlock): void {
  if (block.text.trim() === "") return;
  const { lines, size, lineGap } = layoutBlock(ctx, layerWidth, block);
  ctx.save();
  ctx.globalAlpha = block.opacity ?? 1;
  ctx.translate(block.x, block.y);
  if (block.angle) ctx.rotate((block.angle * Math.PI) / 180);
  ctx.font = fontSpec(size, block.weight ?? "regular");
  ctx.textBaseline = "middle";
  ctx.textAlign = block.align;
  ctx.lineJoin = "round";

  const total = lines.length * lineGap;
  const top = block.valign === "top" ? 0 : block.valign === "middle" ? -total / 2 : -total;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));

  if (block.box) {
    const pad = block.box.padding;
    const left = block.align === "left" ? 0 : block.align === "center" ? -widest / 2 : -widest;
    ctx.fillStyle = cssColor(block.box.color);
    ctx.fillRect(left - pad, top - pad, widest + pad * 2, total + pad * 2);
  }
  if (block.shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = Math.max(2, size / 10);
    ctx.shadowOffsetX = Math.max(1, size / 30);
    ctx.shadowOffsetY = Math.max(1, size / 30);
  }
  lines.forEach((line, i) => {
    const y = top + lineGap * (i + 0.5);
    if (block.stroke && block.stroke.width > 0) {
      ctx.strokeStyle = cssColor(block.stroke.color);
      ctx.lineWidth = block.stroke.width;
      ctx.strokeText(line, 0, y);
    }
    ctx.fillStyle = cssColor(block.color);
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
}

// ---- positions --------------------------------------------------------------------------------

export const POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type Position = (typeof POSITIONS)[number];

/** Anchor point and alignment for one of the nine positions, `margin` px in from the edges. */
export function anchorFor(
  position: Position,
  width: number,
  height: number,
  margin: number,
): { x: number; y: number; align: HAlign; valign: VAlign } {
  const [v, h] =
    position === "center" ? ["middle", "center"] : (position.split("-") as [string, string]);
  const align: HAlign = h === "left" ? "left" : h === "right" ? "right" : "center";
  const valign: VAlign = v === "top" ? "top" : v === "bottom" ? "bottom" : "middle";
  return {
    x: align === "left" ? margin : align === "right" ? width - margin : width / 2,
    y: valign === "top" ? margin : valign === "bottom" ? height - margin : height / 2,
    align,
    valign,
  };
}

/**
 * A single-line (or wrapped) text stamp cropped to its own size, e.g. for a watermark. `width`
 * is the target width of the widest line in px; the font is sized to match.
 */
export async function renderStamp({
  text,
  width,
  weight = "bold",
  color,
  stroke,
}: {
  text: string;
  width: number;
  weight?: FontWeight;
  color: Rgba;
  stroke?: { color: Rgba; width: number };
}): Promise<{ png: Buffer; width: number; height: number }> {
  await ensureFonts();
  const { createCanvas } = await canvasModule();
  const measure = createCanvas(8, 8).getContext("2d");
  measure.font = fontSpec(100, weight);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const widest = Math.max(1, ...lines.map((l) => measure.measureText(l).width));
  const size = Math.max(6, Math.min(2000, (100 * width) / widest));
  const lineGap = size * 1.2;
  const pad = Math.ceil(size * 0.15 + (stroke?.width ?? 0));
  measure.font = fontSpec(size, weight);
  const w = Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width)) + pad * 2);
  const h = Math.ceil(lines.length * lineGap + pad * 2);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const block: TextBlock = {
    text,
    size,
    weight,
    color,
    x: w / 2,
    y: h / 2,
    align: "center",
    valign: "middle",
    maxWidth: w,
    lineHeight: 1.2,
    ...(stroke ? { stroke } : {}),
  };
  drawBlock(ctx, w, block);
  return { png: canvas.toBuffer("image/png"), width: w, height: h };
}
