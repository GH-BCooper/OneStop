// Image Metadata Viewer (Features 6.20) and Remove Image Metadata (6.21).
//
// The viewer reports the file's basics plus every EXIF field (camera, lens, exposure, dates, GPS
// as decimal coordinates), PNG text chunks and whether XMP/IPTC/ICC blocks are present.
//
// The remover is lossless where it can be: JPEG and PNG files have their metadata segments/chunks
// cut out byte-for-byte, so the picture itself is not re-compressed. A JPEG whose EXIF says
// "rotate me" is re-encoded upright first (once the tag is gone nothing else would rotate it).
// Other formats are re-encoded without metadata. The ICC colour profile is kept by default —
// it describes colours, not the owner — so the image looks identical afterwards.
import type { Executor } from "@onestop/tool-registry";
import exifReader from "exif-reader";
import sharp from "sharp";
import {
  baseName,
  eachImage,
  encode,
  open,
  optBool,
  outFile,
  outputName,
  readImage,
  runImageTool,
  sameFormat,
  type ImageInput,
} from "./common.ts";

export const METADATA_VIEWER_TOOL_ID = "image-metadata-viewer";
export const METADATA_REMOVER_TOOL_ID = "remove-image-metadata";

export interface ImageMetadataReport {
  file: { name: string; format: string; size: number };
  image: {
    width: number;
    height: number;
    frames: number;
    channels?: number;
    colourSpace?: string;
    bitDepth?: string;
    hasAlpha: boolean;
    dpi?: number;
    orientation?: number;
  };
  exif: Record<string, Record<string, unknown>> | null;
  gps: { latitude: number; longitude: number; altitude?: number } | null;
  text: Record<string, string> | null;
  blocks: { exif: boolean; xmp: boolean; iptc: boolean; icc: boolean };
  xmp?: string;
}

function plainValue(value: unknown): unknown {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value.toISOString().replace(".000Z", "Z");
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = value as Uint8Array;
    const text = Buffer.from(bytes).toString("latin1").replace(/\0+$/, "");
    return /^[\x20-\x7e]*$/.test(text) && text.length > 0
      ? text
      : `(${bytes.length} bytes of binary data)`;
  }
  if (Array.isArray(value)) return value.map(plainValue);
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

/** Degrees/minutes/seconds + reference → signed decimal degrees. */
function dmsToDecimal(dms: unknown, ref: unknown): number | null {
  if (!Array.isArray(dms) || dms.length < 1) return null;
  const [d = 0, m = 0, s = 0] = dms.map(Number);
  if (![d, m, s].every(Number.isFinite)) return null;
  const sign = ref === "S" || ref === "W" ? -1 : 1;
  return Math.round(sign * (d + m / 60 + s / 3600) * 1e6) / 1e6;
}

export async function readImageMetadata(image: ImageInput): Promise<ImageMetadataReport> {
  const report: ImageMetadataReport = {
    file: { name: image.ref.name, format: image.format.toUpperCase(), size: image.bytes.length },
    image: { width: image.width, height: image.height, frames: 1, hasAlpha: image.hasAlpha },
    exif: null,
    gps: null,
    text: null,
    blocks: { exif: false, xmp: false, iptc: false, icc: false },
  };
  if (image.raw) return report; // BMP/HEIC: decoded without their metadata blocks
  const meta = await sharp(image.source, { animated: true }).metadata();
  report.image = {
    ...report.image,
    frames: meta.pages ?? 1,
    ...(meta.channels ? { channels: meta.channels } : {}),
    ...(meta.space ? { colourSpace: meta.space } : {}),
    ...(meta.depth ? { bitDepth: meta.depth } : {}),
    ...(meta.density ? { dpi: meta.density } : {}),
    ...(meta.orientation ? { orientation: meta.orientation } : {}),
  };
  report.blocks = {
    exif: Boolean(meta.exif),
    xmp: Boolean(meta.xmp),
    iptc: Boolean(meta.iptc),
    icc: Boolean(meta.icc),
  };
  if (meta.xmp) report.xmp = meta.xmp.toString("utf8").slice(0, 20000);
  if (meta.comments?.length) {
    report.text = Object.fromEntries(meta.comments.map((c) => [c.keyword, c.text]));
  }
  if (meta.exif) {
    try {
      const parsed = exifReader(meta.exif) as unknown as Record<string, unknown>;
      const exif: Record<string, Record<string, unknown>> = {};
      for (const [group, tags] of Object.entries(parsed)) {
        if (!tags || typeof tags !== "object") continue;
        exif[group] = Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, plainValue(v)]));
      }
      report.exif = exif;
      const gps = parsed.GPSInfo as Record<string, unknown> | undefined;
      if (gps) {
        const latitude = dmsToDecimal(gps.GPSLatitude, gps.GPSLatitudeRef);
        const longitude = dmsToDecimal(gps.GPSLongitude, gps.GPSLongitudeRef);
        if (latitude !== null && longitude !== null) {
          const alt =
            typeof gps.GPSAltitude === "number"
              ? gps.GPSAltitude * (gps.GPSAltitudeRef === 1 ? -1 : 1)
              : undefined;
          report.gps = { latitude, longitude, ...(alt !== undefined ? { altitude: alt } : {}) };
        }
      }
    } catch (err) {
      console.error("[images:metadata] unreadable EXIF block", err);
      report.exif = { error: { message: "The EXIF block is damaged and could not be read." } };
    }
  }
  return report;
}

