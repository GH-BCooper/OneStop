// QR rendering (11-qr-tools.md).
//
// `qrcode` gives us the module matrix (the black/white grid) and nothing else; the drawing is
// ours, so the same matrix can be rendered as a plain black square code, as rounded dots with a
// logo (QR Code Customization), or as an SVG. Everything here is offline: no fonts are fetched,
// no network call is made, and the logo is decoded from bytes the user supplied.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { create as createMatrix, type QRCodeErrorCorrectionLevel } from "qrcode";
import { PdfToolError } from "../pdf/errors.ts";
import { unsupported } from "./formats.ts";

export type Ecc = "L" | "M" | "Q" | "H";
export type ModuleShape = "square" | "rounded" | "dot";
export type EyeShape = "square" | "rounded" | "circle";
export type QrFormat = "png" | "svg";

export const QR_MIME: Record<QrFormat, string> = {
  png: "image/png",
  svg: "image/svg+xml",
};

/** Largest image any QR tool will produce. A 4096 px code is already far past print quality. */
export const MAX_QR_PIXELS = 4096;
const MIN_QR_PIXELS = 64;

export interface QrStyle {
  /** Width and height of the finished image, in pixels (PNG) or user units (SVG). */
  size: number;
  /** Quiet-zone width, in modules. The spec asks for 4; below that, readers struggle. */
  margin: number;
  ecc: Ecc;
  /** CSS colour for the dark modules. */
  dark: string;
  /** CSS colour for the background, or "transparent". */
  light: string;
  moduleShape: ModuleShape;
  eyeShape: EyeShape;
  /** CSS colour for the three corner finder patterns; empty means "same as the modules". */
  eyeColor: string;
  /** `data:image/...;base64,...` logo to sit in the middle, or "" for none. */
  logo: string;
  /** Logo width as a fraction of the code's width. */
  logoScale: number;
}

export const DEFAULT_STYLE: QrStyle = {
  size: 512,
  margin: 4,
  ecc: "M",
  dark: "#000000",
  light: "#ffffff",
  moduleShape: "square",
  eyeShape: "square",
  eyeColor: "",
  logo: "",
  logoScale: 0.2,
};

