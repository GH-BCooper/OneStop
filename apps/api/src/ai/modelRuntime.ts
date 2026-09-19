// The model runtime: one `chat()` call over four free providers (16-ai-assistant.md).
//
// Everything above this file — intent detection, the planner, the RAG answerer, the AI tools —
// speaks only in `ChatMessage[]` and never knows which runtime answered. That is what makes the
// acceptance criterion "the app remains 100% functional with no external AI API configured" a
// property of the code rather than a promise: with nothing configured, `chat()` throws one
// specific, catchable error and every caller has a non-AI fallback behind it.
//
// Failure modes are deliberately distinct, because the user can act on each one differently:
//   AI_UNAVAILABLE  nothing is configured, or the local server is not running
//   AI_RATE_LIMIT   a free tier said "too many requests" — expected, recoverable, never a crash
//   AI_AUTH         the key was rejected
//   AI_TIMEOUT      the model took too long
//   AI_FAILED       anything else
import type { AiProviderId, AiStatus } from "@onestop/types";
import {
  AI_PROVIDERS,
  availableConfigs,
  configFor,
  isAiProviderId,
  type AiCredentials,
  type AiRuntimeConfig,
} from "./providers.ts";

export type AiErrorCode =
  "AI_UNAVAILABLE" | "AI_RATE_LIMIT" | "AI_AUTH" | "AI_TIMEOUT" | "AI_FAILED";

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export const NO_RUNTIME_MESSAGE =
  "No AI runtime is available. Install Ollama and run `ollama serve` for fully offline AI, or add a free API key in Settings.";

export function rateLimitMessage(provider: string, retryAfterSeconds?: number): string {
  const seconds = retryAfterSeconds && retryAfterSeconds > 0 ? Math.ceil(retryAfterSeconds) : 0;
  const wait =
    seconds > 0
      ? ` Try again in about ${Math.min(600, seconds)} second${seconds === 1 ? "" : "s"}.`
      : " Try again in a moment.";
  return `${provider}'s free tier rate limit was reached.${wait}`;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for JSON. The caller still parses defensively. */
  json?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Default budget for one model call. Long enough for a slow local model, short enough to fail. */
export const DEFAULT_AI_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_TIMEOUT_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(600, raw) * 1000 : 120_000;
})();

// `fetch` is injected in tests so nothing here ever touches a real network.
type FetchLike = typeof globalThis.fetch;
let fetchImpl: FetchLike | null = null;

/** Replaces the runtime's `fetch` (tests only). Returns a restore function. */
export function setAiFetch(next: FetchLike | null): () => void {
  const previous = fetchImpl;
  fetchImpl = next;
  return () => {
    fetchImpl = previous;
  };
}

function doFetch(url: string, init: RequestInit): Promise<Response> {
  const impl = fetchImpl ?? globalThis.fetch;
  if (typeof impl !== "function") {
    throw new AiError("AI_UNAVAILABLE", NO_RUNTIME_MESSAGE);
  }
  return impl(url, init);
}

function retryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds;
  }
  const reset = response.headers.get("x-ratelimit-reset-requests");
  if (reset) {
    const seconds = Number(String(reset).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return undefined;
}

/** Turns any non-2xx answer into the right `AiError`. Never leaks a provider body to the user. */
async function httpError(config: AiRuntimeConfig, response: Response): Promise<AiError> {
  const label = config.info.label;
  let body = "";
  try {
    body = (await response.text()).slice(0, 500);
  } catch {
    // The body is a nicety for the server log, never required.
  }
  if (response.status === 429) {
    return new AiError("AI_RATE_LIMIT", rateLimitMessage(label, retryAfter(response)), body);
  }
  if (response.status === 401 || response.status === 403) {
    return new AiError(
      "AI_AUTH",
      `${label} rejected the API key. Check the key you entered in Settings.`,
      body,
    );
  }
  if (response.status === 404 && config.provider === "ollama") {
    return new AiError(
      "AI_UNAVAILABLE",
      `Ollama does not have the model "${config.model}". Run "ollama pull ${config.model}" and try again.`,
      body,
    );
  }
  if (response.status >= 500) {
    return new AiError(
      "AI_FAILED",
      `${label} is having trouble right now. Try again shortly.`,
      body,
    );
  }
  return new AiError("AI_FAILED", `${label} could not complete that request.`, body);
}

function linkAbort(options: ChatOptions): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new AiError("AI_TIMEOUT", "timeout")),
    options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
  );
  const outer = options.signal;
  const forward = () => controller.abort(outer?.reason);
  outer?.addEventListener("abort", forward, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timeout);
      outer?.removeEventListener("abort", forward);
    },
  };
}

