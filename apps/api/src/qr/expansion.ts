// QR/barcode additions from 21-roadmap-expansion.md (roadmap §1.6): the 1D Barcode Generator, the
// Batch (mail-merge) QR Generator and the Logo QR Code.
//
// `bwip-js` was deliberately not adopted: Code 128, EAN-13 and UPC-A are small, fully specified
// encodings, and writing them out here keeps the zero-new-dependency streak and makes the checksum
// rules auditable. The Logo QR reuses the existing renderer *and* the existing decoder, so it can
// prove the finished code still scans rather than just hoping.
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { createZip, ZIP_MIME } from "../pdf/zip.ts";
import { optBool, optEnum, optNumber, optString, runQrTool, styleFromOptions, textInput, unsupported } from "./common.ts";
import { decodeQrImage } from "./decode.ts";
import { buildMatrix, normaliseColor, renderQr, type QrFormat } from "./generate.ts";

// ---- 1D barcodes -------------------------------------------------------------------------------

export const BARCODE_SYMBOLOGIES = ["code128", "ean13", "ean8", "upca", "code39", "itf14"] as const;
export type Symbology = (typeof BARCODE_SYMBOLOGIES)[number];

export const SYMBOLOGY_LABELS: Record<Symbology, string> = {
  code128: "Code 128",
  ean13: "EAN-13",
  ean8: "EAN-8",
  upca: "UPC-A",
  code39: "Code 39",
  itf14: "ITF-14",
};

/**
 * Code 128 pattern table, indexed by code value 0–106. Each entry is six digits: the widths of the
 * three bar/space pairs that make up one 11-module character.
 */
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "211133",
];

const CODE39_PATTERNS: Record<string, string> = {
  "0": "101001101101", "1": "110100101011", "2": "101100101011", "3": "110110010101",
  "4": "101001101011", "5": "110100110101", "6": "101100110101", "7": "101001011011",
  "8": "110100101101", "9": "101100101101", A: "110101001011", B: "101101001011",
  C: "110110100101", D: "101011001011", E: "110101100101", F: "101101100101",
  G: "101010011011", H: "110101001101", I: "101101001101", J: "101011001101",
  K: "110101010011", L: "101101010011", M: "110110101001", N: "101011010011",
  O: "110101101001", P: "101101101001", Q: "101010110011", R: "110101011001",
  S: "101101011001", T: "101011011001", U: "110010101011", V: "100110101011",
  W: "110011010101", X: "100101101011", Y: "110010110101", Z: "100110110101",
  "-": "100101011011", ".": "110010101101", " ": "100110101101", $: "100100100101",
  "/": "100100101001", "+": "100101001001", "%": "101001001001", "*": "100101101101",
};

/** The left/right/odd-even digit patterns EAN-13 and UPC-A share. */
const EAN_LEFT_ODD = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_LEFT_EVEN = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_RIGHT = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const EAN13_PARITY = ["OOOOOO", "OOEOEE", "OOEEOE", "OOEEEO", "OEOOEE", "OEEOOE", "OEEEOO", "OEOEOE", "OEOEEO", "OEEOEO"];

