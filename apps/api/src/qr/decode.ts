// QR decoding from an image (11-qr-tools.md).
//
// `jsQR` is a pure-JS decoder, so this works offline and in any Node build. It expects raw RGBA,
// which `sharp` gives us; the work here is making a photographed code readable: phones produce
// large, slightly rotated, unevenly lit pictures, so we retry at a few sizes, rotations and
// contrast settings before giving up.
import jsQR from "jsqr";
import sharp, { type Sharp } from "sharp";
import { PdfToolError } from "../pdf/errors.ts";
import { parsePayload, unsupported, type ParsedPayload } from "./formats.ts";

/** Decompression-bomb guard, matching the image tools' own ceiling. */
const MAX_INPUT_PIXELS = 120_000_000;
/** Decoding cost grows with area, so oversized photos are scaled down before the first attempt. */
const MAX_DECODE_SIDE = 1600;

export interface DecodeAttempt {
  /** How the image was transformed before this attempt, e.g. "rotated 90, high contrast". */
  variant: string;
}

export interface DecodedQr extends ParsedPayload {
  /** Which variant of the image finally decoded. */
  variant: string;
  /** Corner positions in the (possibly transformed) image, useful for a preview overlay. */
  corners: { x: number; y: number }[];
}

interface Raw {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

async function toRaw(image: Sharp): Promise<Raw> {
  // jsQR insists on exactly four channels; greyscale and thresholded variants would otherwise
  // come back as one or two, so the colourspace is forced before the alpha channel is added.
  const { data, info } = await image
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (data.length !== info.width * info.height * 4) {
    throw new Error(`unexpected raw layout: ${data.length} bytes for ${info.width}x${info.height}`);
  }
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

/** The transformations tried, in the order most likely to pay off first. */
function variants(base: Sharp): { name: string; make: () => Sharp }[] {
  return [
    { name: "as supplied", make: () => base.clone() },
    { name: "high contrast", make: () => base.clone().greyscale().normalise() },
    { name: "sharpened", make: () => base.clone().greyscale().normalise().sharpen() },
    { name: "black and white", make: () => base.clone().greyscale().threshold(128) },
    { name: "rotated 90", make: () => base.clone().rotate(90) },
    { name: "rotated 180", make: () => base.clone().rotate(180) },
    { name: "rotated 270", make: () => base.clone().rotate(270) },
    { name: "inverted", make: () => base.clone().negate({ alpha: false }) },
    {
      name: "enlarged",
      make: () =>
        base.clone().greyscale().normalise().resize({ width: 1000, withoutEnlargement: false }),
    },
  ];
}

/**
 * Reads the first QR code in an image. Returns null when there is none - callers turn that into
 * the user-facing "no QR code found" message, since it is not an error in the image itself.
 */
export async function decodeQrImage(bytes: Uint8Array): Promise<DecodedQr | null> {
  let base: Sharp;
  try {
    base = sharp(Buffer.from(bytes), {
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
    }).flatten({
      background: "#ffffff",
    });
    const meta = await base.metadata();
    if (!meta.width || !meta.height) throw new Error("no dimensions");
    if (Math.max(meta.width, meta.height) > MAX_DECODE_SIDE) {
      base = base.resize({
        width: meta.width >= meta.height ? MAX_DECODE_SIDE : undefined,
        height: meta.height > meta.width ? MAX_DECODE_SIDE : undefined,
        fit: "inside",
      });
    }
    // Materialise the (possibly resized) image once so each variant starts from the same pixels.
    base = sharp(await base.png().toBuffer(), { limitInputPixels: MAX_INPUT_PIXELS });
  } catch (err) {
    throw unsupported(
      "This image could not be read. It may be damaged or not really an image.",
      err,
    );
  }

  for (const variant of variants(base)) {
    let raw: Raw;
    try {
      raw = await toRaw(variant.make());
    } catch {
      continue;
    }
    let found: ReturnType<typeof jsQR>;
    try {
      found = jsQR(raw.data, raw.width, raw.height, { inversionAttempts: "attemptBoth" });
    } catch {
      // jsQR throws rather than returning null on some inputs; that is just "not this variant".
      continue;
    }
    if (found && found.data !== undefined) {
      const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = found.location;
      return {
        ...parsePayload(found.data),
        variant: variant.name,
        corners: [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner],
      };
    }
  }
  return null;
}

/** Decodes and insists on a result; used by the round-trip tests and by the scanner executor. */
export async function requireQrImage(bytes: Uint8Array): Promise<DecodedQr> {
  const result = await decodeQrImage(bytes);
  if (!result) {
    throw new PdfToolError(
      "UNSUPPORTED_INPUT",
      "No QR code was found in this image. Try a sharper, straighter photo with the whole code in frame.",
    );
  }
  return result;
}
