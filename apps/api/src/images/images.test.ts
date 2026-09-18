// Tests for the image tools (09-image-tools.md): pixel-dimension assertions for resize/crop,
// A→B→A format round trips with alpha checks, overlay presence checks against a baseline, the 5+5
// fit modes producing visibly distinct output, EXIF read/strip on a fixture with known fields, the
// "needs a local AI model" state with no runtime and real results through a stub runtime, and an
// offline run of every tool.
import http from "node:http";
import https from "node:https";
import { PDFDocument } from "@cantoo/pdf-lib";
import sharp from "sharp";
import { getTool } from "@onestop/tool-registry";
import type { ExecContext, ExecResult, FileRef, OutputFile } from "@onestop/types";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { crc32 } from "../pdf/zip.ts";
import { decodeBmp, encodeBmp } from "./bmp.ts";
import { parseColor, sniffFormat, WHITE } from "./common.ts";
import { aspectBox, parseRatio } from "./crop.ts";
import { IMAGE_EXECUTORS } from "./index.ts";
import { inpaint } from "./objectRemoval.ts";
import { MODEL_REQUIRED_MESSAGE, setImageModelRuntime, type ImageModelRuntime } from "./model.ts";
import { resizeTarget } from "./resize.ts";
import { stripJpeg, stripPng } from "./metadata.ts";

// ---- helpers ----------------------------------------------------------------------------------

type Fixture = { name: string; bytes: Uint8Array };
const tool = (id: string) => IMAGE_EXECUTORS.find(([k]) => k === id)![1];

async function run(id: string, input: Fixture[], options: Record<string, unknown> = {}) {
  const refs: FileRef[] = input.map((f, i) => ({
    name: f.name,
    size: f.bytes.length,
    type: "",
    tempId: `f-${i}`,
  }));
  const ctx: ExecContext = {
    jobId: "t",
    readFile: async (ref) => input[Number(ref.tempId!.slice(2))]!.bytes,
  };
  return tool(id)(refs, options, ctx);
}

function ok(result: ExecResult): Extract<ExecResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result;
}
function fail(result: ExecResult): Extract<ExecResult, { ok: false }> {
  if (result.ok) throw new Error(`expected failure, got: ${result.summary}`);
  return result;
}
function out(result: ExecResult): OutputFile {
  const f = (ok(result).files ?? [])[0];
  if (!f) throw new Error("no output file");
  return f;
}

async function meta(bytes: Uint8Array) {
  return sharp(Buffer.from(bytes), { animated: true }).metadata();
}
async function pixels(bytes: Uint8Array, size?: [number, number]) {
  let p = sharp(Buffer.from(bytes)).ensureAlpha();
  if (size) p = p.resize(size[0], size[1], { fit: "fill" });
  const { data, info } = await p.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
/** Mean absolute difference per channel (0–255) between two images of the same size. */
async function diff(
  a: Uint8Array,
  b: Uint8Array,
  region?: { left: number; top: number; width: number; height: number },
) {
  const crop = async (x: Uint8Array) => {
    let p = sharp(Buffer.from(x)).ensureAlpha();
    if (region) p = p.extract(region);
    return p.raw().toBuffer();
  };
  const [pa, pb] = await Promise.all([crop(a), crop(b)]);
  expect(pa.length).toBe(pb.length);
  let sum = 0;
  for (let i = 0; i < pa.length; i += 1) sum += Math.abs(pa[i]! - pb[i]!);
  return sum / pa.length;
}
async function pixelAt(bytes: Uint8Array, x: number, y: number): Promise<number[]> {
  const { data, width } = await pixels(bytes);
  const i = (y * width + x) * 4;
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
}

// ---- fixtures ---------------------------------------------------------------------------------

/** A 240×160 "photo": a colour gradient with a red square in the middle and a blue bar top-left. */
async function makePhoto(format: "jpg" | "png" = "jpg"): Promise<Buffer> {
  const w = 240;
  const h = 160;
  const data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3;
      const inSquare = x >= 100 && x < 140 && y >= 60 && y < 100;
      const inBar = x < 60 && y < 20;
      data[i] = inSquare ? 220 : inBar ? 20 : Math.round((x / w) * 200) + 20;
      data[i + 1] = inSquare ? 30 : inBar ? 40 : Math.round((y / h) * 200) + 20;
      data[i + 2] = inSquare ? 30 : inBar ? 200 : 120;
    }
  }
  const p = sharp(data, { raw: { width: w, height: h, channels: 3 } });
  return format === "jpg" ? p.jpeg({ quality: 95 }).toBuffer() : p.png().toBuffer();
}

