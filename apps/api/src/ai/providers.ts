// The four free model runtimes, and how a request picks one (16-ai-assistant.md).
//
// Two rules shape this file and neither is negotiable (CLAUDE.md §2, §8):
//   * a fresh install with no configuration at all uses Ollama, fully on the user's machine;
//   * a hosted runtime is only ever reached with a key the *user* supplied — from their own
//     environment or typed into Settings — and the UI says out loud that their text leaves the
//     device before it is used.
//
// No Anthropic/Claude provider exists here, by design.
import type { AiProviderId, AiProviderInfo } from "@onestop/types";

export const LOCAL_DISCLOSURE =
  "Runs entirely on your device — nothing leaves your machine, and it works offline.";

function hostedDisclosure(name: string): string {
  return `Runs on ${name}'s servers — the text and file contents you send are transmitted to ${name} for processing, and it needs an internet connection.`;
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    local: true,
    needsKey: false,
    disclosure: LOCAL_DISCLOSURE,
    setupUrl: "https://ollama.com/download",
    defaultModel: "llama3.2",
    fallbackModels: ["llama3.2", "llama3.1", "qwen2.5", "mistral"],
    cost: "free",
  },
  groq: {
    id: "groq",
    label: "Groq free tier",
    local: false,
    needsKey: true,
    disclosure: hostedDisclosure("Groq"),
    setupUrl: "https://console.groq.com/keys",
    defaultModel: "openai/gpt-oss-120b",
    fallbackModels: [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
      "llama-3.3-70b-versatile",
    ],
    cost: "free",
    creditsUrl: "https://console.groq.com/settings/billing",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter free models",
    local: false,
    needsKey: true,
    disclosure: hostedDisclosure("OpenRouter"),
    setupUrl: "https://openrouter.ai/keys",
    defaultModel: "z-ai/glm-5.2:free",
    fallbackModels: [
      "z-ai/glm-5.2:free",
      "qwen/qwen3.8-27b:free",
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
    ],
    cost: "free",
    creditsUrl: "https://openrouter.ai/settings/credits",
  },
  google: {
    id: "google",
    label: "Google Gemini free tier",
    local: false,
    needsKey: true,
    disclosure: hostedDisclosure("Google"),
    setupUrl: "https://aistudio.google.com/app/apikey",
    defaultModel: "gemini-3.5-flash",
    fallbackModels: [
      "gemini-3.5-flash",
      "gemini-flash-latest",
      "gemini-3.5-flash-lite",
      "gemini-flash-lite-latest",
    ],
    cost: "free",
    creditsUrl: "https://aistudio.google.com/usage",
  },
};

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[];

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && (AI_PROVIDER_IDS as string[]).includes(value);
}

/**
 * What the caller may override per request: the provider, their own key and the model name.
 *
 * `mode` is how the assistant picks its keys. "hosted" is OneStop's own service: only the keys the
 * server itself holds (and Ollama, if the server can reach one) are used, and anything the browser
 * sent is ignored. "own" is the visitor's own account: only the keys they typed into Settings are
 * used, never the server's. Left unset (the AI tools' page runs), a key sent with the request wins
 * for its provider and the server's keys fill in the rest.
 */
export interface AiCredentials {
  mode?: "hosted" | "own" | null;
  provider?: string | null;
  /** The user's own key, typed into Settings. Never persisted server-side. */
  apiKey?: string | null;
  /** Every key the user has saved, by provider - so a fallback can use the others. */
  keys?: Partial<Record<AiProviderId, string>> | null;
  model?: string | null;
  /** Ollama only: a host other than the configured one. */
  host?: string | null;
}

export interface AiRuntimeConfig {
  provider: AiProviderId;
  info: AiProviderInfo;
  model: string;
  /**
   * The models to try for this provider, best first, starting with `model`. Empty beyond the
   * first entry when the caller pinned a model explicitly — their choice is not second-guessed.
   */
  models: string[];
  /** Ollama's base URL; unused by the hosted providers. */
  host: string;
  apiKey: string | null;
}

