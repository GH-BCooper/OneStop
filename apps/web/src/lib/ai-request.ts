// How the browser tells the assistant routes which AI to use (16-ai-assistant.md).
//
// One header carries it all, so a key never lands in a URL, a log line or a browser history entry:
//   x-onestop-ai: base64(JSON { mode: "onestop" | "own", provider?, keys? })
// "onestop" means the server's own service - the browser sends no key and the server uses the ones
// its operator configured. "own" means the visitor's own account: their keys (saved in this browser
// only) travel with the request, are used for it, and are forgotten.
import { isAiProviderId, type AiCredentials } from "@onestop/api";
import type { AiProviderId } from "@onestop/types";

export const AI_HEADER = "x-onestop-ai";
const MAX_KEY_LENGTH = 400;

function cleanKeys(value: unknown): Partial<Record<AiProviderId, string>> {
  const out: Partial<Record<AiProviderId, string>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [id, key] of Object.entries(value as Record<string, unknown>)) {
    if (isAiProviderId(id) && typeof key === "string" && key.trim() !== "") {
      out[id] = key.trim().slice(0, MAX_KEY_LENGTH);
    }
  }
  return out;
}

/** The runtime choice a request carries. `fallbackProvider` is the legacy query/body `provider`. */
export function readAiCredentials(request: Request, fallbackProvider?: unknown): AiCredentials {
  const raw = request.headers.get(AI_HEADER);
  if (raw) {
    try {
      const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as {
        mode?: unknown;
        provider?: unknown;
        keys?: unknown;
      };
      if (parsed.mode === "onestop") return { mode: "hosted" };
      if (parsed.mode === "own") {
        const provider = isAiProviderId(parsed.provider) ? parsed.provider : null;
        return { mode: "own", provider, keys: cleanKeys(parsed.keys) };
      }
    } catch {
      // A malformed header is treated like no header: the server's defaults apply.
    }
  }
  const legacyKey = request.headers.get("x-onestop-ai-key");
  return {
    provider: isAiProviderId(fallbackProvider) ? fallbackProvider : null,
    apiKey: legacyKey && legacyKey.trim() !== "" ? legacyKey.trim() : null,
  };
}