interface ProviderCall {
  url: string;
  init: RequestInit;
  read: (body: unknown) => string;
}

function openAiShape(
  config: AiRuntimeConfig,
  url: string,
  messages: ChatMessage[],
  options: ChatOptions,
  extraHeaders: Record<string, string> = {},
): ProviderCall {
  return {
    url,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey ?? ""}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? 0,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
    },
    read: (body) => {
      const choice = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0];
      return typeof choice?.message?.content === "string" ? choice.message.content : "";
    },
  };
}

function buildCall(
  config: AiRuntimeConfig,
  messages: ChatMessage[],
  options: ChatOptions,
): ProviderCall {
  switch (config.provider) {
    case "ollama":
      return {
        url: `${config.host}/api/chat`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            messages,
            stream: false,
            ...(options.json ? { format: "json" } : {}),
            options: {
              temperature: options.temperature ?? 0,
              ...(options.maxTokens ? { num_predict: options.maxTokens } : {}),
            },
          }),
        },
        read: (body) => {
          const message = (body as { message?: { content?: unknown } })?.message;
          return typeof message?.content === "string" ? message.content : "";
        },
      };
    case "groq":
      return openAiShape(
        config,
        "https://api.groq.com/openai/v1/chat/completions",
        messages,
        options,
      );
    case "openrouter":
      return openAiShape(
        config,
        "https://openrouter.ai/api/v1/chat/completions",
        messages,
        options,
        { "x-title": "OneStop" },
      );
    case "google": {
      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
      const rest = messages.filter((m) => m.role !== "system");
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey ?? "" },
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents: rest.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            generationConfig: {
              temperature: options.temperature ?? 0,
              ...(options.maxTokens ? { maxOutputTokens: options.maxTokens } : {}),
              ...(options.json ? { responseMimeType: "application/json" } : {}),
            },
          }),
        },
        read: (body) => {
          const parts = (body as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] })
            ?.candidates?.[0]?.content?.parts;
          return (parts ?? [])
            .map((p) => (typeof p.text === "string" ? p.text : ""))
            .join("")
            .trim();
        },
      };
    }
  }
}

/** One completion from one specific runtime. Throws `AiError` and nothing else. */
export async function chatWith(
  config: AiRuntimeConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const call = buildCall(config, messages, options);
  const { signal, done } = linkAbort(options);
  let response: Response;
  try {
    response = await doFetch(call.url, { ...call.init, signal });
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (signal.aborted && signal.reason instanceof AiError) {
      throw new AiError(
        "AI_TIMEOUT",
        `${config.info.label} did not answer in time. Try a shorter request, or a smaller model.`,
        err,
      );
    }
    if (options.signal?.aborted) throw new AiError("AI_FAILED", "The request was cancelled.", err);
    throw new AiError(
      "AI_UNAVAILABLE",
      config.provider === "ollama"
        ? `Ollama is not reachable at ${config.host}. Start it with "ollama serve", or pick a different runtime in Settings.`
        : `${config.info.label} could not be reached. Check your internet connection.`,
      err,
    );
  } finally {
    done();
  }

  if (!response.ok) throw await httpError(config, response);

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new AiError("AI_FAILED", `${config.info.label} returned an unreadable answer.`, err);
  }
  const text = call.read(body).trim();
  if (text === "") {
    throw new AiError("AI_FAILED", `${config.info.label} returned an empty answer.`, body);
  }
  return text;
}

