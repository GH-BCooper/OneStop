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
import type { AiProviderCheck, AiProviderId, AiStatus } from "@onestop/types";
import {
  AI_PROVIDERS,
  HOSTED_ORDER,
  availableConfigs,
  configFor,
  isAiProviderId,
  type AiCredentials,
  type AiRuntimeConfig,
} from "./providers.ts";

export type AiErrorCode =
  "AI_UNAVAILABLE" | "AI_RATE_LIMIT" | "AI_AUTH" | "AI_TIMEOUT" | "AI_MODEL" | "AI_FAILED";

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

/** What the assistant says when it cannot answer at all - short, and points at the one place to fix it. */
export const OUT_OF_SERVICE_MESSAGE =
  "AI assistant is out of service right now. Check your app settings for issue remediation.";

/** Every runtime that could answer has used up its free allowance. */
export function outOfCreditsMessage(configs: AiRuntimeConfig[]): string {
  const urls = [
    ...new Set(configs.map((c) => c.info.creditsUrl).filter((u): u is string => Boolean(u))),
  ];
  return urls.length > 0
    ? `Out of credits. Visit ${urls.join(" or ")} to increase your credits usage.`
    : "Out of credits. Try again in a little while.";
}

/**
 * The one line the assistant shows for a failed AI call. Every code but the catch-all carries a
 * short, user-safe, actionable message ("out of credits", "key rejected", "Ollama is not running",
 * "took too long") - showing it beats a blanket "out of service" the user cannot act on.
 */
export function assistantFailureMessage(err: AiError): string {
  return err.code === "AI_FAILED" ? OUT_OF_SERVICE_MESSAGE : err.message;
}

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
  /**
   * Total time for the whole fallback chain (every provider and model). Without it a slow local
   * model followed by slow hosted ones can add up to many minutes with nothing to show.
   */
  budgetMs?: number;
}

