// Image tools (09-image-tools.md).
//
// Importing this module registers every executor with the tool registry, following the phase-04
// pattern: the registry never imports these files, they register themselves. PDF → Image (Features
// 6.2) is phase 05's `pdf-to-images` executor; it is not re-registered here.
import { registerExecutor } from "@onestop/tool-registry";

import { basicEditorExecutor } from "./basicEditor.ts";
import { bgRemovalExecutor } from "./bgRemoval.ts";
import { blurExecutor } from "./blur.ts";
import { colorAdjustExecutor } from "./colorAdjust.ts";
import { compressExecutor } from "./compress.ts";
import {
  formatConverterExecutor,
  imageToGifExecutor,
  imageToPdfExecutor,
  jpgPngExecutor,
  jpgWebpExecutor,
  pngWebpExecutor,
} from "./convert.ts";
import { cropExecutor } from "./crop.ts";
import { denoiseExecutor, enhanceExecutor, sharpenExecutor } from "./enhance.ts";
import { fitCircleExecutor, fitSquareExecutor } from "./fitShape.ts";
import { memeExecutor } from "./meme.ts";
import { metadataRemoverExecutor, metadataViewerExecutor } from "./metadata.ts";
import { objectRemovalExecutor } from "./objectRemoval.ts";
import { resizeExecutor } from "./resize.ts";
import { flipExecutor, rotateExecutor } from "./rotateFlip.ts";
import { addTextExecutor } from "./textOverlay.ts";
import { upscaleExecutor } from "./upscale.ts";
import { watermarkExecutor } from "./watermark.ts";

export { convertImage, imagesToGif, imagesToPdf } from "./convert.ts";
export { resizeImage, resizeTarget } from "./resize.ts";
export { cropImage } from "./crop.ts";
export { compressImage } from "./compress.ts";
export { rotateImage, flipImage } from "./rotateFlip.ts";
export { fitToSquare, cutCircle, FIT_MODES } from "./fitShape.ts";
export { readImageMetadata, removeImageMetadata } from "./metadata.ts";
export { removePlainBackground } from "./bgRemoval.ts";
export { inpaint } from "./objectRemoval.ts";
export { toImageInput, sniffFormat } from "./common.ts";
export type { ImageInput, ImageFormat as ImageOutputFormat } from "./common.ts";
export {
  getImageModelRuntime,
  MODEL_REQUIRED_MESSAGE,
  setImageModelRuntime,
  type ImageModelParams,
  type ImageModelRuntime,
  type ImageModelTask,
} from "./model.ts";

/** Every tool this phase owns, in the order the Features list gives them. */
export const IMAGE_EXECUTORS = [
  ["image-to-pdf", imageToPdfExecutor],
  ["image-resizer", resizeExecutor],
  ["image-cropper", cropExecutor],
  ["image-compressor", compressExecutor],
  ["image-format-converter", formatConverterExecutor],
  ["jpg-png-converter", jpgPngExecutor],
  ["jpg-webp-converter", jpgWebpExecutor],
  ["png-webp-converter", pngWebpExecutor],
  ["image-to-gif", imageToGifExecutor],
  ["background-blur", blurExecutor],
  ["background-removal", bgRemovalExecutor],
  ["object-removal", objectRemovalExecutor],
  ["image-upscaler", upscaleExecutor],
  ["image-enhancer", enhanceExecutor],
  ["image-sharpening", sharpenExecutor],
  ["image-denoiser", denoiseExecutor],
  ["image-watermark", watermarkExecutor],
  ["add-text-to-image", addTextExecutor],
  ["image-metadata-viewer", metadataViewerExecutor],
  ["remove-image-metadata", metadataRemoverExecutor],
  ["image-color-adjustment", colorAdjustExecutor],
  ["rotate-image", rotateExecutor],
  ["flip-image", flipExecutor],
  ["fit-image-to-square", fitSquareExecutor],
  ["fit-image-to-circle", fitCircleExecutor],
  ["meme-generator", memeExecutor],
  ["basic-image-editor", basicEditorExecutor],
] as const;

for (const [id, executor] of IMAGE_EXECUTORS) registerExecutor(id, executor);
