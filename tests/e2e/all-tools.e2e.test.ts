// Every registered tool, run for real (no mocks) with a generated input file or text.
//
// This is the "does each and every tool actually work" sweep: it builds one fixture per input
// family (text, CSV, JSON, XML, YAML, XLSX, DOCX, PPTX, PDF, images, audio, video, ZIP, SRT…),
// feeds each tool the first fixture it accepts through the same `runPipeline` the app uses, and
// checks it succeeds and produced something (an output value or a non-empty file).
//
// Tools that can only work with the outside world (a YouTube/Instagram link, a DNS lookup, an
// account) are listed in `NEEDS_OUTSIDE` and must still fail *politely* - a short message, never
// a crash - or succeed when the network is there.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getTool, inputKind, fileInputTypes, tools, type ToolMeta } from "@onestop/tool-registry";
import { describe, expect, it } from "vitest";
import { runPipeline, type PipelineFileInput } from "../../apps/api/src/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "onestop-all-tools-"));
type Fx = PipelineFileInput;

const enc = (s: string) => new TextEncoder().encode(s);
const text = (name: string, body: string, mime = "text/plain"): Fx => ({ name, mimeType: mime, bytes: enc(body) });

const LOREM =
  "OneStop is a free toolbox. It converts files, edits PDFs and images, and cleans data.\n\nThe quick brown fox jumps over the lazy dog. Contact us at hello@example.com or visit https://example.com. The invoice total is $1,250.00 due 2026-10-31.\n\nThis is a seccond paragraph with a typo. Notice period is 30 days.";