/** A very small subset of CSS colours: #rgb, #rrggbb, #rrggbbaa and the word "transparent". */
export function normaliseColor(value: string, fallback: string): string {
  const text = value.trim().toLowerCase();
  if (text === "") return fallback;
  if (text === "transparent") return "transparent";
  const named: Record<string, string> = {
    black: "#000000",
    white: "#ffffff",
    red: "#e11d48",
    blue: "#2563eb",
    green: "#16a34a",
    purple: "#7c3aed",
    orange: "#ea580c",
  };
  if (named[text]) return named[text]!;
  if (/^#[0-9a-f]{3}$/.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(text) || /^#[0-9a-f]{8}$/.test(text)) return text;
  throw unsupported(
    `"${value}" is not a colour OneStop understands. Use a hex colour like #1d4ed8.`,
  );
}

/** Relative luminance, used to warn when a colour pair is too close to scan. */
function luminance(hex: string): number {
  if (hex === "transparent") return 1;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG-style contrast ratio between the dark modules and the background. */
export function contrastRatio(dark: string, light: string): number {
  const a = luminance(dark);
  const b = luminance(light);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Scanners need a clear light/dark split; below 3:1 most phones give up. */
export const MIN_CONTRAST = 3;

export interface QrMatrix {
  /** `true` where a module is dark. */
  modules: boolean[][];
  /** Number of modules on a side (21 for version 1, 177 for version 40). */
  size: number;
  version: number;
  ecc: Ecc;
}

const ECC_ORDER: readonly Ecc[] = ["L", "M", "Q", "H"];

/**
 * Builds the module matrix. `qrcode` throws a long technical message when the payload is too big
 * for any version; that becomes the one actionable sentence the user can do something about.
 */
export function buildMatrix(text: string, ecc: Ecc = "M"): QrMatrix {
  if (text === "") throw unsupported("There is nothing to put in the QR code.");
  let qr;
  try {
    qr = createMatrix(text, { errorCorrectionLevel: ecc as QRCodeErrorCorrectionLevel });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/too big|code length overflow/i.test(message)) {
      throw unsupported(
        "This content is too long for a QR code. Shorten it, or use a Dynamic QR code so the code only holds a short link.",
        message,
      );
    }
    throw new PdfToolError("FAILED", "This content could not be turned into a QR code.", message);
  }
  const side = qr.modules.size;
  const data = qr.modules.data;
  const modules: boolean[][] = [];
  for (let row = 0; row < side; row += 1) {
    const line: boolean[] = [];
    for (let col = 0; col < side; col += 1) line.push(Boolean(data[row * side + col]));
    modules.push(line);
  }
  return { modules, size: side, version: qr.version, ecc };
}

/**
 * A logo covers modules, so the code must be able to lose them. Error correction H recovers ~30%
 * of the code, which comfortably covers a logo up to about 25% of the width.
 */
export function eccForStyle(style: Pick<QrStyle, "ecc" | "logo" | "logoScale">): Ecc {
  if (style.logo === "") return style.ecc;
  const wanted: Ecc = style.logoScale > 0.18 ? "H" : "Q";
  return ECC_ORDER.indexOf(style.ecc) >= ECC_ORDER.indexOf(wanted) ? style.ecc : wanted;
}

export function resolveStyle(partial: Partial<QrStyle>): QrStyle {
  const style: QrStyle = { ...DEFAULT_STYLE, ...partial };
  style.size = Math.min(MAX_QR_PIXELS, Math.max(MIN_QR_PIXELS, Math.round(style.size)));
  style.margin = Math.min(16, Math.max(0, Math.round(style.margin)));
  style.logoScale = Math.min(0.3, Math.max(0.05, style.logoScale));
  style.dark = normaliseColor(style.dark, DEFAULT_STYLE.dark);
  style.light = normaliseColor(style.light, DEFAULT_STYLE.light);
  style.eyeColor = style.eyeColor.trim() === "" ? "" : normaliseColor(style.eyeColor, style.dark);
  if (style.dark === "transparent") {
    throw unsupported(
      "The QR code's own colour cannot be transparent - nothing would be scannable.",
    );
  }
  if (contrastRatio(style.dark, style.light) < MIN_CONTRAST) {
    throw unsupported(
      "These two colours are too similar for a phone to read. Use a dark code on a light background (or the other way round).",
    );
  }
  return style;
}

/** True when (row, col) belongs to one of the three finder patterns (the 7x7 corner squares). */
export function isFinderModule(row: number, col: number, side: number): boolean {
  return (row < 7 && col < 7) || (row < 7 && col >= side - 7) || (row >= side - 7 && col < 7);
}

interface Geometry {
  /** Pixel size of one module. */
  unit: number;
  /** Pixel offset of the first module. */
  offset: number;
  side: number;
}

function geometry(matrix: QrMatrix, style: QrStyle): Geometry {
  const total = matrix.size + style.margin * 2;
  const unit = style.size / total;
  return { unit, offset: style.margin * unit, side: matrix.size };
}

/** The three finder patterns, as [row, col] of their top-left module. */
function finderOrigins(side: number): [number, number][] {
  return [
    [0, 0],
    [0, side - 7],
    [side - 7, 0],
  ];
}

// ---- SVG ---------------------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

function eyeSvg(x: number, y: number, unit: number, shape: EyeShape, color: string): string {
  const outer = unit * 7;
  const radius = shape === "circle" ? outer / 2 : shape === "rounded" ? unit * 2 : 0;
  const innerRadius = shape === "circle" ? (unit * 3) / 2 : shape === "rounded" ? unit : 0;
  // The stroke straddles the path, so the rectangle is inset by half a module: the finished ring
  // then occupies exactly the 7x7 modules the spec reserves, as the PNG renderer also does.
  const ring = `<rect x="${round(x + unit / 2)}" y="${round(y + unit / 2)}" width="${round(outer - unit)}" height="${round(outer - unit)}" rx="${round(Math.max(0, radius - unit / 2))}" ry="${round(Math.max(0, radius - unit / 2))}" fill="none" stroke="${color}" stroke-width="${round(unit)}"/>`;
  const core = `<rect x="${round(x + unit * 2)}" y="${round(y + unit * 2)}" width="${round(unit * 3)}" height="${round(unit * 3)}" rx="${round(innerRadius)}" ry="${round(innerRadius)}" fill="${color}"/>`;
  return `${ring}${core}`;
}

function moduleSvg(x: number, y: number, unit: number, shape: ModuleShape): string {
  if (shape === "dot") {
    const r = (unit / 2) * 0.92;
    return `<circle cx="${round(x + unit / 2)}" cy="${round(y + unit / 2)}" r="${round(r)}"/>`;
  }
  if (shape === "rounded") {
    return `<rect x="${round(x)}" y="${round(y)}" width="${round(unit)}" height="${round(unit)}" rx="${round(unit * 0.3)}" ry="${round(unit * 0.3)}"/>`;
  }
  // Square modules are drawn a hair larger so neighbours never show a seam.
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(unit * 1.02)}" height="${round(unit * 1.02)}"/>`;
}

export function renderSvg(matrix: QrMatrix, style: QrStyle): string {
  const { unit, offset, side } = geometry(matrix, style);
  const customEyes = style.eyeShape !== "square" || style.eyeColor !== "";
  const eyeColor = style.eyeColor === "" ? style.dark : style.eyeColor;

  const shapes: string[] = [];
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      if (!matrix.modules[row]![col]) continue;
      if (customEyes && isFinderModule(row, col, side)) continue;
      shapes.push(moduleSvg(offset + col * unit, offset + row * unit, unit, style.moduleShape));
    }
  }

  const eyes = customEyes
    ? finderOrigins(side)
        .map(([row, col]) =>
          eyeSvg(offset + col * unit, offset + row * unit, unit, style.eyeShape, eyeColor),
        )
        .join("")
    : "";

  const background =
    style.light === "transparent"
      ? ""
      : `<rect width="${style.size}" height="${style.size}" fill="${style.light}"/>`;

  let logo = "";
  if (style.logo !== "") {
    const logoSize = style.size * style.logoScale;
    const pad = logoSize * 0.12;
    const box = logoSize + pad * 2;
    const boxX = (style.size - box) / 2;
    const plate =
      style.light === "transparent"
        ? ""
        : `<rect x="${round(boxX)}" y="${round(boxX)}" width="${round(box)}" height="${round(box)}" rx="${round(box * 0.15)}" fill="${style.light}"/>`;
    logo = `${plate}<image x="${round(boxX + pad)}" y="${round(boxX + pad)}" width="${round(logoSize)}" height="${round(logoSize)}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(style.logo)}"/>`;
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${style.size}" height="${style.size}" viewBox="0 0 ${style.size} ${style.size}" shape-rendering="crispEdges" role="img" aria-label="QR code">`,
    background,
    `<g fill="${style.dark}">${shapes.join("")}</g>`,
    eyes,
    logo,
    "</svg>",
  ].join("");
}

