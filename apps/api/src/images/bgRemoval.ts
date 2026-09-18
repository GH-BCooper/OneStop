// Background Removal (Features 6.12).
//
// With a local model (model.ts) any photo works. The built-in method is honest about its limits:
// it removes a plain, evenly coloured background (product shots, scans, logos, studio portraits)
// by flood-filling inwards from the edges, and refuses — with a clear message — when the edges
// are too busy for that to give a clean result.
import sharp from "sharp";
import { optNumber, rgba, unsupported, type ImageInput } from "./common.ts";
import { aiExecutor, type AiToolSpec } from "./aiTool.ts";

export const BG_REMOVAL_TOOL_ID = "background-removal";

export interface PlainBackgroundResult {
  data: Buffer;
  width: number;
  height: number;
  /** Share of pixels removed, 0–1. */
  removed: number;
}

/** Median of each channel over the border pixels. */
function borderColor(data: Buffer, w: number, h: number): [number, number, number] {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(data[i]!);
    gs.push(data[i + 1]!);
    bs.push(data[i + 2]!);
  };
  for (let x = 0; x < w; x += 1) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 1; y < h - 1; y += 1) {
    push(0, y);
    push(w - 1, y);
  }
  const median = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1]!;
  return [median(rs), median(gs), median(bs)];
}

/**
 * Removes a plain background: every pixel connected to the image edge whose colour is within
 * `tolerance` (0–100) of the edge colour becomes transparent, with a soft 1–2 px edge.
 */
export function removePlainBackground(
  src: { data: Buffer; width: number; height: number },
  tolerance = 15,
): PlainBackgroundResult {
  const { width: w, height: h } = src;
  const data = Buffer.from(src.data);
  const [br, bg, bb] = borderColor(data, w, h);
  const tol = (tolerance / 100) * 441.7; // share of the RGB cube's diagonal
  const soft = tol * 1.6;
  const dist = (i: number) => Math.hypot(data[i]! - br, data[i + 1]! - bg, data[i + 2]! - bb);

  // How much of the border actually matches: a busy edge means "not a plain background".
  let matching = 0;
  let border = 0;
  const visit = (x: number, y: number) => {
    border += 1;
    if (dist((y * w + x) * 4) <= tol || data[(y * w + x) * 4 + 3]! < 16) matching += 1;
  };
  for (let x = 0; x < w; x += 1) {
    visit(x, 0);
    visit(x, h - 1);
  }
  for (let y = 1; y < h - 1; y += 1) {
    visit(0, y);
    visit(w - 1, y);
  }
  if (matching / border < 0.6) {
    throw unsupported(
      "The built-in method only removes plain, evenly coloured backgrounds, and this photo's background is too busy. Enable a local AI model in Settings to remove any background.",
    );
  }

  const state = new Uint8Array(w * h); // 0 unvisited, 1 background, 2 edge (partial), 3 kept
  const stack: number[] = [];
  const seed = (p: number) => {
    if (state[p] === 0 && (dist(p * 4) <= tol || data[p * 4 + 3]! < 16)) {
      state[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x += 1) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    const next = [
      x > 0 ? p - 1 : -1,
      x < w - 1 ? p + 1 : -1,
      y > 0 ? p - w : -1,
      y < h - 1 ? p + w : -1,
    ];
    for (const q of next) {
      if (q < 0 || state[q] !== 0) continue;
      const d = dist(q * 4);
      if (d <= tol || data[q * 4 + 3]! < 16) {
        state[q] = 1;
        stack.push(q);
      } else if (d <= soft) {
        state[q] = 2; // anti-aliased edge: partly transparent, not spread further
      }
    }
  }

  let removed = 0;
  for (let p = 0; p < w * h; p += 1) {
    if (state[p] === 1) {
      data[p * 4 + 3] = 0;
      removed += 1;
    } else if (state[p] === 2) {
      const d = dist(p * 4);
      const keep = Math.min(1, Math.max(0, (d - tol) / (soft - tol)));
      data[p * 4 + 3] = Math.round(data[p * 4 + 3]! * keep);
    }
  }
  if (removed / (w * h) < 0.01) {
    throw unsupported(
      "No plain background was found around the edges of this image. Enable a local AI model in Settings to remove any background.",
    );
  }
  if (removed === w * h) {
    throw unsupported(
      "The whole image matched the background colour. Lower the tolerance and try again.",
    );
  }
  return { data, width: w, height: h, removed: removed / (w * h) };
}

export const bgRemovalSpec: AiToolSpec = {
  id: BG_REMOVAL_TOOL_ID,
  task: "remove-background",
  verb: "Removed the background from",
  suffix: "no-bg",
  params: () => ({}),
  format: () => "png",
  builtin: async (image: ImageInput, options) => {
    const pixels = await rgba(image);
    const result = removePlainBackground(
      pixels,
      optNumber(options, "tolerance", 15, { min: 1, max: 60 }),
    );
    const bytes = await sharp(result.data, {
      raw: { width: result.width, height: result.height, channels: 4 },
    })
      .png()
      .toBuffer();
    return {
      bytes,
      note: `Removed a plain background (${Math.round(result.removed * 100)}% of the image).`,
    };
  },
};

export const bgRemovalExecutor = aiExecutor(bgRemovalSpec);