/** The mod-10 check digit EAN/UPC use: alternate weights of 1 and 3, from the right. */
export function eanCheckDigit(digits: string): number {
  let sum = 0;
  const reversed = [...digits].reverse();
  for (const [index, ch] of reversed.entries()) sum += Number(ch) * (index % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** Code 128's weighted mod-103 checksum over the code values, start character included. */
export function code128Checksum(values: number[]): number {
  return values.reduce((sum, value, index) => sum + value * (index === 0 ? 1 : index), 0) % 103;
}

/** Encodes text as a Code 128 bit string. Subset B throughout, plus subset C for long digit runs. */
export function encodeCode128(text: string): string {
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw unsupported(`Code 128 can only hold printable ASCII; "${ch}" is not. Use a QR code for anything else.`);
    }
  }
  const values: number[] = [];
  let index = 0;
  // Subset C packs two digits into one character, so a long run of digits is worth switching for.
  const digitRun = (from: number) => {
    let n = 0;
    while (from + n < text.length && text[from + n]! >= "0" && text[from + n]! <= "9") n += 1;
    return n;
  };
  let subset: "B" | "C" = digitRun(0) >= 4 && digitRun(0) % 2 === 0 ? "C" : "B";
  values.push(subset === "C" ? 105 : 104); // START C / START B
  while (index < text.length) {
    if (subset === "C") {
      const run = digitRun(index);
      if (run >= 2) {
        values.push(Number(text.slice(index, index + 2)));
        index += 2;
        continue;
      }
      values.push(100); // CODE B
      subset = "B";
      continue;
    }
    const run = digitRun(index);
    if (run >= 6 && run % 2 === 0) {
      values.push(99); // CODE C
      subset = "C";
      continue;
    }
    values.push(text.charCodeAt(index) - 32);
    index += 1;
  }
  values.push(code128Checksum(values));
  values.push(106); // STOP
  let bits = "";
  for (const value of values) {
    const pattern = CODE128_PATTERNS[value];
    if (!pattern) throw unsupported("This text could not be encoded as Code 128.");
    let dark = true;
    for (const width of pattern) {
      bits += (dark ? "1" : "0").repeat(Number(width));
      dark = !dark;
    }
  }
  return bits + "11"; // the stop character's final two bars
}

export function encodeEan(digits: string, symbology: "ean13" | "ean8" | "upca"): { bits: string; value: string } {
  const wanted = symbology === "ean8" ? 8 : symbology === "upca" ? 12 : 13;
  const clean = digits.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(clean)) throw unsupported(`${SYMBOLOGY_LABELS[symbology]} holds digits only.`);
  let full: string;
  if (clean.length === wanted - 1) full = clean + eanCheckDigit(clean);
  else if (clean.length === wanted) {
    const expected = eanCheckDigit(clean.slice(0, -1));
    if (Number(clean.slice(-1)) !== expected) {
      throw unsupported(`That check digit is wrong: ${clean.slice(0, -1)} should end in ${expected}, not ${clean.slice(-1)}.`);
    }
    full = clean;
  } else {
    throw unsupported(`${SYMBOLOGY_LABELS[symbology]} needs ${wanted - 1} or ${wanted} digits; that is ${clean.length}.`);
  }

  // UPC-A is EAN-13 with a leading zero, which is why one encoder covers both.
  const digits13 = symbology === "upca" ? `0${full}` : full;
  if (symbology === "ean8") {
    let bits = "101";
    for (const ch of digits13.slice(0, 4)) bits += EAN_LEFT_ODD[Number(ch)];
    bits += "01010";
    for (const ch of digits13.slice(4)) bits += EAN_RIGHT[Number(ch)];
    return { bits: bits + "101", value: full };
  }
  const parity = EAN13_PARITY[Number(digits13[0])]!;
  let bits = "101";
  for (const [i, ch] of [...digits13.slice(1, 7)].entries()) {
    bits += parity[i] === "E" ? EAN_LEFT_EVEN[Number(ch)] : EAN_LEFT_ODD[Number(ch)];
  }
  bits += "01010";
  for (const ch of digits13.slice(7)) bits += EAN_RIGHT[Number(ch)];
  return { bits: bits + "101", value: full };
}

export function encodeCode39(text: string): string {
  const upper = text.toUpperCase();
  for (const ch of upper) {
    if (!CODE39_PATTERNS[ch]) {
      throw unsupported(`Code 39 cannot hold "${ch}". It allows A-Z, 0-9, space and - . $ / + %.`);
    }
  }
  return [...`*${upper}*`].map((ch) => CODE39_PATTERNS[ch]!).join("0");
}

