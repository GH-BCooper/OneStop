// Batch and layout image tools from 21-roadmap-expansion.md (roadmap §1.4): the Favicon Set
// Generator, the Social Media Preset Resizer, the Collage Maker, the Batch Renamer, the Sprite Sheet
// Generator/Splitter and the Photo Map Viewer.
//
// Every one of them is `sharp` composite/extract/resize work plus a manifest, so nothing new is
// installed. The Photo Map Viewer is the only one that touches the network at all, and only to open
// a map link the visitor clicks — the EXIF reading itself is entirely local.
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { createZip, ZIP_MIME } from "../pdf/zip.ts";
import {
  BLACK,
  MIME,
  TRANSPARENT,
  WHITE,
  assertOutputSize,
  baseName,
  countLabel,
  encode,
  formatBytes,
  open,
  optBool,
  optEnum,
  optNumber,
  optString,
  outFile,
  packageFiles,
  parseColor,
  plural,
  readImages,
  rgbaObject,
  runImageTool,
  sameFormat,
  throwIfAborted,
  unsupported,
  type ImageFormat,
  type ImageInput,
} from "./common.ts";
import { readImageMetadata } from "./metadata.ts";

// ---- favicon / app icon set --------------------------------------------------------------------

/**
 * The set a site actually needs in 2026: a couple of PNG favicons, the Apple touch icon, the two
 * PWA manifest icons, a maskable one with safe-area padding, and a multi-size .ico for old browsers.
 */
export const FAVICON_SIZES = [16, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512] as const;
const ICO_SIZES = [16, 32, 48] as const;

