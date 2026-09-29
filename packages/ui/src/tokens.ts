// Design tokens for both themes. The single source for colors, spacing and typography:
// `themeCss()` turns them into CSS custom properties that Tailwind utilities read.

export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "onestop-theme";

/** Where the text-accessibility and reduced-data flags live (roadmap section 6). */
export const TEXT_PREFERENCE_KEY = "onestop-text-preferences";

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

/**
 * Theme presets (21-roadmap-expansion.md, roadmap section 7.6).
 *
 * The two originals stay exactly as they are - "chrome" *is* `colors.light` and "lacquer" *is*
 * `colors.dark`. Everything below is data fed to the same `themeCss()` generator, which is the whole
 * point: a new look is a palette object, not new plumbing. Each preset declares which of the two
 * base modes it behaves like, so `color-scheme`, form controls and the pre-paint script stay right.
 *
 * "high-contrast" is here for accessibility (roadmap section 6): black on white, no gradients and no
 * sheen, so body text lands far above the WCAG AAA 7:1 ratio.
 */
export type ThemePresetId = "chrome" | "lacquer" | "terminal" | "paper" | "high-contrast";

export interface ThemePreset {
  id: ThemePresetId;
  name: string;
  /** One line for the settings list. */
  description: string;
  /** Which built-in mode this behaves like, for `color-scheme` and the OS-preference fallback. */
  base: ThemeMode;
  colors: Record<ColorToken, string>;
}

/** No gradient at all: used by the presets that want flat, quiet surfaces. */
function flat(color: string): string {
  return `linear-gradient(0deg, ${color} 0%, ${color} 100%)`;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "chrome",
    name: "Polished chrome",
    description: "The original light theme: pale blue-silver with champagne glints.",
    base: "light",
    colors: colors.light,
  },
  {
    id: "lacquer",
    name: "Black lacquer",
    description: "The original dark theme: near-black bodies lit by cool steel highlights.",
    base: "dark",
    colors: colors.dark,
  },
  {
    id: "terminal",
    name: "Terminal green",
    description: "Phosphor green on deep charcoal, for a console feel.",
    base: "dark",
    colors: {
      ...colors.dark,
      bg: "#03110a",
      surface: "#071a11",
      "surface-muted": "#0b2418",
      border: "#1d4a33",
      fg: "#c8f7d8",
      "fg-muted": "#6fbb8c",
      primary: "#3ddc84",
      "primary-hover": "#6df3a8",
      "primary-fg": "#03130b",
      success: "#3ddc84",
      warning: "#e3c95f",
      danger: "#ff7b72",
      ring: "#3ddc84",
      "shine-start": "#1d7a4a",
      "shine-end": "#a7f3c6",
      "bg-image":
        "radial-gradient(55% 40% at 18% 4%, rgba(61,220,132,0.16) 0%, rgba(61,220,132,0) 70%), radial-gradient(45% 38% at 88% 28%, rgba(61,220,132,0.1) 0%, rgba(61,220,132,0) 70%), repeating-linear-gradient(0deg, rgba(61,220,132,0.035) 0px, rgba(61,220,132,0.035) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px), linear-gradient(165deg, #03110a 0%, #07200f 45%, #020c07 100%)",
      "surface-sheen":
        "linear-gradient(150deg, rgba(61,220,132,0.08) 0%, rgba(61,220,132,0.02) 55%, rgba(61,220,132,0) 100%)",
      "primary-sheen": "linear-gradient(180deg, #6df3a8 0%, #2fb76c 100%)",
      "card-shadow": "0 1px 0 rgba(61,220,132,0.12) inset, 0 10px 26px -16px rgba(0,0,0,0.9)",
    },
  },
  {
    id: "paper",
    name: "Paper and sepia",
    description: "Warm off-white and ink, easier on the eyes for long reading.",
    base: "light",
    colors: {
      ...colors.light,
      bg: "#f3ead9",
      surface: "#fbf6ec",
      "surface-muted": "#ece0cc",
      border: "#cbb99b",
      fg: "#2a2520",
      "fg-muted": "#5c5347",
      primary: "#4a3f31",
      "primary-hover": "#2f281f",
      "primary-fg": "#fbf6ec",
      success: "#3f6b33",
      warning: "#8a5a1c",
      danger: "#9c3b2c",
      ring: "#6b5c47",
      "shine-start": "#4a3f31",
      "shine-end": "#a4917a",
      "bg-image":
        "radial-gradient(60% 45% at 12% 6%, rgba(255,252,244,0.85) 0%, rgba(255,252,244,0) 70%), radial-gradient(50% 42% at 90% 22%, rgba(231,214,184,0.7) 0%, rgba(231,214,184,0) 70%), linear-gradient(160deg, #f6eede 0%, #efe4cf 50%, #f3ebdb 100%)",
      "surface-sheen":
        "linear-gradient(150deg, rgba(255,253,247,0.9) 0%, rgba(255,253,247,0.45) 60%, rgba(233,220,196,0.4) 100%)",
      "primary-sheen": "linear-gradient(180deg, #5c5041 0%, #3a3126 100%)",
      "card-shadow": "0 1px 0 rgba(255,255,255,0.8) inset, 0 8px 22px -14px rgba(90,72,44,0.4)",
    },
  },
  {
    id: "high-contrast",
    name: "High contrast",
    description: "Black on white, no gradients - maximum legibility.",
    base: "light",
    colors: {
      ...colors.light,
      bg: "#ffffff",
      surface: "#ffffff",
      "surface-muted": "#f2f2f2",
      border: "#000000",
      fg: "#000000",
      "fg-muted": "#1a1a1a",
      primary: "#000000",
      "primary-hover": "#1f1f1f",
      "primary-fg": "#ffffff",
      success: "#005c1f",
      warning: "#7a4100",
      danger: "#a30000",
      ring: "#000000",
      "shine-start": "#000000",
      "shine-end": "#000000",
      "bg-image": flat("#ffffff"),
      "surface-sheen": flat("rgba(0,0,0,0)"),
      "primary-sheen": flat("#000000"),
      "card-shadow": "0 0 0 1px #000000 inset",
    },
  },
];

