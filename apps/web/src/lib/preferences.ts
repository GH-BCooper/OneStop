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

/** The AI runtimes the Settings page offers. Phase 16 owns what they actually do. */
export const AI_MODES = [
  { id: "ollama", label: "Ollama (local, fully offline)" },
  { id: "groq", label: "Groq free tier (your own key, sends data off this device)" },
  { id: "openrouter", label: "OpenRouter free models (your own key)" },
  { id: "google", label: "Google AI Studio free tier (your own key)" },
] as const;

export interface LocalPreferences {
  /** Where a finished result goes by default. */
  defaultDownload: "ask" | "auto";
  confirmBeforeDelete: boolean;
  /** Off means a run is never written to this device's history. */
  saveHistory: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_PREFERENCES: LocalPreferences = {
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