/** A .ico container around PNG frames — the format Windows and old browsers both accept. */
export function buildIco(frames: { size: number; png: Uint8Array }[]): Uint8Array {
  const count = frames.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(count, 4);
  let offset = header.length;
  for (const [i, frame] of frames.entries()) {
    const entry = 6 + i * 16;
    header.writeUInt8(frame.size >= 256 ? 0 : frame.size, entry); // 0 means 256
    header.writeUInt8(frame.size >= 256 ? 0 : frame.size, entry + 1);
    header.writeUInt8(0, entry + 2); // palette
    header.writeUInt8(0, entry + 3); // reserved
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(frame.png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.png.length;
  }
  return new Uint8Array(Buffer.concat([header, ...frames.map((f) => Buffer.from(f.png))]));
}

export const faviconSetExecutor: Executor = (input, options, ctx) =>
  runImageTool("favicon-set-generator", async () => {
    const [image] = await readImages(input, ctx, { max: 1 });
    const name = optString(options, "appName", "").trim() || baseName(image!.ref.name);
    const themeColor = optString(options, "themeColor", "#111417") || "#111417";
    const background = optBool(options, "transparent", true) ? TRANSPARENT : parseColor(optString(options, "background", "#ffffff"), WHITE);
    const rounded = optBool(options, "rounded", false);

    const square = async (size: number, padding = 0) => {
      const inner = Math.max(1, Math.round(size * (1 - padding * 2)));
      let pipeline = open(image!).resize(inner, inner, { fit: "contain", background: rgbaObject(background) });
      if (padding > 0 || inner !== size) {
        const pad = Math.round((size - inner) / 2);
        pipeline = pipeline.extend({ top: pad, bottom: size - inner - pad, left: pad, right: size - inner - pad, background: rgbaObject(background) });
      }
      if (rounded) {
        const radius = Math.round(size * 0.22);
        const mask = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
        );
        pipeline = pipeline.composite([{ input: mask, blend: "dest-in" }]);
      }
      return new Uint8Array(await encode(pipeline, "png", { effort: "max" }));
    };

    const files: OutputFile[] = [];
    const icoFrames: { size: number; png: Uint8Array }[] = [];
    for (const size of FAVICON_SIZES) {
      throwIfAborted(ctx?.signal);
      const png = await square(size);
      const label =
        size === 180 ? "apple-touch-icon.png" : size === 16 || size === 32 ? `favicon-${size}x${size}.png` : `icon-${size}x${size}.png`;
      files.push({ name: label, mimeType: MIME.png, bytes: png });
      if ((ICO_SIZES as readonly number[]).includes(size)) icoFrames.push({ size, png });
    }
    // Maskable icons get 10% safe-area padding so Android's mask never clips the artwork.
    files.push({ name: "icon-512-maskable.png", mimeType: MIME.png, bytes: await square(512, 0.1) });
    files.push({ name: "favicon.ico", mimeType: "image/x-icon", bytes: buildIco(icoFrames) });

    const manifest = {
      name,
      short_name: name.slice(0, 12),
      icons: [
        { src: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
      theme_color: themeColor,
      background_color: themeColor,
      display: "standalone",
    };
    files.push({ name: "manifest.webmanifest", mimeType: "application/manifest+json", bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n") });
    const html = `<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="${themeColor}">
`;
    files.push({ name: "head-snippet.html", mimeType: "text/html; charset=utf-8", bytes: new TextEncoder().encode(html) });

    if (image!.width < 512 || image!.height < 512) {
      // Say it rather than silently upscaling into something blurry.
      return {
        ok: true,
        output: { files: files.map((f) => f.name), sizes: FAVICON_SIZES, result: `${files.length} files` },
        summary: `Built a ${files.length}-file icon set. Your source is only ${image!.width} × ${image!.height}, so the 512px icons are upscaled and will look soft — start from 512 × 512 or larger for a crisp set.`,
        files: [{ name: `${baseName(image!.ref.name)}-icons.zip`, mimeType: ZIP_MIME, bytes: createZip(files) }],
      };
    }
    return {
      ok: true,
      output: { files: files.map((f) => f.name), sizes: FAVICON_SIZES, result: `${files.length} files` },
      summary: `Built a ${files.length}-file icon set: PNG favicons, the Apple touch icon, PWA icons (including a maskable one), a multi-size favicon.ico, a web manifest and the <head> snippet to paste in.`,
      files: [{ name: `${baseName(image!.ref.name)}-icons.zip`, mimeType: ZIP_MIME, bytes: createZip(files) }],
    };
  });

// ---- social media presets ---------------------------------------------------------------------

export interface SocialPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  group: string;
}

export const SOCIAL_PRESETS: readonly SocialPreset[] = [
  { id: "instagram-square", label: "Instagram post (square)", width: 1080, height: 1080, group: "Instagram" },
  { id: "instagram-portrait", label: "Instagram post (4:5)", width: 1080, height: 1350, group: "Instagram" },
  { id: "instagram-story", label: "Instagram story / Reel cover", width: 1080, height: 1920, group: "Instagram" },
  { id: "youtube-thumbnail", label: "YouTube thumbnail", width: 1280, height: 720, group: "YouTube" },
  { id: "youtube-banner", label: "YouTube channel banner", width: 2560, height: 1440, group: "YouTube" },
  { id: "open-graph", label: "Open Graph / link preview", width: 1200, height: 630, group: "Web" },
  { id: "twitter-card", label: "X / Twitter summary card", width: 1200, height: 675, group: "Web" },
  { id: "linkedin-banner", label: "LinkedIn cover", width: 1584, height: 396, group: "LinkedIn" },
  { id: "linkedin-post", label: "LinkedIn post", width: 1200, height: 627, group: "LinkedIn" },
  { id: "facebook-cover", label: "Facebook cover", width: 1640, height: 856, group: "Facebook" },
  { id: "tiktok", label: "TikTok / Shorts", width: 1080, height: 1920, group: "TikTok" },
  { id: "pinterest", label: "Pinterest pin", width: 1000, height: 1500, group: "Pinterest" },
  { id: "podcast-cover", label: "Podcast cover art", width: 3000, height: 3000, group: "Audio" },
  { id: "email-header", label: "Email header", width: 1200, height: 400, group: "Web" },
];

export const socialResizerExecutor: Executor = (input, options, ctx) =>
  runImageTool("social-media-preset-resizer", async () => {
    const images = await readImages(input, ctx, { max: 20 });
    const chosen = optString(options, "presets", "").trim();
    const wanted = chosen === ""
      ? SOCIAL_PRESETS.filter((p) => ["instagram-square", "instagram-story", "youtube-thumbnail", "open-graph", "linkedin-banner"].includes(p.id))
      : SOCIAL_PRESETS.filter((p) => chosen.split(/[,\s]+/).includes(p.id));
    if (wanted.length === 0) {
      throw unsupported(`No preset matched. Choose from: ${SOCIAL_PRESETS.map((p) => p.id).join(", ")}.`);
    }
    const fit = optEnum(options, "fit", ["cover", "contain"] as const, "cover");
    const format = optEnum(options, "format", ["png", "jpg", "webp", "same"] as const, "jpg");
    const background = parseColor(optString(options, "background", "#ffffff"), WHITE);
    const quality = optNumber(options, "quality", 88, { min: 40, max: 100 });

    const files: OutputFile[] = [];
    for (const image of images) {
      for (const preset of wanted) {
        throwIfAborted(ctx?.signal);
        assertOutputSize(preset.width, preset.height);
        const target: ImageFormat = format === "same" ? sameFormat(image, { needsAlpha: fit === "contain" && image.hasAlpha }) : format;
        const pipeline = open(image).resize(preset.width, preset.height, {
          fit,
          position: optEnum(options, "position", ["centre", "top", "bottom", "left", "right", "entropy", "attention"] as const, "attention"),
          background: rgbaObject(background),
          withoutEnlargement: false,
        });
        files.push(outFile(`${baseName(image.ref.name)}-${preset.id}.${target}`, target, new Uint8Array(await encode(pipeline, target, { quality, background }))));
      }
    }
    return {
      ok: true,
      output: {
        presets: wanted.map((p) => ({ ...p })),
        files: files.map((f) => ({ name: f.name, size: f.bytes.length })),
        result: `${files.length} images`,
      },
      summary: `Produced ${plural(files.length, "image")} across ${plural(wanted.length, "preset")}: ${wanted.map((p) => `${p.label} (${p.width}×${p.height})`).join(", ")}.`,
      files: packageFiles(files, options, "social-images"),
    };
  });

// ---- collage / contact sheet -------------------------------------------------------------------

export const collageExecutor: Executor = (input, options, ctx) =>
  runImageTool("collage-maker", async () => {
    const images = await readImages(input, ctx, { min: 2, max: 100 });
    const columnsOption = optNumber(options, "columns", 0, { min: 0, max: 20 });
    const columns = columnsOption > 0 ? columnsOption : Math.max(1, Math.ceil(Math.sqrt(images.length)));
    const rows = Math.ceil(images.length / columns);
    const cell = optNumber(options, "cellSize", 400, { min: 40, max: 2000 });
    const gap = optNumber(options, "gap", 8, { min: 0, max: 200 });
    const padding = optNumber(options, "padding", 16, { min: 0, max: 400 });
    const labels = optBool(options, "labels", false);
    const labelHeight = labels ? Math.max(18, Math.round(cell * 0.09)) : 0;
    const fit = optEnum(options, "fit", ["cover", "contain"] as const, "cover");
    const background = parseColor(optString(options, "background", "#ffffff"), WHITE);
    const format = optEnum(options, "format", ["png", "jpg", "webp"] as const, "jpg");

    const cellHeight = cell + labelHeight;
    const width = padding * 2 + columns * cell + (columns - 1) * gap;
    const height = padding * 2 + rows * cellHeight + (rows - 1) * gap;
    assertOutputSize(width, height);

    const sharp = (await import("sharp")).default;
    const composites: { input: Buffer; left: number; top: number }[] = [];
    for (const [index, image] of images.entries()) {
      throwIfAborted(ctx?.signal);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const left = padding + column * (cell + gap);
      const top = padding + row * (cellHeight + gap);
      const tile = await open(image)
        .resize(cell, cell, { fit, background: rgbaObject(background) })
        .png()
        .toBuffer();
      composites.push({ input: tile, left, top });
      if (labels) {
        const text = baseName(image.ref.name).slice(0, 34).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const svg = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${labelHeight}"><text x="${cell / 2}" y="${labelHeight * 0.72}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${Math.round(labelHeight * 0.62)}" fill="#3d4b57" text-anchor="middle">${text}</text></svg>`,
        );
        composites.push({ input: svg, left, top: top + cell });
      }
    }
    const canvas = sharp({ create: { width, height, channels: 4, background: rgbaObject(background) } }).composite(composites);
    const bytes = new Uint8Array(await encode(canvas, format, { quality: optNumber(options, "quality", 90, { min: 40, max: 100 }), background }));
    return {
      ok: true,
      output: { columns, rows, width, height, images: images.length, result: `${width} × ${height}` },
      summary: `Arranged ${countLabel(images.length)} into a ${columns} × ${rows} grid, ${width} × ${height} pixels (${formatBytes(bytes.length)}).`,
      files: [outFile(`collage.${format}`, format, bytes)],
    };
  });

// ---- batch renamer ----------------------------------------------------------------------------

/**
 * Supported placeholders. `{n}` is the sequence number, `{name}` the original stem. Anything else is
 * left alone so a literal brace in a name still works.
 */
export function applyNamePattern(
  pattern: string,
  { name, index, ext, total, date }: { name: string; index: number; ext: string; total: number; date: Date },
): string {
  const pad = String(total).length;
  return pattern
    .replace(/\{name\}/gi, name)
    .replace(/\{n(?::(\d+))?\}/gi, (_, width: string | undefined) => String(index).padStart(width ? Number(width) : pad, "0"))
    .replace(/\{ext\}/gi, ext)
    .replace(/\{date\}/gi, date.toISOString().slice(0, 10))
    .replace(/\{time\}/gi, date.toISOString().slice(11, 19).replace(/:/g, ""))
    .replace(/\{index\}/gi, String(index));
}

/** No path separators, no leading dots, no reserved Windows names — a rename must stay a file name. */
export function sanitizeFileName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[\\/]+/g, "-")
    // eslint-disable-next-line no-control-regex -- control characters are exactly what this strips
    .replace(/[<>:"|?*\u0000-\u001f]/g, "")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);
  if (cleaned === "" || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(cleaned)) return fallback;
  return cleaned;
}

export const batchRenamerExecutor: Executor = (input, options, ctx) =>
  runImageTool("batch-image-renamer", async () => {
    const images = await readImages(input, ctx, { min: 1, max: 500 });
    const pattern = optString(options, "pattern", "{name}-{n}") || "{name}-{n}";
    const start = optNumber(options, "start", 1, { min: 0, max: 100_000 });
    const step = optNumber(options, "step", 1, { min: 1, max: 1000 });
    const sortBy = optEnum(options, "sort", ["given", "name", "size"] as const, "given");
    const caseStyle = optEnum(options, "case", ["keep", "lower", "upper"] as const, "keep");
    const now = new Date();

    const ordered = [...images];
    if (sortBy === "name") ordered.sort((a, b) => a.ref.name.localeCompare(b.ref.name, undefined, { numeric: true }));
    if (sortBy === "size") ordered.sort((a, b) => b.bytes.length - a.bytes.length);

    const used = new Set<string>();
    const files: OutputFile[] = ordered.map((image, i) => {
      const ext = (image.format === "heic" ? "heic" : image.format) as string;
      let stem = applyNamePattern(pattern.replace(/\.[a-z0-9]{1,5}$/i, ""), {
        name: baseName(image.ref.name),
        index: start + i * step,
        ext,
        total: ordered.length,
        date: now,
      });
      if (caseStyle === "lower") stem = stem.toLowerCase();
      if (caseStyle === "upper") stem = stem.toUpperCase();
      let name = `${sanitizeFileName(stem, `image-${i + 1}`)}.${ext}`;
      // Two different sources can pattern to the same name; never silently drop one.
      let attempt = 2;
      while (used.has(name.toLowerCase())) {
        name = `${sanitizeFileName(stem, `image-${i + 1}`)}-${attempt}.${ext}`;
        attempt += 1;
      }
      used.add(name.toLowerCase());
      return { name, mimeType: MIME[(image.format === "heic" ? "jpg" : image.format) as ImageFormat], bytes: image.bytes };
    });
    return {
      ok: true,
      output: {
        renames: files.map((f, i) => ({ from: ordered[i]!.ref.name, to: f.name })),
        result: files.map((f, i) => `${ordered[i]!.ref.name} → ${f.name}`).join("\n"),
      },
      summary: `Renamed ${countLabel(files.length)} using "${pattern}" — for example "${ordered[0]!.ref.name}" became "${files[0]!.name}". The image data is untouched.`,
      files: [{ name: "renamed-images.zip", mimeType: ZIP_MIME, bytes: createZip(files) }],
    };
  });

// ---- sprite sheet -----------------------------------------------------------------------------

export interface SpriteFrame {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** CSS for a sheet, so the manifest is immediately usable rather than just informative. */
export function spriteCss(frames: SpriteFrame[], sheet: string, sheetWidth: number, sheetHeight: number): string {
  const rules = frames
    .map((f) => {
      const cls = f.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "sprite";
      return `.sprite-${cls} { width: ${f.width}px; height: ${f.height}px; background-position: -${f.x}px -${f.y}px; }`;
    })
    .join("\n");
  return `.sprite { background-image: url("${sheet}"); background-size: ${sheetWidth}px ${sheetHeight}px; background-repeat: no-repeat; display: inline-block; }\n${rules}\n`;
}

export const spriteSheetExecutor: Executor = (input, options, ctx) =>
  runImageTool("sprite-sheet-generator", async () => {
    const mode = optEnum(options, "mode", ["pack", "slice"] as const, "pack");
    const images = await readImages(input, ctx, { min: 1, max: 400 });
    const sharp = (await import("sharp")).default;

    if (mode === "slice") {
      const image = images[0]!;
      const columns = optNumber(options, "sliceColumns", 4, { min: 1, max: 64 });
      const rows = optNumber(options, "sliceRows", 4, { min: 1, max: 64 });
      const tileWidth = Math.floor(image.width / columns);
      const tileHeight = Math.floor(image.height / rows);
      if (tileWidth < 1 || tileHeight < 1) {
        throw unsupported(`This image is only ${image.width} × ${image.height}, too small to cut into ${columns} × ${rows} tiles.`);
      }
      const files: OutputFile[] = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          throwIfAborted(ctx?.signal);
          const tile = open(image).extract({ left: column * tileWidth, top: row * tileHeight, width: tileWidth, height: tileHeight });
          files.push(outFile(`${baseName(image.ref.name)}-${String(row * columns + column + 1).padStart(String(rows * columns).length, "0")}.png`, "png", new Uint8Array(await encode(tile, "png"))));
        }
      }
      return {
        ok: true,
        output: { tiles: files.length, tileWidth, tileHeight, result: `${files.length} tiles of ${tileWidth} × ${tileHeight}` },
        summary: `Cut into ${plural(files.length, "tile")} of ${tileWidth} × ${tileHeight}.${image.width % columns || image.height % rows ? " The image did not divide evenly, so a few pixels at the right/bottom edge were left out." : ""}`,
        files: [{ name: `${baseName(image.ref.name)}-tiles.zip`, mimeType: ZIP_MIME, bytes: createZip(files) }],
      };
    }

    const padding = optNumber(options, "padding", 2, { min: 0, max: 64 });
    const maxWidth = optNumber(options, "maxWidth", 2048, { min: 64, max: 8192 });
    const tiles: { image: ImageInput; buffer: Buffer; width: number; height: number }[] = [];
    for (const image of images) {
      throwIfAborted(ctx?.signal);
      const scale = optNumber(options, "tileSize", 0, { min: 0, max: 1024 });
      const pipeline = scale > 0 ? open(image).resize(scale, scale, { fit: "inside" }) : open(image);
      const { data, info } = await pipeline.png().toBuffer({ resolveWithObject: true });
      tiles.push({ image, buffer: data, width: info.width, height: info.height });
    }
    // Shelf packing, tallest first: simple, deterministic and tight enough for real sprite sheets.
    const sorted = [...tiles].sort((a, b) => b.height - a.height || b.width - a.width);
    const frames: (SpriteFrame & { buffer: Buffer })[] = [];
    let x = padding;
    let y = padding;
    let shelfHeight = 0;
    let sheetWidth = padding;
    for (const tile of sorted) {
      if (x + tile.width + padding > maxWidth && x > padding) {
        x = padding;
        y += shelfHeight + padding;
        shelfHeight = 0;
      }
      frames.push({ name: tile.image.ref.name, x, y, width: tile.width, height: tile.height, buffer: tile.buffer });
      x += tile.width + padding;
      shelfHeight = Math.max(shelfHeight, tile.height);
      sheetWidth = Math.max(sheetWidth, x);
    }
    const sheetHeight = y + shelfHeight + padding;
    assertOutputSize(sheetWidth, sheetHeight);
    const transparent = optBool(options, "transparent", true);
    const background = transparent ? TRANSPARENT : parseColor(optString(options, "background", "#000000"), BLACK);
    const sheet = await encode(
      sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 4, background: rgbaObject(background) } }).composite(
        frames.map((f) => ({ input: f.buffer, left: f.x, top: f.y })),
      ),
      "png",
      { effort: "max" },
    );

    const plain: SpriteFrame[] = frames.map(({ name, x: fx, y: fy, width, height }) => ({ name, x: fx, y: fy, width, height }));
    const manifest = {
      image: "sprite-sheet.png",
      size: { width: sheetWidth, height: sheetHeight },
      frames: Object.fromEntries(plain.map((f) => [f.name, { frame: { x: f.x, y: f.y, w: f.width, h: f.height } }])),
    };
    const files: OutputFile[] = [
      { name: "sprite-sheet.png", mimeType: MIME.png, bytes: new Uint8Array(sheet) },
      { name: "sprite-sheet.json", mimeType: "application/json; charset=utf-8", bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n") },
      { name: "sprite-sheet.css", mimeType: "text/css; charset=utf-8", bytes: new TextEncoder().encode(spriteCss(plain, "sprite-sheet.png", sheetWidth, sheetHeight)) },
    ];
    return {
      ok: true,
      output: { frames: plain, width: sheetWidth, height: sheetHeight, result: `${plain.length} frames in ${sheetWidth} × ${sheetHeight}` },
      summary: `Packed ${countLabel(plain.length)} into one ${sheetWidth} × ${sheetHeight} sheet (${formatBytes(sheet.length)}), with a JSON manifest and ready-to-use CSS classes.`,
      files: [{ name: "sprite-sheet.zip", mimeType: ZIP_MIME, bytes: createZip(files) }],
    };
  });

