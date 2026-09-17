"use client";

import { isThemeMode, THEME_STORAGE_KEY, type ThemeMode } from "@onestop/ui";
import { useEffect, useState } from "react";

function currentTheme(): ThemeMode {
  const attr = document.documentElement.dataset.theme;
  return isThemeMode(attr) ? attr : "light";
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage can be blocked (private mode); the theme still applies for this page.
  }
}

export function ThemeToggle() {
  // null until mounted: the server can't know the stored theme.
  const [mode, setMode] = useState<ThemeMode | null>(null);

  useEffect(() => {
    setMode(currentTheme());
  }, []);

  const next: ThemeMode = mode === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setMode(next);
      }}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-lg hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span aria-hidden="true">{mode === "dark" ? "☀️" : "🌙"}</span>
    </button>
  );
}