export function encodeItf14(digits: string): { bits: string; value: string } {
  const clean = digits.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(clean)) throw unsupported("ITF-14 holds digits only.");
  const full = clean.length === 13 ? clean + eanCheckDigit(clean) : clean;
  if (full.length !== 14) throw unsupported(`ITF-14 needs 13 or 14 digits; that is ${clean.length}.`);
  // Interleaved 2 of 5: five bars for one digit interleaved with five spaces for the next.
  const widths = ["nnwwn", "wnnnw", "nwnnw", "wwnnn", "nnwnw", "wnwnn", "nwwnn", "nnnww", "wnnwn", "nwnwn"];
  let bits = "1010"; // start
  for (let i = 0; i < full.length; i += 2) {
    const bars = widths[Number(full[i])]!;
    const spaces = widths[Number(full[i + 1])]!;
    for (let k = 0; k < 5; k += 1) {
      bits += "1".repeat(bars[k] === "w" ? 3 : 1);
      bits += "0".repeat(spaces[k] === "w" ? 3 : 1);
    }
  }
  return { bits: bits + "11101", value: full };
}

export interface BarcodeRender {
  svg: string;
  modules: number;
  value: string;
}

/** Bit string to SVG: one rect per run of dark modules, so the file stays small. */
export function barcodeSvg(
  bits: string,
  {
    value,
    height,
    moduleWidth,
    quietZone,
    dark,
    light,
    showText,
    label,
  }: { value: string; height: number; moduleWidth: number; quietZone: number; dark: string; light: string; showText: boolean; label: string },
): string {
  const textHeight = showText ? Math.max(12, Math.round(height * 0.18)) : 0;
  const width = (bits.length + quietZone * 2) * moduleWidth;
  const total = height + textHeight + (showText ? 4 : 0);
  const rects: string[] = [];
  let index = 0;
  while (index < bits.length) {
    if (bits[index] === "0") {
      index += 1;
      continue;
    }
    let run = 0;
    while (index + run < bits.length && bits[index + run] === "1") run += 1;
    rects.push(`<rect x="${((quietZone + index) * moduleWidth).toFixed(2)}" y="0" width="${(run * moduleWidth).toFixed(2)}" height="${height}"/>`);
    index += run;
  }
  const caption = showText
    ? `<text x="${(width / 2).toFixed(2)}" y="${total - 2}" fill="${dark}" font-family="ui-monospace, monospace" font-size="${textHeight}" text-anchor="middle" letter-spacing="1.5">${label}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${total.toFixed(0)}" viewBox="0 0 ${width.toFixed(2)} ${total.toFixed(2)}" role="img" aria-label="${SYMBOLOGY_LABELS.code128} ${value}">
${light === "transparent" ? "" : `<rect width="${width.toFixed(2)}" height="${total.toFixed(2)}" fill="${light}"/>`}
<g fill="${dark}">${rects.join("")}</g>
${caption}
</svg>`;
}

export const barcodeGeneratorExecutor: Executor = (input, options) =>
  runQrTool("barcode-generator", async () => {
    const symbology = optEnum(options, "symbology", BARCODE_SYMBOLOGIES, "code128");
    const raw = textInput(input, "the text or number to encode");
    let bits: string;
    let value = raw.trim();
    if (symbology === "code128") bits = encodeCode128(value);
    else if (symbology === "code39") bits = encodeCode39(value);
    else if (symbology === "itf14") ({ bits, value } = encodeItf14(value));
    else ({ bits, value } = encodeEan(value, symbology));

    const height = optNumber(options, "height", 120, { min: 20, max: 600 });
    const moduleWidth = optNumber(options, "moduleWidth", 2, { min: 1, max: 12 });
    const quietZone = optNumber(options, "quietZone", 10, { min: 0, max: 40 });
    const dark = normaliseColor(optString(options, "dark", "#000000"), "#000000");
    const light = normaliseColor(optString(options, "light", "#ffffff"), "#ffffff");
    const showText = optBool(options, "showText", true);
    const svg = barcodeSvg(bits, { value, height, moduleWidth, quietZone, dark, light, showText, label: value });

    const format = optEnum(options, "format", ["svg", "png"] as const, "svg");
    const files: OutputFile[] = [];
    if (format === "svg") files.push({ name: `barcode-${value}.svg`, mimeType: "image/svg+xml", bytes: new TextEncoder().encode(svg) });
    else {
      const sharp = (await import("sharp")).default;
      files.push({ name: `barcode-${value}.png`, mimeType: "image/png", bytes: new Uint8Array(await sharp(Buffer.from(svg), { density: 216 }).png().toBuffer()) });
    }
    return {
      ok: true,
      output: { symbology, value, modules: bits.length, result: value },
      summary: `${SYMBOLOGY_LABELS[symbology]} barcode for ${value}${value !== raw.trim() ? " (check digit added)" : ""}, ${bits.length} modules wide. Print it at least ${((bits.length + quietZone * 2) * moduleWidth) / 96}″ wide so a scanner can read it.`,
      files,
    };
  });