async function makeFixtures(): Promise<Record<string, Fx>> {
  const fx: Record<string, Fx> = {};
  fx.txt = text("sample.txt", LOREM);
  fx.md = text("sample.md", "# Title\n\nSome **bold** text and a list:\n\n- one\n- two\n", "text/markdown");
  fx.csv = text("people.csv", "name,age,city\nAda,36,London\nLinus,54,Portland\nGrace,85,NYC\nAda,36,London\n", "text/csv");
  fx.json = text("data.json", JSON.stringify([{ name: "Ada", age: 36 }, { name: "Linus", age: 54 }]), "application/json");
  fx.xml = text("data.xml", "<root><person><name>Ada</name><age>36</age></person><person><name>Linus</name><age>54</age></person></root>", "application/xml");
  fx.yaml = text("data.yaml", "people:\n  - name: Ada\n    age: 36\n  - name: Linus\n    age: 54\n", "application/x-yaml");
  fx.html = text("page.html", "<html><body><h1>Hello</h1><p>World</p></body></html>", "text/html");
  fx.css = text("style.css", "body{margin:0;color:red}.a{padding:1px}", "text/css");
  fx.js = text("app.js", "const a=1;function f(x){return x+a}", "text/javascript");
  fx.srt = text("subs.srt", "1\n00:00:01,000 --> 00:00:03,000\nHello there\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line\n", "application/x-subrip");

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRows([["name", "age", "city"], ["Ada", 36, "London"], ["Linus", 54, "Portland"], ["Grace", 85, "NYC"], ["Ada", 36, "London"]]);
  fx.xlsx = { name: "people.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: new Uint8Array(await wb.xlsx.writeBuffer()) };

  const docx = await import("docx");
  const doc = new docx.Document({
    sections: [{ children: LOREM.split("\n\n").flatMap((t, i) => [
      ...(i > 0 ? [new docx.Paragraph({ children: [new docx.PageBreak()] })] : []),
      new docx.Paragraph({ text: `Section ${i + 1}`, heading: docx.HeadingLevel.HEADING_1 }),
      new docx.Paragraph({ children: [new docx.TextRun(t)] }),
    ]) }],
  });
  fx.docx = { name: "report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: new Uint8Array(await docx.Packer.toBuffer(doc)) };

  const PptxGen = (await import("pptxgenjs")).default;
  const pptx = new PptxGen();
  for (const t of ["Welcome", "Second slide", "Third slide"]) pptx.addSlide().addText(t, { x: 1, y: 1, fontSize: 32 });
  fx.pptx = { name: "deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: new Uint8Array((await pptx.write({ outputType: "nodebuffer" })) as Buffer) };

  const sharp = (await import("sharp")).default;
  const base = sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 30, g: 120, b: 200 } } });
  const overlay = enc(`<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><rect x="80" y="80" width="300" height="200" fill="#fff"/><text x="100" y="200" font-size="64" fill="#000" font-family="Arial">OneStop 123</text></svg>`);
  const composed = base.composite([{ input: Buffer.from(overlay) }]);
  fx.png = { name: "photo.png", mimeType: "image/png", bytes: new Uint8Array(await composed.clone().png().toBuffer()) };
  fx.jpg = { name: "photo.jpg", mimeType: "image/jpeg", bytes: new Uint8Array(await composed.clone().jpeg().toBuffer()) };
  fx.webp = { name: "photo.webp", mimeType: "image/webp", bytes: new Uint8Array(await composed.clone().webp().toBuffer()) };
  fx.gif = { name: "photo.gif", mimeType: "image/gif", bytes: new Uint8Array(await composed.clone().gif().toBuffer()) };

  const zipper = (await import("jszip")).default;
  const z = new zipper();
  z.file("a.txt", "hello");
  z.file("b.txt", "world");
  fx.zip = { name: "bundle.zip", mimeType: "application/zip", bytes: new Uint8Array(await z.generateAsync({ type: "uint8array" })) };

  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const run = (args: string[], out: string) => {
    const file = path.join(tmp, out);
    const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", ...args, file], { timeout: 60_000 });
    return r.status === 0 && fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
  };
  const mp3 = run(["-f", "lavfi", "-i", "sine=frequency=440:duration=3"], "tone.mp3");
  const wav = run(["-f", "lavfi", "-i", "sine=frequency=330:duration=3"], "tone.wav");
  const subs = path.join(tmp, "subs.srt");
  fs.writeFileSync(subs, ["1", "00:00:00,500 --> 00:00:02,000", "Hello", ""].join("\n"));
  const mp4 = run(["-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-shortest", "-pix_fmt", "yuv420p"], "clip.mp4");
  if (mp3) fx.mp3 = { name: "tone.mp3", mimeType: "audio/mpeg", bytes: mp3 };
  if (wav) fx.wav = { name: "tone.wav", mimeType: "audio/wav", bytes: wav };
  if (mp4) fx.mp4 = { name: "clip.mp4", mimeType: "video/mp4", bytes: mp4 };
  const mp4sub = run(["-i", path.join(tmp, "clip.mp4"), "-i", subs, "-c", "copy", "-c:s", "mov_text"], "clip-sub.mp4");
  if (mp4sub) fx.mp4sub = { name: "clip-sub.mp4", mimeType: "video/mp4", bytes: mp4sub };

  // A real PDF, made by OneStop's own Word → PDF and Image → PDF tools (also exercises them).
  const pdfFromDoc = await runPipeline({ toolId: "word-to-pdf", files: [fx.docx!], options: {} });
  if (pdfFromDoc.ok && pdfFromDoc.files[0]) {
    const store = (await import("../../apps/api/src/index.ts")).getTempStore();
    fx.pdf = { name: "report.pdf", mimeType: "application/pdf", bytes: await store.read(pdfFromDoc.files[0].id) };
  }
  if (fx.pdf) {
    // Two pages, so page-level tools have something to keep after deleting one.
    const twice = await runPipeline({ toolId: "merge-pdf", files: [fx.pdf, { ...fx.pdf, name: "again.pdf" }], options: {} });
    if (twice.ok && twice.files[0]) {
      const store = (await import("../../apps/api/src/index.ts")).getTempStore();
      fx.pdf = { name: "report.pdf", mimeType: "application/pdf", bytes: await store.read(twice.files[0].id) };
    }
    fx.pdf2 = { ...fx.pdf, name: "report-2.pdf" };
    const locked = await runPipeline({ toolId: "password-protect-pdf", files: [fx.pdf], options: { password: "s3cret-pass" } });
    if (locked.ok && locked.files[0]) {
      const store = (await import("../../apps/api/src/index.ts")).getTempStore();
      fx.pdfLocked = { name: "locked.pdf", mimeType: "application/pdf", bytes: await store.read(locked.files[0].id) };
    }
  }
  fx.docx2 = { ...fx.docx!, name: "report-2.docx" };
  fx.pptx2 = { ...fx.pptx!, name: "deck-2.pptx" };
  fx.xlsx2 = { ...fx.xlsx!, name: "people-2.xlsx" };
  fx.csv2 = { ...fx.csv!, name: "people-2.csv" };
  if (fx.mp3) fx.mp3b = { ...fx.mp3, name: "tone-2.mp3" };
  if (fx.mp4) fx.mp4b = { ...fx.mp4, name: "clip-2.mp4" };
  fx.txt2 = { ...fx.txt!, name: "sample-2.txt" };
  const qr = await runPipeline({ toolId: "url-to-qr", text: "https://example.com", options: {} });
  if (qr.ok && qr.files[0]) {
    const store = (await import("../../apps/api/src/index.ts")).getTempStore();
    fx.qrpng = { name: "qr.png", mimeType: "image/png", bytes: await store.read(qr.files[0].id) };
  }
  return fx;
}

