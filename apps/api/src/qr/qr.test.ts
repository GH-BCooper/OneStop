// Tests for the QR tools (11-qr-tools.md).
//
// The centrepiece is the round trip the build file asks for: every content type is generated and
// then decoded back, so a "valid QR code" is proved by reading it, not by trusting the encoder.
// On top of that: the payload conventions (WIFI:, vCard, mailto:, tel:), the scanner's failure
// path, a dynamic code whose destination changes while its URL does not, scan counting, and an
// offline run of every static tool.
import http from "node:http";
import https from "node:https";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { getTool, getToolOptions, redactOptionValues } from "@onestop/tool-registry";
import type { ExecContext, ExecResult, FileRef, OutputFile } from "@onestop/types";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { decodeQrImage } from "./decode.ts";
import {
  buildEmail,
  buildGeo,
  buildPhone,
  buildSms,
  buildUrl,
  buildVCard,
  buildWifi,
  escapeVCard,
  parsePayload,
} from "./formats.ts";
import {
  buildMatrix,
  contrastRatio,
  eccForStyle,
  renderQr,
  renderSvg,
  resolveStyle,
  DEFAULT_STYLE,
} from "./generate.ts";
import { QR_EXECUTORS } from "./index.ts";
import { resolveQrLink } from "./dynamic.ts";
import { scansByDay, statsFor } from "./analytics.ts";
import { getQrStore, setQrStore, shortUrlFor, validatePage, type QrStore } from "./store.ts";
import { recordOfflineCoverage } from "../../../../tests/offline/coverage.ts";

// ---- helpers ----------------------------------------------------------------------------------

type Fixture = { name: string; bytes: Uint8Array };
const f = (name: string, bytes: Uint8Array): Fixture => ({ name, bytes });
const tool = (id: string) => QR_EXECUTORS.find(([k]) => k === id)![1];

