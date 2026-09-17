// Design tokens for both themes. The single source for colors, spacing and typography:
// `themeCss()` turns them into CSS custom properties that Tailwind utilities read.

export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "onestop-theme";

export const colors = {
  light: {
    bg: "#f8fafc",
    surface: "#ffffff",
    "surface-muted": "#f1f5f9",
    border: "#e2e8f0",
    fg: "#0f172a",
    "fg-muted": "#475569",
    primary: "#4f46e5",
    "primary-hover": "#4338ca",
    "primary-fg": "#ffffff",
    success: "#15803d",
    warning: "#b45309",
    danger: "#b91c1c",
    ring: "#6366f1",
  },
  dark: {
    bg: "#0b1120",
    surface: "#111827",
    "surface-muted": "#1f2937",
    border: "#334155",
    fg: "#f1f5f9",
    "fg-muted": "#94a3b8",
    primary: "#818cf8",
    "primary-hover": "#a5b4fc",
    "primary-fg": "#0b1120",
    success: "#4ade80",
    warning: "#fbbf24",
    danger: "#f87171",
    ring: "#a5b4fc",
  },
} as const satisfies Record<ThemeMode, Record<string, string>>;

export type ColorToken = keyof (typeof colors)["light"];

export const spacing = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  "2xl": "3rem",
} as const;

export const radius = { sm: "0.375rem", md: "0.625rem", lg: "1rem" } as const;

export const typography = {
  "font-sans":
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  "font-mono": 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
} as const;

function vars(entries: Record<string, string>, prefix = ""): string {
  return Object.entries(entries)
    .map(([k, v]) => `--os-${prefix}${k}:${v};`)
    .join("");
}

/** CSS custom properties for both themes, keyed off `data-theme` on <html>. */
export function themeCss(): string {
  const shared = vars(spacing, "space-") + vars(radius, "radius-") + vars(typography);
  return (
    `:root{${shared}${vars(colors.light)}color-scheme:light;}` +
    `:root[data-theme="dark"]{${vars(colors.dark)}color-scheme:dark;}`
  );
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark";
}

/**
 * Inline script run before paint so the stored theme applies without a flash.
 * Falls back to the OS preference when nothing (or something invalid) is stored.
 */
export function themeInitScript(): string {
  const key = JSON.stringify(THEME_STORAGE_KEY);
  return `(function(){var d=document.documentElement;try{var t=localStorage.getItem(${key});if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}d.dataset.theme=t}catch(e){d.dataset.theme="light"}})();`;
}
