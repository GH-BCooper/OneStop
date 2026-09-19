// Shared plumbing for the AI tools (16-ai-assistant.md).
//
// The pattern mirrors phase 09's model-capable image tools, because the trade-off is the same:
// every tool has a `method` of "auto" | "ai" | "builtin", every tool that *can* work without a
// model does, and "ai" is the only setting that ever fails for want of a runtime. That is how the
// acceptance criterion "the app remains 100% functional with no external AI API configured" is
// kept honest — the AI tools are not a separate app that needs a server, they are the same tools
// with a better engine when one is available.
import type { ExecErrorCode, ExecResult, OutputFile } from "@onestop/types";
import { PdfToolError } from "../pdf/errors.ts";
import { AiError, chat, type ChatMessage, type ChatOptions } from "./modelRuntime.ts";
import { isAiProviderId, type AiCredentials } from "./providers.ts";

export const METHODS = ["auto", "ai", "builtin"] as const;
export type Method = (typeof METHODS)[number];

/** Appended whenever a result came from the offline engine while "auto" was selected. */
export const BUILTIN_NOTE =
  "Produced with OneStop's built-in offline method. Set up Ollama, or add a free API key in Settings, for a better result.";

/**
 * Pulls the runtime choice out of the option values.
 *
 * `aiProvider` and `aiKey` are `client` options: the browser fills them from Settings, they ride
 * along with the request, and they are redacted before the job is recorded. They are untrusted
 * input like any other option — the provider is checked against the known list and the key is
 * only ever used as a bearer token for the provider it was sent for.
 */
export function credentialsFrom(options: Record<string, unknown>): AiCredentials {
  const provider = options.aiProvider;
  const apiKey = options.aiKey;
  return {
    provider: isAiProviderId(provider) ? provider : null,
    apiKey: typeof apiKey === "string" && apiKey.trim() !== "" ? apiKey.trim() : null,
  };
}

/** Maps an AI failure onto the pipeline's error contract. Never leaks a provider body. */
export function aiErrorResult(err: AiError): ExecResult {
  const code: ExecErrorCode =
    err.code === "AI_UNAVAILABLE"
      ? "OFFLINE"
      : err.code === "AI_AUTH"
        ? "UNSUPPORTED_INPUT"
        : "FAILED";
  if (err.detail !== undefined) console.error(`[ai] ${err.code}`, err.message, err.detail);
  return { ok: false, code, message: err.message };
}

/** The AI-tool twin of `runDocTool`: one place where every throw becomes a user-facing result. */
export async function runAi(toolId: string, body: () => Promise<ExecResult>): Promise<ExecResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof AiError) return aiErrorResult(err);
    if (err instanceof PdfToolError) {
      if (err.detail !== undefined) console.error(`[ai:${toolId}]`, err.message, err.detail);
      return { ok: false, code: err.code as ExecErrorCode, message: err.message };
    }
    console.error(`[ai:${toolId}] unexpected failure`, err);
    return { ok: false, code: "FAILED", message: "That could not be completed. Please try again." };
  }
}

export function aiUnsupported(message: string, detail?: unknown): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", message, detail);
}

export const AI_REQUIRED_MESSAGE =
  "This needs an AI runtime. Install Ollama for fully offline AI, or add a free API key in Settings — then try again.";

/** One model call, with the method rules applied. Returns null when the built-in path should run. */
export async function complete(
  messages: ChatMessage[],
  method: Method,
  options: Record<string, unknown>,
  chatOptions: ChatOptions = {},
): Promise<{ text: string; runtime: string; local: boolean } | null> {
  if (method === "builtin") return null;
  try {
    const { text, config } = await chat(messages, chatOptions, credentialsFrom(options));
    return { text, runtime: `${config.info.label} (${config.model})`, local: config.info.local };
  } catch (err) {
    if (err instanceof AiError && err.code === "AI_UNAVAILABLE" && method === "auto") return null;
    throw err;
  }
}

/** The same call for a tool with no offline fallback: "ai" and "auto" both need a runtime. */
export async function requireComplete(
  messages: ChatMessage[],
  options: Record<string, unknown>,
  chatOptions: ChatOptions = {},
): Promise<{ text: string; runtime: string; local: boolean }> {
  try {
    const { text, config } = await chat(messages, chatOptions, credentialsFrom(options));
    return { text, runtime: `${config.info.label} (${config.model})`, local: config.info.local };
  } catch (err) {
    if (err instanceof AiError && err.code === "AI_UNAVAILABLE") {
      throw new AiError("AI_UNAVAILABLE", AI_REQUIRED_MESSAGE, err.detail);
    }
    throw err;
  }
}

export function methodOf(options: Record<string, unknown>): Method {
  const value = options.method;
  return typeof value === "string" && (METHODS as readonly string[]).includes(value)
    ? (value as Method)
    : "auto";
}

/** Strips the code fence and any "Here is…" preamble models like to add around an answer. */
export function cleanAnswer(text: string): string {
  return text
    .replace(/^\s*```[a-z]*\n?/i, "")
    .replace(/```\s*$/, "")
    .replace(/^\s*(?:sure|certainly|here(?:'s| is)[^\n:]*):?\s*\n+/i, "")
    .trim();
}

export function textOutput(name: string, text: string): OutputFile {
  return {
    name,
    mimeType: "text/plain; charset=utf-8",
    bytes: new TextEncoder().encode(text.endsWith("\n") ? text : `${text}\n`),
  };
}

export function jsonOutput(name: string, value: unknown): OutputFile {
  return {
    name,
    mimeType: "application/json",
    bytes: new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`),
  };
}

/** Caps how much document text one model call may carry, so a huge file cannot stall a runtime. */
export const MAX_PROMPT_CHARS = 24_000;

export function clip(text: string, max = MAX_PROMPT_CHARS): { text: string; clipped: boolean } {
  return text.length <= max
    ? { text, clipped: false }
    : { text: `${text.slice(0, max)}\n…[truncated]`, clipped: true };
}