/** 120×80 PNG: transparent background, opaque green disc in the middle, a half-transparent strip. */
async function makeTransparent(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">
    <circle cx="60" cy="40" r="25" fill="#2e7d32"/><rect x="0" y="70" width="120" height="10" fill="#1565c0" fill-opacity="0.5"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A product shot: a blue disc on an even off-white background. */
async function makeProduct(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">
    <rect width="160" height="120" fill="#f4f4f2"/><circle cx="80" cy="60" r="35" fill="#1e3a8a"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}

/** A JPEG with known EXIF: camera, artist, date and a GPS position (48.8584 N, 2.2945 E). */
async function makeExifJpeg(): Promise<Buffer> {
  return sharp(await makePhoto("jpg"))
    .withExif({
      IFD0: {
        Make: "OneStopCam",
        Model: "Fixture 9",
        Artist: "Ada Lovelace",
        Copyright: "(c) OneStop tests",
        DateTime: "2024:05:17 10:30:00",
      },
      IFD2: { DateTimeOriginal: "2024:05:17 10:29:59", UserComment: "fixture" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "48/1 51/1 3024/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "2/1 17/1 4020/100",
      },
    })
    .jpeg({ quality: 95 })
    .toBuffer();
}

/** A PNG with a tEXt chunk. */
async function makeTextPng(): Promise<Buffer> {
  return sharp(await makePhoto("png"))
    .withMetadata()
    .png()
    .withExif({ IFD0: { Artist: "Ada" } })
    .toBuffer();
}

async function makeAnimatedGif(frames = 3): Promise<Buffer> {
  const colours = ["#e53935", "#43a047", "#1e88e5", "#fdd835"];
  const pngs = await Promise.all(
    Array.from({ length: frames }, (_, i) =>
      sharp({
        create: { width: 60, height: 40, channels: 3, background: colours[i % colours.length]! },
      })
        .png()
        .toBuffer(),
    ),
  );
  return sharp(pngs, { join: { animated: true } })
    .gif({ delay: 100 })
    .toBuffer();
}

let photo: Buffer;
let photoPng: Buffer;
let transparent: Buffer;
let product: Buffer;
let exifJpeg: Buffer;
let gif: Buffer;
const f = (name: string, bytes: Uint8Array): Fixture => ({ name, bytes });

beforeAll(async () => {
  // One libvips thread: these tests run beside other files, and phase 08's 50k-row test budgets
  // its own CPU time, which a saturated machine inflates.
  sharp.concurrency(1);
  [photo, photoPng, transparent, product, exifJpeg, gif] = await Promise.all([
    makePhoto("jpg"),
    makePhoto("png"),
    makeTransparent(),
    makeProduct(),
    makeExifJpeg(),
    makeAnimatedGif(),
  ]);
});

afterEach(() => {
  setImageModelRuntime(null);
});

// ---- registry ---------------------------------------------------------------------------------

describe("registry", () => {
  it("registers all 27 phase-09 tools as available, local and offline-verified", () => {
    expect(IMAGE_EXECUTORS).toHaveLength(27);
    for (const [id] of IMAGE_EXECUTORS) {
      const meta = getTool(id);
      expect(meta, `missing registry entry for ${id}`).toBeDefined();
      expect(meta!.phase).toBe("09");
      expect(meta!.status).toBe("available");
      expect(meta!.execution).toBe("local");
      expect(meta!.offline, `${id} passed the offline test below`).toBe(true);
    }
    // PDF → Image (Features 6.2) is phase 05's tool.
    expect(getTool("pdf-to-images")?.status).toBe("available");
  });

  it("flags exactly the model-capable tools with localModel: optional", () => {
    const flagged = IMAGE_EXECUTORS.map(([id]) => id).filter((id) => getTool(id)?.localModel);
    expect(flagged.sort()).toEqual(
      [
        "background-blur",
        "background-removal",
        "image-denoiser",
        "image-enhancer",
        "image-sharpening",
        "image-upscaler",
        "object-removal",
      ].sort(),
    );
    for (const id of flagged) expect(getTool(id)!.localModel).toBe("optional");
  });
});

// ---- inputs -----------------------------------------------------------------------------------

describe("inputs", () => {
  it("sniffs the real format regardless of the extension", async () => {
    expect(sniffFormat(photo)).toBe("jpg");
    expect(sniffFormat(transparent)).toBe("png");
    expect(sniffFormat(gif)).toBe("gif");
    const webp = await sharp(photo).webp().toBuffer();
    expect(sniffFormat(webp)).toBe("webp");
    const avif = await sharp(photo).avif().toBuffer();
    expect(sniffFormat(avif, "x.avif")).toBe("avif");
    const renamed = ok(
      await run("image-resizer", [f("actually-a-jpeg.png", photo)], {
        mode: "percent",
        percent: 50,
      }),
    );
    expect(renamed.files![0]!.name).toMatch(/\.jpg$/);
  });

  it("refuses non-images, damaged files and decompression bombs with clear messages", async () => {
    const text = fail(
      await run("image-resizer", [f("notes.png", new TextEncoder().encode("hello world"))]),
    );
    expect(text.code).toBe("UNSUPPORTED_INPUT");
    expect(text.message).toMatch(/not an image|could not be read/);

    const truncated = fail(await run("rotate-image", [f("cut.jpg", photo.subarray(0, 300))]));
    expect(truncated.code).toBe("UNSUPPORTED_INPUT");
    expect(truncated.message).not.toMatch(/vips|Error:|at /);

    // A tiny PNG whose header claims 40 000 × 40 000 pixels.
    const bomb = Buffer.from(
      await sharp({ create: { width: 1, height: 1, channels: 3, background: "#fff" } })
        .png()
        .toBuffer(),
    );
    bomb.writeUInt32BE(40000, 16);
    bomb.writeUInt32BE(40000, 20);
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
    const big = fail(
      await run("image-resizer", [f("bomb.png", bomb)], { mode: "percent", percent: 10 }),
    );
    expect(big.message).toMatch(/too large/);

    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic"),
      Buffer.alloc(40),
    ]);
    const badHeic = fail(
      await run("image-format-converter", [f("phone.heic", heic)], { format: "jpg" }),
    );
    expect(badHeic.message).toMatch(/HEIC photo could not be read/);

    expect(fail(await run("image-resizer", [])).message).toMatch(/Choose an image/);
  });

  it("reads and writes BMP (24-bit, 32-bit with alpha) losslessly", async () => {
    const { data, width, height } = await pixels(transparent);
    const bmp = encodeBmp(data, width, height);
    expect(bmp.subarray(0, 2).toString()).toBe("BM");
    const back = decodeBmp(bmp);
    expect([back.width, back.height, back.hasAlpha]).toEqual([width, height, true]);
    expect(Buffer.compare(back.data, data)).toBe(0);

    const opaque = await pixels(photoPng);
    const bmp24 = encodeBmp(opaque.data, opaque.width, opaque.height);
    expect(bmp24.readUInt16LE(28)).toBe(24);
    expect(Buffer.compare(decodeBmp(bmp24).data, opaque.data)).toBe(0);

    // A BMP goes through a normal tool and comes back as BMP.
    const rotated = out(await run("rotate-image", [f("scan.bmp", bmp24)], { angle: "90" }));
    expect(rotated.name).toBe("scan-rotated.bmp");
    const r = decodeBmp(rotated.bytes);
    expect([r.width, r.height]).toEqual([160, 240]);
  });
});

// ---- resize & crop ----------------------------------------------------------------------------

describe("resize", () => {
  it("computes target sizes for every mode", () => {
    const src = { width: 4000, height: 3000 };
    expect(resizeTarget(src, { mode: "pixels", width: 800 })).toEqual({ width: 800, height: 600 });
    expect(resizeTarget(src, { mode: "pixels", height: 300 })).toEqual({ width: 400, height: 300 });
    expect(resizeTarget(src, { mode: "pixels", width: 500, height: 500, fit: "contain" })).toEqual({
      width: 500,
      height: 375,
    });
    expect(resizeTarget(src, { mode: "pixels", width: 500, height: 500, fit: "cover" })).toEqual({
      width: 500,
      height: 500,
    });
    expect(resizeTarget(src, { mode: "percent", percent: 25 })).toEqual({
      width: 1000,
      height: 750,
    });
    expect(resizeTarget(src, { mode: "longest", longest: 1000 })).toEqual({
      width: 1000,
      height: 750,
    });
    expect(resizeTarget(src, { mode: "percent", percent: 200, noEnlarge: true })).toEqual({
      width: 4000,
      height: 3000,
    });
    expect(() => resizeTarget(src, { mode: "pixels" })).toThrow(/width, a height/);
    expect(() => resizeTarget(src, { mode: "percent", percent: 1000 })).toThrow(/too large/);
  });

  it("produces the exact pixel dimensions asked for", async () => {
    const cases: [Record<string, unknown>, [number, number]][] = [
      [{ mode: "pixels", width: 120, height: 0 }, [120, 80]],
      [{ mode: "pixels", width: 100, height: 100, fit: "contain" }, [100, 67]],
      [{ mode: "pixels", width: 100, height: 100, fit: "cover" }, [100, 100]],
      [{ mode: "pixels", width: 50, height: 90, fit: "fill" }, [50, 90]],
      [{ mode: "percent", percent: 150 }, [360, 240]],
      [{ mode: "longest", longest: 60 }, [60, 40]],
    ];
    for (const [options, [w, h]] of cases) {
      const file = out(await run("image-resizer", [f("p.jpg", photo)], options));
      const m = await meta(file.bytes);
      expect([m.width, m.height], JSON.stringify(options)).toEqual([w, h]);
      expect(m.format).toBe("jpeg");
    }
  });

  it("keeps every frame of an animated GIF and batches into a ZIP", async () => {
    const file = out(
      await run("image-resizer", [f("a.gif", gif)], { mode: "percent", percent: 50 }),
    );
    const m = await meta(file.bytes);
    expect([m.width, m.pageHeight, m.pages]).toEqual([30, 20, 3]);

    const batch = ok(
      await run("image-resizer", [f("a.jpg", photo), f("b.png", photoPng)], {
        mode: "percent",
        percent: 50,
      }),
    );
    expect(batch.files).toHaveLength(1);
    expect(batch.files![0]!.name).toBe("resized-images.zip");
    const separate = ok(
      await run("image-resizer", [f("a.jpg", photo), f("b.png", photoPng)], {
        mode: "percent",
        percent: 50,
        packaging: "files",
      }),
    );
    expect(separate.files!.map((x) => x.name)).toEqual(["a-120x80.jpg", "b-120x80.png"]);
  });
});