// ---- batch QR (mail merge) ---------------------------------------------------------------------

/** One QR per non-empty line, or per row of the chosen CSV column. */
export function batchRows(text: string, column: string, hasHeader: boolean): { value: string; label: string }[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) throw unsupported("There is nothing to make codes from. Paste one value per line, or upload a CSV.");
  const looksCsv = lines[0]!.includes(",") || lines[0]!.includes("\t");
  if (!looksCsv) return lines.map((line, i) => ({ value: line.trim(), label: `code-${i + 1}` }));

  const split = (line: string) => {
    // A small CSV splitter: enough for quoted fields, which is all a QR mail-merge needs.
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else if (ch === '"') quoted = false;
        else current += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === "," || ch === "\t") {
        cells.push(current);
        current = "";
      } else current += ch;
    }
    cells.push(current);
    return cells.map((c) => c.trim());
  };

  const rows = lines.map(split);
  const header = hasHeader ? rows[0]! : null;
  const body = hasHeader ? rows.slice(1) : rows;
  let valueIndex = 0;
  let labelIndex = -1;
  if (column.trim() !== "") {
    const wanted = column.trim().toLowerCase();
    valueIndex = header ? header.findIndex((h) => h.toLowerCase() === wanted) : -1;
    if (valueIndex < 0 && /^\d+$/.test(wanted)) valueIndex = Number(wanted) - 1;
    if (valueIndex < 0) {
      throw unsupported(`There is no column "${column}"${header ? `. This file has: ${header.join(", ")}.` : ". Use a column number instead."}`);
    }
  }
  if (header) {
    labelIndex = header.findIndex((h) => /^(name|label|title|id)$/i.test(h));
    if (labelIndex === valueIndex) labelIndex = -1;
  }
  return body
    .map((row, i) => ({
      value: (row[valueIndex] ?? "").trim(),
      label: (labelIndex >= 0 ? row[labelIndex] : "")?.trim() || `code-${i + 1}`,
    }))
    .filter((r) => r.value !== "");
}

function safeCodeName(label: string, index: number, total: number, format: QrFormat): string {
  const stem = label.replace(/[^A-Za-z0-9 _.-]+/g, "-").replace(/^[-.\s]+|[-\s]+$/g, "").slice(0, 60);
  return `${String(index + 1).padStart(String(total).length, "0")}-${stem || "code"}.${format}`;
}

