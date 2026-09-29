// Colour Converter & palette tools (21-roadmap-expansion.md, roadmap §1.8).
//
// HEX/RGB/HSL/CMYK conversion, a small palette generator and a WCAG contrast check — all pure
// arithmetic, no dependency, and it pairs with the Colour-Blindness Simulator in the image tools.
import type { Executor } from "@onestop/tool-registry";
import { MIME, optEnum, optNumber, optString, requireText, runUtilTool, textFile, unsupported } from "./common.ts";

export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", lime: "#00ff00", blue: "#0000ff",
  yellow: "#ffff00", cyan: "#00ffff", magenta: "#ff00ff", silver: "#c0c0c0", gray: "#808080",
  grey: "#808080", maroon: "#800000", olive: "#808000", green: "#008000", purple: "#800080",
  teal: "#008080", navy: "#000080", orange: "#ffa500", pink: "#ffc0cb", brown: "#a52a2a",
  gold: "#ffd700", indigo: "#4b0082", violet: "#ee82ee", coral: "#ff7f50", salmon: "#fa8072",
  crimson: "#dc143c", khaki: "#f0e68c", plum: "#dda0dd", orchid: "#da70d6", turquoise: "#40e0d0",
};

const clamp = (n: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, n));

/** Accepts #rgb, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla(), cmyk() and CSS colour names. */
export function parseColor(text: string): Rgb {
  const raw = text.trim().toLowerCase();
  const source = NAMED[raw] ?? raw;

  const hex = /^#?([0-9a-f]{3,8})$/.exec(source);
  if (hex) {
    const h = hex[1]!;
    const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16);
    if (h.length === 3 || h.length === 4) {
      return {
        r: expand(h[0]!),
        g: expand(h[1]!),
        b: expand(h[2]!),
        a: h.length === 4 ? expand(h[3]!) / 255 : 1,
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
  }

  const fn = /^(rgba?|hsla?|cmyk)\s*\(([^)]*)\)$/.exec(source);
  if (fn) {
    const name = fn[1]!;
    const parts = fn[2]!.split(/[,/\s]+/).filter(Boolean);
    const value = (index: number, scale = 1) => {
      const part = parts[index] ?? "";
      const n = Number(part.replace("%", ""));
      if (!Number.isFinite(n)) return NaN;
      return part.endsWith("%") ? (n / 100) * scale : n;
    };
    if (name.startsWith("rgb")) {
      return { r: clamp(value(0, 255)), g: clamp(value(1, 255)), b: clamp(value(2, 255)), a: parts[3] ? clamp(value(3, 1), 0, 1) : 1 };
    }
    if (name.startsWith("hsl")) {
      const rgb = hslToRgb(value(0), value(1, 100) / (parts[1]?.endsWith("%") ? 1 : 1), value(2, 100));
      return { ...rgb, a: parts[3] ? clamp(value(3, 1), 0, 1) : 1 };
    }
    const [c, m, y, k] = [value(0, 100), value(1, 100), value(2, 100), value(3, 100)];
    return { ...cmykToRgb(c, m, y, k), a: 1 };
  }
  throw unsupported(`"${text}" is not a colour. Try #3f444b, rgb(63 68 75), hsl(210 9% 27%) or a name like "teal".`);
}