describe("crop", () => {
  it("parses ratios and places aspect boxes", () => {
    expect(parseRatio("16:9")).toBeCloseTo(16 / 9);
    expect(parseRatio("4x5")).toBeCloseTo(0.8);
    expect(parseRatio("1.5")).toBe(1.5);
    expect(() => parseRatio("wide")).toThrow(/aspect ratio/);
    expect(aspectBox({ width: 240, height: 160 }, 1, "left")).toEqual({
      left: 0,
      top: 0,
      width: 160,
      height: 160,
    });
    expect(aspectBox({ width: 240, height: 160 }, 3, "bottom")).toEqual({
      left: 0,
      top: 80,
      width: 240,
      height: 80,
    });
  });

  it("crops to the right size and region in every mode", async () => {
    const square = out(
      await run("image-cropper", [f("p.png", photoPng)], {
        mode: "aspect",
        ratio: "1:1",
        anchor: "center",
      }),
    );
    expect([(await meta(square.bytes)).width, (await meta(square.bytes)).height]).toEqual([
      160, 160,
    ]);
    const wide = out(
      await run("image-cropper", [f("p.png", photoPng)], {
        mode: "aspect",
        ratio: "16:9",
        anchor: "smart",
      }),
    );
    const wm = await meta(wide.bytes);
    expect([wm.width, wm.height]).toEqual([240, 135]);

    // The exact box around the red square is red everywhere.
    const box = out(
      await run("image-cropper", [f("p.png", photoPng)], {
        mode: "box",
        x: 100,
        y: 60,
        width: 40,
        height: 40,
      }),
    );
    const bm = await pixels(box.bytes);
    expect([bm.width, bm.height]).toEqual([40, 40]);
    expect([...(await pixelAt(box.bytes, 20, 20))].slice(0, 3)).toEqual([220, 30, 30]);

    const trimmed = out(
      await run("image-cropper", [f("p.png", photoPng)], {
        mode: "percent",
        left: 25,
        right: 25,
        top: 10,
        bottom: 40,
      }),
    );
    const tm = await meta(trimmed.bytes);
    expect([tm.width, tm.height]).toEqual([120, 80]);

    // A box running past the edge is clamped; one starting outside is refused.
    const clamped = out(
      await run("image-cropper", [f("p.png", photoPng)], {
        mode: "box",
        x: 200,
        y: 100,
        width: 500,
        height: 500,
      }),
    );
    expect([(await meta(clamped.bytes)).width, (await meta(clamped.bytes)).height]).toEqual([
      40, 60,
    ]);
    expect(
      fail(await run("image-cropper", [f("p.png", photoPng)], { mode: "box", x: 300, y: 0 }))
        .message,
    ).toMatch(/outside the image/);
  });
});

// ---- compress & convert -----------------------------------------------------------------------

describe("compress", () => {
  it("makes a big photo smaller, and never hands back a bigger file", async () => {
    const big = await sharp(photo).resize(960, 640).jpeg({ quality: 100 }).toBuffer();
    const r = ok(await run("image-compressor", [f("big.jpg", big)], { quality: 60 }));
    expect(r.files![0]!.bytes.length).toBeLessThan(big.length * 0.6);
    expect(r.summary).toMatch(/smaller/);

    const small = await sharp(photo).jpeg({ quality: 20 }).toBuffer();
    const kept = ok(await run("image-compressor", [f("small.jpg", small)], { quality: 95 }));
    expect(Buffer.compare(Buffer.from(kept.files![0]!.bytes), small)).toBe(0);
    expect(kept.summary).toMatch(/already well optimised/);

    const webp = out(
      await run("image-compressor", [f("t.png", transparent)], { format: "webp", quality: 70 }),
    );
    expect(webp.name).toBe("t-compressed.webp");
    expect((await meta(webp.bytes)).hasAlpha).toBe(true);

    const shrunk = out(await run("image-compressor", [f("big.jpg", big)], { maxSide: 300 }));
    expect((await meta(shrunk.bytes)).width).toBe(300);
  });
});

