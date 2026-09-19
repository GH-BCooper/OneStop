// The local image-model runtime phase 09 left for this phase to provide (09-image-tools.md,
// "phase 16 must register a real ImageModelRuntime").
//
// It is deliberately a *client*, not a model: OneStop never bundles or downloads weights. Point
// `AI_IMAGE_URL` at a local Stable Diffusion server that speaks the widely-implemented
// AUTOMATIC1111 HTTP API (AUTOMATIC1111 WebUI, Forge, SD.Next all do) and this file uses it for
// generation, editing, background removal and the phase-09 model-capable tools. Nothing is
// configured by default: the image tools are hardware-gated and explicitly optional, exactly as
// the build file asks, and every one of them still has a working built-in method without this.
//
// Free and local, per CLAUDE.md §2: the server is the user's own, on their own machine, and no
// image leaves it.
import {
  setImageModelRuntime,
  type ImageModelParams,
  type ImageModelRuntime,
  type ImageModelTask,
} from "../images/model.ts";
import { AiError } from "./modelRuntime.ts";

export const IMAGE_RUNTIME_MESSAGE =
  "No local image model is configured. Set AI_IMAGE_URL to a local Stable Diffusion server (AUTOMATIC1111-compatible) to use the AI image tools — the built-in methods work without one.";

function env(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function imageRuntimeUrl(): string | null {
  const url = env("AI_IMAGE_URL");
  return url ? url.replace(/\/+$/, "") : null;
}

export function imageRuntimeModel(): string {
  return env("AI_IMAGE_MODEL") ?? "stable-diffusion";
}

type FetchLike = typeof globalThis.fetch;
let fetchImpl: FetchLike | null = null;

/** Replaces the runtime's `fetch` (tests only). Returns a restore function. */
export function setImageFetch(next: FetchLike | null): () => void {
  const previous = fetchImpl;
  fetchImpl = next;
  return () => {
    fetchImpl = previous;
  };
}

/** Generation is slow even on good hardware, so its budget is separate and generous. */
export const IMAGE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_IMAGE_TIMEOUT_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(1800, raw) * 1000 : 300_000;
})();

async function post(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const base = imageRuntimeUrl();
  if (!base) throw new AiError("AI_UNAVAILABLE", IMAGE_RUNTIME_MESSAGE);
  const impl = fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await impl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (response.status === 404) {
      throw new AiError(
        "AI_UNAVAILABLE",
        `The local image server at ${base} does not offer ${path}. Check it is a Stable Diffusion WebUI with the API enabled (--api).`,
      );
    }
    if (!response.ok) {
      throw new AiError(
        "AI_FAILED",
        `The local image model could not complete that (${response.status}).`,
        await response.text().catch(() => ""),
      );
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError(
      "AI_UNAVAILABLE",
      `The local image server at ${base} could not be reached. Start it, or clear AI_IMAGE_URL to use OneStop's built-in methods.`,
      err,
    );
  } finally {
    clearTimeout(timer);
  }
}

function firstImage(body: Record<string, unknown>): Buffer {
  const images = body.images ?? body.image;
  const encoded = Array.isArray(images) ? images[0] : images;
  if (typeof encoded !== "string" || encoded.trim() === "") {
    throw new AiError("AI_FAILED", "The local image model returned no image.");
  }
  return Buffer.from(encoded.replace(/^data:[^,]+,/, ""), "base64");
}

function allImages(body: Record<string, unknown>): Buffer[] {
  const images = body.images;
  if (!Array.isArray(images) || images.length === 0) return [firstImage(body)];
  return images
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => Buffer.from(v.replace(/^data:[^,]+,/, ""), "base64"));
}

export interface GenerateOptions {
  prompt: string;
  negativePrompt?: string;
  size?: number;
  count?: number;
  seed?: number;
  signal?: AbortSignal;
}

