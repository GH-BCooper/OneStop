// The shared executor shape of the six model-capable tools (see model.ts for the method rules).
import type { Executor } from "@onestop/tool-registry";
import sharp from "sharp";
import {
  eachImage,
  encode,
  open,
  optEnum,
  outFile,
  outputName,
  sameFormat,
  type ImageFormat,
  type ImageInput,
} from "./common.ts";
import {
  BUILTIN_FALLBACK_NOTE,
  chooseRuntime,
  METHODS,
  runModel,
  type ImageModelParams,
  type ImageModelTask,
} from "./model.ts";

export interface AiToolSpec {
  id: string;
  task: ImageModelTask;
  verb: string;
  suffix: string;
  /** Model parameters from the options (and the image, e.g. an inpainting mask). */
  params: (
    image: ImageInput,
    options: Record<string, unknown>,
  ) => Promise<ImageModelParams> | ImageModelParams;
  /** The built-in method. Returns PNG or encoded bytes plus an optional note. */
  builtin: (
    image: ImageInput,
    options: Record<string, unknown>,
    params: ImageModelParams,
  ) => Promise<{ bytes: Buffer; note?: string }>;
  /** Output format; defaults to the input's format. */
  format?: (image: ImageInput) => ImageFormat;
  /** A sentence about a successful result, e.g. the new size. */
  describe?: (bytes: Buffer, image: ImageInput) => Promise<string | undefined>;
}

/** Applies one tool to one image — model or built-in — and encodes the result. */
export async function runAiTool(
  spec: AiToolSpec,
  image: ImageInput,
  options: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; format: ImageFormat; usedModel: string | null; note?: string }> {
  const method = optEnum(options, "method", METHODS, "auto");
  const runtime = chooseRuntime(method, spec.task);
  const params = { ...(await spec.params(image, options)), ...(signal ? { signal } : {}) };
  const format = spec.format ? spec.format(image) : sameFormat(image);
  if (runtime) {
    const png = await open(image).png().toBuffer();
    const result = await runModel(runtime, spec.task, png, params);
    return {
      bytes: await encode(sharp(result), format, { quality: 92 }),
      format,
      usedModel: runtime.name,
    };
  }
  const { bytes, note } = await spec.builtin(image, options, params);
  const encoded = await encode(sharp(bytes), format, { quality: 92 });
  const notes = [note, method === "auto" ? BUILTIN_FALLBACK_NOTE : undefined]
    .filter(Boolean)
    .join(" ");
  return { bytes: encoded, format, usedModel: null, ...(notes ? { note: notes } : {}) };
}

export function aiExecutor(spec: AiToolSpec): Executor {
  return eachImage(
    spec.id,
    async (image, options, ctx) => {
      const { bytes, format, usedModel, note } = await runAiTool(spec, image, options, ctx.signal);
      const described = spec.describe ? await spec.describe(bytes, image) : undefined;
      const notes = [described, usedModel ? `Processed with ${usedModel}.` : note]
        .filter(Boolean)
        .join(" ");
      return {
        file: outFile(outputName(image, spec.suffix, format), format, bytes),
        ...(notes ? { note: notes } : {}),
      };
    },
    { verb: spec.verb, zipStem: `${spec.suffix}-images` },
  );
}
