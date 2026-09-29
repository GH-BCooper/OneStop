// Appearance preferences beyond light/dark (21-roadmap-expansion.md, roadmap §7.6 and §6).
//
// Three separate things, deliberately: the *preset* (which palette), the *text* adjustment
// (dyslexia-friendly spacing or larger type) and *reduced data* (skip the particle canvas and the
// heavy gradients on a metered connection). All three are per-device — like the existing theme
// preference — so they need no account and work offline, and all three are applied by the same
// pre-paint script in `themeInitScript()` so nothing flashes on reload.
import {
  DEFAULT_PRESET,
  TEXT_PREFERENCE_KEY,
  THEME_PRESET_KEY,
  isThemePresetId,
  presetForMode,
  themePreset,
  type TextPresetId,
  type ThemeMode,
  type ThemePresetId,
} from "@onestop/ui";
import { PREFERENCES_CHANGED } from "./preferences";

export interface TextPreferences {
  text: TextPresetId;
  dataSaver: boolean;
}

export const DEFAULT_TEXT_PREFERENCES: TextPreferences = { text: "default", dataSaver: false };

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PREFERENCES_CHANGED));
}

export function readThemePresetPreference(): ThemePresetId | null {
  try {
    const stored = localStorage.getItem(THEME_PRESET_KEY);
    return isThemePresetId(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** The preset in force right now: the stored one, or whichever matches the current light/dark mode. */
export function activeThemePreset(): ThemePresetId {
  const stored = readThemePresetPreference();
  if (stored) return stored;
  if (typeof document === "undefined") return DEFAULT_PRESET;
  const mode = document.documentElement.dataset.theme;
  return presetForMode(mode === "dark" ? "dark" : "light");
}

/**
 * Applies a preset and remembers it. `null` clears it, which hands control back to the light/dark
 * toggle — that is what makes the two controls coexist rather than fight.
 */
export function applyThemePreset(id: ThemePresetId | null): ThemeMode {
  const root = typeof document === "undefined" ? null : document.documentElement;
  try {
    if (id === null) localStorage.removeItem(THEME_PRESET_KEY);
    else localStorage.setItem(THEME_PRESET_KEY, id);
  } catch {
    // Private mode: the change still applies to this page.
  }
  if (!root) return "light";
  if (id === null) {
    delete root.dataset.preset;
    notify();
    return root.dataset.theme === "dark" ? "dark" : "light";
  }
  const preset = themePreset(id);
  root.dataset.preset = id;
  if (preset) root.dataset.theme = preset.base;
  notify();
  return preset?.base ?? "light";
}

export function readTextPreferences(): TextPreferences {
  try {
    const raw = localStorage.getItem(TEXT_PREFERENCE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_TEXT_PREFERENCES };
    return { ...DEFAULT_TEXT_PREFERENCES, ...(parsed as Partial<TextPreferences>) };
  } catch {
    return { ...DEFAULT_TEXT_PREFERENCES };
  }
}

export function applyTextPreferences(next: Partial<TextPreferences>): TextPreferences {
  const merged = { ...readTextPreferences(), ...next };
  try {
    localStorage.setItem(TEXT_PREFERENCE_KEY, JSON.stringify(merged));
  } catch {
    // Same as above: the page still updates.
  }
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (merged.text === "default") delete root.dataset.text;
    else root.dataset.text = merged.text;
    if (merged.dataSaver) root.dataset.dataSaver = "on";
    else delete root.dataset.dataSaver;
  }
  notify();
  return merged;
}

/**
 * Whether decorative canvas work should run at all: off for reduced data, off for
 * `prefers-reduced-motion`, and off when the browser reports a metered/slow connection itself.
 */
export function decorationsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (readTextPreferences().dataSaver) return false;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    const connection = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData) return false;
    if (connection?.effectiveType && /^(slow-)?2g$/.test(connection.effectiveType)) return false;
  } catch {
    // An older browser without these APIs simply gets the decorations.
  }
  return true;
}