/**
 * One completion from the best runtime available to this caller.
 *
 * A provider that is simply not there (`AI_UNAVAILABLE`) makes it try the next one — that is how
 * "Ollama is the default, but a configured free key still works when Ollama is not running"
 * behaves without the user having to think about it. A rate limit or a bad key is *not* retried
 * on another provider: those are answers the user has to see.
 */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
  credentials: AiCredentials = {},
): Promise<{ text: string; config: AiRuntimeConfig }> {
  const configs = availableConfigs(credentials);
  if (configs.length === 0) throw new AiError("AI_UNAVAILABLE", NO_RUNTIME_MESSAGE);
  let last: AiError | null = null;
  for (const config of configs) {
    try {
      return { text: await chatWith(config, messages, options), config };
    } catch (err) {
      const error = err instanceof AiError ? err : new AiError("AI_FAILED", String(err), err);
      if (error.code !== "AI_UNAVAILABLE") throw error;
      last = error;
    }
  }
  throw last ?? new AiError("AI_UNAVAILABLE", NO_RUNTIME_MESSAGE);
}

// ---- status ------------------------------------------------------------------------------------

interface Probe {
  at: number;
  ok: boolean;
  models: string[];
}

const PROBE_TTL_MS = 30_000;
const probes = new Map<string, Probe>();

/** Clears the liveness cache (tests, and the Settings page after a change). */
export function resetAiProbes(): void {
  probes.clear();
}

/** Is the local Ollama server answering? Cached briefly so a page load is not a port scan. */
export async function probeOllama(host: string, signal?: AbortSignal): Promise<Probe> {
  const cached = probes.get(host);
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  let probe: Probe = { at: Date.now(), ok: false, models: [] };
  try {
    const response = await doFetch(`${host}/api/tags`, { signal: controller.signal });
    if (response.ok) {
      const body = (await response.json()) as { models?: { name?: unknown }[] };
      probe = {
        at: Date.now(),
        ok: true,
        models: (body.models ?? [])
          .map((m) => (typeof m.name === "string" ? m.name : ""))
          .filter(Boolean),
      };
    }
  } catch {
    // Not running is an ordinary state, not an error worth logging on every page load.
  } finally {
    clearTimeout(timer);
  }
  probes.set(host, probe);
  return probe;
}

/**
 * What the UI shows: which runtime would answer right now, and the disclosure that goes with it.
 * Never throws — "nothing is available" is a normal answer with a plain-words `message`.
 */
export async function getAiStatus(
  credentials: AiCredentials = {},
  signal?: AbortSignal,
): Promise<AiStatus> {
  const preferred = isAiProviderId(credentials.provider) ? credentials.provider : null;
  const configs = availableConfigs(credentials);
  const base = { configured: configs.map((c) => c.provider), preferred };

  for (const config of configs) {
    if (config.provider === "ollama") {
      const probe = await probeOllama(config.host, signal);
      if (!probe.ok) continue;
      const hasModel =
        probe.models.length === 0 ||
        probe.models.some((m) => m === config.model || m.split(":")[0] === config.model);
      return {
        ...base,
        available: true,
        provider: "ollama",
        providerLabel: AI_PROVIDERS.ollama.label,
        model: config.model,
        local: true,
        disclosure: AI_PROVIDERS.ollama.disclosure,
        message: hasModel
          ? `Ollama is running at ${config.host} with ${config.model}.`
          : `Ollama is running at ${config.host}, but the model "${config.model}" is not pulled yet. Run "ollama pull ${config.model}".`,
      };
    }
    return {
      ...base,
      available: true,
      provider: config.provider,
      providerLabel: config.info.label,
      model: config.model,
      local: false,
      disclosure: config.info.disclosure,
      message: `${config.info.label} is ready with ${config.model}.`,
    };
  }

  return {
    ...base,
    available: false,
    provider: null,
    providerLabel: null,
    model: null,
    local: true,
    disclosure: AI_PROVIDERS.ollama.disclosure,
    message: NO_RUNTIME_MESSAGE,
  };
}

/** Provider ids the Settings page offers. */
export function listAiProviders(): AiProviderId[] {
  return Object.keys(AI_PROVIDERS) as AiProviderId[];
}

export { configFor };
