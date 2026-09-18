// Drawing "upright as the reader sees it" on pages that may carry a /Rotate
// (06-pdf-tools-advanced.md: watermarks, page numbers, signatures).
//
// pdf-lib draws in the page's unrotated space. A page with /Rotate 90 is displayed turned, so a
// page number drawn at "bottom centre" in raw space would appear on the side, sideways. These
// helpers take positions in *visual* space (what the viewer shows, origin bottom-left) and map
// them onto the page, adding the page's rotation to the drawing angle.
import { degrees, type PDFFont, type PDFImage, type PDFPage, type RGB } from "@cantoo/pdf-lib";

export interface VisualFrame {
  /** Displayed width/height, in points. */
  width: number;
  height: number;
  /** Rotation (degrees, anticlockwise) to add to anything drawn so it reads upright. */
  rotation: number;
  /** Maps a visual point to the page's raw coordinate space. */
  toPage(vx: number, vy: number): { x: number; y: number };
}

export function visualFrame(page: PDFPage): VisualFrame {
  const box = page.getCropBox();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const { x: bx, y: by, width: w, height: h } = box;
  switch (r) {
    case 90:
      return {
        width: h,
        height: w,
        rotation: 90,
        toPage: (vx, vy) => ({ x: bx + w - vy, y: by + vx }),
      };
    case 180:
      return {
        width: w,
        height: h,
        rotation: 180,
        toPage: (vx, vy) => ({ x: bx + w - vx, y: by + h - vy }),
      };
    case 270:
      return {
        width: h,
        height: w,
        rotation: 270,
        toPage: (vx, vy) => ({ x: bx + vy, y: by + h - vx }),
      };
    default:
      return { width: w, height: h, rotation: 0, toPage: (vx, vy) => ({ x: bx + vx, y: by + vy }) };
  }
}

function rotate(x: number, y: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) };
}

/** Draws text centred on a visual point, turned `angle` degrees anticlockwise as seen. */
export function drawTextCentered(
  page: PDFPage,
  frame: VisualFrame,
  text: string,
  {
    cx,
    cy,
    font,
    size,
    angle = 0,
    color,
    opacity = 1,
  }: {
    cx: number;
    cy: number;
    font: PDFFont;
    size: number;
    angle?: number;
    color: RGB;
    opacity?: number;
  },
): void {
  const width = font.widthOfTextAtSize(text, size);
  const height = font.heightAtSize(size, { descender: false });
  // Offset from the text's centre to its baseline origin, turned with the text.
  const offset = rotate(-width / 2, -height / 2, angle);
  const origin = frame.toPage(cx + offset.x, cy + offset.y);
  page.drawText(text, {
    x: origin.x,
    y: origin.y,
    size,
    font,
    color,
    opacity,
    rotate: degrees(angle + frame.rotation),
  });
}

/** Draws an image whose bottom-left corner sits at a visual point (unturned as seen). */
export function drawImageAt(
  page: PDFPage,
  frame: VisualFrame,
  image: PDFImage,
  {
    x,
    y,
    width,
    height,
    angle = 0,
    opacity = 1,
  }: { x: number; y: number; width: number; height: number; angle?: number; opacity?: number },
): void {
  const origin = frame.toPage(x, y);
  page.drawImage(image, {
    x: origin.x,
    y: origin.y,
    width,
    height,
    opacity,
    rotate: degrees(angle + frame.rotation),
  });
}

/** Draws an image centred on a visual point. */
export function drawImageCentered(
  page: PDFPage,
  frame: VisualFrame,
  image: PDFImage,
  opts: { cx: number; cy: number; width: number; height: number; angle?: number; opacity?: number },
): void {
  const angle = opts.angle ?? 0;
  const offset = rotate(-opts.width / 2, -opts.height / 2, angle);
  drawImageAt(page, frame, image, { ...opts, x: opts.cx + offset.x, y: opts.cy + offset.y, angle });
}

export type Anchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export const ANCHORS: readonly Anchor[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

/** Centre point, in visual space, of a box of the given size placed at an anchor with a margin. */
export function anchorPoint(
  frame: VisualFrame,
  anchor: Anchor,
  boxWidth: number,
  boxHeight: number,
  margin: number,
): { cx: number; cy: number } {
  const [v, h] = anchor === "center" ? ["middle", "center"] : anchor.split("-");
  const cx =
    h === "left"
      ? margin + boxWidth / 2
      : h === "right"
        ? frame.width - margin - boxWidth / 2
        : frame.width / 2;
  const cy =
    v === "bottom"
      ? margin + boxHeight / 2
      : v === "top"
        ? frame.height - margin - boxHeight / 2
        : frame.height / 2;
  return { cx, cy };
}
