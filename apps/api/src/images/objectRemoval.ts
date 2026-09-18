// Object Removal (Features 6.13).
//
// The user marks a rectangle (in % of the image, so the same values work at any resolution). A
// local model inpaints it properly; the built-in method fills it from its surroundings — an
// "onion-peel" fill from the edge inwards followed by smoothing — which works well for small
// blemishes, date stamps, wires and objects on even backgrounds.
import sharp from "sharp";
import { optNumber, rgba, unsupported, type ImageInput } from "./common.ts";
import { aiExecutor, type AiToolSpec } from "./aiTool.ts";

export const OBJECT_REMOVAL_TOOL_ID = "object-removal";

export interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The option values (percent) as a pixel rectangle inside the image. */
export function regionFromOptions(
  image: { width: number; height: number },
  options: Record<string, unknown>,
): Region {
  const pct = (key: string, fallback: number) =>
    optNumber(options, key, fallback, { min: 0, max: 100 }) / 100;
  const left = Math.floor(pct("left", 40) * image.width);
  const top = Math.floor(pct("top", 40) * image.height);
  const width = Math.min(image.width - left, Math.ceil(pct("width", 20) * image.width));
  const height = Math.min(image.height - top, Math.ceil(pct("height", 20) * image.height));
  if (width < 1 || height < 1)
    throw unsupported("The area to remove is empty. Give it a width and height above 0%.");
  if (width >= image.width && height >= image.height) {
    throw unsupported(
      "The area to remove covers the whole image. Mark just the object you want gone.",
    );
  }
  return { left, top, width, height };
}

/** Fills the `hole` pixels (1 = unknown) of an RGBA buffer from their surroundings, in place. */
export function inpaint(
  data: Buffer,
  w: number,
  h: number,
  hole: Uint8Array,
  smoothing = 40,
): void {
  const known = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p += 1) known[p] = hole[p] ? 0 : 1;
  const holes: number[] = [];
  for (let p = 0; p < w * h; p += 1) if (hole[p]) holes.push(p);

  const neighbours = (p: number): number[] => {
    const x = p % w;
    const y = (p - x) / w;
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if ((dx || dy) && x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h)
          out.push(p + dy * w + dx);
      }
    }
    return out;
  };

  // Onion peel: each ring takes the weighted mean of its already-known neighbours.
  let frontier = holes.filter((p) => neighbours(p).some((q) => known[q]));
  const queued = new Uint8Array(w * h);
  for (const p of frontier) queued[p] = 1;
  while (frontier.length > 0) {
    const values: number[][] = [];
    for (const p of frontier) {
      const sum = [0, 0, 0, 0];
      let weight = 0;
      for (const q of neighbours(p)) {
        if (!known[q]) continue;
        const wq = Math.abs(q - p) === 1 || Math.abs(q - p) === w ? 1 : 0.7;
        for (let c = 0; c < 4; c += 1) sum[c]! += data[q * 4 + c]! * wq;
        weight += wq;
      }
      values.push(sum.map((s) => s / weight));
    }
    const next: number[] = [];
    frontier.forEach((p, i) => {
      for (let c = 0; c < 4; c += 1) data[p * 4 + c] = Math.round(values[i]![c]!);
      known[p] = 1;
    });
    for (const p of frontier) {
      for (const q of neighbours(p)) {
        if (!known[q] && !queued[q]) {
          queued[q] = 1;
          next.push(q);
        }
      }
    }
    frontier = next;
  }

  // Smoothing (Jacobi on the 4-neighbourhood) removes the rings the peel leaves behind.
  const tmp = new Float32Array(holes.length * 4);
  for (let iter = 0; iter < smoothing; iter += 1) {
    holes.forEach((p, i) => {
      const x = p % w;
      const y = (p - x) / w;
      const ns = [
        x > 0 ? p - 1 : p,
        x < w - 1 ? p + 1 : p,
        y > 0 ? p - w : p,
        y < h - 1 ? p + w : p,
      ];
      for (let c = 0; c < 4; c += 1) {
        tmp[i * 4 + c] =
          (data[ns[0]! * 4 + c]! +
            data[ns[1]! * 4 + c]! +
            data[ns[2]! * 4 + c]! +
            data[ns[3]! * 4 + c]!) /
          4;
      }
    });
    holes.forEach((p, i) => {
      for (let c = 0; c < 4; c += 1) data[p * 4 + c] = Math.round(tmp[i * 4 + c]!);
    });
  }
}

/** A white-on-black PNG mask of the region, the shape "inpaint" models expect. */
async function regionMask(image: ImageInput, region: Region): Promise<Buffer> {
  return sharp({
    create: { width: image.width, height: image.height, channels: 3, background: "#000" },
  })
    .composite([
      {
        input: {
          create: { width: region.width, height: region.height, channels: 3, background: "#fff" },
        },
        left: region.left,
        top: region.top,
      },
    ])
    .png()
    .toBuffer();
}

export const objectRemovalSpec: AiToolSpec = {
  id: OBJECT_REMOVAL_TOOL_ID,
  task: "inpaint",
  verb: "Removed an object from",
  suffix: "cleaned",
  params: async (image, options) => ({
    mask: await regionMask(image, regionFromOptions(image, options)),
  }),
  builtin: async (image, options) => {
    const region = regionFromOptions(image, options);
    const { data, width, height } = await rgba(image);
    const hole = new Uint8Array(width * height);
    for (let y = region.top; y < region.top + region.height; y += 1) {
      hole.fill(1, y * width + region.left, y * width + region.left + region.width);
    }
    // Big areas need more smoothing passes to blend in.
    inpaint(
      data,
      width,
      height,
      hole,
      Math.min(200, 20 + Math.round(Math.max(region.width, region.height) / 2)),
    );
    const bytes = await sharp(data, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    return {
      bytes,
      note: `Filled a ${region.width} × ${region.height} px area from its surroundings.`,
    };
  },
};

export const objectRemovalExecutor = aiExecutor(objectRemovalSpec);