/** When other providers are waiting, one that hangs is given this long before the next takes over. */
const FALLBACK_SLICE_MS = 30_000;

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
  // Google never uses 401/403 for a bad key - a rejected or under-scoped key comes back as a plain
  // 400 "INVALID_ARGUMENT" (checkProvider() above already special-cases this for the same reason).
  // Without this, a real chat request would misread it as a generic failure and burn through every
  // fallback model with the same error before giving the visitor an unhelpful "out of service".
  if (
    response.status === 400 &&
    config.provider === "google" &&
    !/model.{0,40}(not found|does not exist|no longer available|not supported|decommissioned)|not found.{0,20}model/i.test(
      body,
    )
  ) {
    return new AiError(
      "AI_AUTH",
      `${label} rejected the API key. Check the key you entered in Settings.`,
      body,
    );
  }
  if (response.status === 404 && config.provider === "ollama") {
    return new AiError(
      "AI_MODEL",
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
  // A free tier retires models without notice; 404/400 "no such model" is about the model, not
  // the key, so the caller can simply try the next model in the chain.
  if (
    (response.status === 404 || response.status === 400) &&
    /model.{0,40}(not found|does not exist|no longer available|not supported|decommissioned)|not found.{0,20}model/i.test(
      body,
    )
  ) {
    return new AiError("AI_MODEL", `${label} does not have the model "${config.model}".`, body);
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

// ---- who is out of credits ----------------------------------------------------------------------

/** Providers that recently said "too many requests", and until when. Per server process, on purpose. */
const exhausted = new Map<string, number>();

function exhaustedKey(config: AiRuntimeConfig): string {
  // Keyed by the key itself (not just the provider) so one visitor's spent key never marks the
  // server's key - or another visitor's - as spent.
  return `${config.provider}:${config.apiKey ?? ""}`;
}

function markExhausted(config: AiRuntimeConfig, retryAfterSeconds?: number): void {
  const seconds = Math.min(600, Math.max(30, retryAfterSeconds ?? 60));
  exhausted.set(exhaustedKey(config), Date.now() + seconds * 1000);
}

function isExhausted(config: AiRuntimeConfig): boolean {
  const until = exhausted.get(exhaustedKey(config));
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  exhausted.delete(exhaustedKey(config));
  return false;
}

/**
 * One completion from the best runtime available to this caller.
 *
 * The runtimes are tried one after another - the visitor's pick first, then the rest in random
 * order, with any that recently ran out of credits moved to the back. Whatever stops one of them
 * (not running, a rejected key, a rate limit, a timeout, a provider having a bad minute) simply
 * hands the request to the next, so a single provider being out never costs the user their answer.
 * Only when every one has failed does the caller see an error, and then it is the most useful one:
 * "out of credits" beats "key rejected" beats "timed out" beats "not reachable".
 */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
  credentials: AiCredentials = {},
): Promise<{ text: string; config: AiRuntimeConfig }> {
  const all = availableConfigs(credentials);
  if (all.length === 0) throw new AiError("AI_UNAVAILABLE", NO_RUNTIME_MESSAGE);
  const configs = [...all.filter((c) => !isExhausted(c)), ...all.filter((c) => isExhausted(c))];

  const failures: { config: AiRuntimeConfig; error: AiError }[] = [];
  const deadline = options.budgetMs ? Date.now() + options.budgetMs : null;
  const remaining = () => (deadline === null ? Infinity : deadline - Date.now());
  for (const [position, base] of configs.entries()) {
    if (remaining() <= 1000) break;
    const hasNext = position < configs.length - 1;
    let config = base;
    if (config.provider === "ollama") {
      // A server that is not there is skipped up front - no waiting on a connection that will
      // never open (the answer is cached for a few seconds, so this is not a port scan).
      const probe = await probeOllama(config.host, options.signal);
      if (!probe.ok) {
        failures.push({
          config,
          error: new AiError("AI_UNAVAILABLE", `Ollama is not reachable at ${config.host}.`),
        });
        continue;
      }
      // Only offer models this Ollama has actually pulled; if none of ours are there, use
      // whatever it does have rather than failing over a name.
      if (probe.models.length > 0) {
        const pulled = (name: string) =>
          probe.models.some((m) => m === name || m.split(":")[0] === name);
        const usable = config.models.filter(pulled);
        config = { ...config, models: usable.length > 0 ? usable : probe.models.slice(0, 3) };
      }
    }
    // Each provider gets its whole model chain before the next provider is tried: a retired or
    // momentarily overloaded model is a model problem, not a provider problem.
    let last: { config: AiRuntimeConfig; error: AiError } | null = null;
    for (const model of config.models.length > 0 ? config.models : [config.model]) {
      const attempt: AiRuntimeConfig = { ...config, model };
      const left = remaining();
      if (left <= 1000) break;
      const slice = hasNext ? Math.min(left, FALLBACK_SLICE_MS) : left;
      const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS, slice);
      try {
        return { text: await chatWith(attempt, messages, { ...options, timeoutMs }), config: attempt };
      } catch (err) {
        const error = err instanceof AiError ? err : new AiError("AI_FAILED", String(err), err);
        if (options.signal?.aborted) throw error;
        last = { config: attempt, error };
        // These say nothing about the other models, so move the whole provider on.
        if (error.code === "AI_AUTH" || error.code === "AI_UNAVAILABLE") break;
        if (error.code === "AI_RATE_LIMIT") {
          markExhausted(attempt);
          continue;
        }
        if (error.code === "AI_MODEL" || error.code === "AI_FAILED") continue;
        break; // AI_TIMEOUT: another model of the same provider will not be faster.
      }
    }
    if (last) failures.push(last);
  }

  const of = (code: AiErrorCode) => failures.filter((f) => f.error.code === code);
  const limited = of("AI_RATE_LIMIT");
  if (limited.length > 0) {
    throw new AiError(
      "AI_RATE_LIMIT",
      outOfCreditsMessage(limited.map((f) => f.config)),
      limited[0]!.error.detail,
    );
  }
  for (const code of ["AI_AUTH", "AI_TIMEOUT", "AI_FAILED", "AI_MODEL"] as const) {
    const found = of(code)[0];
    if (found) throw found.error;
  }
  throw (
    failures[0]?.error ??
    new AiError(
      deadline !== null ? "AI_TIMEOUT" : "AI_UNAVAILABLE",
      deadline !== null
        ? "The AI took too long to answer. Try again, or pick a faster AI service in settings."
        : NO_RUNTIME_MESSAGE,
    )
  );
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
  exhausted.clear();
  checks.clear();
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

// ---- checking a runtime -------------------------------------------------------------------------

const CHECK_TTL_MS = 60_000;
const checks = new Map<string, { at: number; result: AiProviderCheck }>();

/** A request that proves the key works without spending any of the free allowance. */
function checkCall(config: AiRuntimeConfig): { url: string; headers: Record<string, string> } {
  switch (config.provider) {
    case "groq":
      return {
        url: "https://api.groq.com/openai/v1/models",
        headers: { authorization: `Bearer ${config.apiKey ?? ""}` },
      };
    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1/auth/key",
        headers: { authorization: `Bearer ${config.apiKey ?? ""}` },
      };
    default:
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
        headers: { "x-goog-api-key": config.apiKey ?? "" },
      };
  }
}

/**
 * Is this runtime usable right now? Ollama answers on its port; a hosted one accepts the key. Never
 * throws - "no" is an ordinary answer - and the answer is cached briefly so a page load is cheap.
 */
