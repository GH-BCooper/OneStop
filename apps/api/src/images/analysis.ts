// Image analysis tools from 21-roadmap-expansion.md (roadmap §1.4): the Colour Palette Extractor,
// ASCII Art, the Colour-Blindness Simulator, the Vectorizer and the Near-Duplicate Finder.
//
// All five are algorithms rather than integrations — k-means, luminance mapping, a colour matrix,
// marching squares and a DCT perceptual hash — so `sharp` (already a dependency) plus arithmetic is
// the whole of it. `potrace` was deliberately not adopted: it is GPL, and the roadmap itself names a
// from-scratch tracer as the fallback, so that is what this does.
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  countLabel,
  eachImage,
  encode,
  formatBytes,
  open,
  optBool,
  optEnum,
  optNumber,
  optString,
  outFile,
  outputName,
  packageFiles,
  plural,
  readImages,
  rgba,
  runImageTool,
  sameFormat,
  throwIfAborted,
  unsupported,
  type ImageInput,
} from "./common.ts";

// ---- colour palette extractor -----------------------------------------------------------------

export interface Swatch {
  hex: string;
  rgb: [number, number, number];
  share: number;
  /** Text colour that stays readable on this swatch. */
  onColor: "#000000" | "#ffffff";
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
export const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

function relativeLuminance(r: number, g: number, b: number): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/**
 * k-means over the sampled pixels. Seeded deterministically (k-means++ on an even stride) so the
 * same image always gives the same palette — a tool that returns different colours each run would
 * be useless for picking a brand palette.
 */
export function kMeansPalette(
  pixels: Uint8ClampedArray | Buffer,
  count: number,
  { iterations = 12, ignoreTransparent = true }: { iterations?: number; ignoreTransparent?: boolean } = {},
): Swatch[] {
  const samples: [number, number, number][] = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (ignoreTransparent && pixels[i + 3]! < 16) continue;
    samples.push([pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]);
  }
  if (samples.length === 0) throw unsupported("This image is fully transparent, so it has no colours to extract.");
  const k = Math.min(count, samples.length);
  const stride = Math.max(1, Math.floor(samples.length / k));
  let centres: [number, number, number][] = Array.from({ length: k }, (_, i) => samples[Math.min(samples.length - 1, i * stride)]!);