// ---- PNG ---------------------------------------------------------------------------------------

function dataUrlBytes(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  if (!/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(dataUrl) || comma < 0) {
    throw unsupported("The logo must be a PNG, JPG, WebP or GIF image.");
  }
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

function roundedPath(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export async function renderPng(matrix: QrMatrix, style: QrStyle): Promise<Uint8Array> {
  const { unit, offset, side } = geometry(matrix, style);
  const canvas = createCanvas(style.size, style.size);
  const ctx = canvas.getContext("2d");

  if (style.light !== "transparent") {
    ctx.fillStyle = style.light;
    ctx.fillRect(0, 0, style.size, style.size);
  }

  const customEyes = style.eyeShape !== "square" || style.eyeColor !== "";
  ctx.fillStyle = style.dark;
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      if (!matrix.modules[row]![col]) continue;
      if (customEyes && isFinderModule(row, col, side)) continue;
      const x = offset + col * unit;
      const y = offset + row * unit;
      if (style.moduleShape === "dot") {
        ctx.beginPath();
        ctx.arc(x + unit / 2, y + unit / 2, (unit / 2) * 0.92, 0, Math.PI * 2);
        ctx.fill();
      } else if (style.moduleShape === "rounded") {
        roundedPath(ctx, x, y, unit, unit, unit * 0.3);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, unit * 1.02, unit * 1.02);
      }
    }
  }

  if (customEyes) {
    const eyeColor = style.eyeColor === "" ? style.dark : style.eyeColor;
    ctx.fillStyle = eyeColor;
    ctx.strokeStyle = eyeColor;
    ctx.lineWidth = unit;
    for (const [row, col] of finderOrigins(side)) {
      const x = offset + col * unit;
      const y = offset + row * unit;
      const outer = unit * 7;
      const radius =
        style.eyeShape === "circle" ? outer / 2 : style.eyeShape === "rounded" ? unit * 2 : 0;
      roundedPath(
        ctx,
        x + unit / 2,
        y + unit / 2,
        outer - unit,
        outer - unit,
        Math.max(0, radius - unit / 2),
      );
      ctx.stroke();
      const innerRadius =
        style.eyeShape === "circle" ? (unit * 3) / 2 : style.eyeShape === "rounded" ? unit : 0;
      roundedPath(ctx, x + unit * 2, y + unit * 2, unit * 3, unit * 3, innerRadius);
      ctx.fill();
    }
  }

  if (style.logo !== "") {
    const logoSize = style.size * style.logoScale;
    const pad = logoSize * 0.12;
    const box = logoSize + pad * 2;
    const boxX = (style.size - box) / 2;
    if (style.light !== "transparent") {
      ctx.fillStyle = style.light;
      roundedPath(ctx, boxX, boxX, box, box, box * 0.15);
      ctx.fill();
    }
    let image;
    try {
      image = await loadImage(dataUrlBytes(style.logo));
    } catch (err) {
      if (err instanceof PdfToolError) throw err;
      throw unsupported("The logo image could not be read. Try a PNG or JPG file.", err);
    }
    // Fit the logo inside its box without distorting it.
    const scale = Math.min(logoSize / image.width, logoSize / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, (style.size - w) / 2, (style.size - h) / 2, w, h);
  }

  return new Uint8Array(await canvas.encode("png"));
}

export interface RenderedQr {
  bytes: Uint8Array;
  mimeType: string;
  format: QrFormat;
  text: string;
  matrix: QrMatrix;
  style: QrStyle;
}

/** The one call every QR tool makes: content plus a style in, image bytes out. */
/**
 * Smallest image in which a code of this many modules still scans. Below about three pixels per
 * module, phone cameras (and our own decoder) start to fail, and a long payload can easily need
 * 177 modules - so a dense code is enlarged rather than shipped unreadable.
 */
export function minimumSizeFor(modules: number, margin: number): number {
  return Math.min(MAX_QR_PIXELS, (modules + margin * 2) * 3);
}

export async function renderQr(
  text: string,
  partial: Partial<QrStyle> = {},
  format: QrFormat = "png",
): Promise<RenderedQr> {
  const style = resolveStyle(partial);
  const matrix = buildMatrix(text, eccForStyle(style));
  style.size = Math.max(style.size, minimumSizeFor(matrix.size, style.margin));
  const bytes =
    format === "svg"
      ? new Uint8Array(Buffer.from(renderSvg(matrix, style), "utf8"))
      : await renderPng(matrix, style);
  return { bytes, mimeType: QR_MIME[format], format, text, matrix, style };
}