export async function checkProvider(
  config: AiRuntimeConfig,
  signal?: AbortSignal,
): Promise<AiProviderCheck> {
  const label = config.info.label;
  if (config.provider === "ollama") {
    const probe = await probeOllama(config.host, signal);
    if (!probe.ok) {
      return { provider: "ollama", ok: false, message: `Ollama is not running at ${config.host}.` };
    }
    // Any pulled model will do — `chat()` picks the best of ours that is there, or failing that
    // whatever the machine already has.
    const pulled = (name: string) =>
      probe.models.some((m) => m === name || m.split(":")[0] === name);
    const preferred = config.models.find(pulled);
    const usable =
      preferred ?? probe.models[0] ?? (probe.models.length === 0 ? config.model : null);
    return {
      provider: "ollama",
      ok: usable !== null,
      message: usable
        ? `Ollama is running at ${config.host} with ${usable}.`
        : `Ollama is running, but no model is pulled yet. Run "ollama pull ${config.model}".`,
    };
  }

  const cacheKey = `${config.provider}:${config.apiKey ?? ""}`;
  const cached = checks.get(cacheKey);
  if (cached && Date.now() - cached.at < CHECK_TTL_MS) return cached.result;

  let result: AiProviderCheck;
  if (isExhausted(config)) {
    result = {
      provider: config.provider,
      ok: false,
      message: `${label} is out of credits for now.`,
    };
  } else {
    const call = checkCall(config);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    signal?.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      const response = await doFetch(call.url, {
        headers: call.headers,
        signal: controller.signal,
      });
      if (response.ok) {
        result = { provider: config.provider, ok: true, message: `${label} accepted the key.` };
      } else if (response.status === 429) {
        markExhausted(config, retryAfter(response));
        result = {
          provider: config.provider,
          ok: false,
          message: `${label} is out of credits for now.`,
        };
      } else if (
        response.status === 401 ||
        response.status === 403 ||
        (config.provider === "google" && response.status === 400)
      ) {
        result = {
          provider: config.provider,
          ok: false,
          message: `${label} rejected the API key. Check it and try again.`,
        };
      } else {
        result = {
          provider: config.provider,
          ok: false,
          message: `${label} is having trouble right now.`,
        };
      }
    } catch {
      result = {
        provider: config.provider,
        ok: false,
        message: `${label} could not be reached. Check your internet connection.`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  // A network blip should not stick for a minute: only settled answers are remembered.
  if (result.ok || /rejected|out of credits/.test(result.message)) {
    checks.set(cacheKey, { at: Date.now(), result });
  }
  return result;
}

/**
 * What the UI shows: which runtimes would answer right now, and the disclosure that goes with the
 * first of them. Never throws - "nothing is available" is a normal answer with a plain-words
 * `message`. Every runtime that could be used is checked (in parallel), so "available" means a real
 * request would succeed, not merely that a key is present.
 */
export async function getAiStatus(
  credentials: AiCredentials = {},
  signal?: AbortSignal,
): Promise<AiStatus> {
  const preferred = isAiProviderId(credentials.provider) ? credentials.provider : null;
  const configs = availableConfigs(credentials);
  const base = { configured: configs.map((c) => c.provider), preferred };

  const results = await Promise.all(configs.map((c) => checkProvider(c, signal)));
  const ollamaResult = results.find((r) => r.provider === "ollama");
  const ollamaReachable = ollamaResult
    ? ollamaResult.ok || /model/.test(ollamaResult.message)
    : false;
  // Requests are spread across the runtimes at random, but the status has to read the same every
  // time it is asked: the visitor's pick first, then the fixed order (local before hosted).
  const rank = (i: number) =>
    configs[i]!.provider === preferred ? -1 : HOSTED_ORDER.indexOf(configs[i]!.provider);
  const usableIndexes = configs
    .map((_, i) => i)
    .filter((i) => results[i]!.ok)
    .sort((a, b) => rank(a) - rank(b));
  const extras = {
    checks: results,
    usable: usableIndexes.map((i) => configs[i]!.provider),
    ollamaReachable,
  };

  const firstIndex = usableIndexes[0];
  if (firstIndex !== undefined) {
    const config = configs[firstIndex]!;
    return {
      ...base,
      ...extras,
      available: true,
      provider: config.provider,
      providerLabel: config.info.label,
      model: config.model,
      local: config.info.local,
      disclosure: config.info.disclosure,
      message: results[firstIndex]!.message.replace(
        / accepted the key\.$/,
        ` is ready with ${config.model}.`,
      ),
    };
  }

  // Nothing answers. If a hosted runtime was configured and failed, say why; otherwise the
  // ordinary "nothing is set up" line.
  const hostedFailure = results.find((r, i) => configs[i]!.info.needsKey && !r.ok);
  return {
    ...base,
    ...extras,
    available: false,
    provider: null,
    providerLabel: null,
    model: null,
    local: true,
    disclosure: AI_PROVIDERS.ollama.disclosure,
    message: hostedFailure?.message ?? NO_RUNTIME_MESSAGE,
  };
}

/** Provider ids the Settings page offers. */
export function listAiProviders(): AiProviderId[] {
  return Object.keys(AI_PROVIDERS) as AiProviderId[];
}

export { configFor };