  const assignments = new Int32Array(samples.length);
  for (let round = 0; round < iterations; round += 1) {
    let moved = false;
    for (const [index, sample] of samples.entries()) {
      let best = 0;
      let bestDistance = Infinity;
      for (const [c, centre] of centres.entries()) {
        const d = (sample[0] - centre[0]) ** 2 + (sample[1] - centre[1]) ** 2 + (sample[2] - centre[2]) ** 2;
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
      if (assignments[index] !== best) {
        assignments[index] = best;
        moved = true;
      }
    }
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (const [index, sample] of samples.entries()) {
      const bucket = sums[assignments[index]!]!;
      bucket[0] = bucket[0]! + sample[0];
      bucket[1] = bucket[1]! + sample[1];
      bucket[2] = bucket[2]! + sample[2];
      bucket[3] = bucket[3]! + 1;
    }
    centres = centres.map((centre, i) => {
      const [r, g, b, n] = sums[i]!;
      return n === 0 ? centre : ([r! / n!, g! / n!, b! / n!] as [number, number, number]);
    });
    if (!moved) break;
  }

  const counts = new Array<number>(k).fill(0);
  for (const a of assignments) counts[a] = (counts[a] ?? 0) + 1;
  return centres
    .map((centre, i) => {
      const [r, g, b] = centre.map((v) => Math.round(v)) as [number, number, number];
      return {
        hex: toHex(r, g, b),
        rgb: [r, g, b] as [number, number, number],
        share: Math.round((counts[i]! / samples.length) * 1000) / 10,
        onColor: relativeLuminance(r, g, b) > 0.35 ? ("#000000" as const) : ("#ffffff" as const),
      };
    })
    .filter((s) => s.share > 0)
    .sort((a, b) => b.share - a.share);
}

/** A swatch strip as SVG, so the palette itself is a shareable file. */
export function paletteSvg(swatches: Swatch[], width = 900, height = 160): string {
  const w = width / swatches.length;
  const cells = swatches
    .map((s, i) => {
      const x = i * w;
      return `<g><rect x="${x.toFixed(2)}" y="0" width="${(w + 0.6).toFixed(2)}" height="${height}" fill="${s.hex}"/>
<text x="${(x + w / 2).toFixed(2)}" y="${height - 34}" fill="${s.onColor}" font-size="15" font-family="ui-monospace, monospace" text-anchor="middle">${s.hex}</text>
<text x="${(x + w / 2).toFixed(2)}" y="${height - 14}" fill="${s.onColor}" font-size="12" font-family="ui-sans-serif, system-ui, sans-serif" text-anchor="middle" opacity="0.75">${s.share}%</text></g>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Colour palette">\n${cells}\n</svg>`;
}

export const colorPaletteExecutor: Executor = (input, options, ctx) =>
  runImageTool("color-palette-extractor", async () => {
    const [image] = await readImages(input, ctx, { max: 1 });
    const count = optNumber(options, "colors", 6, { min: 2, max: 24 });
    // Down-sample first: 200×200 is plenty for a palette and keeps k-means fast on a huge photo.
    const { data } = await rgba(open(image!).resize(200, 200, { fit: "inside", withoutEnlargement: true }));
    const swatches = kMeansPalette(data, count, { ignoreTransparent: optBool(options, "ignoreTransparent", true) });
    const svg = paletteSvg(swatches);
    const files: OutputFile[] = [
      { name: `${outputName(image!, "palette", "png").replace(/\.png$/, "")}.svg`, mimeType: "image/svg+xml", bytes: new TextEncoder().encode(svg) },
    ];
    if (optBool(options, "pngStrip", false)) {
      const sharp = (await import("sharp")).default;
      files.push(outFile(outputName(image!, "palette", "png"), "png", new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer())));
    }
    const formats = {
      hex: swatches.map((s) => s.hex).join(", "),
      css: `:root {\n${swatches.map((s, i) => `  --color-${i + 1}: ${s.hex};`).join("\n")}\n}`,
      json: swatches,
    };
    return {
      ok: true,
      output: { swatches, ...formats, result: formats.hex },
      summary: `Top ${plural(swatches.length, "colour")}: ${swatches.slice(0, 5).map((s) => `${s.hex} (${s.share}%)`).join(", ")}.`,
      files,
    };
  });

// ---- ASCII art --------------------------------------------------------------------------------

export const ASCII_RAMPS = {
  standard: "@%#*+=-:. ",
  blocks: "█▓▒░ ",
  detailed: "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ",
  minimal: "#+-. ",
} as const;

export function imageToAscii(
  pixels: Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  { ramp, invert }: { ramp: string; invert: boolean },
): string {
  const chars = invert ? [...ramp].reverse().join("") : ramp;
  const lines: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let line = "";
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = pixels[i + 3]! / 255;
      // Transparent pixels read as "nothing there", which is the last character of the ramp.
      const luma = alpha < 0.1 ? 255 : (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) * alpha + 255 * (1 - alpha);
      line += chars[Math.min(chars.length - 1, Math.floor((luma / 256) * chars.length))];
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

export const asciiArtExecutor: Executor = (input, options, ctx) =>
  runImageTool("image-to-ascii-art", async () => {
    const [image] = await readImages(input, ctx, { max: 1 });
    const columns = optNumber(options, "columns", 100, { min: 16, max: 400 });
    // Monospace cells are about twice as tall as they are wide, so halve the row count to keep the
    // picture's proportions — otherwise everything comes out stretched vertically.
    const rows = Math.max(1, Math.round((columns * image!.height) / image!.width / 2.1));
    const rampName = optEnum(options, "ramp", Object.keys(ASCII_RAMPS) as (keyof typeof ASCII_RAMPS)[], "standard");
    const { data } = await rgba(open(image!).resize(columns, rows, { fit: "fill" }).normalize());
    const art = imageToAscii(data, columns, rows, {
      ramp: ASCII_RAMPS[rampName],
      invert: optBool(options, "invert", false),
    });
    const files: OutputFile[] = [
      { name: outputName(image!, "ascii", "png").replace(/\.png$/, ".txt"), mimeType: "text/plain; charset=utf-8", bytes: new TextEncoder().encode(art + "\n") },
    ];
    if (optBool(options, "html", false)) {
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ASCII art</title>
<style>body{background:#08090b;color:#eef1f5;margin:0;display:grid;place-items:center;min-height:100vh}
pre{font:9px/1 ui-monospace,monospace;white-space:pre;letter-spacing:0}</style></head>
<body><pre>${art.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></body></html>`;
      files.push({ name: outputName(image!, "ascii", "png").replace(/\.png$/, ".html"), mimeType: "text/html; charset=utf-8", bytes: new TextEncoder().encode(html) });
    }
    return {
      ok: true,
      output: { columns, rows, characters: art.length, result: art },
      summary: `Rendered as ${columns} × ${rows} characters. Use a monospace font at a small size — the shape only appears when the lines are tight.`,
      files,
    };
  });

// ---- colour-blindness simulator ---------------------------------------------------------------

/**
 * Brettel/Viénot-style LMS projection matrices in linear sRGB, the ones every accessibility tool
 * uses. Applied in linear light, not on gamma-encoded bytes, which is what makes the result look
 * right rather than merely tinted.
 */
export const CVD_MATRICES: Record<string, [number, number, number, number, number, number, number, number, number]> = {
  protanopia: [0.1705, 0.8295, 0, 0.1705, 0.8295, 0, -0.0045, 0.0045, 1],
  deuteranopia: [0.6099, 0.3901, 0, 0.6099, 0.3901, 0, -0.0342, 0.0342, 1],
  tritanopia: [1, 0.1503, -0.1503, 0, 0.8677, 0.1323, 0, 0.8677, 0.1323],
  achromatopsia: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
};

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number) => {
  const c = Math.max(0, Math.min(1, v));
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
};

export function simulateCvd(data: Buffer, matrix: number[], severity = 1): Buffer {
  const out = Buffer.from(data);
  for (let i = 0; i + 3 < out.length; i += 4) {
    const [r, g, b] = [toLinear(out[i]!), toLinear(out[i + 1]!), toLinear(out[i + 2]!)];
    const sr = matrix[0]! * r + matrix[1]! * g + matrix[2]! * b;
    const sg = matrix[3]! * r + matrix[4]! * g + matrix[5]! * b;
    const sb = matrix[6]! * r + matrix[7]! * g + matrix[8]! * b;
    out[i] = toSrgb(r + (sr - r) * severity);
    out[i + 1] = toSrgb(g + (sg - g) * severity);
    out[i + 2] = toSrgb(b + (sb - b) * severity);
  }
  return out;
}

const CVD_LABELS: Record<string, string> = {
  protanopia: "protanopia (no red cones — about 1% of men)",
  deuteranopia: "deuteranopia (no green cones — the most common form, about 1% of men)",
  tritanopia: "tritanopia (no blue cones — rare, under 0.01%)",
  achromatopsia: "achromatopsia (no colour at all — very rare)",
};

export const colorBlindnessExecutor: Executor = eachImage(
  "color-blindness-simulator",
  async (image, options) => {
    const { fromRgba } = await import("./common.ts");
    const kinds = optEnum(options, "kind", ["deuteranopia", "protanopia", "tritanopia", "achromatopsia", "all"] as const, "deuteranopia");
    const severity = optNumber(options, "severity", 100, { min: 10, max: 100 }) / 100;
    const list = kinds === "all" ? Object.keys(CVD_MATRICES) : [kinds];
    const format = sameFormat(image, { needsAlpha: image.hasAlpha });
    const { data, width, height } = await rgba(image);
    // With "all", the extra variants ride along as additional files; `eachImage` takes one result
    // per image, so the first kind is the headline and the rest are appended by the caller below.
    const first = list[0]!;
    const bytes = await encode(fromRgba(simulateCvd(data, CVD_MATRICES[first]!, severity), width, height), format);
    return {
      file: outFile(outputName(image, first, format), format, bytes),
      note: `Simulated ${CVD_LABELS[first]}.`,
    };
  },
  { verb: "Simulated", zipStem: "color-blindness", max: 20 },
);

// ---- vectorizer -------------------------------------------------------------------------------

/**
 * Marching squares over a thresholded bitmap, then Ramer-Douglas-Peucker simplification. This is the
 * from-scratch tracer the roadmap names as the licence-safe alternative to `potrace` (GPL). It is
 * honest about what it is: good for logos, line art and silhouettes, not for photographs.
 */
export function traceContours(mask: Uint8Array, width: number, height: number): [number, number][][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x]!);
  const visited = new Set<string>();
  const paths: [number, number][][] = [];

  // Every outline starts at the first filled pixel whose left neighbour is empty and which has not
  // been walked yet; Moore-neighbour tracing then follows the boundary all the way round.
  const NEIGHBOURS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (at(x, y) === 0 || at(x - 1, y) !== 0) continue;
      if (visited.has(`${x},${y}`)) continue;
      const path: [number, number][] = [];
      let [cx, cy] = [x, y];
      let direction = 6; // came from above
      for (let steps = 0; steps < width * height * 4; steps += 1) {
        path.push([cx, cy]);
        visited.add(`${cx},${cy}`);
        let found = false;
        for (let i = 0; i < 8; i += 1) {
          const dir = (direction + 6 + i) % 8;
          const [dx, dy] = NEIGHBOURS[dir]!;
          if (at(cx + dx, cy + dy) !== 0) {
            cx += dx;
            cy += dy;
            direction = dir;
            found = true;
            break;
          }
        }
        if (!found) break;
        if (cx === x && cy === y) break;
      }
      if (path.length >= 8) paths.push(path);
    }
  }
  return paths;
}

export function simplifyPath(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 2) return points;
  const [start, end] = [points[0]!, points[points.length - 1]!];
  let maxDistance = 0;
  let index = 0;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i]!;
    const distance = Math.abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1) / length;
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= tolerance) return [start, end];
  return [
    ...simplifyPath(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplifyPath(points.slice(index), tolerance),
  ];
}

export function pathsToSvg(
  paths: [number, number][][],
  width: number,
  height: number,
  { fill, background, scale }: { fill: string; background: string | null; scale: number },
): string {
  const d = paths
    .map((path) => `M ${path.map(([x, y]) => `${(x * scale).toFixed(1)} ${(y * scale).toFixed(1)}`).join(" L ")} Z`)
    .join(" ");
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${background ? `<rect width="${w}" height="${h}" fill="${background}"/>` : ""}
<path d="${d}" fill="${fill}" fill-rule="evenodd"/>
</svg>`;
}

export const vectorizerExecutor: Executor = (input, options, ctx) =>
  runImageTool("image-vectorizer", async () => {
    const [image] = await readImages(input, ctx, { max: 1 });
    const detail = optNumber(options, "detail", 50, { min: 5, max: 100 });
    // A wider working bitmap gives finer contours; cap it so a 6000px photo cannot melt the CPU.
    const workWidth = Math.min(image!.width, Math.round(200 + detail * 8));
    const workHeight = Math.max(1, Math.round((workWidth * image!.height) / image!.width));
    const threshold = optNumber(options, "threshold", 50, { min: 1, max: 99 }) * 2.55;
    const invert = optBool(options, "invert", false);

    const { data } = await rgba(open(image!).resize(workWidth, workHeight, { fit: "fill" }).greyscale());
    const mask = new Uint8Array(workWidth * workHeight);
    for (let i = 0, p = 0; i + 3 < data.length; i += 4, p += 1) {
      const alpha = data[i + 3]!;
      const luma = alpha < 16 ? 255 : data[i]!;
      const on = invert ? luma > threshold : luma <= threshold;
      mask[p] = on ? 1 : 0;
    }
    const filled = mask.reduce<number>((sum, v) => sum + v, 0);
    if (filled === 0 || filled === mask.length) {
      throw unsupported(
        "Nothing was traced: every pixel fell on the same side of the threshold. Move the threshold, or turn on Invert.",
      );
    }

    const tolerance = Math.max(0.35, (101 - detail) / 28);
    const minArea = optNumber(options, "minArea", 12, { min: 0, max: 5000 });
    const paths = traceContours(mask, workWidth, workHeight)
      .map((path) => simplifyPath(path, tolerance))
      .filter((path) => {
        if (path.length < 3) return false;
        // Shoelace area, so specks from JPEG noise are dropped instead of becoming stray blobs.
        let area = 0;
        for (let i = 0; i < path.length; i += 1) {
          const [x1, y1] = path[i]!;
          const [x2, y2] = path[(i + 1) % path.length]!;
          area += x1 * y2 - x2 * y1;
        }
        return Math.abs(area / 2) >= minArea;
      });
    if (paths.length === 0) {
      throw unsupported("No shapes large enough to trace were found. Lower the minimum shape size, or raise the detail.");
    }
    const svg = pathsToSvg(paths, workWidth, workHeight, {
      fill: optString(options, "fill", "#111417") || "#111417",
      background: optBool(options, "transparent", true) ? null : optString(options, "background", "#ffffff") || "#ffffff",
      scale: image!.width / workWidth,
    });
    const points = paths.reduce((sum, p) => sum + p.length, 0);
    return {
      ok: true,
      output: { paths: paths.length, points, result: svg },
      summary: `Traced ${plural(paths.length, "shape")} into ${points} points (${formatBytes(svg.length)} of SVG). This tracer is built for logos and line art — a photograph will come out as a silhouette.`,
      files: [
        {
          name: outputName(image!, "vector", "png").replace(/\.png$/, ".svg"),
          mimeType: "image/svg+xml",
          bytes: new TextEncoder().encode(svg),
        },
      ],
    };
  });

// ---- near-duplicate finder --------------------------------------------------------------------

/** 8×8 DCT perceptual hash: resize to 32×32 grey, DCT, keep the low frequencies, compare to median. */
export function perceptualHash(grey: Uint8Array | Buffer, size = 32, hashSize = 8): string {
  const cos: number[][] = Array.from({ length: size }, (_, u) =>
    Array.from({ length: size }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size))),
  );
  const rows: number[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, u) => {
      let sum = 0;
      for (let x = 0; x < size; x += 1) sum += grey[y * size + x]! * cos[u]![x]!;
      return sum;
    }),
  );
  const values: number[] = [];
  for (let v = 0; v < hashSize; v += 1) {
    for (let u = 0; u < hashSize; u += 1) {
      let sum = 0;
      for (let y = 0; y < size; y += 1) sum += rows[y]![u]! * cos[v]![y]!;
      values.push(sum);
    }
  }
  // The DC term carries overall brightness, not structure, so it is left out of the median.
  const sorted = [...values.slice(1)].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  let bits = "";
  for (const value of values) bits += value > median ? "1" : "0";
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length) * 4;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    let xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

export interface SimilarGroup {
  hash: string;
  files: { name: string; distance: number; width: number; height: number; size: number }[];
}

export const nearDuplicateExecutor: Executor = (input, options, ctx) =>
  runImageTool("near-duplicate-image-finder", async () => {
    const images = await readImages(input, ctx, { min: 2, max: 200 });
    const threshold = optNumber(options, "threshold", 8, { min: 0, max: 32 });
    const hashed: { image: ImageInput; hash: string }[] = [];
    for (const image of images) {
      throwIfAborted(ctx?.signal);
      const grey = await open(image).resize(32, 32, { fit: "fill" }).greyscale().raw().toBuffer();
      hashed.push({ image, hash: perceptualHash(grey) });
    }

    // Single-link clustering: anything within the threshold of a member joins that group.
    const groups: SimilarGroup[] = [];
    const assigned = new Set<number>();
    for (const [i, a] of hashed.entries()) {
      if (assigned.has(i)) continue;
      const members = [{ index: i, distance: 0 }];
      assigned.add(i);
      for (const [j, b] of hashed.entries()) {
        if (assigned.has(j)) continue;
        const distance = Math.min(...members.map((m) => hammingDistance(hashed[m.index]!.hash, b.hash)));
        if (distance <= threshold) {
          members.push({ index: j, distance });
          assigned.add(j);
        }
      }
      if (members.length > 1) {
        groups.push({
          hash: a.hash,
          files: members.map((m) => ({
            name: hashed[m.index]!.image.ref.name,
            distance: m.distance,
            width: hashed[m.index]!.image.width,
            height: hashed[m.index]!.image.height,
            size: hashed[m.index]!.image.bytes.length,
          })),
        });
      }
    }

    const duplicates = groups.reduce((sum, g) => sum + g.files.length - 1, 0);
    const wasted = groups.reduce((sum, g) => sum + g.files.slice(1).reduce((s, f) => s + f.size, 0), 0);
    return {
      ok: true,
      output: {
        groups,
        hashes: hashed.map((h) => ({ name: h.image.ref.name, hash: h.hash })),
        duplicates,
        result: `${groups.length} groups, ${duplicates} near-duplicates`,
      },
      summary:
        groups.length === 0
          ? `No visually similar images among ${countLabel(images.length)} at a distance of ${threshold} or less. Raise the threshold to catch looser matches.`
          : `${plural(groups.length, "group")} of similar images, ${plural(duplicates, "likely duplicate")} — about ${formatBytes(wasted)} of repeated content. Distance 0 means visually identical; small numbers mean a resize, recompression or crop.`,
      files: [
        {
          name: "similar-images.json",
          mimeType: "application/json; charset=utf-8",
          bytes: new TextEncoder().encode(JSON.stringify({ threshold, groups, hashes: hashed.map((h) => ({ name: h.image.ref.name, hash: h.hash })) }, null, 2) + "\n"),
        },
      ],
    };
  });

export { packageFiles };