export function rgbToHex({ r, g, b, a }: Rgb, withAlpha = false): string {
  const hex = (n: number) => Math.round(clamp(n)).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}${withAlpha && a < 1 ? hex(a * 255) : ""}`;
}

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = ln - c / 2;
  const [r1, g1, b1] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

export function rgbToCmyk({ r, g, b }: Rgb): { c: number; m: number; y: number; k: number } {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const k = 1 - Math.max(rn, gn, bn);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: Math.round(((1 - rn - k) / (1 - k)) * 100),
    m: Math.round(((1 - gn - k) / (1 - k)) * 100),
    y: Math.round(((1 - bn - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  };
}

export function cmykToRgb(c: number, m: number, y: number, k: number): { r: number; g: number; b: number } {
  const f = (v: number) => Math.round(255 * (1 - clamp(v, 0, 100) / 100) * (1 - clamp(k, 0, 100) / 100));
  return { r: f(c), g: f(m), b: f(y) };
}

/** WCAG 2.x relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100;
}

export interface ContrastVerdict {
  ratio: number;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
  verdict: string;
}

export function judgeContrast(a: Rgb, b: Rgb): ContrastVerdict {
  const ratio = contrastRatio(a, b);
  const aaNormal = ratio >= 4.5;
  const aaaNormal = ratio >= 7;
  const aaLarge = ratio >= 3;
  return {
    ratio,
    aaNormal,
    aaLarge,
    aaaNormal,
    aaaLarge: ratio >= 4.5,
    verdict: aaaNormal
      ? "passes AAA for all text"
      : aaNormal
        ? "passes AA for all text, AAA only for large text"
        : aaLarge
          ? "passes AA for large text only (18pt+, or 14pt bold)"
          : "fails WCAG AA — not enough contrast for body text",
  };
}

export type PaletteKind = "none" | "shades" | "complementary" | "analogous" | "triadic" | "tetradic" | "monochromatic";

export function buildPalette(base: Rgb, kind: PaletteKind, count: number): { hex: string; label: string }[] {
  const { h, s, l } = rgbToHsl(base);
  const at = (hue: number, sat = s, light = l, label = "") => ({
    hex: rgbToHex({ ...hslToRgb(hue, sat, light), a: 1 }),
    label,
  });
  switch (kind) {
    case "shades": {
      const steps = Math.max(2, count);
      return Array.from({ length: steps }, (_, i) => {
        const light = Math.round(8 + (i * (92 - 8)) / (steps - 1));
        return at(h, s, light, `${light}% lightness`);
      });
    }
    case "complementary":
      return [at(h, s, l, "base"), at(h + 180, s, l, "complement")];
    case "analogous":
      return [at(h - 30, s, l, "-30°"), at(h, s, l, "base"), at(h + 30, s, l, "+30°")];
    case "triadic":
      return [at(h, s, l, "base"), at(h + 120, s, l, "+120°"), at(h + 240, s, l, "+240°")];
    case "tetradic":
      return [at(h, s, l, "base"), at(h + 90, s, l, "+90°"), at(h + 180, s, l, "+180°"), at(h + 270, s, l, "+270°")];
    case "monochromatic":
      return Array.from({ length: Math.max(2, count) }, (_, i) =>
        at(h, Math.max(10, s - i * 12), Math.min(92, l + (i - 1) * 14), `variant ${i + 1}`),
      );
    default:
      return [];
  }
}

export const colorConverterExecutor: Executor = (input, options) =>
  runUtilTool("color-converter", async () => {
    const color = parseColor(requireText(input, "a colour"));
    const hsl = rgbToHsl(color);
    const cmyk = rgbToCmyk(color);
    const hex = rgbToHex(color, true);
    const against = optString(options, "against", "").trim();
    const palette = buildPalette(
      color,
      optEnum(options, "palette", ["none", "shades", "complementary", "analogous", "triadic", "tetradic", "monochromatic"] as const, "shades"),
      optNumber(options, "steps", 7, { min: 2, max: 16 }),
    );
    const contrast = against === "" ? null : judgeContrast(color, parseColor(against));
    const onWhite = judgeContrast(color, { r: 255, g: 255, b: 255, a: 1 });
    const onBlack = judgeContrast(color, { r: 0, g: 0, b: 0, a: 1 });

    const formats = {
      hex,
      rgb: `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)}${color.a < 1 ? ` / ${Math.round(color.a * 100)}%` : ""})`,
      hsl: `hsl(${hsl.h} ${hsl.s}% ${hsl.l}%${color.a < 1 ? ` / ${Math.round(color.a * 100)}%` : ""})`,
      cmyk: `cmyk(${cmyk.c}% ${cmyk.m}% ${cmyk.y}% ${cmyk.k}%)`,
    };
    return {
      ok: true,
      output: {
        ...formats,
        channels: color,
        hslValues: hsl,
        cmykValues: cmyk,
        luminance: Math.round(luminance(color) * 1000) / 1000,
        palette,
        contrast,
        onWhite,
        onBlack,
        result: Object.values(formats).join("\n"),
      },
      summary: `${formats.hex} — ${formats.rgb}, ${formats.hsl}. Against white it reaches ${onWhite.ratio}:1, against black ${onBlack.ratio}:1${contrast ? `, against ${against} ${contrast.ratio}:1 (${contrast.verdict})` : ""}.`,
      files: [
        textFile(
          "color.json",
          MIME.json,
          JSON.stringify({ ...formats, palette, onWhite, onBlack, contrast }, null, 2) + "\n",
        ),
      ],
    };
  });