// ---- photo map viewer -------------------------------------------------------------------------

export interface PhotoPoint {
  name: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  taken: string | null;
  mapUrl: string;
}

/** GeoJSON, so the result opens in any mapping tool, not only in a viewer of ours. */
export function pointsToGeoJson(points: PhotoPoint[]): unknown {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.longitude, p.latitude, ...(p.altitude === undefined ? [] : [p.altitude])] },
      properties: { name: p.name, taken: p.taken },
    })),
  };
}

export const photoMapExecutor: Executor = (input, _options, ctx) =>
  runImageTool("photo-map-viewer", async () => {
    const images = await readImages(input, ctx, { max: 300 });
    const points: PhotoPoint[] = [];
    const without: string[] = [];
    for (const image of images) {
      throwIfAborted(ctx?.signal);
      const meta = await readImageMetadata(image);
      if (!meta.gps) {
        without.push(image.ref.name);
        continue;
      }
      const taken =
        (meta.exif?.exif?.DateTimeOriginal as string | undefined) ??
        (meta.exif?.image?.ModifyDate as string | undefined) ??
        null;
      points.push({
        name: image.ref.name,
        latitude: meta.gps.latitude,
        longitude: meta.gps.longitude,
        ...(meta.gps.altitude === undefined ? {} : { altitude: meta.gps.altitude }),
        taken: typeof taken === "string" ? taken : null,
        // A link rather than an embedded tile: reading the coordinates is entirely offline, and only
        // clicking through needs the network (roadmap §4, OpenStreetMap's tile policy).
        mapUrl: `https://www.openstreetmap.org/?mlat=${meta.gps.latitude}&mlon=${meta.gps.longitude}#map=15/${meta.gps.latitude}/${meta.gps.longitude}`,
      });
    }
    if (points.length === 0) {
      throw unsupported(
        `None of these ${images.length === 1 ? "photos has" : "photos have"} GPS coordinates in them. Location tagging has to be on in the camera, and it is stripped by most messaging apps.`,
      );
    }
    const latitudes = points.map((p) => p.latitude);
    const longitudes = points.map((p) => p.longitude);
    const bounds = {
      north: Math.max(...latitudes),
      south: Math.min(...latitudes),
      east: Math.max(...longitudes),
      west: Math.min(...longitudes),
    };
    const centre = { latitude: (bounds.north + bounds.south) / 2, longitude: (bounds.east + bounds.west) / 2 };
    return {
      ok: true,
      output: {
        points,
        bounds,
        centre,
        withoutLocation: without,
        geojson: pointsToGeoJson(points),
        mapUrl: `https://www.openstreetmap.org/#map=12/${centre.latitude}/${centre.longitude}`,
        result: points.map((p) => `${p.name}: ${p.latitude}, ${p.longitude}`).join("\n"),
      },
      summary: `Found coordinates in ${plural(points.length, "photo")}${without.length > 0 ? ` (${without.length} had none)` : ""}, centred on ${centre.latitude.toFixed(4)}, ${centre.longitude.toFixed(4)}. The GeoJSON file opens in any mapping tool; reading the EXIF itself never left this machine.`,
      files: [
        {
          name: "photo-locations.geojson",
          mimeType: "application/geo+json",
          bytes: new TextEncoder().encode(JSON.stringify(pointsToGeoJson(points), null, 2) + "\n"),
        },
      ],
    };
  });
