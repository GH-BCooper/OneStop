// A small BMP reader/writer (09-image-tools.md).
//
// The prebuilt `sharp` binaries read and write neither BMP (libvips only handles it through
// ImageMagick, which isn't bundled), yet BMP is one of the formats phase 04 accepts and the Format
// Converter offers. Uncompressed and bit-field BMPs at 1/4/8/16/24/32 bits cover what cameras,
// scanners and Paint produce; RLE-compressed files get a clear message instead.
import { PdfToolError } from "../pdf/errors.ts";
import { MAX_INPUT_PIXELS } from "./common.ts";

function bad(message = "This BMP file could not be read. It may be damaged."): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", message);
}

/** Decodes to top-down RGBA. */
export function decodeBmp(bytes: Uint8Array): {
  width: number;
  height: number;
  data: Buffer;
  hasAlpha: boolean;
} {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw bad();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataOffset = view.getUint32(10, true);
  const headerSize = view.getUint32(14, true);
  let width: number;
  let rawHeight: number;
  let bpp: number;
  let compression = 0;
  let colors = 0;
  if (headerSize === 12) {
    width = view.getUint16(18, true);
    rawHeight = view.getInt16(20, true);
    bpp = view.getUint16(24, true);
  } else {
    if (bytes.length < 54) throw bad();
    width = view.getInt32(18, true);
    rawHeight = view.getInt32(22, true);
    bpp = view.getUint16(28, true);
    compression = view.getUint32(30, true);
    colors = view.getUint32(46, true);
  }
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  if (width <= 0 || height === 0) throw bad();
  if (width * height > MAX_INPUT_PIXELS) throw new Error("Input image exceeds pixel limit");
  if (compression === 1 || compression === 2) {
    throw bad(
      "This BMP uses RLE compression, which OneStop can't read. Re-save it as an uncompressed BMP or PNG.",
    );
  }
  if (compression !== 0 && compression !== 3 && compression !== 6) throw bad();

  // Channel masks (BI_BITFIELDS) or the defaults for 16/32-bit.
  let masks: [number, number, number, number] | null = null;
  if (bpp === 16 || bpp === 32) {
    if (compression === 3 || compression === 6) {
      // Masks follow a 40-byte header, or sit at the same offset inside a V2–V5 header.
      masks = [view.getUint32(54, true), view.getUint32(58, true), view.getUint32(62, true), 0];
      if (headerSize >= 56 || compression === 6) masks[3] = view.getUint32(66, true);
    } else {
      masks =
        bpp === 16 ? [0x7c00, 0x03e0, 0x001f, 0] : [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000];
    }
  }

  let palette: number[][] = [];
  if (bpp <= 8) {
    const entries = colors || 1 << bpp;
    const entrySize = headerSize === 12 ? 3 : 4;
    const start = 14 + headerSize;
    for (let i = 0; i < entries; i += 1) {
      const p = start + i * entrySize;
      if (p + 2 >= bytes.length) break;
      palette.push([bytes[p + 2]!, bytes[p + 1]!, bytes[p]!]);
    }
    if (palette.length === 0) palette = [[0, 0, 0]];
  } else if (bpp !== 16 && bpp !== 24 && bpp !== 32) {
    throw bad();
  }

  const stride = Math.floor((bpp * width + 31) / 32) * 4;
  if (dataOffset + stride * height > bytes.length) throw bad();
  const out = Buffer.alloc(width * height * 4);
  const channel = (value: number, mask: number) => {
    if (!mask) return 255;
    const shift = Math.log2(mask & -mask);
    const max = mask >>> shift;
    return Math.round((((value & mask) >>> shift) * 255) / max);
  };
  let sawAlpha = false;
  for (let y = 0; y < height; y += 1) {
    const row = dataOffset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (bpp <= 8) {
        const bitPos = x * bpp;
        const byte = bytes[row + (bitPos >> 3)]!;
        const index = (byte >> (8 - bpp - (bitPos & 7))) & ((1 << bpp) - 1);
        const c = palette[index] ?? palette[0]!;
        out[o] = c[0]!;
        out[o + 1] = c[1]!;
        out[o + 2] = c[2]!;
        out[o + 3] = 255;
      } else if (bpp === 24) {
        const p = row + x * 3;
        out[o] = bytes[p + 2]!;
        out[o + 1] = bytes[p + 1]!;
        out[o + 2] = bytes[p]!;
        out[o + 3] = 255;
      } else {
        const v =
          bpp === 16 ? view.getUint16(row + x * 2, true) : view.getUint32(row + x * 4, true);
        const [rm, gm, bm, am] = masks!;
        out[o] = channel(v, rm);
        out[o + 1] = channel(v, gm);
        out[o + 2] = channel(v, bm);
        out[o + 3] = am ? channel(v, am) : 255;
        if (am && out[o + 3] !== 0) sawAlpha = true;
      }
    }
  }
  // Many 32-bit BMPs declare an alpha mask but leave it all zero: treat that as opaque.
  let hasAlpha = false;
  if (masks?.[3]) {
    if (!sawAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255;
    else
      for (let i = 3; i < out.length; i += 4)
        if (out[i] !== 255) {
          hasAlpha = true;
          break;
        }
  }
  return { width, height, data: out, hasAlpha };
}

/**
 * Encodes RGBA as a BMP: 24-bit when fully opaque (what every viewer reads), otherwise 32-bit
 * BITMAPV4 with an alpha mask.
 */
export function encodeBmp(rgba: Buffer, width: number, height: number): Buffer {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4)
    if (rgba[i] !== 255) {
      opaque = false;
      break;
    }
  const bpp = opaque ? 24 : 32;
  const headerSize = opaque ? 40 : 108;
  const stride = Math.floor((bpp * width + 31) / 32) * 4;
  const offset = 14 + headerSize;
  const size = offset + stride * height;
  const out = Buffer.alloc(size);
  out.write("BM", 0, "ascii");
  out.writeUInt32LE(size, 2);
  out.writeUInt32LE(offset, 10);
  out.writeUInt32LE(headerSize, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(bpp, 28);
  out.writeUInt32LE(opaque ? 0 : 3, 30);
  out.writeUInt32LE(stride * height, 34);
  out.writeInt32LE(2835, 38); // 72 DPI
  out.writeInt32LE(2835, 42);
  if (!opaque) {
    out.writeUInt32LE(0x00ff0000, 54);
    out.writeUInt32LE(0x0000ff00, 58);
    out.writeUInt32LE(0x000000ff, 62);
    out.writeUInt32LE(0xff000000, 66);
    out.write("BGRs", 70, "ascii"); // LCS_sRGB, stored little-endian
  }
  for (let y = 0; y < height; y += 1) {
    const row = offset + (height - 1 - y) * stride;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const p = row + x * (bpp / 8);
      out[p] = rgba[i + 2]!;
      out[p + 1] = rgba[i + 1]!;
      out[p + 2] = rgba[i]!;
      if (!opaque) out[p + 3] = rgba[i + 3]!;
    }
  }
  return out;
}