describe("format conversion", () => {
  const formats = ["png", "jpg", "webp", "gif", "tiff", "avif", "bmp"] as const;

  it("round-trips A → B → A for every format without corruption", async () => {
    for (const to of formats) {
      const there = out(
        await run("image-format-converter", [f("p.png", photoPng)], { format: to, quality: 100 }),
      );
      expect(there.name).toBe(`p.${to}`);
      expect(sniffFormat(there.bytes, there.name)).toBe(to);
      const back = out(
        await run("image-format-converter", [f(there.name, there.bytes)], { format: "png" }),
      );
      const m = await meta(back.bytes);
      expect([m.width, m.height], to).toEqual([240, 160]);
      // Lossless formats are exact; lossy/palette ones stay close.
      const d = await diff(back.bytes, photoPng);
      const limit = { png: 0, bmp: 0, tiff: 0, jpg: 4, webp: 4, avif: 5, gif: 8 }[to];
      expect(d, `${to} drifted by ${d}`).toBeLessThanOrEqual(limit);
    }
  });

  it("keeps transparency wherever the target supports it", async () => {
    for (const to of ["png", "webp", "gif", "tiff", "avif"] as const) {
      const file = out(
        await run("image-format-converter", [f("t.png", transparent)], { format: to }),
      );
      const back = await sharp(Buffer.from(file.bytes)).png().toBuffer();
      expect((await meta(back)).hasAlpha, to).toBe(true);
      expect((await pixelAt(back, 2, 2))[3], `${to} corner should be transparent`).toBeLessThan(10);
      expect((await pixelAt(back, 60, 40))[3], `${to} centre should be opaque`).toBeGreaterThan(
        245,
      );
    }
    // PNG → WebP (the build file's example) keeps the half-transparent strip half-transparent.
    const webp = out(await run("png-webp-converter", [f("t.png", transparent)]));
    const alpha = (
      await pixelAt(await sharp(Buffer.from(webp.bytes)).png().toBuffer(), 60, 75)
    )[3]!;
    expect(alpha).toBeGreaterThan(100);
    expect(alpha).toBeLessThan(160);

    // JPG can't: the corner becomes the chosen background, and the summary says so.
    const jpg = ok(
      await run("image-format-converter", [f("t.png", transparent)], {
        format: "jpg",
        background: "#ff0000",
      }),
    );
    const [r, g, b] = await pixelAt(jpg.files![0]!.bytes, 2, 2);
    expect(r).toBeGreaterThan(240);
    expect(g! + b!).toBeLessThan(30);
    expect(jpg.summary).toMatch(/can't store transparency/);
  });

  it("the pair converters go to the other format of the pair and refuse others", async () => {
    expect(out(await run("jpg-png-converter", [f("a.jpg", photo)])).name).toBe("a.png");
    expect(out(await run("jpg-png-converter", [f("a.png", photoPng)])).name).toBe("a.jpg");
    expect(out(await run("jpg-webp-converter", [f("a.jpeg", photo)])).name).toBe("a.webp");
    const webp = out(await run("png-webp-converter", [f("a.png", photoPng)]));
    expect(out(await run("png-webp-converter", [f("a.webp", webp.bytes)])).name).toBe("a.png");
    expect(out(await run("jpg-webp-converter", [f("a.webp", webp.bytes)])).name).toBe("a.jpg");
    expect(fail(await run("jpg-png-converter", [f("a.gif", gif)])).message).toMatch(
      /not a JPG or PNG/,
    );
  });

  it("keeps animation between GIF and WebP, and says when a format can't", async () => {
    const webp = out(await run("image-format-converter", [f("a.gif", gif)], { format: "webp" }));
    expect((await meta(webp.bytes)).pages).toBe(3);
    const png = ok(await run("image-format-converter", [f("a.gif", gif)], { format: "png" }));
    expect(png.summary).toMatch(/only the first frame/);
  });

  it("Image → GIF makes an animated GIF from several images", async () => {
    const r = ok(
      await run(
        "image-to-gif",
        [f("1.png", photoPng), f("2.png", transparent), f("3.jpg", product)],
        { delay: 250, width: 120 },
      ),
    );
    const m = await meta(r.files![0]!.bytes);
    expect(m.format).toBe("gif");
    expect([m.pages, m.width, m.pageHeight]).toEqual([3, 120, 80]);
    expect(m.delay).toEqual([250, 250, 250]);
    expect(m.loop).toBe(0);
    const single = out(await run("image-to-gif", [f("p.png", photoPng)]));
    expect(single.name).toBe("p.gif");
  });

  it("Image → PDF puts one image per page at the right size", async () => {
    const r = ok(await run("image-to-pdf", [f("a.jpg", photo), f("b.png", transparent)]));
    const doc = await PDFDocument.load(r.files![0]!.bytes);
    expect(doc.getPageCount()).toBe(2);
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    expect([Math.round(w), Math.round(h)]).toEqual([180, 120]); // 240×160 px at 96 DPI

    const a4 = ok(await run("image-to-pdf", [f("a.jpg", photo)], { size: "a4", margin: 36 }));
    const page = (await PDFDocument.load(a4.files![0]!.bytes)).getPage(0);
    expect([Math.round(page.getWidth()), Math.round(page.getHeight())]).toEqual([842, 595]); // landscape photo → landscape page

    // JPGs are embedded untouched (no re-compression).
    expect(Buffer.from(r.files![0]!.bytes).includes(photo.subarray(photo.length - 200))).toBe(true);

    const separate = ok(
      await run("image-to-pdf", [f("a.jpg", photo), f("b.png", transparent)], {
        output: "separate",
        packaging: "files",
      }),
    );
    expect(separate.files!.map((x) => x.name)).toEqual(["a.pdf", "b.pdf"]);
  });
});

// ---- overlays ---------------------------------------------------------------------------------

describe("watermark and text", () => {
  it("text watermark changes its corner and leaves the rest alone", async () => {
    const file = out(
      await run("image-watermark", [f("p.png", photoPng)], {
        text: "SAMPLE",
        position: "bottom-right",
        size: 40,
        opacity: 80,
      }),
    );
    const br = { left: 130, top: 120, width: 110, height: 40 };
    const tl = { left: 0, top: 0, width: 100, height: 60 };
    expect(await diff(file.bytes, photoPng, br)).toBeGreaterThan(5);
    expect(await diff(file.bytes, photoPng, tl)).toBe(0);
  });

  it("tiled and logo watermarks cover the expected areas", async () => {
    const tiled = out(
      await run("image-watermark", [f("p.png", photoPng)], {
        text: "DRAFT",
        position: "tile",
        size: 30,
        opacity: 100,
        angle: -30,
      }),
    );
    expect(await diff(tiled.bytes, photoPng)).toBeGreaterThan(1);
    for (const region of [
      { left: 0, top: 0, width: 120, height: 80 },
      { left: 120, top: 80, width: 120, height: 80 },
    ]) {
      expect(await diff(tiled.bytes, photoPng, region)).toBeGreaterThan(1);
    }
    const logo = ok(
      await run("image-watermark", [f("p.png", photoPng), f("logo.png", transparent)], {
        kind: "logo",
        position: "top-left",
        size: 30,
        opacity: 100,
      }),
    );
    expect(logo.files).toHaveLength(1); // the logo itself is not watermarked
    expect(logo.summary).toMatch(/logo\.png/);
    expect(
      await diff(logo.files![0]!.bytes, photoPng, { left: 0, top: 0, width: 80, height: 60 }),
    ).toBeGreaterThan(5);
    expect(
      await diff(logo.files![0]!.bytes, photoPng, { left: 150, top: 100, width: 90, height: 60 }),
    ).toBe(0);
    expect(
      fail(await run("image-watermark", [f("p.png", photoPng)], { kind: "logo" })).message,
    ).toMatch(/at least 2/);
    expect(
      fail(await run("image-watermark", [f("p.png", photoPng)], { text: "  " })).message,
    ).toMatch(/watermark text/);
  });

  it("Add Text draws where it is asked to", async () => {
    const top = out(
      await run("add-text-to-image", [f("p.png", photoPng)], {
        text: "Hello",
        position: "top-center",
        size: 15,
      }),
    );
    expect(
      await diff(top.bytes, photoPng, { left: 60, top: 0, width: 120, height: 40 }),
    ).toBeGreaterThan(5);
    expect(await diff(top.bytes, photoPng, { left: 0, top: 110, width: 240, height: 50 })).toBe(0);
    const custom = out(
      await run("add-text-to-image", [f("p.png", photoPng)], {
        text: "X",
        position: "custom",
        x: 10,
        y: 80,
        size: 20,
        box: "dark",
      }),
    );
    expect(
      await diff(custom.bytes, photoPng, { left: 0, top: 100, width: 60, height: 60 }),
    ).toBeGreaterThan(5);
    expect(
      fail(await run("add-text-to-image", [f("p.png", photoPng)], { text: "" })).message,
    ).toMatch(/Enter the text/);
    // Unicode survives (bundled font) and a very long caption wraps inside the image.
    const long = out(
      await run("add-text-to-image", [f("p.png", photoPng)], {
        text: "Łódź Ωμέγα ".repeat(20),
        size: 10,
      }),
    );
    expect((await meta(long.bytes)).width).toBe(240);
  });

  it("Meme Generator captions top and bottom", async () => {
    const meme = out(
      await run("meme-generator", [f("p.jpg", photo)], { top: "top text", bottom: "bottom text" }),
    );
    expect(
      await diff(meme.bytes, photo, { left: 0, top: 0, width: 240, height: 30 }),
    ).toBeGreaterThan(5);
    expect(
      await diff(meme.bytes, photo, { left: 0, top: 130, width: 240, height: 30 }),
    ).toBeGreaterThan(5);
    expect(
      await diff(meme.bytes, photo, { left: 0, top: 60, width: 240, height: 40 }),
    ).toBeLessThan(2);
    expect(fail(await run("meme-generator", [f("p.jpg", photo)], {})).message).toMatch(
      /top caption/,
    );
  });

  it("parses colours", () => {
    expect(parseColor("#f80", WHITE)).toEqual({ r: 255, g: 136, b: 0, alpha: 1 });
    expect(parseColor("red", WHITE).r).toBe(229);
    expect(parseColor("transparent", WHITE).alpha).toBe(0);
    expect(parseColor("", WHITE)).toBe(WHITE);
    expect(() => parseColor("banana", WHITE)).toThrow(/not a colour/);
  });
});

// ---- metadata ---------------------------------------------------------------------------------

describe("metadata", () => {
  it("reads known EXIF fields, dates and GPS", async () => {
    const r = ok(await run("image-metadata-viewer", [f("exif.jpg", exifJpeg)]));
    const report = r.output as {
      exif: Record<string, Record<string, unknown>>;
      gps: { latitude: number; longitude: number };
      blocks: { exif: boolean };
    };
    expect(report.blocks.exif).toBe(true);
    expect(report.exif.Image!.Make).toBe("OneStopCam");
    expect(report.exif.Image!.Model).toBe("Fixture 9");
    expect(report.exif.Image!.Artist).toBe("Ada Lovelace");
    expect(String(report.exif.Photo!.DateTimeOriginal)).toMatch(/^2024-05-17T10:29:59/);
    expect(report.gps.latitude).toBeCloseTo(48.8584, 3);
    expect(report.gps.longitude).toBeCloseTo(2.2945, 3);
    expect(r.summary).toMatch(/OneStopCam Fixture 9/);
    expect(r.summary).toMatch(/GPS/);
    expect(r.files![0]!.name).toBe("exif-metadata.json");

    const none = ok(await run("image-metadata-viewer", [f("p.png", photoPng)]));
    expect(none.summary).toMatch(/No EXIF/);
  });

  it("strips EXIF/GPS from a JPEG without re-compressing it", async () => {
    const r = ok(await run("remove-image-metadata", [f("exif.jpg", exifJpeg)]));
    const clean = r.files![0]!;
    const m = await meta(clean.bytes);
    expect(m.exif).toBeUndefined();
    expect(Buffer.from(clean.bytes).includes(Buffer.from("OneStopCam"))).toBe(false);
    expect(Buffer.from(clean.bytes).includes(Buffer.from("Ada Lovelace"))).toBe(false);
    expect(r.summary).toMatch(/Removed EXIF/);
    expect(r.summary).toMatch(/without re-compressing/);
    // Identical pixels: the scan data was copied, not re-encoded.
    expect(await diff(clean.bytes, exifJpeg)).toBe(0);
    const viewer = ok(await run("image-metadata-viewer", [f("clean.jpg", clean.bytes)]));
    expect((viewer.output as { exif: unknown }).exif).toBeNull();
  });

  it("strips PNG text/EXIF chunks losslessly and rotates JPEGs upright first", async () => {
    const png = await makeTextPng();
    const stripped = stripPng(png, true)!;
    expect((await meta(stripped)).exif).toBeUndefined();
    expect(await diff(stripped, png)).toBe(0);

    // EXIF orientation 6 ("rotate 90° clockwise"): the clean file is stored upright.
    const rotated = await sharp(photo).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect(stripJpeg(rotated, true)).not.toBeNull();
    const clean = out(await run("remove-image-metadata", [f("r.jpg", rotated)]));
    const m = await meta(clean.bytes);
    expect([m.width, m.height, m.orientation]).toEqual([160, 240, undefined]);

    const webp = await sharp(exifJpeg).keepExif().webp().toBuffer();
    expect((await meta(webp)).exif).toBeDefined();
    const cleanWebp = out(await run("remove-image-metadata", [f("x.webp", webp)]));
    expect((await meta(cleanWebp.bytes)).exif).toBeUndefined();
  });
});

// ---- colour, rotate, flip ---------------------------------------------------------------------

describe("colour, rotate and flip", () => {
  it("adjusts colours", async () => {
    const gray = out(
      await run("image-color-adjustment", [f("p.png", photoPng)], { effect: "grayscale" }),
    );
    const [r, g, b] = await pixelAt(gray.bytes, 120, 80);
    expect(r).toBe(g);
    expect(g).toBe(b);
    const bright = out(
      await run("image-color-adjustment", [f("p.png", photoPng)], { brightness: 40 }),
    );
    const mean = async (x: Uint8Array) => (await sharp(Buffer.from(x)).stats()).channels[0]!.mean;
    expect(await mean(bright.bytes)).toBeGreaterThan((await mean(photoPng)) + 10);
    const inverted = out(
      await run("image-color-adjustment", [f("p.png", photoPng)], { effect: "invert" }),
    );
    expect((await pixelAt(inverted.bytes, 120, 80)).slice(0, 3)).toEqual([35, 225, 225]);
    for (const option of [
      { contrast: 50 },
      { saturation: -100 },
      { hue: 90 },
      { warmth: 60 },
      { effect: "sepia" },
      { effect: "vintage" },
    ]) {
      const file = out(await run("image-color-adjustment", [f("p.png", photoPng)], option));
      expect(await diff(file.bytes, photoPng), JSON.stringify(option)).toBeGreaterThan(1);
    }
    expect(ok(await run("image-color-adjustment", [f("p.png", photoPng)])).summary).toMatch(
      /unchanged/,
    );
  });

  it("rotates by right angles and arbitrary angles", async () => {
    const r90 = out(await run("rotate-image", [f("p.jpg", photo)], { angle: "90" }));
    expect([(await meta(r90.bytes)).width, (await meta(r90.bytes)).height]).toEqual([160, 240]);
    const tilted = ok(
      await run("rotate-image", [f("p.jpg", photo)], { angle: "custom", customAngle: 30 }),
    );
    const t = tilted.files![0]!;
    expect(t.name).toBe("p-rotated.png"); // transparent corners need PNG
    const tm = await meta(t.bytes);
    expect(tm.width).toBeGreaterThan(240);
    expect((await pixelAt(t.bytes, 1, 1))[3]).toBe(0);
    const white = out(
      await run("rotate-image", [f("p.jpg", photo)], {
        angle: "custom",
        customAngle: 30,
        background: "white",
      }),
    );
    expect(white.name).toBe("p-rotated.jpg");
    const anim = out(await run("rotate-image", [f("a.gif", gif)], { angle: "180" }));
    expect((await meta(anim.bytes)).pages).toBe(3);
  });

  it("flips", async () => {
    const h = out(await run("flip-image", [f("p.png", photoPng)], { direction: "horizontal" }));
    expect(await pixelAt(h.bytes, 239, 0)).toEqual(await pixelAt(photoPng, 0, 0));
    const v = out(await run("flip-image", [f("p.png", photoPng)], { direction: "vertical" }));
    expect(await pixelAt(v.bytes, 0, 159)).toEqual(await pixelAt(photoPng, 0, 0));
    const both = out(await run("flip-image", [f("p.png", photoPng)], { direction: "both" }));
    expect(await pixelAt(both.bytes, 239, 159)).toEqual(await pixelAt(photoPng, 0, 0));
  });
});

// ---- fit shapes -------------------------------------------------------------------------------

describe("fit to square / circle", () => {
  const modes = ["fill", "contain", "stretch", "repeat", "blur"];

  it("all five square modes give a square and visibly different results", async () => {
    const outputs: Uint8Array[] = [];
    for (const mode of modes) {
      const file = out(
        await run("fit-image-to-square", [f("p.png", photoPng)], { mode, size: 200 }),
      );
      const m = await meta(file.bytes);
      expect([m.width, m.height], mode).toEqual([200, 200]);
      outputs.push(file.bytes);
    }
    for (let i = 0; i < outputs.length; i += 1) {
      for (let j = i + 1; j < outputs.length; j += 1) {
        expect(await diff(outputs[i]!, outputs[j]!), `${modes[i]} vs ${modes[j]}`).toBeGreaterThan(
          3,
        );
      }
    }
    // contain pads with the chosen colour; repeat puts image copies there instead.
    const contain = outputs[1]!;
    expect((await pixelAt(contain, 100, 5)).slice(0, 3)).toEqual([255, 255, 255]);
    const repeat = outputs[3]!;
    expect((await pixelAt(repeat, 100, 5)).slice(0, 3)).not.toEqual([255, 255, 255]);
    // Automatic size: the longer side (240) for contain, the shorter (160) for fill.
    expect(
      (
        await meta(
          out(await run("fit-image-to-square", [f("p.png", photoPng)], { mode: "contain" })).bytes,
        )
      ).width,
    ).toBe(240);
    expect(
      (
        await meta(
          out(await run("fit-image-to-square", [f("p.png", photoPng)], { mode: "fill" })).bytes,
        )
      ).width,
    ).toBe(160);
    // Transparent padding switches a JPG to PNG.
    expect(
      out(
        await run("fit-image-to-square", [f("p.jpg", photo)], {
          mode: "contain",
          background: "transparent",
        }),
      ).name,
    ).toBe("p-square.png");
  });

  it("all five circle modes cut a circle with transparent corners and differ from each other", async () => {
    const outputs: Uint8Array[] = [];
    for (const mode of modes) {
      const file = out(await run("fit-image-to-circle", [f("p.jpg", photo)], { mode, size: 200 }));
      expect(file.name).toBe("p-circle.png");
      expect((await pixelAt(file.bytes, 2, 2))[3], `${mode} corner`).toBe(0);
      expect((await pixelAt(file.bytes, 100, 100))[3], `${mode} centre`).toBe(255);
      outputs.push(file.bytes);
    }
    for (let i = 0; i < outputs.length; i += 1) {
      for (let j = i + 1; j < outputs.length; j += 1) {
        expect(await diff(outputs[i]!, outputs[j]!), `${modes[i]} vs ${modes[j]}`).toBeGreaterThan(
          2,
        );
      }
    }
    const ringed = out(
      await run("fit-image-to-circle", [f("p.jpg", photo)], {
        mode: "fill",
        size: 200,
        border: 10,
        borderColor: "#ff0000",
      }),
    );
    const [r, g, b, a] = await pixelAt(ringed.bytes, 100, 3);
    expect([r! > 200, g! < 60, b! < 60, a! > 200]).toEqual([true, true, true, true]);
  });
});

// ---- blur & editor ----------------------------------------------------------------------------

describe("background blur and basic editor", () => {
  it("keeps the focus area sharp and blurs the edges", async () => {
    const focus = out(
      await run("background-blur", [f("p.png", photoPng)], {
        mode: "focus",
        strength: 60,
        focusSize: 60,
      }),
    );
    const centre = { left: 105, top: 65, width: 30, height: 30 };
    const corner = { left: 0, top: 0, width: 60, height: 25 };
    expect(await diff(focus.bytes, photoPng, centre)).toBeLessThan(1);
    expect(await diff(focus.bytes, photoPng, corner)).toBeGreaterThan(2);
    const whole = out(
      await run("background-blur", [f("p.png", photoPng)], { mode: "whole", strength: 60 }),
    );
    expect(
      await diff(whole.bytes, photoPng, { left: 90, top: 50, width: 60, height: 60 }),
    ).toBeGreaterThan(5);
  });

  it("applies the chosen edits in order", async () => {
    const r = ok(
      await run("basic-image-editor", [f("p.png", photoPng)], {
        trimLeft: 25,
        trimRight: 25,
        rotate: "90",
        flip: "horizontal",
        brightness: 20,
        shape: "rectangle",
        captionText: "Edited",
      }),
    );
    const m = await meta(r.files![0]!.bytes);
    expect([m.width, m.height]).toEqual([160, 120]);
    expect(r.summary).toMatch(
      /Cropped to 120 × 160, rotated 90°, flipped horizontal, adjusted colours, drew a rectangle, added a caption/,
    );

    const pix = ok(
      await run("basic-image-editor", [f("p.png", photoPng)], {
        shape: "pixelate",
        shapeLeft: 40,
        shapeTop: 35,
        shapeWidth: 20,
        shapeHeight: 30,
        maxSide: 120,
      }),
    );
    const pm = await meta(pix.files![0]!.bytes);
    expect([pm.width, pm.height]).toEqual([120, 80]);

    const none = ok(await run("basic-image-editor", [f("p.png", photoPng)]));
    expect(none.summary).toMatch(/unchanged/);
    expect(await diff(none.files![0]!.bytes, photoPng)).toBe(0);
    expect(
      fail(await run("basic-image-editor", [f("p.png", photoPng)], { trimLeft: 60, trimRight: 50 }))
        .message,
    ).toMatch(/leave nothing/);
  });
});

// ---- AI-capable tools -------------------------------------------------------------------------

const AI_TOOLS = [
  "background-removal",
  "object-removal",
  "image-upscaler",
  "image-enhancer",
  "image-sharpening",
  "image-denoiser",
] as const;

/** A stand-in for phase 16's runtime: deterministic, recognisable output for each task. */
function stubRuntime(calls: string[] = []): ImageModelRuntime {
  return {
    name: "Stub model",
    supports: () => true,
    async run(task, png, params) {
      calls.push(task);
      const img = sharp(png);
      const { width = 1, height = 1 } = await img.metadata();
      if (task === "upscale")
        return img
          .resize(width * (params.scale ?? 2), height * (params.scale ?? 2))
          .png()
          .toBuffer();
      if (task === "remove-background") {
        // Keep only the centre half.
        const mask = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${width / 4}" y="${height / 4}" width="${width / 2}" height="${height / 2}"/></svg>`,
        );
        return img
          .ensureAlpha()
          .composite([{ input: mask, blend: "dest-in" }])
          .png()
          .toBuffer();
      }
      if (task === "inpaint") expect(params.mask).toBeInstanceOf(Buffer);
      return img.negate({ alpha: false }).png().toBuffer();
    },
  };
}

