// Client-side preferences and the sync that keeps them with the account
// (14-history-favorites.md).
//
// Phase 02 stored the theme in localStorage under `onestop-theme` as a resolved "light"/"dark",
// because the pre-paint init script has to read it synchronously. That stays exactly as it is.
// What this file adds is the *preference* ("system" is a preference, "dark" is a resolution) plus
// the small extras, and the two-way sync with `UserSettings` in Postgres for a signed-in user.
import { isThemeMode, THEME_STORAGE_KEY, type ThemeMode } from "@onestop/ui";
import type { ThemePreference, UserSettings } from "@onestop/types";

export const THEME_PREFERENCE_KEY = "onestop-theme-preference";
export const PREFERENCES_KEY = "onestop-preferences";
export const PREFERENCES_CHANGED = "onestop:preferences-changed";

/**
 * The AI runtimes the Settings page offers (16-ai-assistant.md builds what they do).
 *
 * `local` drives the disclosure the UI must show before a runtime is used: Ollama processes
 * everything on this machine, the three hosted free tiers send the text and file contents to a
 * third party. `needsKey` runtimes use a key the user supplies themselves — OneStop never ships
 * one (CLAUDE.md §2).
 */
export const AI_MODES = [
  {
    id: "ollama",
    label: "Ollama (no API key needed)",
    local: true,
    needsKey: false,
    disclosure: "Runs entirely on your device — nothing leaves your machine, and it works offline.",
    setupUrl: "https://ollama.com/download",
  },
  {
    id: "groq",
    label: "Groq (free tier)",
    local: false,
    needsKey: true,
    disclosure:
      "Runs on Groq's servers — the text and file contents you send are transmitted to Groq, and it needs an internet connection.",
    setupUrl: "https://console.groq.com/keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter (free models)",
    local: false,
    needsKey: true,
    disclosure:
      "Runs on OpenRouter's servers — the text and file contents you send are transmitted to OpenRouter, and it needs an internet connection.",
    setupUrl: "https://openrouter.ai/keys",
  },
  {
    id: "google",
    label: "Gemini (Google AI Studio free tier)",
    local: false,
    needsKey: true,
    disclosure:
      "Runs on Google's servers — the text and file contents you send are transmitted to Google, and it needs an internet connection.",
    setupUrl: "https://aistudio.google.com/app/apikey",
  },
] as const;

export type AiModeId = (typeof AI_MODES)[number]["id"];

export function aiMode(id: string | null): (typeof AI_MODES)[number] | undefined {
  return AI_MODES.find((m) => m.id === id);
}

/**
 * Where a user-supplied AI key lives: this browser, and nowhere else.
 *
 * It is never sent to `/api/settings` and never written to Postgres — a key is a credential, and
 * CLAUDE.md §2 keeps secrets out of the repo and out of shared storage. It travels only as the
 * `x-onestop-ai-key` header on the request that needs it, and the server forgets it immediately.
 *
 * Keys are namespaced per signed-in account (`setAiKeyScope`), so switching accounts on the same
 * browser never hands one person's saved key to another. A guest (or before the session loads)
 * uses the "guest" bucket.
 */
const AI_KEYS_LEGACY_KEY = "onestop-ai-keys";

let aiKeyScope = "guest";

/** Called once the signed-in account (or lack of one) is known — see `AiKeyScopeSync`. */
export function setAiKeyScope(userId: string | null): void {
  aiKeyScope = userId && userId.trim() !== "" ? userId.trim() : "guest";
}

function scopedKey(base: string): string {
  return `${base}:${aiKeyScope}`;
}

/** Moves a pre-scoping value onto the current scope's key, once, then removes the shared copy. */
function migrateLegacy(legacyKey: string, scopedStorageKey: string): void {
  try {
    if (localStorage.getItem(scopedStorageKey) !== null) return;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null) return;
    localStorage.setItem(scopedStorageKey, legacy);
    localStorage.removeItem(legacyKey);
  } catch {
    // Storage can be blocked; migration is a nicety, not a requirement.
  }
}

