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
    cost: "free",
  },
  groq: {
    id: "groq",
    label: "Groq free tier",
    local: false,
    needsKey: true,
    disclosure: hostedDisclosure("Groq"),
    setupUrl: "https://console.groq.com/keys",
    defaultModel: "llama-3.3-70b-versatile",
    cost: "free",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter free models",
    local: false,
    needsKey: true,
    disclosure: hostedDisclosure("OpenRouter"),
    setupUrl: "https://openrouter.ai/keys",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    cost: "free",
  },
  google: {
    id: "google",
    label: "Google AI Studio free tier",
    local: false,
    needsKey: true,
    disclosure: hostedDisclosure("Google"),
    setupUrl: "https://aistudio.google.com/app/apikey",
    defaultModel: "gemini-2.0-flash",
    cost: "free",
  },
};

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[];

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && (AI_PROVIDER_IDS as string[]).includes(value);
}

/** What the caller may override per request: the provider, their own key and the model name. */
export interface AiCredentials {
  provider?: string | null;
  /** The user's own key, typed into Settings. Never persisted server-side. */
  apiKey?: string | null;
  model?: string | null;
  /** Ollama only: a host other than the configured one. */
  host?: string | null;
}

export interface AiRuntimeConfig {
  provider: AiProviderId;
  info: AiProviderInfo;
  model: string;
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
      return env("GOOGLE_AI_API_KEY");
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
  const supplied =
    typeof credentials.apiKey === "string" && credentials.apiKey.trim() !== ""
      ? credentials.apiKey.trim()
      : null;
  // A key typed into Settings is only ever used for the provider it was typed for.
  const key = (credentials.provider === provider ? supplied : null) ?? envKey(provider);
  if (info.needsKey && !key) return null;
  const model =
    (credentials.provider === provider && typeof credentials.model === "string"
      ? credentials.model.trim()
      : "") ||
    envModel(provider) ||
    info.defaultModel;
  const host =
    (credentials.provider === provider && typeof credentials.host === "string"
      ? credentials.host.trim().replace(/\/+$/, "")
      : "") || ollamaHost();
  return { provider, info, model, host, apiKey: key };
}

/** Providers that could be used right now, best first. Ollama always leads: local is the default. */
export function availableConfigs(credentials: AiCredentials = {}): AiRuntimeConfig[] {
  const preferred = isAiProviderId(credentials.provider) ? credentials.provider : null;
  const order: AiProviderId[] = preferred
    ? [preferred, ...AI_PROVIDER_IDS.filter((id) => id !== preferred)]
    : [...AI_PROVIDER_IDS];
  return order
    .map((id) => configFor(id, credentials))
    .filter((c): c is AiRuntimeConfig => c !== null);
}

/** Providers with a usable key (or, for Ollama, a configured host) — not a liveness check. */
export function configuredProviders(credentials: AiCredentials = {}): AiProviderId[] {
  return availableConfigs(credentials).map((c) => c.provider);
}
