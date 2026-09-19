// The AI image tools (Features §11.14–§11.16): Generator, Editor, Background/Object Removal
// (16-ai-assistant.md).
//
// These are the only tools in this phase that are *hardware-gated and explicitly experimental*.
// Generation and editing genuinely cannot be faked offline, so they say plainly what they need
// rather than pretending; removal does have a built-in method (phase 09's), so it always works
// and uses the model only when one is configured.
import { type Executor } from "@onestop/tool-registry";
import { bgRemovalSpec } from "../images/bgRemoval.ts";
import { objectRemovalSpec } from "../images/objectRemoval.ts";
import { aiExecutor } from "../images/aiTool.ts";
import { open, outFile, readImages } from "../images/common.ts";
import { optNumber, optString } from "../documents/common.ts";
import { aiUnsupported, runAi } from "./common.ts";
import { AiError } from "./modelRuntime.ts";
import {
  IMAGE_RUNTIME_MESSAGE,
  editImage,
  generateImages,
  imageRuntimeConfigured,
} from "./imageRuntime.ts";

export const AI_IMAGE_GENERATOR_TOOL_ID = "ai-image-generator";
export const AI_IMAGE_EDITOR_TOOL_ID = "ai-image-editor";
export const AI_BACKGROUND_OBJECT_REMOVAL_TOOL_ID = "ai-background-object-removal";

const SIZES = ["512", "768", "1024"];

function requireImageRuntime(): void {
  if (!imageRuntimeConfigured()) throw new AiError("AI_UNAVAILABLE", IMAGE_RUNTIME_MESSAGE);
}

// ---- AI Image Generator (§11.14) -----------------------------------------------------------------

export const aiImageGeneratorExecutor: Executor = async (input, options, ctx) =>
  runAi(AI_IMAGE_GENERATOR_TOOL_ID, async () => {
    const prompt = (
      optString(options, "prompt") || (typeof input === "string" ? input : "")
    ).trim();
    if (prompt === "") throw aiUnsupported("Describe the image you want first.");
    requireImageRuntime();

    const sizeOption = optString(options, "size", "512");
    const size = Number(SIZES.includes(sizeOption) ? sizeOption : "512");
    const count = optNumber(options, "count", 1, { min: 1, max: 4 });
    const seed = optNumber(options, "seed", 0, { min: 0, max: 2147483647 });

    const images = await generateImages({
      prompt,
      size,
      count,
      seed,
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
    });
    return {
      ok: true,
      output: { prompt, size, count: images.length },
      summary: `Generated ${images.length} image${images.length === 1 ? "" : "s"} at ${size} × ${size} on your local image model.`,
      files: images.map((bytes, i) =>
        outFile(images.length === 1 ? "generated.png" : `generated-${i + 1}.png`, "png", bytes),
      ),
    };
  });

// ---- AI Image Editor (§11.15) --------------------------------------------------------------------

export const aiImageEditorExecutor: Executor = async (input, options, ctx) =>
  runAi(AI_IMAGE_EDITOR_TOOL_ID, async () => {
    const prompt = optString(options, "prompt").trim();
    if (prompt === "") throw aiUnsupported("Describe the change you want first.");
    requireImageRuntime();
    if (!ctx) throw aiUnsupported("This tool could not read your image. Please try again.");

    const images = await readImages(input, ctx, { max: 8 });
    const strength = optNumber(options, "strength", 55, { min: 5, max: 95 }) / 100;
    const files = [];
    for (const image of images) {
      const png = await open(image).png().toBuffer();
      const edited = await editImage({
        png,
        prompt,
        strength,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      const stem = image.ref.name.replace(/\.[^.]+$/, "");
      files.push(outFile(`${stem}-edited.png`, "png", edited));
    }
    return {
      ok: true,
      output: { prompt, edited: files.length },
      summary: `Edited ${files.length} image${files.length === 1 ? "" : "s"} on your local image model.`,
      files,
    };
  });

// ---- AI Background / Object Removal (§11.16) ---------------------------------------------------------

/**
 * Delegates to phase 09's own specs, so the model path and the built-in path are literally the
 * same code the Background Removal and Object Removal tools use — one implementation, two doors.
 */
export const aiBackgroundObjectRemovalExecutor: Executor = async (input, options, ctx) => {
  const target = optString(options, "target", "background") === "object" ? "object" : "background";
  const spec = target === "object" ? objectRemovalSpec : bgRemovalSpec;
  return aiExecutor({
    ...spec,
    id: AI_BACKGROUND_OBJECT_REMOVAL_TOOL_ID,
    format: () => "png",
  })(input, options, ctx);
};
