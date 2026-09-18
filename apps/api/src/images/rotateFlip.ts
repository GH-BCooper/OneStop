// Rotate Image (Features 6.23) and Flip Image (6.24).
//
// Right-angle turns and flips are lossless in pixels and keep animation; any other angle grows
// the canvas to fit and fills the corners with the chosen background (transparent → PNG for
// formats that can't hold alpha).
import type { Executor } from "@onestop/tool-registry";
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
  TRANSPARENT,
  type ImageInput,
} from "./common.ts";

export const ROTATE_TOOL_ID = "rotate-image";
export const FLIP_TOOL_ID = "flip-image";

const DIRECTIONS = ["horizontal", "vertical", "both"] as const;
export type FlipDirection = (typeof DIRECTIONS)[number];

/** Normalises any angle to (-180, 180]. */
export function normaliseAngle(angle: number): number {
  let a = angle % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

export async function rotateImage(
  image: ImageInput,
  angle: number,
  background = "transparent",
): Promise<{ bytes: Buffer; format: ReturnType<typeof sameFormat> }> {
  const a = normaliseAngle(angle);
  const right = a % 90 === 0;
  const bg = parseColor(background, TRANSPARENT);
  const format = sameFormat(image, { needsAlpha: !right && bg.alpha < 1 });
  const pipeline = open(image, { animated: right }).rotate(a, { background: bg });
  return { bytes: await encode(pipeline, format), format };
}

export async function flipImage(
  image: ImageInput,
  direction: FlipDirection,
): Promise<{ bytes: Buffer; format: ReturnType<typeof sameFormat> }> {
  let pipeline = open(image, { animated: true });
  if (direction !== "vertical") pipeline = pipeline.flop();
  if (direction !== "horizontal") pipeline = pipeline.flip();
  const format = sameFormat(image);
  return { bytes: await encode(pipeline, format), format };
}

export const rotateExecutor: Executor = eachImage(
  ROTATE_TOOL_ID,
  async (image, options) => {
    const preset = optString(options, "angle", "90");
    const angle =
      preset === "custom"
        ? optNumber(options, "customAngle", 0, { min: -360, max: 360 })
        : Number(preset) || 0;
    const { bytes, format } = await rotateImage(
      image,
      angle,
      optString(options, "background", "transparent"),
    );
    const a = normaliseAngle(angle);
    return {
      file: outFile(outputName(image, "rotated", format), format, bytes),
      note:
        a === 0
          ? "An angle of 0° leaves the image unchanged."
          : `Rotated ${Math.abs(a)}° ${a > 0 ? "clockwise" : "anticlockwise"}.`,
    };
  },
  { verb: "Rotated", zipStem: "rotated-images" },
);

export const flipExecutor: Executor = eachImage(
  FLIP_TOOL_ID,
  async (image, options) => {
    const direction = optEnum(options, "direction", DIRECTIONS, "horizontal");
    const { bytes, format } = await flipImage(image, direction);
    return {
      file: outFile(outputName(image, "flipped", format), format, bytes),
      note:
        direction === "both"
          ? "Flipped both ways."
          : `Mirrored ${direction === "horizontal" ? "left to right" : "top to bottom"}.`,
    };
  },
  { verb: "Flipped", zipStem: "flipped-images" },
);
