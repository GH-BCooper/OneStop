// Design tokens for both themes. The single source for colors, spacing and typography:
// `themeCss()` turns them into CSS custom properties that Tailwind utilities read.

export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "onestop-theme";

// "Liquid metal" palette, read off the two reference backgrounds (public/images/darkMode.png and
// lightMode.png) rather than copied from them: dark mode is black lacquer - near-black bodies
// (#050506-#15181c) lit by cool steel highlights (#3f444b-#616973, up to ~#c8d0da); light mode is
// polished chrome - pale blue-silver (#a6bacb-#cadce9) with soft champagne glints (#cecec9) and
// deep steel shadows (#798e9e). There is no purple or blue in either: the accents are graphite on
// silver and platinum on black, so contrast comes from light against dark, not from a hue.
//
// `bg-image` layers a few wide, low-alpha radial "reflections" and two diagonal bands of sheen over
// a slow multi-stop linear gradient - the way light rolls across a curved metal sheet. `surface-sheen`
// puts the same idea, much quieter, on cards; `primary-sheen` does it for the main button. Every
// functional colour (buttons, borders, status) still comes from the semantic tokens.
export const colors = {
  light: {
    bg: "#d3dde6",
    surface: "#f7fafc",
    "surface-muted": "#e4ebf1",
    border: "#a3b3c0",
    fg: "#0e141a",
    "fg-muted": "#3d4b57",
    primary: "#1a2129",
    "primary-hover": "#0a0e12",
    "primary-fg": "#f5f8fb",
    success: "#166534",
    warning: "#92400e",
    danger: "#b91c1c",
    ring: "#26323d",
    "shine-start": "#1a222b",
    "shine-end": "#566a7b",
    "bg-image":
      "radial-gradient(60% 45% at 14% 4%, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 70%), radial-gradient(45% 40% at 92% 14%, rgba(238,228,208,0.7) 0%, rgba(238,228,208,0) 70%), radial-gradient(70% 45% at 50% 105%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 70%), linear-gradient(118deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 20%, rgba(255,255,255,0) 31%, rgba(112,134,152,0.3) 46%, rgba(255,255,255,0) 57%, rgba(255,255,255,0.5) 72%, rgba(255,255,255,0) 84%), linear-gradient(160deg, #bccbd8 0%, #dbe4eb 26%, #aebfcd 50%, #d3dce3 74%, #b9c7d3 100%)",
    "surface-sheen":
      "linear-gradient(150deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.4) 55%, rgba(200,214,226,0.4) 100%)",
    "primary-sheen": "linear-gradient(180deg, #38424d 0%, #141a20 100%)",
    "card-shadow": "0 1px 0 rgba(255,255,255,0.85) inset, 0 8px 24px -12px rgba(24,36,48,0.45)",
  },
  dark: {
    bg: "#08090b",
    surface: "#111417",
    "surface-muted": "#1a1e23",
    border: "#2f353d",
    fg: "#eef1f5",
    "fg-muted": "#a3acb8",
    primary: "#e4e9ef",
    "primary-hover": "#ffffff",
    "primary-fg": "#0b0d10",
    success: "#4ade80",
    warning: "#fbbf24",
    danger: "#f87171",
    ring: "#c5ced8",
    "shine-start": "#7f8d9d",
    "shine-end": "#ffffff",
    "bg-image":
      "radial-gradient(60% 45% at 16% 6%, rgba(160,176,196,0.34) 0%, rgba(160,176,196,0) 70%), radial-gradient(45% 40% at 90% 30%, rgba(130,146,166,0.3) 0%, rgba(130,146,166,0) 70%), radial-gradient(70% 38% at 30% 96%, rgba(120,136,156,0.28) 0%, rgba(120,136,156,0) 70%), linear-gradient(115deg, rgba(200,214,230,0) 0%, rgba(200,214,230,0) 22%, rgba(200,214,230,0.05) 27%, rgba(214,226,240,0.2) 31%, rgba(200,214,230,0.05) 35%, rgba(200,214,230,0) 40%, rgba(200,214,230,0) 56%, rgba(200,214,230,0.04) 61%, rgba(214,226,240,0.15) 65%, rgba(200,214,230,0) 71%), linear-gradient(160deg, #050506 0%, #0f1215 26%, #1e2328 44%, #08090b 60%, #171b20 80%, #050506 100%)",
    "surface-sheen":
      "linear-gradient(150deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.015) 50%, rgba(255,255,255,0) 100%)",
    "primary-sheen": "linear-gradient(180deg, #ffffff 0%, #c3ccd6 100%)",
    "card-shadow": "0 1px 0 rgba(255,255,255,0.07) inset, 0 10px 28px -14px rgba(0,0,0,0.85)",
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