/** Text → image. Throws `AiError` with the "no local model" message when none is configured. */
export async function generateImages(options: GenerateOptions): Promise<Buffer[]> {
  const size = options.size ?? 512;
  const body = await post(
    "/sdapi/v1/txt2img",
    {
      prompt: options.prompt,
      negative_prompt: options.negativePrompt ?? "",
      width: size,
      height: size,
      batch_size: Math.min(4, Math.max(1, options.count ?? 1)),
      steps: 25,
      cfg_scale: 7,
      seed: options.seed && options.seed > 0 ? options.seed : -1,
    },
    options.signal,
  );
  return allImages(body);
}

export interface EditOptions {
  png: Buffer;
  prompt: string;
  /** 0–1: how far from the original the result may travel. */
  strength?: number;
  mask?: Buffer;
  seed?: number;
  signal?: AbortSignal;
}

/** Image + instruction → image. Used by the AI Image Editor and by `inpaint` below. */
export async function editImage(options: EditOptions): Promise<Buffer> {
  const body = await post(
    "/sdapi/v1/img2img",
    {
      prompt: options.prompt,
      init_images: [options.png.toString("base64")],
      ...(options.mask
        ? { mask: options.mask.toString("base64"), inpainting_fill: 1, inpaint_full_res: true }
        : {}),
      denoising_strength: Math.min(0.95, Math.max(0.05, options.strength ?? 0.55)),
      steps: 25,
      cfg_scale: 7,
      seed: options.seed && options.seed > 0 ? options.seed : -1,
    },
    options.signal,
  );
  return firstImage(body);
}

const SUPPORTED: ImageModelTask[] = [
  "remove-background",
  "inpaint",
  "upscale",
  "enhance",
  "sharpen",
  "denoise",
];

/**
 * The phase-09 contract, implemented against the same local server. Phase 09's tools ask for a
 * runtime through `chooseRuntime`; this is what they get when one is configured.
 */
export class LocalImageRuntime implements ImageModelRuntime {
  readonly name: string;

  constructor(url: string) {
    this.name = `local image model at ${url}`;
  }

  supports(task: ImageModelTask): boolean {
    return SUPPORTED.includes(task);
  }

  async run(task: ImageModelTask, png: Buffer, params: ImageModelParams): Promise<Buffer> {
    switch (task) {
      case "remove-background": {
        const body = await post(
          "/rembg",
          { input_image: png.toString("base64"), model: "u2net", return_mask: false },
          params.signal,
        );
        return firstImage(body);
      }
      case "inpaint":
        return editImage({
          png,
          prompt: "clean plausible background, seamless",
          strength: 0.9,
          ...(params.mask ? { mask: params.mask } : {}),
          ...(params.signal ? { signal: params.signal } : {}),
        });
      case "upscale": {
        const body = await post(
          "/sdapi/v1/extra-single-image",
          {
            image: png.toString("base64"),
            upscaling_resize: params.scale ?? 2,
            upscaler_1: "R-ESRGAN 4x+",
          },
          params.signal,
        );
        return firstImage(body);
      }
      default:
        // Enhance / sharpen / denoise: a light img2img pass keeps the composition.
        return editImage({
          png,
          prompt: "same photograph, cleaner, sharper, less noise, no other change",
          strength: Math.min(0.4, Math.max(0.1, params.strength ?? 0.25)),
          ...(params.signal ? { signal: params.signal } : {}),
        });
    }
  }
}

let registered: ImageModelRuntime | null = null;

/**
 * Registers the local runtime with phase 09 when `AI_IMAGE_URL` is set. Called once when the AI
 * module is imported; safe to call again (the Settings page does, after a change).
 */
export function registerImageRuntime(): ImageModelRuntime | null {
  const url = imageRuntimeUrl();
  const next = url ? new LocalImageRuntime(url) : null;
  if (next === null && registered === null) return null;
  setImageModelRuntime(next);
  registered = next;
  return next;
}

export function imageRuntimeConfigured(): boolean {
  return imageRuntimeUrl() !== null;
}