describe("AI-capable tools", () => {
  it("say exactly 'needs a local AI model' when AI is asked for and none is set up", async () => {
    for (const id of AI_TOOLS) {
      const r = fail(await run(id, [f("p.png", photoPng)], { method: "ai" }));
      expect(r.code, id).toBe("UNSUPPORTED_INPUT");
      expect(r.message, id).toBe(MODEL_REQUIRED_MESSAGE);
      expect(r.message).toBe("This feature needs a local AI model. Enable one in Settings.");
    }
    const blur = fail(await run("background-blur", [f("p.png", photoPng)], { mode: "subject" }));
    expect(blur.message).toBe(MODEL_REQUIRED_MESSAGE);
    // A runtime that doesn't support the task counts as "none".
    setImageModelRuntime({ ...stubRuntime(), supports: (task) => task === "upscale" });
    expect(
      fail(await run("image-denoiser", [f("p.png", photoPng)], { method: "ai" })).message,
    ).toBe(MODEL_REQUIRED_MESSAGE);
  });

  it("fall back to the built-in method on 'auto' and say so", async () => {
    const cases: [string, Fixture, Record<string, unknown>][] = [
      ["background-removal", f("prod.jpg", product), {}],
      ["object-removal", f("p.png", photoPng), { left: 40, top: 35, width: 20, height: 30 }],
      ["image-upscaler", f("p.png", photoPng), { scale: "2" }],
      ["image-enhancer", f("p.png", photoPng), {}],
      ["image-sharpening", f("p.png", photoPng), {}],
      ["image-denoiser", f("p.png", photoPng), {}],
    ];
    for (const [id, input, options] of cases) {
      const r = ok(await run(id, [input], options));
      expect(r.summary, id).toMatch(/built-in method/);
      expect(r.files![0]!.bytes.length, id).toBeGreaterThan(100);
      const builtin = ok(await run(id, [input], { ...options, method: "builtin" }));
      expect(builtin.summary, id).not.toMatch(/enable a local AI model/);
    }
  });

  it("produce a real, model-made result once a runtime is configured", async () => {
    const calls: string[] = [];
    setImageModelRuntime(stubRuntime(calls));
    for (const id of AI_TOOLS) {
      const r = ok(await run(id, [f("p.png", photoPng)], { method: "ai" }));
      expect(r.summary, id).toMatch(/Processed with Stub model/);
      const file = r.files![0]!;
      if (id === "image-upscaler") {
        expect((await meta(file.bytes)).width).toBe(480);
      } else if (id === "background-removal") {
        expect(file.name).toBe("p-no-bg.png");
        expect((await pixelAt(file.bytes, 2, 2))[3]).toBe(0);
        expect((await pixelAt(file.bytes, 120, 80))[3]).toBe(255);
      } else {
        // The stub inverts: proof the model's pixels are what came back.
        expect((await pixelAt(file.bytes, 120, 80)).slice(0, 3)).toEqual([35, 225, 225]);
      }
    }
    expect(calls).toEqual([
      "remove-background",
      "inpaint",
      "upscale",
      "enhance",
      "sharpen",
      "denoise",
    ]);
    // 'auto' uses the model too; 'builtin' never does.
    expect(ok(await run("image-enhancer", [f("p.png", photoPng)])).summary).toMatch(/Stub model/);
    expect(
      ok(await run("image-enhancer", [f("p.png", photoPng)], { method: "builtin" })).summary,
    ).not.toMatch(/Stub model/);
    expect(calls).toHaveLength(7);
    // Background Blur's "subject" mode uses the model's cut-out.
    const subject = out(
      await run("background-blur", [f("p.png", photoPng)], { mode: "subject", strength: 60 }),
    );
    expect(
      await diff(subject.bytes, photoPng, { left: 100, top: 60, width: 40, height: 40 }),
    ).toBeLessThan(1);
    expect(
      await diff(subject.bytes, photoPng, { left: 0, top: 0, width: 50, height: 30 }),
    ).toBeGreaterThan(2);
  });

  it("never fake a success when the model fails or returns junk", async () => {
    setImageModelRuntime({
      ...stubRuntime(),
      run: async () => {
        throw new Error("connection refused");
      },
    });
    const crashed = fail(await run("image-enhancer", [f("p.png", photoPng)], { method: "ai" }));
    expect(crashed.code).toBe("FAILED");
    expect(crashed.message).toMatch(/Stub model.*could not process/);
    setImageModelRuntime({ ...stubRuntime(), run: async () => Buffer.from("not an image") });
    const junk = fail(await run("image-enhancer", [f("p.png", photoPng)], { method: "auto" }));
    expect(junk.message).toMatch(/isn't a usable image/);
  });

  it("built-in background removal clears a plain background and refuses a busy one", async () => {
    const r = ok(await run("background-removal", [f("prod.jpg", product)], { method: "builtin" }));
    const file = r.files![0]!;
    expect(file.name).toBe("prod-no-bg.png");
    expect((await pixelAt(file.bytes, 3, 3))[3]).toBe(0);
    expect((await pixelAt(file.bytes, 155, 115))[3]).toBe(0);
    expect((await pixelAt(file.bytes, 80, 60))[3]).toBe(255);
    expect(r.summary).toMatch(/Removed a plain background/);
    const busy = fail(await run("background-removal", [f("p.jpg", photo)], { method: "builtin" }));
    expect(busy.message).toMatch(/too busy.*local AI model/);
  });

  it("built-in object removal erases the marked object", async () => {
    // The red square sits at 100–140 × 60–100 on a smooth gradient.
    const r = out(
      await run("object-removal", [f("p.png", photoPng)], {
        method: "builtin",
        left: 40,
        top: 35,
        width: 20,
        height: 30,
      }),
    );
    const [red, green] = await pixelAt(r.bytes, 120, 80);
    expect(red).toBeLessThan(160); // was 220
    expect(green).toBeGreaterThan(80); // was 30
    // Outside the box nothing moved.
    expect(await diff(r.bytes, photoPng, { left: 0, top: 0, width: 90, height: 50 })).toBe(0);
    expect(
      fail(
        await run("object-removal", [f("p.png", photoPng)], {
          method: "builtin",
          left: 0,
          top: 0,
          width: 100,
          height: 100,
        }),
      ).message,
    ).toMatch(/whole image/);

    // The inpainting core fills a hole in a flat image with that flat colour.
    const flat = Buffer.alloc(20 * 20 * 4, 100);
    const hole = new Uint8Array(400);
    for (let y = 5; y < 15; y += 1)
      for (let x = 5; x < 15; x += 1) {
        hole[y * 20 + x] = 1;
        flat.fill(0, (y * 20 + x) * 4, (y * 20 + x) * 4 + 4);
      }
    inpaint(flat, 20, 20, hole);
    expect([...flat.subarray((10 * 20 + 10) * 4, (10 * 20 + 10) * 4 + 4)]).toEqual([
      100, 100, 100, 100,
    ]);
  });

  it("built-in upscale, enhance, sharpen and denoise change the image as expected", async () => {
    const up = out(
      await run("image-upscaler", [f("p.jpg", photo)], { method: "builtin", scale: "3" }),
    );
    expect([(await meta(up.bytes)).width, (await meta(up.bytes)).height]).toEqual([720, 480]);
    const huge = await sharp({
      create: { width: 6000, height: 6000, channels: 3, background: "#888" },
    })
      .jpeg()
      .toBuffer();
    expect(
      fail(await run("image-upscaler", [f("h.jpg", huge)], { method: "builtin", scale: "4" }))
        .message,
    ).toMatch(/too large/);

    const noisy = await sharp(photoPng)
      .composite([
        {
          input: Buffer.from(
            Array.from({ length: 240 * 160 * 4 }, (_, i) => (i % 4 === 3 ? 60 : (i * 7919) % 256)),
          ),
          raw: { width: 240, height: 160, channels: 4 },
        },
      ])
      .png()
      .toBuffer();
    for (const id of ["image-enhancer", "image-sharpening", "image-denoiser"]) {
      const file = out(await run(id, [f("n.png", noisy)], { method: "builtin" }));
      const m = await meta(file.bytes);
      expect([m.width, m.height], id).toEqual([240, 160]);
      expect(await diff(file.bytes, noisy), id).toBeGreaterThan(1);
    }
    // Denoising makes neighbouring pixels more alike.
    const roughness = async (x: Uint8Array) => {
      const { data, width } = await pixels(x);
      let sum = 0;
      for (let i = 0; i < data.length - 4; i += 4)
        if ((i / 4) % width !== width - 1) sum += Math.abs(data[i]! - data[i + 4]!);
      return sum;
    };
    const denoised = out(
      await run("image-denoiser", [f("n.png", noisy)], { method: "builtin", strength: "strong" }),
    );
    expect(await roughness(denoised.bytes)).toBeLessThan((await roughness(noisy)) * 0.7);
  });
});

// ---- offline ----------------------------------------------------------------------------------

describe("offline", () => {
  it("runs every phase-09 tool with the network trapped", async () => {
    const trap = () => {
      throw new Error("network access attempted");
    };
    const saved = {
      fetch: globalThis.fetch,
      hg: http.get,
      hr: http.request,
      sg: https.get,
      sr: https.request,
    };
    globalThis.fetch = trap as typeof fetch;
    http.get = trap as typeof http.get;
    http.request = trap as typeof http.request;
    https.get = trap as typeof https.get;
    https.request = trap as typeof https.request;
    try {
      const p = f("p.jpg", photo);
      const cases: Record<string, [Fixture[], Record<string, unknown>?]> = {
        "image-to-pdf": [[p, f("t.png", transparent)]],
        "image-resizer": [[p], { width: 100 }],
        "image-cropper": [[p]],
        "image-compressor": [[p]],
        "image-format-converter": [[p], { format: "webp" }],
        "jpg-png-converter": [[p]],
        "jpg-webp-converter": [[p]],
        "png-webp-converter": [[f("t.png", transparent)]],
        "image-to-gif": [[p, f("t.png", transparent)]],
        "background-blur": [[p]],
        "background-removal": [[f("prod.jpg", product)]],
        "object-removal": [[p]],
        "image-upscaler": [[p]],
        "image-enhancer": [[p]],
        "image-sharpening": [[p]],
        "image-denoiser": [[p]],
        "image-watermark": [[p]],
        "add-text-to-image": [[p], { text: "offline" }],
        "image-metadata-viewer": [[f("e.jpg", exifJpeg)]],
        "remove-image-metadata": [[f("e.jpg", exifJpeg)]],
        "image-color-adjustment": [[p], { effect: "sepia" }],
        "rotate-image": [[p]],
        "flip-image": [[p]],
        "fit-image-to-square": [[p], { mode: "blur" }],
        "fit-image-to-circle": [[p], { mode: "repeat" }],
        "meme-generator": [[p], { top: "no", bottom: "network" }],
        "basic-image-editor": [[p], { rotate: "90", captionText: "hi" }],
      };
      expect(Object.keys(cases).sort()).toEqual(IMAGE_EXECUTORS.map(([id]) => id).sort());
      for (const [id, [input, options]] of Object.entries(cases)) {
        const r = await run(id, input, options ?? {});
        expect(r.ok, `${id}: ${r.ok ? "" : r.message}`).toBe(true);
      }
    } finally {
      globalThis.fetch = saved.fetch;
      http.get = saved.hg;
      http.request = saved.hr;
      https.get = saved.sg;
      https.request = saved.sr;
    }
  });
});
