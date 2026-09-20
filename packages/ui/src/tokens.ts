// Design tokens for both themes. The single source for colors, spacing and typography:
// `themeCss()` turns them into CSS custom properties that Tailwind utilities read.

export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "onestop-theme";

// "Royal" palette: a shiny, silvery royal-purple in light mode and a deep royal-purple/near-black
// in dark mode, matched to the OneStop logo (a violet/silver monogram on near-black). `shine-*`
// is a second pair of stops used only for the gradient wordmark and a few hero accents — every
// functional color (buttons, borders, status) still comes from the semantic tokens above it.
export const colors = {
  light: {
    bg: "#eef0f5",
    surface: "#ffffff",
    "surface-muted": "#e8eaf1",
    border: "#d6dae4",
    fg: "#1c1533",
    "fg-muted": "#5b5573",
    primary: "#6d28d9",
    "primary-hover": "#5b21b6",
    "primary-fg": "#ffffff",
    success: "#15803d",
    warning: "#b45309",
    danger: "#b91c1c",
    ring: "#7c3aed",
    "shine-start": "#4c1d95",
    "shine-end": "#8b8fb8",
    "bg-image":
      "radial-gradient(circle at 15% 0%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 45%), linear-gradient(135deg, #f4f5f9 0%, #e3e6ee 25%, #f8f9fc 50%, #dfe2ec 75%, #f4f5f9 100%)",
  },
  dark: {
    bg: "#0a0716",
    surface: "#140f28",
    "surface-muted": "#1f1938",
    border: "#332a57",
    fg: "#f2effc",
    "fg-muted": "#a89fcb",
    primary: "#a78bfa",
    "primary-hover": "#c4b5fd",
    "primary-fg": "#140825",
    success: "#4ade80",
    warning: "#fbbf24",
    danger: "#f87171",
    ring: "#c4b5fd",
    "shine-start": "#c4b5fd",
    "shine-end": "#f5f3ff",
    "bg-image":
      "radial-gradient(circle at 85% 0%, rgba(196,181,253,0.16) 0%, rgba(196,181,253,0) 45%), linear-gradient(135deg, #0a0716 0%, #180f30 30%, #241a44 55%, #120a24 80%, #0a0716 100%)",
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
