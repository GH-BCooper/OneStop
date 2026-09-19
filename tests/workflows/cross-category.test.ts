// Workflow tests that deliberately cross category boundaries (master plan §23.4, 19-testing.md).
//
// Phase 15 already runs the four master plan §8 example workflows end to end
// (`apps/api/src/workflows/workflows.test.ts`). Those four each stay close to one family of
// tools, so they would not notice a break in the *seams* between phases — a documents tool
// handing a PDF to a phase-06 tool, a data tool handing one to an image tool, a QR code handed to
// the image pipeline.
//
// These three do exactly that, through the real executors and the real temp store. They are the
// "at least 2 more of your own" the build file asks for.
import {
  createInMemoryJobStore,
  createTempStore,
  loadFileCoreConfig,
  runWorkflow,
  type FileCoreConfig,
  type JobStore,
  type TempStore,
} from "@onestop/api";
import { validateWorkflow } from "@onestop/tool-registry";
import type { WorkflowStep } from "@onestop/types";
import ExcelJS from "exceljs";
import sharp from "sharp";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;
let temp: TempStore;
let jobs: JobStore;
let config: FileCoreConfig;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-crosscat-"));
  temp = createTempStore({ tempDir: dir, ttlMs: 120_000, autoSweep: false });
  jobs = createInMemoryJobStore();
  config = { ...loadFileCoreConfig(), tempDir: dir };
});

afterEach(async () => {
  await temp.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

interface RunInput {
  name: string;
  steps: WorkflowStep[];
  files: { name: string; mimeType: string; bytes: Uint8Array }[];
}

/** Validates the chain the way the builder would, then runs it the way the engine would. */
async function run({ name, steps, files }: RunInput) {
  const validation = validateWorkflow(steps);
  expect(validation.issues, `${name} is not a valid chain`).toEqual([]);
  const result = await runWorkflow({ steps, files, name }, { jobs, temp, config });
  expect(result.error, `${name}: ${result.error ?? ""}`).toBeNull();
  expect(result.ok).toBe(true);
  return result;
}

const enc = (s: string) => new TextEncoder().encode(s);
const head = (bytes: Uint8Array, n: number) => new TextDecoder().decode(bytes.slice(0, n));

async function makeTinyPng(): Promise<Uint8Array> {
  const image = sharp({ create: { width: 16, height: 16, channels: 3, background: "#16a34a" } });
  return new Uint8Array(await image.png().toBuffer());
}

async function makeWorkbook(): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Sales");
  sheet.addRow(["Region", "Quarter", "Amount"]);
  sheet.addRow(["North", "Q1", 1200]);
  sheet.addRow(["South", "Q1", 980]);
  sheet.addRow(["North", "Q2", 1450]);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

describe("workflows across categories", () => {
  it("Excel → PDF → Watermark → Password (data → PDF → advanced PDF)", async () => {
    // Three phases in one chain: phase 08 produces the PDF, phase 05/06 dress it and lock it.
    const result = await run({
      name: "Excel → PDF → Watermark → Password",
      steps: [
        { toolId: "excel-to-pdf" },
        { toolId: "add-watermark-to-pdf", options: { text: "CONFIDENTIAL", position: "tile" } },
        { toolId: "password-protect-pdf", options: { password: "quarterly-2026" } },
      ],
      files: [
        {
          name: "sales.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          bytes: await makeWorkbook(),
        },
      ],
    });

    expect(result.steps.map((s) => s.status)).toEqual(["success", "success", "success"]);
    const output = result.files[0]!;
    expect(output.name.endsWith(".pdf")).toBe(true);
    const bytes = await temp.read(output.id);
    expect(head(bytes, 5)).toBe("%PDF-");
    // The last step really encrypted it: an encrypted PDF carries an /Encrypt dictionary.
    expect(new TextDecoder("latin1").decode(bytes)).toContain("/Encrypt");
  }, 300_000);

  it("Image → QR → Resize → WebP (QR → images)", async () => {
    // A QR code is a PNG the image tools have no special knowledge of; this is the seam between
    // phase 11 and phase 09. The chain starts from a file, which is what the builder requires of
    // a first step - the text-only QR tools cannot open a workflow.
    const result = await run({
      name: "Image → QR → Resize → WebP",
      steps: [
        { toolId: "image-to-qr", options: { mode: "embed" } },
        { toolId: "image-resizer", options: { mode: "pixels", width: 256, height: 256 } },
        { toolId: "image-format-converter", options: { format: "webp" } },
      ],
      files: [{ name: "dot.png", mimeType: "image/png", bytes: await makeTinyPng() }],
    });

    const output = result.files[0]!;
    expect(output.name.endsWith(".webp")).toBe(true);
    const bytes = await temp.read(output.id);
    expect(head(bytes, 4)).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WEBP");
  }, 300_000);

  it("CSV → JSON → formatted → ZIP (data → developer utilities)", async () => {
    // Phase 08 converts, phase 12 packages. The point is that a phase-12 tool accepts a file it
    // never saw uploaded - it came out of another tool's temp entry.
    const result = await run({
      name: "CSV → JSON → formatted → ZIP",
      steps: [
        { toolId: "csv-to-json" },
        { toolId: "json-formatter", options: { mode: "pretty", indent: "2" } },
        { toolId: "zip-creator", options: { level: "normal" } },
      ],
      files: [
        {
          name: "people.csv",
          mimeType: "text/csv",
          bytes: enc("name,role\nAda,engineer\nGrace,admiral\n"),
        },
      ],
    });

    const output = result.files[0]!;
    expect(output.name.endsWith(".zip")).toBe(true);
    const bytes = await temp.read(output.id);
    // A ZIP always starts "PK\x03\x04".
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // And the JSON that went into it really was converted and re-formatted.
    const json = new TextDecoder().decode(await temp.read(result.steps[1]!.files[0]!.id));
    expect(JSON.parse(json)).toEqual([
      { name: "Ada", role: "engineer" },
      { name: "Grace", role: "admiral" },
    ]);
    expect(json).toContain("\n  ");
  }, 300_000);
});