function env(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function ollamaHost(): string {
  return (env("OLLAMA_HOST") ?? "http://localhost:11434").replace(/\/+$/, "");
}

/** The key the server itself holds for a provider, if the operator set one. Never bundled. */
export function envKey(provider: AiProviderId): string | null {
  switch (provider) {
    case "groq":
      return env("GROQ_API_KEY");
    case "openrouter":
      return env("OPENROUTER_API_KEY");
    case "google":
      // `GEMINI_API_KEY` is what Google's own docs and most hosting guides call it.
      return env("GOOGLE_AI_API_KEY") ?? env("GEMINI_API_KEY");
    case "ollama":
      return null;
  }
}

function envModel(provider: AiProviderId): string | null {
  switch (provider) {
    case "ollama":
      return env("OLLAMA_MODEL");
    case "groq":
      return env("GROQ_MODEL");
    case "openrouter":
      return env("OPENROUTER_MODEL");
    case "google":
      return env("GOOGLE_AI_MODEL");
  }
}

/**
 * Builds the config for one provider, or null when it cannot be used (a hosted provider with no
 * key). A per-request key always wins over the environment: the user's own key is the point.
 */
export function configFor(
  provider: AiProviderId,
  credentials: AiCredentials = {},
): AiRuntimeConfig | null {
  const info = AI_PROVIDERS[provider];
  const single =
    typeof credentials.apiKey === "string" && credentials.apiKey.trim() !== ""
      ? credentials.apiKey.trim()
      : null;
  const fromMap = credentials.keys?.[provider];
  // A key typed into Settings is only ever used for the provider it was typed for.
  const supplied =
    (typeof fromMap === "string" && fromMap.trim() !== "" ? fromMap.trim() : null) ??
    (credentials.provider === provider ? single : null);
  const key =
    credentials.mode === "hosted"
      ? envKey(provider)
      : credentials.mode === "own"
        ? supplied
        : (supplied ?? envKey(provider));
  if (info.needsKey && !key) return null;
  // A model the caller pinned (per request, or in the environment) is used on its own: only the
  // built-in default gets the fallback chain behind it.
  const pinned =
    (credentials.provider === provider && typeof credentials.model === "string"
      ? credentials.model.trim()
      : "") || envModel(provider);
  const model = pinned || info.defaultModel;
  const models = pinned
    ? [pinned]
    : [...new Set([info.defaultModel, ...(info.fallbackModels ?? [])])];
  const host =
    (credentials.provider === provider && typeof credentials.host === "string"
      ? credentials.host.trim().replace(/\/+$/, "")
      : "") || ollamaHost();
  return { provider, info, model, models, host, apiKey: key };
}

/**
 * The order OneStop's own service tries its runtimes in: local first (free, private, no quota),
 * then the hosted free tiers most-reliable first. It is deliberately fixed rather than random —
 * "whichever is available, and the next one when that runs out" has to be predictable enough to
 * explain, and a runtime that is out of credits is moved to the back by the runtime itself.
 */
export const HOSTED_ORDER: AiProviderId[] = ["ollama", "groq", "google", "openrouter"];

/**
 * Providers that could be used right now, in the order to try them.
 *
 * With their own provider picked, that provider is the only one used — the visitor chose it, and
 * silently answering from a different service would make the choice meaningless. Otherwise
 * (OneStop's own service) the fixed order above applies, so one provider being down or out of
 * credits simply hands the request to the next.
 */
export function availableConfigs(credentials: AiCredentials = {}): AiRuntimeConfig[] {
  const preferred =
    credentials.mode === "hosted"
      ? null
      : isAiProviderId(credentials.provider)
        ? credentials.provider
        : null;
  if (credentials.mode === "own") {
    // No provider picked yet: fall back to whichever of their own keys works.
    const order = preferred
      ? [preferred]
      : HOSTED_ORDER.filter((id) => AI_PROVIDERS[id].needsKey || id === "ollama");
    return order
      .map((id) => configFor(id, credentials))
      .filter((c): c is AiRuntimeConfig => c !== null);
  }
  const rest = HOSTED_ORDER.filter((id) => id !== preferred);
  const order: AiProviderId[] = preferred ? [preferred, ...rest] : rest;
  return order
    .map((id) => configFor(id, credentials))
    .filter((c): c is AiRuntimeConfig => c !== null);
}

/** Providers with a usable key (or, for Ollama, a configured host) — not a liveness check. */
export function configuredProviders(credentials: AiCredentials = {}): AiProviderId[] {
  return availableConfigs(credentials).map((c) => c.provider);
}