function describe(report: ImageMetadataReport): string {
  const parts = [`${report.file.format}, ${report.image.width} × ${report.image.height} px.`];
  const img = report.exif?.Image ?? {};
  const photo = report.exif?.Photo ?? {};
  const camera = [img.Make, img.Model].filter((v) => typeof v === "string" && v.trim()).join(" ");
  if (camera) parts.push(`Camera: ${camera}.`);
  const taken = photo.DateTimeOriginal ?? img.DateTime;
  if (typeof taken === "string") parts.push(`Taken: ${taken}.`);
  if (report.gps)
    parts.push(`Contains GPS location (${report.gps.latitude}, ${report.gps.longitude}).`);
  const blocks = Object.entries(report.blocks)
    .filter(([, v]) => v)
    .map(([k]) => k.toUpperCase());
  parts.push(
    blocks.length
      ? `Metadata blocks: ${blocks.join(", ")}.`
      : "No EXIF, XMP, IPTC or ICC metadata found.",
  );
  return parts.join(" ");
}

export const metadataViewerExecutor: Executor = (input, _options, ctx) =>
  runImageTool(METADATA_VIEWER_TOOL_ID, async () => {
    const image = await readImage(input, ctx);
    const report = await readImageMetadata(image);
    const json = new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`);
    return {
      ok: true,
      output: report,
      summary: describe(report),
      files: [
        {
          name: `${baseName(image.ref.name)}-metadata.json`,
          mimeType: "application/json",
          bytes: json,
        },
      ],
    };
  });

// ---- removal ----------------------------------------------------------------------------------

/**
 * Drops APPn (except JFIF APP0, Adobe APP14 which defines CMYK colour, and optionally the ICC APP2)
 * and COM segments from a JPEG. Returns null if the file doesn't parse, so the caller re-encodes.
 */
export function stripJpeg(bytes: Uint8Array, keepIcc: boolean): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xda) {
      parts.push(bytes.subarray(i)); // start of scan: the rest is image data
      return Buffer.concat(parts);
    }
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (length < 2 || i + 2 + length > bytes.length) return null;
    const segment = bytes.subarray(i, i + 2 + length);
    const id = Buffer.from(bytes.subarray(i + 4, i + 4 + 12)).toString("latin1");
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep =
      (!isApp && marker !== 0xfe) ||
      (marker === 0xe0 && id.startsWith("JFIF")) ||
      (marker === 0xee && id.startsWith("Adobe")) ||
      (keepIcc && marker === 0xe2 && id.startsWith("ICC_PROFILE"));
    if (keep) parts.push(segment);
    i += 2 + length;
  }
  return null;
}

const PNG_DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

/** Drops text, EXIF and timestamp chunks from a PNG (and iCCP unless kept). Null if malformed. */
export function stripPng(bytes: Uint8Array, keepIcc: boolean): Uint8Array | null {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length =
      ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0;
    const type = Buffer.from(bytes.subarray(i + 4, i + 8)).toString("latin1");
    const end = i + 12 + length;
    if (end > bytes.length) return null;
    if (!PNG_DROP.has(type) && (keepIcc || type !== "iCCP")) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === "IEND") return Buffer.concat(parts);
  }
  return null;
}

export async function removeImageMetadata(
  image: ImageInput,
  { keepIcc = true }: { keepIcc?: boolean } = {},
): Promise<{ bytes: Uint8Array; lossless: boolean; format: ReturnType<typeof sameFormat> }> {
  const format = sameFormat(image);
  if (!image.raw) {
    const orientation = (await sharp(image.source).metadata()).orientation ?? 1;
    const stripped =
      image.format === "jpg" && orientation === 1
        ? stripJpeg(image.bytes, keepIcc)
        : image.format === "png"
          ? stripPng(image.bytes, keepIcc)
          : null;
    if (stripped) return { bytes: stripped, lossless: true, format };
  }
  // sharp writes no metadata unless asked; the ICC profile is carried over on request.
  const bytes = await encode(open(image, { animated: true }), format, { quality: 95, keepIcc });
  return { bytes, lossless: false, format };
}

export const metadataRemoverExecutor: Executor = eachImage(
  METADATA_REMOVER_TOOL_ID,
  async (image, options) => {
    const keepIcc = optBool(options, "keepIcc", true);
    const before = image.raw ? null : await sharp(image.source).metadata();
    const { bytes, lossless, format } = await removeImageMetadata(image, { keepIcc });
    const found = before
      ? [
          before.exif && "EXIF",
          before.xmp && "XMP",
          before.iptc && "IPTC",
          before.comments?.length && "text",
          !keepIcc && before.icc && "ICC",
        ].filter((v): v is string => Boolean(v))
      : [];
    return {
      file: outFile(outputName(image, "clean", format), format, bytes),
      note: `${found.length ? `Removed ${found.join(", ")} metadata` : "No personal metadata was found; saved a clean copy"}${lossless ? " without re-compressing the picture" : ""}.`,
    };
  },
  { verb: "Cleaned", zipStem: "clean-images" },
);