/** Tools that need more than one file, a specific fixture, options or text to have anything to do. */
const EXTRA: Record<string, { files?: string[]; options?: Record<string, unknown>; text?: string }> = {
  "merge-pdf": { files: ["pdf", "pdf2"] },
  "compare-pdfs": { files: ["pdf", "pdf2"] },
  "delete-pdf-pages": { options: { pages: "2" } },
  "subtitle-extraction": { files: ["mp4sub"] },
  "reorder-pdf-pages": { options: { preset: "reverse" } },
  "remove-pdf-password": { files: ["pdfLocked"], options: { password: "s3cret-pass" } },
  "sign-pdf": { options: { source: "type", signature: "Ada Lovelace", signerName: "Ada" } },
  "edit-pdf-metadata": { options: { title: "OneStop test", author: "Brett" } },
  "merge-documents": { files: ["docx", "docx2"] },
  "merge-presentations": { files: ["pptx", "pptx2"] },
  "extract-slides": { options: { slides: "1-2" } },
  "rearrange-slides": { options: { order: "3,1,2" } },
  "remove-slides": { options: { slides: "2" } },
  "excel-merger": { files: ["xlsx", "xlsx2"] },
  "excel-splitter": { options: { mode: "column", column: "city" } },
  "csv-merger": { files: ["csv", "csv2"] },
  "column-row-transformer": { options: { operation: "rename", mapping: "name = Full name" } },
  "image-resizer": { options: { width: 320 } },
  "add-text-to-image": { options: { text: "Hello" } },
  "meme-generator": { options: { top: "TOP", bottom: "BOTTOM" } },
  "audio-trimmer": { options: { start: "0:00:01", end: "0:00:02" } },
  "audio-merger": { files: ["mp3", "mp3b"] },
  "video-trimmer": { options: { start: "0:00:01", end: "0:00:02" } },
  "video-merger": { files: ["mp4", "mp4b"] },
  "qr-code-scanner": { files: ["qrpng"] },
  "wifi-to-qr": { options: { password: "hunter2hunter2" } },
  "ask-questions-about-a-file": { options: { question: "What is the notice period?" } },
  "ai-image-editor": { options: { prompt: "make it brighter" } },
  "regex-tester": { options: { pattern: "\d+", flags: "g" } },
  "user-agent-viewer": { options: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36" } },
  "ip-address-lookup": { text: "8.8.8.8" },
  "ip-geolocation": { text: "8.8.8.8" },
  "location-lookup": { text: "Eiffel Tower, Paris" },
  "coordinates-lookup": { text: "48.8584, 2.2945" },
  "dns-lookup": { text: "example.com" },
  "whois-lookup": { text: "example.com" },
  "file-merger": { files: ["txt", "txt2"] },
  "file-type-converter": { options: { target: "pdf" } },
  "metadata-remover": { files: ["jpg"] },
  "duplicate-file-detector": { files: ["txt", "txt2"] },
  "youtube-to-mp3": { text: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  "youtube-to-mp4": { text: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  "youtube-quality-selector": { text: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  "instagram-reel-to-mp3": { text: "https://www.instagram.com/reel/C0abc123/" },
  "instagram-reel-to-mp4": { text: "https://www.instagram.com/reel/C0abc123/" },
  "instagram-quality-selector": { text: "https://www.instagram.com/reel/C0abc123/" },
  "spotify-link-info": { text: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" },
};

/** Which fixture(s) to try, in order, for a tool's declared input types. */
function fixtureFor(tool: ToolMeta, fx: Record<string, Fx>): Fx[] {
  const types = fileInputTypes(tool);
  const pick = (...keys: string[]) => keys.map((k) => fx[k]).filter((f): f is Fx => Boolean(f));
  const out: Fx[] = [];
  for (const t of types) {
    switch (t) {
      case "any": out.push(...pick("txt")); break;
      case "image": out.push(...pick("png", "jpg")); break;
      case "video": out.push(...pick("mp4")); break;
      case "audio": out.push(...pick("mp3", "wav")); break;
      case "jpg": case "jpeg": out.push(...pick("jpg")); break;
      case "png": out.push(...pick("png")); break;
      case "webp": out.push(...pick("webp")); break;
      case "doc": case "docx": case "odt": case "rtf": out.push(...pick("docx")); break;
      case "txt": out.push(...pick("txt")); break;
      case "xls": case "xlsx": out.push(...pick("xlsx")); break;
      case "ppt": case "pptx": out.push(...pick("pptx")); break;
      case "yml": case "yaml": out.push(...pick("yaml")); break;
      case "vtt": case "ass": case "srt": out.push(...pick("srt")); break;
      default: out.push(...pick(t));
    }
  }
  return out.length > 0 ? [out[0]!] : [];
}

/** Sensible options where a tool has a required value with no usable default. */
const OPTIONS: Record<string, Record<string, unknown>> = {
  "password-protect-pdf": { password: "s3cret-pass" },
  "add-password-to-pdf": { password: "s3cret-pass" },
  "encrypt-pdf": { password: "s3cret-pass" },
  "add-watermark-to-pdf": { text: "CONFIDENTIAL" },
  "text-watermark": { text: "OneStop" },
  "search-and-replace-in-document": { find: "fox", replace: "cat" },
  "hash-generator": { algorithm: "sha256" },
};

const TEXT_INPUTS: Record<string, string> = {
  "regex-tester": "hello 123 world 456",
  "text-to-qr": "Hello from OneStop",
  "url-to-qr": "https://example.com",
  "email-to-qr": "hello@example.com",
  "phone-to-qr": "+442079460000",
  "wifi-to-qr": "HomeWiFi",
  "contact-to-qr": "Ada Lovelace",
  "qr-code-generator": "https://example.com",
  "timestamp-converter": "1700000000",
  "json-formatter": '{"a":1,"b":[1,2]}',
  "url-encoder": "hello world & more",
  "url-decoder": "hello%20world%20%26%20more",
  "base64-decoder": "aGVsbG8gT25lU3RvcA==",
  "jwt-decoder": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.abc",
};

/** Tools that reach the outside world, an account, or a local service this machine may not run;
 *  they may fail, but only politely. */
const NEEDS_OUTSIDE = (tool: ToolMeta) =>
  tool.network === "required" ||
  tool.requiresAuth ||
  inputKind(tool) === "url" ||
  tool.id === "ai-image-generator" ||
  tool.id === "ai-image-editor" ||
  // No fillable form in the generated PDF: refusing with a clear message is the right behaviour.
  tool.id === "fill-pdf-forms";

const results: { id: string; ok: boolean; note: string }[] = [];

describe("every registered tool runs for real", () => {
  const available = tools.filter((t) => t.status === "available" && t.id !== "ai-assistant");

  it("has a working input for and runs each tool", { timeout: 900_000 }, async () => {
    const fx = await makeFixtures();
    const failures: string[] = [];

    for (const tool of available) {
      const kind = inputKind(tool);
      const extra = EXTRA[tool.id];
      let files: Fx[] = [];
      let textIn: string | null = null;
      if (extra?.files) {
        files = extra.files.map((k) => fx[k]).filter((f): f is Fx => Boolean(f));
        if (files.length !== extra.files.length) {
          results.push({ id: tool.id, ok: false, note: "NO FIXTURE" });
          failures.push(`${tool.id}: missing fixture(s) ${extra.files.join(",")}`);
          continue;
        }
      } else if (kind === "file") {
        files = fixtureFor(tool, fx);
        if (files.length === 0) {
          results.push({ id: tool.id, ok: false, note: "NO FIXTURE" });
          failures.push(`${tool.id}: no fixture for ${fileInputTypes(tool).join("/")}`);
          continue;
        }
        if (tool.inputTypes.includes("text") && files[0]!.name.endsWith(".txt")) textIn = null;
      } else if (kind === "text") {
        textIn = TEXT_INPUTS[tool.id] ?? "Hello OneStop, this is some sample text 123.";
      } else if (kind === "url") {
        textIn = "https://example.com/watch?v=dQw4w9WgXcQ";
      }
      if (extra?.text) textIn = extra.text;
      const started = Date.now();
      let note = "";
      let ok = false;
      try {
        const outcome = await runPipeline({
          toolId: tool.id,
          files,
          text: textIn,
          options: { ...(OPTIONS[tool.id] ?? {}), ...(extra?.options ?? {}) },
          userId: null,
        });
        ok = outcome.ok;
        const produced = outcome.files.length > 0 || (outcome.output !== undefined && outcome.output !== null && outcome.output !== "");
        note = ok ? (produced ? (outcome.summary ?? "ok") : "OK BUT EMPTY") : (outcome.error?.message ?? "failed");
        if (ok && !produced) ok = false;
        for (const f of outcome.files) if (ok && f.size === 0) { ok = false; note = `empty file ${f.name}`; }
      } catch (err) {
        note = `THREW: ${err instanceof Error ? err.message : String(err)}`;
      }
      results.push({ id: tool.id, ok, note: `${Date.now() - started}ms ${note}` });
      if (!ok && !NEEDS_OUTSIDE(tool)) failures.push(`${tool.id}: ${note}`);
      if (!ok && NEEDS_OUTSIDE(tool) && /THREW/.test(note)) failures.push(`${tool.id}: crashed instead of failing politely: ${note}`);
    }

    const passed = results.filter((r) => r.ok).length;
    console.log(`\nALL-TOOLS SWEEP: ${passed}/${results.length} ran OK`);
    for (const r of results.filter((r) => !r.ok)) console.log(`  ✗ ${r.id}: ${r.note}`);
    fs.writeFileSync(path.join(os.tmpdir(), "onestop-all-tools-report.json"), JSON.stringify(results, null, 2));
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("registry has no duplicate ids", () => {
    expect(new Set(tools.map((t) => t.id)).size).toBe(tools.length);
    expect(getTool("uuid-generator")).toBeDefined();
  });
});