function readKeyMap(): Record<string, string> {
  try {
    const storageKey = scopedKey(AI_KEYS_LEGACY_KEY);
    migrateLegacy(AI_KEYS_LEGACY_KEY, storageKey);
    const raw = localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/** The key stored for one provider, or for the preferred one when none is named. */
export function readAiKey(provider?: string | null): string {
  if (typeof window === "undefined") return "";
  const id = provider ?? readPreferredAI();
  if (!id) return "";
  const value = readKeyMap()[id];
  return typeof value === "string" ? value : "";
}

export function writeAiKey(provider: string, key: string | null): void {
  try {
    const map = readKeyMap();
    if (key && key.trim() !== "") map[provider] = key.trim();
    else delete map[provider];
    localStorage.setItem(scopedKey(AI_KEYS_LEGACY_KEY), JSON.stringify(map));
  } catch {
    // Blocked storage means the key simply is not remembered; the runtime choice still works.
  }
  notify();
}

/** Wipes every saved key for the current scope — used when an account signs out. */
export function clearAiKeys(): void {
  try {
    localStorage.removeItem(scopedKey(AI_KEYS_LEGACY_KEY));
  } catch {
    // Nothing to clean up if storage is blocked.
  }
}

/** Which AI the visitor chose: OneStop's own hosted service (the default) or their own provider. */
export type AiSource = "onestop" | "own";

export function readAiSource(): AiSource {
  return readLocalPreferences().aiSource === "own" ? "own" : "onestop";
}

/** The runtime to use for a request: the visitor's pick when they use their own, else none. */
export function activeAiProvider(): string | null {
  return readAiSource() === "own" ? readPreferredAI() : null;
}

export function readAllAiKeys(): Record<string, string> {
  if (typeof window === "undefined") return {};
  return readKeyMap();
}

function encodeHeader(value: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

/**
 * The header an assistant request carries (see `lib/ai-request.ts` on the server): either "use
 * OneStop's service" - no key at all - or the visitor's own provider and the keys saved in this
 * browser. The server uses it for that one request and forgets it.
 */
export function aiHeaders(source: AiSource = readAiSource()): Record<string, string> {
  if (source !== "own") return { "x-onestop-ai": encodeHeader({ mode: "onestop" }) };
  return {
    "x-onestop-ai": encodeHeader({
      mode: "own",
      provider: readPreferredAI(),
      keys: readAllAiKeys(),
    }),
  };
}

export interface LocalPreferences {
  /** OneStop's own hosted AI service, or the visitor's own provider and keys. */
  aiSource: AiSource;
  /** Where a finished result goes by default. */
  defaultDownload: "ask" | "auto";
  confirmBeforeDelete: boolean;
  /** Off means a run is never written to this device's history. */
  saveHistory: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_PREFERENCES: LocalPreferences = {
  aiSource: "onestop",
  defaultDownload: "ask",
  confirmBeforeDelete: true,
  saveHistory: true,
  reduceMotion: false,
};

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PREFERENCES_CHANGED));
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_PREFERENCE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    // Phase 02 only stored the resolved mode; treat that as an explicit choice.
    const legacy = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(legacy) ? legacy : "system";
  } catch {
    return "system";
  }
}

/** What "system" resolves to right now. */
export function resolveTheme(preference: ThemePreference): ThemeMode {
  if (preference === "light" || preference === "dark") return preference;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * Applies a theme preference to the page and remembers it. "system" removes the resolved key, so
 * the pre-paint script falls back to the OS setting on the next load, as phase 02 designed it.
 */
export function applyThemePreference(preference: ThemePreference): ThemeMode {
  const resolved = resolveTheme(preference);
  if (typeof document !== "undefined") document.documentElement.dataset.theme = resolved;
  try {
    localStorage.setItem(THEME_PREFERENCE_KEY, preference);
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, resolved);
  } catch {
    // Storage can be blocked (private mode); the theme still applies for this page.
  }
  notify();
  return resolved;
}

export function readLocalPreferences(): LocalPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PREFERENCES };
    return { ...DEFAULT_PREFERENCES, ...(parsed as Partial<LocalPreferences>) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function writeLocalPreferences(next: Partial<LocalPreferences>): LocalPreferences {
  const merged = { ...readLocalPreferences(), ...next };
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(merged));
  } catch {
    // Same as above: preferences are a convenience, never a requirement.
  }
  notify();
  return merged;
}

export function readPreferredAI(): string | null {
  try {
    return localStorage.getItem("onestop-preferred-ai");
  } catch {
    return null;
  }
}

export function writePreferredAI(id: string | null): void {
  try {
    if (id) localStorage.setItem("onestop-preferred-ai", id);
    else localStorage.removeItem("onestop-preferred-ai");
  } catch {
    // ignored, as above
  }
  notify();
}

/** Writes the account's settings onto this device, so a fresh browser picks up the account's. */
export function applyServerSettings(settings: UserSettings): void {
  applyThemePreference(settings.theme);
  writePreferredAI(settings.preferredAI);
  writeLocalPreferences(settings.preferences as Partial<LocalPreferences>);
}

interface SettingsResponse {
  ok?: boolean;
  settings?: UserSettings;
}

/** Reads the account's settings, or null when the visitor is a guest (or the call failed). */
export async function fetchSettings(signal?: AbortSignal): Promise<UserSettings | null> {
  try {
    const response = await fetch("/api/settings", { signal });
    if (!response.ok) return null;
    const body = (await response.json()) as SettingsResponse;
    return body.settings ?? null;
  } catch {
    return null;
  }
}

/** Saves a change to the account. Returns the stored settings, or null when it did not go. */
export async function saveSettings(patch: {
  theme?: ThemePreference;
  preferredAI?: string | null;
  preferences?: Partial<LocalPreferences>;
}): Promise<UserSettings | null> {
  try {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as SettingsResponse;
    return body.settings ?? null;
  } catch {
    return null;
  }
}
