// Vision-model support (21-roadmap-expansion.md, roadmap §3.4 and §1.7's Alt-Text Generator).
//
// Ollama already serves small vision models — `llava`, `moondream`, `llama3.2-vision` — and its chat
// API takes images as base64 alongside the prompt. That makes "what is in this picture?" one more
// model name in the runtime the app already has, not a new provider integration, and it keeps the
// image on this machine: nothing here can talk to a hosted service.
//
// It is deliberately Ollama-only. A hosted vision API would mean uploading the visitor's photo to a
// third party, which is exactly the trade `CLAUDE.md` §2.1 says must never happen silently.
import type { ImageInput } from "../images/common.ts";
import { encode, open } from "../images/common.ts";
import { AiError } from "./modelRuntime.ts";
import { ollamaHost } from "./providers.ts";

export const VISION_MISSING_MESSAGE =
  "Describing an image needs a local vision model. Install Ollama and pull one (`ollama pull llava` or `ollama pull moondream`), set OLLAMA_VISION_MODEL if it is named something else, then try again.";

/** The model used for image questions. Configurable, because the good small ones keep changing. */
export function visionModel(): string {
  return (process.env.OLLAMA_VISION_MODEL ?? "llava").trim() || "llava";
}

export function visionConfigured(): boolean {
  // Ollama always has a host (it defaults to localhost), so "configured" means it has not been
  // explicitly disabled. Whether the model is actually pulled shows up as a clear error below.
  return process.env.ONESTOP_DISABLE_VISION !== "1" && ollamaHost() !== "";
}

const VISION_TIMEOUT_MS = Number(process.env.OLLAMA_VISION_TIMEOUT_MS ?? 120_000);

export interface DescribeOptions {
  /** Cap on the answer's length, in characters. */
  maxLength?: number;
  purpose?: "informative" | "decorative" | "complex" | "functional";
  /** A question of the visitor's own, instead of the alt-text prompt. */
  question?: string;
  signal?: AbortSignal;
}

const PURPOSE_PROMPT: Record<NonNullable<DescribeOptions["purpose"]>, string> = {
  informative:
    "Write alternative text for this image for a screen-reader user. State what it shows, plainly, in one sentence. Do not begin with 'image of' or 'picture of'. Do not describe the style or how it makes you feel. If there is text in the image, quote it.",
  complex:
    "Describe this image for someone who cannot see it. It is a chart, diagram or map, so give the overall shape first and then the specific values or labels that carry the meaning. Two or three sentences.",
  functional:
    "This image is a button, icon or link. Write alternative text that says what it *does*, not what it looks like, in a few words.",
  decorative: "Say only: decorative.",
};

/** Sends one image to the local vision model and returns its answer. */
export async function describeImage(
  image: ImageInput,
  { maxLength = 125, purpose = "informative", question, signal }: DescribeOptions = {},
): Promise<{ text: string; runtime: string }> {
  if (!visionConfigured()) throw new AiError("AI_UNAVAILABLE", VISION_MISSING_MESSAGE);
  const model = visionModel();
  // Vision models work at a few hundred pixels; sending a 20-megapixel photo just wastes time and
  // memory on both sides, so it is downscaled and re-encoded as JPEG first.
  const jpeg = await encode(open(image).resize(896, 896, { fit: "inside", withoutEnlargement: true }), "jpg", { quality: 82 });

  const prompt = question?.trim() || `${PURPOSE_PROMPT[purpose]} Keep it under ${maxLength} characters.`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  timer.unref?.();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(`${ollamaHost()}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0.2 },
        messages: [{ role: "user", content: prompt, images: [Buffer.from(jpeg).toString("base64")] }],
      }),
    });
    if (response.status === 404) {
      throw new AiError(
        "AI_UNAVAILABLE",
        `Ollama is running but does not have the "${model}" model. Run \`ollama pull ${model}\`, then try again.`,
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AiError("AI_FAILED", `The local vision model returned an error (HTTP ${response.status}).`, body.slice(0, 500));
    }
    const body = (await response.json()) as { message?: { content?: string } };
    const text = (body.message?.content ?? "").trim();
    if (text === "") throw new AiError("AI_FAILED", "The local vision model returned an empty answer.");
    return { text, runtime: `Ollama (${model}, running locally)` };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (controller.signal.aborted && !signal?.aborted) {
      throw new AiError("AI_TIMEOUT", "The local vision model did not answer in time. Try a smaller model, or a smaller image.");
    }
    throw new AiError("AI_UNAVAILABLE", VISION_MISSING_MESSAGE, err);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
