// The local image-model interface (09-image-tools.md, "AI-based tools").
//
// Background Removal, Object Removal, Upscaler, Enhancer, Sharpening and Denoiser can use a local
// AI model. Phase 16 (16-ai-assistant.md) owns the model runtime and its Settings screen; this
// phase only defines the contract and ships every tool with a built-in, non-AI method, so nothing
// here is blocked on it:
//
//   method "auto"    – the model when one is configured, otherwise the built-in method (and says so)
//   method "ai"      – the model only; without one, the specific "needs a local AI model" message
//   method "builtin" – never touches a model
//
// A runtime is always local and user-configured (CLAUDE.md §2, §8). Images never leave this
// process through this interface unless the runtime phase 16 registers chooses to, and that
// runtime must disclose it in the UI.
import sharp from "sharp";
import { PdfToolError } from "../pdf/errors.ts";
import { MAX_OUTPUT_PIXELS } from "./common.ts";

export type ImageModelTask =
  "remove-background" | "inpaint" | "upscale" | "enhance" | "sharpen" | "denoise";

export interface ImageModelParams {
  /** "inpaint": a PNG the size of the image; white marks the pixels to fill in. */
  mask?: Buffer;
  /** "upscale": 2, 3 or 4. */
  scale?: number;
  /** "enhance" / "sharpen" / "denoise": 0–1. */
  strength?: number;
  signal?: AbortSignal;
}

/**
 * What phase 16 implements. `run` takes and returns PNG bytes. For "remove-background" the result
 * must be the image with a transparent background; for "upscale" it must be `scale`× larger; for
 * everything else it must be the same size as the input.
 */
export interface ImageModelRuntime {
  /** Shown to the user, e.g. "rembg (u2net) via Ollama". */
  readonly name: string;
  supports(task: ImageModelTask): boolean;
  run(task: ImageModelTask, png: Buffer, params: ImageModelParams): Promise<Buffer>;
}

let runtime: ImageModelRuntime | null = null;

/** Registers (or, with null, removes) the local model runtime. Returns the previous one. */
export function setImageModelRuntime(next: ImageModelRuntime | null): ImageModelRuntime | null {
  const previous = runtime;
  runtime = next;
  return previous;
}

export function getImageModelRuntime(): ImageModelRuntime | null {
  return runtime;
}

export const MODEL_REQUIRED_MESSAGE =
  "This feature needs a local AI model. Enable one in Settings.";

export function modelRequiredError(): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", MODEL_REQUIRED_MESSAGE);
}

export const METHODS = ["auto", "ai", "builtin"] as const;
export type Method = (typeof METHODS)[number];

/**
 * Picks the runtime for a task, or null for the built-in method. Throws the "needs a local AI
 * model" error when the user asked for AI and none (or none supporting the task) is configured.
 */
export function chooseRuntime(method: Method, task: ImageModelTask): ImageModelRuntime | null {
  if (method === "builtin") return null;
  const current = runtime && runtime.supports(task) ? runtime : null;
  if (!current && method === "ai") throw modelRequiredError();
  return current;
}

/** Runs a model and checks its answer is a real image of a sane size — never a fake success. */
export async function runModel(
  current: ImageModelRuntime,
  task: ImageModelTask,
  png: Buffer,
  params: ImageModelParams,
): Promise<Buffer> {
  let out: Buffer;
  try {
    out = await current.run(task, png, params);
  } catch (err) {
    throw new PdfToolError(
      "FAILED",
      `The local AI model (${current.name}) could not process this image. Check it is running in Settings, or choose the built-in method.`,
      err,
    );
  }
  try {
    const meta = await sharp(out).metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > MAX_OUTPUT_PIXELS)
      throw new Error("bad size");
  } catch (err) {
    throw new PdfToolError(
      "FAILED",
      `The local AI model (${current.name}) returned something that isn't a usable image. Try again or choose the built-in method.`,
      err,
    );
  }
  return out;
}

/** The summary note when "auto" fell back to the built-in method. */
export const BUILTIN_FALLBACK_NOTE =
  "Used OneStop's built-in method — enable a local AI model in Settings for better results.";
