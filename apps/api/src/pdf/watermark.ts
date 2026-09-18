// Add Watermark to PDF (Features 1.16).
//
// Text or image, stamped on every selected page of every uploaded PDF. Upload a PNG/JPG alongside
// the PDF to use it as the watermark. Positions are in visual space (see placement.ts), so the
// watermark reads upright even on rotated pages.
import { rgb, type PDFFont, type PDFImage, type RGB } from "@cantoo/pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  loadPdf,
  optEnum,
  optNumber,
  optString,
  outputName,
  parsePageSelection,
  PDF_MIME,
  savePdf,
  throwIfAborted,
} from "./document.ts";
import { runPdfTool, unsupported } from "./errors.ts";
import { drawableText, embedUnicodeFont } from "./fonts.ts";
import { embedImage, packageOutputs, plural, readMixedInputs, zipNameFor } from "./inputs.ts";
import {
  anchorPoint,
  drawImageCentered,
  drawTextCentered,
  visualFrame,
  type Anchor,
} from "./placement.ts";

export const ADD_WATERMARK_TOOL_ID = "add-watermark-to-pdf";

const POSITIONS = ["center", "tile", "top-center", "bottom-center"] as const;
const ANGLES = ["diagonal", "horizontal", "vertical"] as const;
const COLORS: Record<string, RGB> = {
  gray: rgb(0.5, 0.5, 0.5),
  red: rgb(0.8, 0.1, 0.1),
  blue: rgb(0.1, 0.3, 0.8),
  black: rgb(0, 0, 0),
};

type Stamp =
  | { kind: "text"; text: string; font: PDFFont; size: number; color: RGB }
  | { kind: "image"; image: PDFImage; scale: number };

export const addWatermarkExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(ADD_WATERMARK_TOOL_ID, async () => {
    const { pdfs, images } = await readMixedInputs(input, ctx);
    const text = optString(options, "text", "CONFIDENTIAL").trim();
    const useImage = images.length > 0;
    if (!useImage && text === "") {
      throw unsupported("Enter the watermark text, or upload a PNG/JPG image with the PDF.");
    }
    if (text.length > 200) throw unsupported("Keep the watermark text under 200 characters.");
    const position = optEnum(options, "position", POSITIONS, "center");
    const angleName = optEnum(options, "angle", ANGLES, "diagonal");
    const opacity = optNumber(options, "opacity", 25, { min: 5, max: 100 }) / 100;
    const size = optNumber(options, "fontSize", 60, { min: 6, max: 300 });
    const scale = optNumber(options, "imageScale", 40, { min: 5, max: 100 }) / 100;
    const colorName = optString(options, "color", "gray");
    const color = COLORS[colorName] ?? COLORS.gray!;
    const packaging = optEnum(options, "packaging", ["zip", "files"] as const, "zip");

    const results: OutputFile[] = [];
    let stamped = 0;
    for (const file of pdfs) {
      throwIfAborted(ctx?.signal);
      const doc = await loadPdf(file.bytes);
      const selected = parsePageSelection(optString(options, "pages"), doc.getPageCount());
      let stamp: Stamp;
      if (useImage) {
        stamp = { kind: "image", image: await embedImage(doc, images[0]!), scale };
      } else {
        const font = await embedUnicodeFont(doc, "bold");
        stamp = { kind: "text", text: drawableText(font, text), font, size, color };
      }

      for (const pageNumber of selected) {
        const page = doc.getPage(pageNumber - 1);
        const frame = visualFrame(page);
        const angle =
          angleName === "horizontal"
            ? 0
            : angleName === "vertical"
              ? 90
              : (Math.atan2(frame.height, frame.width) * 180) / Math.PI;

        let w: number;
        let h: number;
        if (stamp.kind === "text") {
          // Never let the watermark run off the page: shrink it to fit the diagonal/width.
          const room =
            angle === 0
              ? frame.width * 0.9
              : angle === 90
                ? frame.height * 0.9
                : Math.hypot(frame.width, frame.height) * 0.8;
          const fitted = Math.min(
            stamp.size,
            (stamp.size * room) / Math.max(1, stamp.font.widthOfTextAtSize(stamp.text, stamp.size)),
          );
          const drawSize = position === "tile" ? Math.min(fitted, stamp.size * 0.5) : fitted;
          w = stamp.font.widthOfTextAtSize(stamp.text, drawSize);
          h = stamp.font.heightAtSize(drawSize, { descender: false });
          const draw = (cx: number, cy: number) =>
            drawTextCentered(page, frame, stamp.text, {
              cx,
              cy,
              font: stamp.font,
              size: drawSize,
              angle,
              color: stamp.color,
              opacity,
            });
          placeAll(frame.width, frame.height, position, w, h, draw, frame);
        } else {
          w = frame.width * stamp.scale * (position === "tile" ? 0.5 : 1);
          h = (w * stamp.image.height) / stamp.image.width;
          const drawAngle = angleName === "horizontal" ? 0 : angle;
          const draw = (cx: number, cy: number) =>
            drawImageCentered(page, frame, stamp.image, {
              cx,
              cy,
              width: w,
              height: h,
              angle: drawAngle,
              opacity,
            });
          placeAll(frame.width, frame.height, position, w, h, draw, frame);
        }
      }
      stamped += selected.length;
      results.push({
        name: outputName(file.ref.name, "watermarked"),
        mimeType: PDF_MIME,
        bytes: await savePdf(doc),
      });
    }

    return {
      ok: true,
      output: {
        files: pdfs.length,
        pagesStamped: stamped,
        kind: useImage ? "image" : "text",
        position,
      },
      summary: `Watermarked ${plural(stamped, "page")} in ${plural(pdfs.length, "PDF")}.`,
      files: packageOutputs(results, zipNameFor(pdfs[0]!, "watermarked"), packaging),
    };
  });

function placeAll(
  width: number,
  height: number,
  position: (typeof POSITIONS)[number],
  w: number,
  h: number,
  draw: (cx: number, cy: number) => void,
  frame: ReturnType<typeof visualFrame>,
): void {
  if (position === "tile") {
    const stepX = Math.max(w * 0.9, 120);
    const stepY = Math.max(h * 3, 120);
    let row = 0;
    for (let cy = stepY / 2; cy < height; cy += stepY, row += 1) {
      for (let cx = row % 2 === 0 ? stepX / 2 : stepX; cx < width + stepX / 2; cx += stepX)
        draw(cx, cy);
    }
    return;
  }
  const { cx, cy } = anchorPoint(frame, position as Anchor, w, h, 36);
  draw(cx, cy);
}