export const batchQrExecutor: Executor = (input, options, ctx) =>
  runQrTool("batch-qr-generator", async () => {
    let text: string;
    if (typeof input === "string" && input.trim() !== "") text = input;
    else if (Array.isArray(input) && input.length > 0 && ctx) {
      text = new TextDecoder("utf-8", { fatal: false }).decode(await ctx.readFile(input[0]!));
    } else throw unsupported("Paste one value per line, or upload a CSV.");

    const rows = batchRows(text, optString(options, "column", ""), optBool(options, "header", true));
    const limit = optNumber(options, "limit", 500, { min: 1, max: 2000 });
    if (rows.length > limit) throw unsupported(`That is ${rows.length} codes, over the ${limit} limit. Split the list, or raise the limit.`);
    const prefix = optString(options, "prefix", "");
    const format = optEnum(options, "format", ["png", "svg"] as const, "png");
    const style = styleFromOptions(options);

    const files: OutputFile[] = [];
    const sheetCells: string[] = [];
    for (const [index, row] of rows.entries()) {
      const value = `${prefix}${row.value}`;
      const rendered = await renderQr(value, style, format);
      files.push({ name: safeCodeName(row.label, index, rows.length, format), mimeType: rendered.mimeType, bytes: rendered.bytes });
      if (format === "svg") {
        sheetCells.push(
          `<figure>${new TextDecoder().decode(rendered.bytes).replace(/<\?xml[^>]*\?>/, "")}<figcaption>${row.label.replace(/[<&]/g, "")}</figcaption></figure>`,
        );
      } else {
        sheetCells.push(
          `<figure><img src="data:image/png;base64,${Buffer.from(rendered.bytes).toString("base64")}" alt="${row.label.replace(/[<&"]/g, "")}"><figcaption>${row.label.replace(/[<&]/g, "")}</figcaption></figure>`,
        );
      }
      ctx?.reportProgress?.((index + 1) / rows.length);
    }

    if (optBool(options, "printSheet", true)) {
      const sheet = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>QR codes</title>
<style>@page{size:A4;margin:12mm}body{font:13px/1.4 ui-sans-serif,system-ui,sans-serif;margin:0;color:#111}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10mm}
figure{margin:0;text-align:center;break-inside:avoid}figure svg,figure img{width:100%;height:auto;display:block}
figcaption{margin-top:3mm;font-size:11px;word-break:break-word}</style></head>
<body><main>${sheetCells.join("")}</main></body></html>`;
      files.push({ name: "print-sheet.html", mimeType: "text/html; charset=utf-8", bytes: new TextEncoder().encode(sheet) });
    }

    return {
      ok: true,
      output: { count: rows.length, values: rows.slice(0, 50), result: `${rows.length} codes` },
      summary: `Generated ${rows.length} QR code${rows.length === 1 ? "" : "s"}${prefix ? ` with the prefix "${prefix}"` : ""}. The print sheet in the ZIP lays them out for A4 with their labels underneath.`,
      files: [{ name: "qr-codes.zip", mimeType: ZIP_MIME, bytes: createZip(files) }],
    };
  });

// ---- logo QR -----------------------------------------------------------------------------------

export const logoQrExecutor: Executor = (input, options) =>
  runQrTool("logo-qr-code", async () => {
    const text = textInput(input, "the text or link the code should hold");
    const logo = optString(options, "logo", "");
    if (logo === "") throw unsupported("Choose a logo image to put in the middle of the code.");
    const requested = optNumber(options, "logoScale", 22, { min: 8, max: 35 }) / 100;

    // High error correction is what makes a covered centre survivable: level H tolerates about 30%
    // of the code being unreadable, which is why the logo has to be paired with it.
    const style = {
      ...styleFromOptions(options),
      logo,
      logoScale: requested,
      ecc: "H" as const,
      size: optNumber(options, "size", 720, { min: 256, max: 2048 }),
    };

    // Render, decode, and shrink the logo until it scans — a promise the tool can actually keep.
    let scale = requested;
    let rendered = await renderQr(text, { ...style, logoScale: scale }, "png");
    let decoded = await decodeQrImage(rendered.bytes);
    const attempts: { logoScale: number; scanned: boolean }[] = [{ logoScale: scale, scanned: decoded?.text === text }];
    while (decoded?.text !== text && scale > 0.1) {
      scale = Math.round((scale - 0.03) * 100) / 100;
      rendered = await renderQr(text, { ...style, logoScale: scale }, "png");
      decoded = await decodeQrImage(rendered.bytes);
      attempts.push({ logoScale: scale, scanned: decoded?.text === text });
    }
    const scanned = decoded?.text === text;
    const modules = buildMatrix(text, "H").size;

    return {
      ok: true,
      output: { scanned, logoScale: scale, requestedScale: requested, modules, attempts, result: text },
      summary: scanned
        ? `Made a ${modules}×${modules} code with your logo at ${Math.round(scale * 100)}% of its width${scale < requested ? ` (reduced from ${Math.round(requested * 100)}% so it still scans)` : ""}, on error-correction level H. OneStop decoded the finished image to check — it reads back correctly.`
        : `The code was made, but OneStop could not decode it even with the logo down to ${Math.round(scale * 100)}%. Shorten the text, or use a smaller/simpler logo — and test it with a phone before printing.`,
      files: [{ name: "logo-qr.png", mimeType: rendered.mimeType, bytes: rendered.bytes }],
    };
  });


