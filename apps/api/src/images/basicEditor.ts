// Basic Image Editor (Features 6.28): the everyday edits in one pass, applied in a fixed order —
// trim (crop) → rotate → flip → resize → colour → mark an area → caption.
//
// Every step is also its own tool; the editor reuses their building blocks, so a crop or a colour
// change here matches the dedicated tool exactly. Values are percentages of the image, so the
// same edit works on any resolution and can be repeated by a workflow (phase 15) or the assistant.
import type { Executor } from "@onestop/tool-registry";
import sharp from "sharp";
import {
  eachImage,
  encode,
  open,
  optEnum,
  optNumber,
  optString,
  outFile,
  outputName,
  parseColor,
  sameFormat,
  unsupported,
  type ImageInput,
} from "./common.ts";
import { applyColor, isNeutral, readColorOptions } from "./colorAdjust.ts";
import { checkBox } from "./crop.ts";
import { readTextOptions, textBlockFor } from "./textOverlay.ts";
import { renderTextLayer } from "./text.ts";

export const BASIC_EDITOR_TOOL_ID = "basic-image-editor";

const ROTATIONS = ["0", "90", "180", "270"] as const;
const FLIPS = ["none", "horizontal", "vertical", "both"] as const;
const SHAPES = ["none", "rectangle", "ellipse", "highlight", "blur", "pixelate"] as const;

export async function editImage(
  image: ImageInput,
  options: Record<string, unknown>,
): Promise<{ bytes: Buffer; steps: string[] }> {
  const steps: string[] = [];
  let p = open(image);
  let width = image.width;
  let height = image.height;

  // 1. Trim edges.
  const trim = (key: string) => optNumber(options, key, 0, { min: 0, max: 95 }) / 100;
  const [tl, tt, tr, tb] = [
    trim("trimLeft"),
    trim("trimTop"),
    trim("trimRight"),
    trim("trimBottom"),
  ];
  if (tl || tt || tr || tb) {
    if (tl + tr >= 1 || tt + tb >= 1)
      throw unsupported("The trims leave nothing of the image. Make them smaller.");
    const box = checkBox(
      { width, height },
      {
        left: Math.round(width * tl),
        top: Math.round(height * tt),
        width: Math.round(width * (1 - tl - tr)),
        height: Math.round(height * (1 - tt - tb)),
      },
    );
    p = p.extract(box);
    width = box.width;
    height = box.height;
    steps.push(`cropped to ${width} × ${height}`);
  }

  // 2–3. Rotate and flip (sharp applies rotate before flip/flop).
  const rotation = Number(optEnum(options, "rotate", ROTATIONS, "0"));
  if (rotation) {
    p = sharp(await p.png().toBuffer()).rotate(rotation);
    if (rotation !== 180) [width, height] = [height, width];
    steps.push(`rotated ${rotation}°`);
  }
  const flip = optEnum(options, "flip", FLIPS, "none");
  if (flip !== "none") {
    if (flip !== "vertical") p = p.flop();
    if (flip !== "horizontal") p = p.flip();
    steps.push(`flipped ${flip}`);
  }

  // 4. Resize (longest side).
  const longest = optNumber(options, "maxSide", 0, { min: 0, max: 10000 });
  if (longest > 0 && longest !== Math.max(width, height)) {
    const scale = longest / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    p = sharp(await p.png().toBuffer()).resize(width, height, { fit: "fill", kernel: "lanczos3" });
    steps.push(`resized to ${width} × ${height}`);
  }

  // 5. Colour.
  const colour = readColorOptions(options);
  if (!isNeutral(colour)) {
    p = applyColor(sharp(await p.png().toBuffer()), colour);
    steps.push("adjusted colours");
  }

  // 6. Mark an area (in % of the edited image).
  const shape = optEnum(options, "shape", SHAPES, "none");
  let base = await p.png().toBuffer();
  if (shape !== "none") {
    const pct = (key: string, fallback: number) =>
      optNumber(options, key, fallback, { min: 0, max: 100 }) / 100;
    const left = Math.round(width * pct("shapeLeft", 25));
    const top = Math.round(height * pct("shapeTop", 25));
    const w = Math.max(1, Math.min(width - left, Math.round(width * pct("shapeWidth", 50))));
    const h = Math.max(1, Math.min(height - top, Math.round(height * pct("shapeHeight", 50))));
    if (left >= width || top >= height)
      throw unsupported("The marked area starts outside the image.");
    const c = parseColor(optString(options, "shapeColor", "#e53935"), {
      r: 229,
      g: 57,
      b: 53,
      alpha: 1,
    });
    if (shape === "blur" || shape === "pixelate") {
      const region = sharp(base).extract({ left, top, width: w, height: h });
      const block = Math.max(2, Math.round(Math.max(w, h) / 12));
      const hidden =
        shape === "blur"
          ? await region
              .blur(Math.max(2, Math.max(w, h) / 10))
              .png()
              .toBuffer()
          : await sharp(
              await region
                .resize(Math.max(1, Math.round(w / block)), Math.max(1, Math.round(h / block)), {
                  fit: "fill",
                })
                .png()
                .toBuffer(),
            )
              .resize(w, h, { fit: "fill", kernel: "nearest" })
              .png()
              .toBuffer();
      base = await sharp(base)
        .composite([{ input: hidden, left, top }])
        .png()
        .toBuffer();
      steps.push(shape === "blur" ? "blurred an area" : "pixelated an area");
    } else {
      const stroke = Math.max(2, Math.round(Math.min(width, height) / 150));
      const rgb = `rgb(${c.r},${c.g},${c.b})`;
      const shapeSvg =
        shape === "highlight"
          ? `<rect x="${left}" y="${top}" width="${w}" height="${h}" fill="${rgb}" fill-opacity="0.35"/>`
          : shape === "rectangle"
            ? `<rect x="${left + stroke / 2}" y="${top + stroke / 2}" width="${Math.max(1, w - stroke)}" height="${Math.max(1, h - stroke)}" fill="none" stroke="${rgb}" stroke-opacity="${c.alpha}" stroke-width="${stroke}"/>`
            : `<ellipse cx="${left + w / 2}" cy="${top + h / 2}" rx="${Math.max(1, w / 2 - stroke / 2)}" ry="${Math.max(1, h / 2 - stroke / 2)}" fill="none" stroke="${rgb}" stroke-opacity="${c.alpha}" stroke-width="${stroke}"/>`;
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapeSvg}</svg>`,
      );
      base = await sharp(base)
        .composite([{ input: svg }])
        .png()
        .toBuffer();
      steps.push(`drew a ${shape}`);
    }
  }

  // 7. Caption.
  const caption = readTextOptions(options, "caption");
  let final = sharp(base);
  if (caption.text.trim() !== "") {
    const layer = await renderTextLayer(width, height, [textBlockFor({ width, height }, caption)]);
    final = final.composite([{ input: layer }]);
    steps.push("added a caption");
  }
  return { bytes: await encode(final, sameFormat(image), { quality: 92 }), steps };
}

export const basicEditorExecutor: Executor = eachImage(
  BASIC_EDITOR_TOOL_ID,
  async (image, options) => {
    const { bytes, steps } = await editImage(image, options);
    const format = sameFormat(image);
    const note = steps.length
      ? `${steps[0]![0]!.toUpperCase()}${steps.join(", ").slice(1)}.`
      : "No edits were chosen, so the image is unchanged.";
    return { file: outFile(outputName(image, "edited", format), format, bytes), note };
  },
  { verb: "Edited", zipStem: "edited-images", max: 1 },
);