export const DEFAULT_PRESET: ThemePresetId = "chrome";
export const THEME_PRESET_KEY = "onestop-theme-preset";

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return THEME_PRESETS.some((p) => p.id === value);
}

export function themePreset(id: string | null | undefined): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}

/** The preset a `data-theme` value maps to when no preset has been chosen. */
export function presetForMode(mode: ThemeMode): ThemePresetId {
  return mode === "dark" ? "lacquer" : "chrome";
}

export type TextPresetId = "default" | "dyslexic" | "large";

export const TEXT_PRESETS: { id: TextPresetId; name: string; description: string }[] = [
  { id: "default", name: "Default", description: "The app's normal spacing and size." },
  {
    id: "dyslexic",
    name: "Dyslexia-friendly spacing",
    description: "Wider letter and word spacing, taller lines, narrower text columns.",
  },
  { id: "large", name: "Larger text", description: "Scales every size up by about an eighth." },
];

/**
 * Accessible text adjustments (roadmap section 6). Spacing and weight only - no font file is
 * downloaded, so this costs nothing and works offline. The spacing is the part of a
 * dyslexia-friendly typeface that actually does most of the work.
 */
export const TEXT_ADJUST_CSS =
  ':root[data-text="dyslexic"]{--os-letter-spacing:0.035em;--os-word-spacing:0.14em;--os-line-height:1.75;}' +
  ':root[data-text="dyslexic"] body{letter-spacing:var(--os-letter-spacing);word-spacing:var(--os-word-spacing);line-height:var(--os-line-height);}' +
  ':root[data-text="dyslexic"] p,:root[data-text="dyslexic"] li{max-width:68ch;}' +
  ':root[data-text="large"]{font-size:112.5%;}' +
  ':root[data-data-saver="on"] [data-decorative="true"]{display:none!important;}' +
  ':root[data-data-saver="on"] body{background-image:none!important;}';


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

/**
 * CSS custom properties for every theme, keyed off `data-theme` and `data-preset` on <html>.
 *
 * `data-theme` stays exactly as phase 02 designed it, so nothing that already reads light/dark
 * changes. A preset is layered on top via `data-preset`, which wins because its rule comes later in
 * the sheet - that is why picking "Terminal green" needs no change to the theme toggle at all.
 */
export function themeCss(): string {
  const shared = vars(spacing, "space-") + vars(radius, "radius-") + vars(typography);
  const presetRules = THEME_PRESETS.filter((p) => p.id !== "chrome" && p.id !== "lacquer")
    .map((p) => `:root[data-preset="${p.id}"]{${vars(p.colors)}color-scheme:${p.base};}`)
    .join("");
  return (
    `:root{${shared}${vars(colors.light)}color-scheme:light;}` +
    `:root[data-theme="dark"]{${vars(colors.dark)}color-scheme:dark;}` +
    presetRules +
    TEXT_ADJUST_CSS
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
  const presetKey = JSON.stringify(THEME_PRESET_KEY);
  const ids = JSON.stringify(THEME_PRESETS.map((p) => p.id));
  const bases = JSON.stringify(Object.fromEntries(THEME_PRESETS.map((p) => [p.id, p.base])));
  const textKey = JSON.stringify(TEXT_PREFERENCE_KEY);
  // One script, before paint, so nothing flashes: the mode first, then the preset (which also
  // corrects the mode when a preset disagrees with it), then the text and reduced-data flags.
  return (
    `(function(){var d=document.documentElement;try{var t=localStorage.getItem(${key});` +
    `if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}d.dataset.theme=t;` +
    `var p=localStorage.getItem(${presetKey});if(p&&${ids}.indexOf(p)>=0){d.dataset.preset=p;d.dataset.theme=${bases}[p]}` +
    `var x=localStorage.getItem(${textKey});if(x){x=JSON.parse(x);if(x.text&&x.text!=="default")d.dataset.text=x.text;if(x.dataSaver)d.dataset.dataSaver="on"}` +
    `}catch(e){d.dataset.theme="light"}})();`
  );
}