async function run(
  id: string,
  input: Fixture[] | string | null,
  options: Record<string, unknown> = {},
): Promise<ExecResult> {
  const fixtures = Array.isArray(input) ? input : [];
  const refs: FileRef[] | string | null = Array.isArray(input)
    ? input.map((x, i) => ({ name: x.name, size: x.bytes.length, type: "", tempId: `f-${i}` }))
    : input;
  const ctx: ExecContext = {
    jobId: "t",
    readFile: async (ref) => fixtures[Number(ref.tempId!.slice(2))]!.bytes,
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
function out(result: ExecResult, index = 0): OutputFile {
  const file = (ok(result).files ?? [])[index];
  if (!file) throw new Error("no output file");
  return file;
}
function output(result: ExecResult): Record<string, unknown> {
  return ok(result).output as Record<string, unknown>;
}

/** Decodes a result file, rasterising first when the tool produced an SVG. */
async function decodeOutput(file: OutputFile): Promise<string> {
  const bytes =
    file.mimeType === "image/svg+xml"
      ? new Uint8Array(await sharp(Buffer.from(file.bytes)).png().toBuffer())
      : file.bytes;
  const found = await decodeQrImage(bytes);
  if (!found) throw new Error(`no QR code could be read back from ${file.name}`);
  return found.text;
}

/** Random pixels, so the JPEG is genuinely too big for a QR code (a flat colour would not be). */
async function noisyJpeg(): Promise<Buffer> {
  const side = 200;
  const pixels = Buffer.alloc(side * side * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 2654435761) % 256;
  return sharp(pixels, { raw: { width: side, height: side, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

let tempDir: string;
let store: QrStore;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "onestop-qr-test-"));
  store = getQrStore(path.join(tempDir, "qr-links.json"));
  setQrStore(store);
});

afterAll(async () => {
  setQrStore(undefined);
  await rm(tempDir, { recursive: true, force: true });
});

afterEach(async () => {
  await store.clear();
});

// ---- payload formats ---------------------------------------------------------------------------

describe("payload formats", () => {
  it("builds a Wi-Fi config string, escaping the characters that would break it", () => {
    const payload = buildWifi({
      ssid: "Cafe; Wi-Fi",
      password: 'p@ss:w"ord\\1',
      security: "WPA",
      hidden: true,
    });
    expect(payload.startsWith("WIFI:T:WPA;S:Cafe\\; Wi-Fi;P:")).toBe(true);
    expect(payload.endsWith(";;")).toBe(true);
    expect(payload).toContain("H:true");

    const parsed = parsePayload(payload);
    expect(parsed.kind).toBe("wifi");
    expect(parsed.fields.ssid).toBe("Cafe; Wi-Fi");
    expect(parsed.fields.password).toBe('p@ss:w"ord\\1');
  });

  it("leaves the password out of an open network", () => {
    const payload = buildWifi({ ssid: "Free Wi-Fi", security: "nopass" });
    expect(payload).toBe("WIFI:T:nopass;S:Free Wi-Fi;;");
    expect(parsePayload(payload).label).toContain("open");
  });

  it("insists on a password for a secured network", () => {
    expect(() => buildWifi({ ssid: "Home", security: "WPA" })).toThrowError(/password/i);
  });

  it("builds a vCard that parses back to the same fields", () => {
    const vcard = buildVCard({
      name: "Ada Lovelace",
      organisation: "Analytical, Engines Ltd",
      title: "Mathematician",
      phone: "+44 20 7946 0000",
      email: "ada@example.com",
      website: "example.com",
      address: "12 Example Street",
      note: "First programmer",
    });
    expect(vcard.startsWith("BEGIN:VCARD\r\nVERSION:3.0")).toBe(true);
    expect(vcard).toContain("N:Lovelace;Ada;;;");
    // A comma inside a value must be escaped, or readers split the field.
    expect(vcard).toContain("ORG:Analytical\\, Engines Ltd");

    const parsed = parsePayload(vcard);
    expect(parsed.kind).toBe("contact");
    expect(parsed.fields.name).toBe("Ada Lovelace");
    expect(parsed.fields.organisation).toBe("Analytical, Engines Ltd");
    expect(parsed.fields.phone).toBe("+442079460000");
    expect(parsed.fields.website).toBe("https://example.com/");
  });

  it("folds a long vCard line so strict readers accept it", () => {
    const vcard = buildVCard({ name: "Ada Lovelace", note: "x".repeat(200) });
    for (const line of vcard.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
  });

  it("builds mailto:, tel: and sms: URIs", () => {
    expect(buildEmail({ to: "me@example.com", subject: "Hi there", body: "A & B" })).toBe(
      "mailto:me@example.com?subject=Hi+there&body=A+%26+B",
    );
    expect(buildPhone("+44 (20) 7946-0000")).toBe("tel:+442079460000");
    expect(buildSms("07700900000", "Hello")).toBe("sms:07700900000?body=Hello");
    expect(buildGeo(51.5, -0.12)).toBe("geo:51.5,-0.12");
  });

  it("refuses payloads a phone would act on unexpectedly", () => {
    expect(() => buildUrl("javascript:alert(1)")).toThrowError(/http/i);
    expect(() => buildUrl("data:text/html,<script>")).toThrowError(/http/i);
    expect(() => buildEmail({ to: "not an address" })).toThrowError(/email/i);
    expect(() => buildPhone("call me")).toThrowError(/phone number/i);
  });

  it("adds https:// to a bare domain", () => {
    expect(buildUrl("example.com/menu")).toBe("https://example.com/menu");
  });

  it("names what a decoded payload is", () => {
    expect(parsePayload("https://example.com/x").kind).toBe("url");
    expect(parsePayload("mailto:me@example.com").kind).toBe("email");
    expect(parsePayload("tel:+123456").kind).toBe("phone");
    expect(parsePayload("SMSTO:+123456:hi").kind).toBe("sms");
    expect(parsePayload("geo:1,2").kind).toBe("geo");
    expect(parsePayload("just some words").kind).toBe("text");
    expect(escapeVCard("a,b;c")).toBe("a\\,b\\;c");
  });
});

// ---- rendering ---------------------------------------------------------------------------------

describe("rendering", () => {
  it("refuses colours a scanner could not tell apart", () => {
    expect(() => resolveStyle({ dark: "#777777", light: "#888888" })).toThrowError(/too similar/i);
    expect(() => resolveStyle({ dark: "transparent" })).toThrowError(/transparent/i);
    expect(() => resolveStyle({ dark: "not-a-colour" })).toThrowError(/colour/i);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("accepts a named colour, a short hex and a transparent background", () => {
    const style = resolveStyle({ dark: "blue", light: "transparent" });
    expect(style.dark).toBe("#2563eb");
    expect(style.light).toBe("transparent");
    expect(resolveStyle({ dark: "#036" }).dark).toBe("#003366");
  });

  it("clamps sizes instead of failing", () => {
    expect(resolveStyle({ size: 10 }).size).toBe(64);
    expect(resolveStyle({ size: 99_999 }).size).toBe(4096);
    expect(resolveStyle({ margin: -5 }).margin).toBe(0);
  });

  it("raises error correction when a logo will cover modules", () => {
    expect(eccForStyle({ ...DEFAULT_STYLE, logo: "", ecc: "L" })).toBe("L");
    expect(
      eccForStyle({ ...DEFAULT_STYLE, logo: "data:image/png;base64,x", logoScale: 0.25 }),
    ).toBe("H");
    expect(eccForStyle({ ...DEFAULT_STYLE, logo: "data:image/png;base64,x", logoScale: 0.1 })).toBe(
      "Q",
    );
    // A stricter choice by the user is never lowered.
    expect(
      eccForStyle({ ...DEFAULT_STYLE, ecc: "H", logo: "data:image/png;base64,x", logoScale: 0.1 }),
    ).toBe("H");
  });

  it("says so when the content is too long for any QR code", () => {
    expect(() => buildMatrix("x".repeat(5000), "M")).toThrowError(/too long/i);
  });

  it("writes an SVG whose size, colours and quiet zone follow the style", () => {
    const matrix = buildMatrix("https://example.com", "M");
    const svg = renderSvg(matrix, resolveStyle({ size: 300, dark: "#123456", light: "#ffffff" }));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="300"');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('role="img"');
  });

  it("escapes a logo data URL rather than letting it close the tag", async () => {
    const logo = `data:image/png;base64,AAAA"><script>`;
    const matrix = buildMatrix("x", "H");
    const svg = renderSvg(matrix, { ...resolveStyle({}), logo });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&quot;&gt;&lt;script&gt;");
  });
});

// ---- the round trip the build file asks for ------------------------------------------------------

describe("round trip: generate then decode", () => {
  const cases: [string, string, Fixture[] | string, Record<string, unknown>][] = [
    ["qr-code-generator", "text", "Hello from OneStop", {}],
    ["url-to-qr", "url", "https://example.com/menu?table=4", {}],
    ["text-to-qr", "text", "Line one\nLine two", {}],
    [
      "contact-to-qr",
      "contact",
      "Ada Lovelace",
      { phone: "+442079460000", email: "ada@example.com" },
    ],
    ["email-to-qr", "email", "me@example.com", { subject: "Hello" }],
    ["phone-to-qr", "phone", "+44 20 7946 0000", {}],
    ["wifi-to-qr", "wifi", "My Home Wi-Fi", { security: "WPA", password: "hunter2" }],
    [
      "qr-code-customization",
      "url",
      "https://example.com",
      { moduleShape: "dot", eyeShape: "circle", dark: "#1d4ed8" },
    ],
  ];

  for (const [id, kind, input, options] of cases) {
    it(`${id} produces a scannable ${kind} code (PNG)`, async () => {
      const result = await run(id, input as string, options);
      const file = out(result);
      expect(file.mimeType).toBe("image/png");
      const decoded = await decodeOutput(file);
      expect(decoded).toBe(output(result).content);
      expect(parsePayload(decoded).kind).toBe(kind);
    });

    it(`${id} produces a scannable ${kind} code (SVG)`, async () => {
      const result = await run(id, input as string, { ...options, format: "svg" });
      const file = out(result);
      expect(file.mimeType).toBe("image/svg+xml");
      expect(await decodeOutput(file)).toBe(output(result).content);
    });
  }

  it("encodes a bare domain typed into the generator as a link", async () => {
    const result = await run("qr-code-generator", "example.com/menu");
    expect(output(result).content).toBe("https://example.com/menu");
    expect(await decodeOutput(out(result))).toBe("https://example.com/menu");
  });

  it("survives a logo in the middle", async () => {
    const logo = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#e11d48" },
    })
      .png()
      .toBuffer();
    const result = await run("qr-code-customization", "https://example.com/logo", {
      logo: `data:image/png;base64,${logo.toString("base64")}`,
      logoScale: 22,
      size: 640,
    });
    expect(await decodeOutput(out(result))).toBe("https://example.com/logo");
  });

  it("still scans at a small size and with no quiet zone reduction", async () => {
    const result = await run("url-to-qr", "https://example.com", { size: 128, margin: 4 });
    expect(await decodeOutput(out(result))).toBe("https://example.com/");
  });

  it("keeps the password out of the job record but inside the code", async () => {
    const options = { security: "WPA", password: "hunter2" };
    const result = await run("wifi-to-qr", "My Home Wi-Fi", options);
    expect(await decodeOutput(out(result))).toContain("P:hunter2");
    expect(redactOptionValues("wifi-to-qr", options).password).toBe("[redacted]");
  });
});

// ---- files -------------------------------------------------------------------------------------

describe("image and audio codes", () => {
  it("embeds a tiny image inside the code itself", async () => {
    const tiny = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#16a34a" },
    })
      .png()
      .toBuffer();
    const result = await run("image-to-qr", [f("dot.png", new Uint8Array(tiny))], { mode: "auto" });
    expect(output(result).mode).toBe("embedded");
    const decoded = await decodeOutput(out(result));
    expect(decoded.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("hosts a larger image on a page and points the code at it", async () => {
    const big = await noisyJpeg();
    const result = await run("image-to-qr", [f("photo.jpg", new Uint8Array(big))], {
      mode: "auto",
    });
    const id = String(output(result).id);
    expect(await decodeOutput(out(result))).toBe(shortUrlFor(id));
    const resolved = await resolveQrLink(id);
    expect(resolved.status).toBe("page");
    if (resolved.status !== "page") throw new Error("unreachable");
    expect(resolved.page.blocks[0]!.type).toBe("image");
  });

  it("refuses to embed a file that cannot possibly fit", async () => {
    const big = await noisyJpeg();
    const result = await run("image-to-qr", [f("photo.jpg", new Uint8Array(big))], {
      mode: "embed",
    });
    expect(fail(result).message).toMatch(/hosted OneStop page/i);
  });

  it("hosts an audio clip", async () => {
    // A WAV header plus silence: enough to be stored and typed, without needing FFmpeg.
    const wav = new Uint8Array(4096);
    wav.set([0x52, 0x49, 0x46, 0x46], 0);
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    const result = await run("audio-to-qr", [f("clip.wav", wav)], { mode: "link" });
    const resolved = await resolveQrLink(String(output(result).id));
    if (resolved.status !== "page") throw new Error("expected a hosted page");
    expect(resolved.page.blocks[0]!.type).toBe("audio");
  });
});

// ---- scanner -------------------------------------------------------------------------------------

describe("scanner", () => {
  it("reads a code out of an uploaded image and names what it is", async () => {
    const code = await renderQr(buildWifi({ ssid: "Home", password: "hunter2" }), { size: 400 });
    const result = await run("qr-code-scanner", [f("code.png", code.bytes)]);
    expect(output(result).kind).toBe("wifi");
    expect((output(result).fields as Record<string, string>).ssid).toBe("Home");
  });

  it("reads a code that has been rotated and photographed at an angle", async () => {
    const code = await renderQr("https://example.com/rotated", { size: 500 });
    const rotated = await sharp(Buffer.from(code.bytes))
      .rotate(90)
      .extend({ top: 40, bottom: 40, left: 40, right: 40, background: "#dddddd" })
      .blur(0.6)
      .jpeg({ quality: 70 })
      .toBuffer();
    const result = await run("qr-code-scanner", [f("photo.jpg", new Uint8Array(rotated))]);
    expect((output(result).fields as Record<string, string>).url).toBe(
      "https://example.com/rotated",
    );
  });

  it("reads a light-on-dark (inverted) code", async () => {
    const code = await renderQr("https://example.com/inverted", {
      dark: "#ffffff",
      light: "#000000",
    });
    const result = await run("qr-code-scanner", [f("inv.png", code.bytes)]);
    expect((output(result).fields as Record<string, string>).url).toBe(
      "https://example.com/inverted",
    );
  });

  it("says there is no code rather than failing oddly", async () => {
    const blank = await sharp({
      create: { width: 200, height: 200, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const result = await run("qr-code-scanner", [f("blank.png", new Uint8Array(blank))]);
    expect(fail(result).code).toBe("UNSUPPORTED_INPUT");
    expect(fail(result).message).toMatch(/No QR code was found/i);
  });

  it("explains a file that is not an image at all", async () => {
    const result = await run("qr-code-scanner", [
      f("notes.png", new TextEncoder().encode("hello")),
    ]);
    expect(fail(result).message).toMatch(/could not be read/i);
  });
});

// ---- dynamic codes --------------------------------------------------------------------------------

describe("dynamic QR codes", () => {
  it("keeps the code identical while the destination changes", async () => {
    const created = await run("dynamic-qr-code", "https://example.com/first", { title: "Poster" });
    const id = String(output(created).id);
    const shortUrl = shortUrlFor(id);
    const imageBefore = out(created).bytes;
    expect(await decodeOutput(out(created))).toBe(shortUrl);

    const before = await resolveQrLink(id);
    expect(before.status).toBe("redirect");
    if (before.status === "redirect") expect(before.target).toBe("https://example.com/first");

    await getQrStore().update(id, { target: "https://example.com/second" });

    const after = await resolveQrLink(id);
    if (after.status !== "redirect") throw new Error("expected a redirect");
    expect(after.target).toBe("https://example.com/second");
    // The printed artefact is unchanged: same URL, and re-rendering gives the same bytes.
    const rerendered = await renderQr(shortUrl, {});
    expect(Buffer.from(rerendered.bytes).equals(Buffer.from(imageBefore))).toBe(true);
    expect(after.link.history).toHaveLength(2);
  });

  it("pauses and resumes without losing the code", async () => {
    const created = await run("dynamic-qr-code", "https://example.com/paused");
    const id = String(output(created).id);
    await getQrStore().update(id, { active: false });
    expect((await resolveQrLink(id)).status).toBe("paused");
    await getQrStore().update(id, { active: true });
    expect((await resolveQrLink(id)).status).toBe("redirect");
  });

  it("reports a deleted code as missing", async () => {
    const created = await run("dynamic-qr-code", "https://example.com/gone");
    const id = String(output(created).id);
    expect(await getQrStore().remove(id)).toBe(true);
    expect((await resolveQrLink(id)).status).toBe("missing");
  });

  it("builds a landing page with a button", async () => {
    const created = await run("custom-qr-landing-page", "Open from 9 to 5, every day.", {
      title: "Our cafe",
      subtitle: "Bakery and coffee",
      linkLabel: "See the menu",
      linkUrl: "https://example.com/menu",
    });
    const resolved = await resolveQrLink(String(output(created).id));
    if (resolved.status !== "page") throw new Error("expected a hosted page");
    expect(resolved.page.title).toBe("Our cafe");
    expect(resolved.page.blocks.map((b) => b.type)).toEqual(["text", "link"]);
    expect(resolved.page.blocks[1]!.url).toBe("https://example.com/menu");
  });

  it("builds a content page from files and text", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const created = await run(
      "qr-content-page",
      [f("map.png", new Uint8Array(png)), f("notes.txt", new TextEncoder().encode("hello"))],
      { title: "Field trip" },
    );
    const resolved = await resolveQrLink(String(output(created).id));
    if (resolved.status !== "page") throw new Error("expected a hosted page");
    expect(resolved.page.blocks.map((b) => b.type)).toEqual(["image", "file"]);
  });

  it("refuses a page link that is not a web address", () => {
    expect(() =>
      validatePage({
        title: "x",
        blocks: [{ type: "link", text: "x", url: "javascript:alert(1)" }],
      }),
    ).toThrowError(/http/i);
  });

  it("refuses a destination that is not a web address", async () => {
    expect(fail(await run("dynamic-qr-code", "javascript:alert(1)")).code).toBe(
      "UNSUPPORTED_INPUT",
    );
  });
});

// ---- analytics -------------------------------------------------------------------------------------

describe("analytics", () => {
  it("counts every scan and remembers the last one", async () => {
    const created = await run("dynamic-qr-code", "https://example.com/counted", {
      title: "Poster",
    });
    const id = String(output(created).id);

    const SCANS = 7;
    for (let i = 0; i < SCANS; i += 1) {
      await resolveQrLink(id, { device: i % 2 === 0 ? "iOS" : "Android" });
    }

    const link = (await getQrStore().get(id))!;
    expect(link.scanCount).toBe(SCANS);
    expect(link.lastScannedAt).not.toBeNull();
    expect(link.scans).toHaveLength(SCANS);

    const stats = statsFor(link);
    expect(stats.scans).toBe(SCANS);
    expect(stats.scansLast7Days).toBe(SCANS);
    expect(scansByDay(link).reduce((sum, d) => sum + d.scans, 0)).toBe(SCANS);

    const report = await run("qr-code-analytics", null, { detail: "full" });
    const codes = output(report).codes as Record<string, unknown>[];
    expect(codes).toHaveLength(1);
    expect(codes[0]!.scans).toBe(SCANS);
    expect((output(report).totals as Record<string, unknown>).scans).toBe(SCANS);
    expect(ok(report).summary).toContain(`${SCANS} scans`);
  });

  it("counts a scan of a paused code too", async () => {
    const created = await run("dynamic-qr-code", "https://example.com/paused");
    const id = String(output(created).id);
    await getQrStore().update(id, { active: false });
    await resolveQrLink(id);
    expect((await getQrStore().get(id))!.scanCount).toBe(1);
  });

  it("has something helpful to say when there is nothing to report", async () => {
    expect(ok(await run("qr-code-analytics", null)).summary).toMatch(/No dynamic QR codes yet/i);
  });

  it("survives a restart: the store is read back from disk", async () => {
    const created = await run("dynamic-qr-code", "https://example.com/persisted");
    const id = String(output(created).id);
    await resolveQrLink(id);
    // A second store over the same file is exactly what a new server process sees.
    const reopened = getQrStore(path.join(tempDir, "qr-links.json"));
    const link = await reopened.get(id);
    expect(link?.target).toBe("https://example.com/persisted");
    expect(link?.scanCount).toBe(1);
  });
});

// ---- registry contract -----------------------------------------------------------------------------

describe("registry", () => {
  it("registers an executor for every phase-11 tool", () => {
    for (const [id] of QR_EXECUTORS) {
      const meta = getTool(id);
      expect(meta, `${id} is missing from the registry`).toBeDefined();
      expect(meta!.phase).toBe("11");
      expect(meta!.status).toBe("available");
    }
  });

  it("gives every generating tool the shared style options", () => {
    for (const [id] of QR_EXECUTORS) {
      if (id === "qr-code-scanner" || id === "qr-code-analytics") continue;
      const ids = getToolOptions(id).map((o) => o.id);
      expect(ids, `${id} is missing the style options`).toEqual(
        expect.arrayContaining(["format", "size", "margin", "ecc", "dark", "light"]),
      );
    }
  });

  it("marks the four dynamic tools as needing the network and the rest as not", () => {
    const online = [
      "dynamic-qr-code",
      "custom-qr-landing-page",
      "qr-code-analytics",
      "qr-content-page",
    ];
    for (const [id] of QR_EXECUTORS) {
      expect(getTool(id)!.network, id).toBe(online.includes(id) ? "required" : "none");
    }
  });
});

// ---- offline ---------------------------------------------------------------------------------------

describe("offline", () => {
  it("runs every static phase-11 tool with the network trapped", async () => {
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
      const code = await renderQr("https://example.com/offline", { size: 300 });
      const tiny = await sharp({
        create: { width: 8, height: 8, channels: 3, background: "#16a34a" },
      })
        .png()
        .toBuffer();
      const cases: Record<string, [Fixture[] | string, Record<string, unknown>?]> = {
        "qr-code-generator": ["offline test"],
        "qr-code-scanner": [[f("code.png", code.bytes)]],
        "url-to-qr": ["https://example.com"],
        "text-to-qr": ["plain text"],
        "image-to-qr": [[f("dot.png", new Uint8Array(tiny))], { mode: "embed" }],
        "audio-to-qr": [[f("beep.wav", new Uint8Array(100))], { mode: "embed" }],
        "contact-to-qr": ["Ada Lovelace"],
        "email-to-qr": ["me@example.com"],
        "phone-to-qr": ["+442079460000"],
        "wifi-to-qr": ["Home", { password: "hunter2" }],
        "qr-code-customization": ["https://example.com", { moduleShape: "dot" }],
      };
      for (const [id, [input, options]] of Object.entries(cases)) {
        const result = await run(id, input as string, options ?? {});
        expect(result.ok, `${id} failed offline`).toBe(true);
      }
      recordOfflineCoverage("qr", Object.keys(cases));
    } finally {
      globalThis.fetch = saved.fetch;
      http.get = saved.hg;
      http.request = saved.hr;
      https.get = saved.sg;
      https.request = saved.sr;
    }
  });
});
